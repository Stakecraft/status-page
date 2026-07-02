# Status Page Project

This project implements a status page that displays the current and historical uptime for various monitored services, and a separate page to display incident history fetched from GitHub Issues. The frontend is static (`docs/`) and the backend is a Node.js API that queries Prometheus.

**Production:** frontend on **Cloudflare Pages** (`status.stakecraft.com`), API on **bare metal with Docker Compose** (`api.status.stakecraft.com`). See [deploy/README.md](deploy/README.md).

> **v2 Implementation:** Branch `proposal/status-page-v2-grafana` implements the Grafana-centric architecture. See [docs/proposals/STATUS_PAGE_V2.md](docs/proposals/STATUS_PAGE_V2.md) for the design doc.

## API v2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/rss` | RSS feed (status summary + incidents) |
| `GET` | `/api/v2/config` | Service list grouped by category |
| `GET` | `/api/v2/status` | Batch status for all services |
| `GET` | `/api/v2/history?range=7d\|30d\|90d` | Batch history for all services |
| `GET` | `/api/v2/history/:id?range=...` | History for a single service |

Legacy v1 endpoints (`/api/status/:serviceId`, `/api/history/:serviceId`) remain available when `proxy-services-config.yaml` is present.

### v2 Configuration

1. Copy `config/services.yaml.example` to `config/services.yaml`
2. Set each service's `health.prometheus_job` to match your Prometheus job labels
3. Set `API_V2_ENABLED=true` in `backend/.env`
4. Once recording rules are deployed, set `USE_RECORDING_RULES=true`

The frontend uses v2 by default (`USE_API_V2 = true` in `docs/config.js`).

## Local Development (Docker Compose)

Run the full stack (API + frontend) with one command:

```bash
./scripts/dev-up.sh
```

Or manually:

```bash
docker compose up --build -d
./scripts/test-api.sh
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| API | http://localhost:3333 |

Useful commands:

```bash
docker compose logs -f          # tail logs
docker compose down             # stop
docker compose up --build -d    # rebuild after code changes
```

**Config:** `config/services.yaml` is mounted into the API container. Copy from `config/services.yaml.example` if missing.

**Production:** see [deploy/README.md](deploy/README.md) for Cloudflare Pages + bare-metal Docker Compose.

## Project Structure

```
.
├── docs/
│   ├── index.html          # Main HTML file for the status page
│   ├── incident-history.html # HTML file for the incident history page
│   ├── style.css           # CSS styles (shared by both pages)
│   ├── script.js           # Frontend JavaScript logic for main status page
│   └── config.js           # Frontend configuration (service definitions, API base URL)
├── backend/
│   ├── proxy-server.js     # Node.js/Express backend proxy (serves service status and GitHub incidents)
│   ├── proxy-services-config.yaml # Detailed service configuration for the proxy (metrics, job labels)
│   ├── package.json        # Backend Node.js dependencies
│   ├── Dockerfile          # Dockerfile for building the backend Node.js app image
│   ├── docker-compose.yml  # Docker Compose file to run backend app and Nginx
│   ├── nginx/
│   │   ├── nginx.conf      # Nginx configuration for reverse proxy
│   ├── .env.example        # Example environment variables for the backend
│   └── .env                # Actual environment variables for the backend (ignored by Git)
├── .github/
│   └── ISSUE_TEMPLATE.md   # GitHub issue template for reporting incidents
├── .gitignore              # Specifies intentionally untracked files that Git should ignore
└── README.md               # This file
```

## Features

*   **Dynamic Service Status:** Fetches current status and historical uptime data from a Prometheus instance via a backend proxy.
*   **Configurable Services:** Services are defined in `docs/config.js` (for display) and `backend/proxy-services-config.yaml` (for Prometheus query details).
*   **Uptime Visualization:** Displays uptime data as a series of daily bars, colored green (operational), yellow (degraded), or red (outage).
*   **Tooltips:** Provides detailed uptime information on hover.
*   **Time Range Selection:** Allows viewing uptime data for 7, 15, or 30 days.
*   **Incident History Page:** Displays past incidents fetched from GitHub Issues (`/docs/incident-history.html`).
    *   Incidents are styled with severity and status badges.
    *   Incident descriptions support markdown and have a "Read more/less" functionality.
*   **GitHub Issue Template:** Provides a standardized format for reporting incidents via GitHub Issues (`.github/ISSUE_TEMPLATE.md`).
*   **Secure Backend Proxy:**
    *   Hides the direct Prometheus URL from the client.
    *   Backend queries specific metrics to avoid exposing all Prometheus data.
    *   Fetches specific GitHub issues based on repository and label, using a GitHub token.
    *   Configured with CORS to only allow requests from the specified frontend domain.
*   **Dockerized Backend:** The backend proxy and Nginx are containerized using Docker and Docker Compose for easier deployment and management.
*   **Nginx Reverse Proxy:** Proxies HTTP on port 80 to the Node.js app (TLS terminated by Cloudflare).

## Production Deployment

| Component | URL | Platform |
|-----------|-----|----------|
| Frontend | `https://status.stakecraft.com` | Cloudflare Pages (`docs/`, no build step) |
| API | `https://api.status.stakecraft.com` | Bare metal — `backend/docker-compose.yml` (app + Nginx) |

