# Status Page Project

This project implements a status page that displays the current and historical uptime for various monitored services, and a separate page to display incident history fetched from GitHub Issues. The frontend is designed to be hosted on GitHub Pages (or another static hosting provider), and the backend is a Node.js proxy server designed to be run with Docker and an Nginx reverse proxy.

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
│   │   ├── nginx.conf      # Nginx configuration for reverse proxy and SSL
│   │   └── ssl/            # Directory for SSL certificates (e.g., selfsigned.crt, selfsigned.key)
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
*   **Nginx Reverse Proxy:**
    *   Handles incoming HTTPS requests.
    *   Provides SSL termination.
    *   Redirects HTTP to HTTPS.
    *   Serves the backend application.

## Domain Setup (Example)

*   **Frontend Hostname:** `status.stakecraft.com` (Served by GitHub Pages)
*   **Backend API Hostname:** `api.status.stakecraft.com` (Served by your server running Docker with Nginx)

## Setup and Running

### Prerequisites

*   **Git:** For version control.
*   **Node.js & npm:** For the backend proxy server (primarily for `npm install` within Docker build).
*   **Docker & Docker Compose:** For running the backend services (Node.js proxy and Nginx).
*   **OpenSSL (or similar):** To generate self-signed SSL certificates for local development/testing (or use CA-issued certs for production).

### 1. Backend Setup (Docker with Nginx)

The backend consists of your Node.js proxy application and an Nginx server acting as a reverse proxy.

1.  **Navigate to the `backend` directory:**
    ```bash
    cd backend
    ```

2.  **Configure Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit `backend/.env` and set the following variables:
        *   `PROXY_PORT`: The port the Node.js application will listen on (default is `3000`). Nginx will proxy to this.
        *   `ACTUAL_PROMETHEUS_URL`: The full URL of your actual Prometheus instance (e.g., `http://your-prometheus-ip:9090`).
        *   `NODE_ENV`: Set to `production` for deployment.
        *   `GITHUB_TOKEN`: A GitHub Personal Access Token with `repo` scope (or fine-grained access to the issues repository) to fetch incidents. **Keep this secret.**
        *   `GITHUB_REPO_OWNER`: The owner of the GitHub repository where incidents are tracked (e.g., `Stakecraft`).
        *   `GITHUB_REPO_NAME`: The name of the GitHub repository (e.g., `status-page`).
        *   `GITHUB_INCIDENT_LABEL`: The label used to identify incident issues in the GitHub repository (e.g., `incident`).

3.  **SSL Certificates for Nginx:**
    *   The Nginx configuration (`backend/nginx/nginx.conf`) is set up for HTTPS.
    *   **For Production:** Obtain SSL certificates for `api.status.stakecraft.com` from a Certificate Authority (e.g., Let's Encrypt). Place your certificate and private key (e.g., `fullchain.pem` and `privkey.pem`) into the `backend/nginx/ssl/` directory. You will need to update the `ssl_certificate` and `ssl_certificate_key` directives in `backend/nginx/nginx.conf` to point to your actual certificate files.
    *   **For Local Development/Testing (Self-Signed):**
        *   Ensure the `backend/nginx/ssl/` directory exists.
        *   Generate self-signed certificates. Run this command from the project root (or adjust paths accordingly):
            ```bash
            openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout backend/nginx/ssl/selfsigned.key -out backend/nginx/ssl/selfsigned.crt
            ```
            When prompted for "Common Name (e.g. server FQDN or YOUR name)", enter `api.status.stakecraft.com` (or `localhost` if testing Nginx directly on localhost before DNS setup).
        *   The `backend/nginx/nginx.conf` is pre-configured to use `selfsigned.crt` and `selfsigned.key`.

4.  **Configure Nginx:**
    *   Open `backend/nginx/nginx.conf`.
    *   Ensure `server_name` directives are set to `api.status.stakecraft.com`.

5.  **Build and Run with Docker Compose:**
    *   From the `backend` directory, run:
        ```bash
        docker-compose up --build -d
        ```
        *   `--build`: Builds the Node.js application image if it doesn't exist or if `Dockerfile` or related files changed.
        *   `-d`: Runs the containers in detached mode (in the background).
    *   To view logs: `docker-compose logs -f`
    *   To stop: `docker-compose down`

6.  **DNS for Backend:**
    *   Configure a DNS 'A' record for `api.status.stakecraft.com` to point to the public IP address of the server where you are running Docker Compose.

7.  **Firewall:**
    *   Ensure your server's firewall allows incoming connections on ports `80` (for HTTP to HTTPS redirect) and `443` (for HTTPS).

### 2. Frontend Setup (GitHub Pages)

1.  **Configure API Endpoint:**
    *   Edit `docs/config.js`.
    *   Set the `API_BASE_URL` to your backend API endpoint. This is used for fetching both service statuses and incidents.
        ```javascript
        const API_BASE_URL = 'https://api.status.stakecraft.com'; // Or http://localhost:3000 for local dev
        ```

2.  **Deploy to GitHub Pages:**
    *   Create a new repository on GitHub.
    *   Push your project code (including the `docs` directory) to the repository.
    *   In your GitHub repository settings, go to the "Pages" section.
    *   Choose the branch you want to deploy from (e.g., `main`).
    *   Select the `/docs` folder as the source for GitHub Pages.
    *   Save the changes.

3.  **Custom Domain for Frontend (status.stakecraft.com):**
    *   In your GitHub Pages settings, add `status.stakecraft.com` as your custom domain.
    *   Follow GitHub's instructions for configuring your DNS provider. This usually involves adding a CNAME record for `status.stakecraft.com` pointing to `your-github-username.github.io.` (or specific A records if preferred).
    *   Ensure "Enforce HTTPS" is checked in GitHub Pages settings once your custom domain is active.

### 3. CORS Configuration (Verification)

*   The backend proxy (`backend/proxy-server.js`) is configured with CORS options:
    ```javascript
    const corsOptions = {
      origin: 'https://status.stakecraft.com'
    };
    app.use(cors(corsOptions));
    ```
    This ensures that only requests from your frontend domain (`https://status.stakecraft.com`) can access the backend API.

## Development Notes

*   **Backend Changes:** If you change `backend/proxy-server.js` or `backend/proxy-services-config.yaml` (and `proxy-services-config.yaml` is mounted as a volume in `docker-compose.yml`), you might only need to restart the `app` container: `docker-compose restart app`. If you change `package.json` or `Dockerfile`, you'll need to rebuild the image: `docker-compose up --build -d app`.
*   **Frontend Changes:** If you're testing the frontend locally and it's making requests to a deployed backend, ensure your backend's CORS policy temporarily allows your local development origin or use a browser extension to bypass CORS for local dev only. After deploying frontend changes to GitHub Pages, changes should reflect after the GitHub Pages build process.

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
*   **`backend/nginx/nginx.conf`**: Nginx configuration for handling SSL, redirecting HTTP to HTTPS, and reverse proxying to the Node.js app.
*   **`backend/.env`**: Stores environment-specific configuration for the backend (e.g., Prometheus URL, port, GitHub details). **Crucially, this file is NOT committed to Git.**
*   **`.github/ISSUE_TEMPLATE.md`**: The default GitHub issue template, tailored for reporting incidents.
*   **`.gitignore`**: Tells Git which files/directories to ignore (e.g., `node_modules/`, `.env`).

This summary should help anyone (including your future self) understand and manage the project. 