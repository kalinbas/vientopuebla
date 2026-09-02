/* Canvas wind dial — port of holfuy.com js/wind_kok.js (station-page mode).
   Geometry, fonts and colors kept identical; sectors come from CONFIG. */
var Dial = (function () {

  var RAD = 300, CANSIZE = RAD + 40;

  function drawSector(cx, center, radius, fromDeg, toDeg, fillStyle) {
    cx.fillStyle = fillStyle;
    cx.beginPath();
    cx.moveTo(center, center);
    if (fromDeg > toDeg) { // wraps through north
      cx.arc(center, center, radius, (fromDeg - 90) * Math.PI / 180, (360 - 90) * Math.PI / 180, false);
      cx.lineTo(center, center);
      cx.arc(center, center, radius, (0 - 90) * Math.PI / 180, (toDeg - 90) * Math.PI / 180, false);
    } else {
      cx.arc(center, center, radius, (fromDeg - 90) * Math.PI / 180, (toDeg - 90) * Math.PI / 180, false);
    }
    cx.closePath();
    cx.fill();
  }

  // data: { speed, dir, temp, sectors } — any field may be null
  function draw(canvas, data) {
    var cv = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!cv || !cv.getContext) return;
    var cx = cv.getContext('2d');
    cv.width = cv.height = CANSIZE;

    var center = CANSIZE / 2;
    var radius = RAD / 2 - 5;

    cx.clearRect(0, 0, CANSIZE, CANSIZE);

    // face
    cx.fillStyle = 'rgba(55,133,144,0.5)';
    cx.lineWidth = 8;
    cx.strokeStyle = 'black';
    cx.beginPath();
    cx.arc(center, center, radius, 0, Math.PI * 2, true);
    cx.closePath();
    cx.fill();
    cx.stroke();

    // flyable-direction sectors (yellow = allowed, green = optimal)
    var sec = data && data.sectors;
    if (sec) {
      (sec.takeoff || []).forEach(function (s) {
        drawSector(cx, center, radius * 0.98, s.from, s.to, 'yellow');
      });
      (sec.optimal || []).forEach(function (s) {
        drawSector(cx, center, radius * 0.98, s.from, s.to, 'green');
      });
    }

    // center dot
    cx.fillStyle = 'rgba(0,0,0,0.5)';
    cx.beginPath();
    cx.arc(center, center, 15, 0, Math.PI * 2, true);
    cx.closePath();
    cx.fill();

    // 16 rim dots
    var theta = 0, x, y;
    cx.lineWidth = 1;
    cx.fillStyle = 'white';
    for (var i = 0; i < 16; i++) {
      theta += 22.5 * Math.PI / 180;
      x = center + radius * Math.cos(theta);
      y = center + radius * Math.sin(theta);
      cx.beginPath();
      cx.arc(x, y, 2, 0, Math.PI * 2, true);
      cx.closePath();
      cx.fill();
    }

    // W N E S letters
    var letters = ['S', 'W', 'N', 'E'];
    theta = 0;
    cx.lineWidth = 3;
    cx.strokeStyle = 'black';
    cx.fillStyle = 'yellow';
    cx.textAlign = 'center';
    cx.font = 'bold 40px Calibri, Arial, sans-serif';
    for (i = 0; i < 4; i++) {
      theta += 90 * Math.PI / 180;
      x = center + radius * 0.98 * Math.cos(theta);
      y = center + radius * Math.sin(theta);
      cx.fillText(letters[i], x, y + 10);
      cx.strokeText(letters[i], x, y + 10);
    }

    // temperature bottom-left
    if (data && data.temp != null && !isNaN(data.temp)) {
      cx.textAlign = 'left';
      cx.font = 'bold 46px Calibri, Arial, sans-serif';
      cx.fillStyle = Colors.tempToColor(data.temp);
      var tempStr = Util.fmt(data.temp, data.temp % 1 ? 1 : 0) + '°C';
      cx.lineWidth = 1.5;
      cx.strokeStyle = 'black';
      cx.fillText(tempStr, 0, center * 2 - 2);
      cx.strokeText(tempStr, 0, center * 2 - 2);
    }

    // needle + speed number
    var hasWind = data && data.speed != null && !isNaN(data.speed) && data.dir != null;
    cx.textAlign = 'center';
    if (hasWind) {
      var curv = RAD / 2;
      var size1 = curv * 0.50, size2 = curv * 0.90, size3 = curv * 0.80;
      theta = data.dir * Math.PI / 180;
      var x1 = center + size1 * Math.cos(theta - Math.PI / 2);
      var y1 = center + size1 * Math.sin(theta - Math.PI / 2);
      var x2 = center + size2 * Math.cos(theta - Math.PI * (1 / 2 + 1 / 15));
      var y2 = center + size2 * Math.sin(theta - Math.PI * (1 / 2 + 1 / 15));
      var x3 = center + size2 * Math.cos(theta - Math.PI * (1 / 2 - 1 / 15));
      var y3 = center + size2 * Math.sin(theta - Math.PI * (1 / 2 - 1 / 15));
      var x4 = center + size3 * Math.cos(theta - Math.PI / 2);
      var y4 = center + size3 * Math.sin(theta - Math.PI / 2);

      cx.lineWidth = 3.0;
      cx.strokeStyle = 'black';
      cx.fillStyle = Colors.speedToColor(data.speed);
      cx.lineCap = 'round';
      cx.beginPath();
      cx.moveTo(x1, y1);
      cx.lineTo(x2, y2);
      cx.lineTo(x4, y4);
      cx.lineTo(x3, y3);
      cx.closePath();
      cx.fill();
      cx.stroke();

      cx.font = 'bold 80px Calibri, Arial, sans-serif';
      cx.fillText(String(Math.round(data.speed)), center, center + 100);
      cx.strokeText(String(Math.round(data.speed)), center, center + 100);
    } else {
      cx.font = 'bold 60px Calibri, Arial, sans-serif';
      cx.fillStyle = '#ddd';
      cx.lineWidth = 2;
      cx.strokeStyle = 'black';
      cx.fillText('-', center, center + 90);
      cx.strokeText('-', center, center + 90);
    }
  }

  return { draw: draw };
})();
