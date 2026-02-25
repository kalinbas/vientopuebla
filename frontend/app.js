const config = window.DASHBOARD_CONFIG || {};

const SOURCE_API_URL =
  config.SOURCE_API_URL || "https://viento.saboresgaleazzi.com/api_viento_ultimos.php";
const INITIAL_HISTORY_LIMIT = Math.max(10, Number.parseInt(config.INITIAL_HISTORY_LIMIT || 180, 10));
const POLL_INTERVAL_MS = Math.max(1000, Number.parseInt(config.POLL_INTERVAL_MS || 5000, 10));
const STALE_AFTER_SECONDS = Math.max(5, Number.parseInt(config.STALE_AFTER_SECONDS || 20, 10));
const DEFAULT_STATIONS = Array.isArray(config.DEFAULT_STATIONS) ? config.DEFAULT_STATIONS : [];

const els = {
  sourceStatus: document.getElementById("sourceStatus"),
  lastRefresh: document.getElementById("lastRefresh"),
  memoryCount: document.getElementById("memoryCount"),
  realtimeStations: document.getElementById("realtimeStations"),
  stationSelect: document.getElementById("stationSelect"),
  rangeSelect: document.getElementById("rangeSelect"),
  bucketSelect: document.getElementById("bucketSelect"),
  kpiSpeed: document.getElementById("kpiSpeed"),
  kpiDirection: document.getElementById("kpiDirection"),
  kpiAvg1m: document.getElementById("kpiAvg1m"),
  kpiAvg5m: document.getElementById("kpiAvg5m"),
  kpiAvg15m: document.getElementById("kpiAvg15m"),
  kpiPeak24h: document.getElementById("kpiPeak24h"),
  speedMeta: document.getElementById("speedMeta"),
  directionMeta: document.getElementById("directionMeta"),
  roseMeta: document.getElementById("roseMeta"),
  tableMeta: document.getElementById("tableMeta"),
  historyBody: document.getElementById("historyBody"),
};

const defaultBucketByRange = {
  "1h": "1",
  "6h": "5",
  "24h": "15",
  "7d": "60",
};

const state = {
  stations: [],
  stores: new Map(),
  speedChart: null,
  directionChart: null,
  roseChart: null,
  pollTimer: null,
};

function defaultStationName(id) {
  const match = DEFAULT_STATIONS.find((station) => Number.parseInt(station.id, 10) === id);
  return match?.name || `Estacion ${id}`;
}

