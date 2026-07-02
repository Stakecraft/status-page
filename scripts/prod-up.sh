#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
cd "$BACKEND"

if [ ! -f ../config/services.yaml ]; then
  echo "config/services.yaml not found — copy from config/services.yaml.example and configure it"
  exit 1
fi

if [ ! -f .env ]; then
  echo "backend/.env not found — copying from .env.example"
  cp .env.example .env
  echo "Edit backend/.env before production use (Prometheus URL, GitHub token, etc.)"
fi

if [ ! -f nginx/ssl/fullchain.pem ] || [ ! -f nginx/ssl/privkey.pem ]; then
  echo "Missing TLS certs in backend/nginx/ssl/"
  echo "See backend/nginx/ssl/README.md"
  exit 1
fi

export SERVICES_CONFIG="${SERVICES_CONFIG:-../config/services.yaml}"

echo "Building and starting production API stack..."
docker compose up --build -d

echo
echo "Waiting for API health check..."
for i in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "API is healthy"
    break
  fi
  sleep 1
done

echo
echo "API (via Nginx): https://api.status.stakecraft.com"
echo "View logs:       cd backend && docker compose logs -f"
echo "Stop:            cd backend && docker compose down"
