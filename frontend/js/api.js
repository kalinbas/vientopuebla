/* Data layer: fetches the viento.saboresgaleazzi.com JSON APIs, keeps an
   in-memory store per station and derives the values the widgets need. */
var Api = (function () {

  var store = {
    stations: {},   // id -> { raw: [samples asc], historial: { 'YYYY-MM-DD': [buckets] }, historialAt, historialSynth }
    meteo: [],      // ascending by time
    lora: [],
    lastFetchOk: null,
    historialApiDown: false  // true when api_historial_climatico.php is failing (source-side)
  };
  CONFIG.stations.forEach(function (s) {
    store.stations[s.id] = { raw: [], historial: {}, historialAt: {}, historialSynth: {} };
  });

  function url(path, params) {
    var q = Object.keys(params).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return CONFIG.apiBase + path + '?' + q;
  }

  function fetchJson(path, params) {
    return fetch(url(path, params), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---- fetchers (normalize to ascending-time arrays of numbers) ---- */

  // Small limits (the 5-second poll) are merged into the stored history by id;
  // a full-size fetch replaces it. Keeps steady-state polling to ~1 KB per call.
  function getWind(est, limit) {
    limit = limit || CONFIG.windLimit;
    return fetchJson('api_viento_ultimos.php', { limit: limit, estacion: est })
      .then(function (j) {
        if (!j.ok) throw new Error('api viento not ok');
        var items = (j.items || []).map(function (it) {
          return {
            id: +it.id,
            v: +it.velocidad, d: +it.direccion, tiempo: it.tiempo,
            epoch: Util.parseMxEpoch(it.tiempo), wall: Util.parseMxWall(it.tiempo)
          };
        }).filter(function (x) { return isFinite(x.epoch); });
        items.sort(function (a, b) { return a.epoch - b.epoch; });
        var st = store.stations[est];
        if (limit < CONFIG.windLimit && st.raw.length) {
          var known = {};
          st.raw.forEach(function (s) { known[s.id] = 1; });
          items.forEach(function (s) { if (!known[s.id]) st.raw.push(s); });
          st.raw.sort(function (a, b) { return a.epoch - b.epoch; });
        } else {
          st.raw = items;
        }
        if (st.raw.length > CONFIG.rawKeep) st.raw.splice(0, st.raw.length - CONFIG.rawKeep);
        store.lastFetchOk = Date.now();
        return st.raw;
      });
  }

  function getMeteo(limit) {
    return fetchJson('api_meteo_ultimos.php', { limit: limit || CONFIG.meteoLimit })
      .then(function (j) {
        if (!j.ok) throw new Error('api meteo not ok');
        var items = (j.items || []).map(function (it) {
          var t = it.temperatura == null ? null : +it.temperatura;
          var h = it.humedad == null ? null : +it.humedad;
          return {
            id: +it.id,
            temp: t, hum: h,
            pa: it.presion == null ? null : +it.presion,
            batt: it.bateria == null ? null : +it.bateria,
            dew: it.punto_rocio_c != null ? +it.punto_rocio_c : Util.dewPoint(t, h),
            cloudAgl: it.techo_nube_m == null ? null : +it.techo_nube_m,
            tiempo: it.tiempo,
            epoch: Util.parseMxEpoch(it.tiempo), wall: Util.parseMxWall(it.tiempo)
          };
        }).filter(function (x) { return isFinite(x.epoch); });
        items.sort(function (a, b) { return a.epoch - b.epoch; });
        if (limit && limit < CONFIG.meteoLimit && store.meteo.length) {
          // small live poll: merge new rows into the existing history
          var known = {};
          store.meteo.forEach(function (m) { known[m.id] = 1; });
          items.forEach(function (m) { if (!known[m.id]) store.meteo.push(m); });
          store.meteo.sort(function (a, b) { return a.epoch - b.epoch; });
        } else {
          store.meteo = items;
        }
        if (store.meteo.length > CONFIG.meteoKeep)
          store.meteo.splice(0, store.meteo.length - CONFIG.meteoKeep);
        store.lastFetchOk = Date.now();
        return store.meteo;
      });
  }

  /* Meteo rows are immutable, so the in-memory history is persisted and on the
     next visit only the gap since the newest cached row is fetched. */
  var METEO_CACHE_KEY = 'pw_meteo_v1';

  function meteoSave() {
    try {
      localStorage.setItem(METEO_CACHE_KEY, JSON.stringify(store.meteo.map(function (m) {
        return [m.id, m.temp, m.hum, m.pa, m.batt, m.dew, m.cloudAgl, m.tiempo];
      })));
    } catch (e) { }
  }

  function meteoLoad() {
    try {
      var c = JSON.parse(localStorage.getItem(METEO_CACHE_KEY) || 'null');
      if (!c || !c.length) return 0;
      store.meteo = c.map(function (a) {
        return {
          id: a[0], temp: a[1], hum: a[2], pa: a[3], batt: a[4], dew: a[5],
          cloudAgl: a[6], tiempo: a[7],
          epoch: Util.parseMxEpoch(a[7]), wall: Util.parseMxWall(a[7])
        };
      }).filter(function (m) { return isFinite(m.epoch); });
      if (store.meteo.length > CONFIG.meteoKeep)
        store.meteo.splice(0, store.meteo.length - CONFIG.meteoKeep);
      return store.meteo.length;
    } catch (e) { return 0; }
  }

  // fetch size needed to bridge the gap since the newest stored meteo row
  function meteoGapLimit() {
    var m = store.meteo;
    if (!m.length) return CONFIG.meteoLimit;
    var spanMin = (m[m.length - 1].epoch - m[0].epoch) / 60000;
    var gapMin = (Date.now() - m[m.length - 1].epoch) / 60000;
    // too little history for the graphs, or gap too old to bridge -> full fetch
    if (spanMin < 120 || gapMin > 300) return CONFIG.meteoLimit;
    return Math.min(CONFIG.meteoLimit, Math.max(5, Math.ceil(gapMin * 2 + 5)));
  }

  // full wind baseline only when the store doesn't already cover the live windows
  function ensureWind(est) {
    var raw = store.stations[est].raw;
    var fresh = raw.length &&
      (Date.now() - raw[raw.length - 1].epoch) < CONFIG.catchUpAfterMs;
    return (fresh && raw.length >= 50) ? Promise.resolve(raw) : getWind(est);
  }

  // make sure a station has its graph/table days; past days come from the
  // localStorage cache, today is refetched only when older than the slow poll
  function ensureHistorial(est) {
    var jobs = [];
    var today = Util.todayMx();
    for (var off = 0; off < CONFIG.graphDays; off++) {
      var fecha = Util.todayMx(-off);
      var have = store.stations[est].historial[fecha];
      var at = store.stations[est].historialAt[fecha] || 0;
      if (!have || (fecha === today && Date.now() - at > CONFIG.slowPollMs))
        jobs.push(getHistorial(fecha, est));
    }
    return Promise.allSettled(jobs);
  }

  /* Completed days never change, so their historial responses are cached in
     localStorage; only today's data is always fetched fresh. */
  var CACHE_PREFIX = 'pw_hist_v1_';

  function cacheGet(key) {
    try { var v = localStorage.getItem(CACHE_PREFIX + key); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function cacheSet(key, items) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(items)); } catch (e) { }
  }
  function cachePrune() {
    try {
      var keep = Util.todayMx(-(CONFIG.graphDays + 3));
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0 && k.slice(-10) < keep) localStorage.removeItem(k);
      }
    } catch (e) { }
  }

  function normalizeBuckets(items, fecha) {
    return (items || []).map(function (it) {
      return {
        hora: it.hora,                                   // "HH:MM" bucket start
        wall: Util.parseMxWall(fecha + ' ' + it.hora + ':00'),
        v: it.velocidad == null ? null : +it.velocidad,
        vmin: it.velocidad_min == null ? null : +it.velocidad_min,
        vmax: it.velocidad_max == null ? null : +it.velocidad_max,
        dir: it.direccion == null ? null : +it.direccion,
        n: it.muestras == null ? 0 : +it.muestras
      };
    });
  }

  function getHistorial(fecha, est) {
    var isPast = fecha < Util.todayMx();
    var key = est + '_' + fecha;
    if (isPast) {
      var cached = cacheGet(key);
      if (cached) {
        store.stations[est].historial[fecha] = normalizeBuckets(cached, fecha);
        store.stations[est].historialSynth[fecha] = false;
        return Promise.resolve(store.stations[est].historial[fecha]);
      }
    }
    return fetchJson('api_historial_climatico.php', { fecha: fecha, estacion: est })
      .then(function (j) {
        if (!j.ok) throw new Error('api historial not ok');
        store.historialApiDown = false;
        if (isPast) cacheSet(key, j.items || []);
        store.stations[est].historial[fecha] = normalizeBuckets(j.items, fecha);
        store.stations[est].historialSynth[fecha] = false;
        store.stations[est].historialAt[fecha] = Date.now();
        return store.stations[est].historial[fecha];
      })
      .catch(function (e) {
        // Source-side historial endpoint unavailable. For today, reconstruct
        // buckets from the still-working live wind feed; past days can't be
        // rebuilt (raw only reaches back a short window).
        store.historialApiDown = true;
        if (!isPast) { synthTodayIfNeeded(est); return store.stations[est].historial[fecha]; }
        throw e;
      });
  }

  // Reconstruct one day's 30-min buckets from the in-memory raw samples,
  // matching the historial API's bucket shape (avg / min / max / circular dir).
  function synthBuckets(est, fecha) {
    var raw = store.stations[est].raw;
    var groups = {};
    raw.forEach(function (s) {
      if (!s.tiempo || s.tiempo.slice(0, 10) !== fecha) return;
      var slot = (+s.tiempo.slice(11, 13)) * 2 + ((+s.tiempo.slice(14, 16)) < 30 ? 0 : 1);
      (groups[slot] = groups[slot] || { vs: [], dirs: [] });
      groups[slot].vs.push(s.v); groups[slot].dirs.push(s.d);
    });
    var out = [];
    for (var slot = 0; slot < 48; slot++) {
      var hora = Util.pad2(Math.floor(slot / 2)) + ':' + (slot % 2 ? '30' : '00');
      var wall = Util.parseMxWall(fecha + ' ' + hora + ':00');
      var g = groups[slot];
      if (!g || !g.vs.length) {
        out.push({ hora: hora, wall: wall, v: null, vmin: null, vmax: null, dir: null, n: 0 });
      } else {
        out.push({
          hora: hora, wall: wall, v: mean(g.vs),
          vmin: Math.min.apply(null, g.vs), vmax: Math.max.apply(null, g.vs),
          dir: Util.circularMean(g.dirs), n: g.vs.length
        });
      }
    }
    return out;
  }

  // Populate today's buckets from raw when the API version is absent or itself synthetic
  function synthTodayIfNeeded(est) {
    var today = Util.todayMx();
    var st = store.stations[est];
    if (st.historial[today] && !st.historialSynth[today]) return; // real data present
    st.historial[today] = synthBuckets(est, today);
    st.historialSynth[today] = true;
  }

  function getLora() {
    return fetchJson('api_mensajes_lora.php', { limit: CONFIG.loraLimit })
      .then(function (j) {
        if (!j.ok) throw new Error('api lora not ok');
        store.lora = (j.items || []);
        return store.lora;
      });
  }

  /* ---- derived values ---- */

  function mean(arr) {
    var s = 0, n = 0;
    arr.forEach(function (v) { if (v != null && !isNaN(v)) { s += v; n++; } });
    return n ? s / n : null;
  }

  // Live wind stats for one station (windows measured back from the newest sample)
  function liveStats(est) {
    var raw = store.stations[est].raw;
    if (!raw.length) return null;
    var last = raw[raw.length - 1];
    var ref = last.epoch;
    var winG = raw.filter(function (s) { return s.epoch > ref - CONFIG.gustWindowMin * 60000; });
    var winA = raw.filter(function (s) { return s.epoch > ref - CONFIG.avgWindowMin * 60000; });
    var rec5 = winA.filter(function (s) { return s.epoch > ref - 5 * 60000; });
    var prev = winA.filter(function (s) { return s.epoch <= ref - 5 * 60000; });

    var avg15 = mean(winA.map(function (s) { return s.v; }));
    var rec5m = mean(rec5.map(function (s) { return s.v; }));
    var prevm = mean(prev.map(function (s) { return s.v; }));
    var spread = Util.circularSpread(winA.map(function (s) { return s.d; }));

    var speedTendency = 'Steady', speedIcon = '✓'; // ✓
    if (avg15 != null && avg15 < 3) { speedTendency = 'Calm'; }
    if (rec5m != null && prevm != null) {
      if (rec5m - prevm > 2) { speedTendency = 'Increasing'; speedIcon = '↗'; }
      else if (rec5m - prevm < -2) { speedTendency = 'Decreasing'; speedIcon = '↘'; }
    }
    var dirTendency = '-', dirIcon = '';
    if (spread != null) {
      if (spread < 0.15) { dirTendency = 'Stable'; dirIcon = '✓'; }
      else if (spread < 0.45) { dirTendency = 'Variable'; dirIcon = '↔'; }
      else { dirTendency = 'Very variable'; dirIcon = '↔'; }
    }

    return {
      speed: last.v, dir: last.d, dirStr: Util.degToCompass(last.d),
      time: last.tiempo, epoch: last.epoch,
      ageSec: (Date.now() - last.epoch) / 1000,
      gust: Math.max.apply(null, winG.map(function (s) { return s.v; })),
      avg15: avg15,
      gust15: winA.length ? Math.max.apply(null, winA.map(function (s) { return s.v; })) : null,
      dir15: Util.circularMean(winA.map(function (s) { return s.d; })),
      speedTendency: speedTendency, speedIcon: speedIcon,
      dirTendency: dirTendency, dirIcon: dirIcon
    };
  }

  // Daily wind stats from today's historial buckets
  function dailyStats(est) {
    synthTodayIfNeeded(est); // falls back to live-derived buckets if the API day is missing
    var buckets = store.stations[est].historial[Util.todayMx()] || [];
    var vs = [], ws = [], vmax = null;
    buckets.forEach(function (b) {
      if (b.v != null && b.n > 0) { vs.push(b.v); ws.push(b.n); }
      if (b.vmax != null && (vmax == null || b.vmax > vmax)) vmax = b.vmax;
    });
    var sum = 0, wsum = 0;
    for (var i = 0; i < vs.length; i++) { sum += vs[i] * ws[i]; wsum += ws[i]; }
    return { avg: wsum ? sum / wsum : null, max: vmax };
  }

  function latestMeteo() {
    return store.meteo.length ? store.meteo[store.meteo.length - 1] : null;
  }

  // Min/max temperature over today's available meteo rows (API keeps ~last 4-8 h)
  function dailyTemp() {
    var today = Util.todayMx();
    var min = null, max = null;
    store.meteo.forEach(function (m) {
      if (m.tiempo.indexOf(today) !== 0 || m.temp == null) return;
      if (min == null || m.temp < min) min = m.temp;
      if (max == null || m.temp > max) max = m.temp;
    });
    return { min: min, max: max };
  }

  function historialDown() { return store.historialApiDown; }
  function isTodaySynth(est) {
    return !!store.stations[est].historialSynth[Util.todayMx()];
  }

  return {
    store: store,
    getWind: getWind, getMeteo: getMeteo, getHistorial: getHistorial, getLora: getLora,
    ensureWind: ensureWind, ensureHistorial: ensureHistorial,
    synthTodayIfNeeded: synthTodayIfNeeded, historialDown: historialDown, isTodaySynth: isTodaySynth,
    meteoSave: meteoSave, meteoLoad: meteoLoad, meteoGapLimit: meteoGapLimit,
    cachePrune: cachePrune,
    liveStats: liveStats, dailyStats: dailyStats, latestMeteo: latestMeteo, dailyTemp: dailyTemp
  };
})();
