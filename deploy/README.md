# Deployment Guide

| Component | Host | Platform |
|-----------|------|----------|
| Frontend | `https://status.stakecraft.com` | Cloudflare Pages |
| API | `https://api.status.stakecraft.com` | Bare metal (Docker Compose) |

The frontend is static (`docs/`). The API runs as two containers: Node.js app + Nginx on host port **8088**. **HTTPS is terminated by Cloudflare** in front of the origin.

---

## 1. Cloudflare Pages (frontend)

### Connect Git (recommended)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Select this repository, branch `main`
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `docs`
4. Deploy

### Custom domain

1. Pages project → **Custom domains** → add `status.stakecraft.com`
2. Add the DNS record Cloudflare shows (usually CNAME to `<project>.pages.dev`)
3. Enable **Full (strict)** SSL

### Manual deploy (Wrangler)

```bash
npx wrangler pages deploy docs --project-name=stakecraft-status-page
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Production frontend calls `https://api.status.stakecraft.com` (configured in `docs/config.js`).

---

## 2. Bare metal API (Docker Compose)

Manifests: `backend/docker-compose.yml` (app + nginx).

### Server prerequisites

- Docker and Docker Compose
- Port **8088** open on the firewall (443 handled by Cloudflare)
- DNS **proxied** A/CNAME for `api.status.stakecraft.com` → server IP (orange cloud in Cloudflare)
- Cloudflare SSL mode **Flexible** or **Full** for the API subdomain (origin serves HTTP on port **8088**)
- Prometheus reachable from the server (private network; do not expose publicly)

### One-time setup on the server

```bash
git clone https://github.com/Stakecraft/status-page.git
cd status-page

cp config/services.yaml.example config/services.yaml
# edit config/services.yaml with your services

cp backend/.env.example backend/.env
# edit backend/.env — ACTUAL_PROMETHEUS_URL, GITHUB_TOKEN, CORS_ORIGIN, etc.
```

### Start / update

From the repo root:

```bash
./scripts/prod-up.sh
```

Or manually:

```bash
cd backend
docker compose up --build -d
```

After code or config changes:

```bash
cd backend
docker compose up --build -d          # code changes
docker compose restart app            # services.yaml or .env only
```

### Verify

```bash
curl -s https://api.status.stakecraft.com/api/health
docker compose -f backend/docker-compose.yml logs -f
```

### Environment checklist

| Variable | Production value |
|----------|------------------|
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://status.stakecraft.com` |
| `STATUS_PAGE_URL` | `https://status.stakecraft.com` |
| `ACTUAL_PROMETHEUS_URL` | Prometheus URL reachable from the server |

The app container listens on port 3333 **inside Docker only**. Nginx listens on host port **8088** — do not publish port 3333 on the host (rate limiting relies on nginx setting `X-Forwarded-For`).

**Cloudflare note:** By default Cloudflare connects to origin ports 80/443. If the API subdomain is proxied through Cloudflare, set an **Origin Rule** or DNS configuration so traffic reaches port **8088**, or expose the API directly (grey cloud) on `http://your-server:8088`.

### systemd (start on boot)

Install the unit so the stack starts automatically after reboot:

```bash
# Clone to /opt/status-page (recommended), or set REPO_DIR
sudo git clone https://github.com/Stakecraft/status-page.git /opt/status-page

# Complete one-time setup (config, .env) — see above

sudo chmod +x /opt/status-page/deploy/systemd/install.sh
sudo /opt/status-page/deploy/systemd/install.sh

sudo systemctl start status-page-api
sudo systemctl status status-page-api
```

Custom install path:

```bash
sudo REPO_DIR=/home/deploy/status-page ./deploy/systemd/install.sh
```

**Day-to-day commands:**

| Action | Command |
|--------|---------|
| Start | `sudo systemctl start status-page-api` |
| Stop | `sudo systemctl stop status-page-api` |
| Restart (rebuild) | `sudo systemctl restart status-page-api` |
| Reload after `git pull` | `cd /opt/status-page && git pull && sudo systemctl reload status-page-api` |
| Unit logs | `journalctl -u status-page-api -f` |
| Container logs | `cd /opt/status-page/backend && docker compose logs -f` |

Optional: copy `deploy/systemd/status-page-api.env.example` to `/etc/default/status-page-api` and uncomment `EnvironmentFile` in the unit if you need a non-default `SERVICES_CONFIG` path.

---

## 3. Architecture

```
Browser → status.stakecraft.com (Cloudflare Pages, static docs/)
       → api.status.stakecraft.com (Cloudflare HTTPS → origin Nginx :8088 → app :3333)
       → Prometheus (internal)
```

---

## 4. Optional: Kubernetes

Manifests in `deploy/k8s/` are kept for a future move to k8s. Not used for the current bare-metal deployment.
