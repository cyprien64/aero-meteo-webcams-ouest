/* Journal de fonctionnement + indicateur de chargement.
 * - garde en mémoire les messages, erreurs et requêtes lentes / en échec (téléchargeable : bouton « Journal ») ;
 * - affiche en haut de la carte ce qui est en train de charger, depuis combien de temps, et signale ce qui ne répond pas.
 */
(() => {
  'use strict';
  const t0 = performance.now();
  const LOG = window.AWW_LOG = { lines: [], tasks: new Map() };
  const fmtArg = (a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (a && typeof a === 'object') { try { return JSON.stringify(a).slice(0, 400); } catch { return String(a); } }
    return String(a);
  };
  const push = (lvl, args) => {
    LOG.lines.push(`${new Date().toISOString().slice(11, 23)} +${((performance.now() - t0) / 1000).toFixed(1)}s [${lvl}] ${[...args].map(fmtArg).join(' ')}`);
    if (LOG.lines.length > 1000) LOG.lines.shift();
  };
  for (const lvl of ['info', 'warn', 'error']) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a) => { push(lvl, a); orig(...a); };
  }
  addEventListener('error', (e) => push('ERREUR', [e.message, `${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}`]));
  addEventListener('unhandledrejection', (e) => push('ERREUR', ['promesse rejetée :', e.reason]));

  // Requêtes : on note les échecs et celles qui prennent plus de 4 s
  // Appels Open-Meteo de cet appareil aujourd'hui (jour UTC), comptés comme le service : 1 par lieu,
  // et plus de 10 variables = plusieurs appels. Limite : 10 000 par jour pour toute la connexion (box, 4G).
  const omWeight = (u) => {
    const q = new URL(u).searchParams, n = (k) => (q.get(k) || '').split(',').filter(Boolean).length;
    const vars = n('hourly') + n('daily') + n('current') + n('minutely_15');
    return Math.max(1, n('latitude')) * Math.max(1, vars / 10);
  };
  console.assert(omWeight('https://api.open-meteo.com/v1/forecast?latitude=1,2,3&longitude=1,2,3&hourly=a,b') === 3 && omWeight('https://x/?latitude=1&hourly=a,b,c,d,e,f,g,h,i,j,k,l,m,n,o') === 1.5, 'omWeight');
  const omKey = 'aww.omcount', today = () => new Date().toISOString().slice(0, 10);
  LOG.omCount = () => { try { const c = JSON.parse(localStorage.getItem(omKey) || '{}'); return c.d === today() ? c.n : 0; } catch { return 0; } };
  LOG.omText = () => `Météo : environ ${Math.round(LOG.omCount())} appels Open-Meteo depuis cet appareil aujourd'hui (limite : 10 000 par jour pour toute la connexion, autres appareils compris).`;
  const omAdd = (u) => { try { localStorage.setItem(omKey, JSON.stringify({ d: today(), n: LOG.omCount() + omWeight(u) })); } catch { /* stockage plein ou bloqué */ } };

  const origFetch = window.fetch.bind(window);
  window.fetch = async (u, o) => {
    const st = performance.now();
    const url = String((u && u.url) || u).replace(/apikey=[^&]+/, 'apikey=…').slice(0, 180);
    if (/open-meteo\.com\//.test(url)) try { omAdd(String((u && u.url) || u)); } catch { /* URL illisible */ }
    try {
      const r = await origFetch(u, o);
      const ms = Math.round(performance.now() - st);
      if (!r.ok) push('http ' + r.status, [url, ms + ' ms']);
      else if (ms > 4000) push('lent', [url, ms + ' ms']);
      return r;
    } catch (e) { push('réseau', [url, e.message]); throw e; }
  };

  LOG.text = () => {
    const tasks = [...LOG.tasks.values()].map((t) => `  ${t.name} : ${t.state}${t.ms != null ? ` (${(t.ms / 1000).toFixed(1)} s)` : ''}${t.err ? ' — ' + t.err : ''}`).join('\n');
    return `Aéro Météo Ouest — journal\nDate : ${new Date().toISOString()}\nPage : ${location.href.split('?')[0]}\nNavigateur : ${navigator.userAgent}\nÉcran : ${innerWidth}×${innerHeight}\nEn ligne : ${navigator.onLine}\n${LOG.omText()}\n\nChargements :\n${tasks}\n\nMessages :\n${LOG.lines.join('\n')}\n`;
  };
  LOG.download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([LOG.text()], { type: 'text/plain;charset=utf-8' }));
    a.download = `journal-aero-meteo-ouest-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // ---------- Indicateur de chargement ----------
  let bar = null, timer = null;
  const QUIET = /^(Balises vent|Fiches escale|Vigilance|Préparation de vol)/;   // utiles mais pas indispensables au vol
  const SLOW = 20000;
  function ensureBar() {
    if (bar || !document.body) return bar;
    bar = document.createElement('div');
    bar.id = 'loadbar';
    bar.hidden = true;
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.retry) { const t = LOG.tasks.get(b.dataset.retry); if (t && t.retry) LOG.task(t.name, t.retry); }
      if (b.dataset.log) LOG.download();
      if (b.dataset.close) { bar.hidden = true; [...LOG.tasks.values()].forEach((t) => { if (t.state !== 'en cours') t.seen = true; }); }
    });
    return bar;
  }
  function render() {
    if (!ensureBar()) return;
    const now = performance.now();
    const list = [...LOG.tasks.values()];
    // la barre ne parle que de ce qui compte pour le vol ; le reste allume une pastille sur « Signaler un problème »
    const quiet = (t) => QUIET.test(t.name);
    const lb = document.getElementById('btn-log'), nq = list.filter((t) => quiet(t) && t.state === 'erreur').length;
    if (lb) { lb.dataset.issues = nq || ''; lb.title = nq ? `${nq} chargement(s) secondaire(s) en échec : voir le journal` : 'Quelque chose ne marche pas ? Journal des erreurs et contact'; }
    const run = list.filter((t) => t.state === 'en cours' && !quiet(t) && now - t.start > 2500);   // pas de clignotement pour un chargement rapide
    const bad = list.filter((t) => !t.seen && !quiet(t) && (t.state === 'erreur' || (t.state === 'en cours' && now - t.start > SLOW)));
    if (!run.length && !bad.length) {   // le minuteur continue tant qu'un chargement est en cours (sinon un chargement lent ne serait jamais signalé)
      bar.hidden = true; if (!list.some((t) => t.state === 'en cours')) { clearInterval(timer); timer = null; } return;
    }
    bar.hidden = false;
    const runTxt = run.length ? `<span class="spin"></span> Chargement : ${run.map((t) => `${t.name} <i>${Math.round((now - t.start) / 1000)} s</i>`).join(' · ')}` : '';
    const badTxt = bad.map((t) => `<div class="lb-bad">⚠️ ${t.state === 'erreur' ? `${t.name} : échec (${t.err || 'erreur'})` : `${t.name} ne répond pas depuis ${Math.round((now - t.start) / 1000)} s`}
      ${t.retry ? `<button data-retry="${t.name}">Réessayer</button>` : ''}</div>`).join('');
    bar.innerHTML = `${runTxt}${badTxt}${bad.length ? '<div class="lb-act"><button data-log="1">📋 Télécharger le journal</button><button data-close="1">Fermer</button></div>' : ''}`;
    bar.classList.toggle('has-bad', !!bad.length);
  }
  /** Suit un chargement : LOG.task('METAR', () => promesse). La fonction peut être relancée (« Réessayer »). */
  LOG.task = (name, fn) => {
    const t = { name, state: 'en cours', start: performance.now(), retry: fn, seen: false };
    LOG.tasks.set(name, t);
    if (!timer) timer = setInterval(render, 1000);
    render();
    let p;
    try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    return p.then((v) => { t.state = 'ok'; t.ms = performance.now() - t.start; push('ok', [name, Math.round(t.ms) + ' ms']); render(); return v; },
      (e) => { t.state = 'erreur'; t.err = (e && e.message) || String(e); t.ms = performance.now() - t.start; push('ERREUR', [name, e]); render(); });
  };
})();
