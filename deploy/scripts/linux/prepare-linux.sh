#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
WEB_ROOT="/var/www/futurepred/frontend/dist"
INSTALL_ROOT="/opt/futurepred"
SERVICE_NAME="futurepred-backend.service"
SYSTEMD_TARGET="/etc/systemd/system/$SERVICE_NAME"
NGINX_TARGET="/etc/nginx/conf.d/futurepred.conf"

echo "[1/7] Build frontend"
cd "$FRONTEND_DIR"
npm ci
npm run build

echo "[2/7] Prepare web root"
sudo mkdir -p "$WEB_ROOT"
sudo rm -rf "$WEB_ROOT"/*
sudo cp -r "$FRONTEND_DIR/dist/"* "$WEB_ROOT/"

echo "[3/7] Sync project to $INSTALL_ROOT"
sudo mkdir -p "$INSTALL_ROOT"
sudo rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'release' \
  --exclude 'frontend/dist' \
  "$ROOT_DIR/" "$INSTALL_ROOT/"

echo "[4/7] Create backend venv and install requirements"
cd "$INSTALL_ROOT/backend"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo "[5/7] Ensure backend .env exists"
if [[ ! -f "$INSTALL_ROOT/backend/.env" ]]; then
  cp "$INSTALL_ROOT/backend/.env.example" "$INSTALL_ROOT/backend/.env"
  echo "Created $INSTALL_ROOT/backend/.env from template. Please edit secrets before production traffic."
fi

echo "[6/7] Install systemd service"
sudo cp "$INSTALL_ROOT/deploy/systemd/$SERVICE_NAME" "$SYSTEMD_TARGET"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "[7/7] Install and reload Nginx"
sudo cp "$INSTALL_ROOT/deploy/nginx/futurepred.conf" "$NGINX_TARGET"
sudo nginx -t
sudo systemctl restart nginx

echo "Done. Health checks:"
echo "  curl -f http://127.0.0.1:8000/health"
echo "  curl -f http://127.0.0.1/health"
