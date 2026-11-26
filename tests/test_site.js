#!/usr/bin/env node
/* Test de chargement du site dans un faux navigateur (Node, sans dépendance).
 * Charge les scripts de map.html dans l'ordre (sauf Leaflet, remplacé par un faux objet) et exécute
 * leurs console.assert. Échoue si un script plante au chargement ou si un assert est faux.
 * Usage : node tests/test_site.js   (lancé par le workflow avant publication) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const failures = [], errors = [];
let asserts = 0;

// objet « fourre-tout » : toute propriété, tout appel, tout new renvoie encore un faux objet
const anything = () => {
  const f = function () { return p; };
  const p = new Proxy(f, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? function* () {} : k === 'then' ? undefined
      : k === 'length' ? 0 : k === 'value' || k === 'textContent' || k === 'innerHTML' ? '' : k === 'checked' ? false
      : k === 'dataset' || k === 'style' ? {} : k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => false } : p),
    apply: () => p, construct: () => p, set: () => true, has: () => true,
  });
  return p;
};
const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() }; };
const el = () => anything();
const document = {
  getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], getElementsByTagName: () => [],
  createElement: () => el(), createElementNS: () => el(), addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  body: el(), head: el(), documentElement: el(), hidden: false, readyState: 'complete', cookie: '',
};
const win = {
  document, console: { ...console, assert: (c, ...m) => { asserts++; if (!c) failures.push(m.map(String).join(' ')); }, warn() {}, info() {}, log() {}, debug() {} },
  localStorage: storage(), sessionStorage: storage(), location: { href: 'http://localhost/map.html', hash: '', search: '', pathname: '/map.html', origin: 'http://localhost', protocol: 'http:', reload() {} },
  history: { replaceState() {}, pushState() {} }, navigator: { userAgent: 'node', onLine: true, language: 'fr-FR', serviceWorker: { controller: null, register: () => new Promise(() => {}), addEventListener() {}, getRegistrations: async () => [] }, geolocation: undefined, clipboard: { writeText: async () => {} } },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, requestIdleCallback: () => 0,
  fetch: () => new Promise(() => {}), addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  getComputedStyle: () => ({}), Event: function () {}, performance, Intl, Date, Math, JSON, Promise, URL, Blob: function () {}, Image: function () { return el(); },
  innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1, caches: undefined, Notification: undefined,
  // L.geoJSON appelle tout de suite son style (comme Leaflet) : une const utilisée avant sa déclaration fait planter le test
  L: (() => { const L0 = anything(); return new Proxy(L0, { get: (t, k) => (k === 'geoJSON' ? (d, o) => { if (o && typeof o.style === 'function') o.style({ properties: { k: 'dep' } }); return anything(); } : L0[k]) }); })(), atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
};
win.window = win; win.self = win; win.globalThis = win;
const ctx = vm.createContext(win);
const html = fs.readFileSync(path.join(ROOT, 'map.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^lib\//.test(s) && !/^https?:/.test(s));
for (const s of scripts) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s }); } catch (e) { errors.push(`${s} : plante au chargement : ${e.message}`); }
}
process.on('unhandledRejection', () => {});   // promesses des données en direct (fetch factice)
setImmediate(() => setImmediate(() => {
  console.log(`Scripts chargés : ${scripts.join(', ')}\nconsole.assert exécutés : ${asserts}`);
  if (asserts < 20) errors.push(`seulement ${asserts} console.assert exécutés : un module s'est sans doute arrêté avant la fin`);
  // sw.js : chaque fichier de SHELL doit exister, sinon l'installation hors ligne échoue entièrement
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), shell = ((sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '');
  [...shell.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== './').forEach((f) => { if (!fs.existsSync(path.join(ROOT, f))) errors.push(`sw.js : fichier ${f} de SHELL absent`); });
  if (failures.length) console.log(`${failures.length} console.assert en échec :\n - ${failures.join('\n - ')}`);
  if (errors.length) console.log(`${errors.length} erreur(s) :\n - ${errors.join('\n - ')}`);
  if (failures.length || errors.length) { console.log('ÉCHEC du test de chargement.'); process.exit(1); }
  console.log('OK : tous les scripts se chargent, aucun console.assert en échec.');
}));