function setSourcePill(mode, text) {
  els.sourceStatus.className = `pill ${mode}`;
  els.sourceStatus.textContent = text;
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

function parseSourceTimestampToMs(ts) {
  if (typeof ts !== "string") return Number.NaN;
  const [datePart, timePart] = ts.trim().split(" ");
  if (!datePart || !timePart) return Number.NaN;
  return new Date(`${datePart}T${timePart}`).getTime();
}

function formatTimestampFromMs(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatSpeed(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)} km/h`;
}

function formatShortSpeed(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(1);
}

function formatDirection(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const names = [
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
  const idx = Math.round((((value % 360) + 360) % 360) / 22.5) % names.length;
  return `${names[idx]} (${value.toFixed(0)}°)`;
}

function ensureStationStore(stationId) {
  if (!state.stores.has(stationId)) {
    state.stores.set(stationId, {
      byId: new Map(),
      items: [],
    });
  }
  return state.stores.get(stationId);
}

function normalizeApiRow(raw, fallbackStationId = null) {
  if (!raw || typeof raw !== "object") return null;

  const sourceId = Number.parseInt(raw.id, 10);
  const stationId = Number.parseInt(raw.estacion ?? fallbackStationId, 10);
  const measuredAt = String(raw.tiempo || "").trim();
  const measuredAtMs = parseSourceTimestampToMs(measuredAt);

  if (!Number.isInteger(sourceId) || !Number.isInteger(stationId)) return null;
  if (!Number.isFinite(measuredAtMs)) return null;

  const speedValue = Number.parseFloat(raw.velocidad);
  const directionValue = Number.parseFloat(raw.direccion);

  return {
    source_id: sourceId,
    station_id: stationId,
    speed_kmh: Number.isFinite(speedValue) ? speedValue : null,
    direction_deg: Number.isFinite(directionValue) ? directionValue : null,
    measured_at: measuredAt,
    measured_at_ms: measuredAtMs,
  };
}

function mergeRows(rawRows) {
  if (!Array.isArray(rawRows)) return 0;

  let inserted = 0;
  const touchedStations = new Set();

  for (const rawRow of rawRows) {
    const row = normalizeApiRow(rawRow);
    if (!row) continue;

    const store = ensureStationStore(row.station_id);
    if (store.byId.has(row.source_id)) continue;

    store.byId.set(row.source_id, row);
    store.items.push(row);
    touchedStations.add(row.station_id);
    inserted += 1;
  }

  for (const stationId of touchedStations) {
    const store = ensureStationStore(stationId);
    store.items.sort((a, b) => {
      if (a.measured_at_ms !== b.measured_at_ms) return a.measured_at_ms - b.measured_at_ms;
      return a.source_id - b.source_id;
    });
  }

  return inserted;
}

function listStationRows(stationId) {
  const store = state.stores.get(stationId);
  return store ? store.items : [];
}

function getLatestRow(stationId) {
  const rows = listStationRows(stationId);
  return rows.length ? rows[rows.length - 1] : null;
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
    avg_speed_kmh: speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null,
    min_speed_kmh: speeds.length ? Math.min(...speeds) : null,
    max_speed_kmh: speeds.length ? Math.max(...speeds) : null,
    avg_direction_deg: circularMeanDegrees(directions),
  };
}

function rowsInWindow(rows, windowMs, endMs) {
  const startMs = endMs - windowMs;
  return rows.filter((row) => row.measured_at_ms >= startMs && row.measured_at_ms <= endMs);
}

function rowsInRange(rows, rangeToken) {
  const latest = rows.length ? rows[rows.length - 1] : null;
  if (!latest) return [];

  const windowMs = parseDurationToMs(rangeToken);
  return rowsInWindow(rows, windowMs, latest.measured_at_ms);
}

function aggregateRows(rows, bucketMinutes) {
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = new Map();

  for (const row of rows) {
    const key = Math.floor(row.measured_at_ms / bucketMs) * bucketMs;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(row);
  }

  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((bucketMsStart) => {
      const bucketRows = buckets.get(bucketMsStart);
      const stats = computeStats(bucketRows);
      return {
        ts: formatTimestampFromMs(bucketMsStart),
        avg_speed_kmh: stats.avg_speed_kmh,
        min_speed_kmh: stats.min_speed_kmh,
        max_speed_kmh: stats.max_speed_kmh,
        avg_direction_deg: stats.avg_direction_deg,
        sample_count: bucketRows.length,
      };
    });
}

function computeWindRose(rows, bins = 16) {
  const binCount = Math.min(36, Math.max(4, bins));
  const width = 360 / binCount;
  const counts = new Array(binCount).fill(0);
  const speedSums = new Array(binCount).fill(0);

  for (const row of rows) {
    if (typeof row.direction_deg !== "number" || !Number.isFinite(row.direction_deg)) continue;

    const idx = Math.floor((((row.direction_deg % 360) + 360) % 360) / width) % binCount;
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
      count: counts[idx],
      avg_speed_kmh: counts[idx] ? speedSums[idx] / counts[idx] : null,
    };
  });
}

function getStationId() {
  const stationId = Number.parseInt(String(els.stationSelect.value), 10);
  if (!Number.isInteger(stationId) || stationId <= 0) {
    throw new Error("Seleccion de estacion invalida");
  }
  return stationId;
}

function populateStations(stationIds) {
  state.stations = stationIds.map((stationId) => ({
    station_id: stationId,
    name: defaultStationName(stationId),
  }));

  els.stationSelect.innerHTML = "";
  for (const station of state.stations) {
    const opt = document.createElement("option");
    opt.value = String(station.station_id);
    opt.textContent = `${station.name} (#${station.station_id})`;
    els.stationSelect.appendChild(opt);
  }

  if (!state.stations.length) {
    throw new Error("No hay estaciones disponibles");
  }

  els.stationSelect.value = String(state.stations[0].station_id);
}

function totalPointsInMemory() {
  let total = 0;
  for (const station of state.stations) {
    total += listStationRows(station.station_id).length;
  }
  return total;
}

