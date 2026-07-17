# deploy-aws.ps1
# Builds a Docker image locally, pushes to Amazon ECR, and deploys to AWS Lambda via Function URLs.
#
# Usage:   .\deploy-aws.ps1
# Prereq:  aws CLI installed and configured -> aws configure
#          Docker Desktop installed and running

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---- Configuration -----------------------------------------------------------
$SERVICE_NAME = "area-calculator"
$REGION       = "ap-south-1"
$MEMORY_MB    = 2048
$TIMEOUT_SEC  = 30
# ------------------------------------------------------------------------------

function Write-Step([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Done([string]$msg) { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }

# 1. Verify aws and docker CLI
Write-Step "Checking AWS CLI..."
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "aws CLI not found. Install from https://aws.amazon.com/cli/ then run: aws configure"
}
Write-Done "aws CLI found."

Write-Step "Checking Docker CLI..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "docker CLI not found. Install Docker Desktop and ensure it is running."
}
Write-Done "docker CLI found."

# 2. Get AWS Account ID
Write-Step "Getting AWS Account ID..."
$ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text)
if (-not $ACCOUNT_ID) { Write-Error "Failed to get AWS Account ID. Check 'aws configure'." }
Write-Done "Account ID: $ACCOUNT_ID"

# 3. Create ECR repo (if not exists)
Write-Step "Ensuring ECR repository exists..."
$REPO_URI = "$ACCOUNT_ID.dkr.ecr.${REGION}.amazonaws.com/${SERVICE_NAME}"
try {
    aws ecr describe-repositories --repository-names $SERVICE_NAME --region $REGION 2>&1 | Out-Null
    Write-Done "ECR repository found: $REPO_URI"
} catch {
    Write-Host "   Creating ECR repository $SERVICE_NAME..." -ForegroundColor Gray
    aws ecr create-repository --repository-name $SERVICE_NAME --region $REGION | Out-Null
    Write-Done "ECR repository created: $REPO_URI"
}

# 4. Authenticate Docker to ECR
Write-Step "Authenticating Docker to ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REPO_URI
Write-Done "Docker authenticated."

# 5. Build Image
Write-Step "Fetching AWS Lambda Web Adapter..."
$LAYER_URL = (aws lambda get-layer-version --layer-name "arn:aws:lambda:${REGION}:753240598075:layer:LambdaAdapterLayerX86" --version-number 23 --region $REGION --query Content.Location --output text)
Invoke-WebRequest -Uri $LAYER_URL -OutFile "lambda-adapter.zip"
Expand-Archive -Path "lambda-adapter.zip" -DestinationPath "lambda-adapter-dir" -Force
Remove-Item "lambda-adapter.zip"
Write-Done "AWS Lambda Web Adapter fetched locally."

Write-Step "Building Docker image locally..."
Write-Host "   This may take a few minutes..." -ForegroundColor Gray
docker build --provenance=false -t $SERVICE_NAME .
Write-Done "Image built."

# 6. Tag and Push Image
Write-Step "Tagging and pushing image to ECR..."
docker tag "${SERVICE_NAME}:latest" "${REPO_URI}:latest"
docker push "${REPO_URI}:latest"
Write-Done "Image pushed to ECR: ${REPO_URI}:latest"

# 7. IAM Role for Lambda
Write-Step "Ensuring Lambda Execution Role exists..."
$ROLE_NAME = "AreaCalculatorLambdaRole"
try {
    $roleInfo = (aws iam get-role --role-name $ROLE_NAME 2>&1 | ConvertFrom-Json)
    $ROLE_ARN = $roleInfo.Role.Arn
    Write-Done "IAM role found: $ROLE_ARN"
} catch {
    Write-Host "   Creating IAM role $ROLE_NAME..." -ForegroundColor Gray
    $trustPolicy = '{"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}'
    Set-Content -Path lambda-trust.json -Value $trustPolicy
    $roleCreated = (aws iam create-role --role-name $ROLE_NAME --assume-role-policy-document file://lambda-trust.json | ConvertFrom-Json)
    Remove-Item -Path lambda-trust.json
    $ROLE_ARN = $roleCreated.Role.Arn
    aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole | Out-Null
    Write-Host "   Waiting 10 seconds for role to propagate..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
    Write-Done "IAM role created: $ROLE_ARN"
}

# 8. Deploy to Lambda
Write-Step "Deploying to AWS Lambda..."
try {
    aws lambda get-function --function-name $SERVICE_NAME --region $REGION 2>&1 | Out-Null
    $exists = $true
} catch {
    $exists = $false
}

if ($exists) {
    Write-Host "   Updating existing Lambda function code..." -ForegroundColor Gray
    aws lambda update-function-code --function-name $SERVICE_NAME --image-uri "${REPO_URI}:latest" --region $REGION | Out-Null
    Write-Host "   Waiting for update to complete..." -ForegroundColor Gray
    aws lambda wait function-updated-v2 --function-name $SERVICE_NAME --region $REGION
    
    Write-Host "   Updating configuration (memory/timeout)..." -ForegroundColor Gray
    aws lambda update-function-configuration --function-name $SERVICE_NAME --memory-size $MEMORY_MB --timeout $TIMEOUT_SEC --region $REGION | Out-Null
    aws lambda wait function-updated-v2 --function-name $SERVICE_NAME --region $REGION
    
    Write-Done "Lambda updated."
} else {
    Write-Host "   Creating new Lambda function..." -ForegroundColor Gray
    aws lambda create-function --function-name $SERVICE_NAME --package-type Image --code ImageUri="${REPO_URI}:latest" --role $ROLE_ARN --memory-size $MEMORY_MB --timeout $TIMEOUT_SEC --region $REGION | Out-Null
    Write-Host "   Waiting for creation to complete..." -ForegroundColor Gray
    aws lambda wait function-active-v2 --function-name $SERVICE_NAME --region $REGION
    Write-Done "Lambda created."
}

# 9. Configure Function URL
Write-Step "Configuring Function URL..."
try {
    $urlConfig = aws lambda get-function-url-config --function-name $SERVICE_NAME --region $REGION 2>&1 | ConvertFrom-Json
    $SERVICE_URL = $urlConfig.FunctionUrl
    Write-Done "Function URL exists: $SERVICE_URL"
} catch {
    Write-Host "   Creating Function URL..." -ForegroundColor Gray
    $urlConfig = aws lambda create-function-url-config --function-name $SERVICE_NAME --auth-type NONE --region $REGION | ConvertFrom-Json
    $SERVICE_URL = $urlConfig.FunctionUrl
    
    Write-Host "   Adding public access permissions..." -ForegroundColor Gray
    try {
        aws lambda add-permission `
            --function-name $SERVICE_NAME `
            --action lambda:InvokeFunctionUrl `
            --principal "*" `
            --function-url-auth-type NONE `
            --statement-id FunctionURLAllowPublicAccess `
            --region $REGION | Out-Null
            
        aws lambda add-permission `
            --function-name $SERVICE_NAME `
            --action lambda:InvokeFunction `
            --principal "*" `
            --statement-id AllowInvokeFunctionPublic `
            --region $REGION | Out-Null
    } catch {
        # If the permissions already exist, this command will error, but we can safely ignore it.
    }
    Write-Done "Function URL created: $SERVICE_URL"
}

Write-Host ""
Write-Host "------------------------------------------------" -ForegroundColor Cyan
Write-Host "  AWS Lambda Deployment complete!" -ForegroundColor Green
Write-Host "  App URL : $SERVICE_URL" -ForegroundColor Yellow
Write-Host "------------------------------------------------" -ForegroundColor Cyan
