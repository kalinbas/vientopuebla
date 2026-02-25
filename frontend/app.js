const els = {
  backendStatus: document.getElementById("backendStatus"),
  lastRefresh: document.getElementById("lastRefresh"),
  stationSelect: document.getElementById("stationSelect"),
  rangeSelect: document.getElementById("rangeSelect"),
  bucketSelect: document.getElementById("bucketSelect"),
  apiBaseInput: document.getElementById("apiBaseInput"),
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
  apiBase: "",
  stations: [],
  stationId: null,
  speedChart: null,
  directionChart: null,
  roseChart: null,
  timers: { fast: null, slow: null },
};

function normalizeApiBase(raw) {
  let value = String(raw || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  const parsed = new URL(value);
  return parsed.toString().replace(/\/$/, "");
}

function activeApiBase() {
  return state.apiBase || window.location.origin;
}

function buildApiUrl(pathname, params = {}) {
  const url = new URL(pathname, `${activeApiBase()}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function apiGet(pathname, params = {}) {
  const url = buildApiUrl(pathname, params);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while requesting ${url.pathname}`);
  }
  const payload = await response.json();
  if (payload && payload.ok === false) {
    throw new Error(payload.error || "La API devolvio ok=false");
  }
  return payload;
}

function formatSpeed(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)} km/h`;
}

function formatShortSpeed(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}`;
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

function setBackendPill(mode, text) {
  els.backendStatus.className = `pill ${mode}`;
  els.backendStatus.textContent = text;
}

function applyApiBaseFromInput() {
  try {
    state.apiBase = normalizeApiBase(els.apiBaseInput.value);
    if (state.apiBase) {
      localStorage.setItem("viento_api_base", state.apiBase);
    } else {
      localStorage.removeItem("viento_api_base");
    }
  } catch (_err) {
    setBackendPill("pill-down", "URL API invalida");
    throw new Error("URL base de API invalida");
  }
}

function stopPolling() {
  if (state.timers.fast) clearInterval(state.timers.fast);
  if (state.timers.slow) clearInterval(state.timers.slow);
  state.timers.fast = null;
  state.timers.slow = null;
}

function startPolling() {
  stopPolling();
  state.timers.fast = setInterval(() => {
    refreshFast().catch((err) => {
      setBackendPill("pill-down", "Sin conexion");
      console.error(err);
    });
  }, 5000);

  state.timers.slow = setInterval(() => {
    refreshSlow().catch((err) => {
      console.error(err);
    });
  }, 30000);
}

function getStationId() {
  const stationId = Number.parseInt(String(els.stationSelect.value), 10);
  if (!Number.isInteger(stationId) || stationId <= 0) {
    throw new Error("Seleccion de estacion invalida");
  }
  return stationId;
}

async function loadStations() {
  const payload = await apiGet("/api/stations");
  const stations = Array.isArray(payload.stations) ? payload.stations : [];
  if (!stations.length) {
    throw new Error("El backend no devolvio estaciones");
  }

  state.stations = stations;
  const previous = Number.parseInt(String(els.stationSelect.value), 10);

  els.stationSelect.innerHTML = "";
  for (const station of stations) {
    const opt = document.createElement("option");
    opt.value = String(station.station_id);
    opt.textContent = `${station.name} (#${station.station_id})`;
    els.stationSelect.appendChild(opt);
  }

  const selected = stations.some((s) => s.station_id === previous)
    ? previous
    : stations[0].station_id;
  els.stationSelect.value = String(selected);
  state.stationId = selected;
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
  els.tableMeta.textContent = `${latestRows.length} latest rows`;
}

function renderSpeedAndDirectionCharts(historyBucketed) {
  const labels = historyBucketed.map((item) => item.ts.slice(11, 16));
  const avgSeries = historyBucketed.map((item) => item.avg_speed_kmh);
  const maxSeries = historyBucketed.map((item) => item.max_speed_kmh);
  const dirSeries = historyBucketed.map((item) => item.avg_direction_deg);

  const speedChart = ensureSpeedChart();
  speedChart.data.labels = labels;
  speedChart.data.datasets[0].data = avgSeries;
  speedChart.data.datasets[1].data = maxSeries;
  speedChart.update();

  const directionChart = ensureDirectionChart();
  directionChart.data.labels = labels;
  directionChart.data.datasets[0].data = dirSeries;
  directionChart.update();

  els.speedMeta.textContent = `${historyBucketed.length} points`;
  els.directionMeta.textContent = `${historyBucketed.length} directional averages`;
}

