/* Live widget: fills the Holfuy-style cells from the data store */
var Widget = (function () {

  function $(id) { return document.getElementById(id); }
  function setHtml(id, html) { var e = $(id); if (e) e.innerHTML = html; }

  function stationCfg(id) {
    for (var i = 0; i < CONFIG.stations.length; i++)
      if (CONFIG.stations[i].id === id) return CONFIG.stations[i];
    return CONFIG.stations[0];
  }

  // full refresh of the widget for one station
  function update(stationId) {
    var cfg = stationCfg(stationId);
    var live = Api.liveStats(stationId);
    var daily = Api.dailyStats(stationId);
    var met = Api.latestMeteo();
    var dTemp = Api.dailyTemp();

    setHtml('st_title', cfg.name);

    // dial
    Dial.draw('wind_kok', {
      speed: live ? live.speed : null,
      dir: live ? live.dir : null,
      temp: met ? met.temp : null,
      sectors: cfg.sectors
    });

    // wind now: "speed-gust unit DIR"
    if (live) {
      setHtml('w_now',
        '<b>' + Math.round(live.speed) + '</b>-<b>' + Math.round(live.gust) + '</b>' +
        '<span class="unit">km/h</span> <b>' + live.dirStr + '</b>');
      setHtml('tend_speed', live.speedTendency + ' <span class="tick">' + live.speedIcon + '</span>');
      setHtml('tend_dir', live.dirTendency + ' <span class="tick">' + live.dirIcon + '</span>');
      setHtml('avg15',
        '<b>' + (live.avg15 == null ? '-' : Math.round(live.avg15)) + '</b>-<b>' +
        (live.gust15 == null ? '-' : Math.round(live.gust15)) + '</b>' +
        '<span class="unit">km/h</span> <b>' + Util.degToCompass(live.dir15) + '</b>');
    } else {
      setHtml('w_now', '-'); setHtml('tend_speed', '-');
      setHtml('tend_dir', '-'); setHtml('avg15', '-');
    }

    // daily wind
    setHtml('daily_wind',
      '<span class="ic">🍃</span><b>' + Util.fmt(daily.avg, 1) + '</b><span class="unit">km/h</span> ' +
      '<span class="ic">💨</span><b>' + (daily.max == null ? '-' : Math.round(daily.max)) +
      '</b><span class="unit">km/h</span>');

    // temperature block
    if (met && met.temp != null) {
      var tb = $('temp_big');
      if (tb) {
        tb.textContent = Util.fmt(met.temp, 1);
        tb.style.background = Colors.tempToColor(met.temp);
      }
    } else if ($('temp_big')) {
      $('temp_big').textContent = '-';
      $('temp_big').style.background = 'white';
    }
    setHtml('temp_now', (met && met.temp != null ? Math.round(met.temp) : '-') + ' °C');
    setHtml('temp_max', (dTemp.max == null ? '-' : Util.fmt(dTemp.max, 1)) + ' °C');
    setHtml('temp_min', (dTemp.min == null ? '-' : Util.fmt(dTemp.min, 1)) + ' °C');

    // meteo cells
    if (met) {
      setHtml('hum', '<b>' + Util.fmt(met.hum, 1) + '</b><span class="unit"> %</span>');
      setHtml('cloud', met.cloudAgl == null ? '-'
        : '<b>' + Math.round(met.cloudAgl + CONFIG.meteoAltitude) + '</b><span class="unit">m AMSL</span>');
      var cl = $('cloud');
      if (cl && met.cloudAgl != null) cl.title = Math.round(met.cloudAgl) + ' m above ground';
      setHtml('dew', '<b>' + Util.fmt(met.dew, 1) + '</b><span class="unit"> °C</span>');
      var slp = Util.seaLevelPressure(met.pa, CONFIG.meteoAltitude, met.temp);
      setHtml('press', slp == null ? '-'
        : '<b>' + Util.fmt(slp, 1) + '</b><span class="unit">hPa</span>');
      var pr = $('press');
      if (pr && met.pa != null) pr.title = 'Station pressure: ' + Util.fmt(met.pa / 100, 1) + ' hPa';
      setHtml('batt', met.batt == null ? '-'
        : '🔋 <b>' + Math.round(met.batt) + '</b> % &nbsp;<span class="unit">at ' +
          (met.tiempo || '').slice(11, 16) + '</span>');
    } else {
      ['hum', 'cloud', 'dew', 'press', 'batt'].forEach(function (id) { setHtml(id, '-'); });
    }

    tick(stationId);
  }

  // called after every poll round: proves liveness even when the station is silent
  var dotTimer = null;
  function notePoll(ok) {
    var lc = $('lastcheck');
    if (lc) lc.textContent = 'checked ' + Util.nowMxClock();
    var dot = $('polldot');
    if (!dot) return;
    clearTimeout(dotTimer);
    dot.classList.remove('flash', 'err');
    void dot.offsetWidth; // restart transition
    dot.classList.add(ok ? 'flash' : 'err');
    if (ok) dotTimer = setTimeout(function () { dot.classList.remove('flash'); }, 350);
  }

  // 1-second ticker: freshness + the unmissable outdated-data state
  var baseTitle = document.title;
  function tick(stationId) {
    var live = Api.liveStats(stationId);
    var el = $('updated');
    var banner = $('stale_banner');
    var widget = document.querySelector('.widget');
    var stale;

    if (!live) {
      stale = true;
      if (el) { el.innerHTML = 'no data'; el.className = 'stale'; }
      if (banner) banner.innerHTML = '⚠ NO DATA received from this station yet';
    } else {
      var age = (Date.now() - live.epoch) / 1000;
      stale = age > CONFIG.staleAfterSec;
      if (el) {
        el.innerHTML = '⏱ ' + Util.agoText(age);
        el.className = stale ? 'stale' : '';
      }
      if (stale && banner) {
        banner.innerHTML = '⚠ OUTDATED DATA — station last transmitted at <b>' +
          (live.time || '').slice(11, 16) + '</b> (' +
          Util.agoText(age).replace(/<\/?b>/g, '') +
          ') <span class="sb_small">· values shown are the last received</span>';
      }
    }
    if (banner) banner.style.display = stale ? '' : 'none';
    if (widget) widget.classList.toggle('stale_mode', !!stale);
    document.title = (stale ? '⚠ ' : '') + baseTitle;
  }

  return { update: update, tick: tick, notePoll: notePoll, stationCfg: stationCfg };
})();
