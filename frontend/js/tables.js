/* Averages tables: today's 30-min buckets + previous days merged to 1-hour columns,
   colored with the Holfuy scales. */
var Tables = (function () {

  var ARROW_SVG =
    '<svg viewBox="0 0 20 20" width="15" height="15">' +
    '<path d="M10 1.5 L10 17" stroke="#222" stroke-width="2.2" fill="none"/>' +
    '<path d="M5 11 L10 18 L15 11" stroke="#222" stroke-width="2.2" fill="none" stroke-linejoin="round"/>' +
    '</svg>';

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function nowWall() {
    var p = Util.nowMxParts();
    return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }

  // average of meteo field over [start, start+durMin)
  function meteoAvg(field, start, durMin) {
    var s = 0, n = 0, t0 = start.getTime(), t1 = t0 + durMin * 60000;
    Api.store.meteo.forEach(function (m) {
      var t = m.wall.getTime();
      if (t >= t0 && t < t1 && m[field] != null) { s += m[field]; n++; }
    });
    return n ? s / n : null;
  }

  // today's buckets -> column objects (30-min resolution)
  function columnsToday(stationId) {
    var fecha = Util.todayMx();
    var buckets = Api.store.stations[stationId].historial[fecha] || [];
    var now = nowWall();
    var cols = [];
    buckets.forEach(function (b) {
      if (!b.wall || b.wall > now) return;
      var isHour = /:00$/.test(b.hora);
      cols.push({
        label: isHour ? (b.hora.slice(0, 2) + 'h') : b.hora,
        cls: isHour ? 'h_hr' : 'h_pt',
        v: b.n > 0 ? b.v : null,
        vmax: b.n > 0 ? b.vmax : null,
        dir: b.n > 0 ? b.dir : null,
        hum: meteoAvg('hum', b.wall, 30),
        temp: meteoAvg('temp', b.wall, 30)
      });
    });
    return cols;
  }

  // previous days -> hourly columns; the 00h column is labeled with the weekday
  function columnsPrev(stationId) {
    var cols = [];
    for (var off = -CONFIG.tableDays; off <= -1; off++) {
      var fecha = Util.todayMx(off);
      var buckets = Api.store.stations[stationId].historial[fecha] || [];
      var byHour = {};
      buckets.forEach(function (b) {
        if (!b.wall) return;
        var h = b.hora.slice(0, 2);
        (byHour[h] = byHour[h] || []).push(b);
      });
      var dayName = DAY_NAMES[Util.parseMxWall(fecha + ' 12:00:00').getDay()];
      for (var h = 0; h < 24; h++) {
        var hh = Util.pad2(h);
        var list = (byHour[hh] || []).filter(function (b) { return b.n > 0; });
        var wsum = 0, vsum = 0, vmax = null, dirs = [], ws = [];
        list.forEach(function (b) {
          if (b.v != null) { vsum += b.v * b.n; wsum += b.n; }
          if (b.vmax != null && (vmax == null || b.vmax > vmax)) vmax = b.vmax;
          if (b.dir != null) { dirs.push(b.dir); ws.push(b.n); }
        });
        var start = Util.parseMxWall(fecha + ' ' + hh + ':00:00');
        cols.push({
          label: h === 0 ? dayName : hh + 'h',
          cls: h === 0 ? 'h_day' : 'h_pt',
          v: wsum ? vsum / wsum : null,
          vmax: vmax,
          dir: dirs.length ? Util.circularMean(dirs, ws) : null,
          hum: meteoAvg('hum', start, 60),
          temp: meteoAvg('temp', start, 60)
        });
      }
    }
    return cols;
  }

  function td(content, attrs) { return '<td' + (attrs || '') + '>' + content + '</td>'; }

  function buildTable(cols) {
    if (!cols.length) return '<div class="nodata">No data available.</div>';
    var hasHum = cols.some(function (c) { return c.hum != null; });
    var hasTemp = cols.some(function (c) { return c.temp != null; });

    var rows = [];
    rows.push('<tr class="t_time"><td class="rowlab">Time</td>' + cols.map(function (c) {
      return td(c.label, ' class="' + c.cls + '"');
    }).join('') + '</tr>');

    rows.push('<tr><td class="rowlab">Speed</td>' + cols.map(function (c) {
      if (c.v == null) return td('-');
      return td(Math.round(c.v), ' style="background:' + Colors.speedToColor(c.v) + '"');
    }).join('') + '</tr>');

    rows.push('<tr><td class="rowlab">Gust <span class="u">(km/h)</span></td>' + cols.map(function (c) {
      if (c.vmax == null) return td('-');
      return td(Math.round(c.vmax), ' style="background:' + Colors.speedToColor(c.vmax) + '"');
    }).join('') + '</tr>');

    rows.push('<tr><td class="rowlab">Direction</td>' + cols.map(function (c) {
      if (c.dir == null) return td('-', ' class="w_dir"');
      return td('<span class="arr" style="transform:rotate(' + Math.round(c.dir) + 'deg)">' +
        ARROW_SVG + '</span>', ' class="w_dir"');
    }).join('') + '</tr>');

    rows.push('<tr class="t_dirdeg"><td class="rowlab">Direction<br><span class="u">Deg.</span></td>' +
      cols.map(function (c) {
        if (c.dir == null) return td('-');
        return td(Util.degToCompass(c.dir) + '<br>' + Math.round(c.dir) + '°');
      }).join('') + '</tr>');

    if (hasHum) {
      rows.push('<tr><td class="rowlab">Humidity <span class="u">(%)</span></td>' + cols.map(function (c) {
        if (c.hum == null) return td('-');
        return td(Util.fmt(c.hum, 1), ' style="background:' + Colors.humidityColor(c.hum) + '"');
      }).join('') + '</tr>');
    }
    if (hasTemp) {
      rows.push('<tr><td class="rowlab">Temp. <span class="u">(°C)</span></td>' + cols.map(function (c) {
        if (c.temp == null) return td('-');
        return td(Util.fmt(c.temp, 1), ' style="background:' + Colors.tempToColor(c.temp) + '"');
      }).join('') + '</tr>');
    }

    return '<div class="tscroll"><table class="avg" cellspacing="0">' + rows.join('') + '</table></div>';
  }

  function render(stationId) {
    var elToday = document.getElementById('table_today');
    var elPrev = document.getElementById('table_prev');
    if (elToday) elToday.innerHTML = buildTable(columnsToday(stationId));
    if (elPrev) elPrev.innerHTML = buildTable(columnsPrev(stationId));
    var upd = document.getElementById('avg_updated');
    if (upd) upd.textContent = 'updated: ' + Util.nowMxClock() + ' (MX)';
    // show newest columns first in view: scroll each wrapper fully right
    document.querySelectorAll('#table_today .tscroll, #table_prev .tscroll').forEach(function (w) {
      w.scrollLeft = w.scrollWidth;
    });
  }

  return { render: render };
})();