function renderRose(roseItems) {
  const chart = ensureRoseChart();
  chart.data.labels = roseItems.map((item) => item.label);
  chart.data.datasets[0].data = roseItems.map((item) => item.count);
  chart.update();

  const total = roseItems.reduce((sum, item) => sum + item.count, 0);
  els.roseMeta.textContent = `${total} muestras en el rango seleccionado`;
}

async function refreshFast() {
  const stationId = getStationId();
  const [latestPayload, healthPayload] = await Promise.all([
    apiGet("/api/latest", { station_id: stationId }),
    apiGet("/health"),
  ]);

  const latest = (latestPayload.items || [])[0] || null;
  const collector = healthPayload.collector || {};

  if (collector.last_error) {
    setBackendPill("pill-down", "Error del recolector");
  } else {
    setBackendPill("pill-healthy", "En linea");
  }

  if (latest) {
    const staleSuffix = latest.is_stale ? " (desactualizado)" : "";
    els.kpiSpeed.textContent = `${formatSpeed(latest.speed_kmh)}${staleSuffix}`;
    els.kpiDirection.textContent = formatDirection(latest.direction_deg);
  } else {
    els.kpiSpeed.textContent = "-";
    els.kpiDirection.textContent = "-";
  }

  els.lastRefresh.textContent = new Date().toLocaleTimeString();
}

async function refreshSlow() {
  const stationId = getStationId();
  const range = String(els.rangeSelect.value);
  const bucketMinutes = Number.parseInt(String(els.bucketSelect.value), 10);

  const [statsPayload, historyBucketPayload, historyRawPayload, rosePayload] = await Promise.all([
    apiGet("/api/stats", { station_id: stationId, windows: "1m,5m,15m,24h" }),
    apiGet("/api/history", {
      station_id: stationId,
      range,
      bucket_minutes: bucketMinutes,
      limit: 200000,
    }),
    apiGet("/api/history", {
      station_id: stationId,
      range,
      limit: 2000,
    }),
    apiGet("/api/wind-rose", { station_id: stationId, range, bins: 16 }),
  ]);

  const stats = statsPayload.stats || {};
  els.kpiAvg1m.textContent = formatSpeed(stats["1m"]?.avg_speed_kmh);
  els.kpiAvg5m.textContent = formatSpeed(stats["5m"]?.avg_speed_kmh);
  els.kpiAvg15m.textContent = formatSpeed(stats["15m"]?.avg_speed_kmh);
  els.kpiPeak24h.textContent = formatSpeed(stats["24h"]?.max_speed_kmh);

  const bucketRows = Array.isArray(historyBucketPayload.items) ? historyBucketPayload.items : [];
  renderSpeedAndDirectionCharts(bucketRows);

  const rawRows = Array.isArray(historyRawPayload.items) ? historyRawPayload.items : [];
  renderHistoryTable(rawRows);

  const roseRows = Array.isArray(rosePayload.items) ? rosePayload.items : [];
  renderRose(roseRows);
}

async function refreshAll() {
  await refreshFast();
  await refreshSlow();
}

function wireEvents() {
  els.stationSelect.addEventListener("change", async () => {
    state.stationId = getStationId();
    await refreshAll();
  });

  els.rangeSelect.addEventListener("change", async () => {
    const selectedRange = String(els.rangeSelect.value);
    els.bucketSelect.value = defaultBucketByRange[selectedRange] || els.bucketSelect.value;
    await refreshSlow();
  });

  els.bucketSelect.addEventListener("change", async () => {
    await refreshSlow();
  });

  const applyApiAndReload = async () => {
    applyApiBaseFromInput();
    setBackendPill("pill-unknown", "Reconectando...");
    await loadStations();
    await refreshAll();
    startPolling();
  };

  els.apiBaseInput.addEventListener("change", () => {
    applyApiAndReload().catch((err) => {
      setBackendPill("pill-down", "Fallo de conexion");
      console.error(err);
    });
  });
}

async function bootstrap() {
  const queryApi = new URLSearchParams(window.location.search).get("api");
  const storedApi = localStorage.getItem("viento_api_base");
  const configApi = window.DASHBOARD_CONFIG?.API_BASE;

  state.apiBase = normalizeApiBase(queryApi || storedApi || configApi || "");
  els.apiBaseInput.value = state.apiBase;
  els.bucketSelect.value = defaultBucketByRange[String(els.rangeSelect.value)] || "5";

  wireEvents();
  await loadStations();
  await refreshAll();
  startPolling();
}

bootstrap().catch((err) => {
  setBackendPill("pill-down", "Fallo de conexion");
  console.error(err);
});
