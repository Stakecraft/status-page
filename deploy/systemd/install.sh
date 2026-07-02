#!/usr/bin/env bash
set -euo pipefail

# Install the status-page-api systemd unit.
#
# Usage:
#   sudo ./deploy/systemd/install.sh
#   sudo REPO_DIR=/home/deploy/status-page ./deploy/systemd/install.sh

REPO_DIR="${REPO_DIR:-/opt/status-page}"
UNIT_NAME="status-page-api.service"
SRC="$(cd "$(dirname "$0")" && pwd)/status-page-api.service"
DEST="/etc/systemd/system/${UNIT_NAME}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

if [ ! -f "${REPO_DIR}/backend/docker-compose.yml" ]; then
  echo "Repo not found at ${REPO_DIR}/backend/docker-compose.yml"
  echo "Clone the repo first or set REPO_DIR=/path/to/status-page"
  exit 1
fi

sed "s|WorkingDirectory=/opt/status-page/backend|WorkingDirectory=${REPO_DIR}/backend|" \
  "$SRC" > "$DEST"

systemctl daemon-reload
systemctl enable --now "$UNIT_NAME"

echo "Installed ${DEST} (enabled and started)"
echo
echo "Status:  systemctl status ${UNIT_NAME}"
echo "Logs:    journalctl -u ${UNIT_NAME} -f"
echo "         cd ${REPO_DIR}/backend && docker compose logs -f"
