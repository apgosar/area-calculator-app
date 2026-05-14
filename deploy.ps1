# deploy.ps1
# Builds a Docker image via Cloud Build, pushes to GCR, deploys to Cloud Run.
#
# Usage:   .\deploy.ps1
# Prereq:  gcloud CLI installed and authenticated  ->  gcloud auth login

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---- Configuration -----------------------------------------------------------
$PROJECT_ID   = "vds-area-calculator"
$SERVICE_NAME = "area-calculator"
$REGION       = "asia-south1"
$IMAGE        = "gcr.io/$PROJECT_ID/$SERVICE_NAME"
# ------------------------------------------------------------------------------

function Write-Step([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Done([string]$msg) { Write-Host "   OK: $msg" -ForegroundColor Green }

# 1. Verify gcloud
Write-Step "Checking gcloud CLI..."
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Error "gcloud not found. Install from https://cloud.google.com/sdk then run: gcloud auth login"
}
Write-Done "gcloud found."

# 2. Set project
Write-Step "Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID
Write-Done "Project set."

# 3. Enable APIs
Write-Step "Enabling Cloud Run, Cloud Build, and Container Registry APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com
Write-Done "APIs enabled."

# 4. Build image via Cloud Build and push to GCR
#    Cloud Build runs the Dockerfile remotely - no local Docker required.
#    First build takes ~6-8 min (downloads the Puppeteer base image).
#    Subsequent builds are faster due to layer caching.
Write-Step "Building Docker image with Cloud Build and pushing to GCR..."
Write-Host "   Image: $IMAGE" -ForegroundColor Gray
Write-Host "   First build takes ~6-8 min (Puppeteer base image is large)." -ForegroundColor Gray

gcloud builds submit --tag $IMAGE .

Write-Done "Image built and pushed: $IMAGE"

# 5. Deploy to Cloud Run
Write-Step "Deploying to Cloud Run..."
Write-Host "   Service : $SERVICE_NAME" -ForegroundColor Gray
Write-Host "   Region  : $REGION"       -ForegroundColor Gray

gcloud run deploy $SERVICE_NAME `
    --image $IMAGE `
    --platform managed `
    --region $REGION `
    --allow-unauthenticated `
    --port 8080 `
    --memory 1Gi `
    --cpu 1 `
    --min-instances 0 `
    --max-instances 5 `
    --timeout 120

# 6. Print live URL
Write-Step "Fetching service URL..."
$SERVICE_URL = gcloud run services describe $SERVICE_NAME `
    --platform managed `
    --region $REGION `
    --format "value(status.url)"

Write-Host ""
Write-Host "------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Deployment complete!" -ForegroundColor Green
Write-Host "  App URL : $SERVICE_URL" -ForegroundColor Yellow
Write-Host "------------------------------------------------" -ForegroundColor Cyan