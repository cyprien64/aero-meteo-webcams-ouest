/* Préparation de vol : route, vent, temps de vol, météo, NOTAM, SUP AIP, zones P/R/D, AZBA (RTBA),
 * infos VAC départ / arrivée / dégagement, puis briefing PDF (avec les cartes VAC jointes quand c'est possible).
 * Outil d'aide : ne remplace pas la préparation réglementaire (SOFIA, SIA, aviation.meteo.fr).
 */
(() => {
  'use strict';
  const A = window.AWW;
  if (!A) return;
  const { map, L, esc } = A;
  const $ = (s, el = document) => el.querySelector(s);
  const NM = 1852;
  const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('aww.prep.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('aww.prep.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // ------------------------------------------------------------------ géométrie
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
  // projection locale en NM (suffisante pour des distances de quelques centaines de NM)
  let PROJ_LAT = 46;
  const P = (p) => [p[1] * 60 * Math.cos(rad(PROJ_LAT)), p[0] * 60];
  function segDist(p, a, b) {
    const [px, py] = P(p), [ax, ay] = P(a), [bx, by] = P(b);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
  }
  function routeDist(p, pts) {
    let best = { d: Infinity, along: 0 }, acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = distNm(pts[i], pts[i + 1]);
      const r = segDist(p, pts[i], pts[i + 1]);
      if (r.d < best.d) best = { d: r.d, along: acc + r.t * len };
      acc += len;
    }
    return best;
  }
  function segInter(a, b, c, d) {
    const [ax, ay] = P(a), [bx, by] = P(b), [cx, cy] = P(c), [dx, dy] = P(d);
    const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    return o(ax, ay, bx, by, cx, cy) !== o(ax, ay, bx, by, dx, dy) && o(cx, cy, dx, dy, ax, ay) !== o(cx, cy, dx, dy, bx, by);
  }
  function inPoly(p, poly) {
    const [x, y] = P(p); let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = P(poly[i]), [xj, yj] = P(poly[j]);
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function polyRouteDist(poly, pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      if (inPoly(pts[i], poly)) return 0;
      for (let k = 0; k < poly.length - 1; k++) if (segInter(pts[i], pts[i + 1], poly[k], poly[k + 1])) return 0;
    }
    if (inPoly(pts[pts.length - 1], poly)) return 0;
    let m = Infinity;
    for (const v of poly) m = Math.min(m, routeDist(v, pts).d);
    for (const q of pts) for (let k = 0; k < poly.length - 1; k++) m = Math.min(m, segDist(q, poly[k], poly[k + 1]).d);
    return m;
  }

  // ------------------------------------------------------------------ soleil (NOAA simplifié)
  function sunTimes(date, la, lo) {
    const d0 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const n = Math.floor((d0 - Date.UTC(2000, 0, 1, 12)) / 864e5) + 1;
    const Js = n - lo / 360;
    const M = (357.5291 + 0.98560028 * Js) % 360;
    const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
    const lam = (M + C + 180 + 102.9372) % 360;
    const Jt = 2451545 + Js + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lam));
    const dec = Math.asin(Math.sin(rad(lam)) * Math.sin(rad(23.44)));
    const cosw = (Math.sin(rad(-0.833)) - Math.sin(rad(la)) * Math.sin(dec)) / (Math.cos(rad(la)) * Math.cos(dec));
    if (Math.abs(cosw) > 1) return null;
    const w = deg(Math.acos(cosw));
    const toDate = (j) => new Date((j - 2440587.5) * 864e5);
    return { rise: toDate(Jt - w / 360), set: toDate(Jt + w / 360) };
  }

  // ------------------------------------------------------------------ données
  let ZONES = null, VAC = null;
  async function loadAip() {
    if (!ZONES) ZONES = await A.getLive('zones.json').catch(() => ({ data: [] }));
    if (!VAC) VAC = await A.getLive('vac.json').catch(() => ({ data: {} }));
  }
  const hpaFor = (ft) => [[1000, 975], [1800, 950], [2600, 925], [3300, 900], [5000, 850], [6500, 800], [99999, 700]].find(([f]) => ft <= f)[1];

  async function windsAloft(points, ft, when) {
    const lv = hpaFor(ft);
    const day = when.toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p[0].toFixed(3)).join(',')}`
      + `&longitude=${points.map((p) => p[1].toFixed(3)).join(',')}`
      + `&hourly=wind_speed_${lv}hPa,wind_direction_${lv}hPa,temperature_${lv}hPa,freezing_level_height,cloud_cover_low`
      + `&wind_speed_unit=kn&timezone=UTC&start_date=${day}&end_date=${day}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('open-meteo ' + r.status);
    let d = await r.json();
    if (!Array.isArray(d)) d = [d];
    const h = when.getUTCHours();
    return d.map((x) => ({
      dir: x.hourly[`wind_direction_${lv}hPa`][h], spd: x.hourly[`wind_speed_${lv}hPa`][h],
      t: x.hourly[`temperature_${lv}hPa`][h], iso: x.hourly.freezing_level_height[h], low: x.hourly.cloud_cover_low[h], lv,
    }));
  }

  function parseAlt(s) { // "1800ft ASFC" / "FL 065" / "SFC" -> ft (approx.)
    if (!s) return null;
    if (/SFC|GND/.test(s)) return 0;
    if (/UNL/.test(s)) return 99999;
    let m = s.match(/FL ?(\d{2,3})/); if (m) return +m[1] * 100;
    m = s.match(/(\d{3,5}) ?ft/); if (m) return +m[1];
    return null;
  }

  // RTBA : NOTAM "ZONES AIRFORCE RTBA ACT ZONE R57 BRETAGNE 0900-1100:ACTIVE ..."
  function rtbaActivations(notams) {
    const out = [];
    for (const n of notams) {
      const t = (n.e || '') + ' ' + (n.efr || '');
      if (!/RTBA/.test(t)) continue;
      const re = /ZONE\s+(R\s?\d+\s?[A-Z]?\d?)\s+([A-Z' .-]+?)\s+((?:\d{4}-\d{4}:ACTIVE\s*)+)/g;
      let m;
      while ((m = re.exec(t))) {
        out.push({ zone: m[1].replace(/\s/g, ''), name: m[2].trim(), slots: m[3].match(/\d{4}-\d{4}/g), from: n.from, to: n.to, ref: n.ref });
      }
    }
    return out;
  }
  function slotOverlap(slot, dayStartMs, t0, t1) { // slot "1619-0059" sur le jour J (UTC)
    const s = +slot.slice(0, 2) * 60 + +slot.slice(2, 4), e = +slot.slice(5, 7) * 60 + +slot.slice(7, 9);
    const a = dayStartMs + s * 6e4, b = dayStartMs + (e <= s ? e + 1440 : e) * 6e4;
    return a < t1 && b > t0;
  }

  // ------------------------------------------------------------------ UI
  function aptOptions() {
    return A.APTS.map((a) => `<option value="${a.icao}">${esc(a.name)}</option>`).join('');
  }
  const pad = (n) => String(n).padStart(2, '0');
  function localInputValue(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const hhmm = (min) => `${Math.floor(min / 60)}h${pad(Math.round(min % 60))}`;
  const utc = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;

  function openForm() {
    const f = store.get('form', {});
    const next = new Date(Date.now() + 3600e3); next.setMinutes(0, 0, 0);
    A.showPanel('Préparation de vol', `
      <p class="meta">Saisis tes terrains (code OACI) : la route est calculée en ligne droite entre les points.</p>
      <datalist id="apt-list">${aptOptions()}</datalist>
      <div class="prep-form">
        <label>Départ<input id="pf-dep" list="apt-list" value="${esc(f.dep || '')}" placeholder="LFDT" autocomplete="off"></label>
        <label>Arrivée<input id="pf-arr" list="apt-list" value="${esc(f.arr || '')}" placeholder="LFRN" autocomplete="off"></label>
        <label class="full">Points tournants (codes OACI séparés par des espaces, optionnel)<input id="pf-wps" value="${esc(f.wps || '')}" placeholder="LFBX LFBI"></label>
        <label>Dégagement (optionnel)<input id="pf-alt" list="apt-list" value="${esc(f.alt || '')}" placeholder="LFRD" autocomplete="off"></label>
        <label>Départ (heure locale)<input id="pf-time" type="datetime-local" value="${localInputValue(next)}"></label>
        <label>Vitesse propre (kt)<input id="pf-tas" type="number" min="40" max="250" value="${f.tas || 95}"></label>
        <label>Altitude croisière (ft)<input id="pf-ft" type="number" min="500" max="12000" step="500" value="${f.ft || 2500}"></label>
        <label>Consommation (L/h)<input id="pf-ff" type="number" min="5" max="200" value="${f.ff || 25}"></label>
        <label>Réserve (min)<input id="pf-res" type="number" min="0" max="120" value="${f.res ?? 30}"></label>
        <label>Largeur couloir (NM de part et d'autre)<input id="pf-cor" type="number" min="2" max="30" value="${f.cor || 10}"></label>
        <label>Avion (immat.)<input id="pf-reg" value="${esc(f.reg || '')}" placeholder="F-XXXX"></label>
        <label class="full">Pilote<input id="pf-pil" value="${esc(f.pil || '')}"></label>
      </div>
      <div class="prep-actions">
        <button class="btn primary" id="pf-calc">Calculer la route</button>
        <button class="btn" id="pf-pdf">📄 Générer le briefing PDF</button>
      </div>
      <div class="prep-progress" id="pf-prog"></div>
      <div id="pf-out"></div>`);
    $('#pf-calc').addEventListener('click', () => run(false));
    $('#pf-pdf').addEventListener('click', () => run(true));
    ['#pf-dep', '#pf-arr', '#pf-alt'].forEach((s) => $(s).addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); }));
  }
  $('#btn-prep').addEventListener('click', openForm);

  function readForm() {
    const v = (s) => $(s).value.trim();
    const f = {
      dep: v('#pf-dep').toUpperCase(), arr: v('#pf-arr').toUpperCase(), alt: v('#pf-alt').toUpperCase(),
      wps: v('#pf-wps').toUpperCase(), time: v('#pf-time'), tas: +v('#pf-tas'), ft: +v('#pf-ft'), ff: +v('#pf-ff'),
      res: +v('#pf-res'), cor: +v('#pf-cor'), reg: v('#pf-reg'), pil: v('#pf-pil'),
    };
    store.set('form', { ...f, time: undefined });
    return f;
  }

  let routeLayer = null;
  let lastBrief = null;

  async function run(makePdf) {
    const prog = $('#pf-prog'), out = $('#pf-out');
    try {
      const f = readForm();
      const ids = [f.dep, ...f.wps.split(/[\s,;]+/).filter(Boolean), f.arr];
      const pts = ids.map((id) => A.aptByIcao[id]);
      const bad = ids.filter((id, i) => !pts[i]);
      if (!f.dep || !f.arr) throw new Error('Indique un terrain de départ et un terrain d\'arrivée.');
      if (bad.length) throw new Error(`Terrain inconnu : ${bad.join(', ')} (zone couverte : Pyrénées → Bretagne).`);
      if (f.alt && !A.aptByIcao[f.alt]) throw new Error(`Dégagement inconnu : ${f.alt}`);
      prog.textContent = 'Chargement des données AIP, vent en altitude…';
      await loadAip();
      const brief = await compute(f, ids, pts.map((a) => [a.la, a.lo]));
      lastBrief = brief;
      drawRoute(brief);
      out.innerHTML = summaryHtml(brief);
      $('#pf-pdf').disabled = false;
      prog.textContent = '';
      if (makePdf) {
        prog.textContent = 'Génération du PDF…';
        await buildPdf(brief, (t) => { prog.textContent = t; });
        prog.textContent = 'PDF généré ✔';
      }
    } catch (e) {
      console.error(e);
      prog.textContent = '';
      out.innerHTML = `<div class="warn">${esc(e.message || e)}</div>`;
    }
  }

  // ------------------------------------------------------------------ calcul du briefing
  async function compute(f, ids, pts) {
    PROJ_LAT = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const depT = new Date(f.time);
    const vacOf = (id) => (VAC && VAC.data && VAC.data[id]) || null;
    const varDeg = (() => {
      const v = [vacOf(f.dep), vacOf(f.arr)].map((x) => x && x.var).filter((x) => typeof x === 'number');
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    })();

    // Branches + vent
    const mids = [];
    for (let i = 0; i < pts.length - 1; i++) mids.push([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]);
    let winds = null, windErr = null;
    const horizon = (depT - Date.now()) / 864e5;
    if (horizon < -1 || horizon > 15) windErr = 'Vent non disponible pour cette date (prévisions à 16 jours).';
    else {
      try { winds = await windsAloft(mids, f.ft, depT); } catch (e) { windErr = 'Vent en altitude indisponible (' + e.message + ').'; }
    }
    const legs = [];
    let t = depT.getTime(), totDist = 0, totMin = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = distNm(pts[i], pts[i + 1]);
      const tc = bearing(pts[i], pts[i + 1]);
      const w = winds && winds[i] && winds[i].spd != null ? winds[i] : { dir: 0, spd: 0 };
      const wa = rad(w.dir - tc);
      const x = Math.max(-1, Math.min(1, (w.spd / f.tas) * Math.sin(wa)));
      const wca = deg(Math.asin(x));
      const gs = Math.max(20, f.tas * Math.cos(rad(wca)) - w.spd * Math.cos(wa));
      const th = (tc + wca + 360) % 360;
      const min = dist / gs * 60;
      legs.push({
        from: ids[i], to: ids[i + 1], dist, tc, tm: (tc - varDeg + 360) % 360, th, hm: (th - varDeg + 360) % 360,
        wca, gs, min, wind: winds ? w : null, eto: new Date(t + min * 6e4),
      });
      t += min * 6e4; totDist += dist; totMin += min;
    }
    const eta = new Date(t);
    const tripFuel = totMin / 60 * f.ff;
    const fuel = tripFuel + f.res / 60 * f.ff;
    // dégagement
    let altLeg = null;
    if (f.alt) {
      const a = A.aptByIcao[f.alt], b = pts[pts.length - 1];
      const d = distNm(b, [a.la, a.lo]);
      altLeg = { to: f.alt, dist: d, tc: bearing(b, [a.la, a.lo]), min: d / f.tas * 60 };
    }
    const sun = sunTimes(eta, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    const sunDep = sunTimes(depT, pts[0][0], pts[0][1]);

    // Météo : terrains + stations dans le couloir
    const wxIds = [...new Set([...ids, f.alt].filter(Boolean))];
    const wxNear = Object.values(A.metars).map((m) => ({ m, r: routeDist([m.lat, m.lon], pts) }))
      .filter((x) => x.r.d <= f.cor + 15 && !wxIds.includes(x.m.icaoId)).sort((a, b) => a.r.along - b.r.along);
    const nearestMetar = (id) => {
      const a = A.aptByIcao[id];
      return Object.values(A.metars).map((m) => ({ m, d: distNm([a.la, a.lo], [m.lat, m.lon]) })).sort((x, y) => x.d - y.d)[0];
    };
    const wx = wxIds.map((id) => ({ id, metar: A.metars[id], taf: A.tafs[id], near: A.metars[id] ? null : nearestMetar(id) }));

    // NOTAM
    const N = A.NOTAM || { fir: [], ad: {} };
    const t0 = depT.getTime() - 3600e3, t1 = eta.getTime() + 3600e3 + (altLeg ? altLeg.min * 6e4 : 0);
    const overlaps = (n) => (!n.from || Date.parse(n.from) <= t1) && (isNaN(Date.parse(n.to)) || Date.parse(n.to) >= t0);
    const adNotams = wxIds.map((id) => ({ id, list: (N.ad[id] || []).filter(overlaps) }));
    const ceil = f.ft / 100 + 15; // marge 1500 ft
    const enroute = [], general = [], obstacles = [];
    for (const n of N.fir || []) {
      if (n.la == null || !overlaps(n)) continue;
      if (/RTBA/.test(n.e || '')) continue;
      if (n.lower != null && n.lower > ceil) continue;
      const r = routeDist([n.la, n.lo], pts);
      if (r.d - (n.r || 0) > f.cor) continue;
      if ((n.r || 0) >= 100) general.push(n);
      else if ((n.q || '')[0] === 'O') obstacles.push({ n, along: r.along, d: r.d });
      else enroute.push({ n, along: r.along, d: r.d });
    }
    enroute.sort((a, b) => a.along - b.along); obstacles.sort((a, b) => a.along - b.along);

    // SUP AIP
    const flightDay = depT.toISOString().slice(0, 10);
    const sups = (A.SUP || []).filter((s) => (!s.from || s.from <= flightDay) && (!s.to || s.to >= flightDay))
      .map((s) => ({ s, d: Math.min(...s.places.map((p) => routeDist([p.la, p.lo], pts).d), Infinity) }))
      .filter((x) => x.d <= f.cor + 10).sort((a, b) => a.d - b.d);

    // Zones P/R/D traversées ou proches + AZBA
    const zones = [];
    for (const z of (ZONES && ZONES.data) || []) {
      const d = polyRouteDist(z.poly, pts);
      if (d > f.cor) continue;
      // Recouvrement vertical avec la croisière (ASFC : relief inconnu, marge de 1500 ft sur le plafond)
      const lo = parseAlt(z.lower), up = parseAlt(z.upper);
      const upFt = up === null ? 99999 : up + (/ASFC|AGL/.test(z.upper) ? 1500 : 0);
      const vert = (lo === null || lo <= f.ft + 500) && upFt >= f.ft - 500;
      zones.push({ z, d, crossed: d === 0, below: vert });
    }
    zones.sort((a, b) => (a.z.type + a.z.id).localeCompare(b.z.type + b.z.id));
    const acts = rtbaActivations(N.fir || []);
    const dayStart = Date.UTC(depT.getUTCFullYear(), depT.getUTCMonth(), depT.getUTCDate());
    const rtba = zones.filter((x) => x.z.rtba).map((x) => {
      const key = x.z.id.replace(/\s/g, '');
      const a = acts.filter((ac) => ac.zone === key && (!ac.from || Date.parse(ac.from) <= dayStart + 864e5) && (isNaN(Date.parse(ac.to)) || Date.parse(ac.to) >= dayStart));
      const slots = [...new Set(a.flatMap((ac) => ac.slots))];
      return { ...x, slots, conflict: slots.some((s) => slotOverlap(s, dayStart, t0, t1)) };
    });
    const azbaKnown = acts.length > 0 && Math.abs(horizon) < 1.5;

    // Webcams près des terrains
    const camsNear = (id) => {
      const a = A.aptByIcao[id];
      return A.SOURCES.filter((s) => s.t === 'cam').map((s) => ({ s, d: distNm([a.la, a.lo], [s.la, s.lo]) * 1.852 }))
        .filter((x) => x.d <= 15).sort((x, y) => x.d - y.d).slice(0, 6);
    };

    return {
      f, ids, pts, legs, totDist, totMin, eta, depT, tripFuel, fuel, altLeg, sun, sunDep, varDeg, winds, windErr,
      wx, wxNear, adNotams, enroute, general, obstacles, sups, zones, rtba, azbaKnown,
      vac: Object.fromEntries(wxIds.map((id) => [id, vacOf(id)])),
      cams: Object.fromEntries([f.dep, f.arr, f.alt].filter(Boolean).map((id) => [id, camsNear(id)])),
      generated: new Date(), notamGenerated: N.generated, vacCycle: VAC && VAC.cycle,
    };
  }

  // ------------------------------------------------------------------ carte
  function drawRoute(b) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.layerGroup().addTo(map);
    b.zones.filter((x) => x.crossed || x.z.rtba).forEach((x) => {
      L.polygon(x.z.poly, { color: x.z.rtba ? '#ff3b30' : x.z.type === 'P' ? '#ff2d55' : x.z.type === 'D' ? '#ff9f0a' : '#bf5af2', weight: 1.5, fillOpacity: .12 })
        .bindTooltip(`<b>${esc(x.z.id)} ${esc(x.z.name)}</b><br>${esc(x.z.lower)} – ${esc(x.z.upper)}${x.z.rtba ? '<br>RTBA (AZBA)' : ''}`, { className: 'tip', sticky: true })
        .addTo(routeLayer);
    });
    L.polyline(b.pts, { color: '#ff2bd6', weight: 4, opacity: .95 }).addTo(routeLayer);
    if (b.altLeg) {
      const a = A.aptByIcao[b.altLeg.to];
      L.polyline([b.pts[b.pts.length - 1], [a.la, a.lo]], { color: '#ff2bd6', weight: 2, dashArray: '6 6' }).addTo(routeLayer);
    }
    b.pts.forEach((p, i) => L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#ff2bd6', fillOpacity: 1 })
      .bindTooltip(b.ids[i], { permanent: true, direction: 'right', className: 'tip' }).addTo(routeLayer));
    map.fitBounds(L.latLngBounds(b.pts).pad(0.25), { paddingTopLeft: [320, 20], paddingBottomRight: [480, 20] });
  }

  function summaryHtml(b) {
    const warn = [];
    if (b.windErr) warn.push(b.windErr + ' Temps calculés sans vent.');
    if (b.sun && b.eta > new Date(b.sun.set.getTime() + 30 * 6e4)) warn.push(`Arrivée après la nuit aéronautique (coucher ${utc(b.sun.set)} + 30 min).`);
    if (b.sunDep && b.depT < new Date(b.sunDep.rise.getTime() - 30 * 6e4)) warn.push('Départ avant le début du jour aéronautique.');
    b.rtba.filter((r) => r.conflict && r.below).forEach((r) => warn.push(`AZBA : ${r.z.id} ${r.z.name} active pendant le vol (${r.slots.join(', ')} UTC).`));
    if (b.rtba.length && !b.azbaKnown) warn.push('Route proche de zones RTBA : créneaux AZBA non connus pour cette date → consulter l\'AZBA.');
    b.zones.filter((x) => x.crossed && x.below && x.z.type === 'P').forEach((x) => warn.push(`Zone interdite traversée : ${x.z.id} ${x.z.name}.`));
    const crossed = b.zones.filter((x) => x.crossed);
    return `
      <h4>Route ${b.ids.join(' → ')}</h4>
      <table class="legs"><tr><th>Branche</th><th>Dist</th><th>Rv</th><th>Vent</th><th>Cm</th><th>Vs</th><th>Temps</th><th>HEA</th></tr>
      ${b.legs.map((l) => `<tr><td>${l.from}→${l.to}</td><td>${l.dist.toFixed(0)} NM</td><td>${l.tc.toFixed(0)}°</td>
        <td>${l.wind ? `${Math.round(l.wind.dir)}°/${Math.round(l.wind.spd)}` : '–'}</td><td>${l.hm.toFixed(0)}°</td><td>${l.gs.toFixed(0)}</td>
        <td>${hhmm(l.min)}</td><td>${utc(l.eto)}</td></tr>`).join('')}
      <tr><th>Total</th><th>${b.totDist.toFixed(0)} NM</th><th colspan="4"></th><th>${hhmm(b.totMin)}</th><th>${utc(b.eta)}</th></tr></table>
      <p class="meta">Carburant : ${b.tripFuel.toFixed(0)} L + réserve ${b.f.res} min = <b>${b.fuel.toFixed(0)} L</b> minimum${b.altLeg ? ` (+ dégagement ${b.altLeg.to} ${b.altLeg.dist.toFixed(0)} NM ≈ ${hhmm(b.altLeg.min)})` : ''}.
      ${b.sun ? `Coucher du soleil à ${b.f.arr} : ${utc(b.sun.set)} (nuit aéro ${utc(new Date(b.sun.set.getTime() + 30 * 6e4))}).` : ''}
      Déclinaison utilisée : ${b.varDeg.toFixed(1)}°${b.winds ? ` · vent ${b.winds[0].lv} hPa (Open-Meteo)` : ''}.</p>
      ${warn.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('') || '<div class="okk">Aucune alerte majeure détectée automatiquement.</div>'}
      <p class="meta">${b.adNotams.reduce((s, x) => s + x.list.length, 0)} NOTAM terrains · ${b.enroute.length} NOTAM en route · ${b.obstacles.length} obstacles · ${b.sups.length} SUP AIP ·
        ${crossed.length} zones traversées (${b.zones.length} dans le couloir) · ${b.rtba.length} zones RTBA concernées.</p>`;
  }

  // ------------------------------------------------------------------ PDF
  const latin = (s) => String(s ?? '').replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/•/g, '-').replace(/œ/g, 'oe').replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, '');
  function frOnly(txt) {
    // Les VAC sont bilingues (souvent "EN.FR." sur une ligne) : on garde le texte tel quel mais on compacte.
    return latin(txt).replace(/\n{2,}/g, '\n').replace(/←/g, '');
  }

  async function buildPdf(b, progress) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 12;
    let y = 0;
    const title = latin(`Briefing vol ${b.ids.join(' -> ')}${b.f.alt ? ` (dégagement ${b.f.alt})` : ''}`);
    const headerBar = () => {
      doc.setFillColor(0, 102, 153); doc.rect(0, 0, W, 16, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(doc.splitTextToSize(title, W - 2 * M)[0], M, 7.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(latin(`Départ le ${b.depT.toLocaleDateString('fr-FR', { timeZone: 'UTC' })} à ${utc(b.depT)}`), M, 13);
      doc.text(latin(`Briefing généré le ${b.generated.toISOString().slice(0, 16).replace('T', ' ')}Z`), W - M, 13, { align: 'right' });
      doc.setTextColor(0); doc.setFont('helvetica', 'normal');
    };
    const header = () => { headerBar(); y = 22; };
    const footer = () => {
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFontSize(7); doc.setTextColor(110);
        doc.text(latin('Outil d\'aide - ne remplace pas la préparation réglementaire (SOFIA-Briefing, SIA, aviation.meteo.fr). Vérifier NOTAM, AZBA et VAC officiels avant le vol.'), M, 292);
        doc.text(`${i}/${n}`, W - M, 292, { align: 'right' });
      }
    };
    const ensure = (h) => { if (y + h > 282) { doc.addPage(); header(); } };
    const h2 = (t) => {
      ensure(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 80, 130);
      doc.text(latin(t), M, y); y += 1.5; doc.setDrawColor(0, 102, 153); doc.setLineWidth(.4); doc.line(M, y, W - M, y);
      y += 5; doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    };
    const para = (t, opt = {}) => {
      doc.setFont(opt.mono ? 'courier' : 'helvetica', opt.bold ? 'bold' : 'normal');
      doc.setFontSize(opt.size || (opt.mono ? 8 : 9));
      if (opt.color) doc.setTextColor(...opt.color);
      const lines = doc.splitTextToSize(latin(t), W - 2 * M - (opt.indent || 0));
      const lh = (opt.size || (opt.mono ? 8 : 9)) * 0.42;
      for (const l of lines) { ensure(lh + 1); doc.text(l, M + (opt.indent || 0), y); y += lh; }
      y += opt.gap ?? 1.5; doc.setTextColor(0);
    };
    const table = (head, body, opt = {}) => {
      doc.autoTable({
        startY: y, head: [head.map(latin)], body: body.map((r) => r.map(latin)), margin: { left: M, right: M, top: 22 },
        styles: { fontSize: opt.size || 8, cellPadding: 1.2, overflow: 'linebreak' }, headStyles: { fillColor: [0, 102, 153] },
        theme: 'grid', didDrawPage: () => headerBar(),
        ...opt.at,
      });
      y = doc.lastAutoTable.finalY + 4;
    };

    // ---- Page 1 : synthèse
    header();
    para(latin([b.f.pil && `Pilote : ${b.f.pil}`, b.f.reg && `Avion : ${b.f.reg}`, `Vp ${b.f.tas} kt`, `Croisière ${b.f.ft} ft`,
      `Conso ${b.f.ff} L/h`, `Couloir ±${b.f.cor} NM`].filter(Boolean).join('   ·   ')), { bold: true });
    h2('Navigation');
    table(['Branche', 'Dist NM', 'Rv', 'Rm', 'Vent', 'Dérive', 'Cm', 'Vs kt', 'Temps', 'HEA (UTC)'],
      b.legs.map((l) => [`${l.from} -> ${l.to}`, l.dist.toFixed(0), `${l.tc.toFixed(0)}°`, `${l.tm.toFixed(0)}°`,
        l.wind ? `${Math.round(l.wind.dir)}°/${Math.round(l.wind.spd)} kt` : '-', `${l.wca >= 0 ? '+' : ''}${l.wca.toFixed(0)}°`,
        `${l.hm.toFixed(0)}°`, l.gs.toFixed(0), hhmm(l.min), utc(l.eto)]).concat([[
        'TOTAL', b.totDist.toFixed(0), '', '', '', '', '', '', hhmm(b.totMin), utc(b.eta)]]));
    para(`Départ ${b.f.dep} ${utc(b.depT)} - Arrivée estimée ${b.f.arr} ${utc(b.eta)}. Carburant mini : ${b.tripFuel.toFixed(0)} L + réserve ${b.f.res} min = ${b.fuel.toFixed(0)} L`
      + (b.altLeg ? ` (+ dégagement ${b.altLeg.to} : ${b.altLeg.dist.toFixed(0)} NM, Rv ${b.altLeg.tc.toFixed(0)}°, ~${hhmm(b.altLeg.min)}, ${(b.altLeg.min / 60 * b.f.ff).toFixed(0)} L).` : '.'));
    if (b.sunDep && b.sun) para(`Soleil : lever ${utc(b.sunDep.rise)} à ${b.f.dep} - coucher ${utc(b.sun.set)} à ${b.f.arr} (nuit aéronautique ${utc(new Date(b.sun.set.getTime() + 30 * 6e4))}).`);
    para(`Déclinaison magnétique utilisée : ${b.varDeg.toFixed(1)}° (VAC). ${b.winds ? `Vent prévu au niveau ${b.winds[0].lv} hPa (Open-Meteo, modèle) - températures ${b.winds.map((w) => Math.round(w.t) + '°C').join(' / ')}, isotherme 0° ~${Math.round((b.winds[0].iso || 0) * 3.281 / 100) * 100} ft.` : b.windErr || ''}`, { size: 8, color: [80, 80, 80] });

    // Alertes
    const alerts = [];
    if (b.sun && b.eta > new Date(b.sun.set.getTime() + 30 * 6e4)) alerts.push('Arrivée après la nuit aéronautique.');
    b.rtba.filter((r) => r.conflict && r.below).forEach((r) => alerts.push(`AZBA : ${r.z.id} ${r.z.name} ACTIVE pendant le vol (${r.slots.join(', ')} UTC) - contourner.`));
    if (b.rtba.length && !b.azbaKnown) alerts.push('Créneaux AZBA non publiés pour la date du vol : consulter l\'AZBA (SIA) la veille / le jour même.');
    b.zones.filter((x) => x.crossed && x.below).forEach((x) => alerts.push(`Zone ${x.z.id} ${x.z.name} traversée (${x.z.lower} - ${x.z.upper}).`));
    if (alerts.length) { h2('Points d\'attention'); alerts.forEach((a) => para('- ' + a, { color: [170, 40, 0] })); }

    // Croquis de route
    progress('PDF : croquis de route…');
    drawSketch(doc, b, M, y + 2, W - 2 * M, 95); y += 100;

    // ---- Météo
    h2('Météo - METAR / TAF');
    for (const w of b.wx) {
      const role = w.id === b.f.dep ? 'Départ' : w.id === b.f.arr ? 'Arrivée' : w.id === b.f.alt ? 'Dégagement' : 'Point tournant';
      para(`${role} ${w.id} ${A.aptByIcao[w.id] ? A.aptByIcao[w.id].name : ''}`, { bold: true, gap: .5 });
      if (w.metar) para(`${w.metar.rawOb}   [${w.metar.fltCat || '?'}]`, { mono: true, gap: .5 });
      else if (w.near) para(`Pas de METAR - station la plus proche ${w.near.m.icaoId} (${w.near.d.toFixed(0)} NM) : ${w.near.m.rawOb}`, { mono: true, gap: .5 });
      if (w.taf) para(w.taf.rawTAF, { mono: true });
      else if (w.near && A.tafs[w.near.m.icaoId]) para(A.tafs[w.near.m.icaoId].rawTAF, { mono: true });
      y += 1;
    }
    if (b.wxNear.length) {
      para('Stations le long de la route :', { bold: true, gap: .5 });
      b.wxNear.forEach((x) => para(`${x.m.rawOb}   [${x.m.fltCat || '?'}] (${x.r.d.toFixed(0)} NM de la route)`, { mono: true, gap: .5 }));
    }
    para('Compléter avec TEMSI / WINTEM / cartes et prévisions officielles sur aviation.meteo.fr.', { size: 8, color: [90, 90, 90] });

    // ---- NOTAM
    progress('PDF : NOTAM…');
    h2(`NOTAM (SOFIA-Briefing, collecte ${b.notamGenerated ? b.notamGenerated.slice(0, 16).replace('T', ' ') + 'Z' : '?'})`);
    const notamRow = (n, extra = '') => [n.ref + (n.a ? `\n${n.a}` : ''), `${A.fmtT(n.from)}\n${A.fmtT(n.to)}`, `${A.fl(n.lower)}-${A.fl(n.upper)}${extra}`, n.efr || n.e || ''];
    for (const x of b.adNotams) {
      para(`Terrain ${x.id} : ${x.list.length ? x.list.length + ' NOTAM' : 'aucun NOTAM sur la période du vol'}`, { bold: true, gap: .5 });
      if (x.list.length) table(['Réf.', 'Validité', 'Niveaux', 'Texte'], x.list.map((n) => notamRow(n)), { at: { columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 24 }, 2: { cellWidth: 22 } } } });
    }
    para(`En route (couloir ±${b.f.cor} NM, plancher <= ${b.f.ft + 1500} ft) : ${b.enroute.length} NOTAM`, { bold: true, gap: .5 });
    if (b.enroute.length) table(['Réf.', 'Validité', 'Niveaux / pos.', 'Texte'], b.enroute.map((x) => notamRow(x.n, `\nà ${x.along.toFixed(0)} NM`)), { at: { columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 24 }, 2: { cellWidth: 22 } } } });
    if (b.obstacles.length) {
      para(`Obstacles NOTAM dans le couloir : ${b.obstacles.length}`, { bold: true, gap: .5 });
      table(['Réf.', 'Validité', 'Niveaux / pos.', 'Texte'], b.obstacles.map((x) => notamRow(x.n, `\nà ${x.along.toFixed(0)} NM`)), { size: 7, at: { columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 24 }, 2: { cellWidth: 22 } } } });
    }
    if (b.general.length) {
      para(`NOTAM de portée FIR (rayon >= 100 NM) : ${b.general.length}`, { bold: true, gap: .5 });
      table(['Réf.', 'Validité', 'Niveaux', 'Texte'], b.general.map((n) => notamRow(n)), { size: 7, at: { columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 24 }, 2: { cellWidth: 22 } } } });
    }

    // ---- SUP AIP
    h2('SUP AIP');
    if (!b.sups.length) para('Aucun SUP AIP localisé près de la route pour la date du vol (localisation déduite des titres : vérifier la liste complète du SIA).');
    else table(['SUP', 'Titre', 'Validité', 'Distance'], b.sups.map((x) => [x.s.num, x.s.title, `${x.s.from || '?'} -> ${x.s.to || '?'}`, `${x.d.toFixed(0)} NM`]),
      { at: { columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 34 }, 3: { cellWidth: 16 } } } });

    // ---- AZBA / zones
    h2('AZBA (RTBA) et zones P / R / D');
    if (b.rtba.length) {
      table(['Zone RTBA', 'Limites', 'Traversée', 'Créneaux actifs (UTC) le jour du vol', 'Conflit'],
        b.rtba.map((r) => [`${r.z.id} ${r.z.name}`, `${r.z.lower} - ${r.z.upper}`, (r.crossed ? 'OUI' : `à ${r.d.toFixed(0)} NM`) + (r.below ? '' : '\n(hors altitude)'),
          r.slots.length ? r.slots.join(', ') : (b.azbaKnown ? 'non active' : 'inconnu (consulter AZBA)'), r.conflict ? 'ACTIVE pendant le vol' : '-']));
    } else para('Aucune zone RTBA dans le couloir.');
    para('Créneaux issus des NOTAM "ZONES AIRFORCE RTBA ACT" (SOFIA). Référence : carte AZBA du SIA (www.sia.aviation-civile.gouv.fr/schedules).', { size: 8, color: [90, 90, 90] });
    const others = b.zones.filter((x) => !x.z.rtba);
    if (others.length) table(['Zone', 'Plancher - plafond', 'Position', 'Remarques / activation'],
      others.map((x) => [`${x.z.id} ${x.z.name}`, `${x.z.lower} - ${x.z.upper}`, (x.crossed ? 'TRAVERSÉE' : `à ${x.d.toFixed(0)} NM`) + (x.below ? '' : `\nhors altitude ${b.f.ft} ft`), (x.z.rmk || '').slice(0, 260)]),
      { size: 7, at: { columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 30 }, 2: { cellWidth: 20 } } } });

    // ---- Terrains (VAC)
    progress('PDF : fiches terrains (VAC)…');
    for (const id of [b.f.dep, ...b.ids.slice(1, -1), b.f.arr, b.f.alt].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)) {
      doc.addPage(); header();
      const role = id === b.f.dep ? 'DÉPART' : id === b.f.arr ? 'ARRIVÉE' : id === b.f.alt ? 'DÉGAGEMENT' : 'POINT TOURNANT';
      const a = A.aptByIcao[id], v = b.vac[id];
      h2(`${role} : ${id} ${a ? a.name : ''}`);
      if (!v) { para('Carte VAC non disponible dans la base (terrain privé, ULM ou hors AIP) : se renseigner auprès de l\'exploitant.'); continue; }
      const rows = [
        ['Altitude terrain', v.alt != null ? `${v.alt} ft (${v.hpa} hPa)` : '-'],
        ['Pistes', [(v.qfu || []).join(' / '), (v.rwy || []).join(', '), (v.surface || []).join(' ')].filter(Boolean).join(' · ') || '-'],
        ['Tour de piste', (v.tdp || []).join(' ; ') || 'voir VAC'],
        ['Fréquences', (v.freqs || []).join('\n') || 'voir VAC'],
        ['Moyens radio', (v.nav || []).join(', ') || '-'],
        ['Espaces aériens', (v.espaces || []).join('\n') || '-'],
        ['Obstacles', (v.obst || []).join('\n') || '-'],
        ['Carburant', v.carburant || '-'],
        ['Statut', [v.cap ? 'Ouvert à la CAP' : null, v.restreint ? 'Usage restreint' : null, v.prive ? 'Usage privé' : null].filter(Boolean).join(', ') || '-'],
      ];
      if (b.wx.find((w) => w.id === id && w.metar)) {
        const m = b.wx.find((w) => w.id === id).metar;
        rows.unshift(['Vent actuel', `${m.wdir ?? '?'}°/${m.wspd ?? '?'} kt${m.wgst ? ' G' + m.wgst : ''}`]);
      }
      table(['Élément', 'Information (extrait de la VAC)'], rows, { at: { columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold' } } } });
      if (v.consignes) { para('Consignes particulières (VAC) :', { bold: true, gap: .5 }); para(frOnly(v.consignes), { size: 7.5 }); }
      if (v.infos) { para('Informations diverses (VAC) :', { bold: true, gap: .5 }); para(frOnly(v.infos), { size: 7.5 }); }
      const cams = b.cams[id] || [];
      if (cams.length) { para('Webcams à proximité :', { bold: true, gap: .5 }); cams.forEach((c) => para(`- ${c.s.n} (${c.d.toFixed(0)} km) : ${c.s.u}`, { size: 7.5, gap: .3 })); }
      para(`Carte VAC officielle (cycle ${b.vacCycle || '?'}) : ${v.url}`, { size: 7.5, color: [0, 80, 160] });
    }
    footer();

    // ---- Assemblage avec les VAC (pdf-lib)
    let bytes = doc.output('arraybuffer');
    const vacIds = [b.f.dep, b.f.arr, b.f.alt, ...b.ids.slice(1, -1)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && b.vac[v]);
    const failed = [];
    if (window.PDFLib && vacIds.length) {
      try {
        const out = await PDFLib.PDFDocument.load(bytes);
        for (const id of vacIds) {
          progress(`PDF : ajout de la VAC ${id}…`);
          try {
            const r = await fetch(b.vac[id].url);
            if (!r.ok) throw new Error(r.status);
            const src = await PDFLib.PDFDocument.load(await r.arrayBuffer(), { ignoreEncryption: true });
            const pages = await out.copyPages(src, src.getPageIndices());
            pages.forEach((p) => out.addPage(p));
          } catch (e) { failed.push(id); }
        }
        bytes = await out.save();
      } catch (e) { console.warn('pdf-lib', e); }
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const name = `briefing_${b.ids.join('-')}_${b.depT.toISOString().slice(0, 10)}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => window.open(url, '_blank'), 300);
    if (failed.length) {
      $('#pf-out').insertAdjacentHTML('beforeend', `<div class="warn">Les cartes VAC ${failed.join(', ')} n'ont pas pu être jointes ${A.IS_EXT ? '' : '(le site du SIA bloque le téléchargement depuis une page web : utilise l\'extension Chrome pour les joindre automatiquement)'}. Leurs liens officiels figurent dans le PDF.</div>`);
    }
  }

  // Croquis vectoriel : contours, zones traversées, route
  function drawSketch(doc, b, x0, y0, w, h) {
    const pts = b.pts.concat(b.altLeg ? [[A.aptByIcao[b.altLeg.to].la, A.aptByIcao[b.altLeg.to].lo]] : []);
    let s = Math.min(...pts.map((p) => p[0])), n = Math.max(...pts.map((p) => p[0]));
    let wl = Math.min(...pts.map((p) => p[1])), e = Math.max(...pts.map((p) => p[1]));
    const k = Math.cos(rad((s + n) / 2));
    const padLa = Math.max(0.3, (n - s) * 0.15), padLo = Math.max(0.4, (e - wl) * 0.15);
    s -= padLa; n += padLa; wl -= padLo; e += padLo;
    // conserver le ratio
    const sx = w / ((e - wl) * k), sy = h / (n - s), sc = Math.min(sx, sy);
    const cx = x0 + (w - (e - wl) * k * sc) / 2, cy = y0 + (h - (n - s) * sc) / 2;
    const pr = (p) => [cx + (p[1] - wl) * k * sc, cy + (n - p[0]) * sc];
    doc.setFillColor(214, 234, 248); doc.rect(x0, y0, w, h, 'F');
    const clip = (p) => p[0] >= x0 - 5 && p[0] <= x0 + w + 5 && p[1] >= y0 - 5 && p[1] <= y0 + h + 5;
    const path = (ring, style) => {
      const q = ring.map(pr);
      if (!q.some(clip)) return;
      const segs = []; for (let i = 1; i < q.length; i++) segs.push([q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]]);
      doc.lines(segs, q[0][0], q[0][1], [1, 1], style, true);
    };
    // tout ce qui suit est découpé au cadre du croquis
    doc.saveGraphicsState(); doc.rect(x0, y0, w, h, null); doc.clip(); doc.discardPath();
    doc.setLineWidth(0.2); doc.setDrawColor(120, 150, 170); doc.setFillColor(245, 245, 240);
    for (const f of (window.BASEMAP && window.BASEMAP.features) || []) {
      if (f.properties.k === 'reg') continue;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const pl of polys) path(pl[0].map((c) => [c[1], c[0]]), 'FD');
    }
    for (const x of b.zones) {
      if (x.z.rtba) { doc.setDrawColor(220, 30, 30); doc.setFillColor(255, 220, 220); }
      else if (x.z.type === 'P') { doc.setDrawColor(200, 0, 60); doc.setFillColor(255, 210, 225); }
      else if (x.z.type === 'D') { doc.setDrawColor(230, 130, 0); doc.setFillColor(255, 236, 205); }
      else { doc.setDrawColor(140, 60, 200); doc.setFillColor(240, 225, 255); }
      doc.setLineWidth(0.3); path(x.z.poly, 'FD');
      const c = pr([x.z.poly.reduce((a, p) => a + p[0], 0) / x.z.poly.length, x.z.poly.reduce((a, p) => a + p[1], 0) / x.z.poly.length]);
      if (clip(c)) { doc.setFontSize(5.5); doc.setTextColor(120, 0, 0); doc.text(latin(x.z.id), c[0], c[1], { align: 'center' }); }
    }
    // couloir + route
    doc.setDrawColor(255, 0, 180); doc.setLineWidth(0.9);
    for (let i = 0; i < b.pts.length - 1; i++) { const a = pr(b.pts[i]), c = pr(b.pts[i + 1]); doc.line(a[0], a[1], c[0], c[1]); }
    if (b.altLeg) {
      const a = pr(b.pts[b.pts.length - 1]), c = pr(pts[pts.length - 1]);
      doc.setLineWidth(0.4); doc.setLineDashPattern([1.5, 1.2], 0); doc.line(a[0], a[1], c[0], c[1]); doc.setLineDashPattern([], 0);
    }
    doc.setFontSize(7.5); doc.setTextColor(0);
    pts.forEach((p, i) => {
      const q = pr(p); doc.setFillColor(255, 0, 180); doc.circle(q[0], q[1], 1.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.text(i < b.ids.length ? b.ids[i] : b.altLeg.to, q[0] + 2, q[1] - 1.5);
    });
    // aérodromes du couloir
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(30, 110, 30);
    for (const a of A.APTS) {
      if (b.ids.includes(a.icao)) continue;
      const q = pr([a.la, a.lo]);
      if (!clip(q) || routeDist([a.la, a.lo], b.pts).d > b.f.cor * 1.5) continue;
      doc.setDrawColor(30, 110, 30); doc.setLineWidth(0.3); doc.circle(q[0], q[1], 0.7, 'S'); doc.text(a.icao, q[0] + 1.2, q[1] + 0.6);
    }
    doc.restoreGraphicsState();
    doc.setTextColor(0); doc.setDrawColor(0, 102, 153); doc.setLineWidth(0.3); doc.rect(x0, y0, w, h, 'S');
    doc.setFontSize(6.5); doc.setTextColor(90);
    doc.text(latin('Croquis indicatif - rouge : RTBA · rose : P · orange : D · violet : R · vert : aérodromes du couloir'), x0 + 1.5, y0 + h - 1.5);
    doc.setTextColor(0);
  }
})();
