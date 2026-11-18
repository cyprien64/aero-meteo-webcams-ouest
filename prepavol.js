/* Préparation de vol — Aéro Météo Webcams Ouest
 *  - avions du club (DR400 Rotax 912iS, DR401 CDI 155) : performances, masse et centrage
 *  - route directe entre les terrains, avec contournement automatique des zones interdites (P)
 *    et des zones RTBA actives pendant le vol
 *  - espaces aériens traversés et fréquences (CTR/TMA/CTA/SIV), altitude de sécurité (relief)
 *  - briefing départ / arrivée établi d'après la carte VAC (piste probable, vent, distances, consignes)
 *  - log de navigation au format du log ACB + briefing PDF (météo, NOTAM, SUP AIP, AZBA, VAC)
 * Outil d'aide : ne remplace pas la préparation réglementaire (SOFIA, SIA, aviation.meteo.fr).
 */
(() => {
  'use strict';
  const A = window.AWW;
  if (!A) return;
  const { map, L, esc } = A;
  const $ = (s, el = document) => el.querySelector(s);
  const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
  const TYPES = window.AIRCRAFT_TYPES || {}, FLEET = window.AIRCRAFT || [];
  const store = {
    get(k, d) { try { const v = localStorage.getItem('aww.prep2.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('aww.prep2.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (min) => `${Math.floor(min / 60)}h${pad(Math.round(min % 60))}`;
  const utc = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  const r3 = (x) => String(Math.round(x) % 360 || 360).padStart(3, '0');

  // ================================================================== géométrie
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
  function destPt(p, brg, nm) {
    const d = nm / 3440.065, la1 = rad(p[0]), lo1 = rad(p[1]), b = rad(brg);
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
    const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    return [deg(la2), deg(lo2)];
  }
  let PROJ_LAT = 46;
  const P = (p) => [p[1] * 60 * Math.cos(rad(PROJ_LAT)), p[0] * 60];
  const UNP = (q) => [q[1] / 60, q[0] / (60 * Math.cos(rad(PROJ_LAT)))];
  function segDistXY(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
  }
  function segDist(p, a, b) { const [px, py] = P(p), [ax, ay] = P(a), [bx, by] = P(b); return segDistXY(px, py, ax, ay, bx, by); }
  function routeDist(p, pts) {
    let best = { d: Infinity, along: 0 }, acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = distNm(pts[i], pts[i + 1]); const r = segDist(p, pts[i], pts[i + 1]);
      if (r.d < best.d) best = { d: r.d, along: acc + r.t * len, leg: i };
      acc += len;
    }
    return best;
  }
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  function properX(a, b, c, d) {   // intersection stricte de [ab] et [cd] (plan projeté)
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  }
  function inPolyXY(x, y, q) {
    let ins = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      if ((q[i][1] > y) !== (q[j][1] > y) && x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) ins = !ins;
    }
    return ins;
  }
  const inPoly = (p, poly) => { const [x, y] = P(p); return inPolyXY(x, y, poly.map(P)); };
  function polyRouteDist(poly, pts) {
    const q = poly.map(P);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = P(pts[i]), b = P(pts[i + 1]);
      if (inPolyXY(a[0], a[1], q)) return 0;
      for (let k = 0; k < q.length - 1; k++) if (properX(a, b, q[k], q[k + 1])) return 0;
    }
    const e = P(pts[pts.length - 1]); if (inPolyXY(e[0], e[1], q)) return 0;
    let m = Infinity;
    for (const v of poly) m = Math.min(m, routeDist(v, pts).d);
    for (const p of pts) { const [x, y] = P(p); for (let k = 0; k < q.length - 1; k++) m = Math.min(m, segDistXY(x, y, q[k][0], q[k][1], q[k + 1][0], q[k + 1][1]).d); }
    return m;
  }
  function hull(points) {   // enveloppe convexe (monotone chain) en coordonnées projetées
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up);
  }

  // ================================================================== soleil
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
  A.sunTimes = sunTimes;   // utilisé aussi par la carte jour / nuit (extras.js)

  // ================================================================== données
  let ZONES = null, VAC = null, ASP = null;
  async function loadAip() {
    if (!ZONES) ZONES = await A.getLive('zones.json').catch(() => ({ data: [] }));
    if (!VAC) VAC = await A.getLive('vac.json').catch(() => ({ data: {} }));
    if (!ASP) ASP = await A.getLive('airspaces.json').catch(() => ({ data: [] }));
    await loadVfr();
  }
  // ---- Points de report VFR (export XML SIA) : "BP-N" = point N de LFBP
  let VFR = null;
  async function loadVfr() {
    if (!VFR) VFR = await A.getLive('vfr_points.json').catch(() => fetch('data/vfr_points.json').then((r) => r.json())).catch(() => ({ data: {} }));
    return VFR;
  }
  function vfrOf(icao) { return (VFR && VFR.data && VFR.data[icao]) || []; }
  function resolvePt(id) {
    if (CUSTOM[id]) return { ...CUSTOM[id], id, kind: 'pt' };
    const c = id.match(/^(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)$/);
    if (c) {
      const lab = `PT${++customN}`;
      CUSTOM[lab] = { la: +c[1], lo: +c[2], name: `Point libre ${(+c[1]).toFixed(3)} ${(+c[2]).toFixed(3)}`, token: id };
      return { ...CUSTOM[lab], id: lab, kind: 'pt' };
    }
    const a = A.aptByIcao[id];
    if (a) return { id, la: a.la, lo: a.lo, name: a.name, kind: 'ad', ad: id };
    const m = id.match(/^(?:LF)?([A-Z]{2})-([A-Z0-9]{1,5})$/);
    if (m) {
      const ad = 'LF' + m[1], p = vfrOf(ad).find((x) => x.id === m[2]);
      if (p) return { id: `${m[1]}-${p.id}`, la: p.la, lo: p.lo, name: `${p.id} (${p.desc})`, desc: p.desc, kind: 'vfr', ad };
    }
    return null;
  }
  function bestVfr(ad, other, isExit) {   // point qui rallonge le moins le trajet
    const pts = vfrOf(ad).filter((p) => !/HEL|hélicoptère|réservé/i.test(p.desc));
    if (!pts.length || !other) return null;
    const a = A.aptByIcao[ad];
    let best = null, bd = Infinity;
    for (const p of pts) {
      const d = distNm([a.la, a.lo], [p.la, p.lo]) + distNm([p.la, p.lo], other);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? `${ad.slice(2)}-${best.id}` : null;
  }
  window.AWW_VFR = { loadVfr, vfrOf };
  // Open-Meteo limite le nombre d'appels par minute : nouvel essai après 6 puis 20 s, cache des réponses identiques
  const omCache = new Map();
  async function omFetch(url) {
    if (omCache.has(url)) return omCache.get(url);
    let r;
    for (const wait of [0, 6000, 20000]) {
      if (wait) { const p = document.getElementById('pf-prog'); if (p && !/patiente/.test(p.textContent)) p.textContent += ' (serveur météo saturé, patiente…)'; await new Promise((ok) => setTimeout(ok, wait)); }
      r = await fetch(url);
      if (r.status !== 429) break;
    }
    if (!r.ok) throw new Error((r.status === 429 ? 'serveur météo saturé, réessayer dans une minute ' : 'open-meteo ') + r.status);
    const j = await r.json();
    if (omCache.size > 40) omCache.clear();
    omCache.set(url, j);
    return j;
  }
  const WLV = [1000, 975, 950, 925, 900, 850, 800, 700, 600];
  const roundHour = (d) => new Date(Math.round(d.getTime() / 36e5) * 36e5).toISOString().slice(0, 13) + ':00';
  // Vent à l'altitude exacte (interpolé entre les niveaux de pression encadrants, via leur géopotentiel)
  // et à l'heure de passage de chaque point.
  async function windsAloft(points, ft, times) {
    const days = [...new Set(times.map((t) => t.toISOString().slice(0, 10)))].sort();
    const vars = WLV.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `temperature_${l}hPa`, `geopotential_height_${l}hPa`]);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p[0].toFixed(3)).join(',')}`
      + `&longitude=${points.map((p) => p[1].toFixed(3)).join(',')}`
      + `&hourly=${vars.join(',')},freezing_level_height&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`;
    let d = await omFetch(url); if (!Array.isArray(d)) d = [d];
    return d.map((x, i) => {
      const h = x.hourly, idx = Math.max(0, h.time.indexOf(roundHour(times[i])));
      const lv = WLV.map((l) => ({ l, z: h[`geopotential_height_${l}hPa`][idx] * 3.281, s: h[`wind_speed_${l}hPa`][idx], dir: h[`wind_direction_${l}hPa`][idx], t: h[`temperature_${l}hPa`][idx] }))
        .filter((v) => v.z != null && !isNaN(v.z) && v.s != null).sort((a, b) => a.z - b.z);
      let a = lv[0], b = lv[lv.length - 1];
      for (let k = 0; k < lv.length - 1; k++) if (lv[k].z <= ft && lv[k + 1].z >= ft) { a = lv[k]; b = lv[k + 1]; break; }
      const k = b.z === a.z ? 0 : Math.max(0, Math.min(1, (ft - a.z) / (b.z - a.z)));
      const uv = (v) => [-v.s * Math.sin(rad(v.dir)), -v.s * Math.cos(rad(v.dir))];
      const [ua, va] = uv(a), [ub, vb] = uv(b), u = ua + (ub - ua) * k, v = va + (vb - va) * k;
      return { dir: (deg(Math.atan2(-u, -v)) + 360) % 360, spd: Math.hypot(u, v), t: a.t + (b.t - a.t) * k, iso: h.freezing_level_height[idx], lv: `${a.l}/${b.l}`, at: times[i] };
    });
  }
  async function elevations(points) { // m, par paquets de 100
    const out = [];
    for (let i = 0; i < points.length; i += 100) {
      const ch = points.slice(i, i + 100);
      const j = await omFetch(`https://api.open-meteo.com/v1/elevation?latitude=${ch.map((p) => p[0].toFixed(4)).join(',')}&longitude=${ch.map((p) => p[1].toFixed(4)).join(',')}`);
      out.push(...j.elevation);
    }
    return out;
  }
  function parseAlt(s) { // -> ft (ASFC/AGL ramené au sol = valeur brute)
    if (!s) return null;
    if (/SFC|GND/i.test(s)) return 0;
    if (/UNL/i.test(s)) return 99999;
    let m = s.match(/FL ?(\d{2,3})/i); if (m) return +m[1] * 100;
    m = s.match(/(\d{3,5}) ?FT/i); if (m) return +m[1];
    return null;
  }
  const isAgl = (s) => /ASFC|AGL|SFC\b(?! *-)/i.test(s || '') && !/^SFC$|^GND$/i.test((s || '').trim());

  // RTBA : NOTAM "ZONES AIRFORCE RTBA ACT ZONE R57 BRETAGNE 0900-1100:ACTIVE ..."
  function rtbaActivations(notams) {
    const out = [];
    for (const n of notams) {
      const t = (n.e || '') + ' ' + (n.efr || '');
      if (!/RTBA/.test(t)) continue;
      const re = /ZONE\s+(R\s?\d+\s?[A-Z]?\d?)\s+([A-Z' .-]+?)\s+((?:\d{4}-\d{4}:ACTIVE\s*)+)/g;
      let m;
      while ((m = re.exec(t))) out.push({ zone: m[1].replace(/\s/g, ''), name: m[2].trim(), slots: m[3].match(/\d{4}-\d{4}/g), from: n.from, to: n.to });
    }
    return out;
  }
  function slotOverlap(slot, dayStartMs, t0, t1) {
    const s = +slot.slice(0, 2) * 60 + +slot.slice(2, 4), e = +slot.slice(5, 7) * 60 + +slot.slice(7, 9);
    const a = dayStartMs + s * 6e4, b = dayStartMs + (e <= s ? e + 1440 : e) * 6e4;
    return a < t1 && b > t0;
  }

  // ================================================================== évitement des zones interdites
  // Graphe de visibilité autour des enveloppes convexes (marge 2 NM) des zones à éviter, puis plus court chemin.
  function avoidRoute(userPts, userIds, obstacles, margin = 2) {
    const polys = obstacles.map((o) => {
      const pts = [];
      for (const v of o.z.poly) { const [x, y] = P(v); for (let a = 0; a < 360; a += 45) pts.push([x + margin * Math.cos(rad(a)), y + margin * Math.sin(rad(a))]); }
      return { o, h: hull(pts) };
    });
    const outPts = [userPts[0]], outIds = [userIds[0]], detours = [];
    let dt = 0;
    for (let i = 0; i < userPts.length - 1; i++) {
      const s = P(userPts[i]), e = P(userPts[i + 1]);
      const rel = polys.filter((p) => !inPolyXY(s[0], s[1], p.h) && !inPolyXY(e[0], e[1], p.h));
      const blocked = (a, b, skip) => rel.some((p, pi) => {
        if (pi === skip.poly) { // même enveloppe : seuls les côtés adjacents sont autorisés
          const n = p.h.length, ia = skip.ia, ib = skip.ib;
          if (ia >= 0 && ib >= 0) return !(Math.abs(ia - ib) === 1 || Math.abs(ia - ib) === n - 1);
        }
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (inPolyXY(m[0], m[1], p.h)) return true;
        for (let k = 0; k < p.h.length; k++) if (properX(a, b, p.h[k], p.h[(k + 1) % p.h.length])) return true;
        return false;
      });
      const direct = !rel.some((p) => {
        const m = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
        if (inPolyXY(m[0], m[1], p.h)) return true;
        for (let k = 0; k < p.h.length; k++) if (properX(s, e, p.h[k], p.h[(k + 1) % p.h.length])) return true;
        return false;
      });
      if (direct) { outPts.push(userPts[i + 1]); outIds.push(userIds[i + 1]); continue; }
      // nœuds : départ, arrivée, sommets des enveloppes proches
      const nodes = [{ xy: s }, { xy: e }];
      rel.forEach((p, pi) => p.h.forEach((xy, k) => nodes.push({ xy, poly: pi, k })));
      const n = nodes.length, dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
      dist[0] = 0;
      for (let it = 0; it < n; it++) {
        let u = -1; for (let j = 0; j < n; j++) if (!done[j] && (u < 0 || dist[j] < dist[u])) u = j;
        if (u < 0 || dist[u] === Infinity) break;
        done[u] = true; if (u === 1) break;
        for (let v = 0; v < n; v++) {
          if (done[v] || v === u) continue;
          const nu = nodes[u], nv = nodes[v];
          const same = nu.poly !== undefined && nu.poly === nv.poly ? { poly: nu.poly, ia: nu.k, ib: nv.k } : { poly: -1 };
          const dd = Math.hypot(nu.xy[0] - nv.xy[0], nu.xy[1] - nv.xy[1]);
          if (dist[u] + dd >= dist[v]) continue;
          if (blocked(nu.xy, nv.xy, same)) continue;
          dist[v] = dist[u] + dd; prev[v] = u;
        }
      }
      if (dist[1] === Infinity) { outPts.push(userPts[i + 1]); outIds.push(userIds[i + 1]); continue; }
      const path = []; for (let v = prev[1]; v > 0; v = prev[v]) path.unshift(v);
      for (const v of path) {
        dt += 1; const p = UNP(nodes[v].xy);
        outPts.push(p); outIds.push(`DT${dt}`);
        detours.push({ id: `DT${dt}`, p, around: rel[nodes[v].poly].o.z.id + ' ' + rel[nodes[v].poly].o.z.name });
      }
      outPts.push(userPts[i + 1]); outIds.push(userIds[i + 1]);
    }
    return { pts: outPts, ids: outIds, detours };
  }

  // ================================================================== VAC : consignes triées
  const EN_WORDS = /\b(the|is|are|with|for|of|to|must|shall|prohibited|runway|aircraft|only|when|be|by|on|at|and|outside|within|except|advised|recommended|airfield|pilots?|should|landing|take-?off|traffic pattern|hours?)\b/gi;
  const FR_WORDS = /\b(le|la|les|des|du|de|est|sont|pour|avec|au|aux|en|à|interdit|interdite|obligatoire|piste|pilotes?|uniquement|sauf|hors|tour|vent|arrière|survol|terrain|activité|aérodrome|réservé|attention)\b/gi;
  function frenchSentences(txt) {
    if (!txt) return [];
    const flat = txt.replace(/\r/g, '').replace(/←/g, '').replace(/([a-z])-\n([a-z])/g, '$1$2').replace(/\n(?=[a-zà-ÿ(])/g, ' ');
    const parts = flat.split(/\n|(?<=[.:;])(?=[A-ZÉÈÀ])|(?<=[a-z])(?=[A-ZÉ][a-zé])/).map((s) => s.trim()).filter((s) => s.length > 3);
    const out = [];
    for (const s of parts) {
      const fr = (s.match(FR_WORDS) || []).length, en = (s.match(EN_WORDS) || []).length;
      if (fr > en || (fr === en && /[éèàùâêîôûç]/i.test(s))) out.push(s.replace(/\s+/g, ' '));
    }
    return [...new Set(out)];
  }
  function classifyConsignes(v) {
    const S = frenchSentences(v && v.consignes);
    const dep = [], arr = [], gen = [];
    for (const s of S) {
      if (/^(Conditions d|Dangers à la|Procédures et consignes|Activités diverses|Consignes particulières)/i.test(s)) continue;
      if (/\bDEP\b|départ|décoll|sortie|montée initiale|après le décollage/i.test(s)) dep.push(s);
      else if (/\bARR\b|arrivée|intégration|vent arrière|atterriss|tour de piste|tours de piste|circuit|finale|entrée|approche|verticale/i.test(s)) arr.push(s);
      else gen.push(s);
    }
    return { dep, arr, gen };
  }
  function infosVac(v) {
    const S = frenchSentences(v && v.infos);
    return S.filter((s) => /Situation|Exploitant|ATS|Carbur|AVT|Douane|Hangar|Péril|SSLIA|RFFS|Restaurant|Transport|TEL|PPR|ACB|horaire/i.test(s)).slice(0, 14);
  }

  // Piste probable et composantes de vent
  function runwayFor(v, wdir, wspd) {
    const q = ((v && v.qfu) || []).map(Number).filter((x) => x > 0 && x <= 360);
    if (!q.length) return null;
    const opts = q.map((qfu) => {
      const a = rad((wdir ?? qfu) - qfu);
      return { qfu, head: wspd != null ? wspd * Math.cos(a) : null, cross: wspd != null ? Math.abs(wspd * Math.sin(a)) : null };
    });
    opts.sort((a, b) => (b.head ?? 0) - (a.head ?? 0));
    return { best: opts[0], all: opts };
  }
  function rwyLength(v) {
    const m = ((v && v.rwy) || []).map((s) => +String(s).split(/\s*x\s*/)[0]).filter(Boolean);
    return m.length ? Math.max(...m) : null;
  }
  const isGrass = (v) => { const s = (v && v.surface) || []; return s.length > 0 && !s.some((x) => /^(Revêtue|Paved)$/i.test(x)); };

  // ================================================================== formulaire
  const aptOptions = () => A.APTS.map((a) => `<option value="${a.icao}">${esc(a.name)}</option>`).join('');
  const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function regimeOptions(reg, sel) {
    const ac = FLEET.find((x) => x.reg === reg) || FLEET[0]; const T = TYPES[ac.type];
    return T.regimes.map((r, i) => `<option value="${i}" ${i === (sel ?? T.defaultRegime) ? 'selected' : ''}>${esc(r.name)} — ${r.tas} kt, ${r.ff} L/h</option>`).join('');
  }
  function openForm() {
    const f = store.get('form', {});
    const next = new Date(Date.now() + 3600e3); next.setMinutes(0, 0, 0);
    const reg = f.reg && FLEET.some((x) => x.reg === f.reg) ? f.reg : FLEET[0].reg;
    A.showPanel('Préparation de vol', `
      <p class="meta">Route directe entre les terrains (codes OACI), contournement automatique des zones interdites et des RTBA actives.</p>
      <datalist id="apt-list">${aptOptions()}</datalist>
      <div class="prep-form">
        <label>Départ <button type="button" class="pick-btn" data-pick="pf-dep" title="Choisir sur la carte">📍</button><input id="pf-dep" list="apt-list" value="${esc(f.dep || '')}" placeholder="LFBP" autocomplete="off"></label>
        <label>Arrivée <button type="button" class="pick-btn" data-pick="pf-arr" title="Choisir sur la carte">📍</button><input id="pf-arr" list="apt-list" value="${esc(f.arr || '')}" placeholder="LFRN" autocomplete="off"></label>
        <label class="full">Points tournants (terrains OACI ou points VFR comme BP-N, optionnel) <button type="button" class="pick-btn" data-pick="pf-wps" title="Choisir sur la carte">📍</button> <span class="meta">📍 puis clic sur la carte pour ajouter un point</span><input id="pf-wps" value="${esc(f.wps || '')}" placeholder="LFBX BI-N"></label>
        <label>Point de sortie (départ)<select id="pf-exit"><option value="auto">Auto (le plus direct)</option><option value="none">Aucun (direct)</option></select></label>
        <label>Point d'entrée (arrivée)<select id="pf-entry"><option value="auto">Auto (le plus direct)</option><option value="none">Aucun (direct)</option></select></label>
        <label class="full">Escales suivantes (aller-retour, voyage : ex. « LFCH LFBP »)<input id="pf-stages" value="${esc(f.stages || '')}" placeholder="vide = vol simple ; LFBP pour revenir au départ" autocomplete="off"></label>
        <label>Temps d'escale (min)<input id="pf-turn" type="number" min="0" max="600" step="5" value="${esc(f.turn ?? 45)}"></label>
        <label>Avitaillement aux escales<select id="pf-refuel"><option value="0" ${f.refuel ? '' : 'selected'}>Non (carburant restant)</option><option value="1" ${f.refuel ? 'selected' : ''}>Oui (plein du réservoir principal)</option></select></label>
        <label>Dégagement <button type="button" class="pick-btn" data-pick="pf-alt" title="Choisir sur la carte">📍</button><input id="pf-alt" list="apt-list" value="${esc(f.alt || '')}" placeholder="LFRD" autocomplete="off"></label>
        <label>Départ (heure locale)<input id="pf-time" type="datetime-local" value="${localInput(next)}"></label>
        <label>Avion<select id="pf-reg">${FLEET.map((a) => `<option value="${a.reg}" ${a.reg === reg ? 'selected' : ''}>${a.reg} — ${esc(TYPES[a.type].label)}</option>`).join('')}</select></label>
        <label>Régime<select id="pf-regime">${regimeOptions(reg, f.regime)}</select></label>
        <label>Immatriculation (si différente)<input id="pf-immat" value="${esc(f.immat || '')}" placeholder="${esc(reg)}"></label>
        <label>Masse à vide (kg)<input id="pf-empty" type="number" min="100" max="2000" value="${(FLEET.find((x) => x.reg === reg) || {}).empty || ''}"></label>
        <p class="meta full" id="pf-acnote" style="grid-column:1/-1;margin:0"></p>
        <label>Altitude croisière (ft)<input id="pf-ft" type="number" min="500" max="12000" step="500" value="${esc(f.ft || 2500)}"></label>
        <label>Réserve finale (min)<input id="pf-res" type="number" min="0" max="120" value="${esc(f.res ?? 30)}"></label>
        <label>Pilote (kg)<input id="pf-m1" type="number" min="0" max="150" value="${esc(f.m1 ?? 80)}"></label>
        <label>Copilote / passager avant (kg)<input id="pf-m2" type="number" min="0" max="150" value="${esc(f.m2 ?? 0)}"></label>
        <label>Passagers arrière (kg)<input id="pf-m3" type="number" min="0" max="250" value="${esc(f.m3 ?? 0)}"></label>
        <label>Bagages (kg)<input id="pf-m4" type="number" min="0" max="60" value="${esc(f.m4 ?? 10)}"></label>
        <label>Carburant au départ (L)<input id="pf-fuel" type="number" min="0" max="200" value="${esc(f.fuel ?? 100)}"></label>
        <label id="pf-aux-l">Réservoir supp. (L)<input id="pf-aux" type="number" min="0" max="50" value="${esc(f.aux ?? 0)}"></label>
        <label>Couloir (NM de part et d'autre)<input id="pf-cor" type="number" min="2" max="30" value="${esc(f.cor || 10)}"></label>
        <label>Éviter<select id="pf-avoid">
          <option value="p+rtba" ${f.avoid !== 'p' && f.avoid !== 'none' ? 'selected' : ''}>Zones P + RTBA actives</option>
          <option value="p" ${f.avoid === 'p' ? 'selected' : ''}>Zones P seulement</option>
          <option value="none" ${f.avoid === 'none' ? 'selected' : ''}>Ne rien contourner</option></select></label>
        <label class="full">Pilote (nom)<input id="pf-pil" value="${esc(f.pil || '')}"></label>
        <details class="full arms-box" id="pf-arms-box"><summary>⚖️ Bras de levier et enveloppe de centrage (fiche de pesée)</summary>
          <p class="meta">Valeurs en mètres depuis la référence du manuel de vol. Vide = valeur par défaut (indiquée en grisé). Mémorisé pour chaque avion sur cet appareil.</p>
          <div class="prep-form" id="pf-arms"></div>
        </details>
      </div>
      <div class="prep-actions">
        <button class="btn primary" id="pf-calc">Calculer la route</button>
        <button class="btn" id="pf-pdf">📄 Briefing PDF + log Excel</button>
        <button class="btn" id="pf-xlsx">📊 Log Excel seul</button>
      </div>
      <div class="prep-progress" id="pf-prog"></div>
      <div id="pf-out"></div>`);
    const ARM_FIELDS = [['empty', 'Avion vide'], ['pilot', 'Pilote'], ['copilot', 'Passager avant'], ['pax', 'Passagers arrière'], ['bag', 'Bagages'], ['tank0', 'Réservoir principal'], ['tank1', 'Réservoir supp.']];
    const fillArms = () => {
      const ac = FLEET.find((x) => x.reg === $('#pf-reg').value), T = TYPES[ac.type], o = store.get('arms.' + ac.reg, {});
      const def = { empty: ac.arm, pilot: T.arms.pilot, copilot: T.arms.copilot, pax: T.arms.pax, bag: ac.bagArm || T.arms.bag, tank0: T.fuel.tanks[0].arm, tank1: T.fuel.tanks[1] && T.fuel.tanks[1].arm };
      $('#pf-arms').innerHTML = ARM_FIELDS.filter(([k]) => k !== 'tank1' || T.fuel.tanks[1]).map(([k, l]) => `<label>${l}<input data-arm="${k}" type="number" step="0.001" value="${o[k] ?? ''}" placeholder="${def[k] ?? 'inconnu'}"></label>`).join('')
        + `<label class="full">Enveloppe (bras:masse séparés par des espaces)<input data-arm="env" value="${esc(o.env || '')}" placeholder="${esc(T.envelope ? T.envelope.map(([a, m]) => `${a}:${m}`).join(' ') : 'ex. 0.205:0 0.205:750 0.428:900 0.564:900 0.564:0')}"></label>`;
      if (!T.arms.pilot || ac.arm == null) $('#pf-arms-box').open = true;
      $('#pf-arms').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => {
        const cur = store.get('arms.' + ac.reg, {}); const v = i.value.trim();
        if (v === '') delete cur[i.dataset.arm]; else cur[i.dataset.arm] = i.dataset.arm === 'env' ? v : +v;
        store.set('arms.' + ac.reg, cur);
      }));
    };
    const syncAux = () => {
      fillArms();
      const ac = FLEET.find((x) => x.reg === $('#pf-reg').value), T = TYPES[ac.type];
      $('#pf-aux-l').style.display = T.fuel.tanks.length > 1 ? '' : 'none';
      $('#pf-immat').placeholder = ac.reg;
      $('#pf-acnote').textContent = ac.note || T.source ? `ℹ️ ${[ac.note, T.source && 'Données : ' + T.source].filter(Boolean).join(' — ')}` : '';
    };
    $('#pf-reg').addEventListener('change', (e) => {
      $('#pf-regime').innerHTML = regimeOptions(e.target.value);
      $('#pf-empty').value = (FLEET.find((x) => x.reg === e.target.value) || {}).empty || '';
      syncAux();
    });
    syncAux();
    $('#pf-calc').addEventListener('click', () => run(false));
    $('#pf-pdf').addEventListener('click', () => run('pdf'));
    $('#pf-xlsx').addEventListener('click', () => run('xlsx'));
    ['#pf-dep', '#pf-arr', '#pf-alt', '#pf-wps', '#pf-stages'].forEach((s) => $(s).addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); }));
    const fillVfr = (sel, ad, keep) => {
      const pts = vfrOf(ad);
      $(sel).innerHTML = `<option value="auto">${pts.length ? 'Auto (le plus direct)' : 'Aucun point publié'}</option><option value="none">Aucun (direct)</option>`
        + pts.map((p) => `<option value="${ad.slice(2)}-${p.id}">${esc(p.id)} — ${esc(p.desc.slice(0, 50))}</option>`).join('');
      if (keep && [...$(sel).options].some((o) => o.value === keep)) $(sel).value = keep;
    };
    loadVfr().then(() => { fillVfr('#pf-exit', $('#pf-dep').value, f.exit); fillVfr('#pf-entry', $('#pf-arr').value, f.entry); });
    $('#pf-dep').addEventListener('change', (e) => fillVfr('#pf-exit', e.target.value));
    $('#pf-arr').addEventListener('change', (e) => fillVfr('#pf-entry', e.target.value));
    $('#pf-dep').addEventListener('input', (e) => { if (A.aptByIcao[e.target.value]) fillVfr('#pf-exit', e.target.value); });
    $('#pf-arr').addEventListener('input', (e) => { if (A.aptByIcao[e.target.value]) fillVfr('#pf-entry', e.target.value); });
    // Saisie par le nom de la ville (« pau », « arcachon ») → code OACI
    ['#pf-dep', '#pf-arr', '#pf-alt'].forEach((s) => $(s).addEventListener('change', (e) => {
      const v = e.target.value.trim(); if (!v || A.aptByIcao[v]) return;
      const n = normTxt(v), hit = A.APTS.filter((a) => normTxt(a.name).includes(n));
      if (hit.length) { e.target.value = hit[0].icao; e.target.dispatchEvent(new Event('change')); if (hit.length > 1) $('#pf-prog').textContent = `« ${v} » : ${hit.slice(0, 4).map((a) => a.icao + ' ' + a.name).join(', ')}${hit.length > 4 ? '…' : ''} — ${hit[0].icao} retenu.`; }
    }));
    document.querySelectorAll('.pick-btn[data-pick]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); startPick(b.dataset.pick, b); }));
  }
  const normTxt = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  // ---------------------------------------------------------------- choix d'un terrain / d'un point directement sur la carte
  let pick = null;
  function startPick(id, btn) {
    stopPick();
    pick = { id, btn };
    window.AWW_PICKING = true;
    map.getContainer().classList.add('picking');
    btn.classList.add('on');
    const lbl = { 'pf-dep': 'le terrain de départ', 'pf-arr': 'le terrain d\'arrivée', 'pf-alt': 'le terrain de dégagement', 'pf-wps': 'un point tournant (terrain, point VFR ou point libre)' }[id];
    const ban = document.createElement('div'); ban.id = 'pick-banner';
    ban.innerHTML = `Clique sur la carte : ${lbl}<button type="button">Annuler</button>`;
    ban.querySelector('button').addEventListener('click', stopPick);
    document.body.appendChild(ban);
  }
  function stopPick() {
    if (!pick) return;
    pick.btn.classList.remove('on'); pick = null;
    window.AWW_PICKING = false;
    map.getContainer().classList.remove('picking');
    const b = $('#pick-banner'); if (b) b.remove();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopPick(); });
  map.on('click', (e) => {
    if (!pick) return;
    const el = $('#' + pick.id); if (!el) { stopPick(); return; }
    const p = map.latLngToContainerPoint(e.latlng);
    const near = (la, lo) => map.latLngToContainerPoint([la, lo]).distanceTo(p);
    let best = null, bd = 30;
    for (const a of A.APTS) { const d = near(a.la, a.lo); if (d < bd) { bd = d; best = a.icao; } }
    if (pick.id === 'pf-wps') {
      let tok = bd <= 16 ? best : null;   // point tournant : accroche seulement si on clique vraiment sur le terrain
      if (!tok) bd = 16;
      if (!tok && VFR) for (const [ad, pts] of Object.entries(VFR.data || {})) for (const v of pts) { const d = near(v.la, v.lo); if (d < Math.min(bd, 20)) { bd = d; tok = `${ad.slice(2)}-${v.id}`; } }
      if (!tok) tok = `${e.latlng.lat.toFixed(4)}/${e.latlng.lng.toFixed(4)}`;
      el.value = (el.value.trim() + ' ' + tok).trim();
      ['#pf-exit', '#pf-entry'].forEach((s) => { const x = $(s); if (x && x.value === 'auto') x.value = 'none'; });
      $('#pf-prog').textContent = `Point ajouté : ${tok}. Clique 📍 à nouveau pour en ajouter un autre.`;
    } else {
      if (!best) { $('#pf-prog').textContent = 'Aucun aérodrome à cet endroit : clique plus près d\'un terrain (zoome si besoin).'; return; }
      el.value = best; el.dispatchEvent(new Event('change'));
      $('#pf-prog').textContent = `${best} ${A.aptByIcao[best].name} sélectionné.`;
    }
    stopPick();
  });
  $('#btn-prep').addEventListener('click', openForm);

  function readForm() {
    const v = (s) => ($(s).value || '').trim();
    const f = {
      dep: v('#pf-dep').toUpperCase(), arr: v('#pf-arr').toUpperCase(), alt: v('#pf-alt').toUpperCase(), wps: v('#pf-wps').toUpperCase(),
      time: v('#pf-time'), reg: v('#pf-reg'), regime: +v('#pf-regime'), ft: +v('#pf-ft'), res: +v('#pf-res'),
      m1: +v('#pf-m1'), m2: +v('#pf-m2'), m3: +v('#pf-m3'), m4: +v('#pf-m4'), fuel: +v('#pf-fuel'), aux: +v('#pf-aux') || 0,
      cor: +v('#pf-cor'), avoid: v('#pf-avoid'), pil: v('#pf-pil'), immat: v('#pf-immat').toUpperCase(), empty: +v('#pf-empty'),
      exit: v('#pf-exit') || 'auto', entry: v('#pf-entry') || 'auto',
      stages: v('#pf-stages').toUpperCase(), turn: +v('#pf-turn') || 0, refuel: v('#pf-refuel') === '1',
    };
    store.set('form', { ...f, time: undefined });
    const base = FLEET.find((x) => x.reg === f.reg) || FLEET[0];
    const ac = { ...base, baseReg: base.reg, reg: f.immat || base.reg, empty: f.empty || base.empty };
    const T0 = TYPES[ac.type], o = store.get('arms.' + base.reg, {});
    const num = (x) => (typeof x === 'number' && isFinite(x) && x !== 0 ? x : null);
    const env = typeof o.env === 'string' ? o.env.trim().split(/\s+/).map((t) => t.split(':').map(Number)).filter((x) => x.length === 2 && x.every(isFinite)) : null;
    const T = {
      ...T0,
      arms: { pilot: num(o.pilot) ?? T0.arms.pilot, copilot: num(o.copilot) ?? T0.arms.copilot, pax: num(o.pax) ?? T0.arms.pax, bag: num(o.bag) ?? T0.arms.bag },
      fuel: { ...T0.fuel, tanks: T0.fuel.tanks.map((t, i) => ({ ...t, arm: num(o['tank' + i]) ?? t.arm })) },
      envelope: env && env.length >= 3 ? env : T0.envelope,
    };
    if (num(o.empty) != null) ac.arm = num(o.empty);
    if (num(o.bag) != null) ac.bagArm = null;
    const rg = T.regimes[f.regime] || T.regimes[T.defaultRegime];
    if (T.fuel.tanks.length < 2) f.aux = 0;
    return { ...f, ac, T, rg, tas: rg.tas, ff: rg.ff };
  }

  let routeLayer = null, lastBrief = null, lastTrip = null, lastForm = null;
  // Points libres (déplacés sur la carte) : jeton "43.2050/-0.4570" -> PT1, PT2…
  let CUSTOM = {}, customN = 0;
  const tokenOf = (id) => (CUSTOM[id] ? CUSTOM[id].token : id);

  function buildUserIds(fk) {
    const wps = fk.wps.split(/[\s,;]+/).filter(Boolean).map((id) => (resolvePt(id) || { id, bad: true }));
    const bad = wps.filter((w) => w.bad).map((w) => w.id);
    if (bad.length) throw new Error(`Point inconnu : ${bad.join(', ')} (terrain OACI de la zone, point VFR publié comme BP-N, ou coordonnées 43.2050/-0.4570).`);
    const firstNext = wps[0] ? [wps[0].la, wps[0].lo] : [A.aptByIcao[fk.arr].la, A.aptByIcao[fk.arr].lo];
    const lastPrev = wps.length ? [wps[wps.length - 1].la, wps[wps.length - 1].lo] : [A.aptByIcao[fk.dep].la, A.aptByIcao[fk.dep].lo];
    const exit = fk.exit === 'none' ? null : fk.exit === 'auto' ? bestVfr(fk.dep, firstNext, true) : fk.exit;
    const entry = fk.entry === 'none' ? null : fk.entry === 'auto' ? bestVfr(fk.arr, lastPrev, false) : fk.entry;
    return [fk.dep, exit, ...wps.map((w) => w.id), entry, fk.arr].filter(Boolean);
  }

  // Bibliothèques PDF / Excel (1 Mo) chargées seulement quand on génère un document : la carte s'ouvre plus vite
  let libsP = null;
  function needLibs() {
    if (window.jspdf && window.PDFLib && window.JSZip) return Promise.resolve();
    if (!libsP) libsP = ['lib/pdf/jspdf.umd.min.js', 'lib/pdf/jspdf.plugin.autotable.min.js', 'lib/pdf/pdf-lib.min.js', 'lib/pdf/jszip.min.js']
      .reduce((p, src) => p.then(() => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('chargement de ' + src)); document.head.appendChild(s); })), Promise.resolve())
      .catch((e) => { libsP = null; throw e; });
    return libsP;
  }

  async function run(makePdf) {
    const prog = $('#pf-prog'), out = $('#pf-out');
    stopPick();
    try {
      if (makePdf) { prog.textContent = 'Chargement des outils PDF / Excel…'; await needLibs(); }
      const f = readForm();
      lastForm = f;
      if (!f.dep || !f.arr) throw new Error('Indique un terrain de départ et un terrain d\'arrivée.');
      const stops = f.stages.split(/[\s,;]+/).filter(Boolean);
      const unknown = [f.dep, f.arr, f.alt, ...stops].filter((x) => x && !A.aptByIcao[x]);
      if (unknown.length) throw new Error(`Terrain inconnu : ${unknown.join(', ')} (zone couverte : Pyrénées → Bretagne).`);
      prog.textContent = 'Chargement des données AIP, espaces aériens…';
      await loadAip();
      CUSTOM = {}; customN = 0;
      // Étapes : départ → arrivée (points tournants du formulaire), puis escales suivantes en direct (points VFR auto)
      const legsDef = [{ dep: f.dep, arr: f.arr, wps: f.wps, exit: f.exit, entry: f.entry }];
      stops.forEach((s) => legsDef.push({ dep: legsDef[legsDef.length - 1].arr, arr: s, wps: '', exit: 'auto', entry: 'auto' }));
      const trip = [];
      let time = new Date(f.time), fuel = f.fuel, aux = f.aux;
      const cap0 = f.T.fuel.tanks[0].cap;
      for (let k = 0; k < legsDef.length; k++) {
        const fk = { ...f, ...legsDef[k], time: time.toISOString(), fuel, aux };
        const userIds = buildUserIds(fk);
        prog.textContent = `${legsDef.length > 1 ? `Étape ${k + 1}/${legsDef.length} : ` : ''}calcul de la route, du vent et du relief…`;
        const b = await compute(fk, userIds);
        prog.textContent = `${legsDef.length > 1 ? `Étape ${k + 1}/${legsDef.length} : ` : ''}GRAMET, coupe météo de la route…`;
        b.gramet = await gramet(b).catch((e) => ({ err: e.message }));
        b.stage = k + 1; b.nStages = legsDef.length;
        b.night = nightInfo(b);
        try {   // échantillonne la route tous les ~5 NM pour trouver les départements traversés
          const sp = []; b.legs.forEach((lg) => { const n = Math.max(1, Math.ceil(lg.dist / 5)); for (let i = 0; i <= n; i++) sp.push(destPt(lg.a, lg.tc, lg.dist * i / n)); });
          b.vigil = A.vigOnRoute(sp, b.depT.getTime(), b.eta.getTime());
        } catch (e) { console.warn('vigilance', e); }
        b.mountain = mountainOf(b);
        b.changes = snapshotDiff(b);
        trip.push(b);
        time = new Date(b.eta.getTime() + f.turn * 6e4);
        const rem = Math.max(0, b.loaded - b.totFuel);
        if (f.refuel) { fuel = cap0 || f.fuel; aux = f.aux; } else { fuel = Math.round(cap0 ? Math.min(rem, cap0) : rem); aux = Math.round(rem - fuel); }
      }
      trip.forEach((b) => { b.trip = trip; });
      drawTrip(trip);
      try {
        A.setNotamWindow(new Date(trip[0].depT.getTime() - 30 * 6e4), new Date(trip[trip.length - 1].eta.getTime() + 30 * 6e4));
        if (window.AWW_setFlightTimes) window.AWW_setFlightTimes(trip[0].depT, trip[trip.length - 1].eta);
      } catch (e) { console.warn(e); }
      out.innerHTML = (trip.length > 1 ? tripHtml(trip) : '') + trip.map((b, i) => trip.length > 1
        ? `<details class="stage" ${i === 0 ? 'open' : ''}><summary>Étape ${b.stage} : ${esc(b.f.dep)} → ${esc(b.f.arr)} · ${utc(b.depT)} → ${utc(b.eta)}</summary>${summaryHtml(b, '-' + i)}</details>`
        : summaryHtml(b, '-' + i)).join('');
      trip.forEach((b, i) => bindSummary(b, '-' + i));
      lastBrief = trip[0]; lastTrip = trip; window.AWW_LASTTRIP = trip;
      prog.textContent = '';
      const histId = makePdf ? Date.now() : null;
      if (makePdf) histStart(histId, trip);
      if (makePdf === 'pdf' || makePdf === true) {
        prog.textContent = 'Génération du PDF…';
        if (trip.length === 1) await buildPdf(trip[0], (t) => { prog.textContent = t; }, { histId });
        else await buildTripPdf(trip, (t) => { prog.textContent = t; }, histId);
        prog.textContent = 'Génération du log Excel…';
        try { for (const b of trip) await buildXlsx(b, { histId }); prog.textContent = 'PDF + log Excel générés ✔'; } catch (e) { console.warn(e); prog.textContent = 'PDF généré ✔ (log Excel : ' + e.message + ')'; }
      } else if (makePdf === 'xlsx') {
        prog.textContent = 'Génération du log Excel…';
        for (const b of trip) await buildXlsx(b, { histId });
        prog.textContent = 'Log Excel généré ✔';
      }
      if (makePdf) trip.forEach(snapshotSave);
    } catch (e) {
      console.error(e); prog.textContent = '';
      out.innerHTML = `<div class="warn">${esc(e.message || e)}</div>`;
    }
  }
  function bindSummary(b, sfx) {
    const on = (id, fn) => { const el = $('#' + id + sfx); if (el) el.addEventListener('click', fn); };
    on('pf-gpx', () => exportGpx(b));
    on('pf-fpl', () => exportFpl(b));
    on('pf-update', () => run(false));
    on('pf-ics', () => exportIcs(b));
    on('pf-gps', () => flightMode(b.trip || [b]));
    on('pf-share', () => shareFlight(sfx));
    if (b.gramet && !b.gramet.err && $('#pf-gramet' + sfx)) drawGramet($('#pf-gramet' + sfx), b.gramet, b);
    on('pf-gramet-big', () => {
      const cv = document.createElement('canvas'); cv.width = 1800; cv.height = 860; drawGramet(cv, b.gramet, b);
      const w = window.open(''); if (w) { w.document.title = 'GRAMET ' + b.ids.join(' - '); w.document.body.style.margin = 0; const im = w.document.createElement('img'); im.src = cv.toDataURL('image/png'); im.style.width = '100%'; w.document.body.appendChild(im); }
    });
  }

  // ---------------------------------------------------------------- nuit aéronautique (6)
  function nightInfo(b) {
    const s = b.sun; if (!s) return null;
    const night = new Date(s.set.getTime() + 30 * 6e4), day = b.sunDep ? new Date(b.sunDep.rise.getTime() - 30 * 6e4) : null;
    // nuit aéronautique point par point (coucher + 30 min à l'endroit où l'on passe)
    const pts = b.legs.map((lg) => {
      const st = sunTimes(lg.eto, lg.b[0], lg.b[1]);
      const n = st ? new Date(st.set.getTime() + 30 * 6e4) : null;
      return { id: lg.to, eta: lg.eto, night: n, dark: !!(n && lg.eto > n) };
    });
    const firstDark = pts.find((x) => x.dark);
    return { set: s.set, night, day, latestDep: new Date(night.getTime() - b.totMin * 6e4), late: b.eta > night, early: day && b.depT < day, pts, firstDark };
  }
  function tripHtml(trip) {
    const rows = trip.map((b) => {
      const rem = b.loaded - b.totFuel, ok = rem >= b.resFuel + (b.altLeg ? b.altLeg.fuel : 0);
      return `<tr><td>${b.stage}</td><td>${esc(b.f.dep)}→${esc(b.f.arr)}</td><td>${utc(b.depT)}</td><td>${utc(b.eta)}</td><td>${hhmm(b.totMin)}</td><td>${b.loaded} L</td><td>${b.totFuel} L</td>
        <td style="color:${ok ? '#2ecc40' : '#ff6b6b'}"><b>${Math.round(rem)} L</b></td><td>${b.night ? utc(b.night.latestDep) : '–'}</td></tr>`;
    }).join('');
    const totMin = trip.reduce((s, b) => s + b.totMin, 0), totFuel = trip.reduce((s, b) => s + b.totFuel, 0), totDist = trip.reduce((s, b) => s + b.totDist, 0);
    const last = trip[trip.length - 1];
    const warn = trip.filter((b) => b.night && b.night.early).map((b) => `Étape ${b.stage} : départ ${utc(b.depT)} avant le jour aéronautique (${utc(b.night.day)}).`).concat(trip.filter((b) => b.night && b.night.late).map((b) => `Étape ${b.stage} : arrivée ${utc(b.eta)} après la nuit aéronautique (${utc(b.night.night)}) — décoller au plus tard à ${utc(b.night.latestDep)}.`)
      .concat(trip.filter((b) => b.loaded - b.totFuel < b.resFuel + (b.altLeg ? b.altLeg.fuel : 0)).map((b) => `Étape ${b.stage} : carburant restant à l'arrivée inférieur à dégagement + réserve finale — prévoir un avitaillement à ${b.f.dep}.`)));
    return `<h4>Voyage en ${trip.length} étapes</h4>
      <table class="legs"><tr><th>#</th><th>Étape</th><th>Départ</th><th>Arrivée</th><th>Durée</th><th>À bord</th><th>Conso</th><th>Reste</th><th>Dernier déc.</th></tr>${rows}
      <tr><th></th><th>Total</th><th></th><th></th><th>${hhmm(totMin)}</th><th></th><th>${totFuel} L</th><th></th><th></th></tr></table>
      <p class="meta">${totDist.toFixed(0)} NM · escale ${last.f.turn} min · ${last.f.refuel ? 'plein à chaque escale' : 'sans avitaillement aux escales'} · « Dernier déc. » = dernier décollage pour arriver avant la nuit aéronautique (coucher du soleil + 30 min).</p>
      ${warn.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('') || '<div class="okk">Carburant et horaires compatibles sur toutes les étapes.</div>'}`;
  }
  window.addEventListener('aww-clear', () => { if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; } stopPick(); });
  function drawTrip(trip) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.layerGroup().addTo(map);
    trip.forEach((b) => drawRoute(b, routeLayer, trip.length === 1 || b.stage === 1));
    map.fitBounds(L.latLngBounds(trip.flatMap((b) => b.pts)).pad(0.25), { paddingTopLeft: [320, 20], paddingBottomRight: [480, 20] });
  }

  // ---------------------------------------------------------------- mise à jour J-1 / J : comparaison avec le briefing précédent (3)
  const snapKey = (b) => `${b.userIds.join('-')}|${b.depT.toISOString().slice(0, 10)}`;
  function makeSnap(b) {
    const nt = (n) => ({ ref: n.ref, t: (n.efr || n.e || '').replace(/\s+/g, ' ').slice(0, 110) });
    return {
      at: Date.now(), dep: b.depT.toISOString(),
      notams: [...b.enroute.map((x) => x.n), ...b.obst.map((x) => x.n), ...b.general, ...b.adNotams.flatMap((x) => x.list)].filter((n) => n && n.ref).map(nt),
      rtba: b.rtba.map((r) => ({ id: r.z.id, slots: r.slots.join(','), conflict: r.conflict })),
      wx: b.wxRoute && b.wxRoute.pts ? b.wxRoute.worst : null,
      alerts: alertsOf(b), min: b.totMin, gramet: b.gramet && !b.gramet.err ? grametSummary(b.gramet, b) : null,
      sups: b.sups.map((x) => x.s.num || x.s.title),
    };
  }
  function snapshotSave(b) {
    try {
      const all = store.get('snaps', {}), k = snapKey(b);
      all[k] = [...(all[k] || []), makeSnap(b)].slice(-4);
      const keys = Object.keys(all); if (keys.length > 30) keys.sort((x, y) => all[x].slice(-1)[0].at - all[y].slice(-1)[0].at).slice(0, keys.length - 30).forEach((x) => delete all[x]);
      store.set('snaps', all);
    } catch (e) { console.warn('snap', e); }
  }
  function snapshotDiff(b) {
    const list = store.get('snaps', {})[snapKey(b)] || [];
    const old = [...list].reverse().find((x) => Date.now() - x.at > 45 * 6e4);
    if (!old) return null;
    const cur = makeSnap(b), refs = new Set(old.notams.map((n) => n.ref)), now = new Set(cur.notams.map((n) => n.ref));
    const ch = [];
    cur.notams.filter((n) => !refs.has(n.ref)).forEach((n) => ch.push({ k: 'add', t: `Nouveau NOTAM ${n.ref} : ${n.t}` }));
    const gone = old.notams.filter((n) => !now.has(n.ref)).map((n) => n.ref);
    if (gone.length) ch.push({ k: 'del', t: `NOTAM annulés ou expirés : ${gone.join(', ')}` });
    const or = Object.fromEntries(old.rtba.map((r) => [r.id, r]));
    cur.rtba.forEach((r) => { const o = or[r.id]; if (!o || o.slots !== r.slots) ch.push({ k: r.conflict ? 'add' : 'info', t: `AZBA ${r.id} : ${o && o.slots ? o.slots : 'aucun créneau'} → ${r.slots || 'aucun créneau'}${r.conflict ? ' (ACTIVE pendant le vol)' : ''}` }); });
    if (old.wx != null && cur.wx != null && old.wx !== cur.wx) ch.push({ k: cur.wx > old.wx ? 'add' : 'info', t: `Météo en route : ${WXTXT[old.wx]} → ${WXTXT[cur.wx]}` });
    if (old.gramet && cur.gramet && old.gramet !== cur.gramet) ch.push({ k: 'info', t: `GRAMET : ${cur.gramet}` });
    const oa = new Set(old.alerts); cur.alerts.filter((a) => !oa.has(a)).forEach((a) => ch.push({ k: 'add', t: `Nouvelle alerte : ${a}` }));
    const na = new Set(cur.alerts); old.alerts.filter((a) => !na.has(a)).forEach((a) => ch.push({ k: 'info', t: `Alerte levée : ${a}` }));
    const os = new Set(old.sups); cur.sups.filter((x) => !os.has(x)).forEach((x) => ch.push({ k: 'add', t: `Nouveau SUP AIP près de la route : ${x}` }));
    if (Math.abs(cur.min - old.min) >= 3) ch.push({ k: 'info', t: `Temps de vol : ${hhmm(old.min)} → ${hhmm(cur.min)} (vent)` });
    return { since: new Date(old.at), list: ch };
  }
  function changesHtml(b) {
    if (!b.changes) return '';
    const c = b.changes, when = c.since.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<h4>🔄 Changements depuis le briefing du ${esc(when)}</h4>${c.list.length ? c.list.map((x) => `<div class="${x.k === 'add' ? 'warn' : 'okk'}">${x.k === 'add' ? '🆕' : x.k === 'del' ? '🗑️' : 'ℹ️'} ${esc(x.t)}</div>`).join('') : '<div class="okk">Aucun changement détecté (NOTAM, AZBA, météo, alertes).</div>'}`;
  }
  // Rappels calendrier J-1 / J (4)
  function exportIcs(b) {
    const route = b.ids.filter((x) => !x.startsWith('DT')).join(' - ');
    const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ev = [];
    const veille = new Date(b.depT); veille.setDate(veille.getDate() - 1); veille.setHours(18, 0, 0, 0);
    if (veille > new Date()) ev.push([veille, `Prépa vol ${route} : AZBA + NOTAM + météo (J-1)`, 'Les créneaux AZBA (RTBA) du lendemain sont publiés la veille. Mettre à jour le briefing : bouton Mettre à jour.']);
    const jour = new Date(b.depT.getTime() - 90 * 6e4);
    if (jour > new Date()) ev.push([jour, `Briefing ${route} : mise à jour (J)`, 'METAR/TAF, TEMSI, NOTAM du jour, AZBA, carburant, masse et centrage.']);
    if (!ev.length) { alert('Le vol est trop proche pour programmer des rappels.'); return; }
    const url = location.href.split('#')[0];
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aero Meteo Webcams//FR', ...ev.flatMap(([d, t, desc], i) => ['BEGIN:VEVENT', `UID:${z(d)}-${i}@aero-ouest`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(d)}`, `DTEND:${z(new Date(d.getTime() + 30 * 6e4))}`,
      `SUMMARY:${t}`, `DESCRIPTION:${desc} ${url}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${t}`, 'TRIGGER:-PT0M', 'END:VALARM', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
    download(new Blob([ics], { type: 'text/calendar' }), `rappels_${b.userIds[0]}-${b.userIds[b.userIds.length - 1]}.ics`);
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ================================================================== calculs
  function massBalance(f) {
    const T = f.T, ac = f.ac, d = T.fuel.density;
    const rows = [
      ['Avion vide', ac.empty, ac.arm],
      ['Pilote', f.m1, T.arms.pilot],
      ['Copilote / pax avant', f.m2, T.arms.copilot],
      ['Passagers arrière', f.m3, T.arms.pax],
      ['Bagages', f.m4, ac.bagArm || T.arms.bag],
      [`Carburant ${T.fuel.tanks[0].name} (${f.fuel} L)`, f.fuel * d, T.fuel.tanks[0].arm],
    ];
    if (T.fuel.tanks[1] && f.aux) rows.push([`Carburant ${T.fuel.tanks[1].name} (${f.aux} L)`, f.aux * d, T.fuel.tanks[1].arm]);
    const mass = rows.reduce((s, r) => s + r[1], 0);
    const known = rows.every((r) => r[1] === 0 || typeof r[2] === 'number');
    const mom = known ? rows.reduce((s, r) => s + r[1] * (r[2] || 0), 0) : null;
    const env = T.envelope ? T.envelope.map(([arm, m]) => [arm, m]) : null;
    // centrage non calculable si des bras de levier manquent (avions ajoutés : à compléter avec le manuel de vol)
    const inEnv = (cg, m) => (cg == null || !env ? true : inPolyXY(cg, m, env));
    return { rows, mass, cg: known ? mom / mass : null, mom, inEnv, env, known };
  }

  async function compute(f, userIds) {
    const userPts = userIds.map((id) => { const r = resolvePt(id); return [r.la, r.lo]; });
    PROJ_LAT = userPts.reduce((s, p) => s + p[0], 0) / userPts.length;
    const depT = new Date(f.time);
    if (isNaN(depT)) throw new Error('Heure de départ invalide.');
    const vacOf = (id) => (VAC && VAC.data && VAC.data[id]) || null;
    const N = A.NOTAM || { fir: [], ad: {} };
    const horizon = (depT - Date.now()) / 864e5;

    // --- Zones à éviter (verticalement concernées)
    const acts = rtbaActivations(N.fir || []);
    const dayStart = Date.UTC(depT.getUTCFullYear(), depT.getUTCMonth(), depT.getUTCDate());
    const roughDur = userPts.slice(1).reduce((s, p, i) => s + distNm(userPts[i], p), 0) / f.tas * 3600e3;
    const t0 = depT.getTime() - 1800e3, t1 = depT.getTime() + roughDur * 1.3 + 1800e3;
    const vOverlap = (z) => {
      const lo = parseAlt(z.lower), up = parseAlt(z.upper);
      const upFt = up === null ? 99999 : up + (/ASFC|AGL/i.test(z.upper) ? 1500 : 0);
      return (lo === null || lo <= f.ft + 500) && upFt >= f.ft - 500;
    };
    const rtbaSlots = (z) => {
      const key = z.id.replace(/\s/g, '');
      return [...new Set(acts.filter((a) => a.zone === key && (!a.from || Date.parse(a.from) <= dayStart + 864e5) && (isNaN(Date.parse(a.to)) || Date.parse(a.to) >= dayStart)).flatMap((a) => a.slots))];
    };
    const obstacles = [];
    if (f.avoid !== 'none') {
      for (const z of (ZONES && ZONES.data) || []) {
        if (!vOverlap(z)) continue;
        if (polyRouteDist(z.poly, userPts) > 40) continue;
        if (z.type === 'P') obstacles.push({ z, why: 'zone interdite' });
        else if (f.avoid === 'p+rtba' && z.rtba && rtbaSlots(z).some((s) => slotOverlap(s, dayStart, t0, t1))) obstacles.push({ z, why: 'RTBA active' });
      }
    }
    const routed = obstacles.length ? avoidRoute(userPts, userIds, obstacles) : { pts: userPts, ids: userIds, detours: [] };
    const pts = routed.pts, ids = routed.ids;
    const adIds = [...new Set([...userIds, f.alt].filter((id) => id && A.aptByIcao[id]))];
    const varDeg = (() => {
      const v = [vacOf(f.dep), vacOf(f.arr)].map((x) => x && x.var).filter((x) => typeof x === 'number');
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    })();

    // --- Vent en altitude
    const mids = []; for (let i = 0; i < pts.length - 1; i++) mids.push([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]);
    let winds = null, windErr = null;
    if (horizon < -1 || horizon > 15) windErr = 'Vent non disponible pour cette date (prévisions à 16 jours).';
    else {
      const times = []; let accD = 0;
      for (let i = 0; i < pts.length - 1; i++) { const dd = distNm(pts[i], pts[i + 1]); times.push(new Date(depT.getTime() + (accD + dd / 2) / f.tas * 3600e3)); accD += dd; }
      try { winds = await windsAloft(mids, f.ft, times); } catch (e) { windErr = 'Vent en altitude indisponible (' + e.message + ').'; } }

    // --- Relief : altitude de sécurité par branche (relief max ±5 NM + 1000 ft)
    let safe = null, elevErr = null, profile = [];
    try {
      const samples = [], owner = [], centre = [];
      let accNm = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const dst = distNm(pts[i], pts[i + 1]), tc = bearing(pts[i], pts[i + 1]);
        const n = Math.max(2, Math.ceil(dst / 3));
        for (let k = 0; k <= n; k++) {
          const c = destPt(pts[i], tc, dst * k / n);
          for (const off of [-5, -2.5, 0, 2.5, 5]) { if (!off) centre.push({ j: samples.length, along: accNm + dst * k / n, p: c }); samples.push(off ? destPt(c, tc + 90, off) : c); owner.push(i); }
        }
        accNm += dst;
      }
      const el = await elevations(samples);
      profile = centre.map((c) => ({ along: c.along, p: c.p, ft: Math.round((el[c.j] || 0) * 3.281) }));
      safe = pts.slice(1).map(() => 0);
      el.forEach((m, j) => { if (m != null) safe[owner[j]] = Math.max(safe[owner[j]], m * 3.281); });
      safe = safe.map((maxFt) => ({ terrain: Math.round(maxFt), alt: Math.ceil((maxFt + 1000) / 100) * 100 }));
    } catch (e) { elevErr = 'Relief indisponible (' + e.message + ').'; }

    // --- Branches (règles du log ACB : +2 min et +4 L sur la 1re branche)
    const legs = [];
    let t = depT.getTime(), totDist = 0, totMin = 0, totFuel = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = distNm(pts[i], pts[i + 1]), tc = bearing(pts[i], pts[i + 1]);
      const w = winds && winds[i] && winds[i].spd != null ? winds[i] : { dir: 0, spd: 0 };
      const wa = rad(w.dir - tc);
      const wca = deg(Math.asin(Math.max(-1, Math.min(1, (w.spd / f.tas) * Math.sin(wa)))));
      const gs = Math.max(20, f.tas * Math.cos(rad(wca)) - w.spd * Math.cos(wa));
      const th = (tc + wca + 360) % 360;
      let min = Math.round(dist / gs * 60);
      let fuel = Math.round(min * f.ff / 60);
      if (i === 0) { min += f.T.climb.extraMin; fuel += f.T.climb.extraFuel; }
      legs.push({ from: ids[i], to: ids[i + 1], a: pts[i], b: pts[i + 1], dist, tc, tm: (tc - varDeg + 360) % 360, th, hm: (th - varDeg + 360) % 360, wca, gs, min, fuel, wind: winds ? w : null, eto: new Date(t + min * 6e4), safe: safe && safe[i] });
      t += min * 6e4; totDist += dist; totMin += min; totFuel += fuel;
    }
    const eta = new Date(t);
    let altLeg = null;
    if (f.alt) {
      const a = A.aptByIcao[f.alt], bpt = pts[pts.length - 1], d = distNm(bpt, [a.la, a.lo]);
      const tc = bearing(bpt, [a.la, a.lo]);
      const min = Math.round(d / f.tas * 60) + 2;
      altLeg = { to: f.alt, dist: d, tc, tm: (tc - varDeg + 360) % 360, min, fuel: Math.round(min * f.ff / 60) + 2 };
    }
    const resFuel = Math.round(f.res / 60 * f.ff);
    const reqFuel = totFuel + (altLeg ? altLeg.fuel : 0) + resFuel;
    const loaded = f.fuel + f.aux;

    // --- Espaces aériens traversés + fréquences par branche
    const aspAll = (ASP && ASP.data) || [];
    for (const lg of legs) {
      const n = Math.max(2, Math.ceil(lg.dist / 1.5)), seen = new Map();
      for (let k = 0; k <= n; k++) {
        const p = destPt(lg.a, lg.tc, lg.dist * k / n);
        for (const s of aspAll) {
          if (seen.has(s)) continue;
          const lo = parseAlt(s.lower), up = parseAlt(s.upper);
          const isFirst = lg === legs[0] && k <= 1, isLast = lg === legs[legs.length - 1] && k >= n - 1;
          const vert = (lo === null || lo <= f.ft + 300 || ((isFirst || isLast) && s.kind === 'CTR')) && (up === null || up + (/AGL|ASFC/i.test(s.upper) ? 1500 : 0) >= f.ft - 300 || ((isFirst || isLast) && s.kind === 'CTR'));
          if (!vert) continue;
          if (inPoly(p, s.poly)) seen.set(s, k / n);
        }
      }
      lg.airspaces = [...seen.entries()].sort((x, y) => x[1] - y[1]).map(([s]) => s);
      // espaces dont le plancher est juste au-dessus (risque d'y pénétrer en montée)
      lg.ceilings = aspAll.filter((s) => !seen.has(s) && s.kind !== 'SIV' && polyRouteDist(s.poly, [lg.a, lg.b]) === 0)
        .map((s) => ({ s, lo: parseAlt(s.lower) })).filter((x) => x.lo !== null && x.lo > f.ft && x.lo - f.ft <= 1500)
        .sort((x, y) => x.lo - y.lo).slice(0, 3).map((x) => x.s);
    }

    // --- Météo
    const wxNear = Object.values(A.metars).map((m) => ({ m, r: routeDist([m.lat, m.lon], pts) }))
      .filter((x) => x.r.d <= f.cor + 15 && !adIds.includes(x.m.icaoId)).sort((a, b) => a.r.along - b.r.along);
    const nearestMetar = (id) => {
      const a = A.aptByIcao[id];
      return Object.values(A.metars).map((m) => ({ m, d: distNm([a.la, a.lo], [m.lat, m.lon]) })).sort((x, y) => x.d - y.d)[0];
    };
    const wx = adIds.map((id) => ({ id, metar: A.metars[id], taf: A.tafs[id], near: A.metars[id] ? null : nearestMetar(id) }));

    // --- NOTAM
    const T1 = eta.getTime() + 3600e3 + (altLeg ? altLeg.min * 6e4 : 0), T0 = depT.getTime() - 3600e3;
    const overlaps = (n) => (!n.from || Date.parse(n.from) <= T1) && (isNaN(Date.parse(n.to)) || Date.parse(n.to) >= T0);
    const adNotams = adIds.map((id) => ({ id, list: (N.ad[id] || []).filter(overlaps) }));
    const ceil = f.ft / 100 + 15, enroute = [], general = [], obst = [];
    for (const n of N.fir || []) {
      if (n.la == null || !overlaps(n) || /RTBA/.test(n.e || '')) continue;
      if (n.lower != null && n.lower > ceil) continue;
      const r = routeDist([n.la, n.lo], pts);
      if (r.d - (n.r || 0) > f.cor) continue;
      if ((n.r || 0) >= 100) general.push(n);
      else if ((n.q || '')[0] === 'O') obst.push({ n, along: r.along, d: r.d });
      else enroute.push({ n, along: r.along, d: r.d });
    }
    enroute.sort((a, b) => a.along - b.along); obst.sort((a, b) => a.along - b.along);

    // --- SUP AIP
    const flightDay = depT.toISOString().slice(0, 10);
    const sups = (A.SUP || []).filter((s) => (!s.from || s.from <= flightDay) && (!s.to || s.to >= flightDay))
      .map((s) => ({ s, d: Math.min(...s.places.map((p) => routeDist([p.la, p.lo], pts).d), Infinity) }))
      .filter((x) => x.d <= f.cor + 10).sort((a, b) => a.d - b.d);

    // --- Zones P/R/D + AZBA sur la route finale
    const zones = [];
    for (const z of (ZONES && ZONES.data) || []) {
      const d = polyRouteDist(z.poly, pts);
      if (d > f.cor) continue;
      zones.push({ z, d, crossed: d === 0, below: vOverlap(z) });
    }
    zones.sort((a, b) => (a.z.type + a.z.id).localeCompare(b.z.type + b.z.id));
    const rtba = zones.filter((x) => x.z.rtba).map((x) => {
      const slots = rtbaSlots(x.z);
      return { ...x, slots, conflict: slots.some((s) => slotOverlap(s, dayStart, T0, T1)) };
    });
    const azbaKnown = acts.length > 0 && Math.abs(horizon) < 1.5;

    // --- Terrains : briefing départ / arrivée
    const sun = sunTimes(eta, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    const sunDep = sunTimes(depT, pts[0][0], pts[0][1]);
    const mb = massBalance(f);
    const landMass = mb.mass - totFuel * f.T.fuel.density;
    const terrain = (id, role) => {
      const v = vacOf(id), a = A.aptByIcao[id];
      const w = wx.find((x) => x.id === id);
      const m = (w && w.metar) || (w && w.near && w.near.m) || null;
      const rw = runwayFor(v, m && m.wdir !== 'VRB' ? +m.wdir : null, m ? m.wspd : null);
      const len = rwyLength(v), grass = isGrass(v);
      const elev = v && v.alt != null ? v.alt : (a && +a.elev) || 0;
      const tIsa = 15 - 2 * elev / 1000, temp = m && m.temp != null ? m.temp : tIsa;
      const factor = (1 + 0.10 * elev / 1000) * (1 + 0.10 * Math.max(0, temp - tIsa) / 10);
      const base = f.T.takeoff ? (grass ? (f.T.takeoff.grass || f.T.takeoff.hard * 1.15) : f.T.takeoff.hard) : null;
      const tod = base ? Math.round(base * factor / 10) * 10 : null;
      const cons = classifyConsignes(v);
      return { id, role, a, v, m, rw, len, grass, elev, temp, tod, factor, cons, infos: infosVac(v), notams: (adNotams.find((x) => x.id === id) || {}).list || [] };
    };
    const depInfo = terrain(f.dep, 'DÉPART'), arrInfo = terrain(f.arr, 'ARRIVÉE'), altInfo = f.alt ? terrain(f.alt, 'DÉGAGEMENT') : null;

    const cams = (id) => {
      const a = A.aptByIcao[id];
      return A.SOURCES.filter((s) => s.t === 'cam').map((s) => ({ s, d: distNm([a.la, a.lo], [s.la, s.lo]) * 1.852 })).filter((x) => x.d <= 15).sort((x, y) => x.d - y.d).slice(0, 5);
    };

    return {
      f, userIds, ids, pts, detours: routed.detours, obstacles, legs, totDist, totMin, totFuel, eta, depT, altLeg, resFuel, reqFuel, loaded,
      sun, sunDep, varDeg, winds, windErr, elevErr, wx, wxNear, adNotams, enroute, general, obst, sups, zones, rtba, azbaKnown,
      mb, landMass, depInfo, arrInfo, altInfo, cams: { dep: cams(f.dep), arr: cams(f.arr) },
      profile, wxRoute: await routeWeather(pts, legs, depT, f.ft).catch((e) => ({ err: e.message })),
      vprofile: verticalProfile(profile, (ASP && ASP.data) || [], zones, f.ft),
      generated: new Date(), notamGenerated: N.generated, vacCycle: VAC && VAC.cycle, aspSource: ASP && ASP.source,
    };
  }

  // ================================================================== météo le long de la route
  // Prévision modèle (Open-Meteo) à l'heure de passage : plafond estimé (écart T/Td), nuages bas, visibilité, pluie, orages.
  async function routeWeather(pts, legs, depT, cruiseFt) {
    const horizon = (depT - Date.now()) / 864e5;
    if (horizon < -1 || horizon > 15) return { err: 'prévisions disponibles à 16 jours' };
    const samp = [];   // un point tous les ~12 NM avec son heure de passage
    let t = depT.getTime(), acc = 0;
    legs.forEach((lg, i) => {
      const n = Math.max(1, Math.round(lg.dist / 12));
      const dt = (lg.min * 6e4) / n;
      for (let k = (i === 0 ? 0 : 1); k <= n; k++) samp.push({ p: destPt(lg.a, lg.tc, lg.dist * k / n), at: new Date(t + dt * k), along: acc + lg.dist * k / n, leg: i });
      t += lg.min * 6e4; acc += lg.dist;
    });
    const days = [...new Set(samp.map((x) => x.at.toISOString().slice(0, 10)))].sort();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${samp.map((x) => x.p[0].toFixed(3)).join(',')}&longitude=${samp.map((x) => x.p[1].toFixed(3)).join(',')}`
      + '&hourly=temperature_2m,dew_point_2m,cloud_cover_low,cloud_cover_mid,visibility,precipitation,weather_code,wind_gusts_10m'
      + `&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`;
    let d = await omFetch(url); if (!Array.isArray(d)) d = [d];
    const pts2 = samp.map((x, i) => {
      const h = d[i].hourly, idx = h.time.indexOf(x.at.toISOString().slice(0, 13) + ':00');
      const g = (k) => (idx >= 0 ? h[k][idx] : null);
      const T = g('temperature_2m'), Td = g('dew_point_2m'), low = g('cloud_cover_low'), vis = g('visibility'), rr = g('precipitation'), wc = g('weather_code'), gust = g('wind_gusts_10m');
      const elevFt = Math.round((d[i].elevation || 0) * 3.281);
      const baseAgl = T != null && Td != null ? Math.max(0, Math.round((T - Td) * 400 / 100) * 100) : null;
      const baseAmsl = baseAgl != null ? Math.round((baseAgl + elevFt) / 100) * 100 : null;
      let level = 0; const why = [];
      if (vis != null && vis < 5000) { level = 2; why.push(`visi ${Math.round(vis / 100) / 10} km`); } else if (vis != null && vis < 8000) { level = Math.max(level, 1); why.push(`visi ${Math.round(vis / 100) / 10} km`); }
      if (low != null && low >= 70 && baseAgl != null && baseAgl < 1000) { level = 2; why.push(`plafond ~${baseAgl} ft sol`); }
      else if (low != null && low >= 50 && baseAgl != null && baseAgl < 2000) { level = Math.max(level, 1); why.push(`nuages bas ~${baseAgl} ft sol`); }
      if (low != null && low >= 50 && baseAmsl != null && baseAmsl < cruiseFt + 500) { level = Math.max(level, 1); why.push(`base ~${baseAmsl} ft < croisière`); }
      if (wc != null && wc >= 95) { level = 2; why.push('orages'); } else if (rr != null && rr >= 1) { level = Math.max(level, 1); why.push(`pluie ${rr} mm/h`); }
      if (gust != null && gust >= 25) { level = Math.max(level, 1); why.push(`rafales ${Math.round(gust)} kt`); }
      return { ...x, T, Td, low, vis, rr, wc, gust, elevFt, baseAgl, baseAmsl, level, why };
    });
    return { pts: pts2, worst: Math.max(0, ...pts2.map((x) => x.level)) };
  }
  const WXCOL = ['#2ecc40', '#ff9f0a', '#ff3b30'], WXTXT = ['VFR favorable', 'VFR marginal', 'VFR défavorable'];

  // ================================================================== coupe verticale
  function verticalProfile(profile, asp, zones, cruiseFt) {
    if (!profile.length) return null;
    const segs = [];
    const add = (name, kind, lower, upper, color) => {
      let cur = null;
      profile.forEach((pp, i) => {
        const inside = inPoly(pp.p, kind.poly);
        if (inside && !cur) cur = { name, from: pp.along, to: pp.along, lower, upper, color, aglL: /ASFC|AGL/i.test(String(kind.lowerS)), aglU: /ASFC|AGL/i.test(String(kind.upperS)), ter: [] };
        if (inside) { cur.to = pp.along; cur.ter.push(pp.ft); }
        if ((!inside || i === profile.length - 1) && cur) { segs.push(cur); cur = null; }
      });
    };
    for (const s of asp) {
      if (s.kind === 'SIV') continue;
      const lo = parseAlt(s.lower), up = parseAlt(s.upper);
      if (lo === null || lo > 12000) continue;
      if (polyRouteDist(s.poly, profile.map((x) => x.p)) > 0) continue;
      add(`${s.name} (${s.cls})`, { poly: s.poly, lowerS: s.lower, upperS: s.upper }, lo, Math.min(up ?? 12000, 12000), s.kind === 'CTR' ? '#1e88e5' : '#64b5f6');
    }
    for (const x of zones) {
      if (!x.crossed) continue;
      const lo = parseAlt(x.z.lower), up = parseAlt(x.z.upper);
      if (lo === null || lo > 12000) continue;
      add(`${x.z.id} ${x.z.name}`, { poly: x.z.poly, lowerS: x.z.lower, upperS: x.z.upper }, lo, Math.min(up ?? 12000, 12000), x.z.rtba ? '#ff3b30' : x.z.type === 'P' ? '#d81b60' : x.z.type === 'D' ? '#fb8c00' : '#8e24aa');
    }
    const maxTer = Math.max(...profile.map((x) => x.ft));
    const total = profile[profile.length - 1].along;
    const conflicts = segs.filter((sg) => {
      if (sg.to <= 8 || sg.from >= total - 8) return false;   // CTR / zones au départ ou à l'arrivée : attendues
      const tmax = Math.max(0, ...sg.ter);
      const lo = sg.lower + (sg.aglL ? tmax : 0), up = sg.upper + (sg.aglU ? tmax : 0);
      return cruiseFt >= lo && cruiseFt <= up;
    });
    return { profile, segs, maxTer, total: profile[profile.length - 1].along, conflicts };
  }
  function profileSvg(v, b, w = 430, h = 170) {
    if (!v) return '';
    const top = Math.max(b.f.ft + 2000, v.maxTer + 1500, 3000), X = (nm) => 30 + nm / v.total * (w - 36), Y = (ft) => h - 18 - ft / top * (h - 26);
    const ter = `M${X(0)},${Y(0)} ` + v.profile.map((p) => `L${X(p.along).toFixed(1)},${Y(p.ft).toFixed(1)}`).join(' ') + ` L${X(v.total)},${Y(0)} Z`;
    const rects = v.segs.filter((s) => s.lower < top).map((s) => ({ ...s, upper: Math.min(s.upper, top) })).map((s) => `<rect x="${X(s.from).toFixed(1)}" y="${Y(s.upper).toFixed(1)}" width="${Math.max(1, X(s.to) - X(s.from)).toFixed(1)}" height="${Math.max(1, Y(s.lower) - Y(s.upper)).toFixed(1)}" fill="${s.color}" fill-opacity=".18" stroke="${s.color}" stroke-width=".8"><title>${esc(s.name)} ${s.lower}-${s.upper} ft</title></rect>`).join('');
    const wx = b.wxRoute && b.wxRoute.pts ? b.wxRoute.pts.map((p) => `<circle cx="${X(p.along).toFixed(1)}" cy="${h - 6}" r="3.5" fill="${WXCOL[p.level]}"><title>${esc(utc(p.at))} ${esc(WXTXT[p.level])} ${esc(p.why.join(', '))}</title></circle>`).join('') : '';
    const grid = [0, 0.25, 0.5, 0.75, 1].map((k) => `<text x="2" y="${(Y(top * k) + 3).toFixed(1)}" font-size="8" fill="#9bd">${Math.round(top * k / 100) * 100}</text>`).join('');
    const marks = [];
    let acc = 0; b.legs.forEach((lg, i) => { if (i) marks.push([acc, lg.from]); acc += lg.dist; });
    const mk = marks.map(([a, n]) => `<line x1="${X(a)}" x2="${X(a)}" y1="8" y2="${h - 18}" stroke="#fff" stroke-opacity=".25"/><text x="${X(a) + 2}" y="16" font-size="8" fill="#fff">${esc(n)}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="background:rgba(0,0,0,.25);border-radius:5px">${grid}${rects}<path d="${ter}" fill="#8d6e63" fill-opacity=".85"/><line x1="${X(0)}" x2="${X(v.total)}" y1="${Y(b.f.ft)}" y2="${Y(b.f.ft)}" stroke="#ff2bd6" stroke-width="2"/>${mk}${wx}
      <text x="${X(0)}" y="${h - 9}" font-size="8" fill="#fff">${esc(b.ids[0])}</text><text x="${X(v.total) - 26}" y="${h - 9}" font-size="8" fill="#fff">${esc(b.ids[b.ids.length - 1])}</text></svg>`;
  }


  // ================================================================== GRAMET (coupe météo le long de la route)
  // Modèle Open-Meteo (AROME / ARPEGE / ECMWF selon disponibilité) par niveau de pression, à l'heure de passage :
  // nuages par niveau, givrage probable (0 à -15 °C dans le nuage ou HR ≥ 85 %), isothermes 0 / -10 °C, vent, précipitations.
  const GLV = [1000, 950, 900, 850, 800, 700, 600, 500];
  const grametCache = new Map();
  function routePosAt(b, along) {
    let acc = 0, tmin = 0;
    for (const lg of b.legs) {
      if (along <= acc + lg.dist + 1e-6 || lg === b.legs[b.legs.length - 1]) {
        const d = Math.max(0, Math.min(lg.dist, along - acc));
        return { p: destPt(lg.a, lg.tc, d), at: new Date(b.depT.getTime() + (tmin + d / lg.gs * 60) * 6e4) };
      }
      acc += lg.dist; tmin += lg.dist / lg.gs * 60;
    }
  }
  async function gramet(b) {
    const horizon = (b.depT - Date.now()) / 864e5;
    if (horizon < -1 || horizon > 15) return { err: 'prévisions disponibles à 16 jours' };
    const total = b.totDist, n = Math.min(24, Math.max(8, Math.round(total / 8)));
    const cols = [];
    for (let k = 0; k <= n; k++) cols.push({ along: total * k / n, ...routePosAt(b, total * k / n) });
    const days = [...new Set(cols.map((c) => c.at.toISOString().slice(0, 10)))].sort();
    const vars = GLV.flatMap((l) => ['temperature', 'relative_humidity', 'cloud_cover', 'wind_speed', 'wind_direction', 'geopotential_height'].map((v) => `${v}_${l}hPa`));
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${cols.map((c) => c.p[0].toFixed(3)).join(',')}&longitude=${cols.map((c) => c.p[1].toFixed(3)).join(',')}`
      + `&hourly=${vars.join(',')},freezing_level_height,precipitation,cape,weather_code`
      + `&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`;
    let d = grametCache.get(url);
    if (!d) {
      d = await omFetch(url); if (!Array.isArray(d)) d = [d];
      grametCache.set(url, d);
    }
    cols.forEach((c, i) => {
      const h = d[i].hourly, key = new Date(Math.round(c.at / 36e5) * 36e5).toISOString().slice(0, 13) + ':00';
      const idx = Math.max(0, h.time.indexOf(key)), g = (k) => (h[k] ? h[k][idx] : null);
      c.lv = GLV.map((l) => {
        const rh = g(`relative_humidity_${l}hPa`); let cc = g(`cloud_cover_${l}hPa`);
        if (cc == null && rh != null) cc = Math.max(0, Math.min(100, (rh - 75) / 25 * 100));
        return { l, z: g(`geopotential_height_${l}hPa`) * 3.281, T: g(`temperature_${l}hPa`), rh, cc: cc ?? 0, ws: g(`wind_speed_${l}hPa`), wd: g(`wind_direction_${l}hPa`) };
      }).filter((x) => x.z != null && !isNaN(x.z) && x.T != null);
      c.frz = g('freezing_level_height') != null ? g('freezing_level_height') * 3.281 : null;
      c.rr = g('precipitation'); c.cape = g('cape'); c.wc = g('weather_code');
      c.elev = (d[i].elevation || 0) * 3.281;
      const iso = (t) => { for (let k = 0; k < c.lv.length - 1; k++) { const a = c.lv[k], z = c.lv[k + 1]; if (a.T >= t && z.T < t) return a.z + (z.z - a.z) * (a.T - t) / (a.T - z.T); } return c.lv.length && c.lv[0].T < t ? 0 : null; };
      c.iso0 = iso(0) ?? c.frz; c.iso10 = iso(-10);
      c.icing = c.lv.some((x) => x.T <= 0 && x.T >= -15 && (x.cc >= 50 || x.rh >= 90) && Math.abs(x.z - b.f.ft) < 1500);
    });
    const ex = cols.flatMap((c) => c.lv.filter((x) => Math.abs(x.z - b.f.ft) < 1200)).map((x) => x.cc);
    return { cols, total, maxCcCruise: ex.length ? Math.max(...ex) : 0, icing: cols.some((c) => c.icing), storm: cols.some((c) => (c.wc ?? 0) >= 95 || (c.cape ?? 0) >= 800), minIso0: Math.min(...cols.map((c) => c.iso0 ?? 99999)) };
  }
  function ogimetUrl(b) {
    const ids = b.ids.filter((x) => /^[A-Z]{4}$/.test(x) && A.aptByIcao[x]);
    const fl = String(Math.max(10, Math.round(b.f.ft / 100))).padStart(3, '0');
    return `https://www.ogimet.com/display_gramet.php?lang=fr&icao=${ids.join('_')}&hini=0&tref=${Math.floor(b.depT / 1000)}&hfin=${Math.max(1, Math.ceil(b.totMin / 60))}&fl=${fl}&submit=submit`;
  }
  function drawGramet(cv, g, b) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, u = W / 1000;
    const L0 = 52 * u, R0 = W - 14 * u, T0 = 34 * u, B0 = H - 62 * u;
    const top = Math.min(18000, Math.max(10000, Math.ceil((b.f.ft + 5000) / 1000) * 1000));
    const X = (nm) => L0 + nm / g.total * (R0 - L0), Y = (ft) => B0 - Math.max(0, Math.min(ft, top)) / top * (B0 - T0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, T0, 0, B0); sky.addColorStop(0, '#d9ecff'); sky.addColorStop(1, '#f4f9ff');
    ctx.fillStyle = sky; ctx.fillRect(L0, T0, R0 - L0, B0 - T0);
    ctx.save(); ctx.beginPath(); ctx.rect(L0, T0, R0 - L0, B0 - T0); ctx.clip();
    // hachures givrage
    const pc = document.createElement('canvas'); pc.width = pc.height = Math.round(10 * u);
    const px = pc.getContext('2d'); px.strokeStyle = 'rgba(214,0,90,.8)'; px.lineWidth = 1.6 * u;
    px.beginPath(); px.moveTo(0, pc.height); px.lineTo(pc.width, 0); px.stroke();
    const hatch = ctx.createPattern(pc, 'repeat');
    const cols = g.cols;
    cols.forEach((c, i) => {
      const xa = i ? (X(cols[i - 1].along) + X(c.along)) / 2 : L0, xb = i < cols.length - 1 ? (X(c.along) + X(cols[i + 1].along)) / 2 : R0;
      const lv = [{ ...c.lv[0], z: Math.min(0, c.lv[0] ? c.lv[0].z : 0) }, ...c.lv];
      for (let k = 0; k < lv.length - 1; k++) {
        const a = lv[k], z = lv[k + 1], cc = (a.cc + z.cc) / 2, T = (a.T + z.T) / 2, rh = (a.rh + z.rh) / 2;
        const ya = Y(a.z), yz = Y(z.z);
        if (cc > 5) { ctx.fillStyle = `rgba(80,92,110,${Math.min(.85, cc / 100 * .85).toFixed(2)})`; ctx.fillRect(xa, yz, xb - xa + .6, ya - yz + .6); }
        if (T <= 0 && T >= -15 && (cc >= 50 || rh >= 90)) { ctx.fillStyle = hatch; ctx.fillRect(xa, yz, xb - xa + .6, ya - yz + .6); }
      }
    });
    // isothermes
    const isoLine = (k, col, w, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = w * u; ctx.setLineDash(dash.map((x) => x * u)); ctx.beginPath(); let on = false;
      cols.forEach((c) => { const v = c[k]; if (v == null) { on = false; return; } const x = X(c.along), y = Y(v); if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; } });
      ctx.stroke(); ctx.setLineDash([]);
    };
    isoLine('iso0', '#0057d9', 3, [10, 6]); isoLine('iso10', '#00a2c7', 1.8, [4, 5]);
    // relief
    const prof = b.vprofile && b.vprofile.profile && b.vprofile.profile.length ? b.vprofile.profile.map((p) => [p.along, p.ft]) : cols.map((c) => [c.along, c.elev]);
    ctx.fillStyle = '#8d6e63'; ctx.beginPath(); ctx.moveTo(X(0), B0);
    prof.forEach(([a, f]) => ctx.lineTo(X(a), Y(f))); ctx.lineTo(X(g.total), B0); ctx.closePath(); ctx.fill();
    // altitude de croisière
    ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(L0, Y(b.f.ft)); ctx.lineTo(R0, Y(b.f.ft)); ctx.stroke();
    // vent (barbules)
    const barb = (x, y, dir, spd) => {
      if (spd == null || dir == null) return;
      const L = 24 * u, th = rad(dir), dx = Math.sin(th), dy = -Math.cos(th);
      ctx.strokeStyle = '#1b2a3a'; ctx.fillStyle = '#1b2a3a'; ctx.lineWidth = 1.4 * u;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * L, y + dy * L); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 2 * u, 0, 7); ctx.fill();
      let s = Math.round(spd / 5) * 5, pos = L;
      const nx = -dy, ny = dx, fl = 10 * u;
      const ex = (p) => [x + dx * p, y + dy * p];
      while (s >= 50) { const [a1, b1] = ex(pos), [a2, b2] = ex(pos - 6 * u); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a1 + nx * fl, b1 + ny * fl); ctx.lineTo(a2, b2); ctx.fill(); pos -= 8 * u; s -= 50; }
      while (s >= 10) { const [a1, b1] = ex(pos); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a1 + nx * fl + dx * 4 * u, b1 + ny * fl + dy * 4 * u); ctx.stroke(); pos -= 4.5 * u; s -= 10; }
      if (s >= 5) { if (pos === L) pos -= 4.5 * u; const [a1, b1] = ex(pos); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a1 + nx * fl / 2 + dx * 2 * u, b1 + ny * fl / 2 + dy * 2 * u); ctx.stroke(); }
    };
    const step = Math.max(1, Math.round(cols.length / 9));
    cols.forEach((c, i) => { if (i % step) return; c.lv.forEach((x) => { if ([900, 850, 700, 600, 500].includes(x.l) && x.z > (c.elev || 0) + 300 && x.z < top - 400) barb(X(c.along), Y(x.z), x.wd, x.ws); }); });
    ctx.restore();
    // points tournants
    ctx.font = `700 ${12 * u}px Helvetica, Arial`; ctx.fillStyle = '#1b2a3a'; ctx.strokeStyle = 'rgba(27,42,58,.35)'; ctx.lineWidth = 1 * u;
    let acc = 0, lastR = -1e9;
    const endName = b.legs[b.legs.length - 1].to, endL = R0 - ctx.measureText(endName).width - 8 * u;
    ctx.textAlign = 'right'; ctx.fillText(endName, R0, T0 - 6 * u);
    b.legs.forEach((lg, i) => {
      const x = X(acc), w = ctx.measureText(lg.from).width;
      if (i) { ctx.beginPath(); ctx.moveTo(x, T0); ctx.lineTo(x, B0); ctx.stroke(); }
      const xl = i ? x - w / 2 : x;
      if (xl > lastR + 6 * u && xl + w < endL) { ctx.textAlign = 'left'; ctx.fillText(lg.from, xl, T0 - 6 * u); lastR = xl + w; }
      acc += lg.dist;
    });
    // axe vertical
    ctx.font = `${11 * u}px Helvetica, Arial`; ctx.textAlign = 'right'; ctx.fillStyle = '#334';
    for (let f = 0; f <= top; f += 2000) { ctx.fillText(f ? `${f / 1000}k ft` : 'MSL', L0 - 5 * u, Y(f) + 4 * u); ctx.strokeStyle = 'rgba(0,0,0,.07)'; ctx.beginPath(); ctx.moveTo(L0, Y(f)); ctx.lineTo(R0, Y(f)); ctx.stroke(); }
    ctx.strokeStyle = '#334'; ctx.lineWidth = 1.2 * u; ctx.strokeRect(L0, T0, R0 - L0, B0 - T0);
    // bandeau précipitations / orages + heures
    const P0 = B0 + 6 * u, PH = 20 * u;
    ctx.fillStyle = '#f0f4f8'; ctx.fillRect(L0, P0, R0 - L0, PH);
    cols.forEach((c, i) => {
      const xa = i ? (X(cols[i - 1].along) + X(c.along)) / 2 : L0, xb = i < cols.length - 1 ? (X(c.along) + X(cols[i + 1].along)) / 2 : R0;
      if (c.rr > 0.05) { const h = Math.min(1, c.rr / 4) * PH; ctx.fillStyle = c.rr >= 1 ? '#1565c0' : '#64b5f6'; ctx.fillRect(xa, P0 + PH - h, xb - xa, h); }
      if ((c.wc ?? 0) >= 95 || (c.cape ?? 0) >= 800) { ctx.fillStyle = '#e65100'; ctx.font = `700 ${14 * u}px Helvetica, Arial`; ctx.textAlign = 'center'; ctx.fillText('ϟ', (xa + xb) / 2, P0 + 15 * u); }
    });
    ctx.font = `${10 * u}px Helvetica, Arial`; ctx.fillStyle = '#334'; ctx.textAlign = 'right'; ctx.fillText('pluie', L0 - 5 * u, P0 + 14 * u);
    ctx.textAlign = 'center';
    let lastT = -1e9;
    cols.forEach((c, i) => {
      if (i % step && i !== cols.length - 1) return;
      const t = `${utc(c.at)} · ${Math.round(c.along)} NM`, w = ctx.measureText(t).width;
      const x = Math.min(R0 - w / 2, Math.max(L0 + w / 2, X(c.along)));
      if (x - w / 2 < lastT + 8 * u) return;
      ctx.fillText(t, x, P0 + PH + 14 * u); lastT = x + w / 2;
    });
    // légende
    const lg = [['rgba(80,92,110,.7)', 'Nuages (par niveau)'], [null, 'Givrage probable'], ['#0057d9', 'Isotherme 0 °C'], ['#00a2c7', '-10 °C'], ['#ff2bd6', `Croisière ${b.f.ft} ft`], ['#8d6e63', 'Relief']];
    let lx = L0; const ly = H - 12 * u; ctx.font = `${11 * u}px Helvetica, Arial`; ctx.textAlign = 'left';
    lg.forEach(([col, t]) => { if (col) { ctx.fillStyle = col; ctx.fillRect(lx, ly - 9 * u, 16 * u, 10 * u); } else { ctx.fillStyle = hatch; ctx.fillRect(lx, ly - 9 * u, 16 * u, 10 * u); ctx.strokeStyle = '#d6005a'; ctx.strokeRect(lx, ly - 9 * u, 16 * u, 10 * u); } ctx.fillStyle = '#223'; ctx.fillText(t, lx + 20 * u, ly); lx += ctx.measureText(t).width + 38 * u; });
    ctx.fillStyle = '#556'; ctx.fillText('Vent : barbules (kt) · ϟ orage / instabilité', lx, ly);
  }
  function grametSummary(g, b) {
    if (!g || g.err) return `Indisponible (${esc((g && g.err) || '?')}).`;
    const t = [];
    t.push(`Nébulosité max à l'altitude de croisière ~${Math.round(g.maxCcCruise)} %`);
    if (g.minIso0 < 99999) t.push(`isotherme 0 °C au plus bas ~${Math.round(g.minIso0 / 100) * 100} ft`);
    if (g.icing) t.push('risque de givrage près de l\'altitude de croisière');
    if (g.storm) t.push('instabilité / orages possibles');
    return t.join(' · ') + '.';
  }


  // ================================================================== AZBA (4) et vol montagne (5)
  function azbaHtml(b) {
    if (!b.rtba.length) return '';
    return `<h4>AZBA — zones RTBA à proximité</h4>
      ${b.rtba.map((r) => `<div class="${r.conflict && r.crossed ? 'warn' : 'okk'}"><b>${esc(r.z.id)} ${esc(r.z.name)}</b> (${esc(r.z.lower)} – ${esc(r.z.upper)}) ${r.crossed ? '· <b>traversée</b>' : `· à ${r.d.toFixed(0)} NM`}<br>
        ${r.slots.length ? `Créneaux ${esc(r.slots.join(', '))} UTC${r.conflict ? ' — <b>active pendant le vol</b>' : ''}` : 'Aucun créneau publié pour cette date'}</div>`).join('')}
      <p class="meta">Les créneaux AZBA du lendemain sont publiés la veille (en fin d'après-midi) : ${b.azbaKnown && (b.depT.toISOString().slice(0, 10) <= new Date().toISOString().slice(0, 10) || b.rtba.some((r) => r.slots.length)) ? 'créneaux publiés pris en compte.' : '<b>pas encore publiés pour cette date</b> — mettre à jour le briefing la veille au soir (bouton 📅 Rappels).'}
        Consulter <a href="https://sofia-briefing.aviation-civile.gouv.fr/" target="_blank" rel="noopener" style="color:#9cf">SOFIA-Briefing</a> (rubrique AZBA).</p>`;
  }
  // Cols et passages des Pyrénées (altitude en m, position approximative ± 1 km)
  const COLS = [
    ["Col d'Ibañeta (Roncevaux)", 1057, 43.020, -1.325], ['Col de la Pierre-Saint-Martin', 1760, 42.976, -0.766], ['Col du Somport', 1632, 42.800, -0.527],
    ['Col du Pourtalet', 1794, 42.807, -0.418], ['Col de Marie-Blanque', 1035, 43.066, -0.507], ["Col d'Aubisque", 1709, 42.976, -0.340],
    ['Col du Soulor', 1474, 42.959, -0.262], ['Col du Tourmalet', 2115, 42.909, 0.145], ["Col d'Aspin", 1489, 42.944, 0.327],
    ['Col de Peyresourde', 1569, 42.797, 0.452], ['Col du Portillon', 1293, 42.794, 0.598], ['Col de Menté', 1349, 42.913, 0.750],
    ['Col de Port', 1249, 42.880, 1.463], ['Col de Puymorens', 1915, 42.546, 1.823], ["Port d'Envalira", 2408, 42.541, 1.721],
  ];
  function mountainOf(b) {
    const v = b.vprofile; if (!v || !v.profile.length || v.maxTer < 3000) return null;
    let acc = 0;
    const legs = b.legs.map((lg) => {
      const seg = v.profile.filter((p) => p.along >= acc - 0.01 && p.along <= acc + lg.dist + 0.01);
      const hi = seg.reduce((m, p) => (p.ft > m.ft ? p : m), { ft: -1 });
      const along0 = acc; acc += lg.dist;
      if (hi.ft < 2500) return null;
      // vent et isotherme à hauteur des crêtes (GRAMET)
      let wind = lg.wind ? { dir: lg.wind.dir, spd: lg.wind.spd, src: `à ${b.f.ft} ft` } : null, iso0 = null;
      const g = b.gramet && !b.gramet.err ? b.gramet : null;
      if (g) {
        const c = g.cols.reduce((m, x) => (Math.abs(x.along - hi.along) < Math.abs(m.along - hi.along) ? x : m), g.cols[0]);
        const target = hi.ft + 1000, lvl = c.lv.reduce((m, x) => (Math.abs(x.z - target) < Math.abs(m.z - target) ? x : m), c.lv[0]);
        if (lvl && lvl.ws != null) wind = { dir: lvl.wd, spd: lvl.ws, src: `~${Math.round(lvl.z / 100) * 100} ft (${lvl.l} hPa)` };
        iso0 = c.iso0;
      }
      const valley = A.APTS.filter((a) => a.elev !== '' && a.elev != null && +a.elev < 1500)
        .map((a) => ({ a, d: distNm(hi.p, [a.la, a.lo]), brg: bearing(hi.p, [a.la, a.lo]) })).filter((x) => x.d <= 30).sort((x, y) => x.d - y.d).slice(0, 3);
      const cols = COLS.map(([n, m, la, lo]) => ({ n, ft: Math.round(m * 3.281), d: routeDist([la, lo], [lg.a, lg.b]).d })).filter((x) => x.d <= 8).sort((x, y) => x.d - y.d);
      const minAlt = Math.ceil((hi.ft + (wind && wind.spd >= 20 ? 1500 : 1000)) / 100) * 100;
      return { lg, hi, along0, wind, iso0, valley, cols, minAlt };
    }).filter(Boolean);
    if (!legs.length) return null;
    const warn = [];
    legs.forEach((m) => {
      const n = `${m.lg.from}→${m.lg.to}`;
      if (b.f.ft < m.minAlt) warn.push(`${n} : croisière ${b.f.ft} ft sous l'altitude de franchissement conseillée ${m.minAlt} ft (relief ${m.hi.ft} ft).`);
      if (m.wind && m.wind.spd >= 30) warn.push(`${n} : vent ${Math.round(m.wind.spd)} kt sur les crêtes — vol montagne déconseillé (turbulence, rotors, fortes descendances).`);
      else if (m.wind && m.wind.spd >= 20) warn.push(`${n} : vent ${Math.round(m.wind.spd)} kt sur les crêtes — turbulence et descendances sous le vent.`);
      if (m.iso0 != null && m.iso0 < m.minAlt + 1000) warn.push(`${n} : isotherme 0 °C (~${Math.round(m.iso0 / 100) * 100} ft) proche de l'altitude de franchissement — givrage en cas de nuages.`);
    });
    return { legs, warn };
  }
  const MOUNTAIN_RULES = [
    'Franchir crêtes et cols avec au moins 1 000 ft de marge (1 500 ft par vent fort), en abordant la crête à 45° pour garder le demi-tour possible.',
    'Toujours garder une échappatoire vers la vallée ; ne pas s\'engager dans une vallée qui se rétrécit et monte plus vite que l\'avion.',
    'Côté au vent : ascendances ; côté sous le vent : descendances et rotors. Au-delà de 20 kt sur les crêtes : prudence ; 30 kt : renoncer.',
    'Nuages accrochés aux crêtes ou base qui baisse : demi-tour. Brises de vallée l\'après-midi, de montagne le matin.',
    'Performances réduites en altitude (densité) : surveiller la vitesse de montée et prévoir la montée avant d\'entrer dans la vallée.',
  ];
  function mountainHtml(b) {
    const m = b.mountain; if (!m) return '';
    return `<h4>⛰️ Vol en montagne</h4>
      ${m.warn.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('')}
      <table class="legs"><tr><th>Branche</th><th>Relief max</th><th>Franchir à</th><th>Vent crêtes</th><th>0 °C</th></tr>
      ${m.legs.map((x) => `<tr><td>${esc(x.lg.from)}→${esc(x.lg.to)}</td><td>${x.hi.ft} ft (${Math.round(x.hi.along - x.along0)} NM)</td><td><b>${x.minAlt} ft</b></td><td>${x.wind ? `${r3(x.wind.dir)}/${Math.round(x.wind.spd)} kt` : '–'}</td><td>${x.iso0 != null ? Math.round(x.iso0 / 100) * 100 + ' ft' : '–'}</td></tr>`).join('')}</table>
      ${m.legs.map((x) => `${x.cols.length ? `<p class="meta"><b>Cols près de ${esc(x.lg.from)}→${esc(x.lg.to)}</b> : ${x.cols.map((c) => `${esc(c.n)} ${c.ft} ft`).join(' · ')}</p>` : ''}
        <p class="meta"><b>Dégagements en vallée</b> depuis le point haut : ${x.valley.map((v) => `${esc(v.a.icao)} ${esc(v.a.name)} (${v.a.elev} ft) ${r3(v.brg)}° ${v.d.toFixed(0)} NM`).join(' · ') || 'aucun terrain bas à moins de 30 NM'}</p>`).join('')}
      <details><summary class="meta">Règles de base du vol en montagne</summary><ul class="meta">${MOUNTAIN_RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
      <p class="meta small-print">Positions des cols approximatives : vérifier sur la carte OACI. Le vol en montagne hors qualification se limite aux itinéraires de transit.</p>`;
  }

  // ================================================================== carte + résumé
  // Repères toutes les 5 min de vol (vitesse sol de chaque branche) et cartouche par branche (temps, cap, distance)
  function routeMarks(b, every = 5) {
    const ticks = [], boxes = [];
    let t0 = 0;
    b.legs.forEach((lg, i) => {
      const dur = lg.dist / lg.gs * 60;
      for (let m = Math.ceil((t0 + 0.01) / every) * every; m < t0 + dur - 0.5; m += every) {
        ticks.push({ p: destPt(lg.a, lg.tc, (m - t0) / 60 * lg.gs), tc: lg.tc, min: m, major: m % 10 === 0 });
      }
      boxes.push({ p: destPt(lg.a, lg.tc, lg.dist / 2), tc: lg.tc, leg: i, l1: `${lg.from} > ${lg.to}`, l2: `${lg.min}'  Cm ${r3(lg.hm)}°`, l3: `${lg.dist.toFixed(0)} NM  Vs ${Math.round(lg.gs)} kt` });
      t0 += dur;
    });
    return { ticks, boxes };
  }

  function drawRoute(b, layer, editable) {
    const routeLayer = layer;
    const shown = new Set();
    b.legs.forEach((lg) => lg.airspaces.forEach((s) => {
      if (shown.has(s) || s.kind === 'SIV') return; shown.add(s);
      L.polygon(s.poly, { color: '#64d2ff', weight: 1, fillOpacity: .05, dashArray: '4 4' })
        .bindTooltip(`<b>${esc(s.name)}</b> (${esc(s.cls)})<br>${esc(s.lower)} – ${esc(s.upper)}<br>${esc(s.call)} ${esc(s.freq)}`, { className: 'tip', sticky: true }).addTo(routeLayer);
    }));
    b.zones.filter((x) => x.crossed || x.z.rtba || x.z.type === 'P').forEach((x) => {
      L.polygon(x.z.poly, { color: x.z.rtba ? '#ff3b30' : x.z.type === 'P' ? '#ff2d55' : x.z.type === 'D' ? '#ff9f0a' : '#bf5af2', weight: 1.5, fillOpacity: .14 })
        .bindTooltip(`<b>${esc(x.z.id)} ${esc(x.z.name)}</b><br>${esc(x.z.lower)} – ${esc(x.z.upper)}`, { className: 'tip', sticky: true }).addTo(routeLayer);
    });
    L.polyline(b.pts, { color: '#ff2bd6', weight: 4, opacity: .95 }).addTo(routeLayer);
    const mk = routeMarks(b);
    mk.ticks.forEach((t) => {
      const half = t.major ? 1.6 : 1;
      L.polyline([destPt(t.p, t.tc - 90, half), destPt(t.p, t.tc + 90, half)], { color: '#ff2bd6', weight: t.major ? 3 : 2, interactive: false }).addTo(routeLayer);
      if (t.major) L.marker(destPt(t.p, t.tc + 90, 2.6), { interactive: false, icon: L.divIcon({ className: 'tick-label', html: `${t.min}'`, iconSize: [26, 12], iconAnchor: [13, 6] }) }).addTo(routeLayer);
    });
    mk.boxes.forEach((x) => L.marker(destPt(x.p, x.tc + 90, 4), { icon: L.divIcon({ className: 'leg-box', html: `<b>${esc(x.l2)}</b><br>${esc(x.l3)}`, iconSize: null }) })
      .bindTooltip(esc(x.l1), { className: 'tip', direction: 'top' }).addTo(routeLayer));
    if (b.altLeg) { const a = A.aptByIcao[b.altLeg.to]; L.polyline([b.pts[b.pts.length - 1], [a.la, a.lo]], { color: '#ff2bd6', weight: 2, dashArray: '6 6' }).addTo(routeLayer); }
    const last = b.pts.length - 1;
    b.pts.forEach((p, i) => {
      const dt = b.ids[i].startsWith('DT'), fixed = i === 0 || i === last;
      if (editable && !fixed) {
        L.marker(p, { draggable: true, icon: L.divIcon({ className: 'wp-drag', html: '', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 500 })
          .bindTooltip(`${esc(b.ids[i])} <span style="opacity:.7">(glisser pour déplacer)</span>`, { permanent: true, direction: 'right', className: 'tip' })
          .on('dragend', (e) => editRoute(b, i, e.target.getLatLng(), false)).addTo(routeLayer);
      } else {
        L.circleMarker(p, { radius: dt ? 4 : 6, color: '#fff', weight: 2, fillColor: dt ? '#ffd34d' : '#ff2bd6', fillOpacity: 1 })
          .bindTooltip(b.ids[i], { permanent: true, direction: 'right', className: 'tip' }).addTo(routeLayer);
      }
    });
    if (editable) b.legs.forEach((lg, i) => {   // poignées au milieu des branches : glisser pour ajouter un point
      L.marker(destPt(lg.a, lg.tc, lg.dist / 2), { draggable: true, icon: L.divIcon({ className: 'wp-add', html: '+', iconSize: [14, 14], iconAnchor: [7, 7] }) })
        .bindTooltip('Glisser pour ajouter un point tournant', { className: 'tip', direction: 'top' })
        .on('dragend', (e) => editRoute(b, i, e.target.getLatLng(), true)).addTo(routeLayer);
    });
  }
  // Modification de la route à la souris (8) : le point déplacé devient un point libre « lat/lon » dans les points tournants
  function editRoute(b, i, ll, insert) {
    const tok = `${ll.lat.toFixed(4)}/${ll.lng.toFixed(4)}`;
    const user = b.userIds.map(tokenOf);
    // position dans la liste utilisateur : dernier point utilisateur à l'indice <= i
    let u = 0; for (let k = 0; k <= i; k++) { const j = b.userIds.indexOf(b.ids[k]); if (j >= 0) u = j; }
    const isUser = !insert && b.userIds.includes(b.ids[i]);
    if (isUser) user[u] = tok; else user.splice(u + 1, 0, tok);
    const mid = user.slice(1, -1);
    const go = () => {
      $('#pf-wps').value = mid.join(' ');
      ['#pf-exit', '#pf-entry'].forEach((sel) => { const el = $(sel); if (el) el.value = 'none'; });
      run(false);
    };
    if (!$('#pf-wps')) {
      store.set('form', { ...store.get('form', {}), wps: mid.join(' '), exit: 'none', entry: 'none' });
      openForm();
      if (lastForm) $('#pf-time').value = lastForm.time;
      setTimeout(go, 400);
    } else go();
  }

  function alertsOf(b) {
    const al = [];
    if (b.windErr) al.push(b.windErr + ' Temps calculés sans vent.');
    if (b.elevErr) al.push(b.elevErr);
    if (b.detours.length) al.push(`Route modifiée pour contourner : ${[...new Set(b.detours.map((d) => d.around))].join(', ')} (points ${b.detours.map((d) => d.id).join(', ')}).`);
    if (b.sun && b.eta > new Date(b.sun.set.getTime() + 30 * 6e4)) al.push(`Arrivée après la nuit aéronautique (coucher ${utc(b.sun.set)} + 30 min).`);
    if (b.sunDep && b.depT < new Date(b.sunDep.rise.getTime() - 30 * 6e4)) al.push('Départ avant le jour aéronautique.');
    (b.vigil || []).forEach((v) => al.push(`Vigilance Météo-France ${v.w.some((x) => x.lvl === 3) ? 'ROUGE' : 'ORANGE'} sur ${v.dep} pendant le vol : ${[...new Set(v.w.map((x) => x.ph))].join(', ')}.`));
    if (b.night && b.night.firstDark) al.push(`Nuit aéronautique à partir de ${b.night.firstDark.id} (passage ${utc(b.night.firstDark.eta)}, nuit ${utc(b.night.firstDark.night)}).`);
    if (b.loaded < b.reqFuel) al.push(`Carburant insuffisant : ${b.loaded} L à bord pour ${b.reqFuel} L requis (étape + dégagement + réserve).`);
    if (b.mb.mass > b.f.T.mtow) al.push(`Masse au décollage ${Math.round(b.mb.mass)} kg > MTOW ${b.f.T.mtow} kg.`);
    if (b.mb.cg == null) al.push(`Centrage non calculé : bras de levier ${b.f.T.label} à compléter (manuel de vol / fiche de pesée).`);
    else if (!b.mb.inEnv(b.mb.cg, b.mb.mass)) al.push(`Centrage hors limites au décollage (${b.mb.cg.toFixed(3)} m).`);
    if (b.f.ac.note) al.push(`${b.f.ac.reg} : ${b.f.ac.note}. Performances : ${b.f.T.source || 'log ACB'}.`);
    const tanks = b.f.T.fuel.tanks;
    if ((tanks[0].cap && b.f.fuel > tanks[0].cap) || (tanks[1] && b.f.aux > tanks[1].cap)) al.push('Quantité de carburant supérieure à la capacité des réservoirs.');
    for (const t of [b.depInfo, b.arrInfo]) {
      if (t.rw && t.rw.best.cross != null && b.f.T.speeds['Vw 90° max'] && t.rw.best.cross > b.f.T.speeds['Vw 90° max']) al.push(`${t.id} : vent traversier ${Math.round(t.rw.best.cross)} kt > ${b.f.T.speeds['Vw 90° max']} kt démontré.`);
      if (t.len && t.tod && t.tod > t.len * 0.85) al.push(`${t.id} : distance de décollage estimée ${t.tod} m pour une piste de ${t.len} m — vérifier les performances.`);
    }
    b.rtba.filter((r) => r.conflict && r.below && r.crossed).forEach((r) => al.push(`AZBA : ${r.z.id} ${r.z.name} active pendant le vol (${r.slots.join(', ')} UTC).`));
    if (b.rtba.length && !b.azbaKnown) al.push('Créneaux AZBA non publiés pour cette date : consulter l\'AZBA la veille / le jour même.');
    b.zones.filter((x) => x.crossed && x.below && x.z.type === 'P').forEach((x) => al.push(`Zone interdite encore traversée : ${x.z.id} ${x.z.name} (départ/arrivée à l'intérieur ?).`));
    if (b.wxRoute && b.wxRoute.worst) al.push(`Météo en route : ${WXTXT[b.wxRoute.worst]} (${[...new Set(b.wxRoute.pts.flatMap((p) => p.why))].slice(0, 4).join(', ')}).`);
    if (b.gramet && !b.gramet.err && b.gramet.icing) al.push(`GRAMET : givrage probable près de ${b.f.ft} ft (nuage entre 0 et -15 °C) — vol VFR hors nuages impératif, prévoir une altitude plus basse.`);
    if (b.gramet && !b.gramet.err && b.gramet.storm) al.push('GRAMET : instabilité / orages possibles sur le trajet (voir TEMSI).');
    if (b.mountain) b.mountain.warn.forEach((w) => al.push('Montagne : ' + w));
    if (b.vprofile && b.vprofile.conflicts.length) al.push(`Coupe verticale : à ${b.f.ft} ft la route pénètre ${b.vprofile.conflicts.map((c) => c.name).slice(0, 4).join(', ')} — clairance ou changement d'altitude.`);
    if (b.legs.some((l) => l.safe && l.safe.alt > b.f.ft)) al.push(`Altitude de croisière ${b.f.ft} ft inférieure à l'alti sécu de ${b.legs.filter((l) => l.safe && l.safe.alt > b.f.ft).map((l) => `${l.from}-${l.to} (${l.safe.alt} ft)`).join(', ')}.`);
    return al;
  }

  function summaryHtml(b, sfx = '') {
    const al = alertsOf(b);
    const nt = b.night;
    return `
      ${changesHtml(b)}
      <div class="row" style="margin:6px 0"><button class="btn" id="pf-update${sfx}">🔄 Mettre à jour (mêmes paramètres)</button><button class="btn" id="pf-ics${sfx}">📅 Rappels J-1 / J</button><button class="btn" id="pf-gps${sfx}">📍 Mode en vol (GPS)</button><button class="btn" id="pf-share${sfx}">🔗 Partager</button></div>
      <h4>Route ${b.ids.join(' → ')}</h4>
      <p class="meta">${esc(b.f.ac.reg)} ${esc(b.f.T.label)} · ${esc(b.f.rg.name)} (${b.f.tas} kt, ${b.f.ff} L/h) · ${b.f.ft} ft</p>
      <table class="legs"><tr><th>Branche</th><th>Alt. séc.</th><th>Rm</th><th>Dist</th><th>Vent</th><th>Cm</th><th>Tps</th><th>Carb.</th></tr>
      ${b.legs.map((l) => `<tr><td>${l.from}→${l.to}</td><td>${l.safe ? l.safe.alt : '–'}</td><td>${r3(l.tm)}°</td><td>${l.dist.toFixed(0)}</td>
        <td>${l.wind ? `${r3(l.wind.dir)}/${Math.round(l.wind.spd)}` : '–'}</td><td>${r3(l.hm)}°</td><td>${l.min}'</td><td>${l.fuel} L</td></tr>`).join('')}
      <tr><th>Total</th><th></th><th></th><th>${b.totDist.toFixed(0)}</th><th></th><th></th><th>${hhmm(b.totMin)}</th><th>${b.totFuel} L</th></tr></table>
      <p class="meta">Arrivée estimée ${utc(b.eta)} · requis ${b.reqFuel} L (étape ${b.totFuel} + dégagement ${b.altLeg ? b.altLeg.fuel : 0} + réserve ${b.resFuel}) · à bord ${b.loaded} L.
        Masse décollage ${Math.round(b.mb.mass)} kg / ${b.f.T.mtow} kg, centrage ${b.mb.cg != null ? b.mb.cg.toFixed(3) + ' m' : 'à calculer (bras de levier inconnus)'}.</p>
      ${nt ? `<p class="meta">☀️ Coucher du soleil à ${esc(b.f.arr)} ${utc(nt.set)} · nuit aéronautique ${utc(nt.night)} · <b>dernier décollage possible ${utc(nt.latestDep)}</b> pour arriver de jour.</p>` : ''}
      ${nt && nt.firstDark ? `<div class="warn">🌙 Il fera nuit aéronautique à partir de <b>${esc(nt.firstDark.id)}</b> (passage ${utc(nt.firstDark.eta)}, nuit aéro sur place ${utc(nt.firstDark.night)}) : ${nt.pts.filter((x) => x.dark).map((x) => esc(x.id)).join(', ')} de nuit. VFR de nuit = qualification requise.</div>` : ''}
      ${al.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('') || '<div class="okk">Aucune alerte majeure détectée automatiquement.</div>'}
      ${azbaHtml(b)}
      ${mountainHtml(b)}
      <h4>Météo le long de la route (prévision à l'heure de passage)</h4>
      ${b.wxRoute && b.wxRoute.pts ? `<div class="wxbar">${b.wxRoute.pts.map((p) => `<span style="background:${WXCOL[p.level]}" title="${esc(utc(p.at))} · ${esc(WXTXT[p.level])}${p.why.length ? ' : ' + esc(p.why.join(', ')) : ''} · nuages bas ${p.low ?? '?'} % · base ~${p.baseAgl ?? '?'} ft sol · visi ${p.vis != null ? Math.round(p.vis / 1000) + ' km' : '?'}"></span>`).join('')}</div>
        <p class="meta">${WXTXT[b.wxRoute.worst]} sur l'ensemble du trajet${b.wxRoute.worst ? ' — ' + esc([...new Set(b.wxRoute.pts.flatMap((p) => p.why))].slice(0, 5).join(', ')) : ''}. Survole les pastilles pour le détail.</p>` : `<p class="meta">Indisponible (${esc((b.wxRoute && b.wxRoute.err) || '?')}).</p>`}
      <h4>Coupe verticale</h4>
      ${profileSvg(b.vprofile, b)}
      ${b.vprofile && b.vprofile.conflicts.length ? `<div class="warn">À ${b.f.ft} ft, la route entre dans : ${esc(b.vprofile.conflicts.map((c) => c.name).join(', '))}.</div>` : ''}
      <h4>GRAMET — coupe météo de la route</h4>
      ${b.gramet && !b.gramet.err ? `<canvas id="pf-gramet${sfx}" class="gramet-cv" width="1000" height="470"></canvas>` : ''}
      <p class="meta">${grametSummary(b.gramet, b)} Modèle Open-Meteo à l'heure de passage.</p>
      <div class="row">${b.gramet && !b.gramet.err ? `<button class="btn" id="pf-gramet-big${sfx}">🔍 Agrandir</button>` : ''}<a class="btn" href="${esc(ogimetUrl(b))}" target="_blank" rel="noopener">GRAMET Ogimet (GFS)</a><a class="btn" href="https://aviation.meteo.fr" target="_blank" rel="noopener">TEMSI / WINTEM (aviation.meteo.fr)</a></div>
      <h4>Exporter la route</h4>
      <div class="row"><button class="btn" id="pf-gpx${sfx}">GPX (SkyDemon, Garmin, etc.)</button><button class="btn" id="pf-fpl${sfx}">Garmin .fpl (ForeFlight, Garmin Pilot)</button></div>
      <h4>Fréquences en route</h4>
      ${b.legs.map((l) => `<p class="meta" style="margin:2px 0"><b>${l.from}→${l.to}</b> : ${l.airspaces.map((s) => `${esc(s.name)} ${esc(s.freq)}`).join(' · ') || 'classe G (A/A 123.500 / SIV)'}</p>`).join('')}`;
  }

  // ================================================================== LOG EXCEL (modèle ACB rempli tel quel)
  // Le classeur d'origine (formules, mise en forme, graphiques de centrage) est conservé : seules les cellules
  // de saisie sont remplies. Excel recalcule tout à l'ouverture.
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const colNum = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const splitRef = (ref) => { const m = ref.match(/^([A-Z]+)(\d+)$/); return [m[1], +m[2]]; };
  function sheetApi(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const sd = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    const rowEl = (r) => {
      let prev = null;
      for (const el of sd.getElementsByTagNameNS(NS, 'row')) {
        const n = +el.getAttribute('r');
        if (n === r) return el;
        if (n > r) { prev = el; break; }
      }
      const el = doc.createElementNS(NS, 'row'); el.setAttribute('r', r);
      sd.insertBefore(el, prev); return el;
    };
    const cellEl = (ref, create = true) => {
      const [c, r] = splitRef(ref); const row = rowEl(r); let before = null;
      for (const el of row.getElementsByTagNameNS(NS, 'c')) {
        const [cc] = splitRef(el.getAttribute('r'));
        if (cc === c) return el;
        if (colNum(cc) > colNum(c)) { before = el; break; }
      }
      if (!create) return null;
      const el = doc.createElementNS(NS, 'c'); el.setAttribute('r', ref); row.insertBefore(el, before); return el;
    };
    const clearChildren = (el) => { while (el.firstChild) el.removeChild(el.firstChild); el.removeAttribute('t'); };
    return {
      doc,
      get(ref) { const el = cellEl(ref, false); if (!el) return null; const f = el.getElementsByTagNameNS(NS, 'f')[0]; return f ? '=' + f.textContent : (el.textContent || null); },
      isFormula(ref) { const el = cellEl(ref, false); return !!(el && el.getElementsByTagNameNS(NS, 'f')[0]); },
      set(ref, v) {
        const el = cellEl(ref); clearChildren(el);
        if (v === null || v === undefined || v === '') return;
        if (typeof v === 'number' && isFinite(v)) { const x = doc.createElementNS(NS, 'v'); x.textContent = String(v); el.appendChild(x); return; }
        el.setAttribute('t', 'inlineStr');
        const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't');
        t.setAttribute('xml:space', 'preserve'); t.textContent = String(v); is.appendChild(t); el.appendChild(is);
      },
      formula(ref, f) { const el = cellEl(ref); clearChildren(el); const x = doc.createElementNS(NS, 'f'); x.textContent = f.replace(/^=/, ''); el.appendChild(x); },
      xml() { return new XMLSerializer().serializeToString(doc); },
    };
  }
  const short = (s, n = 22) => (s || '').length > n ? s.slice(0, n) : (s || '');
  function vacFreqShort(v) {
    return ((v && v.freqs) || []).map((l) => {
      const m = l.match(/^([A-Z/]+)\s*:\s*(?:([A-ZÀ-Ü' -]+?)\s+(?:Approche|Tour|Info|Sol)\S*\s+)?.*?(\d{3}\.\d{2,3})/);
      return m ? `${m[2] ? m[2].trim().slice(0, 10) + ' ' : ''}${m[1]} ${m[3]}` : l.slice(0, 22);
    });
  }
  const aspShort = (s) => {
    let c = (s.call || s.name).replace(/INFORMATION/, 'INFO');
    const info = c.match(/([A-ZÀ-Ü'-]+ INFO)$/);
    if (info) c = info[1]; else c = c.replace(/^APP /, '');
    return `${c.slice(0, 18)} ${String(s.freq).split(' / ')[0]}`;
  };
  async function renameSheet(zip, oldName, newName) {
    const wbx = await zip.file('xl/workbook.xml').async('string');
    zip.file('xl/workbook.xml', wbx.replace(`<sheet name="${oldName}"`, `<sheet name="${newName}"`).split(`'${oldName}'!`).join(`'${newName}'!`));
    for (const p of Object.keys(zip.files).filter((n) => /^xl\/(charts|worksheets)\/[^/]+\.xml$/.test(n))) {
      const x = await zip.file(p).async('string');
      if (x.includes(`'${oldName}'!`)) zip.file(p, x.split(`'${oldName}'!`).join(`'${newName}'!`));
    }
  }

  async function buildXlsx(b, opts = {}) {
    if (!window.JSZip) throw new Error('Bibliothèque JSZip absente.');
    const [buf, meta] = await Promise.all([
      fetch('data/template/log_nav_acb.xlsx').then((r) => { if (!r.ok) throw new Error('modèle Excel introuvable'); return r.arrayBuffer(); }),
      fetch('data/template/log_meta.json').then((r) => r.json()),
    ]);
    const zip = await JSZip.loadAsync(buf);
    const T = b.f.T, ac = b.f.ac, reg = ac.reg;
    const layoutName = T.sheet || 'F-XXXX';
    const own = meta.sheets[ac.baseReg] && meta.sheets[ac.baseReg].legs.length ? ac.baseReg : layoutName;
    const M = meta.sheets[own];
    const generic = !meta.sheets[ac.baseReg] || own !== ac.baseReg;
    let sh = sheetApi(await zip.file(M.path).async('string'));

    // ---- en-tête, date, étape
    const date = b.depT.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
    sh.set('N5', `${date}  ${utc(b.depT)}`); sh.set('J3', date);
    sh.set('E34', reg);
    sh.set('N6', b.f.dep); sh.set('O6', b.f.arr); sh.set('P6', '');
    if (b.f.pil) sh.set('R5', short(b.f.pil, 14));

    // ---- masses (cellules propres à chaque feuille)
    const m = M.mass;
    sh.set('H5', ac.empty); sh.set('I5', typeof ac.arm === 'number' ? ac.arm : null);
    sh.set(m.pilot, b.f.m1); sh.set(m.copilot, b.f.m2);
    (m.pax || []).forEach((c, i) => sh.set(c, i === 0 ? b.f.m3 : 0));
    if (m.bag) sh.set(m.bag, b.f.m4);
    if (m.fuel) sh.set(m.fuel, b.f.fuel);
    if (m.aux) sh.set(m.aux, b.f.aux || 0);
    sh.set('H34', b.f.ff); sh.set('J34', Math.round(b.f.tas * 1.852 * 10) / 10);
    sh.set('E37', short(b.f.rg.name, 24)); sh.set('G37', ''); sh.set('H37', b.f.tas); sh.set('I37', 'kt');

    // ---- avion hors flotte du modèle : on adapte la feuille DR400/120 (type, MTOW, centrage, perfs)
    if (generic && T.sheet === 'F-XXXX' && ac.type !== 'DR400-120') {
      sh.set('E35', T.label); sh.set('E15', T.mtow);
      const armCells = [['I6', T.arms.pilot], ['I7', T.arms.copilot], ['I8', T.arms.pax], ['I9', T.arms.pax], ['I10', T.arms.bag], ['I11', T.fuel.tanks[0].arm]];
      armCells.forEach(([c, v]) => sh.set(c, typeof v === 'number' ? v : null));
      sh.formula('H11', `=G11*${T.fuel.density}`);
      const env = T.envelope || [];
      for (let i = 0; i < 5; i++) { sh.set(`H${18 + i}`, env[i] ? env[i][0] : null); sh.set(`I${18 + i}`, env[i] ? env[i][1] : null); }
      for (let r = 41; r <= 52; r++) ['G', 'H', 'I', 'J'].forEach((c) => sh.set(`${c}${r}`, r === 41 || r === 42 ? null : null));
      sh.set('G42', T.takeoff ? `${T.takeoff.hard} m (dur)` : 'voir manuel de vol');
      for (let r = 56; r <= 59; r++) ['G', 'H', 'I', 'J'].forEach((c) => sh.set(`${c}${r}`, null));
      sh.set('M47', `${T.label} : Ch = ${b.f.ff} l/h,`); sh.set('M49', `soit 1 litre <==> ${T.minPerLitre} mn`);
      sh.set('U50', T.minPerLitre);
      const sp = T.speeds;
      const perf = { 94: T.fuel.tanks[0].cap, 95: sp.VSO, 96: sp['V finesse max'], 99: T.takeoff ? T.takeoff.hard : null, 101: sp.VR, 102: sp.Vx, 103: sp.Vy, 111: sp.VNE, 112: sp.VNO, 113: sp.VFE, 114: sp.Vapp || null, 116: null, 118: sp['Vw 90° max'] };
      Object.entries(perf).forEach(([r, v]) => sh.set(`Q${r}`, v == null ? '?' : v));
      sh.set('S99', T.takeoff && T.takeoff.grass ? T.takeoff.grass : null);
      [107, 108, 109].forEach((r, i) => { const g = T.regimes[i]; sh.set(`N${r}`, g ? g.name : null); sh.set(`Q${r}`, g ? g.tas : null); sh.set(`S${r}`, null); sh.set(`U${r}`, g ? g.ff : null); });
      sh.set('A63', `Données ${T.label} : ${short(T.source || '', 90)} — À VÉRIFIER (manuel de vol)`);
    }

    // ---- effacer l'exemple (route PAU…) de la zone du log
    for (let r = 9; r < M.tot; r++) {
      ['M', 'N', 'O', 'Q', 'U'].forEach((c) => sh.set(`${c}${r}`, null));
      if (!sh.isFormula(`P${r}`)) sh.set(`P${r}`, null);
    }

    // ---- points et branches
    let legs = b.legs.slice(), pts = b.ids.slice(), coords = b.pts.slice();
    const slots = M.legs.length;
    const warn = [];
    if (legs.length > slots) {   // trop de branches : on regroupe les points de contournement consécutifs
      warn.push(`Route de ${legs.length} branches : le modèle n'en contient que ${slots}, les dernières sont regroupées.`);
    }
    const elevOf = (id) => { const v = VAC && VAC.data && VAC.data[id]; const a = A.aptByIcao[id]; return v && v.alt != null ? v.alt : (a && a.elev ? +a.elev : null); };
    const nameOf = (id, i) => {
      if (id.startsWith('DT')) return `${id} ${coords[i][0].toFixed(2)}N ${Math.abs(coords[i][1]).toFixed(2)}${coords[i][1] < 0 ? 'W' : 'E'}`;
      const r = resolvePt(id);
      if (r && r.kind === 'vfr') return short(`${id.split('-')[1]} ${r.desc}`, 22);
      const a = A.aptByIcao[id]; return short((a ? a.name : id).toUpperCase(), 16);
    };
    const nUse = Math.min(legs.length, slots);
    const legFreqs = (lg) => lg.airspaces.map(aspShort).concat(lg.ceilings.map((s) => `plafond ${aspShort(s)}`));
    const putFreqs = (rows, list) => rows.forEach((r, i) => sh.set(`U${r}`, list[i] || null));
    for (let k = 0; k < nUse; k++) {
      const lr = M.legs[k], pr = lr - 2;
      // point de départ de la branche
      const id = pts[k];
      sh.set(`M${pr}`, id.startsWith('DT') ? null : elevOf(id));
      const rv = resolvePt(id);
      sh.set(`N${pr}`, nameOf(id, k)); sh.set(`P${pr}`, id.startsWith('DT') ? 'contournement' : (rv && rv.kind === 'vfr' ? rv.ad : id));
      if (k > 0) sh.formula(`Q${pr}`, '=' + M.legs.slice(0, k).map((r) => `P${r}`).join('+'));
      else sh.set(`Q${pr}`, utc(b.depT));
      // branche (si dernière branche disponible et route plus longue, on cumule la distance)
      let lg = legs[k];
      if (k === nUse - 1 && legs.length > nUse) {
        const rest = legs.slice(k);
        lg = { ...lg, dist: rest.reduce((s, l) => s + l.dist, 0), airspaces: [...new Set(rest.flatMap((l) => l.airspaces))], ceilings: [], safe: { alt: Math.max(...rest.map((l) => (l.safe ? l.safe.alt : 0))) } };
      }
      sh.set(`M${lr}`, lg.safe ? lg.safe.alt : null);
      sh.set(`N${lr}`, Math.round(lg.tm) % 360 || 360);
      sh.set(`O${lr}`, Math.round(lg.dist));
      const fr = k === 0 ? vacFreqShort(b.depInfo.v).concat(legFreqs(lg)) : legFreqs(lg);
      putFreqs([pr, pr + 1, lr, lr + 1], fr.length ? fr : ['A/A 123.500']);
    }
    // arrivée
    const ar = M.legs[nUse - 1] + 2;
    sh.set(`M${ar}`, elevOf(b.f.arr)); sh.set(`N${ar}`, nameOf(b.f.arr, coords.length - 1)); sh.set(`P${ar}`, b.f.arr);
    sh.formula(`Q${ar}`, '=' + M.legs.slice(0, nUse).map((r) => `P${r}`).join('+'));
    putFreqs([ar, ar + 1], vacFreqShort(b.arrInfo.v));
    // déroutement
    const dr = M.deg[0];
    if (dr && b.altLeg) {
      sh.set(`M${dr}`, b.legs[b.legs.length - 1].safe ? b.legs[b.legs.length - 1].safe.alt : null);
      sh.set(`N${dr}`, Math.round(b.altLeg.tm) % 360 || 360); sh.set(`O${dr}`, Math.round(b.altLeg.dist));
      sh.set(`M${dr + 2}`, elevOf(b.f.alt)); sh.set(`N${dr + 2}`, nameOf(b.f.alt, 0)); sh.set(`P${dr + 2}`, b.f.alt);
      putFreqs([dr, dr + 1, dr + 2, dr + 3], vacFreqShort(b.altInfo && b.altInfo.v));
    } else if (dr) { sh.set(`P${dr}`, 0); sh.set(`S${dr}`, 0); }

    // ---- cases INFO départ / arrivée (pré-remplies avec le METAR)
    const fillInfo = (box, t) => {
      if (!box) return;
      sh.set(box.ident, t.id);
      ['FLT', 'TBO', 'Birds', 'Para'].forEach((k) => box[k] && sh.set(box[k], null));
      const rwyTxt = t.v && t.v.qfu && t.v.qfu.length ? t.v.qfu.slice(0, 2).map((q) => String(Math.round(+q / 10) || 36).padStart(2, '0')).join('    /    ') : '';
      if (box.RWY) sh.set(box.RWY, rwyTxt || null);
      const mt = t.m;
      if (!mt) return;
      if (box.VW) sh.set(box.VW, mt.wdir != null ? `   ${mt.wdir === 'VRB' ? 'VRB' : r3(mt.wdir)}    /    ${mt.wspd ?? 0}${mt.wgst ? 'G' + mt.wgst : ''}` : null);
      if (box.VISI) sh.set(box.VISI, mt.rawOb.includes('CAVOK') ? '      CAVOK' : (mt.visib != null ? (String(mt.visib).includes('+') ? '9999' : `${Math.round(parseFloat(mt.visib) * 1609)} m`) : null));
      const layers = { FEW: null, SCT: null, BKN: null, OVC: null };
      (mt.clouds || []).forEach((c) => { if (c.cover in layers && !layers[c.cover] && c.base != null) layers[c.cover] = String(Math.round(c.base / 100)).padStart(3, '0'); });
      Object.entries(layers).forEach(([k, v]) => box[k] && sh.set(box[k], v));
      if (box['TT/TD']) sh.set(box['TT/TD'], mt.temp != null ? `      ${mt.temp}    /    ${mt.dewp ?? ''}` : null);
      if (box.QNH && mt.altim != null) sh.set(box.QNH, Math.round(mt.altim));
    };
    fillInfo(M.info[0], b.depInfo); fillInfo(M.info[1], b.arrInfo);

    zip.file(M.path, sh.xml());
    // ---- renommer / activer la feuille
    const wbx0 = await zip.file('xl/workbook.xml').async('string');
    const names = [...wbx0.matchAll(/<sheet name="([^"]+)"/g)].map((x) => x[1]);
    let target = own;
    if (own !== reg) {
      if (names.includes(reg)) await renameSheet(zip, reg, `${reg} (modèle)`.slice(0, 31));
      await renameSheet(zip, own, reg); target = reg;
    }
    let wbx = await zip.file('xl/workbook.xml').async('string');
    const idx = [...wbx.matchAll(/<sheet name="([^"]+)"/g)].map((x) => x[1]).indexOf(target);
    wbx = wbx.replace(/activeTab="\d+"/, `activeTab="${idx}"`).replace(/firstSheet="\d+"/, 'firstSheet="0"');
    zip.file('xl/workbook.xml', wbx);
    const sx = await zip.file(M.path).async('string');
    zip.file(M.path, sx.replace(/<sheetView /, '<sheetView tabSelected="1" '));

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `log_nav_${b.userIds.join('-')}_${reg}_${b.depT.toISOString().slice(0, 10)}.xlsx`;
    if (window.AWW_saveBriefing) await window.AWW_saveBriefing(a.download, blob);
    if (opts.histId) await histSave(opts.histId, a.download, blob);
    document.body.appendChild(a); a.click(); a.remove();
    if (warn.length) $('#pf-out').insertAdjacentHTML('beforeend', `<div class="warn">${esc(warn.join(' '))}</div>`);
    return blob;
  }

  // ================================================================== PDF
  const latin = (s) => String(s ?? '').replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/•/g, '-').replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/ /g, ' ')
    .replace(/←/g, '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, '');

  async function buildPdf(b, progress, opts = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    let W = 297, H = 210, y = 0;
    const M = 10;
    const title = latin(`${b.ids.filter((x) => !x.startsWith('DT')).join(' -> ')}${b.f.alt ? ` (dégt ${b.f.alt})` : ''} · ${b.f.ac.reg} ${b.f.T.label}`);
    const bar = (sub) => {
      doc.setFillColor(0, 102, 153); doc.rect(0, 0, W, 14, 'F'); doc.setTextColor(255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.text(doc.splitTextToSize(latin(sub + ' - ' + title), W - 2 * M - 60)[0], M, 6.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(latin(`Vol du ${b.depT.toLocaleDateString('fr-FR', { timeZone: 'UTC' })} · départ ${utc(b.depT)}${b.f.pil ? ' · pilote ' + b.f.pil : ''}`), M, 11.5);
      doc.text(latin(`Généré le ${b.generated.toISOString().slice(0, 16).replace('T', ' ')}Z`), W - M, 11.5, { align: 'right' });
      doc.setTextColor(0); doc.setFont('helvetica', 'normal');
    };
    let curSub = 'LOG DE NAVIGATION';
    const newPage = (orient, sub) => {
      doc.addPage('a4', orient); W = orient === 'landscape' ? 297 : 210; H = orient === 'landscape' ? 210 : 297;
      curSub = sub; bar(sub); y = 19;
    };
    const ensure = (h) => { if (y + h > H - 12) newPage(W > H ? 'landscape' : 'portrait', curSub); };
    const h2 = (t) => {
      ensure(12); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(0, 80, 130);
      doc.text(latin(t), M, y); y += 1.3; doc.setDrawColor(0, 102, 153); doc.setLineWidth(.35); doc.line(M, y, W - M, y);
      y += 4.5; doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    };
    const para = (t, o = {}) => {
      doc.setFont(o.mono ? 'courier' : 'helvetica', o.bold ? 'bold' : 'normal'); const fs = o.size || (o.mono ? 8 : 9); doc.setFontSize(fs);
      if (o.color) doc.setTextColor(...o.color);
      const lines = doc.splitTextToSize(latin(t), (o.w || (W - 2 * M)) - (o.indent || 0)), lh = fs * 0.42;
      for (const l of lines) { ensure(lh + 1); doc.text(l, (o.x || M) + (o.indent || 0), y); y += lh; }
      y += o.gap ?? 1.4; doc.setTextColor(0);
    };
    const table = (head, body, o = {}) => {
      doc.autoTable({
        startY: o.y || y, head: head ? [head.map(latin)] : undefined, body: body.map((r) => r.map((c) => (c && typeof c === 'object' && !Array.isArray(c)) ? { ...c, content: latin(c.content) } : latin(c))),
        margin: { left: o.x || M, right: o.right ?? M, top: 18 }, tableWidth: o.width || 'auto',
        styles: { fontSize: o.size || 8, cellPadding: o.pad ?? 1.1, overflow: 'linebreak', lineColor: [150, 170, 185], lineWidth: .15 },
        headStyles: { fillColor: [0, 102, 153], fontSize: (o.size || 8) }, theme: 'grid',
        didDrawPage: () => bar(curSub), ...(o.at || {}),
      });
      if (!o.keepY) y = doc.lastAutoTable.finalY + 3.5;
      return doc.lastAutoTable.finalY;
    };

    // ---------------------------------------------------------------- 1. LOG DE NAVIGATION (paysage, inspiré du log ACB)
    progress('PDF : log de navigation…');
    bar('LOG DE NAVIGATION'); y = 18;
    const fmtMetar = (m) => m ? {
      vw: m.wdir != null ? `${m.wdir === 'VRB' ? 'VRB' : r3(m.wdir)}/${m.wspd ?? 0}${m.wgst ? 'G' + m.wgst : ''} kt` : '',
      visi: m.visib != null ? (String(m.visib).includes('+') ? '9999' : `${Math.round(parseFloat(m.visib) * 1609)} m`) : '',
      clouds: (m.clouds || []).map((c) => c.cover + (c.base != null ? String(Math.round(c.base / 100)).padStart(3, '0') : '')).join(' ') || (m.rawOb.includes('CAVOK') ? 'CAVOK' : ''),
      tt: m.temp != null ? `${m.temp}/${m.dewp ?? '?'}` : '', qnh: m.altim != null ? Math.round(m.altim) : '',
    } : { vw: '', visi: '', clouds: '', tt: '', qnh: '' };
    const infoBox = (t, label) => {
      const mm = fmtMetar(t.m), v = t.v || {};
      const atis = (v.freqs || []).find((x) => /^ATIS/.test(x));
      return [
        [{ content: `${label} ${t.id}`, colSpan: 2, styles: { fillColor: [220, 236, 246], fontStyle: 'bold' } }],
        ['INFO', atis ? atis.replace(/^ATIS : /, 'ATIS ') : (t.m && t.m.icaoId !== t.id ? `METAR ${t.m.icaoId}` : '')],
        ['RWY', t.rw ? `QFU ${t.rw.best.qfu}°${t.len ? ` · ${t.len} m${t.grass ? ' herbe' : ''}` : ''}` : ''],
        ['VW', mm.vw], ['VISI', mm.visi], ['Nuages', mm.clouds], ['TT/TD', mm.tt], ['QNH', String(mm.qnh)],
        ['Alt. AD', v.alt != null ? `${v.alt} ft` : ''], ['TDP', (v.tdp || [])[0] || ''],
        ['Carbu', v.escale ? (v.escale.none ? 'aucun' : (v.escale.fuel || []).join(' ')) : ''],
        ['Taxe', (A.feeFor && A.feeFor(t.id) || {}).tarif || ''],
      ];
    };
    const leftW = 62;
    table(null, infoBox(b.depInfo, 'DÉPART'), { x: M, width: leftW, size: 7.5, keepY: true, at: { columnStyles: { 0: { cellWidth: 14, fontStyle: 'bold' } } } });
    const yInfo2 = doc.lastAutoTable.finalY + 3;
    table(null, infoBox(b.arrInfo, 'ARRIVÉE'), { x: M, y: yInfo2, width: leftW, size: 7.5, keepY: true, at: { columnStyles: { 0: { cellWidth: 14, fontStyle: 'bold' } } } });
    const yLeftEnd = doc.lastAutoTable.finalY;

    // tableau principal : points / branches
    const depFreqs = ((b.depInfo.v && b.depInfo.v.freqs) || []).join('\n');
    const arrFreqs = ((b.arrInfo.v && b.arrInfo.v.freqs) || []).join('\n');
    const freqTxt = (lg) => {
      const lines = lg.airspaces.map((s) => `${s.name} (${s.cls}) ${s.lower}-${s.upper} : ${s.call} ${s.freq}`);
      lg.ceilings.forEach((s) => lines.push(`plancher ${s.name} ${s.lower} (${s.call} ${s.freq})`));
      return lines.join('\n') || 'Classe G - A/A 123.500 / SIV';
    };
    let fuelLeft = b.reqFuel;
    const body = [];
    const ptRow = (id, i) => {
      const isDt = id.startsWith('DT'), a = A.aptByIcao[id], vr = !a && !isDt ? resolvePt(id) : null;
      const name = isDt ? `${id} (${b.pts[i][0].toFixed(3)} ${b.pts[i][1].toFixed(3)})` : vr ? `${id} - ${vr.desc}` : `${id}${a ? ' ' + a.name : ''}`;
      const req = `${Math.max(0, fuelLeft)} L`;
      const freqs = i === 0 ? depFreqs : i === b.pts.length - 1 ? arrFreqs : (isDt ? b.detours.find((d) => d.id === id).around ? `contournement ${b.detours.find((d) => d.id === id).around}` : '' : '');
      const hEst = i === 0 ? utc(b.depT) : utc(b.legs[i - 1].eto);
      return ['', { content: name, styles: { fontStyle: 'bold', fillColor: [235, 244, 250] } }, '', '', { content: hEst, styles: { fontStyle: 'bold' } }, '', req, '', freqs];
    };
    b.ids.forEach((id, i) => {
      body.push(ptRow(id, i));
      const lg = b.legs[i];
      if (lg) {
        fuelLeft -= lg.fuel;
        body.push([lg.safe ? String(lg.safe.alt) : '', `Rm ${r3(lg.tm)}°  Cm ${r3(lg.hm)}°  (vent ${lg.wind ? r3(lg.wind.dir) + '/' + Math.round(lg.wind.spd) : '-'}, Vs ${Math.round(lg.gs)})`,
          lg.dist.toFixed(0), `${lg.min}'`, '', '', `${lg.fuel} L`, '', freqTxt(lg)]);
      }
    });
    body.push([{ content: 'Totaux', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } }, b.totDist.toFixed(0), `${b.totMin}'`, utc(b.eta), '', `${b.totFuel} L`, '', `Étape ${b.totFuel} L + dégt ${b.altLeg ? b.altLeg.fuel : 0} L + RF ${b.resFuel} L = ${b.reqFuel} L requis · à bord ${b.loaded} L`]);
    if (b.altLeg) {
      const av = b.altInfo && b.altInfo.v;
      body.push([{ content: 'DÉROUTEMENT', colSpan: 9, styles: { fillColor: [255, 236, 210], fontStyle: 'bold' } }]);
      body.push(['', `${b.f.arr} -> ${b.altLeg.to} : Rm ${r3(b.altLeg.tm)}°`, b.altLeg.dist.toFixed(0), `${b.altLeg.min}'`, '', '', `${b.altLeg.fuel} L`, '', ((av && av.freqs) || []).join('\n')]);
    }
    table(['Alti sécu', 'WPT / route', 'Dist NM', 'Tps vol', 'H est.', 'H réelle', 'Carbu requis', 'Réel', 'Fréquences / espaces traversés'],
      body, {
        x: M + leftW + 3, y: 18, size: 7, pad: .9, at: {
          columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 52 }, 2: { cellWidth: 10, halign: 'center' }, 3: { cellWidth: 11, halign: 'center' }, 4: { cellWidth: 12, halign: 'center' }, 5: { cellWidth: 12 }, 6: { cellWidth: 14, halign: 'center' }, 7: { cellWidth: 10 } },
        },
      });
    y = Math.max(y, yLeftEnd + 4);
    para(`Croisière ${b.f.ft} ft · ${b.f.rg.name} : Vp ${b.f.tas} kt, ${b.f.ff} L/h · Rm/Cm magnétiques (déclinaison ${b.varDeg.toFixed(1)}°). Alti sécu = relief max ±5 NM + 1000 ft (hors obstacles : voir carte). Temps et carburant arrondis comme le log ACB (+${b.f.T.climb.extraMin} min / +${b.f.T.climb.extraFuel} L en 1re branche).`, { size: 7, color: [90, 90, 90] });
    para(`Espaces/fréquences : ${b.aspSource || 'OpenAir FFVP'} + SIV eAIP ENR 2.2 - données non officielles, vérifier sur la carte OACI et les VAC.`, { size: 7, color: [90, 90, 90] });

    // page 2 du log : masse & centrage, performances, carburant
    newPage('landscape', 'LOG DE NAVIGATION - MASSE, CENTRAGE ET PERFORMANCES');
    const mb = b.mb;
    const n3 = (v) => (typeof v === 'number' ? v.toFixed(3) : 'à compléter');
    table(['Élément', 'Masse (kg)', 'Bras (m)', 'Moment'], mb.rows.map((r) => [r[0], r[1].toFixed(0), n3(r[2]), typeof r[2] === 'number' ? (r[1] * r[2]).toFixed(1) : '-']).concat([
      [{ content: 'Total décollage', styles: { fontStyle: 'bold' } }, { content: mb.mass.toFixed(0), styles: { fontStyle: 'bold' } }, { content: n3(mb.cg), styles: { fontStyle: 'bold' } }, mb.mom != null ? mb.mom.toFixed(1) : '-'],
      ['MTOW / marge', `${b.f.T.mtow} / ${Math.round(b.f.T.mtow - mb.mass)}`, mb.cg == null ? (b.f.T.cgLimits ? `limites ${b.f.T.cgLimits.join(' - ')} m` : 'centrage à calculer') : mb.inEnv(mb.cg, mb.mass) ? 'Centrage OK' : 'HORS LIMITES', ''],
      ['Masse à l\'atterrissage (est.)', b.landMass.toFixed(0), '', ''],
    ]), { x: M, width: 125, size: 8, keepY: true });
    const yMb = doc.lastAutoTable.finalY;
    // enveloppe de centrage
    const gx = M + 132, gy = 22, gw = 70, gh = 55;
    const env = b.f.T.envelope || [[0.2, 0], [0.2, b.f.T.mtow], [0.6, b.f.T.mtow], [0.6, 0]], arms = env.map((p) => p[0]), masses = env.map((p) => p[1]).filter((m) => m > 0);
    const aMin = Math.min(...arms) - 0.03, aMax = Math.max(...arms) + 0.03, mMin = Math.min(...masses) - 150, mMax = b.f.T.mtow + 30;
    const X = (a) => gx + (a - aMin) / (aMax - aMin) * gw, Y = (m) => gy + gh - (Math.max(mMin, m) - mMin) / (mMax - mMin) * gh;
    doc.setDrawColor(150); doc.setLineWidth(.2); doc.rect(gx, gy, gw, gh);
    doc.setDrawColor(0, 102, 153); doc.setLineWidth(.6);
    const envPts = env.map((p) => [X(p[0]), Y(p[1])]);
    for (let i = 0; i < envPts.length - 1; i++) doc.line(envPts[i][0], envPts[i][1], envPts[i + 1][0], envPts[i + 1][1]);
    const ptsMb = mb.cg == null ? [] : [[mb.cg, mb.mass, 'TO'], [(mb.mom - b.totFuel * b.f.T.fuel.density * b.f.T.fuel.tanks[0].arm) / b.landMass, b.landMass, 'LDG']];
    ptsMb.forEach(([a, m, l]) => { doc.setFillColor(l === 'TO' ? 220 : 30, l === 'TO' ? 30 : 140, 30); doc.circle(X(a), Y(m), 1.1, 'F'); doc.setFontSize(6.5); doc.text(l, X(a) + 1.5, Y(m) - 1); });
    if (ptsMb.length) doc.line(X(ptsMb[0][0]), Y(ptsMb[0][1]), X(ptsMb[1][0]), Y(ptsMb[1][1]));
    doc.setFontSize(6.5); doc.setTextColor(90);
    doc.text(latin(`Enveloppe de centrage ${b.f.T.label} (bras m / masse kg)`), gx, gy - 1.5);
    doc.text(aMin.toFixed(2), gx, gy + gh + 3); doc.text(aMax.toFixed(2), gx + gw, gy + gh + 3, { align: 'right' });
    doc.text(String(Math.round(mMax)), gx - 1, gy + 2, { align: 'right' }); doc.text(String(Math.round(mMin)), gx - 1, gy + gh, { align: 'right' });
    doc.setTextColor(0);
    // vitesses
    const sp = b.f.T.speeds;
    table(['Vitesses', 'kt'], Object.entries(sp).map(([k, v]) => [k, String(v)]), { x: M + 210, y: 18, width: 67, size: 7.5, keepY: true });
    y = Math.max(yMb, gy + gh + 6, doc.lastAutoTable.finalY) + 4;
    // carburant / autonomie
    const tanks = b.f.T.fuel.tanks;
    const yFuelStart = y;
    table(['Carburant', 'Valeur'], [
      ['Type', b.f.T.fuel.name], ['Capacité', tanks.map((t) => `${t.name} ${t.cap ? t.cap + ' L' : 'à vérifier'}`).join(' + ')],
      ['À bord au départ', `${b.loaded} L (${(b.loaded * b.f.T.fuel.density).toFixed(0)} kg)`],
      ['Étape', `${b.totFuel} L`], ['Dégagement', b.altLeg ? `${b.altLeg.fuel} L (${b.altLeg.to})` : '-'], ['Réserve finale', `${b.resFuel} L (${b.f.res} min)`],
      [{ content: 'Requis', styles: { fontStyle: 'bold' } }, { content: `${b.reqFuel} L`, styles: { fontStyle: 'bold' } }],
      ['Marge', `${b.loaded - b.reqFuel} L, soit ${Math.round((b.loaded - b.reqFuel) / b.f.ff * 60)} min`],
      ['Autonomie totale', hhmm(b.loaded / b.f.ff * 60)], ['Repère', `1 L = ${b.f.T.minPerLitre} min`],
    ], { x: M, width: 110, size: 8, keepY: true });
    const yFuel = doc.lastAutoTable.finalY;
    // performances décollage
    const perfRow = (t) => t ? [t.id, `${t.elev} ft`, `${Math.round(t.temp)}°C`, t.grass ? 'herbe' : 'dur', t.len ? `${t.len} m` : '?', t.tod ? `${t.tod} m` : 'manuel de vol',
      t.rw ? `QFU ${t.rw.best.qfu}° : ${t.rw.best.head != null ? `${t.rw.best.head >= 0 ? 'face' : 'arrière'} ${Math.abs(Math.round(t.rw.best.head))} kt, travers ${Math.round(t.rw.best.cross)} kt` : 'vent ?'}` : '-'] : null;
    table(['Terrain', 'Alt.', 'Temp.', 'Piste', 'Longueur', 'Décollage 15 m (est.)', 'Piste probable / vent'],
      [perfRow(b.depInfo), perfRow(b.arrInfo), perfRow(b.altInfo)].filter(Boolean), { x: M + 115, y: yFuelStart, size: 7.5, keepY: true });
    y = Math.max(yFuel, doc.lastAutoTable.finalY) + 3;
    if (b.f.T.takeoff) para(`${b.f.T.takeoff.note} : ${b.f.T.takeoff.hard} m (dur)${b.f.T.takeoff.grass ? ` / ${b.f.T.takeoff.grass} m (herbe)` : ''}, majorée ~10 % par 1000 ft d'altitude terrain et ~10 % par 10 °C au-dessus de l'ISA (estimation - utiliser les abaques du manuel de vol / DF15).`, { size: 7, color: [90, 90, 90] });
    if (b.f.T.landing) para(`${b.f.T.landing.note} : ${b.f.T.landing.hard} m (dur)${b.f.T.landing.grass ? ` / ${b.f.T.landing.grass} m (herbe)` : ''} (abaques du manuel de vol).`, { size: 7, color: [90, 90, 90] });

    // ---------------------------------------------------------------- 2. BRIEFINGS DÉPART / ARRIVÉE (portrait)
    const briefTerrain = (t, kind) => {
      newPage('portrait', `BRIEFING ${kind}`);
      const v = t.v || {};
      h2(`${kind} : ${t.id} ${t.a ? t.a.name : ''}`);
      if (!t.v) para('Carte VAC non disponible (terrain privé, ULM ou hors AIP) : se renseigner auprès de l\'exploitant.', { color: [170, 40, 0] });
      const m = t.m;
      const when = kind === 'DÉPART' ? `Départ prévu ${utc(b.depT)}${b.sunDep ? ` (lever du soleil ${utc(b.sunDep.rise)})` : ''}` : `Arrivée estimée ${utc(b.eta)}${b.sun ? ` (coucher du soleil ${utc(b.sun.set)}, nuit aéro ${utc(new Date(b.sun.set.getTime() + 30 * 6e4))})` : ''}`;
      para(when, { bold: true });
      if (m) para(`${m.icaoId !== t.id ? `METAR le plus proche (${m.icaoId}) : ` : ''}${m.rawOb}`, { mono: true });
      const taf = A.tafs[t.id] || (m && A.tafs[m.icaoId]);
      if (taf) para(taf.rawTAF, { mono: true, size: 7.5 });
      const rows = [];
      rows.push(['Statut', [v.cap ? 'Ouvert à la CAP' : null, v.restreint ? 'Usage restreint' : null, v.prive ? 'Usage privé' : null, v.vfr ? 'Atterrissage à vue' : null].filter(Boolean).join(' · ') || '-']);
      rows.push(['Altitude terrain', v.alt != null ? `${v.alt} ft (QNH-QFE ≈ ${v.hpa} hPa)` : '-']);
      rows.push(['Pistes', [(v.qfu || []).map((q) => q + '°').join(' / '), (v.rwy || []).join(', '), (v.surface || []).join(' / ')].filter(Boolean).join(' · ') || '-']);
      if (t.rw) rows.push(['Piste probable', `QFU ${t.rw.best.qfu}° — ${t.rw.best.head != null ? `vent de ${t.rw.best.head >= 0 ? 'face' : 'arrière'} ${Math.abs(Math.round(t.rw.best.head))} kt, traversier ${Math.round(t.rw.best.cross)} kt ${b.f.T.speeds['Vw 90° max'] ? ` (max démontré ${b.f.T.speeds['Vw 90° max']} kt)` : ''}` : 'vent inconnu'}`]);
      rows.push(['Fréquences', (v.freqs || []).join('\n') || 'A/A 123.500 si non publiée']);
      rows.push(['Tour de piste', (v.tdp || []).join(' ; ') || 'voir VAC']);
      rows.push(['Moyens radio', (v.nav || []).join(', ') || '-']);
      rows.push(['Espaces autour (VAC)', (v.espaces || []).join('\n') || '-']);
      rows.push(['Obstacles (VAC)', (v.obst || []).join('\n') || '-']);
      const es = v.escale || {}, fee = A.feeFor ? A.feeFor(t.id) : null;
      rows.push(['Carburant', es.none ? 'Pas de carburant' : ((es.fuel || []).join(' · ') || 'voir VAC') + (es.texte ? `\n${es.texte}` : '')]);
      rows.push(['Paiement', (es.pay || []).join(' · ') || 'non précisé']);
      rows.push(['Taxe d\'atterrissage', fee ? `${fee.tarif}${fee.note ? ' - ' + fee.note : ''} (${fee.source || 'tableau du club'}${fee.maj ? ', ' + fee.maj : ''})` : 'non renseignée - voir airfield.directory / aeroPS / exploitant']);
      if (es.exploitant || (es.tel_ad || []).length) rows.push(['Exploitant', [es.exploitant, ...(es.tel || [])].filter(Boolean).join(' · ')]);
      if (kind === 'DÉPART') {
        rows.push(['Décollage (estimé)', `${t.tod ? t.tod + ' m' : 'non disponible - voir manuel de vol'} (15 m) pour ${t.len ? t.len + ' m de piste' : 'piste ?'} ${t.grass ? '(herbe)' : '(dur)'} — masse ${Math.round(b.mb.mass)} kg`]);
        const l0 = b.legs[0];
        const vx = resolvePt(l0.to);
        if (vx && vx.kind === 'vfr') rows.push(['Point de sortie', `${l0.to} : ${vx.desc} (Rm ${r3(l0.tm)}°, ${l0.dist.toFixed(1)} NM)`]);
        const vp = vfrOf(t.id); if (vp.length) rows.push(['Points VFR publiés', vp.map((p) => `${p.id} : ${p.desc}`).join('\n')]);
        rows.push(['Sortie / 1re branche', `Rm ${r3(l0.tm)}° vers ${l0.to}, ${l0.dist.toFixed(0)} NM, montée vers ${b.f.ft} ft${b.f.T.speeds.Vy ? ` (Vy ${b.f.T.speeds.Vy} kt)` : ''}, alti sécu ${l0.safe ? l0.safe.alt + ' ft' : '?'}`]);
        rows.push(['Premiers contacts', l0.airspaces.slice(0, 4).map((s) => `${s.name} : ${s.call} ${s.freq}`).join('\n') || 'Classe G - SIV / A/A']);
      } else {
        const lN = b.legs[b.legs.length - 1];
        const ve = resolvePt(lN.from);
        if (ve && ve.kind === 'vfr') rows.push(['Point d\'entrée', `${lN.from} : ${ve.desc} — puis Rm ${r3(lN.tm)}°, ${lN.dist.toFixed(1)} NM jusqu'au terrain`]);
        const vp = vfrOf(t.id); if (vp.length) rows.push(['Points VFR publiés', vp.map((p) => `${p.id} : ${p.desc}`).join('\n')]);
        rows.push(['Arrivée par', `Rm ${r3(lN.tm)}° depuis ${lN.from} — descendre pour l'altitude du tour de piste (${(v.tdp || [])[0] || 'voir VAC'})`]);
        rows.push(['Derniers contacts', lN.airspaces.slice(-4).map((s) => `${s.name} : ${s.call} ${s.freq}`).join('\n') || 'Classe G - SIV / A/A']);
        rows.push(['Carburant à l\'arrivée', `${b.loaded - b.totFuel} L estimés (réserve + dégagement requis : ${b.resFuel + (b.altLeg ? b.altLeg.fuel : 0)} L)`]);
        rows.push(['Vitesses d\'approche', Object.entries(b.f.T.speeds).filter(([k]) => /Vapp|Vatt/.test(k)).map(([k, s]) => `${k} : ${s} kt`).join(' · ')]);
        if (b.altLeg) rows.push(['Dégagement', `${b.altLeg.to} : Rm ${r3(b.altLeg.tm)}°, ${b.altLeg.dist.toFixed(0)} NM, ${b.altLeg.min} min, ${b.altLeg.fuel} L`]);
      }
      table(['Élément', 'Information'], rows, { size: 8, at: { columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' } } } });
      const own = kind === 'DÉPART' ? t.cons.dep : t.cons.arr;
      h2(`Consignes de la VAC pour le ${kind.toLowerCase()}`);
      if (own.length) own.forEach((s) => para('- ' + s, { size: 8.5, gap: .6 })); else para('Pas de consigne spécifique extraite : lire la VAC.', { size: 8.5 });
      if (t.cons.gen.length) { h2('Consignes générales et dangers (VAC)'); t.cons.gen.forEach((s) => para('- ' + s, { size: 8.2, gap: .5 })); }
      if (t.infos.length) { h2('Informations pratiques (VAC)'); t.infos.forEach((s) => para('- ' + s, { size: 7.8, gap: .4 })); }
      if (t.notams.length) {
        h2(`NOTAM ${t.id} (${t.notams.length})`);
        table(['Réf.', 'Validité', 'Texte'], t.notams.map((n) => [n.ref, `${A.fmtT(n.from)}\n${A.fmtT(n.to)}`, n.efr || n.e || '']), { size: 7, at: { columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 24 } } } });
      } else para(`Aucun NOTAM ${t.id} sur la période du vol.`, { size: 8 });
      const cams = kind === 'DÉPART' ? b.cams.dep : b.cams.arr;
      if (cams.length) { h2('Webcams à proximité'); cams.forEach((c) => para(`- ${c.s.n} (${c.d.toFixed(0)} km) : ${c.s.u}`, { size: 7.5, gap: .3 })); }
      if (t.v) para(`VAC officielle (cycle ${b.vacCycle || '?'}) : ${t.v.url}`, { size: 7.5, color: [0, 80, 160] });
    };
    try {
      const nm = await renderNavMap(b, progress);
      if (nm) {
        newPage('landscape', 'CARTE DE NAVIGATION - OACI-VFR 1/500 000');
        const maxW = W - 2 * M, maxH = H - 30;
        const sc = Math.min(maxW / nm.w, maxH / nm.h);
        doc.addImage(nm.url, 'JPEG', M + (maxW - nm.w * sc) / 2, 18, nm.w * sc, nm.h * sc);
        doc.setFontSize(6.5); doc.setTextColor(90);
        doc.text(latin(`Fond : carte OACI-VFR © IGN / SIA (édition en vigueur sur la Géoplateforme) · repères toutes les 5 min de vol (étiquette toutes les 10 min) · cartouches : temps, cap magnétique, distance, vitesse sol par branche.`), M, H - 9);
        doc.setTextColor(0);
      }
    } catch (e) { console.warn('carte OACI', e); }
    if (b.gramet && !b.gramet.err) {
      try {
        const cv = document.createElement('canvas'); cv.width = 2000; cv.height = 1000; drawGramet(cv, b.gramet, b);
        newPage('landscape', 'GRAMET - COUPE MÉTÉO DE LA ROUTE');
        const gw = W - 2 * M, gh = gw * cv.height / cv.width;
        doc.addImage(cv.toDataURL('image/jpeg', .9), 'JPEG', M, 18, gw, Math.min(gh, H - 42));
        doc.setFontSize(8.5); doc.text(doc.splitTextToSize(latin(grametSummary(b.gramet, b)), W - 2 * M), M, H - 19);
        doc.setFontSize(6.5); doc.setTextColor(90);
        doc.text(latin(`Prévision modèle Open-Meteo (niveaux 1000 à 500 hPa) à l'heure de passage · givrage = nuage ou HR >= 90 % entre 0 et -15 °C · indicatif : à confronter aux TEMSI / WINTEM. GRAMET officiel : ${ogimetUrl(b)}`), M, H - 9, { maxWidth: W - 2 * M });
        doc.setTextColor(0);
      } catch (e) { console.warn('gramet pdf', e); }
    }
    progress('PDF : briefings départ / arrivée…');
    briefTerrain(b.depInfo, 'DÉPART');
    briefTerrain(b.arrInfo, 'ARRIVÉE');
    if (b.altInfo) briefTerrain(b.altInfo, 'DÉGAGEMENT');

    // ---------------------------------------------------------------- 3. ROUTE, MÉTÉO, NOTAM, SUP AIP, AZBA
    newPage('portrait', 'BRIEFING ROUTE');
    const al = alertsOf(b);
    h2('Points d\'attention');
    if (al.length) al.forEach((a) => para('- ' + a, { color: [170, 40, 0] })); else para('Aucune alerte majeure détectée automatiquement.');
    if (b.night) para(`Coucher du soleil à ${b.f.arr} ${utc(b.night.set)} · nuit aéronautique ${utc(b.night.night)} · dernier décollage possible ${utc(b.night.latestDep)} pour arriver de jour.`, { size: 8.5, bold: true });
    if (b.changes) {
      h2(`Changements depuis le briefing du ${b.changes.since.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
      if (b.changes.list.length) b.changes.list.forEach((x) => para('- ' + x.t, { size: 8, color: x.k === 'add' ? [170, 40, 0] : [40, 90, 40] }));
      else para('Aucun changement détecté (NOTAM, AZBA, météo, alertes).', { size: 8 });
    }
    if (b.mountain) {
      h2('Vol en montagne');
      table(['Branche', 'Relief max', 'Franchir à', 'Vent crêtes', 'Isotherme 0°C', 'Cols proches', 'Dégagements en vallée'], b.mountain.legs.map((x) => [
        `${x.lg.from}-${x.lg.to}`, `${x.hi.ft} ft`, `${x.minAlt} ft`, x.wind ? `${r3(x.wind.dir)}/${Math.round(x.wind.spd)} kt` : '-', x.iso0 != null ? `${Math.round(x.iso0 / 100) * 100} ft` : '-',
        x.cols.map((c) => `${c.n} ${c.ft} ft`).join('\n') || '-', x.valley.map((v) => `${v.a.icao} ${v.a.elev} ft ${r3(v.brg)}° ${v.d.toFixed(0)} NM`).join('\n') || '-']), { size: 7 });
      MOUNTAIN_RULES.forEach((r) => para('- ' + r, { size: 7.5, gap: .4 }));
    }
    progress('PDF : croquis…');
    drawSketch(doc, b, M, y + 1, W - 2 * M, 110, latin); y += 115;
    if (b.detours.length) {
      h2('Points de contournement');
      table(['Point', 'Position', 'Contourne'], b.detours.map((d) => [d.id, `${d.p[0].toFixed(4)} ${d.p[1].toFixed(4)}`, d.around]), { size: 8 });
    }
    h2('Coupe verticale');
    drawProfilePdf(doc, b, M, y + 1, W - 2 * M, 62); y += 72;
    h2('Météo le long de la route (prévision modèle à l\'heure de passage)');
    if (b.wxRoute && b.wxRoute.pts) {
      table(['Heure', 'Pos.', 'Avis', 'Nuages bas', 'Base est.', 'Visi', 'Pluie', 'Rafales', 'Détail'], b.wxRoute.pts.map((p) => [utc(p.at), `${p.along.toFixed(0)} NM`,
        { content: WXTXT[p.level], styles: { textColor: p.level === 2 ? [190, 20, 20] : p.level === 1 ? [200, 110, 0] : [20, 130, 40], fontStyle: 'bold' } },
        p.low != null ? `${p.low} %` : '?', p.baseAgl != null ? `${p.baseAgl} ft sol / ${p.baseAmsl} ft` : '?', p.vis != null ? `${Math.round(p.vis / 1000)} km` : '?',
        p.rr != null ? `${p.rr} mm` : '?', p.gust != null ? `${Math.round(p.gust)} kt` : '?', p.why.join(', ')]), { size: 7 });
      para('Base estimée par l\'écart température / point de rosée (x 400 ft) - indicatif, ne remplace pas les TEMSI.', { size: 7, color: [90, 90, 90] });
    } else para('Prévision en route indisponible.', { size: 8 });
    h2('Vent et stations le long de la route');
    if (b.winds) para(`Vent prévu à ${b.f.ft} ft (Open-Meteo, interpolé entre niveaux, à l'heure de passage de chaque branche) : ${b.legs.map((l) => `${l.from}-${l.to} ${r3(l.wind.dir)}°/${Math.round(l.wind.spd)} kt ${Math.round(l.wind.t)}°C`).join(' · ')}. Isotherme 0° ~${Math.round((b.winds[0].iso || 0) * 3.281 / 100) * 100} ft.`, { size: 8 });
    else para(b.windErr || '', { size: 8 });
    b.wxNear.forEach((x) => para(`${x.m.rawOb}  [${x.m.fltCat || '?'}] (${x.r.d.toFixed(0)} NM)`, { mono: true, size: 7.3, gap: .4 }));
    para('Compléter avec TEMSI / WINTEM / prévisions officielles sur aviation.meteo.fr.', { size: 7.5, color: [90, 90, 90] });
    progress('PDF : NOTAM…');
    h2(`NOTAM en route (couloir ±${b.f.cor} NM, collecte ${b.notamGenerated ? b.notamGenerated.slice(0, 16).replace('T', ' ') + 'Z' : '?'})`);
    const nRow = (n, extra = '') => [n.ref, `${A.fmtT(n.from)}\n${A.fmtT(n.to)}`, `${A.fl(n.lower)}-${A.fl(n.upper)}${extra}`, n.efr || n.e || ''];
    const nCols = { columnStyles: { 0: { cellWidth: 17 }, 1: { cellWidth: 23 }, 2: { cellWidth: 21 } } };
    if (b.enroute.length) table(['Réf.', 'Validité', 'Niveaux', 'Texte'], b.enroute.map((x) => nRow(x.n, `\nà ${x.along.toFixed(0)} NM`)), { size: 7, at: nCols }); else para('Aucun.', { size: 8 });
    if (b.obst.length) { para(`Obstacles (${b.obst.length})`, { bold: true }); table(['Réf.', 'Validité', 'Niveaux', 'Texte'], b.obst.map((x) => nRow(x.n, `\nà ${x.along.toFixed(0)} NM`)), { size: 6.5, at: nCols }); }
    if (b.general.length) { para(`NOTAM de portée FIR (${b.general.length})`, { bold: true }); table(['Réf.', 'Validité', 'Niveaux', 'Texte'], b.general.map((n) => nRow(n)), { size: 6.5, at: nCols }); }
    h2('SUP AIP');
    if (b.sups.length) table(['SUP', 'Titre', 'Validité', 'Dist.'], b.sups.map((x) => [x.s.num, x.s.title, `${x.s.from || '?'} -> ${x.s.to || '?'}`, `${x.d.toFixed(0)} NM`]), { size: 7.5, at: { columnStyles: { 0: { cellWidth: 17 }, 2: { cellWidth: 32 }, 3: { cellWidth: 14 } } } });
    else para('Aucun SUP AIP localisé près de la route (localisation d\'après les titres : voir la liste du SIA).', { size: 8 });
    h2('AZBA (RTBA) et zones P / R / D');
    if (b.rtba.length) table(['Zone RTBA', 'Limites', 'Position', 'Créneaux du jour (UTC)', 'Conflit'], b.rtba.map((r) => [`${r.z.id} ${r.z.name}`, `${r.z.lower} - ${r.z.upper}`, r.crossed ? 'traversée' : `à ${r.d.toFixed(0)} NM`, r.slots.join(', ') || (b.azbaKnown ? 'non active' : 'inconnu'), r.conflict && r.crossed ? 'OUI' : '-']), { size: 7.5 });
    else para('Aucune zone RTBA dans le couloir.', { size: 8 });
    const others = b.zones.filter((x) => !x.z.rtba);
    if (others.length) table(['Zone', 'Limites', 'Position', 'Remarques'], others.map((x) => [`${x.z.id} ${x.z.name}`, `${x.z.lower} - ${x.z.upper}`, (x.crossed ? 'TRAVERSÉE' : `à ${x.d.toFixed(0)} NM`) + (x.below ? '' : '\nhors altitude'), (x.z.rmk || '').slice(0, 240)]), { size: 6.8, at: { columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 30 }, 2: { cellWidth: 20 } } } });

    // pied de page
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
      doc.setFontSize(6.5); doc.setTextColor(110);
      doc.text(latin('Outil d\'aide - ne remplace pas la préparation réglementaire (SOFIA, SIA, aviation.meteo.fr, VAC officielles, manuel de vol).'), M, ph - 5);
      doc.text(`${i}/${n}`, pw - M, ph - 5, { align: 'right' });
    }
    // première page vide créée par jsPDF ? (non : la 1re page est le log)

    // ---------------------------------------------------------------- 4. VAC jointes (pdf-lib)
    if (opts.raw) return doc.output('arraybuffer');
    const name = `briefing_${b.userIds.join('-')}_${b.f.ac.reg}_${b.depT.toISOString().slice(0, 10)}.pdf`;
    await finishPdf([doc.output('arraybuffer')], [b.f.dep, b.f.arr, b.f.alt], name, progress, opts.histId);
  }
  async function finishPdf(parts, vacList, name, progress, histId) {
    let bytes = parts[0];
    const vacIds = vacList.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && VAC.data[v]);
    const failed = [];
    if (window.PDFLib && (vacIds.length || parts.length > 1)) {
      try {
        const out = await PDFLib.PDFDocument.load(parts[0]);
        for (const p of parts.slice(1)) { const src = await PDFLib.PDFDocument.load(p); (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg)); }
        for (const id of vacIds) {
          progress(`PDF : ajout de la VAC ${id}…`);
          try {
            const r = await fetch(VAC.data[id].url); if (!r.ok) throw new Error(r.status);
            const src = await PDFLib.PDFDocument.load(await r.arrayBuffer(), { ignoreEncryption: true });
            (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
          } catch (e) { failed.push(id); }
        }
        bytes = await out.save();
      } catch (e) { console.warn('pdf-lib', e); }
    }
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (window.AWW_saveBriefing) await window.AWW_saveBriefing(name, blob);
    if (histId) await histSave(histId, name, blob);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => window.open(url, '_blank'), 300);
    if (failed.length) $('#pf-out').insertAdjacentHTML('beforeend', `<div class="warn">VAC ${failed.join(', ')} non jointes ${A.IS_EXT ? '' : '(le SIA bloque le téléchargement depuis une page web : l\'extension Chrome les joint automatiquement)'} — liens dans le PDF.</div>`);
  }
  // PDF d'un voyage : page de synthèse + briefing complet de chaque étape + VAC
  async function buildTripPdf(trip, progress, histId) {
    const parts = [tripOverviewPdf(trip)];
    for (const b of trip) parts.push(await buildPdf(b, (t) => progress(`Étape ${b.stage}/${trip.length} — ${t}`), { raw: true }));
    const name = `briefing_voyage_${[trip[0].f.dep, ...trip.map((b) => b.f.arr)].join('-')}_${trip[0].f.ac.reg}_${trip[0].depT.toISOString().slice(0, 10)}.pdf`;
    await finishPdf(parts, [...new Set(trip.flatMap((b) => [b.f.dep, b.f.arr, b.f.alt]))], name, progress, histId);
  }
  function tripOverviewPdf(trip) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const W = 210, M = 10, b0 = trip[0];
    doc.setFillColor(0, 102, 153); doc.rect(0, 0, W, 16, 'F'); doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(latin(`VOYAGE ${[b0.f.dep, ...trip.map((b) => b.f.arr)].join(' -> ')} · ${b0.f.ac.reg} ${b0.f.T.label}`), M, 7.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(latin(`Vol du ${b0.depT.toLocaleDateString('fr-FR', { timeZone: 'UTC' })} · ${trip.length} étapes · escale ${b0.f.turn} min · ${b0.f.refuel ? 'plein à chaque escale' : 'sans avitaillement'}${b0.f.pil ? ' · pilote ' + b0.f.pil : ''}`), M, 13);
    doc.setTextColor(0);
    const totMin = trip.reduce((s, b) => s + b.totMin, 0), totFuel = trip.reduce((s, b) => s + b.totFuel, 0), totDist = trip.reduce((s, b) => s + b.totDist, 0);
    doc.autoTable({
      startY: 22, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.4 }, headStyles: { fillColor: [0, 102, 153] },
      head: [['#', 'Étape', 'Départ', 'Arrivée', 'Durée', 'Dist.', 'À bord', 'Conso', 'Reste', 'Requis', 'Dernier déc.'].map(latin)],
      body: trip.map((b) => {
        const rem = Math.round(b.loaded - b.totFuel), need = b.resFuel + (b.altLeg ? b.altLeg.fuel : 0);
        return [b.stage, latin(b.ids.filter((x) => !x.startsWith('DT')).join(' - ')), utc(b.depT), utc(b.eta), hhmm(b.totMin), `${b.totDist.toFixed(0)} NM`, `${b.loaded} L`, `${b.totFuel} L`,
          { content: `${rem} L`, styles: { textColor: rem >= need ? [20, 130, 40] : [190, 20, 20], fontStyle: 'bold' } }, `${need} L`, b.night ? utc(b.night.latestDep) : '-'];
      }).concat([['', 'TOTAL', '', '', hhmm(totMin), `${totDist.toFixed(0)} NM`, '', `${totFuel} L`, '', '', '']]),
    });
    let y = doc.lastAutoTable.finalY + 6;
    const para = (t, col = [0, 0, 0], size = 9, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...col); doc.splitTextToSize(latin(t), W - 2 * M).forEach((l) => { doc.text(l, M, y); y += size * 0.45; }); y += 1.5; doc.setTextColor(0); };
    para('Check-list carburant et horaires', [0, 80, 130], 11, true);
    trip.forEach((b) => {
      const rem = Math.round(b.loaded - b.totFuel), need = b.resFuel + (b.altLeg ? b.altLeg.fuel : 0);
      para(`[ ] Étape ${b.stage} ${b.f.dep}-${b.f.arr} : ${b.loaded} L au départ, ${b.totFuel} L consommés, reste ${rem} L à l'arrivée pour ${need} L requis (dégagement ${b.altLeg ? b.altLeg.fuel : 0} + réserve ${b.resFuel}) ${rem >= need ? 'OK' : '-> AVITAILLER à ' + b.f.dep}.`, rem >= need ? [0, 0, 0] : [190, 20, 20]);
      if (b.night) para(`     Décollage prévu ${utc(b.depT)}, au plus tard ${utc(b.night.latestDep)} (nuit aéronautique ${utc(b.night.night)} à ${b.f.arr})${b.night.late ? ' -> ARRIVÉE DE NUIT' : ''}.`, b.night.late ? [190, 20, 20] : [60, 60, 60], 8.5);
      const e = A.escaleOf && A.escaleOf(b.f.arr);
      if (b.stage < trip.length && e) para(`     Escale ${b.f.arr} : carburant ${e.none ? 'aucun' : (e.fuel || []).join(', ') || 'voir VAC'} · paiement ${(e.pay || []).join(', ') || 'non précisé'}.`, [60, 60, 60], 8.5);
    });
    y += 2; para('Points d\'attention par étape', [0, 80, 130], 11, true);
    trip.forEach((b) => { const al = alertsOf(b); para(`Étape ${b.stage} : ${al.length ? al.slice(0, 6).join(' | ') : 'aucune alerte majeure.'}`, al.length ? [170, 40, 0] : [0, 0, 0], 8); });
    doc.setFontSize(7); doc.setTextColor(100); doc.text(latin('Briefing détaillé de chaque étape dans les pages suivantes. Outil d\'aide : la préparation réglementaire reste SOFIA / SIA / aviation.meteo.fr.'), M, 290);
    return doc.output('arraybuffer');
  }


  // ================================================================== mode en vol (10) : position GPS de la tablette sur la route
  let fm = null;
  function flightMode(trip) {
    if (fm) { stopFlight(); return; }
    if (!navigator.geolocation) { alert('Géolocalisation non disponible sur cet appareil.'); return; }
    const box = document.createElement('div'); box.id = 'inflight'; box.innerHTML = '<div class="if-wait">📡 Recherche du GPS…</div>';
    document.body.appendChild(box);
    const legs = trip.flatMap((b) => b.legs.map((lg, i) => ({ ...lg, brief: b, i })));
    fm = { trip, legs, box, follow: true, prev: null, marker: null, trail: L.polyline([], { color: '#00e5ff', weight: 3, opacity: .8 }).addTo(map), lock: null };
    map.on('dragstart', fmDrag);
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { if (fm) fm.lock = l; }).catch(() => {});
    fm.watch = navigator.geolocation.watchPosition(onFix, (e) => { box.innerHTML = `<div class="if-wait">GPS indisponible : ${esc(e.message)} <button class="btn" id="if-stop">Quitter</button></div>`; box.querySelector('#if-stop').onclick = stopFlight; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  function fmDrag() { if (fm) fm.follow = false; }
  function stopFlight() {
    if (!fm) return;
    navigator.geolocation.clearWatch(fm.watch);
    if (fm.lock) fm.lock.release().catch(() => {});
    if (fm.marker) map.removeLayer(fm.marker);
    map.removeLayer(fm.trail); map.off('dragstart', fmDrag);
    fm.box.remove(); fm = null;
  }
  function onFix(pos) {
    if (!fm) return;
    const c = pos.coords, p = [c.latitude, c.longitude];
    // route / vitesse sol : GPS, sinon calculés entre deux positions
    let trk = c.heading, gs = c.speed != null ? c.speed * 1.94384 : null;
    if (fm.prev) {
      const d = distNm(fm.prev.p, p), dt = (pos.timestamp - fm.prev.t) / 3600e3;
      if (d > 0.02) { if (trk == null || isNaN(trk)) trk = bearing(fm.prev.p, p); if (gs == null && dt > 0) gs = d / dt; }
    }
    if (!fm.prev || distNm(fm.prev.p, p) > 0.02) fm.prev = { p, t: pos.timestamp };
    fm.trail.addLatLng(p);
    // branche active : la plus proche (écart latéral), en privilégiant la suite logique
    let best = null;
    fm.legs.forEach((lg, k) => {
      const r = routeDist(p, [lg.a, lg.b]);
      const off = trk != null && !isNaN(trk) && gs > 30 ? Math.abs(((trk - lg.tc + 540) % 360) - 180) : 0;
      const score = r.d + (off > 100 ? 8 : 0) + (fm.k != null && k < fm.k ? 3 : 0);
      if (!best || score < best.score) best = { lg, k, d: r.d, along: Math.min(lg.dist, Math.max(0, r.along)), score };
    });
    fm.k = best.k;
    const lg = best.lg, rem = lg.dist - best.along;
    const v = gs && gs > 30 ? gs : lg.gs;
    const restLegs = fm.legs.slice(best.k + 1).filter((x) => x.brief === lg.brief);
    const remDest = rem + restLegs.reduce((s, x) => s + x.dist, 0);
    const etaNext = new Date(Date.now() + rem / v * 3600e3), etaDest = new Date(Date.now() + remDest / v * 3600e3);
    const brgNext = bearing(p, lg.b), varDeg = lg.tc - lg.tm;
    const side = (() => { const t = bearing(lg.a, p) - lg.tc; return ((t + 540) % 360) - 180 > 0 ? 'droite' : 'gauche'; })();
    const next = fm.legs[best.k + 1];
    const freqs = (x) => (x ? x.airspaces.filter((s) => s.freq).map((s) => `${s.name} ${s.freq}`).slice(0, 3).join(' · ') : '');
    const altFt = c.altitude != null ? Math.round(c.altitude * 3.281) : null;
    const icon = L.divIcon({ className: 'own-ac', iconSize: [34, 34], iconAnchor: [17, 17], html: `<svg width="34" height="34" viewBox="-17 -17 34 34" style="transform:rotate(${trk ?? 0}deg)"><path d="M0-15 L4-3 L14 3 L14 6 L3 3 L2 11 L6 14 L6 16 L0 14 L-6 16 L-6 14 L-2 11 L-3 3 L-14 6 L-14 3 L-4-3Z" fill="#00e5ff" stroke="#003" stroke-width="1.5"/></svg>` });
    if (!fm.marker) fm.marker = L.marker(p, { icon, zIndexOffset: 2000, interactive: false }).addTo(map); else { fm.marker.setLatLng(p); fm.marker.setIcon(icon); }
    if (fm.follow) map.setView(p, Math.max(map.getZoom(), 10), { animate: true });
    fm.box.innerHTML = `
      <div class="if-row"><span class="if-big">${esc(lg.from)} → <b>${esc(lg.to)}</b></span><span>${lg.brief.nStages > 1 ? `étape ${lg.brief.stage}` : ''}</span></div>
      <div class="if-grid">
        <div><small>Cap direct</small><b>${r3((brgNext - varDeg + 360) % 360)}°</b></div>
        <div><small>Reste</small><b>${rem.toFixed(1)} NM</b></div>
        <div><small>Prochain point</small><b>${utc(etaNext)}</b></div>
        <div><small>Vs</small><b>${gs != null ? Math.round(gs) : '–'} kt</b></div>
        <div><small>Route</small><b>${trk != null && !isNaN(trk) ? r3((trk - varDeg + 360) % 360) + '°' : '–'}</b></div>
        <div><small>Alt. GPS</small><b>${altFt != null ? altFt + ' ft' : '–'}</b></div>
      </div>
      <div class="if-row ${best.d > 2 ? 'if-off' : ''}">Écart ${best.d.toFixed(1)} NM ${best.d > 0.3 ? side : ''} · arrivée ${esc(lg.brief.f.arr)} ${utc(etaDest)} (${remDest.toFixed(0)} NM)</div>
      <div class="if-row if-f">📻 ${esc(freqs(lg) || 'classe G — 123.500 / SIV')}${next ? `<br><small>Ensuite (${esc(next.from)}→${esc(next.to)}) : ${esc(freqs(next) || 'classe G')}</small>` : ''}</div>
      <div class="if-row"><button class="btn" id="if-follow">${fm.follow ? '🔒 Suivi' : '🎯 Recentrer'}</button><button class="btn" id="if-stop">✕ Quitter</button></div>
      <div class="if-note">Aide à la navigation de secours — ne remplace ni la carte, ni l'estime, ni les instruments.</div>`;
    fm.box.querySelector('#if-stop').onclick = stopFlight;
    fm.box.querySelector('#if-follow').onclick = () => { fm.follow = true; map.setView(p, Math.max(map.getZoom(), 10)); };
  }

  // ================================================================== historique des préparations (12)
  const HIST_CACHE = 'aww-history';
  const FORM_KEYS = ['dep', 'arr', 'alt', 'wps', 'time', 'reg', 'regime', 'ft', 'res', 'm1', 'm2', 'm3', 'm4', 'fuel', 'aux', 'cor', 'avoid', 'pil', 'immat', 'empty', 'exit', 'entry', 'stages', 'turn', 'refuel'];
  function histStart(id, trip) {
    const b = trip[0], f = lastForm || b.f;
    const list = store.get('hist', []);
    list.unshift({ id, at: Date.now(), title: [b.f.dep, ...trip.map((x) => x.f.arr)].join(' → '), reg: b.f.ac.reg, dep: b.depT.toISOString(), form: Object.fromEntries(FORM_KEYS.map((k) => [k, f[k]])), files: [] });
    const keep = list.slice(0, 25), drop = list.slice(25);
    store.set('hist', keep);
    if (drop.length && window.caches) caches.open(HIST_CACHE).then(async (c) => { for (const e of drop) for (const n of e.files) await c.delete(`hist/${e.id}/${encodeURIComponent(n)}`); }).catch(() => {});
  }
  async function histSave(id, name, blob) {
    try {
      if (window.caches) await (await caches.open(HIST_CACHE)).put(`hist/${id}/${encodeURIComponent(name)}`, new Response(blob));
      const list = store.get('hist', []), e = list.find((x) => x.id === id);
      if (e && !e.files.includes(name)) { e.files.push(name); store.set('hist', list); }
    } catch (e) { console.warn('historique', e); }
  }
  async function histFile(id, name) {
    const r = window.caches && await (await caches.open(HIST_CACHE)).match(`hist/${id}/${encodeURIComponent(name)}`);
    if (!r) { alert('Fichier non disponible sur cet appareil.'); return; }
    const blob = await r.blob();
    if (/\.pdf$/.test(name)) window.open(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), '_blank');
    else download(blob, name);
  }
  function showHistory() {
    const list = store.get('hist', []);
    A.showPanel('Historique des préparations', list.length ? list.map((e, i) => `
      <div class="hist">
        <div><b>${esc(e.title)}</b> · ${esc(e.reg)}</div>
        <div class="meta">Vol du ${esc(new Date(e.dep).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · préparé le ${esc(new Date(e.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div>
        <div class="row">${e.files.map((n, j) => `<button class="btn" data-hf="${i}:${j}">${/\.pdf$/.test(n) ? '📄 PDF' : '📊 Excel'}${e.files.filter((x) => x.slice(-4) === n.slice(-4)).length > 1 ? ' ' + esc(n.split('_')[2] || '') : ''}</button>`).join('')}
          <button class="btn" data-redo="${i}">↻ Refaire</button><button class="btn" data-del="${i}">🗑️</button></div>
      </div>`).join('') + '<p class="meta small-print">Conservé sur cet appareil (25 dernières préparations).</p>' : '<p class="meta">Aucune préparation enregistrée : l\'historique se remplit à chaque génération de PDF ou de log Excel.</p>');
    const body = document.getElementById('detail-body');
    body.querySelectorAll('[data-hf]').forEach((x) => x.addEventListener('click', () => { const [i, j] = x.dataset.hf.split(':').map(Number); histFile(list[i].id, list[i].files[j]); }));
    body.querySelectorAll('[data-redo]').forEach((x) => x.addEventListener('click', () => {
      const e = list[+x.dataset.redo]; store.set('form', e.form); openForm();
      if (e.form.time && new Date(e.form.time) > new Date()) $('#pf-time').value = e.form.time;
      ['exit', 'entry'].forEach((k) => setTimeout(() => { const el = $('#pf-' + k); if (el && [...el.options].some((o) => o.value === e.form[k])) el.value = e.form[k]; }, 600));
    }));
    body.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', async () => {
      const e = list[+x.dataset.del];
      if (window.caches) { const c = await caches.open(HIST_CACHE); for (const n of e.files) await c.delete(`hist/${e.id}/${encodeURIComponent(n)}`); }
      store.set('hist', store.get('hist', []).filter((h) => h.id !== e.id)); showHistory();
    }));
  }
  if ($('#btn-hist')) $('#btn-hist').addEventListener('click', showHistory);

  // ---------------------------------------------------------------- partage d'une préparation par lien (sans le nom du pilote)
  const SHARE_KEYS = FORM_KEYS.filter((k) => k !== 'pil');
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function shareUrl(f) {
    const o = {};
    SHARE_KEYS.forEach((k) => { if (f[k] !== undefined && f[k] !== '' && f[k] !== null) o[k] = f[k]; });
    if (f.time) o.time = new Date(f.time).toISOString();
    const cfg = window.AWW_CONFIG || {};
    const base = A.IS_EXT || !/^https?:/.test(location.protocol) ? (cfg.liveUrl || '').replace(/\/?$/, '/') + 'map.html' : location.origin + location.pathname;
    return `${base}#vol=${b64e(JSON.stringify(o))}`;
  }
  async function shareFlight(sfx) {
    if (!lastForm) return;
    const url = shareUrl(lastForm), f = lastForm;
    const title = `Vol ${f.dep} → ${[f.arr, ...(f.stages || '').split(/\s+/).filter(Boolean)].join(' → ')} (${f.reg})`;
    let done = '';
    if (navigator.share && /Mobi|iPad|Android/i.test(navigator.userAgent)) { try { await navigator.share({ title, url }); done = 'Lien partagé.'; } catch { /* annulé */ } }
    if (!done) { try { await navigator.clipboard.writeText(url); done = 'Lien copié : colle-le dans un message (WhatsApp, e-mail…).'; } catch { done = 'Copie le lien ci-dessous :'; } }
    const box = document.createElement('div'); box.className = 'okk';
    box.innerHTML = `🔗 ${esc(done)}<input readonly value="${esc(url)}" style="width:100%;margin-top:4px" onclick="this.select()"><span class="meta">Le lien ouvre la même préparation (route, avion, heure, masses) et relance le calcul avec les données du moment. Le nom du pilote n'y figure pas.</span>`;
    const btn = $('#pf-share' + sfx); btn.closest('.row').after(box);
  }
  // Ouverture d'un lien partagé : #vol=...
  function openShared() {
    const m = /^#vol=([A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return;
    let o; try { o = JSON.parse(b64d(m[1])); } catch (e) { console.warn('lien de vol illisible', e); return; }
    history.replaceState(null, '', location.pathname + location.search);
    // le lien vient de l'extérieur : nombres en nombres, textes limités aux caractères d'une route (pas de HTML)
    const NUM = ['regime', 'ft', 'res', 'm1', 'm2', 'm3', 'm4', 'fuel', 'aux', 'cor', 'empty', 'turn'];
    const safe = (k, v) => NUM.includes(k) ? (Number(v) || 0) : k === 'refuel' ? !!v : String(v).replace(/[^A-Za-z0-9 ./+-]/g, '').slice(0, 120);
    const clean = Object.fromEntries(SHARE_KEYS.filter((k) => k in o && k !== 'time').map((k) => [k, safe(k, o[k])]));
    store.set('form', { ...store.get('form', {}), ...clean });
    openForm();
    const t = o.time ? new Date(o.time) : null;
    if (t && !isNaN(t)) $('#pf-time').value = localInput(t > new Date(Date.now() - 3600e3) ? t : (() => { const n = new Date(Date.now() + 3600e3); n.setMinutes(0, 0, 0); return n; })());
    $('#pf-prog').textContent = 'Préparation reçue par lien : calcul en cours…';
    setTimeout(() => {
      ['exit', 'entry'].forEach((k) => { const el = $('#pf-' + k); if (el && o[k] && [...el.options].some((x) => x.value === o[k])) el.value = o[k]; });
      run(false);
    }, 900);
  }
  setTimeout(openShared, 300);

  // Carte de navigation sur fond OACI-VFR 1/500 000 (tuiles IGN dessinées dans un canvas)
  async function renderNavMap(b, progress) {
    const tpl = (window.AWW_GEOPF || {}).oaci; if (!tpl) return null;
    const all = b.pts.concat(b.altLeg ? [[A.aptByIcao[b.altLeg.to].la, A.aptByIcao[b.altLeg.to].lo]] : []);
    let s = Math.min(...all.map((p) => p[0])), n = Math.max(...all.map((p) => p[0])), w = Math.min(...all.map((p) => p[1])), e = Math.max(...all.map((p) => p[1]));
    const pl = Math.max(0.12, (n - s) * 0.12), pg = Math.max(0.18, (e - w) * 0.12); s -= pl; n += pl; w -= pg; e += pg;
    const X = (lo, z) => (lo + 180) / 360 * 256 * 2 ** z;
    const Y = (la, z) => (1 - Math.log(Math.tan(rad(la)) + 1 / Math.cos(rad(la))) / Math.PI) / 2 * 256 * 2 ** z;
    let z = 11;
    while (z > 6 && (Math.ceil(X(e, z) / 256) - Math.floor(X(w, z) / 256) + 1) * (Math.ceil(Y(s, z) / 256) - Math.floor(Y(n, z) / 256) + 1) > 70) z--;
    // élargit au format paysage A4
    let x0 = X(w, z), x1 = X(e, z), y0 = Y(n, z), y1 = Y(s, z);
    const ratio = 277 / 172;
    if ((x1 - x0) / (y1 - y0) < ratio) { const d = ((y1 - y0) * ratio - (x1 - x0)) / 2; x0 -= d; x1 += d; } else { const d = ((x1 - x0) / ratio - (y1 - y0)) / 2; y0 -= d; y1 += d; }
    const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, W, H);
    const tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256), ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);
    const jobs = [];
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      const url = tpl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
      jobs.push(new Promise((res) => {
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => { ctx.drawImage(im, tx * 256 - x0, ty * 256 - y0); res(true); };
        im.onerror = () => res(false); im.src = url;
      }));
    }
    progress && progress(`PDF : carte OACI (${jobs.length} tuiles)…`);
    const ok = (await Promise.all(jobs)).filter(Boolean).length;
    if (!ok) return null;
    const P = (p) => [X(p[1], z) - x0, Y(p[0], z) - y0];
    const u = W / 1000;   // unité graphique : tailles proportionnelles à l'image (lisibles une fois sur A4)
    ctx.lineCap = 'round';
    // route
    ctx.strokeStyle = 'rgba(255,0,180,.9)'; ctx.lineWidth = 5 * u;
    ctx.beginPath(); b.pts.forEach((p, i) => { const q = P(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.stroke();
    if (b.altLeg) { ctx.setLineDash([12 * u, 10 * u]); ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(...P(b.pts[b.pts.length - 1])); ctx.lineTo(...P(all[all.length - 1])); ctx.stroke(); ctx.setLineDash([]); }
    const mk = routeMarks(b);
    mk.ticks.forEach((t) => {
      const half = t.major ? 2.6 : 1.7;
      const a2 = P(destPt(t.p, t.tc - 90, half)), c2 = P(destPt(t.p, t.tc + 90, half));
      ctx.strokeStyle = '#ff00b4'; ctx.lineWidth = (t.major ? 4.5 : 3) * u; ctx.beginPath(); ctx.moveTo(...a2); ctx.lineTo(...c2); ctx.stroke();
      if (t.major) { const q = P(destPt(t.p, t.tc + 90, 4.2)); ctx.lineWidth = 4 * u; ctx.strokeStyle = '#fff'; ctx.font = `bold ${14 * u}px Helvetica, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeText(`${t.min}'`, ...q); ctx.fillStyle = '#b0007a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${t.min}'`, ...q); }
    });
    const fs = 17 * u;
    mk.boxes.forEach((x) => {
      const q = P(destPt(x.p, x.tc + 90, 6));
      ctx.font = `bold ${fs}px Helvetica, Arial`; const w1 = ctx.measureText(x.l2).width;
      ctx.font = `${fs * .85}px Helvetica, Arial`; const w2 = ctx.measureText(x.l3).width;
      const bw = Math.max(w1, w2) + 16 * u, bh = fs * 2.4;
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeStyle = '#ff00b4'; ctx.lineWidth = 3 * u;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(q[0] - bw / 2, q[1] - bh / 2, bw, bh, 6 * u) : ctx.rect(q[0] - bw / 2, q[1] - bh / 2, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${fs}px Helvetica, Arial`; ctx.fillText(x.l2, q[0], q[1] - fs * .5);
      ctx.font = `${fs * .85}px Helvetica, Arial`; ctx.fillText(x.l3, q[0], q[1] + fs * .6);
    });
    all.forEach((p, i) => {
      const q = P(p), id = i < b.ids.length ? b.ids[i] : b.altLeg.to;
      ctx.fillStyle = id.startsWith('DT') ? '#ffb300' : '#ff00b4'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * u;
      ctx.beginPath(); ctx.arc(q[0], q[1], 8 * u, 0, 7); ctx.fill(); ctx.stroke();
      ctx.font = `bold ${fs}px Helvetica, Arial`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 5 * u; ctx.strokeStyle = '#fff'; ctx.strokeText(id, q[0] + 11 * u, q[1] - 6 * u); ctx.fillStyle = '#000'; ctx.fillText(id, q[0] + 11 * u, q[1] - 6 * u);
    });
    return { url: cv.toDataURL('image/jpeg', 0.82), w: W, h: H, z };
  }

  // Coupe verticale dans le PDF
  function drawProfilePdf(doc, b, x0, y0, w, h) {
    const v = b.vprofile; if (!v) return;
    const top = Math.max(b.f.ft + 2000, v.maxTer + 1500, 3000);
    const X = (nm) => x0 + 12 + nm / v.total * (w - 14), Y = (ft) => y0 + h - 8 - ft / top * (h - 12);
    doc.setFillColor(235, 243, 250); doc.rect(x0, y0, w, h, 'F');
    doc.saveGraphicsState(); doc.rect(x0, y0, w, h, null); doc.clip(); doc.discardPath();
    v.segs.filter((sg) => sg.lower < top).map((sg) => ({ ...sg, upper: Math.min(sg.upper, top) })).forEach((sg) => {
      const c = sg.color.match(/\w\w/g).map((x) => parseInt(x, 16));
      doc.setDrawColor(...c); doc.setFillColor(Math.round(255 - (255 - c[0]) * .25), Math.round(255 - (255 - c[1]) * .25), Math.round(255 - (255 - c[2]) * .25));
      doc.setLineWidth(.2); doc.rect(X(sg.from), Y(sg.upper), Math.max(.5, X(sg.to) - X(sg.from)), Math.max(.5, Y(sg.lower) - Y(sg.upper)), 'FD');
      doc.setFontSize(5.2); doc.setTextColor(...c.map((q) => Math.round(q * .6)));
      if (X(sg.to) - X(sg.from) > 14) doc.text(sg.name.slice(0, 28), X(sg.from) + 1, Y(sg.upper) + 2.5);
    });
    doc.setFillColor(141, 110, 99); doc.setDrawColor(110, 80, 70);
    const segsT = []; let prev = [X(0), Y(0)];
    const ptsT = [[X(0), Y(0)], ...v.profile.map((p) => [X(p.along), Y(p.ft)]), [X(v.total), Y(0)]];
    for (let i = 1; i < ptsT.length; i++) { segsT.push([ptsT[i][0] - prev[0], ptsT[i][1] - prev[1]]); prev = ptsT[i]; }
    doc.lines(segsT, ptsT[0][0], ptsT[0][1], [1, 1], 'F', true);
    doc.setDrawColor(255, 0, 180); doc.setLineWidth(.7); doc.line(X(0), Y(b.f.ft), X(v.total), Y(b.f.ft));
    doc.setFontSize(6); doc.setTextColor(60);
    [0, .25, .5, .75, 1].forEach((k) => doc.text(String(Math.round(top * k / 100) * 100), x0 + 1, Y(top * k) + 1));
    let acc = 0;
    b.legs.forEach((lg, i) => { doc.setDrawColor(150); doc.setLineWidth(.15); doc.line(X(acc), y0 + 2, X(acc), Y(0)); doc.text(String(lg.from), X(acc) + .8, y0 + 4); acc += lg.dist; });
    doc.text(String(b.ids[b.ids.length - 1]), X(v.total) - 8, y0 + 4);
    if (b.wxRoute && b.wxRoute.pts) b.wxRoute.pts.forEach((p) => { const c = [[46, 204, 64], [255, 159, 10], [255, 59, 48]][p.level]; doc.setFillColor(...c); doc.circle(X(p.along), y0 + h - 3.5, 1.1, 'F'); });
    doc.restoreGraphicsState();
    doc.setDrawColor(0, 102, 153); doc.setLineWidth(.3); doc.rect(x0, y0, w, h, 'S');
    doc.setTextColor(90); doc.setFontSize(6);
    doc.text(latin(`Relief (marron), croisière ${b.f.ft} ft (rose), espaces et zones traversés, pastilles = météo prévue (vert / orange / rouge). Altitudes en ft.`), x0 + 12, y0 + h + 3);
    doc.setTextColor(0);
  }

  // ================================================================== export de la route
  function routePoints(b) {
    return b.ids.map((id, i) => {
      const r = resolvePt(id);
      return { id: id.replace(/[^A-Z0-9-]/g, ''), name: r ? (r.kind === 'ad' ? r.name : (r.desc || id)) : id, la: b.pts[i][0], lo: b.pts[i][1], type: r && r.kind === 'ad' ? 'AIRPORT' : 'USER WAYPOINT', alt: r && r.kind === 'ad' ? (r.ad && VAC.data[r.ad] && VAC.data[r.ad].alt) || 0 : b.f.ft };
    });
  }
  const xmlEsc = (t) => String(t).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function exportGpx(b) {
    const P = routePoints(b), nm = `${b.userIds[0]}-${b.userIds[b.userIds.length - 1]}`;
    const wpt = P.map((p) => `  <wpt lat="${p.la.toFixed(6)}" lon="${p.lo.toFixed(6)}"><name>${xmlEsc(p.id)}</name><desc>${xmlEsc(p.name)}</desc></wpt>`).join('\n');
    const rte = P.map((p) => `    <rtept lat="${p.la.toFixed(6)}" lon="${p.lo.toFixed(6)}"><name>${xmlEsc(p.id)}</name><desc>${xmlEsc(p.name)}</desc></rtept>`).join('\n');
    download(`route_${nm}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Aero Meteo Webcams Ouest" xmlns="http://www.topografix.com/GPX/1/1">\n${wpt}\n  <rte><name>${xmlEsc(nm)}</name>\n${rte}\n  </rte>\n</gpx>\n`, 'application/gpx+xml');
  }
  function exportFpl(b) {
    const P = routePoints(b), nm = `${b.userIds[0]}-${b.userIds[b.userIds.length - 1]}`;
    const ident = (p, i) => (p.type === 'AIRPORT' ? p.id : (p.id.replace(/-/g, '') || `WP${i}`)).slice(0, 12);
    const wps = P.map((p, i) => `    <waypoint>\n      <identifier>${xmlEsc(ident(p, i))}</identifier>\n      <type>${p.type}</type>\n      <country-code>${p.type === 'AIRPORT' ? 'LF' : ''}</country-code>\n      <lat>${p.la.toFixed(6)}</lat>\n      <lon>${p.lo.toFixed(6)}</lon>\n      <comment>${xmlEsc(p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 /]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25))}</comment>\n      <elevation>${p.alt}</elevation>\n    </waypoint>`).join('\n');
    const rp = P.map((p, i) => `    <route-point>\n      <waypoint-identifier>${xmlEsc(ident(p, i))}</waypoint-identifier>\n      <waypoint-type>${p.type}</waypoint-type>\n      <waypoint-country-code>${p.type === 'AIRPORT' ? 'LF' : ''}</waypoint-country-code>\n    </route-point>`).join('\n');
    download(`route_${nm}.fpl`, `<?xml version="1.0" encoding="utf-8"?>\n<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">\n  <created>${new Date().toISOString().slice(0, 19)}Z</created>\n  <waypoint-table>\n${wps}\n  </waypoint-table>\n  <route>\n    <route-name>${xmlEsc(nm)}</route-name>\n    <flight-plan-index>1</flight-plan-index>\n${rp}\n  </route>\n</flight-plan>\n`, 'application/xml');
  }

  // Croquis vectoriel
  function drawSketch(doc, b, x0, y0, w, h, latin) {
    const pts = b.pts.concat(b.altLeg ? [[A.aptByIcao[b.altLeg.to].la, A.aptByIcao[b.altLeg.to].lo]] : []);
    let s = Math.min(...pts.map((p) => p[0])), n = Math.max(...pts.map((p) => p[0])), wl = Math.min(...pts.map((p) => p[1])), e = Math.max(...pts.map((p) => p[1]));
    const k = Math.cos(rad((s + n) / 2)), padLa = Math.max(0.25, (n - s) * 0.12), padLo = Math.max(0.35, (e - wl) * 0.12);
    s -= padLa; n += padLa; wl -= padLo; e += padLo;
    const sc = Math.min(w / ((e - wl) * k), h / (n - s));
    const cx = x0 + (w - (e - wl) * k * sc) / 2, cy = y0 + (h - (n - s) * sc) / 2;
    const pr = (p) => [cx + (p[1] - wl) * k * sc, cy + (n - p[0]) * sc];
    const path = (ring, style) => { const q = ring.map(pr); const sg = []; for (let i = 1; i < q.length; i++) sg.push([q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]]); if (sg.length) doc.lines(sg, q[0][0], q[0][1], [1, 1], style, true); };
    doc.setFillColor(214, 234, 248); doc.rect(x0, y0, w, h, 'F');
    doc.saveGraphicsState(); doc.rect(x0, y0, w, h, null); doc.clip(); doc.discardPath();
    doc.setLineWidth(0.2); doc.setDrawColor(120, 150, 170); doc.setFillColor(245, 245, 240);
    for (const f of (window.BASEMAP && window.BASEMAP.features) || []) {
      if (f.properties.k === 'reg') continue;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const pl of polys) path(pl[0].map((c) => [c[1], c[0]]), 'FD');
    }
    const drawn = new Set();
    b.legs.forEach((lg) => lg.airspaces.forEach((sp) => {
      if (drawn.has(sp) || sp.kind === 'SIV') return; drawn.add(sp);
      doc.setDrawColor(0, 120, 200); doc.setLineWidth(0.25); doc.setLineDashPattern([1, 1], 0); path(sp.poly, 'S'); doc.setLineDashPattern([], 0);
    }));
    for (const x of b.zones) {
      if (x.z.rtba) { doc.setDrawColor(220, 30, 30); doc.setFillColor(255, 220, 220); }
      else if (x.z.type === 'P') { doc.setDrawColor(200, 0, 60); doc.setFillColor(255, 200, 220); }
      else if (x.z.type === 'D') { doc.setDrawColor(230, 130, 0); doc.setFillColor(255, 236, 205); }
      else { doc.setDrawColor(140, 60, 200); doc.setFillColor(240, 225, 255); }
      doc.setLineWidth(0.3); path(x.z.poly, 'FD');
      const c = pr([x.z.poly.reduce((a, p) => a + p[0], 0) / x.z.poly.length, x.z.poly.reduce((a, p) => a + p[1], 0) / x.z.poly.length]);
      doc.setFontSize(5.5); doc.setTextColor(120, 0, 0); doc.text(latin(x.z.id), c[0], c[1], { align: 'center' });
    }
    doc.setDrawColor(255, 0, 180); doc.setLineWidth(0.9);
    for (let i = 0; i < b.pts.length - 1; i++) { const a = pr(b.pts[i]), c = pr(b.pts[i + 1]); doc.line(a[0], a[1], c[0], c[1]); }
    if (b.altLeg) { const a = pr(b.pts[b.pts.length - 1]), c = pr(pts[pts.length - 1]); doc.setLineWidth(0.4); doc.setLineDashPattern([1.5, 1.2], 0); doc.line(a[0], a[1], c[0], c[1]); doc.setLineDashPattern([], 0); }
    const mkS = routeMarks(b);
    doc.setDrawColor(255, 0, 180);
    mkS.ticks.forEach((t) => {
      const h1 = pr(destPt(t.p, t.tc - 90, t.major ? 1.8 : 1.1)), h2 = pr(destPt(t.p, t.tc + 90, t.major ? 1.8 : 1.1));
      doc.setLineWidth(t.major ? .6 : .35); doc.line(h1[0], h1[1], h2[0], h2[1]);
      if (t.major) { const q = pr(destPt(t.p, t.tc + 90, 3)); doc.setFontSize(5); doc.setTextColor(170, 0, 120); doc.text(`${t.min}'`, q[0], q[1], { align: 'center' }); }
    });
    mkS.boxes.forEach((x) => {
      const q = pr(destPt(x.p, x.tc + 90, 5));
      doc.setFontSize(6); const w2 = Math.max(doc.getTextWidth(latin(x.l2)), doc.getTextWidth(latin(x.l3))) + 2.4;
      doc.setFillColor(255, 255, 255); doc.setDrawColor(255, 0, 180); doc.setLineWidth(.3);
      doc.roundedRect(q[0] - w2 / 2, q[1] - 3.4, w2, 6.6, .8, .8, 'FD');
      doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.text(latin(x.l2), q[0], q[1] - .6, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.text(latin(x.l3), q[0], q[1] + 2.2, { align: 'center' });
    });
    doc.setFontSize(7.5); doc.setTextColor(0);
    pts.forEach((p, i) => {
      const q = pr(p), id = i < b.ids.length ? b.ids[i] : b.altLeg.to;
      doc.setFillColor(id.startsWith('DT') ? 230 : 255, id.startsWith('DT') ? 170 : 0, id.startsWith('DT') ? 0 : 180); doc.circle(q[0], q[1], 1.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.text(id, q[0] + 2, q[1] - 1.5);
    });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(30, 110, 30);
    for (const a of A.APTS) {
      if (b.ids.includes(a.icao)) continue;
      const q = pr([a.la, a.lo]);
      if (q[0] < x0 || q[0] > x0 + w || q[1] < y0 || q[1] > y0 + h || routeDist([a.la, a.lo], b.pts).d > b.f.cor * 1.5) continue;
      doc.setDrawColor(30, 110, 30); doc.setLineWidth(0.3); doc.circle(q[0], q[1], 0.7, 'S'); doc.text(a.icao, q[0] + 1.2, q[1] + 0.6);
    }
    doc.restoreGraphicsState();
    doc.setTextColor(0); doc.setDrawColor(0, 102, 153); doc.setLineWidth(0.3); doc.rect(x0, y0, w, h, 'S');
    doc.setFontSize(6.3); doc.setTextColor(90);
    doc.text(latin('Croquis indicatif - rose : route (jaune : contournement) · rouge : RTBA · framboise : P · orange : D · violet : R · pointillés bleus : CTR/TMA traversées'), x0 + 1.5, y0 + h - 1.5);
    doc.setTextColor(0);
  }
})();
