const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
require("dotenv").config();

function parseStationIds(raw) {
  const ids = String(raw || "1,2")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!ids.length) {
    throw new Error("STATION_IDS debe incluir al menos una estacion");
  }
  return ids;
}

function parseStationNames(raw, stationIds) {
  const names = new Map(stationIds.map((id) => [id, `Estacion ${id}`]));
  for (const part of String(raw || "").split(",")) {
    const token = part.trim();
    if (!token) continue;
    const divider = token.indexOf(":");
    if (divider <= 0) continue;
    const stationText = token.slice(0, divider).trim();
    const name = token.slice(divider + 1).trim();
    const stationId = Number.parseInt(stationText, 10);
    if (!Number.isInteger(stationId) || !name) continue;
    names.set(stationId, name);
  }
  return names;
}

function parseDurationToMs(input) {
  const value = String(input || "").trim().toLowerCase();
  const match = value.match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new Error(`Duracion invalida: ${input}`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  if (unit === "d") return amount * 24 * 60 * 60 * 1000;
  throw new Error(`Unidad de duracion invalida: ${unit}`);
}

function parseTsToMs(ts) {
  return Date.parse(String(ts).replace(" ", "T") + "Z");
}

function formatSourceTs(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function circularMeanDegrees(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return null;
  let x = 0;
  let y = 0;
  for (const deg of numbers) {
    const rad = (deg * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  if (Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8) return null;
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function computeStats(rows) {
  const speeds = rows
    .map((row) => row.speed_kmh)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const directions = rows
    .map((row) => row.direction_deg)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  return {
    count: rows.length,
    avg_speed_kmh: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
    min_speed_kmh: speeds.length ? Math.min(...speeds) : null,
    max_speed_kmh: speeds.length ? Math.max(...speeds) : null,
    avg_direction_deg: circularMeanDegrees(directions),
  };
}

function aggregateRows(rows, bucketMinutes) {
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = new Map();

  for (const row of rows) {
    const tsMs = parseTsToMs(row.measured_at);
    const bucketStart = Math.floor(tsMs / bucketMs) * bucketMs;
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, []);
    }
    buckets.get(bucketStart).push(row);
  }

  const output = [];
  for (const bucketStart of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucketRows = buckets.get(bucketStart);
    const stats = computeStats(bucketRows);
    output.push({
      ts: formatSourceTs(bucketStart),
      avg_speed_kmh: stats.avg_speed_kmh,
      min_speed_kmh: stats.min_speed_kmh,
      max_speed_kmh: stats.max_speed_kmh,
      avg_direction_deg: stats.avg_direction_deg,
      sample_count: bucketRows.length,
    });
  }

  return output;
}

function computeWindRose(rows, bins) {
  const binCount = Math.min(36, Math.max(4, bins));
  const width = 360 / binCount;
  const counts = new Array(binCount).fill(0);
  const speedSums = new Array(binCount).fill(0);

  for (const row of rows) {
    const direction = row.direction_deg;
    if (typeof direction !== "number" || !Number.isFinite(direction)) continue;
    const idx = Math.floor((((direction % 360) + 360) % 360) / width) % binCount;
    counts[idx] += 1;
    if (typeof row.speed_kmh === "number" && Number.isFinite(row.speed_kmh)) {
      speedSums[idx] += row.speed_kmh;
    }
  }

  const labels16 = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];

  return Array.from({ length: binCount }, (_, idx) => {
    const startDeg = idx * width;
    const endDeg = startDeg + width;
    return {
      label: binCount === 16 ? labels16[idx] : `${Math.round(startDeg)}°-${Math.round(endDeg)}°`,
      start_deg: startDeg,
      end_deg: endDeg,
      center_deg: startDeg + width / 2,
      count: counts[idx],
      avg_speed_kmh: counts[idx] ? speedSums[idx] / counts[idx] : null,
    };
  });
}

const settings = {
  host: process.env.HOST || "0.0.0.0",
  port: Number.parseInt(process.env.PORT || "8080", 10),
  sourceApiUrl:
    process.env.SOURCE_API_URL || "https://viento.saboresgaleazzi.com/api_viento_ultimos.php",
  stationIds: parseStationIds(process.env.STATION_IDS || "1,2"),
  collectIntervalMs:
    Math.max(1, Number.parseInt(process.env.COLLECT_INTERVAL_SECONDS || "5", 10)) * 1000,
  backfillLimit: Math.max(10, Number.parseInt(process.env.BACKFILL_LIMIT || "1000", 10)),
  staleAfterSeconds: Math.max(5, Number.parseInt(process.env.STALE_AFTER_SECONDS || "20", 10)),
  dbPath: process.env.DB_PATH || "./data/wind.sqlite3",
  corsOrigins: String(process.env.CORS_ORIGINS || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};
settings.stationNames = parseStationNames(
  process.env.STATION_NAMES || "1:Chipilo,2:San Bernardino",
  settings.stationIds
);

const dbDir = path.dirname(settings.dbPath);
if (dbDir && dbDir !== ".") {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(settings.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS stations (
    station_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS readings (
    source_id INTEGER PRIMARY KEY,
    station_id INTEGER NOT NULL,
    speed_kmh REAL,
    direction_deg REAL,
    measured_at TEXT NOT NULL,
    inserted_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY(station_id) REFERENCES stations(station_id)
  );

  CREATE INDEX IF NOT EXISTS idx_readings_station_time
    ON readings(station_id, measured_at DESC);

  CREATE INDEX IF NOT EXISTS idx_readings_measured_time
    ON readings(measured_at DESC);
`);

const upsertStationStmt = db.prepare(`
  INSERT INTO stations(station_id, name)
  VALUES(?, ?)
  ON CONFLICT(station_id) DO UPDATE SET name = excluded.name
`);

const insertReadingStmt = db.prepare(`
  INSERT OR IGNORE INTO readings(
    source_id, station_id, speed_kmh, direction_deg, measured_at
  ) VALUES(@source_id, @station_id, @speed_kmh, @direction_deg, @measured_at)
`);

const insertManyTxn = db.transaction((rows) => {
  let inserted = 0;
  for (const row of rows) {
    const payload = {
      source_id: Number.parseInt(row.id, 10),
      station_id: Number.parseInt(row.estacion, 10),
      speed_kmh:
        row.velocidad === null || row.velocidad === undefined || row.velocidad === ""
          ? null
          : Number.parseFloat(row.velocidad),
      direction_deg:
        row.direccion === null || row.direccion === undefined || row.direccion === ""
          ? null
          : Number.parseFloat(row.direccion),
      measured_at: String(row.tiempo || "").trim(),
    };

    if (!Number.isInteger(payload.source_id) || !Number.isInteger(payload.station_id)) {
      continue;
    }
    if (!payload.measured_at) {
      continue;
    }

    const result = insertReadingStmt.run(payload);
    inserted += result.changes;
  }
  return inserted;
});

for (const [stationId, name] of settings.stationNames.entries()) {
  upsertStationStmt.run(stationId, name);
}

const listStationsStmt = db.prepare(
  "SELECT station_id, name FROM stations ORDER BY station_id"
);

const latestRowsBase = `
  SELECT r.source_id, r.station_id, s.name, r.speed_kmh, r.direction_deg, r.measured_at, r.inserted_at
  FROM readings r
  JOIN (
    SELECT station_id, MAX(source_id) AS max_source_id
    FROM readings
    GROUP BY station_id
  ) latest
    ON latest.station_id = r.station_id
   AND latest.max_source_id = r.source_id
  LEFT JOIN stations s ON s.station_id = r.station_id
`;

const latestRowsAllStmt = db.prepare(`${latestRowsBase} ORDER BY r.station_id ASC`);
const latestRowsOneStmt = db.prepare(`${latestRowsBase} WHERE r.station_id = ? ORDER BY r.station_id ASC`);

const latestMeasuredAtStmt = db.prepare(
  "SELECT measured_at FROM readings WHERE station_id = ? ORDER BY measured_at DESC LIMIT 1"
);

const rowsBetweenStmt = db.prepare(`
  SELECT source_id, station_id, speed_kmh, direction_deg, measured_at
  FROM readings
  WHERE station_id = ?
    AND measured_at >= ?
    AND measured_at <= ?
  ORDER BY measured_at ASC
  LIMIT ?
`);

const rowCountStmt = db.prepare("SELECT COUNT(*) AS count FROM readings");

const collectorState = {
  started_at: new Date().toISOString(),
  last_started_at: null,
  last_finished_at: null,
  last_success_at: null,
  total_runs: 0,
  total_inserted_rows: 0,
  total_errors: 0,
  last_error: null,
};

let collectorTimer = null;
let collectorStopped = false;

async function fetchSourceJson(params = {}) {
  const url = new URL(settings.sourceApiUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`source API HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload || payload.ok !== true) {
    throw new Error(payload?.error || "La API de origen devolvio ok=false");
  }
  return payload;
}

async function backfill() {
  let insertedTotal = 0;
  for (const stationId of settings.stationIds) {
    const payload = await fetchSourceJson({ limit: settings.backfillLimit, estacion: stationId });
    const items = Array.isArray(payload.items) ? payload.items : [];
    insertedTotal += insertManyTxn(items);
  }
  return insertedTotal;
}

async function collectOnce() {
  const payload = await fetchSourceJson();
  const latestByStation = payload.latest_by_station || {};
  const rows = [];
  for (const stationId of settings.stationIds) {
    const row = latestByStation[String(stationId)] || latestByStation[stationId];
    if (row) {
      rows.push(row);
    }
  }
  return insertManyTxn(rows);
}

async function runCollectorLoop() {
  if (collectorStopped) return;

  const startedMs = Date.now();
  collectorState.total_runs += 1;
  collectorState.last_started_at = new Date(startedMs).toISOString();

  try {
    const inserted = await collectOnce();
    collectorState.total_inserted_rows += inserted;
    collectorState.last_success_at = new Date().toISOString();
    collectorState.last_error = null;
  } catch (error) {
    collectorState.total_errors += 1;
    collectorState.last_error = error instanceof Error ? error.message : String(error);
  } finally {
    collectorState.last_finished_at = new Date().toISOString();
  }

  const elapsed = Date.now() - startedMs;
  const waitMs = Math.max(0, settings.collectIntervalMs - elapsed);
  collectorTimer = setTimeout(runCollectorLoop, waitMs);
}

async function startCollector() {
  const inserted = await backfill();
  collectorState.total_inserted_rows += inserted;
  collectorState.last_success_at = new Date().toISOString();
  await runCollectorLoop();
}

function getLatestRows(stationId) {
  const rows = stationId ? latestRowsOneStmt.all(stationId) : latestRowsAllStmt.all();
  const nowMs = Date.now();

  return rows.map((row) => {
    const insertedAtMs = parseTsToMs(row.inserted_at);
    const ageSeconds = Number.isFinite(insertedAtMs)
      ? Math.max(0, Math.floor((nowMs - insertedAtMs) / 1000))
      : null;

    return {
      source_id: row.source_id,
      station_id: row.station_id,
      station_name: row.name,
      speed_kmh: row.speed_kmh,
      direction_deg: row.direction_deg,
      measured_at: row.measured_at,
      inserted_at: row.inserted_at,
      age_seconds: ageSeconds,
      is_stale: ageSeconds !== null ? ageSeconds >= settings.staleAfterSeconds : false,
    };
  });
}

function resolveWindow(stationId, range) {
  const latestRow = latestMeasuredAtStmt.get(stationId);
  if (!latestRow?.measured_at) {
    const err = new Error("No hay datos para la estacion");
    err.statusCode = 404;
    throw err;
  }

  const endMs = parseTsToMs(latestRow.measured_at);
  const durationMs = parseDurationToMs(range);
  const startMs = endMs - durationMs;

  return {
    startTs: formatSourceTs(startMs),
    endTs: formatSourceTs(endMs),
    startMs,
    endMs,
  };
}

function fetchRowsInWindow(stationId, range, limit = 200_000) {
  const { startTs, endTs, startMs, endMs } = resolveWindow(stationId, range);
  const rows = rowsBetweenStmt.all(stationId, startTs, endTs, limit);
  return { startTs, endTs, startMs, endMs, rows };
}

const app = express();

if (settings.corsOrigins.length === 1 && settings.corsOrigins[0] === "*") {
  app.use(cors());
} else {
  app.use(
    cors({
      origin: settings.corsOrigins,
      methods: ["GET"],
    })
  );
}

app.get("/", (_req, res) => {
  res.json({
    service: "viento-dashboard-api",
    status: "ok",
    stations: settings.stationIds,
  });
});

app.get("/health", (_req, res) => {
  const row = rowCountStmt.get();
  res.json({
    status: "ok",
    rows: row?.count || 0,
    collector: collectorState,
  });
});

app.get("/api/stations", (_req, res) => {
  const stations = listStationsStmt.all().map((row) => ({
    station_id: row.station_id,
    name: row.name,
  }));
  res.json({ stations });
});

app.get("/api/latest", (req, res, next) => {
  try {
    const stationIdParam = req.query.station_id;
    const stationId = stationIdParam ? Number.parseInt(String(stationIdParam), 10) : null;
    if (stationIdParam && !Number.isInteger(stationId)) {
      throw new Error("station_id debe ser un entero");
    }
    res.json({ items: getLatestRows(stationId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", (req, res, next) => {
  try {
    const stationId = Number.parseInt(String(req.query.station_id || ""), 10);
    if (!Number.isInteger(stationId) || stationId <= 0) {
      throw new Error("station_id es obligatorio y debe ser un entero");
    }

    const range = String(req.query.range || "6h");
    const bucketMinutes = req.query.bucket_minutes
      ? Number.parseInt(String(req.query.bucket_minutes), 10)
      : null;
    if (bucketMinutes !== null && (!Number.isInteger(bucketMinutes) || bucketMinutes <= 0)) {
      throw new Error("bucket_minutes debe ser un entero positivo");
    }

    const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 50_000;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 200_000) {
      throw new Error("limit debe estar entre 1 y 200000");
    }

    const { startTs, endTs, rows } = fetchRowsInWindow(stationId, range, limit);
    const items = bucketMinutes ? aggregateRows(rows, bucketMinutes) : rows;

    res.json({
      station_id: stationId,
      range,
      bucket_minutes: bucketMinutes,
      from: startTs,
      to: endTs,
      items,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stats", (req, res, next) => {
  try {
    const stationId = Number.parseInt(String(req.query.station_id || ""), 10);
    if (!Number.isInteger(stationId) || stationId <= 0) {
      throw new Error("station_id es obligatorio y debe ser un entero");
    }

    const windows = String(req.query.windows || "1m,5m,15m,24h")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    const latestRow = latestMeasuredAtStmt.get(stationId);
    if (!latestRow?.measured_at) {
      const err = new Error("No hay datos para la estacion");
      err.statusCode = 404;
      throw err;
    }

    const latestMs = parseTsToMs(latestRow.measured_at);
    const output = {};

    for (const windowText of windows) {
      const durationMs = parseDurationToMs(windowText);
      const startTs = formatSourceTs(latestMs - durationMs);
      const endTs = formatSourceTs(latestMs);
      const rows = rowsBetweenStmt.all(stationId, startTs, endTs, 200_000);
      output[windowText] = {
        ...computeStats(rows),
        from: startTs,
        to: endTs,
      };
    }

    res.json({
      station_id: stationId,
      latest_ts: latestRow.measured_at,
      stats: output,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/wind-rose", (req, res, next) => {
  try {
    const stationId = Number.parseInt(String(req.query.station_id || ""), 10);
    if (!Number.isInteger(stationId) || stationId <= 0) {
      throw new Error("station_id es obligatorio y debe ser un entero");
    }

    const range = String(req.query.range || "24h");
    const bins = req.query.bins ? Number.parseInt(String(req.query.bins), 10) : 16;
    if (!Number.isInteger(bins) || bins < 4 || bins > 36) {
      throw new Error("bins debe estar entre 4 y 36");
    }

    const { startTs, endTs, rows } = fetchRowsInWindow(stationId, range, 200_000);
    const items = computeWindRose(rows, bins);

    res.json({
      station_id: stationId,
      range,
      bins,
      from: startTs,
      to: endTs,
      items,
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 400;
  res.status(statusCode).json({
    ok: false,
    error: error.message || "Error inesperado",
  });
});

const server = app.listen(settings.port, settings.host, () => {
  console.log(`backend de viento escuchando en http://${settings.host}:${settings.port}`);
});

startCollector().catch((error) => {
  console.error("el recolector no pudo iniciar:", error);
  process.exit(1);
});

function shutdown() {
  collectorStopped = true;
  if (collectorTimer) {
    clearTimeout(collectorTimer);
  }
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
