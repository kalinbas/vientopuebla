/* Time, geometry and meteo helpers */
var Util = (function () {

  // "YYYY-MM-DD HH:MM:SS" (Mexico City wall clock) -> real epoch ms
  function parseMxEpoch(ts) {
    if (!ts) return NaN;
    return Date.parse(ts.replace(' ', 'T') + CONFIG.utcOffset);
  }

  // Same string -> Date whose *local* fields equal the Mexico City wall clock.
  // Used for dygraphs / tables so every viewer sees station-local times.
  function parseMxWall(ts) {
    if (!ts) return null;
    var m = ts.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }

  // Current date/time as Mexico City wall clock
  function nowMxParts() {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    var p = {};
    fmt.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    if (p.hour === '24') p.hour = '00';
    return p;
  }
  function todayMx(offsetDays) {
    var p = nowMxParts();
    var d = new Date(+p.year, +p.month - 1, +p.day);
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function nowMxClock() {
    var p = nowMxParts();
    return p.hour + ':' + p.minute + ':' + p.second;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // seconds -> "7 sec. ago" / "3 min. ago" / "2 h ago"
  function agoText(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    if (sec < 100) return '<b>' + Math.round(sec) + '</b> sec. ago';
    if (sec < 5400) return '<b>' + Math.round(sec / 60) + '</b> min. ago';
    if (sec < 172800) return '<b>' + (sec / 3600).toFixed(1) + '</b> h ago';
    return '<b>' + Math.round(sec / 86400) + '</b> days ago';
  }

  var DIRS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function degToCompass(deg) {
    if (deg == null || isNaN(deg)) return '-';
    return DIRS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  }

  // Circular mean of directions (deg), optionally weighted
  function circularMean(degs, weights) {
    var x = 0, y = 0;
    for (var i = 0; i < degs.length; i++) {
      var d = degs[i];
      if (d == null || isNaN(d)) continue;
      var w = weights ? (weights[i] || 0) : 1;
      x += w * Math.cos(d * Math.PI / 180);
      y += w * Math.sin(d * Math.PI / 180);
    }
    if (x === 0 && y === 0) return null;
    var a = Math.atan2(y, x) * 180 / Math.PI;
    return (a + 360) % 360;
  }

  // Circular spread 0..1 (1-R). ~0 = stable direction
  function circularSpread(degs) {
    var x = 0, y = 0, n = 0;
    for (var i = 0; i < degs.length; i++) {
      var d = degs[i];
      if (d == null || isNaN(d)) continue;
      x += Math.cos(d * Math.PI / 180); y += Math.sin(d * Math.PI / 180); n++;
    }
    if (!n) return null;
    return 1 - Math.sqrt(x * x + y * y) / n;
  }

  // Station pressure (Pa) -> sea-level reduced pressure (hPa)
  function seaLevelPressure(pa, altitudeM, tempC) {
    if (pa == null || isNaN(pa)) return null;
    var p = pa / 100;
    var t = (tempC == null || isNaN(tempC)) ? 15 : tempC;
    return p * Math.pow(1 - (0.0065 * altitudeM) / (t + 0.0065 * altitudeM + 273.15), -5.257);
  }

  // Magnus dew point fallback
  function dewPoint(tempC, rh) {
    if (tempC == null || rh == null || isNaN(tempC) || isNaN(rh) || rh <= 0) return null;
    var g = Math.log(rh / 100) + (17.62 * tempC) / (243.12 + tempC);
    return 243.12 * g / (17.62 - g);
  }

  // NOAA sunrise/sunset, returned as "HH:MM" strings in Mexico City time
  function sunTimes(lat, lon, dateStr) {
    var m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    var y = +m[1], mo = +m[2], d = +m[3];
    var N1 = Math.floor(275 * mo / 9), N2 = Math.floor((mo + 9) / 12);
    var N3 = 1 + Math.floor((y - 4 * Math.floor(y / 4) + 2) / 3);
    var N = N1 - N2 * N3 + d - 30;
    var lngHour = lon / 15;
    var tzOff = -6; // fixed Mexico City offset

    function calc(rising) {
      var t = N + ((rising ? 6 : 18) - lngHour) / 24;
      var M = (0.9856 * t) - 3.289;
      var L = M + 1.916 * Math.sin(M * Math.PI / 180) + 0.020 * Math.sin(2 * M * Math.PI / 180) + 282.634;
      L = ((L % 360) + 360) % 360;
      var RA = Math.atan(0.91764 * Math.tan(L * Math.PI / 180)) * 180 / Math.PI;
      RA = ((RA % 360) + 360) % 360;
      RA += (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);
      RA /= 15;
      var sinDec = 0.39782 * Math.sin(L * Math.PI / 180);
      var cosDec = Math.cos(Math.asin(sinDec));
      var cosH = (Math.cos(90.833 * Math.PI / 180) - sinDec * Math.sin(lat * Math.PI / 180)) /
        (cosDec * Math.cos(lat * Math.PI / 180));
      if (cosH > 1 || cosH < -1) return null;
      var H = rising ? 360 - Math.acos(cosH) * 180 / Math.PI : Math.acos(cosH) * 180 / Math.PI;
      H /= 15;
      var T = H + RA - 0.06571 * t - 6.622;
      var UT = ((T - lngHour) % 24 + 24) % 24;
      var localT = ((UT + tzOff) % 24 + 24) % 24;
      var hh = Math.floor(localT), mm = Math.round((localT - hh) * 60);
      if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
      return pad2(hh) + ':' + pad2(mm);
    }
    return { sunrise: calc(true), sunset: calc(false) };
  }

  function fmt(v, dec) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toFixed(dec == null ? 1 : dec);
  }

  return {
    parseMxEpoch: parseMxEpoch, parseMxWall: parseMxWall,
    todayMx: todayMx, nowMxClock: nowMxClock, nowMxParts: nowMxParts,
    agoText: agoText, degToCompass: degToCompass,
    circularMean: circularMean, circularSpread: circularSpread,
    seaLevelPressure: seaLevelPressure, dewPoint: dewPoint,
    sunTimes: sunTimes, fmt: fmt, pad2: pad2
  };
})();