function ensureSpeedChart() {
  if (state.speedChart) return state.speedChart;
  const ctx = document.getElementById("speedChart");

  state.speedChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Velocidad promedio",
          data: [],
          borderColor: "#4fd3ff",
          backgroundColor: "rgba(79, 211, 255, 0.22)",
          borderWidth: 2,
          fill: true,
          tension: 0.22,
          pointRadius: 0,
        },
        {
          label: "Velocidad pico",
          data: [],
          borderColor: "#7bffb4",
          backgroundColor: "rgba(123, 255, 180, 0.08)",
          borderWidth: 1.7,
          fill: false,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#ecf3f8" } },
      },
      scales: {
        x: {
          ticks: { color: "#9db4c3", maxTicksLimit: 10 },
          grid: { color: "rgba(157, 180, 195, 0.18)" },
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#9db4c3" },
          grid: { color: "rgba(157, 180, 195, 0.18)" },
          title: {
            display: true,
            text: "km/h",
            color: "#9db4c3",
          },
        },
      },
    },
  });

  return state.speedChart;
}

function ensureDirectionChart() {
  if (state.directionChart) return state.directionChart;
  const ctx = document.getElementById("directionChart");

  state.directionChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Direccion",
          data: [],
          borderColor: "#ffb089",
          backgroundColor: "rgba(255, 176, 137, 0.18)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.12,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#ecf3f8" } },
      },
      scales: {
        x: {
          ticks: { color: "#9db4c3", maxTicksLimit: 10 },
          grid: { color: "rgba(157, 180, 195, 0.18)" },
        },
        y: {
          min: 0,
          max: 360,
          ticks: { color: "#9db4c3" },
          grid: { color: "rgba(157, 180, 195, 0.18)" },
          title: {
            display: true,
            text: "grados",
            color: "#9db4c3",
          },
        },
      },
    },
  });

  return state.directionChart;
}

function ensureRoseChart() {
  if (state.roseChart) return state.roseChart;
  const ctx = document.getElementById("roseChart");

  state.roseChart = new Chart(ctx, {
    type: "polarArea",
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          backgroundColor: [
            "rgba(79, 211, 255, 0.75)",
            "rgba(95, 220, 249, 0.75)",
            "rgba(110, 229, 242, 0.75)",
            "rgba(126, 237, 234, 0.75)",
            "rgba(141, 244, 227, 0.75)",
            "rgba(157, 250, 220, 0.75)",
            "rgba(172, 255, 205, 0.75)",
            "rgba(186, 253, 189, 0.75)",
            "rgba(200, 248, 173, 0.75)",
            "rgba(214, 242, 156, 0.75)",
            "rgba(227, 235, 139, 0.75)",
            "rgba(239, 226, 122, 0.75)",
            "rgba(249, 216, 106, 0.75)",
            "rgba(255, 203, 110, 0.75)",
            "rgba(255, 189, 120, 0.75)",
            "rgba(255, 174, 138, 0.75)",
          ],
          borderColor: "rgba(10, 20, 30, 0.7)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#ecf3f8",
            boxWidth: 12,
          },
        },
      },
      scales: {
        r: {
          ticks: { display: false },
          grid: { color: "rgba(157, 180, 195, 0.18)" },
          pointLabels: { color: "#9db4c3" },
        },
      },
    },
  });

  return state.roseChart;
}

function renderHistoryTable(rows) {
  const latestRows = [...rows].reverse().slice(0, 120);
  const html = latestRows
    .map((row) => {
      const speed = formatShortSpeed(row.speed_kmh);
      const dir = formatDirection(row.direction_deg);
      const deg =
        typeof row.direction_deg === "number" && Number.isFinite(row.direction_deg)
          ? `${row.direction_deg.toFixed(0)}°`
          : "-";
      return `<tr>
        <td>${row.measured_at}</td>
        <td>${speed}</td>
        <td>${dir}</td>
        <td>${deg}</td>
      </tr>`;
    })
    .join("");

  els.historyBody.innerHTML =
    html || '<tr><td colspan="4" style="color:#9db4c3;">Sin datos en el rango seleccionado.</td></tr>';
  els.tableMeta.textContent = `${latestRows.length} filas visibles`;
}

