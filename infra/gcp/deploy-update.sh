#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -eq 0 ]]; then
  echo "Ejecuta este script como usuario normal con acceso sudo (no como root)."
  exit 1
fi

REPO_DIR=${1:-"$PWD"}
APP_DIR=${APP_DIR:-/opt/viento}

if [[ ! -f "$REPO_DIR/backend/package.json" ]]; then
  echo "No se encontro backend/package.json en: $REPO_DIR"
  exit 1
fi

sudo rsync -a --delete --exclude '.git/' "$REPO_DIR/" "$APP_DIR/"
sudo chown -R viento:viento "$APP_DIR"

cd "$APP_DIR/backend"
sudo -u viento npm ci --omit=dev

sudo systemctl restart viento-backend
sudo systemctl status viento-backend --no-pager

echo "Actualizacion de despliegue completada."
