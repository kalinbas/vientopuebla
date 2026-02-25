# Panel Viento Puebla (Sin Servidor)

Este proyecto funciona 100% en frontend.

- No usa backend propio.
- No usa base de datos en servidor.
- Consulta directamente `https://viento.saboresgaleazzi.com/api_viento_ultimos.php` desde el navegador.
- Hace refresh cada 5 segundos.
- Acumula datos en memoria mientras la pagina esta abierta.

## Como Funciona

1. Al abrir la pagina, carga historial inicial por estacion con:
   - `api_viento_ultimos.php?limit=180&estacion=<id>`
2. Luego consulta cada 5 segundos:
   - `api_viento_ultimos.php`
3. Une datos sin duplicados por `id` y actualiza:
   - KPIs
   - Graficas
   - Rosa de vientos
   - Tabla de historial

Nota: al cerrar o recargar la pagina, la memoria se reinicia.

## Configuracion

Archivo: `frontend/config.js`

- `SOURCE_API_URL`: endpoint base de la API.
- `INITIAL_HISTORY_LIMIT`: historial inicial por estacion (default 180).
- `POLL_INTERVAL_MS`: intervalo de polling (default 5000 ms).
- `STALE_AFTER_SECONDS`: umbral para marcar dato desactualizado.
- `DEFAULT_STATIONS`: nombres por defecto para estaciones.

## Ejecutar Local

```bash
cd frontend
python3 -m http.server 4173
```

Abrir en navegador:
- `http://127.0.0.1:4173`

## Despliegue en GitHub Pages

Workflow incluido en:
- `.github/workflows/deploy-pages.yml`

Pasos:

1. Hacer push a `main`.
2. En GitHub, habilitar Pages con origen "GitHub Actions".
3. Esperar el workflow de despliegue.

## Limitaciones

- Los datos historicos se guardan solo mientras la pagina esta abierta.
- Si la API de origen no responde, el panel muestra error API hasta recuperar conexion.