function renderSpeedAndDirectionCharts(bucketedRows) {
  const labels = bucketedRows.map((item) => item.ts.slice(5, 16));
  const avgSeries = bucketedRows.map((item) => item.avg_speed_kmh);
  const maxSeries = bucketedRows.map((item) => item.max_speed_kmh);
  const directionSeries = bucketedRows.map((item) => item.avg_direction_deg);

  const speedChart = ensureSpeedChart();
  speedChart.data.labels = labels;
  speedChart.data.datasets[0].data = avgSeries;
  speedChart.data.datasets[1].data = maxSeries;
  speedChart.update();

  const directionChart = ensureDirectionChart();
  directionChart.data.labels = labels;
  directionChart.data.datasets[0].data = directionSeries;
  directionChart.update();

  els.speedMeta.textContent = `${bucketedRows.length} puntos`;
  els.directionMeta.textContent = `${bucketedRows.length} promedios direccionales`;
}

function renderRose(roseItems) {
  const roseChart = ensureRoseChart();
  roseChart.data.labels = roseItems.map((item) => item.label);
  roseChart.data.datasets[0].data = roseItems.map((item) => item.count);
  roseChart.update();

  const totalSamples = roseItems.reduce((sum, item) => sum + item.count, 0);
  els.roseMeta.textContent = `${totalSamples} muestras en el rango seleccionado`;
}

function renderRealtimeCards(selectedStationId) {
  if (!els.realtimeStations) return;

  const nowMs = Date.now();
  const cardsHtml = state.stations
    .map((station) => {
      const rows = listStationRows(station.station_id);
      const latest = rows.length ? rows[rows.length - 1] : null;
      const stale = latest ? nowMs - latest.measured_at_ms >= STALE_AFTER_SECONDS * 1000 : true;
      const statusText = !latest ? "Sin datos" : stale ? "Sin señal" : "En linea";
      const statusClass = stale ? "down" : "up";
      const arrowDeg =
        latest && typeof latest.direction_deg === "number" && Number.isFinite(latest.direction_deg)
          ? latest.direction_deg
          : null;
      const selectedClass = selectedStationId === station.station_id ? " selected" : "";

      return `<article class="live-card${selectedClass}" data-station-id="${station.station_id}">
        <div class="live-head">
          <h3>${station.name}</h3>
          <span class="live-status ${statusClass}">${statusText}</span>
        </div>
        <div class="live-main">
          <div>
            <p class="live-speed">${latest ? formatSpeed(latest.speed_kmh) : "-"}</p>
            <p class="live-dir">${latest ? formatDirection(latest.direction_deg) : "-"}</p>
          </div>
          <div class="live-arrow-wrap">
            <span class="live-arrow" style="${arrowDeg === null ? "opacity:.35" : `transform: rotate(${arrowDeg}deg);`}">↑</span>
          </div>
        </div>
      </article>`;
    })
    .join("");

  els.realtimeStations.innerHTML = cardsHtml;
}

function renderAll() {
  if (!state.stations.length) return;

  let stationId;
  try {
    stationId = getStationId();
  } catch (_error) {
    return;
  }

  renderRealtimeCards(stationId);

  const rows = listStationRows(stationId);
  const latest = getLatestRow(stationId);

  if (!rows.length || !latest) {
    els.kpiSpeed.textContent = "-";
    els.kpiDirection.textContent = "-";
    els.kpiAvg1m.textContent = "-";
    els.kpiAvg5m.textContent = "-";
    els.kpiAvg15m.textContent = "-";
    els.kpiPeak24h.textContent = "-";

    renderSpeedAndDirectionCharts([]);
    renderRose([]);
    renderHistoryTable([]);
    els.memoryCount.textContent = String(totalPointsInMemory());
    return;
  }

  const nowMs = Date.now();
  const stale = nowMs - latest.measured_at_ms >= STALE_AFTER_SECONDS * 1000;
  const staleSuffix = stale ? " (desactualizado)" : "";
  els.kpiSpeed.textContent = `${formatSpeed(latest.speed_kmh)}${staleSuffix}`;
  els.kpiDirection.textContent = formatDirection(latest.direction_deg);

  const rows1m = rowsInWindow(rows, parseDurationToMs("1m"), latest.measured_at_ms);
  const rows5m = rowsInWindow(rows, parseDurationToMs("5m"), latest.measured_at_ms);
  const rows15m = rowsInWindow(rows, parseDurationToMs("15m"), latest.measured_at_ms);
  const rows24h = rowsInWindow(rows, parseDurationToMs("24h"), latest.measured_at_ms);

  els.kpiAvg1m.textContent = formatSpeed(computeStats(rows1m).avg_speed_kmh);
  els.kpiAvg5m.textContent = formatSpeed(computeStats(rows5m).avg_speed_kmh);
  els.kpiAvg15m.textContent = formatSpeed(computeStats(rows15m).avg_speed_kmh);
  els.kpiPeak24h.textContent = formatSpeed(computeStats(rows24h).max_speed_kmh);

  const rangeToken = String(els.rangeSelect.value);
  const bucketMinutes = Number.parseInt(String(els.bucketSelect.value), 10);
  const rangeRows = rowsInRange(rows, rangeToken);

  const bucketedRows = aggregateRows(rangeRows, bucketMinutes);
  renderSpeedAndDirectionCharts(bucketedRows);
  renderRose(computeWindRose(rangeRows, 16));
  renderHistoryTable(rangeRows);

  els.memoryCount.textContent = String(totalPointsInMemory());
}

