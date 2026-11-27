/* Service worker : application utilisable hors ligne (tablette) + dernier briefing consultable sans réseau. */
const VERSION = 'aww-v58';
const SHELL = [
  './', 'map.html', 'map.css', 'map.js', 'prepavol.js', 'extras.js', 'theme.js', 'log.js', 'config.js', 'app.webmanifest',
  'lib/leaflet/leaflet.js', 'lib/leaflet/leaflet.css', 'lib/cluster/leaflet.markercluster.js', 'lib/cluster/leaflet.featuregroup.subgroup.js', 'lib/cluster/MarkerCluster.css', 'lib/pdf/jspdf.umd.min.js', 'lib/pdf/jspdf.plugin.autotable.min.js',
  'lib/pdf/pdf-lib.min.js', 'lib/pdf/jszip.min.js', 'data/basemap.js', 'data/sources.js', 'data/france.js', 'data/aircraft.js',
  'data/vfr_points.json', 'data/fees.json', 'data/landmarks.json', 'data/template/log_nav_acb.xlsx', 'data/template/log_meta.json',
  'icons/icon48.png', 'icons/icon192.png', 'icons/signature.jpg',
];
// vac.json (2 Mo) n'est pas préchargé : mis en cache à la première préparation de vol
const LIVE = ['metar.json', 'taf.json', 'notam.json', 'supaip.json', 'zones.json', 'escale.json', 'vfr_points.json', 'airspaces.json', 'fees_club.json', 'pratique_club.json', 'osm_near.json', 'vigilance.json', 'special.json'].map((f) => `data/live/${f}`);

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
  // carte OACI gardée par « Garder la carte OACI du trajet » (prepavol.js) : servie sans réseau
  if (e.request.method === 'GET' && url.hostname === 'data.geopf.fr' && /GetTile/i.test(url.search)) {
    e.respondWith(caches.open('aww-tiles').then((c) => c.match(e.request.url)).then((h) => h || fetch(e.request)));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // API externes : réseau direct
  // données en direct (data/live) et VAC : réseau d'abord ; si le réseau traîne plus de 8 s (mauvaise couverture),
  // la dernière copie s'affiche tout de suite et la réponse du réseau met le cache à jour pour la prochaine fois
  if (/\/data\/(live|vac)\//.test(url.pathname)) {
    const key = url.pathname.replace(/^.*?\/data\//, 'data/'), cached = () => caches.match(key, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => {
      if (!r.ok) return cached().then((h) => h || r);   // erreur passagère du serveur (503 pendant une publication) : copie locale si on en a une
      if (!url.pathname.includes('/data/vac/')) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(key, cp)); }   // VAC : déjà gardées par la page (aww-offline-vac)
      return r;
    });
    const slow = new Promise((ok) => setTimeout(ok, 8000)).then(() => cached()).then((h) => h || net);
    e.respondWith(Promise.race([net, slow]).catch(() => cached()));
    return;
  }
  // fichiers fixes de data/ (sources, fond de carte, repères…) et application : cache d'abord, mise à jour en arrière-plan
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
