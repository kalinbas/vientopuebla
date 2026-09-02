/* Value -> color scales, ported from holfuy.com js/main.js (v4.6).
   speedToColor's <=5 branch is implemented as the intended linear white->cyan ramp
   (the original has an integer-division bug there); everything else is verbatim. */
var Colors = (function () {

  function speedToColor(speed) {
    if (speed == null || isNaN(speed)) return 'white';
    if (speed <= 0) return 'white';
    if (speed <= 5) return 'rgb(' + Math.round(255 * (5 - speed) / 5) + ',255,255)';
    if (speed <= 15) return 'rgb(0,255,' + Math.round(255 - (255 * (speed - 5)) / 10) + ')';
    if (speed <= 25) return 'rgb(' + Math.round((255 * (speed - 15)) / 10) + ',255,0)';
    if (speed <= 50) return 'rgb(255,' + Math.round(255 - (255 * (speed - 25)) / 25) + ',0)';
    if (speed <= 100) return 'rgb(255,0,' + Math.round((255 * (speed - 50)) / 50) + ')';
    return 'pink';
  }

  function tempToColor(temp) {
    if (temp == null || isNaN(temp)) return 'white';
    var t = temp * 10, k;
    if (t === 0) return 'white';
    if (t <= -200) return 'blue';
    if (t <= 0) {
      k = Math.round((255 / 200) * (200 + t) / 1.1);
      return 'rgb(' + k + ',' + k + ',255)';
    }
    if (t <= 100) return 'rgb(255,255,' + Math.round(51 + (204 * (100 - t)) / 100) + ')';
    if (t <= 350) return 'rgb(255,' + Math.round(255 - (255 * (t - 100)) / 250) + ',51)';
    if (t <= 1000) return 'rgb(255,51,' + Math.round(Math.max(0, (255 * (t - 300)) / 200)) + ')';
    return 'pink';
  }

  // Verified against holfuy table cells: white -> #8080FF over 0..100 %
  function humidityColor(h) {
    if (h == null || isNaN(h)) return 'white';
    var k = Math.round(255 - 127 * Math.min(100, Math.max(0, h)) / 100);
    return 'rgb(' + k + ',' + k + ',255)';
  }

  return { speedToColor: speedToColor, tempToColor: tempToColor, humidityColor: humidityColor };
})();
