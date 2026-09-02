/* Dir.Stat. tab: 16-sector wind rose of the recent raw samples */
var Rose = (function () {

  function draw(canvasId, stationId) {
    var cv = document.getElementById(canvasId);
    if (!cv) return;
    var cx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var center = { x: W / 2, y: H / 2 };
    var R = Math.min(W, H) / 2 - 22;

    cx.clearRect(0, 0, W, H);

    var raw = Api.store.stations[stationId].raw;
    var last = raw.length ? raw[raw.length - 1].epoch : 0;
    var win = raw.filter(function (s) { return s.epoch > last - CONFIG.avgWindowMin * 60000; });

    // rings
    cx.strokeStyle = '#9db4bd';
    cx.lineWidth = 1;
    [1 / 3, 2 / 3, 1].forEach(function (f) {
      cx.beginPath();
      cx.arc(center.x, center.y, R * f, 0, Math.PI * 2);
      cx.stroke();
    });
    // cross lines
    cx.beginPath();
    cx.moveTo(center.x - R, center.y); cx.lineTo(center.x + R, center.y);
    cx.moveTo(center.x, center.y - R); cx.lineTo(center.x, center.y + R);
    cx.stroke();

    // sector stats
    var counts = [], speeds = [];
    for (var i = 0; i < 16; i++) { counts.push(0); speeds.push(0); }
    win.forEach(function (s) {
      if (s.d == null || isNaN(s.d)) return;
      var idx = Math.round((((s.d % 360) + 360) % 360) / 22.5) % 16;
      counts[idx]++; speeds[idx] += s.v;
    });
    var maxC = Math.max.apply(null, counts);

    if (maxC > 0) {
      for (i = 0; i < 16; i++) {
        if (!counts[i]) continue;
        var frac = counts[i] / maxC;
        var avgV = speeds[i] / counts[i];
        var a0 = (i * 22.5 - 11.25 - 90) * Math.PI / 180;
        var a1 = (i * 22.5 + 11.25 - 90) * Math.PI / 180;
        cx.fillStyle = Colors.speedToColor(avgV);
        cx.strokeStyle = '#333';
        cx.lineWidth = 1;
        cx.beginPath();
        cx.moveTo(center.x, center.y);
        cx.arc(center.x, center.y, R * frac, a0, a1, false);
        cx.closePath();
        cx.fill();
        cx.stroke();
      }
    } else {
      cx.fillStyle = '#667';
      cx.font = '12px Verdana, sans-serif';
      cx.textAlign = 'center';
      cx.fillText('No recent samples', center.x, center.y - 6);
    }

    // labels
    cx.fillStyle = '#123';
    cx.font = 'bold 13px Verdana, sans-serif';
    cx.textAlign = 'center';
    cx.fillText('N', center.x, center.y - R - 8);
    cx.fillText('S', center.x, center.y + R + 16);
    cx.textAlign = 'left';
    cx.fillText('E', center.x + R + 5, center.y + 5);
    cx.textAlign = 'right';
    cx.fillText('W', center.x - R - 5, center.y + 5);
  }

  return { draw: draw };
})();
