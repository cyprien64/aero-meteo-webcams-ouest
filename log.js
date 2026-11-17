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
  const origFetch = window.fetch.bind(window);
  window.fetch = async (u, o) => {
    const st = performance.now();
    const url = String((u && u.url) || u).replace(/apikey=[^&]+/, 'apikey=…').slice(0, 180);
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
    return `Aéro Météo Ouest — journal\nDate : ${new Date().toISOString()}\nPage : ${location.href.split('?')[0]}\nNavigateur : ${navigator.userAgent}\nÉcran : ${innerWidth}×${innerHeight}\nEn ligne : ${navigator.onLine}\n\nChargements :\n${tasks}\n\nMessages :\n${LOG.lines.join('\n')}\n`;
  };
  LOG.download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([LOG.text()], { type: 'text/plain;charset=utf-8' }));
    a.download = `journal-aero-meteo-ouest-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // ---------- Indicateur de chargement ----------
  let bar = null, timer = null;
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
    const run = list.filter((t) => t.state === 'en cours');
    const bad = list.filter((t) => !t.seen && (t.state === 'erreur' || (t.state === 'en cours' && now - t.start > SLOW)));
    if (!run.length && !bad.length) { bar.hidden = true; clearInterval(timer); timer = null; return; }
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
