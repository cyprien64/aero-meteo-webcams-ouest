/* Service worker : application utilisable hors ligne (tablette) + dernier briefing consultable sans réseau. */
const VERSION = 'aww-v43';
const SHELL = [
  './', 'map.html', 'map.css', 'map.js', 'prepavol.js', 'extras.js', 'log.js', 'config.js', 'app.webmanifest',
  'lib/leaflet/leaflet.js', 'lib/leaflet/leaflet.css', 'lib/cluster/leaflet.markercluster.js', 'lib/cluster/leaflet.featuregroup.subgroup.js', 'lib/cluster/MarkerCluster.css', 'lib/pdf/jspdf.umd.min.js', 'lib/pdf/jspdf.plugin.autotable.min.js',
  'lib/pdf/pdf-lib.min.js', 'lib/pdf/jszip.min.js', 'data/basemap.js', 'data/sources.js', 'data/france.js', 'data/aircraft.js',
  'data/vfr_points.json', 'data/fees.json', 'data/landmarks.json', 'data/template/log_nav_acb.xlsx', 'data/template/log_meta.json',
  'icons/icon48.png', 'icons/icon192.png',
];
const LIVE = ['metar.json', 'taf.json', 'notam.json', 'supaip.json', 'zones.json', 'vac.json', 'escale.json', 'vfr_points.json', 'airspaces.json', 'fees_club.json', 'pratique_club.json', 'osm_near.json', 'vigilance.json', 'special.json'].map((f) => `data/live/${f}`);

// cache: 'reload' : sinon le cache HTTP (10 min sur GitHub Pages) remplit la nouvelle version avec d'anciens fichiers
const fresh = (u) => new Request(u, { cache: 'reload' });
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.concat(LIVE).map(fresh)).catch(() => c.addAll(SHELL.map(fresh)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('aww-v') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // API externes : réseau direct
  const isData = url.pathname.includes('/data/');
  if (isData) {   // données : réseau d'abord, cache en secours (hors ligne)
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && !url.pathname.includes('/data/vac/')) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(url.pathname.replace(/^.*?\/data\//, 'data/'), cp)); }   // VAC : déjà gardées par la page (aww-offline-vac)
      return r;
    }).catch(() => caches.match(url.pathname.replace(/^.*?\/data\//, 'data/'), { ignoreSearch: true })));
    return;
  }
  // application : cache d'abord, mise à jour en arrière-plan
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
