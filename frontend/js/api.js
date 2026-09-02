/* Data layer: fetches the viento.saboresgaleazzi.com JSON APIs, keeps an
   in-memory store per station and derives the values the widgets need. */
var Api = (function () {

  var store = {
    stations: {},   // id -> { raw: [samples asc], historial: { 'YYYY-MM-DD': [buckets] } }
    meteo: [],      // ascending by time
    lora: [],
    lastFetchOk: null
  };
  CONFIG.stations.forEach(function (s) { store.stations[s.id] = { raw: [], historial: {} }; });

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

  function getWind(est) {
    return fetchJson('api_viento_ultimos.php', { limit: CONFIG.windLimit, estacion: est })
      .then(function (j) {
        if (!j.ok) throw new Error('api viento not ok');
        var items = (j.items || []).map(function (it) {
          return {
            v: +it.velocidad, d: +it.direccion, tiempo: it.tiempo,
            epoch: Util.parseMxEpoch(it.tiempo), wall: Util.parseMxWall(it.tiempo)
          };
        }).filter(function (x) { return isFinite(x.epoch); });
        items.sort(function (a, b) { return a.epoch - b.epoch; });
        store.stations[est].raw = items;
        store.lastFetchOk = Date.now();
        return items;
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
        store.lastFetchOk = Date.now();
        return store.meteo;
      });
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
        return Promise.resolve(store.stations[est].historial[fecha]);
      }
    }
    return fetchJson('api_historial_climatico.php', { fecha: fecha, estacion: est })
      .then(function (j) {
        if (!j.ok) throw new Error('api historial not ok');
        if (isPast) cacheSet(key, j.items || []);
        store.stations[est].historial[fecha] = normalizeBuckets(j.items, fecha);
        return store.stations[est].historial[fecha];
      });
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

  return {
    store: store,
    getWind: getWind, getMeteo: getMeteo, getHistorial: getHistorial, getLora: getLora,
    cachePrune: cachePrune,
    liveStats: liveStats, dailyStats: dailyStats, latestMeteo: latestMeteo, dailyTemp: dailyTemp
  };
})();
