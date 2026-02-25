#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <dominio-api>"
  exit 1
fi

DOMAIN=$1

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOT
${DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
EOT

sudo systemctl reload caddy
sudo systemctl status caddy --no-pager

echo "Caddy configurado para ${DOMAIN}."
echo "Prueba con: curl -I https://${DOMAIN}/health"
