# VDS Advisory — Room Area Calculator

A full-stack web application that lets VDS Advisory employees calculate room areas, generate professional PDF reports, and export data to Excel in one click.

---

## Features

- **Auth gate** — Employee ID protects access
- **Room area calculator** — Enter length x width for any number of rooms; supports feet, metres, and inches
- **PDF report** — Professional branded single-page PDF generated server-side via Puppeteer (headless Chrome)
- **Excel export** — Every PDF contains a clickable "Download Excel Data (.csv)" button; each value lands in its own Excel cell
- **Clipboard copy** — Copy the table as rich HTML directly into Word or Excel via the in-app button

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| PDF generation | Puppeteer (headless Google Chrome) |
| Container | Docker — `node:20-slim` + Google Chrome stable |
| Image registry | Google Container Registry (GCR) |
| Hosting | Google Cloud Run |

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 or later | https://nodejs.org |
| npm | 10 or later | bundled with Node |
| gcloud CLI | any recent | https://cloud.google.com/sdk — needed for deployment only |

Docker Desktop is **not** required. `deploy.ps1` uses Cloud Build to build the image remotely.

---

## Local Development

### 1. Install dependencies

```
npm install
```

> First run downloads Puppeteer's bundled Chromium (~170 MB). One-time step.

### 2. Start the dev servers

```
npm run dev
```

Two processes start in parallel:

| Process | URL | Purpose |
|---|---|---|
| Vite (React) | http://localhost:5173 | Frontend with hot-reload |
| Express | http://localhost:3001 | PDF + CSV API |

Vite proxies all `/api/*` requests to Express automatically (`vite.config.js`).

### 3. Log in

Employee ID: `***`

### 4. Test the full flow

1. Enter a customer name and room dimensions
2. Click **Calculate Total Area**
3. Click **Download PDF** — the PDF downloads and the table is simultaneously copied to your clipboard
4. Open the PDF — click the **"Download Excel Data (.csv)"** button on the page
5. Open the downloaded CSV in Excel — every value is in its own cell

---

## Project Structure

```
area-calculator-app/
├── public/                  Static assets served at root URL
│   ├── logo.png             VDS Advisory logo (transparent PNG, on dark header)
│   └── favicon.png          Browser tab icon
├── src/
│   ├── App.jsx              Main React component (auth, calculator, results)
│   ├── App.css              Styles matching vdsadvisory.com design system
│   └── main.jsx             React entry point
├── dist/                    Vite production build output (git-ignored)
├── index.html               Vite HTML entry
├── vite.config.js           Vite config + /api proxy for dev
├── server.js                Express — PDF generation, CSV download, static serving
├── package.json
├── Dockerfile               node:20-slim + Google Chrome stable
├── .dockerignore
├── .gcloudignore
└── deploy.ps1               One-command Cloud Run deployment script
```

---

## API Endpoints

### `POST /api/generate-pdf`

Generates and returns a branded PDF report.

**Request body (JSON):**
```json
{
  "customerName": "Sharma Builders",
  "unit": "ft",
  "rooms": [
    { "name": "Living Room", "length": 15, "width": 12, "area": "180.00" }
  ],
  "total": "180.00"
}
```

**Response:** `application/pdf` binary

The PDF contains a `<a href="/api/download-csv?data=...">` link. Chromium converts this into a real PDF link annotation, clickable in any PDF viewer.

---

### `GET /api/download-csv?data=<base64>`

Returns a UTF-8 CSV file (with BOM so Excel opens it correctly).

`data` is URL-safe base64-encoded JSON with the same fields as the PDF request. The payload is self-contained in the URL — no server state needed.

---

## How the Excel Export Works

The PDF's "Download Excel Data" button is a standard hyperlink embedded by Puppeteer during PDF generation. The report payload is base64-encoded into the URL so:

- No server-side storage or session required
- Works in Chrome PDF viewer, Edge, Adobe Acrobat
- Clicking it triggers a direct CSV download
- Opening the CSV in Excel gives one value per cell

---

## Deployment (Google Cloud Run)

### One-time setup

```powershell
gcloud auth login
gcloud auth application-default login
```

### Deploy

```powershell
.\deploy.ps1
```

The script does the following:

1. Sets the active GCP project to `vds-area-calculator`
2. Enables Cloud Run, Cloud Build, and Container Registry APIs
3. Submits the Docker build to **Cloud Build** (runs remotely — no local Docker needed)
4. Pushes the image to **GCR** at `gcr.io/vds-area-calculator/area-calculator`
5. Deploys the image to **Cloud Run** in `asia-south1` (Mumbai)
6. Prints the live URL

First deployment takes ~8-10 minutes (Cloud Build downloads the Chrome base image). Re-deploys are faster due to layer caching.

### How the Dockerfile works

```
FROM node:20-slim
  |
  +-- Install Google Chrome Stable from Google's apt repo
  |     (Chrome's apt package pulls all its own system dependencies)
  |
  +-- npm ci  (installs Node dependencies)
  |
  +-- npm run build  (Vite builds the React frontend into /app/dist)
  |
  +-- npm prune --omit=dev  (removes devDependencies)
  |
  +-- node server.js  (Express serves frontend + handles PDF/CSV API)
```

### Why this Docker setup (not buildpacks)

Google Cloud Buildpacks do not have a supported mechanism for installing Chrome's system libraries. Puppeteer requires a real Chrome binary plus ~20 system packages. The Dockerfile installs Chrome from Google's official apt repository, which handles all dependencies automatically and is proven reliable on Cloud Run.

### Configuration in `deploy.ps1`

| Variable | Default | Change if... |
|---|---|---|
| `PROJECT_ID` | `vds-area-calculator` | GCP project is renamed |
| `REGION` | `asia-south1` (Mumbai) | Different region needed |
| `SERVICE_NAME` | `area-calculator` | Different Cloud Run service name needed |
| `--memory` | `1Gi` | PDF generation crashes — increase to `2Gi` |

---

## Environment Variables

| Variable | Set by | Description |
|---|---|---|
| `PORT` | Cloud Run (auto) | Express listen port — Cloud Run injects `8080` |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Dockerfile | Skips Puppeteer's bundled Chromium download; uses installed Chrome instead |
| `PUPPETEER_EXECUTABLE_PATH` | Dockerfile | Points Puppeteer to `/usr/bin/google-chrome-stable` |

No `.env` file needed.

---

## Design System

The UI matches [vdsadvisory.com](https://www.vdsadvisory.com):

| Token | Value |
|---|---|
| Dark / navbar | `#020617` |
| Cyan accent | `#38bdf8` |
| Page background | `#f5f7fb` |
| Font | `"Segoe UI", system-ui, sans-serif` |
