/* Outils complémentaires : mesure d'un trajet avec le vent de plusieurs modèles, carte jour / nuit aéronautique, effacement des tracés. */
(() => {
  'use strict';
  const A = window.AWW; if (!A) return;
  const { map, L, esc } = A;
  const $ = (s, el = document) => el.querySelector(s);
  const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
  const pad = (n) => String(n).padStart(2, '0');
  const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // ================================================================ soleil (carte jour / nuit, accueil, briefing)
  function sunTimes(date, la, lo) {
    const d0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const n = Math.floor((d0 - Date.UTC(2000, 0, 1, 12)) / 864e5) + 1;
    const Js = n - lo / 360, M = (357.5291 + 0.98560028 * Js) % 360;
    const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
    const lam = (M + C + 180 + 102.9372) % 360;
    const Jt = 2451545 + Js + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lam));
    const dec = Math.asin(Math.sin(rad(lam)) * Math.sin(rad(23.44)));
    const cosw = (Math.sin(rad(-0.833)) - Math.sin(rad(la)) * Math.sin(dec)) / (Math.cos(rad(la)) * Math.cos(dec));
    if (Math.abs(cosw) > 1) return null;
    const w = deg(Math.acos(cosw)), toD = (j) => new Date((j - 2440587.5) * 864e5);
    return { rise: toD(Jt - w / 360), set: toD(Jt + w / 360) };
  }
  A.sunTimes = sunTimes;
  console.assert((() => { const s = sunTimes(new Date(Date.UTC(2026, 5, 21)), 43.38, -0.42); return s && s.rise.getUTCHours() === 4 && s.set.getUTCHours() === 19; })(), 'sunTimes Pau 21 juin');

  // ================================================================ préparation de vol chargée seulement quand on s'en sert
  // prepavol.js (500 ko) n'est plus lu à l'ouverture : le premier clic le charge, puis le clic est rejoué
  let prepP = null;
  const addScript = (src) => new Promise((ok, ko) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => ko(new Error(`${src} introuvable`)); document.head.appendChild(el); });
  const loadPrep = window.AWW_loadPrep = () => window.AWW_PREP ? Promise.resolve() : swNew ? Promise.reject(new Error('nouvelle version : recharger la page')) : prepP || (prepP = window.AWW_LOG.task('Préparation de vol', () => addScript('data/aircraft.js').then(() => addScript('prepavol.js')).then(() => addScript('prep-docs.js')))
    .then(() => { if (window.AWW_PREP) return; prepP = null; alert('La préparation de vol n\'a pas pu se charger (réseau ?). Réessaie dans un instant.'); throw new Error('prepavol.js non chargé'); }));   // LOG.task ne rejette jamais : on regarde le drapeau
  // nouvelle version installée pendant que la page était ouverte : la carte en mémoire est l'ancienne, la préparation serait la nouvelle ;
  // on recharge la page (puis on rouvre ce que le pilote demandait) plutôt que de mélanger deux versions
  const SW = navigator.serviceWorker, hadCtrl = !!(SW && SW.controller);
  let swNew = false;
  if (SW) SW.addEventListener('controllerchange', () => { swNew = hadCtrl; });
  const reloadFirst = (sel) => { try { sessionStorage.setItem('aww.reopen', sel); } catch { /* ignore */ } location.reload(); };
  ['#btn-prep', '#btn-hist'].forEach((s) => $(s) && $(s).addEventListener('click', (e) => {
    if (window.AWW_PREP) return;
    e.stopImmediatePropagation();
    if (swNew) { reloadFirst(s); return; }
    loadPrep().then(() => $(s).click(), () => {});
  }, true));
  let reopen = null; try { reopen = sessionStorage.getItem('aww.reopen'); sessionStorage.removeItem('aww.reopen'); } catch { /* ignore */ }
  if (reopen === '#btn-prep' || reopen === '#btn-hist') loadPrep().then(() => $(reopen).click(), () => {});
  else if (location.hash.startsWith('#vol=')) loadPrep().catch(() => {});   // lien de vol partagé
  else {   // nav enregistrée qui part dans les 36 h : la préparation se charge en arrière-plan pour le contrôle du jour J (nouveaux NOTAM, TAF)
    let soon = false;
    try { soon = Object.values(JSON.parse(localStorage.getItem('aww.prep2.snaps') || '{}')).some((l) => { const d = Date.parse((l[l.length - 1] || {}).dep); return d > Date.now() && d - Date.now() < 36 * 3600e3; }); } catch { /* ignore */ }
    if (soon) setTimeout(() => loadPrep().catch(() => {}), 4000);
  }

  // ================================================================ 📏 Mesure d'un trajet
  // distance (NM, formule de haversine) et route vraie entre deux points [lat, lon] ; partagées avec la préparation de vol
  function distNm(a, b) {
    const dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2;
    return 2 * 3440.065 * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  A.distNm = distNm; A.bearing = bearing;
  console.assert(Math.abs(distNm([43.38, -0.42], [43.47, -1.52]) - 48.2) < 0.5 && Math.round(bearing([0, 0], [0, 1])) === 90, 'distNm / bearing');
  const MODELS = [
    ['meteofrance_seamless', 'Météo-France (AROME / ARPEGE)'],
    ['ecmwf_ifs025', 'ECMWF (européen)'],
    ['icon_seamless', 'ICON (DWD, allemand)'],
    ['gfs_seamless', 'GFS (NOAA, américain)'],
  ];
  const LEVELS = [[1000, 360], [975, 1050], [950, 1770], [925, 2500], [900, 3240], [850, 4780], [800, 6400], [700, 9880]];
  const levelFor = (ft) => LEVELS.reduce((b, l) => Math.abs(l[1] - ft) < Math.abs(b[1] - ft) ? l : b)[0];
  // triangle des vitesses : vent (d'où il vient, kt) → vitesse sol et dérive
  function gsOf(tc, tas, wdir, wspd) {
    const wa = rad(wdir - tc);
    const s = wspd * Math.sin(wa) / tas;
    if (Math.abs(s) >= 1) return null;
    const wca = Math.asin(s);
    return { gs: tas * Math.cos(wca) - wspd * Math.cos(wa), wca: deg(wca) };
  }
  const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  const ms = { on: false, pts: [], layer: L.layerGroup().addTo(map), res: null };
  const btn = $('#btn-measure');
  function setMeasure(on) {
    ms.on = on; btn.classList.toggle('on', on); A.setPickOff(on);
    map.getContainer().style.cursor = on ? 'crosshair' : '';
    if (on) { if (map.doubleClickZoom) map.doubleClickZoom.disable(); panel(); } else if (map.doubleClickZoom) map.doubleClickZoom.enable();
  }
  btn.addEventListener('click', () => setMeasure(!ms.on));
  function snap(ll) {   // accroche aux aérodromes proches (12 px)
    const p = map.latLngToContainerPoint(ll);
    let best = null, bd = 13;
    for (const a of A.APTS) { const d = map.latLngToContainerPoint([a.la, a.lo]).distanceTo(p); if (d < bd) { bd = d; best = a; } }
    return best ? { ll: [best.la, best.lo], id: best.icao } : { ll: [ll.lat, ll.lng], id: null };
  }
  map.on('click', (e) => {
    if (!ms.on) return;
    const s = snap(e.latlng);
    ms.pts.push({ ll: s.ll, id: s.id || `P${ms.pts.length + 1}` });
    ms.res = null; draw(); panel();
  });
  function draw() {
    ms.layer.clearLayers();
    if (ms.pts.length > 1) L.polyline(ms.pts.map((p) => p.ll), { color: '#00e5ff', weight: 4, opacity: .95, dashArray: '10 6', interactive: false }).addTo(ms.layer);
    ms.pts.forEach((p, i) => {
      if (i) {
        const a = ms.pts[i - 1].ll, b = p.ll, nm = distNm(a, b);
        L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { interactive: false, icon: L.divIcon({ className: 'ms-lbl', html: `${nm.toFixed(1)} NM · ${(nm * 1.852).toFixed(0)} km · ${pad(Math.round(bearing(a, b)) % 360).padStart(3, '0')}°`, iconSize: null }) }).addTo(ms.layer);
      }
      L.marker(p.ll, { draggable: true, icon: L.divIcon({ className: 'ms-pt', iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .bindTooltip(esc(p.id), { permanent: true, direction: 'right', className: 'tip' })
        .on('dragend', (e) => { const s = snap(e.target.getLatLng()); p.ll = s.ll; if (s.id) p.id = s.id; ms.res = null; draw(); panel(); })
        .on('contextmenu', () => { ms.pts.splice(i, 1); ms.res = null; draw(); panel(); })
        .addTo(ms.layer);
    });
  }
  const st = A.store.get('measure', { tas: 105, ft: 2500 });
  function panel() {
    const tot = ms.pts.reduce((s, p, i) => s + (i ? distNm(ms.pts[i - 1].ll, p.ll) : 0), 0);
    const next = new Date(Date.now() + 3600e3); next.setMinutes(0, 0, 0);
    A.showPanel('📏 Mesure d\'un trajet', `
      <p class="meta">${ms.on ? 'Clique sur la carte pour ajouter des points (accroche aux aérodromes) · glisse un point pour le déplacer · clic droit sur un point pour le supprimer.' : 'Mode mesure arrêté. Re-clique sur « Mesurer un trajet » pour continuer.'}</p>
      <p><b>${ms.pts.length} points · ${tot.toFixed(1)} NM · ${(tot * 1.852).toFixed(0)} km</b></p>
      <div class="ms-form">
        <label>Vitesse propre (kt)<input id="ms-tas" type="number" min="40" max="250" value="${st.tas}"></label>
        <label>Altitude (ft)<input id="ms-ft" type="number" min="500" max="10000" step="500" value="${st.ft}"></label>
        <label>Départ (heure locale)<input id="ms-t" type="datetime-local" value="${esc(st.t && Date.parse(st.t) > Date.now() - 3600e3 ? st.t : localInput(next))}"></label>
      </div>
      <div class="row" style="margin-top:6px"><button class="btn primary" id="ms-go" ${ms.pts.length < 2 ? 'disabled' : ''}>Temps de vol selon le vent prévu (4 modèles)</button>
        <button class="btn" id="ms-undo" ${ms.pts.length ? '' : 'disabled'}>Dernier point</button><button class="btn" id="ms-clear">Effacer</button></div>
      <div id="ms-out">${ms.res || ''}</div>
      ${ms.pts.length > 1 ? '<div class="row" style="margin-top:6px"><button class="btn" id="ms-prep">Préparer ce vol</button></div>' : ''}
      <p class="legend small-print">Le vent vient d'Open-Meteo pour chaque modèle, au niveau de pression le plus proche de l'altitude, à l'heure de passage au milieu de chaque branche. Quand les modèles ne sont pas d'accord, l'écart est signalé : c'est au pilote de trancher (TEMSI, WINTEM, GRAMET, prévisionniste).</p>`);
    $('#ms-go') && $('#ms-go').addEventListener('click', compute);
    $('#ms-undo').addEventListener('click', () => { ms.pts.pop(); ms.res = null; draw(); panel(); });
    $('#ms-clear').addEventListener('click', () => { ms.pts = []; ms.res = null; draw(); panel(); });
    const prep = $('#ms-prep');
    if (prep) prep.addEventListener('click', () => {
      const ids = ms.pts.map((p) => p.id && /^[A-Z]{4}$/.test(p.id) ? p.id : `${p.ll[0].toFixed(4)}/${p.ll[1].toFixed(4)}`);
      if (!/^[A-Z]{4}$/.test(ids[0]) || !/^[A-Z]{4}$/.test(ids[ids.length - 1])) { alert('Le premier et le dernier point doivent être des aérodromes (clique sur un terrain pour l\'accrocher).'); return; }
      const f = A.store.get('prep2.form', {});
      A.store.set('prep2.form', { ...f, dep: ids[0], arr: ids[ids.length - 1], wps: ids.slice(1, -1).join(' '), exit: 'none', entry: 'none', ft: +$('#ms-ft').value || f.ft });
      setMeasure(false);
      $('#btn-prep').click();
    });
    ['#ms-tas', '#ms-ft', '#ms-t'].forEach((s) => $(s).addEventListener('change', () => { st.tas = +$('#ms-tas').value; st.ft = +$('#ms-ft').value; st.t = $('#ms-t').value; A.store.set('measure', st); }));
  }
  async function compute() {
    const tas = +$('#ms-tas').value || 100, ft = +$('#ms-ft').value || 2500, t0 = new Date($('#ms-t').value || Date.now());
    st.tas = tas; st.ft = ft; st.t = $('#ms-t').value; A.store.set('measure', st);
    const out = $('#ms-out'); out.innerHTML = '<p class="meta">Interrogation des 4 modèles…</p>';
    const legs = ms.pts.slice(1).map((p, i) => { const a = ms.pts[i].ll, b = p.ll; return { from: ms.pts[i].id, to: p.id, a, b, nm: distNm(a, b), tc: bearing(a, b), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; });
    let t = t0.getTime();
    legs.forEach((lg) => { lg.tmid = new Date(t + lg.nm / tas * 1800e3); t += lg.nm / tas * 3600e3; });
    const lv = levelFor(ft);
    const vars = MODELS.flatMap(([m]) => [`wind_speed_${lv}hPa`, `wind_direction_${lv}hPa`]).filter((v, i, a) => a.indexOf(v) === i);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${legs.map((l) => l.mid[0].toFixed(3)).join(',')}&longitude=${legs.map((l) => l.mid[1].toFixed(3)).join(',')}`
        + `&hourly=${vars.join(',')}&models=${MODELS.map((m) => m[0]).join(',')}&wind_speed_unit=kn&timezone=GMT&forecast_days=7`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status === 429 ? 'serveur météo saturé, réessaie dans une minute' : 'erreur ' + r.status);
      let d = await r.json(); if (!Array.isArray(d)) d = [d];
      const tot = Object.fromEntries(MODELS.map(([m]) => [m, 0]));
      const rows = legs.map((lg, i) => {
        const h = d[i].hourly, key = lg.tmid.toISOString().slice(0, 13) + ':00';
        const k = h.time.indexOf(key);
        const per = MODELS.map(([m]) => {
          const ws = k >= 0 ? h[`wind_speed_${lv}hPa_${m}`][k] : null, wd = k >= 0 ? h[`wind_direction_${lv}hPa_${m}`][k] : null;
          if (ws == null || wd == null) return { m, none: true };
          const g = gsOf(lg.tc, tas, wd, ws);
          if (!g || g.gs < 20) return { m, ws, wd, none: true };
          const min = lg.nm / g.gs * 60; tot[m] += min;
          return { m, ws, wd, gs: g.gs, min, wca: g.wca };
        });
        const ok = per.filter((x) => !x.none);
        const spdSpread = ok.length ? Math.max(...ok.map((x) => x.ws)) - Math.min(...ok.map((x) => x.ws)) : 0;
        const dirSpread = ok.length > 1 && Math.max(...ok.map((x) => x.ws)) > 8 ? Math.max(...ok.flatMap((x) => ok.map((y) => angDiff(x.wd, y.wd)))) : 0;
        const minSpread = ok.length ? Math.max(...ok.map((x) => x.min)) - Math.min(...ok.map((x) => x.min)) : 0;
        lg.diverge = spdSpread >= 10 || dirSpread >= 40 || minSpread >= 4;
        return `<tr><td colspan="5"><b>${esc(lg.from)} → ${esc(lg.to)}</b> · ${lg.nm.toFixed(1)} NM (${(lg.nm * 1.852).toFixed(0)} km) · Rv ${String(Math.round(lg.tc) % 360).padStart(3, '0')}° · passage ~${hm(lg.tmid)}
          ${lg.diverge ? `<br><span style="color:#ffb340">⚠️ Les modèles divergent (vent ±${Math.round(spdSpread / 2)} kt${dirSpread >= 40 ? `, direction ${Math.round(dirSpread)}° d'écart` : ''}) : à vérifier.</span>` : ''}</td></tr>`
          + per.map((x) => `<tr><td>${esc(MODELS.find((m) => m[0] === x.m)[1].split(' (')[0])}</td>${x.none && x.ws == null ? '<td colspan="4" class="meta">pas de donnée à cette échéance</td>'
            : `<td>${String(Math.round(x.wd)).padStart(3, '0')}° / ${Math.round(x.ws)} kt</td><td>${x.gs ? `Vs ${Math.round(x.gs)} kt` : '–'}</td><td>${x.wca != null ? `dérive ${x.wca > 0 ? '+' : ''}${Math.round(x.wca)}°` : ''}</td><td${lg.diverge ? ' class="dv"' : ''}>${x.min ? `${Math.round(x.min)} min` : '–'}</td>`}</tr>`).join('');
      }).join('');
      const totMin = MODELS.map(([m, n]) => ({ m, n, min: tot[m] })).filter((x) => x.min > 0);
      const noWind = legs.reduce((s, l) => s + l.nm, 0) / tas * 60;
      const worst = totMin.length ? totMin.reduce((a, b) => b.min > a.min ? b : a) : null;
      ms.res = `<h4>Vent prévu à ${ft} ft (niveau ${lv} hPa) — ${tas} kt de vitesse propre</h4>
        <table class="ms">${rows}</table>
        <h4>Temps total selon chaque modèle</h4>
        <table class="ms"><tr><th>Modèle</th><th>Temps</th><th>Arrivée</th></tr>
        <tr><td>Sans vent</td><td>${Math.round(noWind)} min</td><td>${hm(new Date(t0.getTime() + noWind * 6e4))}</td></tr>
        ${totMin.map((x) => `<tr><td>${esc(x.n)}</td><td${worst && x.m === worst.m ? ' class="dv"' : ''}>${Math.floor(x.min / 60)} h ${pad(Math.round(x.min % 60))}</td><td>${hm(new Date(t0.getTime() + x.min * 6e4))}</td></tr>`).join('')}</table>
        ${worst ? `<p class="meta">Le plus pessimiste : <b>${esc(worst.n)}</b> (${Math.round(worst.min)} min) — prévoir le carburant sur ce cas.</p>` : ''}
        ${legs.some((l) => l.diverge) ? '<div class="warn">Sur au moins une branche les modèles ne sont pas d\'accord : compare avec la carte WINTEM / TEMSI d\'aviation.meteo.fr et garde une marge.</div>' : '<div class="okk">Les 4 modèles sont cohérents sur ce trajet.</div>'}`;
      out.innerHTML = ms.res;
    } catch (e) { console.warn('mesure vent', e); out.innerHTML = `<div class="warn">Vent indisponible : ${esc(e.message)}</div>`; }
  }

  // ================================================================ 🌙 Jour / nuit aéronautique
  // Nuit aéronautique (France) : du coucher du soleil + 30 min au lever du soleil - 30 min.
  // même calcul que le briefing (prepavol.js), en millisecondes pour les comparaisons
  const sunMs = (day, la, lo) => { const s = sunTimes(day, la, lo); return s && { rise: +s.rise, set: +s.set }; };
  const NB = { s: 41.3, n: 51.3, w: -6.0, e: 9.8 }, STEP = 0.1;
  const nightOverlay = L.imageOverlay('data:image/gif;base64,R0lGODlhAQABAAAAACw=', [[NB.s, NB.w], [NB.n, NB.e]], { opacity: 1, interactive: false, pane: 'maskPane' });
  const termLine = L.layerGroup();
  let nightT = null, playTimer = null;
  const cv = document.createElement('canvas');
  function renderNight() {
    const day = new Date($('#night-date').value + 'T12:00:00');
    if (isNaN(day)) return;
    const mins = +$('#night-t').value;
    const t = new Date(day); t.setHours(0, mins, 0, 0);
    nightT = t;
    const W = Math.round((NB.e - NB.w) / STEP), H = Math.round((NB.n - NB.s) / STEP);
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), now = t.getTime();
    const mer = (la) => Math.log(Math.tan(Math.PI / 4 + rad(la) / 2)), yN = mer(NB.n), yS = mer(NB.s);
    for (let y = 0; y < H; y++) {
      const la = deg(2 * Math.atan(Math.exp(yN - (y + .5) / H * (yN - yS))) - Math.PI / 2);   // lignes régulières en Mercator (comme la carte)
      for (let x = 0; x < W; x++) {
        const lo = NB.w + (x + .5) * STEP;
        const s = sunMs(t, la, lo);
        let r = 0, g = 0, b = 0, a = 0;
        if (s) {
          const sp = s.set, rp = s.rise;
          // jour J : nuit avant lever-30 et après coucher+30 ; crépuscule entre coucher et +30 (ou -30 avant lever)
          if (now >= sp + 30 * 6e4 || now < rp - 30 * 6e4) { r = 8; g = 14; b = 60; a = 150; }
          else if (now >= sp || now < rp) { r = 255; g = 130; b = 30; a = 110; }
        }
        const i = (y * W + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    nightOverlay.setUrl(cv.toDataURL());
    // ligne « début de la nuit aéronautique » : pour chaque latitude, longitude où coucher + 30 = t
    termLine.clearLayers();
    const pts = [];
    for (let la = NB.s; la <= NB.n; la += .5) {
      let best = null;
      for (let lo = NB.w; lo <= NB.e; lo += .05) { const s = sunMs(t, la, lo); if (!s) continue; const d = Math.abs(s.set + 30 * 6e4 - now); if (d < 4 * 6e4 && (!best || d < best.d)) best = { lo, d }; }
      if (best) pts.push([la, best.lo]);
    }
    if (pts.length > 3) L.polyline(pts, { color: '#ffd60a', weight: 2.5, dashArray: '8 6', interactive: false, pane: 'outlinePane' }).bindTooltip('Début de la nuit aéronautique', { sticky: true }).addTo(termLine);
    nightLabel();
  }
  function nightLabel() {
    const t = nightT; if (!t) return;
    const utcS = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} UTC`;
    // info à la position du centre de la carte
    const c = map.getCenter(), sc = sunMs(t, c.lat, c.lng);
    $('#night-lbl').innerHTML = `${hm(t)} locale · ${utcS}${sc ? `<br><span class="meta">au centre de la carte : coucher ${hm(new Date(sc.set))}, nuit aéro ${hm(new Date(sc.set + 30 * 6e4))} · jour aéro ${hm(new Date(sc.rise - 30 * 6e4))}</span>` : ''}`;
  }
  function setNight(on) {
    if (on) { nightOverlay.addTo(map); termLine.addTo(map); renderNight(); } else { map.removeLayer(nightOverlay); map.removeLayer(termLine); clearInterval(playTimer); playTimer = null; $('#night-play').textContent = '▶'; }
  }
  const today = new Date();
  $('#night-date').value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  $('#night-t').value = Math.floor((today.getHours() * 60 + today.getMinutes()) / 5) * 5;
  $('#night-on').addEventListener('change', (e) => setNight(e.target.checked));
  ['#night-date', '#night-t'].forEach((s) => $(s).addEventListener('input', () => { if ($('#night-on').checked) renderNight(); else { $('#night-on').checked = true; setNight(true); } }));
  map.on('moveend', () => { if ($('#night-on').checked) nightLabel(); });   // l'image couvre toute la zone : seule l'info du centre change
  $('#night-now').addEventListener('click', () => {
    const n = new Date(); $('#night-date').value = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; $('#night-t').value = Math.floor((n.getHours() * 60 + n.getMinutes()) / 5) * 5;
    $('#night-on').checked = true; setNight(true);
  });
  $('#night-play').addEventListener('click', () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; $('#night-play').textContent = '▶'; return; }
    $('#night-on').checked = true; setNight(true); $('#night-play').textContent = '⏸';
    playTimer = setInterval(() => { const el = $('#night-t'); el.value = (+el.value + 10) % 1440; renderNight(); }, 400);
  });
  // « Mon vol » : positionne la carte de nuit sur l'heure d'arrivée du dernier vol préparé
  window.AWW_setFlightTimes = (dep, eta) => {
    const b = $('#night-flight'); b.hidden = false;
    b.onclick = () => {
      $('#night-date').value = `${eta.getFullYear()}-${pad(eta.getMonth() + 1)}-${pad(eta.getDate())}`;
      $('#night-t').value = Math.round((eta.getHours() * 60 + eta.getMinutes()) / 5) * 5;
      $('#night-on').checked = true; setNight(true);
      const sec = $('#night-on').closest('details'); if (sec) sec.open = true;
    };
    b.title = `Arrivée prévue ${hm(eta)}`;
  };

  // ================================================================ Accueil : salutation, date, soleil au premier terrain favori
  function hello() {
    const el = $('#hello'); if (!el) return;
    const n = new Date(), h = n.getHours();
    const icao = (A.store.get('favs', ['LFBP'])[0]) || 'LFBP', a = A.aptByIcao[icao];
    const s = a && A.sunTimes(n, a.la, a.lo), m = A.metars[icao];
    el.innerHTML = `<b>${h < 5 || h >= 18 ? 'Bonsoir' : h < 12 ? 'Bonjour' : 'Bon après-midi'}</b>
      <span>${n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      ${s ? `<span>Soleil ${hm(s.rise)} – ${hm(s.set)} à ${esc(icao)} · nuit aéro ${hm(new Date(+s.set + 30 * 6e4))}</span>` : ''}
      <span class="hello-warn">Outil d'aide : la préparation réglementaire reste SOFIA, le SIA et aviation.meteo.fr.</span>
      ${m ? `<span><i class="cat c-${m.fltCat || 'UNK'}">${m.fltCat || '?'}</i> ${m.wdir != null ? `vent ${m.wdir === 'VRB' ? 'variable' : String(m.wdir).padStart(3, '0') + '°'} ${m.wspd} kt${m.wgst ? ' rafales ' + m.wgst : ''}` : ''}</span>` : ''}`;
  }
  hello(); setInterval(hello, 60e3); setTimeout(hello, 3000);
  // tuiles d'accueil et thème
  $('#q-prep').addEventListener('click', () => $('#btn-prep').click());
  $('#q-measure').addEventListener('click', () => $('#btn-measure').click());
  $('#q-where').addEventListener('click', () => (swNew && !window.AWW_PREP ? reloadFirst('#btn-prep') : loadPrep().then(() => { if (!$('#pf-where')) $('#btn-prep').click(); const w = $('#pf-where'); if (w) { w.scrollIntoView({ block: 'center', behavior: 'smooth' }); w.click(); } }, () => {})));
  $('#btn-theme').addEventListener('click', () => window.AWW_theme && window.AWW_theme.toggle());

  // ================================================================ tiroir du panneau sur téléphone : réduit / moitié / plein écran (toucher ou glisser la poignée)
  (() => {
    const p = $('#panel'), g = $('#panel-grab'), S = ['sh-min', 'sh-mid', 'sh-full'];
    let st = 1, y0 = null, h0 = 0;
    const set = (k) => { st = Math.max(0, Math.min(2, k)); S.forEach((c, i) => p.classList.toggle(c, i === st)); p.style.height = ''; };
    set(1);
    g.addEventListener('click', () => set(st === 2 ? 0 : st + 1));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.click(); } });
    g.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; h0 = p.getBoundingClientRect().height; p.style.transition = 'none'; }, { passive: true });
    g.addEventListener('touchmove', (e) => { if (y0 == null) return; p.style.height = Math.max(90, h0 + y0 - e.touches[0].clientY) + 'px'; }, { passive: true });
    g.addEventListener('touchend', (e) => {
      if (y0 == null) return; const dy = y0 - e.changedTouches[0].clientY; y0 = null; p.style.transition = '';
      if (Math.abs(dy) < 8) return;   // simple toucher : géré par click
      const r = p.getBoundingClientRect().height / innerHeight; set(r < 0.3 ? 0 : r < 0.68 ? 1 : 2);
    });
  })();

  // ================================================================ 🧹 Effacer les tracés
  $('#btn-clear').addEventListener('click', () => {
    ms.pts = []; ms.res = null; draw(); if (ms.on) setMeasure(false);
    window.dispatchEvent(new Event('aww-clear'));
    A.detail.hidden = true;
  });

  // ================================================================ Affichages préréglés
  const PRESETS = {
    meteo: { metar: 1, apt: 1, camAero: 1, cam: 1, obs: 1, wind: 1, radar: 0, vig: 1, foudre: 0, notam: 0, supaip: 0, asp: 0, siv: 0, zones: 0, rtba: 1, vfr: 0 },   // = affichage d'arrivée
    nav: { metar: 1, apt: 1, camAero: 0, cam: 0, obs: 0, wind: 0, radar: 0, vig: 0, foudre: 0, notam: 1, supaip: 1, asp: 1, siv: 0, zones: 1, rtba: 1, vfr: 1 },
    all: { metar: 1, apt: 1, camAero: 1, cam: 1, obs: 1, wind: 1, radar: 0, vig: 1, foudre: 1, notam: 1, supaip: 1, asp: 1, siv: 1, zones: 1, rtba: 1, vfr: 1 },
  };
  const cbs = () => [...document.querySelectorAll('input[data-layer]')];
  function markPreset() {
    const cur = Object.fromEntries(cbs().map((c) => [c.dataset.layer, c.checked ? 1 : 0]));
    document.querySelectorAll('[data-preset]').forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      b.classList.toggle('on', Object.keys(p).every((k) => !(k in cur) || cur[k] === p[k]));
    });
  }
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS[b.dataset.preset];
    cbs().forEach((c) => { const v = !!p[c.dataset.layer]; if (c.dataset.layer in p && c.checked !== v) { c.checked = v; c.dispatchEvent(new Event('change')); } });
    markPreset();
  }));
  cbs().forEach((c) => c.addEventListener('change', markPreset));
  markPreset();

  // ================================================================ Visite guidée (au premier lancement, puis bouton « ? »)
  const STEPS = [
    ['#hello', 'Bienvenue', 'Carte de préparation des vols pour toute la France métropolitaine : webcams, METAR / TAF en direct, NOTAM, vigilance, espaces aériens, briefing PDF et log de nav. <b>C\'est un outil d\'aide</b> : il ne remplace pas la préparation réglementaire sur SOFIA-Briefing, le site du SIA et aviation.meteo.fr.'],
    ['#presets', 'Que veux-tu voir ?', 'Trois affichages tout prêts : <b>Météo</b> (METAR, webcams, radar), <b>Navigation</b> (NOTAM, espaces aériens, zones) ou <b>Tout</b>. Tu peux ensuite cocher / décocher chaque couche dans les rubriques plus bas.'],
    ['#btn-prep', 'Préparer un vol', 'Départ, arrivée, avion : la route est calculée avec le vent, le relief, les zones, les NOTAM et la nuit. Tu obtiens un briefing PDF et le log de nav Excel du club. Le bouton 📍 permet de choisir les terrains sur la carte.'],
    ['.search-wrap', 'Rechercher', 'Tape un code OACI (LFCP), un nom de terrain ou de ville, ou une webcam : la carte zoome et le terrain clignote en jaune.'],
    ['#btn-measure', 'Mesurer un trajet', 'Clique des points sur la carte : distance, cap, et temps de vol selon le vent prévu par 4 modèles météo. Si les modèles ne sont pas d\'accord, c\'est signalé.'],
    ['#map', 'Sur la carte', '<b>Clic</b> sur un point : sa fiche (METAR, webcams, NOTAM, carburant…). <b>Clic droit</b> (ou appui long) : les espaces aériens au-dessus et leurs règles. Les <b>pastilles orange numérotées</b> regroupent des points : clique ou zoome pour les voir.'],
    ['#btn-log', 'En cas de problème', 'Si quelque chose ne charge pas, une barre l\'indique en haut. Le bouton <b>Signaler un problème</b> prépare le journal des erreurs à envoyer. Le bouton <b>?</b> en haut ouvre l\'aide et relance cette visite.'],
  ];
  let tourI = -1;
  function tourShow() {
    let hl = $('#tour-hl'), bub = $('#tour-bub');
    if (tourI < 0 || tourI >= STEPS.length) { if (hl) hl.remove(); if (bub) bub.remove(); A.store.set('tourDone', 1); tourI = -1; return; }
    const [sel, title, txt] = STEPS[tourI];
    const el = $(sel); if (!el) { tourI++; tourShow(); return; }
    const panel = $('#panel'); if (sel !== '#map' && panel.classList.contains('collapsed')) $('#collapse').click();
    el.scrollIntoView({ block: 'nearest' });
    if (!hl) { hl = document.createElement('div'); hl.id = 'tour-hl'; document.body.appendChild(hl); }
    if (!bub) { bub = document.createElement('div'); bub.id = 'tour-bub'; document.body.appendChild(bub); }
    let r = el.getBoundingClientRect();
    if (sel === '#map') { const p = $('#panel').getBoundingClientRect(); r = { left: p.right + 20, top: 70, width: Math.max(200, innerWidth - p.right - 60), height: Math.max(160, innerHeight - 140) }; r.right = r.left + r.width; r.bottom = r.top + r.height; }
    Object.assign(hl.style, { left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px' });
    bub.innerHTML = `<b class="t">${title}</b>${txt}<div class="act"><span style="color:#789">${tourI + 1} / ${STEPS.length}</span><span><button class="sk">${tourI === STEPS.length - 1 ? 'Fermer' : 'Passer'}</button> ${tourI < STEPS.length - 1 ? '<button class="nx">Suivant →</button>' : ''}</span></div>`;
    const bw = bub.offsetWidth, bh = bub.offsetHeight;
    let left = r.right + 14, top = r.top;
    if (left + bw > innerWidth - 8) { left = Math.max(8, Math.min(innerWidth - bw - 8, r.left)); top = r.bottom + 12; }
    if (sel === '#map') { left = r.left + 20; top = r.top + 20; }
    if (top + bh > innerHeight - 8) top = Math.max(8, r.top - bh - 12);
    Object.assign(bub.style, { left: left + 'px', top: top + 'px' });
    bub.querySelector('.sk').onclick = () => { tourI = -1; tourShow(); };
    const nx = bub.querySelector('.nx'); if (nx) nx.onclick = () => { tourI++; tourShow(); };
  }
  const startTour = () => { tourI = 0; tourShow(); };
  addEventListener('resize', () => { if (tourI >= 0) tourShow(); });

  // ================================================================ Aide : comment préparer une nav (bouton « ? »)
  const icon = (sel) => { const i = $(sel + ' .ico'); return i ? `<span class="help-ico">${i.outerHTML}</span>` : ''; };
  function showHelp() {
    A.showPanel('Comment préparer une nav', `
      <div class="row"><button class="btn primary" id="help-tour">Visite guidée des boutons</button> <button class="btn" id="help-news">Nouveautés</button></div>
      <h4>1. Remplir le formulaire</h4>
      <p>${icon('#btn-prep')} <b>Préparer un vol</b>, puis 3 étapes : <b>Trajet</b> (départ, arrivée, points tournants ; 📍 pour choisir sur la carte), <b>Avion et chargement</b> (immatriculation, masses, carburant), <b>Pilote</b>. Le bouton <b>Calculer la route</b> lance le calcul.</p>
      <h4>2. Lire le briefing</h4>
      <p>L'anneau en haut donne la <b>chance de faire le vol en VFR</b> d'après 51 scénarios météo. En dessous, les onglets <b>Résumé, Météo, Route, Terrains, Radio, Sécurité</b>. Un chiffre orange sur un onglet signale une alerte à lire.</p>
      <h4>3. Regarder la carte heure par heure</h4>
      <p>Le <b>curseur horaire</b> en bas de la carte montre les nuages, la pluie et le vent le long de la route. Fais-le glisser jusqu'à ton heure de passage.</p>
      <h4>4. Emporter les documents</h4>
      <p><b>Briefing PDF + log Excel</b> : le dossier complet et le log de nav du club. <b>Préparer le retour</b> : la route inverse en un clic. <b>Partager</b> : un lien qui rouvre la même préparation.</p>
      <h4>5. Voler sans réseau</h4>
      <p><b>Garder la carte OACI du trajet</b> (dans le briefing) enregistre la carte autour de la route sur l'appareil. Le dernier briefing reste lisible dans ${icon('#btn-hist')} <b>Historique</b>. En vol, choisis le fond « Carte OACI-VFR ».</p>
      <h4>Bon à savoir</h4>
      <p>${icon('#btn-measure')} <b>Mesurer</b> : distance, cap et temps de vol entre des points cliqués. <b>Clic droit</b> (ou appui long) sur la carte : les espaces aériens au-dessus.</p>
      <p class="meta">${esc(window.AWW_LOG.omText())}</p>
      <div class="warn">Outil d'aide : la préparation réglementaire reste SOFIA-Briefing, le SIA et aviation.meteo.fr.</div>
      <figure class="sign"><img src="icons/signature.jpg" width="200" height="135" alt="Insigne de Cyprien Agulhon"><figcaption>Conçu et réalisé par <b>Cyprien Agulhon</b></figcaption></figure>`);
    $('#help-tour').addEventListener('click', () => { $('#detail-close').click(); startTour(); });
    $('#help-news').addEventListener('click', () => showNews());
  }
  $('#btn-tour').addEventListener('click', showHelp);

  // ================================================================ Quoi de neuf (une fois après chaque mise à jour)
  const NEWS = { v: 60, items: [
    'Voyage : un tableau « jour par jour » donne la meilleure heure de départ de chaque étape sur les jours qui viennent.',
    'Horaires des terrains selon le jour : week-end, jours fériés (Pâques, 14 juillet…), pause de midi, « non assuré » ; et la pompe à carburant ouverte ou non à l\'heure d\'arrivée.',
    'Plan B à chaque escale : où dormir, terrains voisins ouverts avec carburant, prochain jour favorable pour repartir.',
    'Règles du voyage d\'après la route : plan de vol, gilets, Corse, région parisienne, nuit, documents à bord.',
    'Si le service météo Open-Meteo est bloqué, la préparation continue avec les prévisions publiées par le site, puis MET Norway.',
    'Le briefing indique l\'âge de chaque donnée (METAR, TAF, NOTAM, SUP AIP, météo de route), en orange si elle est ancienne.',
  ] };
  function showNews() {
    A.store.set('newsSeen', NEWS.v);
    A.showPanel('Quoi de neuf ?', `<ul class="news">${NEWS.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="row"><button class="btn primary" id="news-help">Comment ça marche ?</button></div>`);
    $('#news-help').addEventListener('click', showHelp);
  }
  const firstVisit = !A.store.get('tourDone', 0);
  if (firstVisit) A.store.set('newsSeen', NEWS.v);   // un nouveau venu a la visite guidée, pas les nouveautés
  if (location.hash.startsWith('#vol=')) { /* lien partagé : on ouvre la préparation, rien d'autre */ }
  else if (firstVisit) setTimeout(startTour, 1200);
  else if (A.store.get('newsSeen', 0) < NEWS.v) setTimeout(showNews, 1500);
})();
