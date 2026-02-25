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

echo "[1/8] Instalando dependencias del sistema"
sudo apt-get update
sudo apt-get install -y \
  apt-transport-https \
  ca-certificates \
  curl \
  debian-archive-keyring \
  debian-keyring \
  gpg \
  rsync \
  git \
  build-essential

echo "[2/8] Instalando Node.js 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "[3/8] Instalando Caddy"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy

echo "[4/8] Creando usuario de aplicacion y directorios"
sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin viento 2>/dev/null || true
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude '.git/' "$REPO_DIR/" "$APP_DIR/"
sudo chown -R viento:viento "$APP_DIR"

echo "[5/8] Instalando dependencias del backend"
cd "$APP_DIR/backend"
sudo -u viento npm ci --omit=dev

echo "[6/8] Instalando archivo de entorno"
sudo mkdir -p /etc/viento
if [[ ! -f /etc/viento/backend.env ]]; then
  sudo cp "$APP_DIR/backend/.env.example" /etc/viento/backend.env
fi

echo "[7/8] Instalando servicio de systemd"
sudo sed "s|__APP_DIR__|$APP_DIR|g" \
  "$APP_DIR/infra/gcp/viento-backend.service" \
  | sudo tee /etc/systemd/system/viento-backend.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now viento-backend

echo "[8/8] Siguientes acciones"
echo "- Edita /etc/viento/backend.env (define CORS_ORIGINS y STATION_NAMES si hace falta)."
echo "- Configura Caddy usando infra/gcp/Caddyfile.example y recarga Caddy."
echo "- Revisa el servicio: sudo systemctl status viento-backend"
echo "- Revisa la salud: curl -sS http://127.0.0.1:8080/health | jq"
