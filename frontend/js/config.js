/* Global configuration for the Puebla wind page */
var CONFIG = {
  apiBase: 'https://viento.saboresgaleazzi.com/',

  // API timestamps are America/Mexico_City wall-clock (fixed UTC-6, no DST since 2022)
  utcOffset: '-06:00',
  timeZone: 'America/Mexico_City',

  // First station = default view
  stations: [
    {
      id: 2,
      slug: 'chalchihuapan',
      name: 'Chalchihuapan',
      place: 'San Bernardino Chalchihuapan, Puebla, Mexico',
      // Coordinates are approximate — adjust to the real sensor location if known
      lat: 19.166, lon: -98.353,
      altitude: 2145,           // m AMSL (derived: cloud base 725 m AGL shown as 2870 m AMSL)
      // Flyable wind-direction sectors, degrees. null = don't draw.
      // Example: { takeoff: [{ from: 340, to: 40 }], optimal: [{ from: 350, to: 20 }] }
      sectors: null,
      links: [
        { label: 'Original live panel', url: 'https://viento.saboresgaleazzi.com/' },
        { label: 'Historial climático', url: 'https://viento.saboresgaleazzi.com/historial_climatico.php?estacion=2' }
      ]
    },
    {
      id: 1,
      slug: 'chipilo',
      name: 'Chipilo',
      place: 'Chipilo, Puebla, Mexico',
      lat: 19.226, lon: -98.341,
      altitude: 2145,
      sectors: null,
      links: [
        { label: 'Original live panel', url: 'https://viento.saboresgaleazzi.com/' },
        { label: 'Historial climático', url: 'https://viento.saboresgaleazzi.com/historial_climatico.php?estacion=1' }
      ]
    }
  ],

  // Meteo sensor (temperature/humidity/pressure/battery) is shared between stations
  meteoAltitude: 2145,

  livePollMs: 5000,        // wind + latest meteo poll (matches the original panel)
  slowPollMs: 5 * 60000,   // today's historial + full meteo history + LoRa refresh
  windLimit: 200,          // raw sample fetch size (server keeps only a recent window)
  meteoLimit: 500,         // server cap
  loraLimit: 30,

  graphDays: 6,            // today + 5 previous days, like Holfuy's ~6-day span
  tableDays: 2,            // previous days shown in the second averages table

  gustWindowMin: 10,       // "Wind now" gust = max over this many minutes
  avgWindowMin: 15,        // "Wind avg. 15min"
  staleAfterSec: 300       // mark station data red after this
};
