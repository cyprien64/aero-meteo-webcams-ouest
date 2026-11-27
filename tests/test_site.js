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
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^lib\//.test(s) && !/^https?:/.test(s)).concat(['data/aircraft.js', 'prepavol.js', 'prep-docs.js']);   // chargés à la demande par extras.js (premier clic sur « Préparer un vol »)
for (const s of scripts) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), ctx, { filename: s }); } catch (e) { errors.push(`${s} : plante au chargement : ${e.message}`); }
}
process.on('unhandledRejection', () => {});   // promesses des données en direct (fetch factice)
setImmediate(() => setImmediate(() => {
  console.log(`Scripts chargés : ${scripts.join(', ')}\nconsole.assert exécutés : ${asserts}`);
  if (asserts < 20) errors.push(`seulement ${asserts} console.assert exécutés : un module s'est sans doute arrêté avant la fin`);
  if (!win.AWW_PREP || !win.AWW.prep || typeof win.AWW.prep.buildPdf !== 'function') errors.push('préparation de vol incomplète : prep-docs.js ne s\'est pas branché sur prepavol.js (AWW.prep / AWW_PREP)');
  // vol de référence Pau → Biarritz, F-HAFF, croisière normale 100 kt / 15 L/h, vent 270° / 20 kt, dégagement Pau, réserve 30 min.
  // Valeurs attendues calculées à part (formules du triangle des vitesses) ; distance réelle ≈ 48 NM, route ≈ 277°.
  try {
    const C = win.AWW && win.AWW.prepCalc, T = win.AIRCRAFT_TYPES['DR400-ROTAX'], ac = win.AIRCRAFT.find((x) => x.reg === 'F-HAFF');
    if (!C) throw new Error('AWW.prepCalc absent');
    const PAU = [43.38, -0.4186], BIA = [43.4684, -1.5232];
    const f = { T, ac, tas: 100, ff: 15, ft: 3500, res: 30, alt: 'LFBP', fuel: 80, aux: 0, m1: 80, m2: 75, m3: 0, m4: 10 };
    const climb = C.climbExtra(T, 3500, 616, 100, 15);
    const p = C.legsPlan({ f, ids: ['LFBP', 'LFBZ'], pts: [PAU, BIA], winds: [{ dir: 270, spd: 20 }], legFt: null, depT: new Date('2026-06-21T08:00:00Z'), varDeg: 1, safe: null, climb, altPt: PAU });
    const lg = p.legs[0], mb = C.massBalance(f), near = (x, y, e) => Math.abs(x - y) <= e;
    const checks = [
      ['montée DR400 (règle du log : +2 min, +4 L + 2 L de roulage)', climb.min === 2 && climb.fuel === 6],
      ['distance 48,5 NM', near(lg.dist, 48.46, 0.05)],
      ['route vraie 277°', near(lg.tc, 276.7, 0.2)],
      ['dérive -1,3° (cap vrai 275°)', near(lg.wca, -1.33, 0.05) && near(lg.th, 275.3, 0.2)],
      ['route magnétique = vraie - déclinaison', near(lg.tm, 275.7, 0.2)],
      ['vitesse sol 80 kt', near(lg.gs, 80.1, 0.1)],
      ['durée 36 min + 2 de montée', lg.min === 38 && p.totMin === 38],
      ['arrivée 08:38Z', p.eta.toISOString() === '2026-06-21T08:38:00.000Z'],
      ['carburant étape 9 + 6 L', p.totFuel === 15],
      ['dégagement retour Pau 31 min / 10 L', p.altLeg && p.altLeg.min === 31 && p.altLeg.fuel === 10],
      ['réserve finale 30 min = 8 L', p.resFuel === 8],
      ['masse 765,6 kg, centrage 0,473 m, dans le domaine', near(mb.mass, 765.6, 0.01) && near(mb.cg, 0.4729, 0.0005) && mb.inEnv(mb.cg, mb.mass)],
      ['hors domaine si 200 kg de bagages', (() => { const m = C.massBalance({ ...f, m4: 200 }); return !m.inEnv(m.cg, m.mass); })()],
    ];
    for (const [name, ok] of checks) { asserts++; if (!ok) failures.push('vol Pau → Biarritz : ' + name); }
    const fl = C.fuelLines({ night: null, climb, totFuel: p.totFuel, totDist: p.totDist, altLeg: p.altLeg, f, resFuel: p.resFuel, wxRes: null, reqFuel: p.totFuel + p.altLeg.fuel + p.resFuel, loaded: 80 });
    asserts++; if (!(fl.total === 33 && fl.margin === 47 && !fl.short)) failures.push(`vol Pau → Biarritz : carburant nécessaire 33 L, marge 47 L (obtenu ${fl.total} / ${fl.margin})`);
  } catch (e) { errors.push('vol de référence Pau → Biarritz : ' + e.message); }
  // sw.js : chaque fichier de SHELL doit exister, sinon l'installation hors ligne échoue entièrement
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), shell = ((sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '');
  [...shell.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== './').forEach((f) => { if (!fs.existsSync(path.join(ROOT, f))) errors.push(`sw.js : fichier ${f} de SHELL absent`); });
  if (failures.length) console.log(`${failures.length} console.assert en échec :\n - ${failures.join('\n - ')}`);
  if (errors.length) console.log(`${errors.length} erreur(s) :\n - ${errors.join('\n - ')}`);
  if (failures.length || errors.length) { console.log('ÉCHEC du test de chargement.'); process.exit(1); }
  console.log('OK : tous les scripts se chargent, aucun console.assert en échec.');
}));
