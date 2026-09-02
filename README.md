# PueblaWind — Holfuy-style weather page for Chalchihuapan / Chipilo

A static webpage (plain HTML/CSS/JS, no backend, no build step) that replicates the look of a
[Holfuy station page](https://holfuy.com/en/weather/609) using the public JSON APIs behind
[viento.saboresgaleazzi.com](https://viento.saboresgaleazzi.com/) (two wind stations near
Puebla, MX, plus one shared meteo sensor).

## Live

- GitHub Pages: [https://kalinbas.github.io/vientopuebla/](https://kalinbas.github.io/vientopuebla/)

## Features

- Live widget polling every 5 s: canvas wind dial (port of Holfuy's `wind_kok.js`), wind
  now/gust, 15-min average, tendency, daily wind, temperature, humidity, dew point, cloud base
  (AMSL), sea-level-reduced pressure, battery.
- Station switcher: `#chalchihuapan` (default) / `#chipilo` (estación 2 / 1).
- Averages tables: today in 30-min columns, previous days hourly, colored with Holfuy's exact
  value→color formulas (extracted from their `main.js`).
- Dygraphs with Holfuy's configuration: wind speed/gust/min (6 days of 30-min buckets), wind
  direction dots, temperature & dew point, humidity, pressure, battery; zoom buttons
  3h/6h/12h/1d/5d with synchronized zoom.
- About / Dir.Stat. (16-sector wind rose of the last 15 min) / LoRa (raw telemetry log) tabs.
- Fast loads: two-phase boot (live widget paints first, history follows), completed days'
  historial responses cached in localStorage (only today is refetched), LoRa log loaded lazily
  when its tab opens, deferred scripts and preconnect hints for the API/CDN origins.
- Sunrise/sunset via NOAA formula; all times shown as America/Mexico_City wall clock.

## Data sources (`frontend/js/config.js` → `apiBase`)

| Endpoint | Use |
|---|---|
| `api_viento_ultimos.php?limit=200&estacion=N` | raw ~5 s wind samples (recent window only) |
| `api_meteo_ultimos.php?limit=500` | temp/humidity/pressure/battery/dew point/cloud base (~last hours) |
| `api_historial_climatico.php?fecha=YYYY-MM-DD&estacion=N` | 48×30-min wind aggregates per day (tables + graphs) |
| `api_mensajes_lora.php?limit=30` | raw LoRa message log |

## Run locally

```bash
cd frontend
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`. The data APIs send `Access-Control-Allow-Origin: *`, so the page
also works straight from `file://`. The only external dependency is dygraphs 2.2.1 via jsdelivr
CDN (the same charting library Holfuy uses).

## Deploy

Pushing to `main` triggers `.github/workflows/deploy-pages.yml`, which publishes the
`frontend/` folder to GitHub Pages.

## Config

Everything tweakable lives in `frontend/js/config.js`: station names/coords/altitude, poll
intervals, graph day span, and optional flyable-direction sectors, e.g.

```js
sectors: { takeoff: [{ from: 340, to: 40 }], optimal: [{ from: 350, to: 20 }] }
```

which draws the yellow/green wedges on the dial and bands on the direction graph, like Holfuy
shows for El Peñón.