async function fetchSource(params = {}) {
  const url = new URL(SOURCE_API_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || payload.ok !== true) {
    throw new Error(payload?.error || "La API devolvio ok=false");
  }

  return payload;
}

async function bootstrapData() {
  const latestPayload = await fetchSource();
  const latestByStation = latestPayload.latest_by_station || {};

  let stationIds = Object.keys(latestByStation)
    .map((key) => Number.parseInt(key, 10))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);

  if (!stationIds.length) {
    stationIds = DEFAULT_STATIONS.map((station) => Number.parseInt(station.id, 10)).filter(
      (value) => Number.isInteger(value) && value > 0
    );
  }

  if (!stationIds.length) {
    throw new Error("No se detectaron estaciones en la API");
  }

  populateStations(stationIds);

  const historyPayloads = await Promise.all(
    stationIds.map(async (stationId) => {
      const payload = await fetchSource({
        limit: INITIAL_HISTORY_LIMIT,
        estacion: stationId,
      });
      return payload;
    })
  );

  for (const payload of historyPayloads) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    mergeRows(items);
    if (payload.latest) {
      mergeRows([payload.latest]);
    }
  }

  mergeRows(Object.values(latestByStation));
}

async function pollLatest() {
  try {
    const payload = await fetchSource();
    const latestByStation = payload.latest_by_station || {};
    mergeRows(Object.values(latestByStation));
    setSourcePill("pill-healthy", "En linea");
    els.lastRefresh.textContent = new Date().toLocaleTimeString();
  } catch (error) {
    setSourcePill("pill-down", "Error API");
    console.error(error);
  } finally {
    renderAll();
  }
}

function wireEvents() {
  els.realtimeStations.addEventListener("click", (event) => {
    const card = event.target.closest(".live-card[data-station-id]");
    if (!card) return;

    const stationId = Number.parseInt(card.dataset.stationId, 10);
    if (!Number.isInteger(stationId)) return;

    els.stationSelect.value = String(stationId);
    renderAll();
  });

  els.stationSelect.addEventListener("change", () => {
    renderAll();
  });

  els.rangeSelect.addEventListener("change", () => {
    const selectedRange = String(els.rangeSelect.value);
    els.bucketSelect.value = defaultBucketByRange[selectedRange] || els.bucketSelect.value;
    renderAll();
  });

  els.bucketSelect.addEventListener("change", () => {
    renderAll();
  });
}

async function bootstrap() {
  setSourcePill("pill-unknown", "Cargando...");
  els.bucketSelect.value = defaultBucketByRange[String(els.rangeSelect.value)] || "5";

  await bootstrapData();
  renderAll();
  setSourcePill("pill-healthy", "En linea");
  els.lastRefresh.textContent = new Date().toLocaleTimeString();

  wireEvents();

  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  state.pollTimer = setInterval(pollLatest, POLL_INTERVAL_MS);
}

bootstrap().catch((error) => {
  setSourcePill("pill-down", "Error API");
  console.error(error);
});