Full step-by-step instructions: **[deploy/README.md](deploy/README.md)**

Quick checklist:

1. **Cloudflare Pages** — connect Git, output dir `docs`, custom domain `status.stakecraft.com`
2. **Server** — clone repo, configure `config/services.yaml` and `backend/.env`
3. **Cloudflare API DNS** — proxied record for `api.status.stakecraft.com`, SSL mode Flexible or Full
4. **Start API** — `./scripts/prod-up.sh` or `cd backend && docker compose up --build -d`
5. **systemd (optional)** — `sudo ./deploy/systemd/install.sh`

GitHub Actions (optional): set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for Pages deploy.

## Setup and Running (Local)

### Prerequisites

*   **Git:** For version control.
*   **Node.js & npm:** For the backend proxy server (primarily for `npm install` within Docker build).
*   **Docker & Docker Compose:** For running the backend services (Node.js proxy and Nginx).

### Backend (local)

1. Copy `backend/.env.example` to `backend/.env` and set `ACTUAL_PROMETHEUS_URL`, `GITHUB_TOKEN`, etc.
2. Copy `config/services.yaml.example` to `config/services.yaml` and configure your services.
3. Run `docker compose up --build -d` from the repo root (see [Local Development](#local-development-docker-compose) above).

Production API runs on bare metal via Docker Compose — see [deploy/README.md](deploy/README.md).

### Frontend (local)

Open `http://localhost:8080` via Docker Compose. `docs/config.js` automatically uses `http://localhost:3333` when served from localhost.

Production frontend is deployed from `docs/` to Cloudflare Pages — no build step required.

### CORS Configuration (Verification)

*   The backend proxy (`backend/proxy-server.js`) is configured with CORS options:
    ```javascript
    const corsOptions = {
      origin: 'https://status.stakecraft.com'
    };
    app.use(cors(corsOptions));
    ```
    This ensures that only requests from your frontend domain (`https://status.stakecraft.com`) can access the backend API.

## Development Notes

*   **Backend Changes:** If you change `backend/proxy-server.js`, restart the API container (`docker compose restart api`). Rebuild after `package.json` or `Dockerfile` changes: `docker compose up --build -d api`. Update `config/services.yaml` and restart the API to pick up service config changes.
*   **Frontend Changes:** Push to `main` to redeploy Cloudflare Pages (or wait for the GitHub Action). For local testing against a deployed API, temporarily allow your dev origin in `CORS_ORIGIN` on the backend.

## Key File Summary

*   **`docs/index.html`**: The main page structure for service statuses.
*   **`docs/incident-history.html`**: The page structure for displaying incident history.
*   **`docs/style.css`**: All visual styling for both pages.
*   **`docs/script.js`**: Core frontend logic for the main status page, data fetching, UI updates.
*   **`docs/config.js`**: Defines services shown on the page and the `API_BASE_URL` for all backend calls.
*   **`backend/proxy-server.js`**: Node.js application that proxies requests to Prometheus and fetches incidents from GitHub.
*   **`backend/proxy-services-config.yaml`**: Defines the specific Prometheus metrics, job labels, and healthy values for each service the proxy can query.
*   **`backend/Dockerfile`**: Instructions to build the Node.js proxy application into a Docker image.
*   **`backend/docker-compose.yml`**: Defines how to run the `app` (Node.js proxy) and `nginx` services together.
*   **`backend/nginx/nginx.conf`**: Nginx configuration for reverse proxying to the Node.js app.
*   **`backend/.env`**: Stores environment-specific configuration for the backend (e.g., Prometheus URL, port, GitHub details). **Crucially, this file is NOT committed to Git.**
*   **`.github/ISSUE_TEMPLATE.md`**: The default GitHub issue template, tailored for reporting incidents.
*   **`.gitignore`**: Tells Git which files/directories to ignore (e.g., `node_modules/`, `.env`).

This summary should help anyone (including your future self) understand and manage the project. 