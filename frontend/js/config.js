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
      place: 'Paragliding takeoff, San Bernardino Chalchihuapan, Puebla, Mexico',
      // Takeoff per paraglidingearth.com ("Chalchihuapan - Puebla")
      lat: 18.9632, lon: -98.3421,
      altitude: 2336,           // m AMSL (takeoff)
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
      place: 'Chipilo de Francisco Javier Mina (village center), Puebla, Mexico',
      // Village center per Wikipedia (19°00'22"N 98°19'50"W)
      lat: 19.0061, lon: -98.3306,
      altitude: 2150,
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
  slowPollMs: 5 * 60000,   // today's historial (+ LoRa when that tab is open)
  windLimit: 200,          // full fetch: initial load and catch-up after tab sleep
  windPollLimit: 12,       // incremental 5 s poll (~1 min of samples, merged by id)
  meteoLimit: 500,         // full fetch (server cap); initial load and catch-up
  meteoPollLimit: 2,       // incremental 5 s poll, merged by id
  rawKeep: 600,            // wind samples kept in memory per station (~50 min)
  meteoKeep: 600,          // meteo rows kept in memory (~5-10 h, feeds the graphs)
  catchUpAfterMs: 60000,   // poll gap that triggers a full refetch (browser throttled the tab)
  loraLimit: 30,

  graphDays: 6,            // today + 5 previous days, like Holfuy's ~6-day span
  tableDays: 2,            // previous days shown in the second averages table

  gustWindowMin: 10,       // "Wind now" gust = max over this many minutes
  avgWindowMin: 15,        // "Wind avg. 15min"
  staleAfterSec: 300       // mark station data red after this
};
