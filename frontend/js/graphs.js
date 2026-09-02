/* Graphs section: dygraphs configured like holfuy.com js/graphs.js
   (colors, stroke widths, fill alphas, synced zoom, zoom buttons). */
var Graphs = (function () {

  var graphs = [];
  var sync = true;
  var blockRedraw = false;
  var currentZoomHours = null; // null = full range

  function redrawSynced(me, initial) {
    if (blockRedraw || initial || !sync) return;
    blockRedraw = true;
    var range = me.xAxisRange();
    graphs.forEach(function (g) {
      if (g !== me) g.updateOptions({ dateWindow: range });
    });
    blockRedraw = false;
  }

  function zoomGraphs(hours, btn) {
    currentZoomHours = hours;
    var res = hours == null ? null : hours * 3600 * 1000;
    graphs.forEach(function (g) {
      var w = g.xAxisExtremes();
      g.updateOptions({ dateWindow: res == null ? null : [w[1] - res, w[1]] });
    });
    document.querySelectorAll('.zoomlevel').forEach(function (b) {
      b.classList.remove('zoomlevel_active');
    });
    if (btn) btn.classList.add('zoomlevel_active');
  }

  function setSync(on) { sync = on; }

  function initGraph(mode, data, labels, ylabel, extra, colors, strokeWidth, pointSize,
    fillAlpha, includeZero, rangeStart, rangeStop) {
    var el = document.getElementById(mode + '_graph');
    if (!el || !data || !data.length) { if (el) hideBlock(mode); return; }
    showBlock(mode);
    var attrs = {
      labelsDiv: document.getElementById(mode + '_labels'),
      colors: colors,
      valueRange: [rangeStart != null ? rangeStart : null, rangeStop != null ? rangeStop : null],
      fillAlpha: fillAlpha,
      drawCallback: redrawSynced,
      axisLabelFontSize: 11,
      ylabel: ylabel,
      labels: labels,
      fillGraph: true,
      includeZero: includeZero,
      strokeWidth: strokeWidth,
      drawPoints: true,
      pointSize: pointSize,
      highlightCircleSize: 3
    };
    var g = new Dygraph(el, data, attrs);
    if (extra) g.updateOptions(extra);
    graphs.push(g);
  }

  function hideBlock(mode) {
    var b = document.getElementById(mode + '_block');
    if (b) b.style.display = 'none';
  }
  function showBlock(mode) {
    var b = document.getElementById(mode + '_block');
    if (b) b.style.display = '';
  }

  /* ---- data assembly ---- */

  function windRows(stationId) {
    var hist = Api.store.stations[stationId].historial;
    var speed = [], dir = [];
    for (var off = -(CONFIG.graphDays - 1); off <= 0; off++) {
      var fecha = Util.todayMx(off);
      (hist[fecha] || []).forEach(function (b) {
        if (!b.wall) return;
        var x = new Date(b.wall.getTime() + 15 * 60000); // bucket center
        var has = b.n > 0;
        speed.push([x, has ? b.v : null, has ? b.vmax : null, has ? b.vmin : null]);
        dir.push([x, has ? b.dir : null]);
      });
    }
    return { speed: speed, dir: dir };
  }

  function meteoRows() {
    var temp = [], hum = [], press = [], batt = [];
    Api.store.meteo.forEach(function (m) {
      temp.push([m.wall, m.temp, m.dew]);
      hum.push([m.wall, m.hum]);
      var slp = Util.seaLevelPressure(m.pa, CONFIG.meteoAltitude, m.temp);
      press.push([m.wall, slp]);
      batt.push([m.wall, m.batt]);
    });
    return { temp: temp, hum: hum, press: press, batt: batt };
  }

  function directionExtra(sectors) {
    return {
      zoomCallback: function () {
        this.updateOptions({ valueRange: [0, 360] });
      },
      drawGrid: false,
      underlayCallback: function (canvas, area, g) {
        function band(from, to, style) {
          canvas.fillStyle = style;
          var top = g.toDomYCoord(to), bottom = g.toDomYCoord(from);
          canvas.fillRect(area.x, top, area.w, bottom - top);
        }
        canvas.fillStyle = 'gray';
        [90, 180, 270].forEach(function (d) { band(d - 1, d + 1, 'gray'); });
        if (sectors) {
          (sectors.takeoff || []).forEach(function (s) {
            if (s.from > s.to) {
              band(s.from, 360, 'rgba(255,255,0,0.3)'); band(0, s.to, 'rgba(255,255,0,0.3)');
            } else band(s.from, s.to, 'rgba(255,255,0,0.3)');
          });
          (sectors.optimal || []).forEach(function (s) {
            if (s.from > s.to) {
              band(s.from, 360, 'rgba(0,255,0,0.2)'); band(0, s.to, 'rgba(0,255,0,0.2)');
            } else band(s.from, s.to, 'rgba(0,255,0,0.2)');
          });
        }
      }
    };
  }

  function rebuild(stationId) {
    if (typeof Dygraph === 'undefined') return; // CDN unavailable
    Api.synthTodayIfNeeded(stationId); // fall back to live-derived buckets if the API day is missing
    blockRedraw = true; // graphs created below redraw via updateOptions — don't let that sync-clobber ranges
    graphs.forEach(function (g) { g.destroy(); });
    graphs = [];

    var cfg = Widget.stationCfg(stationId);
    var w = windRows(stationId);
    var m = meteoRows();

    initGraph('speed', w.speed, ['Time', 'Speed', 'Gust', 'Min'], 'Speed/Gust/Minimum (km/h)',
      { series: { 'Min': { fillGraph: false } } },
      ['darkgreen', 'gray', 'black'], 0.4, 0.5, 0.7, true);

    initGraph('direction', w.dir, ['Time', 'Dir'], '',
      directionExtra(cfg.sectors), ['red'], 0, 1.5, 0, true, 0, 360);

    initGraph('temp', m.temp, ['Time', 'temp', 'dew point'], 'Temperature (°C)',
      { series: { 'dew point': { fillGraph: false } } },
      ['darkblue', 'purple'], 0.1, 1, 0.2, true);

    initGraph('humidity', m.hum, ['Time', 'Humidity'], 'Humidity (%)',
      null, ['darkblue'], 1, 1, 0.5, true, 0, 105);

    initGraph('pressure', m.press, ['Time', 'Pressure'], 'Pressure (hPa)',
      null, ['orange'], 0.5, 2, 0, false);

    initGraph('battery', m.batt, ['Time', 'Battery'], 'Battery (%)',
      null, ['green'], 1.3, 1.5, 0.3, false, 0, 105);

    blockRedraw = false;
    if (currentZoomHours != null) zoomGraphs(currentZoomHours,
      document.querySelector('.zoomlevel_active'));

    var upd = document.getElementById('graphs_updated');
    if (upd) upd.textContent = 'updated: ' + Util.nowMxClock() + ' (MX)';
  }

  return { rebuild: rebuild, zoomGraphs: zoomGraphs, setSync: setSync };
})();
