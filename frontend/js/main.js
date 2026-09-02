/* Boot, polling, station switching and widget tabs */
(function () {

  var currentStation = CONFIG.stations[0].id;

  function $(id) { return document.getElementById(id); }

  function stationFromHash() {
    var slug = (location.hash || '').replace('#', '').toLowerCase();
    for (var i = 0; i < CONFIG.stations.length; i++)
      if (CONFIG.stations[i].slug === slug) return CONFIG.stations[i].id;
    return CONFIG.stations[0].id;
  }

  /* ---- station tabs ---- */

  function renderStationTabs() {
    var el = $('station_tabs');
    el.innerHTML = CONFIG.stations.map(function (s) {
      return '<a href="#' + s.slug + '" class="sttab' +
        (s.id === currentStation ? ' sttab_active' : '') + '" data-st="' + s.id + '">' +
        s.name + '</a>';
    }).join('');
  }

  function switchStation(id) {
    currentStation = id;
    renderStationTabs();
    renderAll(); // immediate paint from whatever is in memory
    // first visit to this station: fetch its wind baseline + historial on demand
    Promise.allSettled([Api.ensureWind(id), Api.ensureHistorial(id)]).then(function () {
      if (currentStation === id) renderAll();
    });
  }

  window.addEventListener('hashchange', function () {
    var id = stationFromHash();
    if (id !== currentStation) switchStation(id);
  });

  /* ---- widget tabs (About / Dir.Stat. / LoRa) ---- */

  var currentTab = 'dirstat';
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.wtab').forEach(function (b) {
      b.classList.toggle('wtab_active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tabcontent').forEach(function (d) {
      d.style.display = d.id === 'tab_' + name ? '' : 'none';
    });
    if (name === 'dirstat') Rose.draw('rose_canvas', currentStation);
    if (name === 'lora') renderLora();
    if (name === 'about') renderAbout();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.wtab');
    if (t) showTab(t.dataset.tab);
  });

  function renderAbout() {
    var cfg = Widget.stationCfg(currentStation);
    var sun = Util.sunTimes(cfg.lat, cfg.lon, Util.todayMx());
    $('tab_about').innerHTML =
      '<div class="about_row">📍 ' + cfg.place + ', <b>' + cfg.altitude + 'm</b> (AMSL) ' +
      '<a class="maplink" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' +
      cfg.lat + ',' + cfg.lon + '">SHOW ON MAP!</a></div>' +
      cfg.links.map(function (l) {
        return '<div class="about_row">🔗 <a target="_blank" rel="noopener" href="' + l.url + '">' +
          l.label + '</a></div>';
      }).join('') +
      '<div class="about_row">☀ ' + (sun.sunrise || '-') + '–' + (sun.sunset || '-') +
      ' <span class="unit">(MX)</span></div>' +
      '<div class="about_row">ℹ Data: viento.saboresgaleazzi.com · live update every ' +
      Math.round(CONFIG.livePollMs / 1000) + ' s</div>';
  }

  function renderLoraList() {
    var rows = Api.store.lora.slice().reverse().map(function (m) {
      return '<div class="lora_row"><span class="lora_t">' +
        (m.hora || '').slice(11) + '</span> ' + escapeHtml(m.mensaje || '') + '</div>';
    }).join('');
    $('tab_lora').innerHTML =
      '<div class="lora_note">Shared radio feed — one log for the whole system, not per station</div>' +
      (rows || '<div class="about_row">No messages.</div>');
  }

  // fetched lazily — only when the tab is opened
  function renderLora() {
    if (!Api.store.lora.length) $('tab_lora').innerHTML = '<div class="about_row">Loading…</div>';
    else renderLoraList();
    Api.getLora().then(function () {
      if (currentTab === 'lora') renderLoraList();
    }).catch(function () { });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- rendering ---- */

  function renderAll() {
    Widget.update(currentStation);
    Tables.render(currentStation);
    Graphs.rebuild(currentStation);
    showTab(currentTab);
  }

  /* ---- polling ---- */

  var lastLivePoll = Date.now();
  var lastMeteoPoll = 0;

  // only the station being viewed is polled; the other is fetched on switch
  function livePoll() {
    // after a long gap (backgrounded tab, sleep) do one full refetch to fill the hole
    var catchUp = Date.now() - lastLivePoll > CONFIG.catchUpAfterMs;
    lastLivePoll = Date.now();
    var jobs = [
      Api.getWind(currentStation, catchUp ? CONFIG.windLimit : CONFIG.windPollLimit)
    ];
    // meteo only changes ~every 30 s, so it gets its own slower cadence
    if (catchUp || Date.now() - lastMeteoPoll >= CONFIG.meteoPollMs) {
      lastMeteoPoll = Date.now();
      jobs.push(Api.getMeteo(catchUp ? CONFIG.meteoLimit : CONFIG.meteoPollLimit));
    }
    Promise.allSettled(jobs).then(function (results) {
      Widget.notePoll(results.some(function (r) { return r.status === 'fulfilled'; }));
      Widget.update(currentStation);
      if (currentTab === 'dirstat') Rose.draw('rose_canvas', currentStation);
    });
  }

  // meteo stays current via the incremental live poll; only the viewed station's
  // today-historial needs refreshing (yesterday is cache-served except right
  // after midnight, when fetching it also writes the completed day to the cache)
  function slowPoll() {
    var jobs = [
      Api.getHistorial(Util.todayMx(), currentStation),
      Api.getHistorial(Util.todayMx(-1), currentStation)
    ];
    if (currentTab === 'lora') jobs.push(Api.getLora());
    Promise.allSettled(jobs).then(function () {
      Api.meteoSave();
      Tables.render(currentStation);
      Graphs.rebuild(currentStation);
      if (currentTab === 'lora') renderLoraList();
    });
  }

  /* ---- boot ---- */

  function boot() {
    currentStation = stationFromHash();
    renderStationTabs();

    // zoom buttons + sync checkbox
    document.querySelectorAll('.zoomlevel').forEach(function (b) {
      b.addEventListener('click', function () {
        Graphs.zoomGraphs(+b.dataset.hours, b);
      });
    });
    var sc = $('sync_check');
    if (sc) sc.addEventListener('change', function () { Graphs.setSync(sc.checked); });

    Api.cachePrune();
    Api.meteoLoad(); // persisted meteo history — only the gap is fetched below

    // Phase 1: fast first paint — live widget for the current station only
    Promise.allSettled([Api.getWind(currentStation), Api.getMeteo(3)]).then(function (results) {
      Widget.notePoll(results.some(function (r) { return r.status === 'fulfilled'; }));
      Widget.update(currentStation);
      showTab(currentTab);
    });

    // Phase 2: bridge the meteo gap + the viewed station's historial (past days
    // come from the localStorage cache), then tables/graphs and the pollers.
    // The other station loads on demand when switched to.
    var jobs = [Api.getMeteo(Api.meteoGapLimit()), Api.ensureHistorial(currentStation)];
    Promise.allSettled(jobs).then(function (results) {
      var failed = results.filter(function (r) { return r.status === 'rejected'; }).length;
      if (failed) console.warn(failed + ' of ' + results.length + ' initial requests failed');
      Api.meteoSave();
      renderAll();
      lastLivePoll = Date.now();
      setInterval(livePoll, CONFIG.livePollMs);
      setInterval(slowPoll, CONFIG.slowPollMs);
      setInterval(function () { Widget.tick(currentStation); }, 1000);
    });
    window.addEventListener('pagehide', function () { Api.meteoSave(); });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
