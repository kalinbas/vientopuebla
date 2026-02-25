# Panel Viento Puebla

Configuracion completa para:
- `frontend/`: panel estatico alojado en GitHub Pages.
- `backend/`: API en Node.js + recolector cada 5 segundos + base SQLite, alojado en una VM `e2-micro` de Google Cloud.

## Arquitectura

1. El recolector consulta `https://viento.saboresgaleazzi.com/api_viento_ultimos.php` cada 5 segundos.
2. Los datos se guardan en SQLite (`backend/data/wind.sqlite3`) con deduplicacion por `id` de origen.
3. La API expone endpoints de ultimo dato, historial, estadisticas y rosa de vientos.
4. El frontend en GitHub Pages consume la API por HTTPS.

## API del Servidor

- `GET /health`
- `GET /api/stations`
- `GET /api/latest?station_id=2`
- `GET /api/history?station_id=2&range=6h&bucket_minutes=5`
- `GET /api/stats?station_id=2&windows=1m,5m,15m,24h`
- `GET /api/wind-rose?station_id=2&range=24h&bins=16`

`range` soporta valores como `1h`, `6h`, `24h`, `7d`.

## Ejecucion Local

### 1) Iniciar backend

```bash
cd backend
cp .env.example .env
npm install
npm run start
```

El backend quedara disponible en `http://127.0.0.1:8080`.

### 2) Iniciar frontend local

```bash
cd frontend
python3 -m http.server 4173
```

Abrir:
- `http://127.0.0.1:4173/?api=http://127.0.0.1:8080`

Tambien puedes definir la API base en el campo de texto de la pagina.

## Desplegar Servidor en VM Free Tier de GCP

Este proyecto incluye scripts para VMs Ubuntu.

### 1) Crear VM

Usa una VM `e2-micro` en una region de USA elegible para free tier (`us-central1`, `us-east1`, `us-west1`).

### 2) Habilitar trafico entrante

Abre los puertos TCP `22`, `80` y `443` en las reglas de firewall de la VM.

### 3) Ejecutar script de bootstrap en la VM

```bash
# Despues de clonar o copiar este repo en la VM
cd /path/to/repo
./infra/gcp/bootstrap-vm.sh
```

Este script instala:
- Node.js 20
- Caddy
- servicio systemd (`viento-backend`)

Tambien despliega archivos de la app en `/opt/viento`.

### 4) Configurar entorno del backend

```bash
sudo nano /etc/viento/backend.env
sudo systemctl restart viento-backend
```

Como minimo define:
- `CORS_ORIGINS=https://<tu-dominio-github-pages>`
- `STATION_NAMES=1:Chipilo,2:San Bernardino` (o tus etiquetas)

### 5) Configurar proxy HTTPS (Caddy)

Apunta un registro DNS tipo A (por ejemplo `api.wind.example.com`) a la IP publica de la VM.

Luego ejecuta:

```bash
./infra/gcp/configure-caddy.sh api.wind.example.com
```

Verifica:

```bash
curl -sS https://api.wind.example.com/health | jq
```

### 6) Actualizar despliegue despues

```bash
./infra/gcp/deploy-update.sh
```

## Desplegar Frontend en GitHub Pages

El workflow incluido esta en:
- `.github/workflows/deploy-pages.yml`

### Pasos

1. Sube este repo a GitHub.
2. En la configuracion del repo, habilita Pages con origen "GitHub Actions".
3. Define la API base del frontend:
   - Edita `frontend/config.js` y ajusta `API_BASE` a tu dominio API, por ejemplo `https://api.wind.example.com`.
4. Haz push a `main`; el workflow despliega automaticamente.

## Verificaciones Operativas

```bash
# Servicio del servidor
sudo systemctl status viento-backend

# Logs en vivo
sudo journalctl -u viento-backend -f

# Salud de la API
curl -sS http://127.0.0.1:8080/health | jq
curl -sS https://api.wind.example.com/health | jq
```

## Notas

- El intervalo del recolector se controla con `COLLECT_INTERVAL_SECONDS` (por defecto `5`).
- SQLite es simple y eficiente para este caso.
- Si el trafico crece, puedes migrar a Postgres sin cambiar el comportamiento del frontend.
