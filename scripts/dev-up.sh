#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f config/services.yaml ]; then
  echo "config/services.yaml not found — copying from example"
  cp config/services.yaml.example config/services.yaml
fi

if [ ! -f backend/.env ]; then
  echo "backend/.env not found — copying from example"
  cp backend/.env.example backend/.env
fi

export SERVICES_CONFIG="${SERVICES_CONFIG:-./config/services.yaml}"

echo "Building and starting containers..."
docker compose up --build -d

echo
echo "Waiting for API health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "API is healthy"
    break
  fi
  sleep 1
done

echo
echo "Frontend: http://localhost:8080"
echo "API:      http://localhost:3000"
echo
echo "Run tests:  ./scripts/test-api.sh"
echo "View logs:  docker compose logs -f"
echo "Stop:       docker compose down"
