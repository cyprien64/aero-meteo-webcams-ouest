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

  // ---------- distances 15 m d'après les tableaux du manuel de vol (data/aircraft.js : takeoff.table / landing.table)
  // interpolation linéaire dans une suite [[x, y]…] triée, prolongée au-delà des bords
  const lerp = (pts, x) => { let i = 1; while (i < pts.length - 1 && x > pts[i][0]) i++; const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); };
  function perfDist(tb, { elev, temp, mass, head, grass }) {
    const alts = Object.keys(tb.rows).map(Number).sort((a, b) => a - b);
    // température : pas d'extrapolation vers le froid (raccourcirait la distance) ; masse : pas en dessous de la plus légère du tableau
    const at = (k) => lerp(alts.map((a) => [a, lerp(tb.rows[a].map((r) => [r[0], r[k]]), Math.max(temp, tb.rows[a][0][0]))]), Math.max(0, elev));
    let d = lerp([[tb.m[1], at(2)], [tb.m[0], at(1)]], Math.max(tb.m[1], mass));
    d *= head >= 0 ? lerp(tb.wind, Math.min(head, tb.wind[tb.wind.length - 1][0])) : 1 - tb.tail * head;
    if (grass) d *= tb.grass;
    return Math.round(d / 10) * 10;
  }
  if (TYPES['R3000-180']) {   // contrôles : valeurs lues directement dans le manuel R3000
    const to = TYPES['R3000-180'].takeoff.table, ld = TYPES['R3000-180'].landing.table, chk = (v, e, m) => console.assert(v === e, `perfDist ${m} : ${v} ≠ ${e}`);
    chk(perfDist(to, { elev: 0, temp: 15, mass: 1150, head: 0 }), 570, 'déc. std');   // 565 arrondi à 10 m
    chk(perfDist(to, { elev: 4000, temp: 7, mass: 950, head: 0 }), 670, 'déc. 4000 ft 950 kg');
    chk(perfDist(to, { elev: 2000, temp: 11, mass: 1150, head: 0 }), 690, 'déc. 2000 ft interpolé');   // (565+810)/2 = 687,5
    chk(perfDist(to, { elev: 0, temp: 15, mass: 1150, head: 10 }), 450, 'déc. vent de face 10 kt');
    chk(perfDist(to, { elev: 0, temp: 15, mass: 1150, head: -4 }), 680, 'déc. vent arrière 4 kt');
    chk(perfDist(ld, { elev: 0, temp: 15, mass: 1150, head: 0, grass: true }), 740, 'att. herbe');
  }

  // ---------- montée : tableau du manuel si disponible (surplus par rapport à la croisière sur la même distance), sinon règle du log ACB
  const TAXI_L = 2;   // mise en route + roulage, ajouté à la 1re branche de chaque étape
  function climbExtra(T, ft, elev, tas, ff) {
    const tb = T.climb.table;
    if (!tb) return { min: T.climb.extraMin, fuel: T.climb.extraFuel + TAXI_L, src: `règle du log ACB +${T.climb.extraMin} min / +${T.climb.extraFuel} L, + ${TAXI_L} L de roulage` };
    const at = (k, x) => lerp(tb.map((r) => [r[0], r[k]]), Math.max(0, x));
    const t = Math.max(0, at(1, ft) - at(1, elev)), fu = Math.max(0, at(2, ft) - at(2, elev)), d = Math.max(0, at(3, ft) - at(3, elev)), cr = d / tas * 60;
    return { min: Math.max(0, Math.round(t - cr)), fuel: Math.max(0, Math.round(fu - cr * ff / 60)) + TAXI_L,
      src: `manuel : montée ${Math.round(t)} min / ${fu.toFixed(1)} L jusqu'à ${ft} ft, + ${TAXI_L} L de roulage` };
  }
  if (TYPES['DR401-CDI']) console.assert(perfDist(TYPES['DR401-CDI'].takeoff.table, { elev: 2000, temp: 21, mass: 1100, head: 0 }) === 480, 'perfDist CDI 2000 ft ISA+10');   // manuel F-HCOY : 483
  if (TYPES['R3000-180']) { const c = climbExtra(TYPES['R3000-180'], 5500, 0, 121, 38); console.assert(c.min === 2 && c.fuel === 6, 'climbExtra R3000', c); }

  // régime « 5500 ft - 2500 t/mn » -> 5500 (null si le nom ne donne pas d'altitude)
  const regFt = (name) => { const m = /^(\d{3,5}) ft/.exec(name || ''); return m ? +m[1] : null; };

  // ---------- TAF : conditions prévues autour d'une heure donnée (groupe de base / FM / BECMG en cours + TEMPO / PROB qui la recouvrent)
  // découpage d'un TAF en groupes (base, FM, BECMG, TEMPO, PROB) avec leurs heures de début et de fin (ms UTC)
  function tafGroups(taf) {
    if (!taf || !taf.rawTAF || !taf.validTimeFrom) return null;
    const v0 = new Date(taf.validTimeFrom * 1000), vEnd = taf.validTimeTo * 1000;
    const dt = (dd, hh, mm = 0) => { let d = Date.UTC(v0.getUTCFullYear(), v0.getUTCMonth(), dd, hh, mm); if (d < v0.getTime() - 2 * 864e5) d = Date.UTC(v0.getUTCFullYear(), v0.getUTCMonth() + 1, dd, hh, mm); return d; };
    const toks = taf.rawTAF.replace(/=\s*$/, '').split(/\s+/), groups = [];
    let cur = { kind: 'TAF', from: v0.getTime(), to: vEnd, toks: [] };
    for (let i = 0; i < toks.length; i++) {
      const x = toks[i]; let m;
      if ((m = /^FM(\d\d)(\d\d)(\d\d)$/.exec(x))) {
        groups.push(cur); const from = dt(+m[1], +m[2], +m[3]);
        groups.filter((g) => g.kind === 'TAF' || g.kind === 'FM' || g.kind === 'BECMG').forEach((g) => { if (g.to > from) g.to = from; });
        cur = { kind: 'FM', from, to: vEnd, toks: [] }; continue;
      }
      if (/^(BECMG|TEMPO|PROB\d\d)$/.test(x)) {
        let kind = x; if (/^PROB/.test(x) && toks[i + 1] === 'TEMPO') { kind += ' TEMPO'; i++; }
        const p = /^(\d\d)(\d\d)\/(\d\d)(\d\d)$/.exec(toks[i + 1] || ''); if (p) i++;
        groups.push(cur);
        cur = { kind, from: p ? dt(+p[1], +p[2]) : v0.getTime(), to: kind === 'BECMG' ? vEnd : p ? dt(+p[3], +p[4]) : vEnd, toks: [] };   // BECMG : persiste après la transition
        continue;
      }
      cur.toks.push(x);
    }
    groups.push(cur);
    return groups;
  }
  function tafAt(taf, when) {
    const groups = tafGroups(taf); if (!groups) return null;
    const t = when.getTime();
    if (t < taf.validTimeFrom * 1000 - 1800e3 || t > taf.validTimeTo * 1000 + 1800e3) return { out: true };
    const bad = [];
    for (const g of groups.filter((g) => g.from <= t + 1800e3 && g.to >= t - 1800e3)) {
      let vis = null, ceil = null; const wx = [];
      for (const x of g.toks) {
        let m;
        if (x === 'CAVOK') vis = 9999;
        else if (/^\d{4}$/.test(x)) vis = +x;
        else if ((m = /^(BKN|OVC|VV)(\d{3})/.exec(x))) ceil = Math.min(ceil ?? 1e9, +m[2] * 100);
        if (/^(FEW|SCT|BKN|OVC)\d{3}(CB|TCU)$/.test(x)) wx.push(x.slice(-3).replace(/^\d/, ''));
        else if (/^[+-]?(VC)?(TS|FZ|FG|SN|GR|GS|SQ|FC|PL)|^\+/.test(x)) wx.push(x);
      }
      const why = [vis != null && vis < 5000 && `visibilité ${vis} m`, ceil != null && ceil < 1500 && `plafond ${ceil} ft`, wx.length && wx.join(' ')].filter(Boolean);
      if (why.length) bad.push(`${g.kind === 'TAF' ? 'prévision de base' : g.kind} : ${why.join(', ')}`);
    }
    return { bad };
  }
  console.assert((() => { const r = tafAt({ rawTAF: 'TAF LFBO 121455Z 1214/1318 27010G20KT 9999 BKN020 PROB40 TEMPO 1214/1218 4000 -RADZ BKN007 BKN025CB BECMG 1300/1302 0800 FG', validTimeFrom: Date.UTC(2026, 10, 12, 14) / 1000, validTimeTo: Date.UTC(2026, 10, 13, 18) / 1000 }, new Date(Date.UTC(2026, 10, 12, 16)));
    return r.bad.length === 1 && /PROB40 TEMPO : visibilité 4000 m, plafond 700 ft, CB/.test(r.bad[0]); })(), 'tafAt TEMPO');
  console.assert(tafAt({ rawTAF: 'TAF LFBO 121455Z 1214/1318 27010KT 9999 BKN020 BECMG 1212/1214 0800 FG FM121800 9999 SCT030', validTimeFrom: Date.UTC(2026, 10, 12, 12) / 1000, validTimeTo: Date.UTC(2026, 10, 13, 18) / 1000 }, new Date(Date.UTC(2026, 10, 12, 20))).bad.length === 0, 'tafAt FM arrête le BECMG');
  console.assert(tafAt({ rawTAF: 'TAF LFBO 121455Z 1214/1318 27010KT 9999 BKN020 BECMG 1300/1302 0800 FG', validTimeFrom: Date.UTC(2026, 10, 12, 14) / 1000, validTimeTo: Date.UTC(2026, 10, 13, 18) / 1000 }, new Date(Date.UTC(2026, 10, 13, 10))).bad.length === 1, 'tafAt BECMG persistant');

  // ---------- NOTAM de fermeture (terrain QFALC, piste QMRLC, ou texte « AD/RWY … CLSD / FERME »)
  const isClosure = (n) => /^(FA|MR)LC$/.test(n.q || '') || (!/^MX/.test(n.q || '') && /\b(AD|RWY|AERODROME|PISTE)\b/i.test(n.e || '') && /\b(CLSD|CLOSED|FERMEE?|FERMÉE?)\b/i.test(n.e || ''));
  const notamAt = (n, when) => { const a = Date.parse(n.from), z = Date.parse(n.to), t = when.getTime(); return !(a > t + 1800e3) && !(z < t - 1800e3); };

  // ---------- horaires ATS publiés (VAC, rubrique ATS) : fenêtre la plus large de la saison, ignorée si H24 ou introuvable
  const isSummer = (d) => /\+2/.test(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).format(d));
  console.assert(isSummer(new Date(Date.UTC(2026, 6, 1))) && !isSummer(new Date(Date.UTC(2026, 0, 1))), 'isSummer');
  function atsHours(v) {
    const txt = (v && v.infos) || '', blk = (txt.split(/Location :1 -/)[1] || '').split(/ATS :2 -/)[0];
    if (!blk || /\bH\s?24\b/.test(blk)) return null;
    return { blk, shift: /HOR ETE : -1HR/.test(txt), ppr: /PPR/.test(blk) };
  }
  function outsideHours(v, when) {
    const h = atsHours(v); if (!h) return null;
    const summer = isSummer(when), lines = h.blk.split('\n').filter((l) => !/^MIL\b/.test(l.trim()));
    const seasonal = lines.some((l) => /^(ETE|HIV)\b/.test(l.trim()));
    const use = seasonal ? lines.filter((l) => l.trim().startsWith(summer ? 'ETE' : 'HIV')) : lines;
    const rg = use.flatMap((l) => [...l.matchAll(/\b([0-2]\d)([0-5]\d)-([0-2]\d)([0-5]\d)\b/g)].map((m) => [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]));
    if (!rg.length) return null;
    const off = !seasonal && h.shift && summer ? -60 : 0, lo = Math.min(...rg.map((r) => r[0])) + off, hi = Math.max(...rg.map((r) => r[1])) + off;
    const t = when.getUTCHours() * 60 + when.getUTCMinutes(), hm = (x) => `${pad(Math.floor(x / 60))}${pad(x % 60)}`;
    return t < lo || t > hi ? { win: `${hm(lo)}-${hm(hi)} UTC`, ppr: h.ppr } : null;
  }

  // ---------- route au format plan de vol OACI (case 15) : coordonnées des points tournants
  const icaoCoord = ([la, lo]) => {
    const dm = (x) => { const a = Math.abs(x); let d = Math.floor(a), m = Math.round((a - d) * 60); if (m === 60) { d++; m = 0; } return [d, m]; };
    const [ld, lm] = dm(la), [od, om] = dm(lo);
    return `${pad(ld)}${pad(lm)}${la >= 0 ? 'N' : 'S'}${String(od).padStart(3, '0')}${pad(om)}${lo >= 0 ? 'E' : 'W'}`;
  };
  const icaoRoute = (b) => [`N${String(Math.round(b.f.tas)).padStart(4, '0')}VFR`, ...b.pts.slice(1, -1).map((p) => 'DCT ' + icaoCoord(p))].join(' ') + (b.pts.length > 2 ? '' : ' DCT');
  console.assert(icaoCoord([43.3833, -0.4167]) === '4323N00025W', 'icaoCoord');

  // plan de vol OACI pré-rempli (9) : cases à recopier dans SOFIA ; ce qui ne se déduit pas des données reste « à compléter »
  function fplFields(b) {
    const f = b.f, hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(Math.round(min % 60)).padStart(2, '0')}`;
    const endu = Math.floor((b.loaded - TAXI_L) / f.ff * 60), pob = 1 + (f.m2 > 0 ? 1 : 0) + (f.m3 > 0 ? Math.max(1, Math.round(f.m3 / 75)) : 0);
    const des = f.T.icao || null, z = new Date(b.depT), dof = z.toISOString().slice(2, 10).replace(/-/g, '');
    const lvl = `A${String(Math.round((b.legs[0].ft || f.ft) / 100)).padStart(3, '0')}`;
    const rte = icaoRoute(b).replace(/^N\d{4}VFR/, '').trim();
    return [
      ['7 Identification', f.ac.reg.replace(/-/g, '')], ['8 Règles / type de vol', 'V / G'],
      ['9 Nombre / type / turbulence', `1 / ${des || 'ZZZZ'} / L`], ['10 Équipement', 'à compléter selon l\'avion (ex. radio VHF, transpondeur : voir le carnet de route)'],
      ['13 Départ / heure (EOBT UTC)', `${f.dep} / ${hm(z.getUTCHours() * 60 + z.getUTCMinutes())}`],
      ['15 Vitesse / niveau / route', `N${String(Math.round(f.tas)).padStart(4, '0')} / ${lvl} / ${rte || 'DCT'}`],
      ['16 Destination / durée / dégagement', `${f.arr} / ${hm(b.totMin)}${f.alt ? ' / ' + f.alt : ''}`],
      ['18 Renseignements divers', [`DOF/${dof}`, des ? '' : `TYP/${f.T.label.replace(/[^A-Za-z0-9 /-]/g, '').toUpperCase()}`, 'RMK/VFR'].filter(Boolean).join(' ')],
      ['19 Autonomie / personnes', `E/${hm(endu)} · P/${pob}${f.m3 > 0 ? ' (passagers arrière estimés à 75 kg chacun : à corriger)' : ''}`],
      ['19 Équipement de survie, gilets, couleur', 'à compléter'], ['19 Pilote', f.pil || 'à compléter'],
    ];
  }
  console.assert((() => { const r = fplFields({ f: { ac: { reg: 'F-HAFF' }, T: { label: 'DR400 Rotax 912iS' }, dep: 'LFBP', arr: 'LFCH', alt: '', tas: 100, ff: 20, ft: 3500, m2: 0, m3: 0, pil: 'X' }, depT: new Date(Date.UTC(2026, 10, 26, 9, 5)), legs: [{ ft: 3500 }], loaded: 62, totMin: 65, pts: [[43, 0], [44, 0]] });
    return r[0][1] === 'FHAFF' && /1 \/ ZZZZ \/ L/.test(r[2][1]) && /LFBP \/ 0905/.test(r[4][1]) && /N0100 \/ A035/.test(r[5][1]) && /0105/.test(r[6][1]) && /E\/0300 · P\/1/.test(r[8][1]) && /TYP\/DR400 ROTAX 912IS/.test(r[7][1]); })(), 'fplFields');
  function fplHtml(b, sfx) {
    const F = fplFields(b);
    return `<details><summary><b>🗂️ Plan de vol pré-rempli</b> (cases OACI à recopier dans SOFIA)</summary><table class="legs">${F.map((r) => `<tr><td style="text-align:left;white-space:nowrap">${esc(r[0])}</td><td style="text-align:left"><code>${esc(r[1])}</code></td></tr>`).join('')}</table>
      <p class="meta">Type d'avion : code OACI non saisi dans la fiche avion, d'où ZZZZ + TYP/ (accepté). Heure : décollage prévu, à ajuster en heure de départ du parking. Vérifier chaque case avant le dépôt.</p></details>`;
  }

  // carburant au départ de l'étape suivante : plein du réservoir principal (limité par la masse max) ou carburant restant
  function nextFuel({ rem, cap, aux, refuel, dry, mtow, density }) {
    if (!refuel) { const fuel = Math.round(Math.min(rem, cap)); return { fuel, aux: Math.round(rem - fuel), add: 0, limited: false }; }
    const byMass = Math.floor((mtow - dry) / density) - aux, fuel = Math.max(Math.round(Math.min(rem, cap)), Math.min(cap, byMass));
    return { fuel, aux, add: Math.max(0, Math.round(fuel + aux - rem)), limited: byMass < cap };
  }
  console.assert(nextFuel({ rem: 40, cap: 160, aux: 0, refuel: true, dry: 1000, mtow: 1150, density: 0.72 }).fuel === 160, 'nextFuel plein complet');
  console.assert((() => { const x = nextFuel({ rem: 40, cap: 160, aux: 0, refuel: true, dry: 1100, mtow: 1150, density: 0.72 }); return x.fuel === 69 && x.limited && x.add === 29; })(), 'nextFuel limité par la masse');   // (1150-1100)/0,72 = 69 L
  console.assert(nextFuel({ rem: 50, cap: 160, aux: 0, refuel: false, dry: 1000, mtow: 1150, density: 0.72 }).fuel === 50, 'nextFuel sans plein');

  // terrain de la zone le plus proche ayant un METAR (dégagement automatique des escales)
  function nearestMetarAd(id) {
    const a = A.aptByIcao[id]; if (!a) return null;
    const c = Object.keys(A.metars).filter((k) => k !== id && k.startsWith('LF') && A.aptByIcao[k]).map((k) => ({ k, d: distNm([a.la, a.lo], [A.aptByIcao[k].la, A.aptByIcao[k].lo]) })).filter((x) => x.d > 2).sort((x, y) => x.d - y.d)[0];
    return c ? c.k : null;
  }
  // ---------- carburant disponible à une escale (VAC) : true / false / null (inconnu)
  const fuelNorm = (x) => String(x).toUpperCase().replace(/[\s-]/g, '');
  function fuelAvail(es, T) {
    const want = (T.fuel.name.match(/100\s?LL|UL\s?91|SP\s?98|JET\s?A-?1/gi) || []).map(fuelNorm);
    if (!es) return null;
    if (es.none) return false;
    const have = (es.fuel || []).map(fuelNorm);
    if (!have.length || !want.length) return null;
    return want.some((w) => have.some((h) => h.includes(w)));
  }
  console.assert(fuelAvail({ fuel: ['100LL', 'Jet A1'] }, { fuel: { name: 'AVGAS 100LL (0,72)' } }) === true && fuelAvail({ fuel: ['Jet A1'] }, { fuel: { name: 'SP98 / UL91 (0,72)' } }) === false, 'fuelAvail');
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
  let ZONES = null, VAC = null, ASP = null, SPECIAL = null, LANDM = null, FIRES = null;
  async function loadAip() {
    if (!ZONES) ZONES = await A.getLive('zones.json').catch(() => ({ data: [] }));
    if (!VAC) VAC = await A.getLive('vac.json').catch(() => ({ data: {} }));
    if (!ASP) ASP = await A.getLive('airspaces.json').catch(() => ({ data: [] }));
    if (!SPECIAL) SPECIAL = await A.getLive('special.json').catch(() => ({ act: [], zsm: [] }));
    if (!LANDM) LANDM = await A.getJSON('data/landmarks.json', 'default').catch(() => ({ towns: [], mw: {}, rv: {}, lk: [] }));
    if (!FIRES) FIRES = await A.getLive('fires.json').catch(() => ({ data: [] }));
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
      const lab = Object.keys(CUSTOM).find((k) => CUSTOM[k].token === id) || `PT${++customN}`;   // même point -> même libellé (calculs simultanés, comparaison)
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
  // température et vent à 10 m prévus, un point par terrain à son heure
  async function surfaceForecast(list) {
    const ap = list.map(([id]) => A.aptByIcao[id]), days = list.map(([, t]) => t.toISOString().slice(0, 10)).sort();
    let d = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${ap.map((a) => (+a.la).toFixed(3)).join(',')}&longitude=${ap.map((a) => (+a.lo).toFixed(3)).join(',')}`
      + `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`);
    if (!Array.isArray(d)) d = [d];
    return list.map(([, t], i) => { const h = d[i].hourly, k = h.time.indexOf(roundHour(t)); return k < 0 ? null : { temp: h.temperature_2m[k], wdir: h.wind_direction_10m[k], wspd: h.wind_speed_10m[k], gust: h.wind_gusts_10m[k] }; });
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
  const parseAlt = A.altFt;   // -> ft ; ASFC / AGL : valeur brute, le sol est ajouté par l'appelant
  console.assert(parseAlt('3300ft ASFC') === 3300 && parseAlt('( LFRJ ARP ) 500ft ASFC') === 500 && parseAlt('SFC') === 0 && parseAlt('FL 65') === 6500 && parseAlt('UNL') === 99999, 'parseAlt ASFC');
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
  }  console.assert((() => { const r = rtbaActivations([{ e: 'ZONES AIRFORCE RTBA ACT ZONE R45A PYRENEES 0900-1100:ACTIVE 1300-1500:ACTIVE ZONE R 46 E CORBIERES 0800-0930:ACTIVE' }]);
    return r.length === 2 && r[0].zone === 'R45A' && r[0].slots.join() === '0900-1100,1300-1500' && r[1].zone === 'R46E' && r[1].slots.join() === '0800-0930'; })(), 'rtbaActivations');

  function slotOverlap(slot, dayStartMs, t0, t1) {
    const s = +slot.slice(0, 2) * 60 + +slot.slice(2, 4), e = +slot.slice(5, 7) * 60 + +slot.slice(7, 9);
    const a = dayStartMs + s * 6e4, b = dayStartMs + (e <= s ? e + 1440 : e) * 6e4;
    return a < t1 && b > t0;
  }

  // ---------- activité d'une zone R / D à l'heure du vol, d'après sa remarque AIP et les NOTAM
  // 'active' (H24, horaire publié couvrant le vol ou NOTAM d'activation), 'inactive' (horaire publié hors du vol), 'activable' (sur NOTAM / AUP, inconnu)
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  function zoneStatus(z, t0, t1, notams = []) {
    const r = (z.rmk || '').replace(/\s+/g, ' '), key = z.id.replace(/\s/g, '');
    const nt = notams.find((n) => (n.q || '')[0] === 'R' && new RegExp(`\\b${key.replace(/(\D)(\d)/g, '$1 ?$2').replace(/(\d)([A-Z])/g, '$1 ?$2')}\\b`).test(n.e || '') && Date.parse(n.from) < t1 && !(Date.parse(n.to) < t0));
    if (nt) return { st: 'active', why: `NOTAM ${nt.ref}` };
    if (/^(?:Activity\s*:?\s*)?H24\b/i.test(r)) return { st: 'active', why: 'H24' };
    const m = /^Activity\s*:?\s*(.*?)(?:Other times|Activités|$)/i.exec(r);
    if (m && !/possible|NOTAM\b.*announced|announced/i.test(m[1].slice(0, 30))) {
      const sum = /SUM\s*:?\s*-\s*1\s*H/i.test(r) && isSummer(new Date(t0)) ? 60 : 0;
      const slots = [...m[1].matchAll(/((?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*-\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN))?)[^:]*:\s*(\d{4})\s*-\s*(\d{4})/g)];
      if (slots.length) {
        const on = (t) => { const d = new Date(t), dow = d.getUTCDay(), mn = d.getUTCHours() * 60 + d.getUTCMinutes() + sum;
          return slots.some(([, days, a, b]) => { const [d0, d1 = d0] = days.split(/\s*-\s*/).map((x) => DAYS.indexOf(x)), inDay = d0 <= d1 ? dow >= d0 && dow <= d1 : dow >= d0 || dow <= d1;
            return inDay && mn >= +a.slice(0, 2) * 60 + +a.slice(2) && mn <= +b.slice(0, 2) * 60 + +b.slice(2); }); };
        const act = [t0, (t0 + t1) / 2, t1].some(on);
        return { st: act ? 'active' : 'inactive', why: `horaire AIP ${m[1].slice(0, 70).trim()}${act ? '' : ' (hors horaire, sauf NOTAM)'}` };
      }
    }
    return { st: 'activable', why: /NOTAM/i.test(r) ? 'activation par NOTAM' : /AUP|UUP/.test(r) ? 'activation AUP/UUP' : 'activation possible' };
  }
  console.assert((() => { const wed10 = Date.UTC(2026, 10, 25, 10), sun10 = Date.UTC(2026, 10, 29, 10), z = { id: 'R 13 A1', rmk: 'Activity: MON-THU except HOL: 0700- 2359. FRI: 0700- 1600.Other times, possible activation by NOTAM. SUM:-1HR.' };
    return zoneStatus(z, wed10, wed10 + 36e5).st === 'active' && zoneStatus(z, sun10, sun10 + 36e5).st === 'inactive' && zoneStatus({ id: 'R 9 A', rmk: 'H24 Activités' }, wed10, wed10).st === 'active'
      && zoneStatus({ id: 'R 2', rmk: 'Possible activation H24' }, wed10, wed10).st === 'activable' && zoneStatus({ id: 'R 46 G', rmk: 'Possible activation' }, wed10, wed10 + 36e5, [{ q: 'RRCA', e: 'R46 G ACTIVE', ref: 'X', from: '2026-11-25T08:00Z', to: '2026-11-25T12:00Z' }]).st === 'active'; })(), 'zoneStatus');

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
  function townNear(p, towns) {   // ville la plus proche (cadre de ~6 NM)
    let t = null;
    for (const [n, la, lo] of towns) { if (Math.abs(la - p[0]) > .1 || Math.abs(lo - p[1]) > .14) continue; const d = distNm(p, [la, lo]); if (!t || d < t.d) t = { n, d }; }
    return t;
  }
  // route facile : point de contournement remplacé par un point VFR publié à ≤ 3 NM si la route reste hors des zones évitées, sinon nommé d'après la ville la plus proche
  function nameDetours(r, obs, vfr, towns) {
    const clear = (a, b) => { const d = distNm(a, b), tc = bearing(a, b), n = Math.max(2, Math.ceil(d / 0.5));
      for (let k = 1; k <= n; k++) { const p = destPt(a, tc, d * k / n); if (obs.some((o) => inPoly(p, o.z.poly))) return false; } return true; };
    r.ids.forEach((id, i) => {
      const d = r.detours.find((x) => x.id === id); if (!d) return;
      const v = vfr.map((x) => ({ ...x, d: distNm(r.pts[i], x.p) })).filter((x) => x.d <= 3).sort((x, y) => x.d - y.d)
        .find((x) => clear(r.pts[i - 1], x.p) && clear(x.p, r.pts[i + 1]));
      if (v) { r.pts[i] = d.p = v.p; r.ids[i] = d.id = v.tok; d.name = v.desc; return; }
      const t = townNear(r.pts[i], towns);
      if (t && t.d <= 5) d.name = t.d < 1.5 ? `sur ${t.n}` : `près ${/^[AEIOUYÉÈÂÎH]/i.test(t.n) ? "d'" : 'de '}${t.n}`;
    });
    return r;
  }
  console.assert((() => { const sq = [[0, -0.1], [0.1, -0.1], [0.1, 0.1], [0, 0.1]], mk = () => ({ pts: [[-0.2, 0], [0.05, 0.13], [0.3, 0]], ids: ['A', 'DT1', 'B'], detours: [{ id: 'DT1', p: [0.05, 0.13] }] });
    const r1 = nameDetours(mk(), [{ z: { poly: sq } }], [{ tok: 'XX-W', p: [0.05, 0.08], desc: 'dedans' }, { tok: 'XX-E', p: [0.05, 0.16], desc: 'pont' }], []);
    const r2 = nameDetours(mk(), [{ z: { poly: sq } }], [], [['Ville', 0.05, 0.14, 3000]]);
    return r1.ids[1] === 'XX-E' && r1.detours[0].name === 'pont' && r2.ids[1] === 'DT1' && r2.detours[0].name === 'sur Ville'; })(), 'nameDetours');

  // route de vallée : dans un couloir de ±15 NM (grille 3 NM), chemin dont le point le plus haut est le plus bas possible ; départ et arrivée au centre
  function lowPath(el, V) {   // el[colonne][j] en ft
    const c0 = V.indexOf(0);
    let best = V.map((_, j) => (j === c0 ? { max: el[0][c0], d: 0, path: [c0] } : null));
    for (let u = 1; u < el.length; u++) best = V.map((_, j) => {
      let o = null;
      for (const k of [j - 1, j, j + 1]) { const p = best[k]; if (!p) continue; const m = Math.max(p.max, el[u][j]), d = p.d + Math.abs(V[j] - V[k]); if (!o || m < o.max - 50 || (m <= o.max + 50 && d < o.d)) o = { max: m, d, path: [...p.path, j] }; }
      return o;
    });
    return best[c0];
  }
  console.assert((() => { const r = lowPath([[0, 0, 0], [0, 0, 0], [100, 5000, 9000], [0, 0, 0], [0, 0, 0]], [-3, 0, 3]); return r.max === 100 && r.path[2] === 0 && r.path[4] === 1; })(), 'lowPath');
  async function valleyRoute(a, b) {
    const D = distNm(a, b), tc = bearing(a, b), nu = Math.max(4, Math.round(D / 3)), V = [-15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15];
    const grid = []; for (let u = 0; u <= nu; u++) { const c = destPt(a, tc, D * u / nu); grid.push(V.map((v) => (v ? destPt(c, tc + 90, v) : c))); }
    const flat = await elevations(grid.flat()), r = lowPath(grid.map((row, u) => row.map((_, j) => (flat[u * V.length + j] || 0) * 3.281)), V);
    if (!r) return null;
    const pts = [];   // points tournants : changements de direction du chemin, espacés d'au moins 6 NM
    for (let u = 1; u < nu; u++) { const [p0, p1, p2] = r.path.slice(u - 1, u + 2), q = grid[u][p1]; if (p1 - p0 !== p2 - p1 && (!pts.length || distNm(q, pts[pts.length - 1]) >= 6)) pts.push(q); }
    return { pts: pts.slice(0, 10), maxFt: Math.round(r.max) };
  }
  // clairances de la route facile : pour chaque espace C / D / CTR (ou A) coupé à l'altitude prévue, passer dessous si le relief le permet, sinon appeler à 5 NM
  function clearancesOf(b) {
    const v = b.vprofile; if (!v) return [];
    const seen = new Set();
    return v.conflicts.filter((sg) => /\((?:A|C|D)\)|CTR/.test(sg.name) && !seen.has(sg.name) && seen.add(sg.name)).sort((x, y) => x.from - y.from).map((sg) => {
      const under = !sg.aglL && sg.lower > 0 ? Math.floor((sg.lower - 500) / 100) * 100 : null;
      return { name: sg.name, a: /\(A\)/.test(sg.name), under: under != null && under >= Math.max(0, ...sg.ter) + 1000 ? under : null, freq: sg.freq ? String(sg.freq).split(' / ')[0] : null, nm: Math.max(0, sg.from - 5) };
    });
  }
  const clearHtml = (b) => clearancesOf(b).map((c) => `<b>${esc(c.name)}</b> : ${c.a ? 'classe A, interdite en VFR' : `${c.under ? `passer sous ${c.under} ft ou ` : ''}appeler ${c.freq ? esc(c.freq) : '(fréquence : voir carte)'} ${c.nm < 1 ? 'dès le départ' : `à ${c.nm.toFixed(0)} NM`}`}`).join(' · ');
  console.assert((() => { const c = clearancesOf({ vprofile: { conflicts: [{ name: 'TMA X (D)', from: 59, ter: [500], lower: 3500, aglL: false, freq: '123.930 / 120.000' }, { name: 'TMA X (D)', from: 70, ter: [], lower: 3500 }, { name: 'CTR Y (D)', from: 20, ter: [800], lower: 0, aglL: false }] } });
    return c.length === 2 && c[0].name === 'CTR Y (D)' && c[0].under === null && c[1].under === 3000 && c[1].freq === '123.930' && c[1].nm === 54; })(), 'clearancesOf');

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
      ${store.get('favs', []).length ? `<div class="row" style="margin:4px 0"><label>⭐ Mes navs <select id="pf-fav"><option value="">— choisir —</option>${store.get('favs', []).map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select></label><button type="button" class="btn" id="pf-fav-del">🗑️</button></div>` : ''}
      <div class="steps" role="tablist"><button type="button" class="step on" data-step="1"><i>1</i>Trajet</button><button type="button" class="step" data-step="2"><i>2</i>Avion et chargement</button><button type="button" class="step" data-step="3"><i>3</i>Pilote</button></div>
      <div class="prep-form pf-step on" data-stepp="1">
        <label>Départ <button type="button" class="pick-btn" data-pick="pf-dep" title="Choisir sur la carte">📍</button><input id="pf-dep" list="apt-list" value="${esc(f.dep || '')}" placeholder="LFBP" autocomplete="off"></label>
        <label>Arrivée <button type="button" class="pick-btn" data-pick="pf-arr" title="Choisir sur la carte">📍</button><input id="pf-arr" list="apt-list" value="${esc(f.arr || '')}" placeholder="LFRN" autocomplete="off"></label>
        <label class="full">Points tournants (terrains OACI ou points VFR comme BP-N, optionnel) <button type="button" class="pick-btn" data-pick="pf-wps" title="Choisir sur la carte">📍</button> <span class="meta">📍 puis clic sur la carte pour ajouter un point</span><input id="pf-wps" value="${esc(f.wps || '')}" placeholder="LFBX BI-N"></label>
        <label>Point de sortie (départ)<select id="pf-exit"><option value="auto">Auto (le plus direct)</option><option value="none">Aucun (direct)</option></select></label>
        <label>Point d'entrée (arrivée)<select id="pf-entry"><option value="auto">Auto (le plus direct)</option><option value="none">Aucun (direct)</option></select></label>
        <label>Départ (heure locale)<input id="pf-time" type="datetime-local" value="${localInput(next)}"></label>
        <label>Dégagement (destination finale) <button type="button" class="pick-btn" data-pick="pf-alt" title="Choisir sur la carte">📍</button><input id="pf-alt" list="apt-list" value="${esc(f.alt || '')}" placeholder="LFRD" autocomplete="off"></label>
        <div class="full" id="pf-adcheck"></div>
        <label>Couloir (NM de part et d'autre)<input id="pf-cor" type="number" min="2" max="30" value="${esc(f.cor || 10)}"></label>
        <label>Éviter<select id="pf-avoid">
          <option value="p+rtba" ${!['p', 'none', 'easy'].includes(f.avoid) ? 'selected' : ''}>Zones P + RTBA actives</option>
          <option value="easy" ${f.avoid === 'easy' ? 'selected' : ''}>Route « VFR facile » : P, RTBA, ZRT, R / D actives et espaces C / D</option>
          <option value="p" ${f.avoid === 'p' ? 'selected' : ''}>Zones P seulement</option>
          <option value="none" ${f.avoid === 'none' ? 'selected' : ''}>Ne rien contourner</option></select></label>
        <details class="full more"><summary>Escales, aller-retour, vol local</summary><div class="prep-form">
        <label class="full">Escales suivantes (aller-retour, voyage : ex. « LFCH LFBP »)<input id="pf-stages" value="${esc(f.stages || '')}" placeholder="vide = vol simple ; LFBP pour revenir au départ" autocomplete="off"></label>
        <label><input id="pf-rt" type="checkbox" ${f.rt ? 'checked' : ''}> Aller-retour (retour au départ ajouté)</label>
        <label><input id="pf-local" type="checkbox" ${f.local ? 'checked' : ''}> Vol local (pas d'arrivée ailleurs)</label>
        <label>Vol local : durée (min) / rayon (NM)<span class="row"><input id="pf-ldur" type="number" min="10" max="300" step="10" value="${esc(f.ldur || 60)}" style="width:70px"><input id="pf-lrad" type="number" min="3" max="40" value="${esc(f.lrad || 15)}" style="width:60px"></span></label>
        <label>Prix du carburant aux escales (€/L, option)<input id="pf-fuelprice" type="number" min="0" max="10" step="0.01" value="${esc(f.fuelPrice || '')}"></label>
        <label class="full" title="Pour chaque escale : passager avant / passagers arrière / bagages (kg) au départ de cette escale. Ex. « LFCH:0/0/15 » = on dépose le passager à Arcachon">Charges différentes au départ des escales (option)<input id="pf-stload" value="${esc(f.stload || '')}" placeholder="ex. LFCH:0/0/15 LFBP:75/0/10"></label>
        <label>Temps d'escale (min)<input id="pf-turn" type="number" min="0" max="600" step="5" value="${esc(f.turn ?? 45)}"></label>
        <label>Avitaillement aux escales<select id="pf-refuel"><option value="0" ${f.refuel ? '' : 'selected'}>Non (carburant restant)</option><option value="1" ${f.refuel ? 'selected' : ''}>Oui (plein du réservoir principal)</option></select></label>
        <label>Dégagements des escales (dans l'ordre, vide = auto)<input id="pf-stalts" value="${esc(f.stalts || '')}" placeholder="auto : terrain à METAR le plus proche" autocomplete="off"></label>
        </div></details>
        <div class="full step-nav"><button type="button" class="btn" data-goto-step="2">Suivant : avion et chargement ›</button></div>
      </div>
      <div class="prep-form pf-step" data-stepp="2">
        <label>Avion<select id="pf-reg">${FLEET.map((a) => `<option value="${a.reg}" ${a.reg === reg ? 'selected' : ''}>${a.reg} — ${esc(TYPES[a.type].label)}</option>`).join('')}</select></label>
        <label>Régime<select id="pf-regime">${regimeOptions(reg, f.regime)}</select></label>
        <label>Immatriculation (si différente)<input id="pf-immat" value="${esc(f.immat || '')}" placeholder="${esc(reg)}"></label>
        <label>Masse à vide (kg)<input id="pf-empty" type="number" min="100" max="2000" value="${(FLEET.find((x) => x.reg === reg) || {}).empty || ''}"></label>
        <p class="meta full" id="pf-acnote" style="grid-column:1/-1;margin:0"></p>
        <label>Altitude croisière (ft)<input id="pf-ft" type="number" min="500" max="12000" step="500" value="${esc(f.ft || 2500)}"></label>
        <label title="Une altitude par branche de la 1re étape (ex. 3000 5500 2000) ; vide = altitude de croisière partout">Altitudes par branche (ft, option)<input id="pf-legft" placeholder="ex. 3000 5500 2000" value="${esc(f.legft || '')}"></label>
        <label>Pilote (kg)<input id="pf-m1" type="number" min="0" max="150" value="${esc(f.m1 ?? 80)}"></label>
        <label>Copilote / passager avant (kg)<input id="pf-m2" type="number" min="0" max="150" value="${esc(f.m2 ?? 0)}"></label>
        <label>Passagers arrière (kg)<input id="pf-m3" type="number" min="0" max="250" value="${esc(f.m3 ?? 0)}"></label>
        <label>Bagages (kg)<input id="pf-m4" type="number" min="0" max="60" value="${esc(f.m4 ?? 10)}"></label>
        <label>Carburant au départ (L)<input id="pf-fuel" type="number" min="0" max="200" value="${esc(f.fuel ?? 100)}"></label>
        <label id="pf-aux-l">Réservoir supp. (L)<input id="pf-aux" type="number" min="0" max="50" value="${esc(f.aux ?? 0)}"></label>
        <label>Réserve finale (min)<input id="pf-res" type="number" min="0" max="120" value="${esc(f.res ?? 30)}"></label>
        <label>Réserve météo (% si vent de face > 15 kt ou météo marginale)<input id="pf-wxres" type="number" min="0" max="50" step="5" value="${esc(f.wxres ?? 10)}"></label>
        <div class="full step-nav"><button type="button" class="btn" data-goto-step="1">‹ Trajet</button><button type="button" class="btn" data-goto-step="3">Suivant : pilote ›</button></div>
      </div>
      <div class="prep-form pf-step" data-stepp="3">
        <datalist id="pil-list">${Object.keys(store.get('pilots', {})).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <label>Partage du coût entre (personnes)<input id="pf-share" type="number" min="1" max="4" value="${esc(f.share || 1)}"></label>
        <label>Pilote (nom, profil mémorisé sur cet appareil)<input id="pf-pil" list="pil-list" value="${esc(f.pil || '')}" autocomplete="off"></label>
        <label>Licence / prorogation SEP valable jusqu'au<input id="pf-lic" type="date"></label>
        <label>Certificat médical valable jusqu'au<input id="pf-med" type="date"></label>
        <label><input id="pf-nuit" type="checkbox"> Qualification vol de nuit</label>
        <details class="full" id="pf-logbox"><summary>📓 Carnet de vol récent (expérience récente, prorogation SEP)</summary>
          <div id="pf-log"></div>
          <div class="row"><input id="pf-log-d" type="date"><input id="pf-log-n" type="number" min="1" max="20" value="1" style="width:60px" title="atterrissages"> atterrissage(s)
            <label><input id="pf-log-i" type="checkbox"> avec instructeur</label><button type="button" class="btn" id="pf-log-add">Ajouter</button></div>
        </details>
        <details class="full arms-box" id="pf-arms-box"><summary>⚖️ Bras de levier et enveloppe de centrage (fiche de pesée)</summary>
          <p class="meta">Valeurs en mètres depuis la référence du manuel de vol. Vide = valeur par défaut (indiquée en grisé). Mémorisé pour chaque avion sur cet appareil.</p>
          <div class="prep-form" id="pf-arms"></div>
        </details>
        <div class="full step-nav"><button type="button" class="btn" data-goto-step="2">‹ Avion et chargement</button></div>
      </div>
      <div class="prep-actions">
        <button class="btn primary" id="pf-calc">Calculer la route</button>
        <button class="btn" id="pf-pdf">📄 Briefing PDF + log Excel</button>
        <button class="btn" id="pf-xlsx">📊 Log Excel seul</button>
        <button class="btn" id="pf-train">🎲 Nav d'entraînement</button>
        <button class="btn" id="pf-fav-save">⭐ Enregistrer cette nav</button>
      </div>
      <div class="row" style="margin:4px 0"><label>🧭 Où voler ? Temps aller max (min) <input id="pf-where-min" type="number" min="15" max="240" step="5" value="60"></label><button class="btn" id="pf-where">Chercher les destinations</button></div>
      <div class="row" style="margin:4px 0"><label>⚖️ Comparer avec un autre départ <input id="pf-cmp-time" type="datetime-local"></label><button class="btn" id="pf-cmp">Comparer</button></div>
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
    // profil pilote : masse et dates de validité mémorisées localement (jamais dans le lien de partage)
    const showLog = () => {
      const name = $('#pf-pil').value.trim(), log = (pilotOf(name).log || []).slice().sort((x, y) => y.d.localeCompare(x.d)), d90 = Date.now() - 90 * 864e5;
      $('#pf-log').innerHTML = !name ? '<p class="meta">Indique d\'abord le nom du pilote.</p>' : `<p class="meta">${log.filter((e) => Date.parse(e.d) >= d90).reduce((s, e) => s + (+e.n || 0), 0)} atterrissage(s) dans les 90 derniers jours.</p>`
        + log.slice(0, 30).map((e, i) => `<div class="meta">${e.d.split('-').reverse().join('/')} · ${e.n} att.${e.i ? ' · instructeur' : ''}${e.reg ? ' · ' + esc(e.reg) : ''}${e.r ? ' · ' + esc(e.r) : ''} <button type="button" class="btn" data-del="${esc(e.d + '|' + i)}">✕</button></div>`).join('');
      $('#pf-log').querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => {
        const all = store.get('pilots', {}), pr = all[name] || {}, k = log[+x.dataset.del.split('|')[1]];
        pr.log = (pr.log || []).filter((e) => (k.id ? e.id !== k.id : !(e.d === k.d && e.n === k.n && e.r === k.r && !e.id))); all[name] = pr; store.set('pilots', all); showLog();
      }));
    };
    const loadPilot = () => { const pr = store.get('pilots', {})[$('#pf-pil').value.trim()]; showLog(); if (!pr) return; if (pr.m) $('#pf-m1').value = pr.m; $('#pf-lic').value = pr.lic || ''; $('#pf-med').value = pr.med || ''; $('#pf-nuit').checked = !!pr.nuit; };
    $('#pf-log-add').addEventListener('click', () => {
      const name = $('#pf-pil').value.trim(), d = $('#pf-log-d').value; if (!name || !d) return;
      addLog(name, { d, n: +$('#pf-log-n').value || 1, i: $('#pf-log-i').checked }); showLog();
    });
    $('#pf-pil').addEventListener('change', loadPilot); loadPilot();
    // régime : prendre celui dont l'altitude est la plus proche de la croisière (même régime moteur si possible)
    $('#pf-ft').addEventListener('change', () => {
      const T = TYPES[(FLEET.find((x) => x.reg === $('#pf-reg').value) || FLEET[0]).type], ft = +$('#pf-ft').value;
      const rs = T.regimes.map((r, i) => ({ i, ft: regFt(r.name), rpm: r.name.split(' - ')[1] })).filter((r) => r.ft != null);
      if (!rs.length) return;
      const best = Math.min(...rs.map((r) => Math.abs(r.ft - ft))), near = rs.filter((r) => Math.abs(r.ft - ft) === best);
      const cur = rs.find((r) => r.i === +$('#pf-regime').value);
      $('#pf-regime').value = (near.find((r) => cur && r.rpm === cur.rpm) || near[0]).i;
    });
    $('#pf-calc').addEventListener('click', () => run(false));
    $('#pf-pdf').addEventListener('click', () => run('pdf'));
    $('#pf-xlsx').addEventListener('click', () => run('xlsx'));
    $('#pf-train').addEventListener('click', trainingStart);
    $('#pf-where').addEventListener('click', async () => {
      const prog = $('#pf-prog'), my = ++runSeq;
      try { const h = await whereToFly(readForm(), +$('#pf-where-min').value || 60, (t) => { if (my === runSeq) prog.textContent = t; }); if (my === runSeq) { $('#pf-out').innerHTML = h; prog.textContent = ''; } }
      catch (e) { if (my === runSeq) prog.textContent = '⚠️ ' + e.message; }
    });
    $('#pf-out').addEventListener('click', (e) => { const x = e.target.closest('[data-goto]'); if (!x) return; $('#pf-arr').value = x.dataset.goto; $('#pf-wps').value = ''; $('#pf-stages').value = ''; $('#pf-alt').value = ''; run(false); });
    ['#pf-dep', '#pf-arr', '#pf-alt', '#pf-stages', '#pf-wps', '#pf-reg'].forEach((x) => $(x) && $(x).addEventListener('change', adCheckHtml));
    loadAip().then(adCheckHtml).catch(() => {});
    // navs enregistrées (sur cet appareil) : tout le formulaire sauf l'heure
    $('#pf-fav-save').addEventListener('click', () => {
      const f = readForm(), name = prompt('Nom de la nav :', [f.dep, f.arr, ...(f.stages || '').split(/\s+/).filter(Boolean)].join(' → ') + (f.rt ? ' (A/R)' : ''));
      if (!name) return;
      const favs = store.get('favs', []).filter((x) => x.name !== name);
      favs.unshift({ name, form: Object.fromEntries(FORM_KEYS.filter((k) => k !== 'time').map((k) => [k, f[k]])) });
      store.set('favs', favs.slice(0, 40)); $('#pf-prog').textContent = `⭐ « ${name} » enregistrée.`;
    });
    if ($('#pf-fav')) {
      $('#pf-fav').addEventListener('change', (e) => { const x = store.get('favs', [])[+e.target.value]; if (!x) return; const t = $('#pf-time').value; store.set('form', { ...store.get('form', {}), ...x.form }); openForm(); $('#pf-time').value = t; });
      $('#pf-fav-del').addEventListener('click', () => { const i = $('#pf-fav').value; if (i === '') return; const favs = store.get('favs', []); if (!confirm(`Supprimer « ${favs[+i].name} » ?`)) return; favs.splice(+i, 1); store.set('favs', favs); openForm(); });
    }
    $('#pf-cmp').addEventListener('click', compareTimes);
    ['#pf-dep', '#pf-arr', '#pf-alt', '#pf-wps', '#pf-stages', '#pf-stalts'].forEach((s) => $(s).addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); }));
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
      stalts: v('#pf-stalts').toUpperCase(), legft: v('#pf-legft'), stload: v('#pf-stload').toUpperCase(), fuelPrice: +v('#pf-fuelprice') || 0, local: !!($('#pf-local') && $('#pf-local').checked), ldur: +v('#pf-ldur') || 60, lrad: +v('#pf-lrad') || 15, rt: !!($('#pf-rt') && $('#pf-rt').checked), lic: v('#pf-lic'), med: v('#pf-med'), share: +v('#pf-share') || 1, wxres: +v('#pf-wxres') || 0,
    };
    store.set('form', { ...f, time: undefined, lic: undefined, med: undefined });
    if (f.pil) { const all = store.get('pilots', {}); all[f.pil] = { ...(all[f.pil] || {}), m: f.m1, lic: f.lic, med: f.med, nuit: $('#pf-nuit').checked }; store.set('pilots', all); }
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

  // ---------- comparaison de deux départs (même nav, autre date / heure) : vent, météo, AZBA, carburant, alertes
  function tripSummary(trip) {
    const b0 = trip[0], bN = trip[trip.length - 1], al = trip.flatMap((b) => alertsOf(b));
    const head = trip.reduce((s, b) => s + b.legs.reduce((t, lg) => t + (lg.wind ? lg.wind.spd * Math.cos(rad(lg.wind.dir - lg.tc)) : 0) * lg.dist, 0), 0) / Math.max(1, trip.reduce((s, b) => s + b.totDist, 0));
    return { dep: b0.depT, eta: bN.eta, min: trip.reduce((s, b) => s + b.totMin, 0), fuel: trip.reduce((s, b) => s + b.totFuel, 0), head: Math.round(head),
      wx: Math.max(...trip.map((b) => (b.wxRoute && b.wxRoute.worst) || 0)), azba: trip.some((b) => b.rtba.some((r) => r.conflict && r.crossed && r.below)),
      imp: trip.reduce((s, b) => s + (b.optAlt ? b.optAlt.plan.filter((c) => c.hard.length).length : 0), 0), stop: al.filter((x) => /^⛔/.test(x)).length, al: al.length,
      night: trip.some((b) => b.night && (b.night.late || b.night.firstDark)), gust: Math.max(0, ...trip.flatMap((b) => ((b.wxRoute && b.wxRoute.pts) || []).map((p) => p.gust || 0))) };
  }
  async function compareTimes() {
    const t2 = $('#pf-cmp-time').value, prog = $('#pf-prog');
    if (!t2) { prog.textContent = 'Choisis la date et l\'heure à comparer.'; return; }
    try {
      const f = readForm(); if (!f.dep || !f.arr) throw new Error('Indique un départ et une arrivée.');
      prog.textContent = 'Comparaison : calcul des deux départs…';
      const a = await buildTrip(f, (t) => { prog.textContent = 'Départ 1 : ' + t; }), b = await buildTrip({ ...f, time: t2 }, (t) => { prog.textContent = 'Départ 2 : ' + t; });
      const A1 = tripSummary(a), B1 = tripSummary(b), row = (l, x, y, better) => `<tr><td style="text-align:left">${l}</td><td${better === 1 ? ' style="color:#2ecc40;font-weight:bold"' : ''}>${x}</td><td${better === 2 ? ' style="color:#2ecc40;font-weight:bold"' : ''}>${y}</td></tr>`;
      const cmp = (x, y) => (x < y ? 1 : y < x ? 2 : 0);
      const score = (s) => s.stop * 100 + s.imp * 50 + s.wx * 20 + (s.azba ? 30 : 0) + (s.night ? 20 : 0) + s.fuel + Math.max(0, s.head);
      const best = cmp(score(A1), score(B1));
      $('#pf-out').insertAdjacentHTML('afterbegin', `<h4>⚖️ Comparaison de deux départs</h4><table class="legs"><tr><th></th><th>Départ 1</th><th>Départ 2</th></tr>
        ${row('Départ → arrivée (UTC)', `${utc(A1.dep)} → ${utc(A1.eta)}`, `${utc(B1.dep)} → ${utc(B1.eta)}`)}
        ${row('Temps de vol', hhmm(A1.min), hhmm(B1.min), cmp(A1.min, B1.min))}${row('Carburant', A1.fuel + ' L', B1.fuel + ' L', cmp(A1.fuel, B1.fuel))}
        ${row('Vent de face moyen', A1.head + ' kt', B1.head + ' kt', cmp(A1.head, B1.head))}${row('Météo en route', WXTXT[A1.wx], WXTXT[B1.wx], cmp(A1.wx, B1.wx))}
        ${row('Rafales max', Math.round(A1.gust) + ' kt', Math.round(B1.gust) + ' kt', cmp(A1.gust, B1.gust))}${row('AZBA active traversée', A1.azba ? 'oui' : 'non', B1.azba ? 'oui' : 'non', cmp(+A1.azba, +B1.azba))}
        ${row('Branches sans altitude possible', A1.imp, B1.imp, cmp(A1.imp, B1.imp))}${row('Alertes bloquantes (⛔) / total', `${A1.stop} / ${A1.al}`, `${B1.stop} / ${B1.al}`, cmp(A1.stop * 100 + A1.al, B1.stop * 100 + B1.al))}
        ${row('Nuit aéronautique', A1.night ? 'oui' : 'non', B1.night ? 'oui' : 'non', cmp(+A1.night, +B1.night))}</table>
        <p class="meta">${best ? `<b>Plutôt le départ ${best}</b> (moins d'alertes, meilleure météo, moins de carburant).` : 'Les deux départs se valent.'} Prévisions modèle : confirmer avec TAF, TEMSI et AZBA du jour.</p>`);
      prog.textContent = '';
    } catch (e) { console.error(e); prog.textContent = e.message || String(e); }
  }
  // « LFCH:0/0/15 LFBP:75/0/10 » -> charges au départ de l'escale demandée { m2, m3, m4 } (kg), ou null
  function stageLoad(txt, id) {
    const m = new RegExp(`\\b${id}:(\\d+)/(\\d+)/(\\d+)\\b`).exec(txt || '');
    return m ? { m2: +m[1], m3: +m[2], m4: +m[3] } : null;
  }
  console.assert(JSON.stringify(stageLoad('LFCH:0/0/15 LFBP:75/0/10', 'LFBP')) === '{"m2":75,"m3":0,"m4":10}' && stageLoad('LFCH:0/0/15', 'LFBP') === null, 'stageLoad');
  // construction du voyage (toutes les étapes) sans affichage : sert au calcul, à la comparaison de deux horaires et à la surveillance
  const revLeg = (f) => ({ wps: (f.wps || '').split(/[\s,;]+/).filter(Boolean).reverse().join(' '), exit: f.entry || 'auto', entry: f.exit || 'auto' });
  console.assert((() => { const r = revLeg({ wps: 'A B,C', exit: 'LFBP-N', entry: 'auto' }); return r.wps === 'C B A' && r.exit === 'auto' && r.entry === 'LFBP-N'; })(), 'revLeg');
  async function buildTrip(f, say = () => {}) {
    const stops = f.stages.split(/[\s,;]+/).filter(Boolean);
    if (f.rt && (stops[stops.length - 1] || f.arr) !== f.dep) stops.push(f.dep);   // aller-retour : retour au terrain de départ
    const stAlts = (f.stalts || '').split(/[\s,;]+/).filter(Boolean);
    const unknown = [f.dep, f.arr, f.alt, ...stops, ...stAlts].filter((x) => x && !A.aptByIcao[x]);
    if (unknown.length) throw new Error(`Terrain inconnu : ${unknown.join(', ')} (zone couverte : France métropolitaine).`);
    say('Chargement des données AIP, espaces aériens…');
    await loadAip();
    // Étapes : départ → arrivée (points tournants du formulaire), puis escales suivantes en direct (points VFR auto)
    const legsDef = [{ dep: f.dep, arr: f.arr, wps: f.wps, exit: f.exit, entry: f.entry }];
    stops.forEach((s) => legsDef.push({ dep: legsDef[legsDef.length - 1].arr, arr: s, wps: '', exit: 'auto', entry: 'auto' }));
    // aller-retour simple : le retour reprend la route de l'aller à l'envers (points tournants et points VFR inversés)
    if (f.rt && legsDef.length === 2 && legsDef[1].arr === f.dep) Object.assign(legsDef[1], revLeg(f));
    // dégagement : celui du formulaire pour la dernière étape ; escales : saisi dans « Dégagements des escales » ou terrain à METAR le plus proche
    legsDef.forEach((L, k) => { L.alt = k === legsDef.length - 1 ? f.alt : (stAlts[k] || nearestMetarAd(L.arr) || ''); });
    const trip = [];
    let time = new Date(f.time), fuel = f.fuel, aux = f.aux;
    const cap0 = f.T.fuel.tanks[0].cap;
    for (let k = 0; k < legsDef.length; k++) {
      const ld = k ? stageLoad(f.stload, legsDef[k].dep) : null;   // charges propres à cette escale (passagers déposés / pris, bagages)
      const fk = { ...f, ...legsDef[k], ...(ld || {}), legft: k ? '' : f.legft, time: time.toISOString(), fuel, aux };
      const userIds = buildUserIds(fk);
      say(`${legsDef.length > 1 ? `Étape ${k + 1}/${legsDef.length} : ` : ''}calcul de la route, du vent et du relief…`);
      const b = await compute(fk, userIds);
      say(`${legsDef.length > 1 ? `Étape ${k + 1}/${legsDef.length} : ` : ''}GRAMET, coupe météo de la route…`);
      b.gramet = await gramet(b).catch((e) => ({ err: e.message }));
      b.stage = k + 1; b.nStages = legsDef.length;
      b.night = nightInfo(b);
      try {   // échantillonne la route tous les ~5 NM pour trouver les départements traversés
        const sp = []; b.legs.forEach((lg) => { const n = Math.max(1, Math.ceil(lg.dist / 5)); for (let i = 0; i <= n; i++) sp.push(destPt(lg.a, lg.tc, lg.dist * i / n)); });
        b.vigil = A.vigOnRoute(sp, b.depT.getTime(), b.eta.getTime());
      } catch (e) { console.warn('vigilance', e); }
      b.mountain = mountainOf(b);
      b.altCmp = await altitudeCompare(b, b.mids, b.depElev).catch((e) => { console.warn('altitudes', e); return null; });
      b.optAlt = await optimalAltitudes(b).catch((e) => { console.warn('altitude optimale', e); return null; });
      b.changes = snapshotDiff(b);
      trip.push(b);
      time = new Date(b.eta.getTime() + f.turn * 6e4);
      const rem = Math.max(0, b.loaded - b.totFuel), d = f.T.fuel.density;
      const can = f.refuel && k < legsDef.length - 1 ? fuelAvail(b.arrInfo.v && b.arrInfo.v.escale, f.T) : null;
      const nx = nextFuel({ rem, cap: cap0 || f.fuel, aux: f.aux, refuel: f.refuel && can !== false, dry: b.mb.mass - b.loaded * d, mtow: f.T.mtow, density: d });
      fuel = nx.fuel; aux = nx.aux;
      b.refuelL = f.refuel && can !== false && k < legsDef.length - 1 ? nx.add : 0;
      if (f.refuel && can !== false && k < legsDef.length - 1) b.fuelNote = { ok: can !== null, txt: `À ${b.f.arr} : mettre ${nx.add} L (${fuel + aux} L à bord au départ)${nx.limited ? ` — plein limité par la masse max ${f.T.mtow} kg` : ''}${can === null ? ` — carburant ${f.T.fuel.name.split(' (')[0]} non confirmé par la VAC, appeler le terrain` : ''}.` };
      if (can === false) b.fuelNote = { ok: false, txt: `Pas de ${f.T.fuel.name.split(' (')[0]} à ${b.f.arr} (VAC) : pas de plein possible, l'étape suivante part avec ${Math.round(rem)} L.` };
    }
    trip.forEach((b) => { b.trip = trip; });
    say('Météo de la journée (terrains, route, déroutements)…');
    const dw = await dayWx(trip).catch((e) => { console.warn('météo du jour', e); return null; });
    trip.forEach((b) => { b.dayWx = dw; });
    return trip;
  }
  let runSeq = 0;
  async function run(makePdf) {
    const prog = $('#pf-prog'), out = $('#pf-out'), my = ++runSeq;
    stopPick();
    try {
      if (makePdf) { prog.textContent = 'Chargement des outils PDF / Excel…'; await needLibs(); }
      const f = readForm();
      lastForm = f;
      if (f.local && f.dep && A.aptByIcao[f.dep]) { prog.textContent = 'Vol local : météo, espaces et carburant…'; const h = await localPrep(f); if (my === runSeq) { out.innerHTML = h; prog.textContent = ''; } return; }
      if (!f.dep || !f.arr) throw new Error('Indique un terrain de départ et un terrain d\'arrivée.');
      const trip = await buildTrip(f, (t) => { if (my === runSeq) prog.textContent = t; });
      if (my === runSeq) prog.textContent = 'Créneaux de départ…';
      trip[0].slots = await departureSlots(trip).catch((e) => { console.warn('créneaux', e); return null; });
      if ((trip[0].depT - Date.now()) / 864e5 > 15) trip[0].clim = await climatology(trip).catch((e) => { console.warn('climatologie', e); return null; });
      if (my !== runSeq) return;   // un calcul plus récent a été lancé entre-temps : on n'affiche pas l'ancien
      // VAC des terrains de la route : mises en cache pour être consultables hors ligne
      if (window.caches) caches.open('aww-offline-vac').then((c) => Promise.all([...new Set(trip.flatMap((b) => [b.f.dep, b.f.arr, b.f.alt]).filter(Boolean))]
        .map((id) => fetch(`data/vac/${id}.pdf`).then((r) => r.ok && c.put(`data/vac/${id}.pdf`, r)).catch(() => {})))).catch(() => {});
      drawTrip(trip);
      timeSlider(trip);
      try {
        A.setNotamWindow(new Date(trip[0].depT.getTime() - 30 * 6e4), new Date(trip[trip.length - 1].eta.getTime() + 30 * 6e4));
        if (window.AWW_setFlightTimes) window.AWW_setFlightTimes(trip[0].depT, trip[trip.length - 1].eta);
      } catch (e) { console.warn(e); }
      // vol simple : météo du jour, créneaux, coût et liste de contrôle rangés dans les onglets ; voyage : au-dessus des étapes
      const top = { wx: wxStripHtml(trip) + slotsHtml(trip) + climHtml(trip), res: costHtml(trip) + checkHtml(trip[0], '') };
      out.innerHTML = verdictHtml(trip) + (trip.length > 1
        ? top.wx + tripHtml(trip) + refuelHtml(trip) + top.res + trip.map((b, i) => `<details class="stage" ${i === 0 ? 'open' : ''}><summary>Étape ${b.stage} : ${esc(b.f.dep)} → ${esc(b.f.arr)} · ${utc(b.depT)} → ${utc(b.eta)}</summary>${summaryHtml(b, '-' + i)}</details>`).join('')
        : summaryHtml(trip[0], '-0', top));
      trip.forEach((b, i) => bindSummary(b, '-' + i));
      const csv = $('#pf-cost-csv'); if (csv) csv.addEventListener('click', () => download(new Blob(['\ufeff' + costCsv(trip)], { type: 'text/csv;charset=utf-8' }), `cout_${trip[0].f.dep}-${trip[trip.length - 1].f.arr}_${trip[0].depT.toISOString().slice(0, 10)}.csv`));
      const ck = $('#pf-check'); if (ck) ck.addEventListener('change', (e) => { const st = store.get(checkKey(trip[0]), []); st[+e.target.dataset.i] = e.target.checked; store.set(checkKey(trip[0]), st); });
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
      trip.forEach(snapshotSave);   // chaque calcul garde une photo (tendance d'un briefing à l'autre)
    } catch (e) {
      console.error(e); prog.textContent = '';
      out.innerHTML = `<div class="warn">${esc(e.message || e)}</div>`;
    }
  }
  function bindSummary(b, sfx) {
    const on = (id, fn) => { const el = $('#' + id + sfx); if (el) el.addEventListener('click', fn); };
    on('pf-back', () => {   // vol retour : route inversée, départ à l'arrivée prévue + durée d'escale
      const f = b.f, t = new Date(b.eta.getTime() + (f.turn || 45) * 6e4);
      store.set('form', { ...store.get('form', {}), dep: f.arr, arr: f.dep, ...revLeg(f), stages: '', rt: false, alt: '' });
      openForm(); $('#pf-time').value = localInput(t); run(false);
    });
    on('pf-pax', () => { const w = window.open('', '_blank'); if (!w) { alert('Fenêtre bloquée : autoriser les fenêtres de ce site.'); return; } w.document.write(paxBrief(b)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); });
    on('pf-efato', async () => {
      const st = $('#pf-fields-st' + sfx), out = $('#pf-efato-out' + sfx); st.textContent = 'Recherche des champs dans l\'axe…';
      try {
        const x = await efatoPlan(b); st.textContent = '';
        out.innerHTML = `<p class="meta">🛫 <b>Panne moteur au décollage</b> (piste ${esc(x.rwy || '?')} à ${esc(b.f.dep)}, axe ${Math.round(x.hdg)}° vrai) : ${!x.osm ? 'OpenStreetMap indisponible, champs non listés : repère-les sur la photo' : x.fields.length ? x.fields.map((f, k) => `${k + 1}. à ${f.d.toFixed(1)} NM, ${f.off ? `${Math.abs(f.off)}° ${f.off > 0 ? 'à droite' : 'à gauche'}` : 'dans l\'axe'} (${f.L} × ${f.W} m, ${esc(f.kind || '')})`).join(' · ') : 'aucun champ cartographié sur OpenStreetMap dans l\'axe (les parcelles ne sont pas toutes dessinées) : repère-les sur la photo'}.</p>
          ${x.img ? `<img src="${x.img}" alt="Axe de décollage" style="width:100%;border-radius:6px">` : ''}
          <p class="meta">🗣️ Briefing à dire avant l'alignement : « Panne avant la rotation : réduction, freinage. Panne après le décollage en dessous de la hauteur fixée avec mon instructeur : pas de demi-tour, je me pose droit devant, au plus à 30° de part et d'autre${x.fields.length ? `, champ repéré à ${x.fields[0].d.toFixed(1)} NM` : ''}. Au-dessus : selon la hauteur, terrain ou champ choisi. » Champs OSM : nature du sol, clôtures et lignes électriques à vérifier en vol.</p>`;
        if (routeLayer) { x.fields.forEach((f) => L.circleMarker(f.c, { radius: 6, color: '#fff', weight: 2, fillColor: '#00c853', fillOpacity: .95 }).bindTooltip(`Panne au décollage : champ ${f.L} × ${f.W} m`, { className: 'tip' }).addTo(routeLayer));
          L.polygon([x.end, destPt(x.end, x.hdg - 30, 2), destPt(x.end, x.hdg, 2.2), destPt(x.end, x.hdg + 30, 2)], { color: '#00c853', weight: 1, fillOpacity: .08, dashArray: '4 4' }).addTo(routeLayer); }
      } catch (e) { st.textContent = '⚠️ ' + (e.message || e); }
    });
    on('pf-obst', async () => {
      const st = $('#pf-fields-st' + sfx), out = $('#pf-obst-out' + sfx); st.textContent = 'Recherche des éoliennes et lignes HT…';
      try {
        const o = await osmObstacles(b); st.textContent = ''; b.osmObst = o;
        const hi = o.turbines.filter((t) => t.top && t.top > (b.f.ft - 1000)), low = (b.legs[0].ft || b.f.ft);
        out.innerHTML = `<p class="meta">⚡ <b>Éoliennes</b> à moins de 1,5 NM : ${o.turbines.length ? `${o.turbines.length}${o.turbines.some((t) => t.ft) ? `, jusqu'à ${Math.max(...o.turbines.map((t) => t.ft || 0))} ft de haut` : ''} (${[...new Set(o.turbines.map((t) => Math.round(t.along / 5) * 5))].map((a) => `vers ${a} NM`).join(', ')})` : 'aucune sur OpenStreetMap'}${hi.length ? ` — <b style="color:#ff6b6b">${hi.length} à moins de 1000 ft sous la croisière</b>` : ''} · <b>Lignes haute tension</b> croisées : ${o.lines.length ? o.lines.map((l) => `${l.along.toFixed(0)} NM${l.kv ? ` (${l.kv} kV)` : ''}`).join(', ') : 'aucune'}.</p>
          <p class="meta">Données OpenStreetMap incomplètes (hauteur des pylônes rarement connue) : compléter avec la carte OACI et les NOTAM d'obstacles. Turbulence de sillage derrière les éoliennes.</p>`;
        if (routeLayer) { o.turbines.forEach((t) => L.circleMarker(t.p, { radius: 3, color: '#fff', weight: 1, fillColor: '#00e5ff', fillOpacity: 1 }).bindTooltip(`Éolienne${t.ft ? ` ${t.ft} ft` : ''}`, { className: 'tip' }).addTo(routeLayer));
          o.lines.forEach((l) => L.circleMarker(l.p, { radius: 6, color: '#ffd60a', weight: 3, fillOpacity: 0 }).bindTooltip(`Ligne haute tension${l.kv ? ` ${l.kv} kV` : ''}`, { className: 'tip' }).addTo(routeLayer)); }
        const sv = $('#pf-vp' + sfx); if (sv && b.vprofile) { sv.outerHTML = cutSvg(b.vprofile, b, { id: 'pf-vp' + sfx }); cursorOn(b, $('#pf-vp' + sfx), $('#pf-vpinfo' + sfx)); }
      } catch (e) { st.textContent = '⚠️ ' + (e.message || e); }
    });
    const pb = $('#pf-photo-box' + sfx);
    if (pb) pb.addEventListener('toggle', async () => {
      if (!pb.open || b.arrPhoto) return;
      const box = $('#pf-photo' + sfx); box.textContent = 'Chargement de la photo et des pistes (OpenStreetMap)…';
      try { b.arrPhoto = await airfieldPhoto(b); box.innerHTML = `<img src="${b.arrPhoto.url}" alt="Photo du terrain ${esc(b.f.arr)}" style="width:100%;border-radius:6px">${b.arrPhoto.runway ? '' : '<br>Pistes non trouvées sur OpenStreetMap : pas de schéma de circuit.'}<br>Photo © Esri World Imagery · pistes © OpenStreetMap · schéma calculé (côté et altitude d\'après la VAC) : le circuit officiel est sur la VAC. Image reprise dans le PDF.`; }
      catch (e) { box.textContent = '⚠️ ' + (e.message || e); }
    });
    on('pf-fields', async () => {
      const st = $('#pf-fields-st' + sfx), out = $('#pf-fields-out' + sfx); st.textContent = 'Recherche OpenStreetMap…';
      try {
        b.fields = await rescueFields(b); st.textContent = '';
        out.innerHTML = `<p class="meta">🌾 ${b.fields.length ? `${b.fields.length} champs (le plus grand par tranche de 5 NM, à moins de 1,5 NM de la route) : ${b.fields.map((x) => `${x.along.toFixed(0)} NM (${x.L} × ${x.W} m, ${x.d.toFixed(1)} NM)`).join(' · ')}` : 'aucun grand champ trouvé près de la route'}. Repérés sur OpenStreetMap (prairies, cultures) : clôtures, lignes électriques, pente et cultures hautes inconnues — à reconnaître en vol. Taille d'après le rectangle englobant.</p>`;
        if (routeLayer) b.fields.forEach((x) => L.circleMarker(x.c, { radius: 5, color: '#fff', weight: 1, fillColor: '#2ecc40', fillOpacity: .9 }).bindTooltip(`Champ ${x.L} × ${x.W} m (${esc(x.kind || '')}) — ${x.along.toFixed(0)} NM`, { className: 'tip' }).addTo(routeLayer));
        const sv = $('#pf-vp' + sfx); if (sv && b.vprofile) { sv.outerHTML = cutSvg(b.vprofile, b, { id: 'pf-vp' + sfx }); cursorOn(b, $('#pf-vp' + sfx), $('#pf-vpinfo' + sfx)); }
      } catch (e) { st.textContent = '⚠️ ' + (e.message || e); }
    });
    on('pf-gpx', () => exportGpx(b));
    on('pf-fpl', () => exportFpl(b));
    on('pf-update', () => run(false));
    on('pf-knee', () => kneeboard(b).catch((e) => { console.error(e); $('#pf-prog').textContent = 'Fiche de genou : ' + e.message; }));
    document.querySelectorAll('#pf-out [data-note]:not([data-b])').forEach((el) => (el.dataset.b = 1) && el.addEventListener('click', () => { const id = el.dataset.note, ta = document.getElementById('pf-note-' + id + sfx); const all = store.get('adnotes', {}); if (ta.value.trim()) all[id] = ta.value.trim().slice(0, 600); else delete all[id]; store.set('adnotes', all); el.textContent = 'Enregistré ✔'; }));
    document.querySelectorAll('#pf-out [data-propose]:not([data-b])').forEach((el) => (el.dataset.b = 1) && el.addEventListener('click', () => { const id = el.dataset.propose, cfg = window.AWW_CONFIG || {}; if (!cfg.contact) return;
      const tarif = prompt(`Taxe d'atterrissage à ${id} (ex. « 12 € TTC, gratuit FFA ») :`, ''); if (tarif === null) return; const info = prompt('Autre info utile (accueil, carburant, taxi, restaurant…) :', '') || '';
      location.href = `mailto:${cfg.contact}?subject=${encodeURIComponent(`[Aéro Météo] Escale ${id}`)}&body=${encodeURIComponent(`Terrain : ${id}\nTaxe : ${tarif}\nInfo : ${info}\nRelevé : ${new Date().toISOString().slice(0, 10)}`)}`; }));
    ['pf-lmk1', 'pf-lmk2'].forEach((id) => on(id, (e) => { $('#pf-wps').value = e.target.dataset.wps; $('#pf-exit').value = 'none'; run(false); }));
    on('pf-routes', compareRoutes);
    document.querySelectorAll('#pf-out [data-setalt]:not([data-b])').forEach((el) => (el.dataset.b = 1) && el.addEventListener('click', () => { if (b.stage && b.stage < b.nStages) { const st = ($('#pf-stalts').value || '').split(/\s+/); st[b.stage - 1] = el.dataset.setalt; $('#pf-stalts').value = st.join(' ').trim(); } else $('#pf-alt').value = el.dataset.setalt; run(false); }));
    on('pf-watch', (e) => watchToggle(b.trip || [b], e.target));
    document.querySelectorAll('#pf-out [data-esc-mail]:not([data-b])').forEach((el) => (el.dataset.b = 1) && el.addEventListener('click', (e) => {
      e.preventDefault(); const id = el.dataset.escMail, m = A.escaleOf(id).mail_escale, t = A.pprText(id);
      location.href = `mailto:${m}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`;
    }));
    on('pf-optleg', (e) => { $('#pf-legft').value = e.target.dataset.legft; run(false); });
    on('pf-optalt', (e) => { $('#pf-legft').value = ''; $('#pf-ft').value = e.target.dataset.ft; $('#pf-ft').dispatchEvent(new Event('change')); run(false); });
    on('pf-ics', () => exportIcs(b));
    on('pf-gps', () => flightMode(b.trip || [b]));
    on('pf-share', () => shareFlight(sfx));
    on('pf-logit', (e) => {
      const trip = b.trip || [b];
      addLog(b.f.pil, { d: localInput(b.depT).slice(0, 10), n: trip.length, i: false, reg: b.f.ac.reg, r: [trip[0].f.dep, ...trip.map((x) => x.f.arr)].join('-') });
      e.target.textContent = '📓 Ajouté au carnet ✔'; e.target.disabled = true;
    });
    on('pf-icao-copy', (e) => { navigator.clipboard.writeText(icaoRoute(b)).then(() => { e.target.textContent = 'Copié ✔'; }, () => { e.target.textContent = 'Copie impossible : sélectionner le texte'; }); });
    if (b.gramet && !b.gramet.err && $('#pf-gramet' + sfx)) drawGramet($('#pf-gramet' + sfx), b.gramet, b);
    bindProfile(b, sfx);
    bindWhatIf(b, sfx);
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
    const cgCell = (cg, m) => cg == null ? '–' : `<span style="color:${trip[0].mb.inEnv(cg, m) ? '#2ecc40' : '#ff6b6b'}">${Math.round(m)} kg · ${cg.toFixed(3)}</span>`;
    const rows = trip.map((b) => {
      const rem = b.loaded - b.totFuel, ok = rem >= b.resFuel + (b.altLeg ? b.altLeg.fuel : 0);
      return `<tr><td>${b.stage}</td><td>${esc(b.f.dep)}→${esc(b.f.arr)}</td><td>${utc(b.depT)}</td><td>${utc(b.eta)}</td><td>${hhmm(b.totMin)}</td><td>${b.loaded} L</td><td>${b.totFuel} L</td>
        <td style="color:${ok ? '#2ecc40' : '#ff6b6b'}"><b>${Math.round(rem)} L</b></td><td>${b.night ? utc(b.night.latestDep) : '–'}</td>
        <td>${cgCell(b.mb.cg, b.mb.mass)}</td><td>${cgCell(b.mb.ldgCg, b.landMass)}</td></tr>`;
    }).join('');
    const totMin = trip.reduce((s, b) => s + b.totMin, 0), totFuel = trip.reduce((s, b) => s + b.totFuel, 0), totDist = trip.reduce((s, b) => s + b.totDist, 0);
    const last = trip[trip.length - 1];
    const warn = trip.filter((b) => b.night && b.night.early).map((b) => `Étape ${b.stage} : départ ${utc(b.depT)} avant le jour aéronautique (${utc(b.night.day)}).`).concat(trip.filter((b) => b.night && b.night.late).map((b) => `Étape ${b.stage} : arrivée ${utc(b.eta)} après la nuit aéronautique (${utc(b.night.night)}) — décoller au plus tard à ${utc(b.night.latestDep)}.`)
      .concat(trip.filter((b) => (b.mb.cg != null && !b.mb.inEnv(b.mb.cg, b.mb.mass)) || (b.mb.ldgCg != null && !b.mb.inEnv(b.mb.ldgCg, b.landMass))).map((b) => `Étape ${b.stage} : centrage hors limites (${b.f.dep} → ${b.f.arr}).`))
      .concat(trip.filter((b) => b.loaded - b.totFuel < b.resFuel + (b.altLeg ? b.altLeg.fuel : 0)).map((b) => `Étape ${b.stage} : carburant restant à l'arrivée inférieur à dégagement + réserve finale — prévoir un avitaillement à ${b.f.dep}.`)));
    const notes = trip.filter((b) => b.fuelNote).map((b) => `<div class="${b.fuelNote.ok ? 'okk' : 'warn'}">⛽ Étape ${b.stage} — ${esc(b.fuelNote.txt)}</div>`).join('')
      + `<p class="meta">Dégagements : ${trip.map((b) => `étape ${b.stage} ${b.f.alt ? esc(b.f.alt) : 'aucun'}`).join(' · ')}.</p>`;
    return `<h4>Voyage en ${trip.length} étapes</h4>
      <table class="legs trip"><tr><th>#</th><th>Étape</th><th>Départ</th><th>Arrivée</th><th>Durée</th><th>À bord</th><th>Conso</th><th>Reste</th><th>Dernier déc.</th><th>Masse · centrage déc.</th><th>à l'atterr.</th></tr>${rows}
      <tr><th></th><th>Total</th><th></th><th></th><th>${hhmm(totMin)}</th><th></th><th>${totFuel} L</th><th></th><th></th><th></th><th></th></tr></table>
      <p class="meta">${totDist.toFixed(0)} NM · escale ${last.f.turn} min · ${last.f.refuel ? 'plein à chaque escale' : 'sans avitaillement aux escales'} · « Dernier déc. » = dernier décollage pour arriver avant la nuit aéronautique (coucher du soleil + 30 min).</p>
      ${notes}${warn.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('') || '<div class="okk">Carburant, centrage et horaires compatibles sur toutes les étapes.</div>'}`;
  }
  window.addEventListener('aww-clear', () => { if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; } stopPick(); timeSlider(null); });
  // ---------- curseur horaire : départ simulé, avis VFR et vent à l'heure de passage de chaque point de la route (données de dayWx, sans nouvel appel)
  // points de la journée dans l'ordre du vol, avec leur décalage par rapport au départ
  function slidePts(trip) {
    const W = trip[0].dayWx; if (!W) return [];
    const by = (id) => W.pts.find((x) => x.id === id), t0 = trip[0].depT.getTime(), out = [];
    trip.forEach((b) => {
      const d0 = b.depT - t0, dur = b.eta - b.depT;
      if (b.stage === 1 || trip.length === 1) out.push({ pt: by(b.f.dep), off: d0 });
      [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].forEach((k) => out.push({ pt: by(`R${b.stage}-${k}`), off: d0 + dur * k }));
      out.push({ pt: by(b.f.arr), off: d0 + dur });
    });
    return out.filter((x) => x.pt);
  }
  console.assert((() => { const P = (id) => ({ id, p: [0, 0] }), trip = [{ stage: 1, f: { dep: 'A', arr: 'B' }, depT: new Date(0), eta: new Date(6e5), dayWx: { pts: [P('A'), P('B'), ...[1, 2, 3, 4, 5].map((k) => P(`R1-${k / 6}`))] } }];
    const r = slidePts(trip); return r.length === 7 && r[0].off === 0 && r[6].off === 6e5 && r[3].off === 3e5; })(), 'slidePts');
  let tsLayer = null;
  function timeSlider(trip) {
    document.getElementById('tslider')?.remove(); if (tsLayer) { map.removeLayer(tsLayer); tsLayer = null; }
    const P = trip ? slidePts(trip) : []; if (P.length < 2) return;
    const b0 = trip[0], dur = trip[trip.length - 1].eta - b0.depT, day = new Date(b0.depT); day.setHours(0, 0, 0, 0);
    const lo = 6 * 60, hi = Math.max(lo + 60, 20 * 60 - Math.ceil(dur / 6e4)), cur = Math.round((b0.depT - day) / 6e4 / 15) * 15;
    const el = document.createElement('div'); el.id = 'tslider'; el.className = 'glass';
    el.innerHTML = `<div class="ts-row"><b>Départ simulé</b><output id="ts-out"></output><button type="button" class="btn" id="ts-use" title="Recalculer la préparation avec cette heure">Utiliser</button><button type="button" class="icon-btn" id="ts-x" title="Fermer" aria-label="Fermer le curseur horaire">✕</button></div>
      <input type="range" id="ts-r" min="${lo}" max="${hi}" step="15" value="${Math.min(hi, Math.max(lo, cur))}" aria-label="Heure de départ simulée">
      <div class="ts-bar" id="ts-bar" aria-hidden="true"></div><p class="ts-why" id="ts-why"></p>`;
    document.body.appendChild(el);
    tsLayer = L.layerGroup().addTo(map);
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const at = (m) => P.map((x) => { const t = day.getTime() + m * 6e4 + x.off; return { ...x, t, w: wxAt(x.pt, t) }; });
    // bande du haut : avis le plus défavorable de la route pour chaque départ possible
    $('#ts-bar').innerHTML = Array.from({ length: (hi - lo) / 15 + 1 }, (_, i) => { const r = at(lo + i * 15).map((x) => x.w).filter(Boolean); const lv = r.length ? Math.max(...r.map((w) => w.lv)) : null;
      return `<i style="background:${lv == null ? 'transparent' : WXCOL[lv]}"></i>`; }).join('');
    const draw = () => {
      const m = +$('#ts-r').value, R = at(m); tsLayer.clearLayers();
      for (let i = 1; i < R.length; i++) { const lv = Math.max(R[i - 1].w ? R[i - 1].w.lv : 0, R[i].w ? R[i].w.lv : 0);
        L.polyline([R[i - 1].pt.p, R[i].pt.p], { color: WXCOL[lv], weight: 14, opacity: .45, interactive: false }).addTo(tsLayer); }
      R.forEach((x) => { if (!x.w) return; const w = x.w, d = w.ws >= 3 ? w.wd : null, len = Math.min(12, 4 + w.ws / 2.5);
        L.marker(x.pt.p, { icon: L.divIcon({ className: 'ts-mk', iconSize: [34, 34], iconAnchor: [17, 17],
          html: `<svg width="34" height="34" viewBox="0 0 34 34">${d != null ? `<g transform="rotate(${d} 17 17)"><path d="M17 11V${(11 - len).toFixed(1)}" stroke="#0b2a44" stroke-width="3.4" stroke-linecap="round"/><path d="M17 11V${(11 - len).toFixed(1)}" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>` : ''}<circle cx="17" cy="17" r="6.5" fill="${WXCOL[w.lv]}" stroke="#fff" stroke-width="2"/>${w.storm ? '<text x="17" y="21" text-anchor="middle" font-size="9">⚡</text>' : ''}</svg>` }) })
          .bindTooltip(`${esc(x.pt.lbl)} · passage ${hm(Math.round((x.t - day) / 6e4))} (heure locale)<br>${esc(WXTXT[w.lv])}${w.why.length ? ' : ' + esc(w.why.join(', ')) : ''}<br>vent ${Math.round(w.wd)}° ${Math.round(w.ws)} kt${w.gust >= 20 ? ` rafales ${Math.round(w.gust)}` : ''} · nuages bas ${w.low ?? '?'} %${w.base != null ? ` base ~${w.base} ft sol` : ''}`, { className: 'tip' }).addTo(tsLayer); });
      const ws = R.map((x) => x.w).filter(Boolean), lv = ws.length ? Math.max(...ws.map((w) => w.lv)) : 0, why = [...new Set(ws.flatMap((w) => w.why))];
      $('#ts-out').innerHTML = `<b style="color:${WXCOL[lv]}">●</b> ${hm(m)} → ${hm(m + Math.round(dur / 6e4))} · ${esc(WXTXT[lv])}`;
      $('#ts-why').textContent = why.slice(0, 4).join(', ') || 'rien de signalé sur la route';
    };
    $('#ts-r').addEventListener('input', draw); draw();
    const phone = innerWidth <= 700;   // route visible entre le panneau, la barre et le curseur
    map.fitBounds(L.latLngBounds(P.map((x) => x.pt.p)), { paddingTopLeft: phone ? [20, 170] : [370, 90], paddingBottomRight: phone ? [20, 200] : [40, 170], maxZoom: 9 });
    $('#ts-x').addEventListener('click', () => timeSlider(null));
    $('#ts-use').addEventListener('click', () => { const t = new Date(day.getTime() + +$('#ts-r').value * 6e4), i = $('#pf-time'); if (!i) return; i.value = localInput(t); timeSlider(null); run(false); });
  }
  function drawTrip(trip) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.layerGroup().addTo(map);
    trip.forEach((b) => drawRoute(b, routeLayer, trip.length === 1 || b.stage === 1));
    trip.forEach((b) => activeZones(b).forEach((z) => L.polygon(z.poly, { color: z.col, weight: 2, fillColor: z.col, fillOpacity: .22, dashArray: z.sure ? null : '6 4' })
      .bindTooltip(`${esc(z.name)}<br>${esc(z.lim)}<br>${esc(z.why)}`, { sticky: true }).addTo(routeLayer)));
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
      alerts: alertsOf(b), min: b.totMin, sum: (() => { const x = tripSummary([b]); return { stop: x.stop, imp: x.imp, wx: x.wx, gust: Math.round(x.gust), fuel: x.fuel, head: x.head }; })(), gramet: b.gramet && !b.gramet.err ? grametSummary(b.gramet, b) : null,
      sups: b.sups.map((x) => x.s.num || x.s.title),
      // pour le rappel à l'ouverture du site (sans recalcul) : TAF et NOTAM des terrains, NOTAM RTBA, formulaire
      ids: [b.f.dep, b.f.arr, b.f.alt].filter(Boolean), title: `${b.f.dep} → ${b.f.arr}`,
      tafs: Object.fromEntries([b.f.dep, b.f.arr, b.f.alt].filter(Boolean).map((id) => [id, (A.tafs[id] || {}).rawTAF || ''])),
      adn: b.adNotams.flatMap((x) => x.list.map((n) => n.ref)), rtban: ((A.NOTAM || {}).fir || []).filter((n) => /RTBA/.test(n.e || '')).map((n) => n.ref),
      form: lastForm ? Object.fromEntries(FORM_KEYS.filter((k) => k !== 'time').map((k) => [k, lastForm[k]])) : null,
    };
  }
  function snapshotSave(b) {
    try {
      const all = store.get('snaps', {}), k = snapKey(b);
      const prev = (all[k] || []).filter((x, i, l) => !(i === l.length - 1 && Date.now() - x.at < 30 * 6e4));   // recalculs rapprochés : on remplace la dernière photo
      all[k] = [...prev, makeSnap(b)].slice(-4);
      const keys = Object.keys(all); if (keys.length > 30) keys.sort((x, y) => all[x].slice(-1)[0].at - all[y].slice(-1)[0].at).slice(0, keys.length - 30).forEach((x) => delete all[x]);
      store.set('snaps', all);
    } catch (e) { console.warn('snap', e); }
  }
  // rappel : à l'ouverture du site puis toutes les 30 min, compare les navs des 36 prochaines heures (briefing PDF généré) aux données du moment
  function savedChanges() {
    const N = A.NOTAM || {}, out = [];
    if (!Object.keys(A.tafs).length || !((N.fir || []).length || Object.keys(N.ad || {}).length)) return null;   // données pas encore chargées
    for (const [k, list] of Object.entries(store.get('snaps', {}))) {
      const s = list[list.length - 1], dep = Date.parse(s.dep);
      if (!s.tafs || !s.form || !(dep > Date.now() && dep - Date.now() < 36 * 3600e3)) continue;
      const ch = [];
      for (const id of s.ids) if ((A.tafs[id] || {}).rawTAF && (A.tafs[id] || {}).rawTAF !== s.tafs[id]) ch.push(`TAF ${id} ${s.tafs[id] ? 'modifié' : 'publié'}`);
      const adn = new Set(s.adn), nAd = s.ids.flatMap((id) => (N.ad[id] || []).map((n) => n.ref)).filter((r) => !adn.has(r));
      if (nAd.length) ch.push(`${nAd.length} nouveau(x) NOTAM aux terrains (${nAd.slice(0, 3).join(', ')})`);
      const rt = new Set(s.rtban), nRt = (N.fir || []).filter((n) => /RTBA/.test(n.e || '') && !rt.has(n.ref));
      if (nRt.length) ch.push(`${nRt.length} nouvelle(s) activation(s) AZBA`);
      if (ch.length) out.push({ k, s, ch, dep });
    }
    return out;
  }
  function remindCheck() {
    const res = savedChanges(); if (!res) { setTimeout(remindCheck, 20000); return; }
    setTimeout(remindCheck, 30 * 6e4);
    const seen = store.get('remindSeen', {});
    const fresh = res.filter((x) => seen[x.k] !== x.ch.join('|'));
    if (!fresh.length) return;
    const x = fresh[0], txt = `Ta nav ${x.s.title} (${new Date(x.dep).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}) : ${x.ch.join(', ')}.`;
    document.getElementById('remind-bar')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="remind-bar" class="glass">🔔 ${esc(txt)} <button id="rm-go">🔄 Recalculer</button>${'Notification' in window && Notification.permission === 'default' ? '<button id="rm-notif">Me prévenir aussi par notification</button>' : ''}<button class="x" id="rm-x" title="Vu">✕</button></div>`);
    const done = () => { fresh.forEach((y) => { seen[y.k] = y.ch.join('|'); }); store.set('remindSeen', seen); document.getElementById('remind-bar')?.remove(); };
    $('#rm-x').onclick = done;
    $('#rm-go').onclick = () => { done(); store.set('form', { ...store.get('form', {}), ...x.s.form }); openForm(); $('#pf-time').value = localInput(new Date(x.dep)); run(false); };
    if ($('#rm-notif')) $('#rm-notif').onclick = () => Notification.requestPermission().then(() => $('#rm-notif')?.remove());
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) try { new Notification('Aéro Météo', { body: txt, icon: 'icons/icon192.png' }); } catch { /* navigateur sans notification hors service worker */ }
  }
  setTimeout(remindCheck, 15000);
  // surveillance jusqu'au départ : nav recalculée en arrière-plan toutes les 30 min (page ouverte), alerte si la situation se dégrade
  let watch = null;
  function watchDiff(a, b) {
    const d = [];
    if (b.stop > a.stop) d.push(`${b.stop - a.stop} nouvelle(s) alerte(s) bloquante(s) ⛔`);
    if (b.imp > a.imp) d.push(`${b.imp - a.imp} branche(s) devenue(s) impossible(s) (aucune altitude)`);
    if (b.wx > a.wx) d.push(`météo en route : ${WXTXT[a.wx]} → ${WXTXT[b.wx]}`);
    if (b.azba && !a.azba) d.push('AZBA active sur la route');
    if (b.gust >= 25 && b.gust > a.gust + 5) d.push(`rafales ${Math.round(b.gust)} kt`);
    if (b.fuel > a.fuel + 3) d.push(`carburant +${b.fuel - a.fuel} L (vent)`);
    return d;
  }
  console.assert(watchDiff({ stop: 0, imp: 0, wx: 0, azba: false, gust: 10, fuel: 20 }, { stop: 1, imp: 0, wx: 0, azba: true, gust: 12, fuel: 21 }).length === 2, 'watchDiff');   // sans WXTXT (défini plus bas)
  async function watchTick() {
    if (!watch) return;
    if (Date.now() > watch.dep) { watch = null; return; }
    try {
      const t = await buildTrip(watch.f), s2 = tripSummary(t), d = watchDiff(watch.base, s2);
      watch.base = s2; watch.last = new Date();
      if (d.length) {
        const txt = `Ta nav ${watch.title} : ${d.join(', ')}.`;
        document.getElementById('remind-bar')?.remove();
        document.body.insertAdjacentHTML('beforeend', `<div id="remind-bar" class="glass">⚠️ ${esc(txt)} <button id="rm-go">🔄 Voir</button><button class="x" id="rm-x" title="Vu">✕</button></div>`);
        $('#rm-x').onclick = () => document.getElementById('remind-bar')?.remove();
        $('#rm-go').onclick = () => { document.getElementById('remind-bar')?.remove(); store.set('form', { ...store.get('form', {}), ...watch.form }); openForm(); $('#pf-time').value = localInput(new Date(watch.dep)); run(false); };
        if ('Notification' in window && Notification.permission === 'granted') try { new Notification('Aéro Météo — météo dégradée', { body: txt, icon: 'icons/icon192.png' }); } catch { /* navigateur sans notifications */ }
      }
    } catch (e) { console.warn('surveillance', e); }
    if (watch) watch.timer = setTimeout(watchTick, 30 * 6e4);
  }
  function watchToggle(trip, btn) {
    if (watch) { clearTimeout(watch.timer); watch = null; btn.textContent = '🔔 Surveiller jusqu\'au départ'; return; }
    const f = lastForm, b0 = trip[0];
    watch = { f, form: Object.fromEntries(FORM_KEYS.filter((k) => k !== 'time').map((k) => [k, f[k]])), base: tripSummary(trip), dep: b0.depT.getTime(), title: [b0.f.dep, ...trip.map((x) => x.f.arr)].join(' → ') };
    watch.timer = setTimeout(watchTick, 30 * 6e4);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    btn.textContent = '🔕 Arrêter la surveillance';
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
    // tendance globale (35) : score du plus grave au moins grave (alertes bloquantes, branches impossibles, météo, rafales, carburant)
    let trend = null;
    if (old.sum && cur.sum) {
      const sc = (x) => x.stop * 100 + x.imp * 50 + x.wx * 20 + Math.max(0, x.gust - 15) * 2 + x.fuel, d = sc(cur.sum) - sc(old.sum);
      trend = d > 5 ? 'dégradation' : d < -5 ? 'amélioration' : 'stable';
      if (cur.sum.gust !== old.sum.gust && Math.abs(cur.sum.gust - old.sum.gust) >= 5) ch.push({ k: cur.sum.gust > old.sum.gust ? 'add' : 'info', t: `Rafales max sur la route : ${old.sum.gust} → ${cur.sum.gust} kt` });
      if (cur.sum.imp !== old.sum.imp) ch.push({ k: cur.sum.imp > old.sum.imp ? 'add' : 'info', t: `Branches sans altitude possible : ${old.sum.imp} → ${cur.sum.imp}` });
    }
    return { since: new Date(old.at), list: ch, trend };
  }
  function changesHtml(b) {
    if (!b.changes) return '';
    const c = b.changes, when = c.since.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<h4>🔄 Changements depuis le briefing du ${esc(when)}</h4>${c.trend ? `<div class="${c.trend === 'dégradation' ? 'warn' : 'okk'}">${c.trend === 'dégradation' ? '📉 La situation se dégrade' : c.trend === 'amélioration' ? '📈 La situation s\'améliore' : '➡️ Situation stable'} depuis cette préparation.</div>` : ''}${c.list.length ? c.list.map((x) => `<div class="${x.k === 'add' ? 'warn' : 'okk'}">${x.k === 'add' ? '🆕' : x.k === 'del' ? '🗑️' : 'ℹ️'} ${esc(x.t)}</div>`).join('') : '<div class="okk">Aucun changement détecté (NOTAM, AZBA, météo, alertes).</div>'}`;
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
    const zoneGround = new Map();   // zone -> relief max sous la zone (ft), null si le relief n'a pas pu être lu
    const vOverlap = (z) => {
      const lo = parseAlt(z.lower), up = parseAlt(z.upper), g = zoneGround.get(z);
      const upFt = up === null ? 99999 : !/ASFC|AGL/i.test(z.upper) ? up : g === undefined ? up + 1500 : g === null ? 99999 : up + g;
      return (lo === null || lo <= f.ft + 500) && upFt >= f.ft - 500;
    };
    const rtbaSlots = (z) => {
      const key = z.id.replace(/\s/g, '');
      return [...new Set(acts.filter((a) => a.zone === key && (!a.from || Date.parse(a.from) <= dayStart + 864e5) && (isNaN(Date.parse(a.to)) || Date.parse(a.to) >= dayStart)).flatMap((a) => a.slots))];
    };
    // zones temporaires des SUP AIP en vigueur le jour du vol (contour et limites lus dans le PDF) ; créneaux en UTC, réunis sur toute la période
    const supDay = depT.toISOString().slice(0, 10);
    const supZones = (A.SUP || []).filter((s) => s.zones && s.zones.length && (!s.from || s.from <= supDay) && (!s.to || s.to >= supDay)).flatMap((s) => s.zones.map((z) => ({
      id: `SUP ${s.num}`, type: 'ZRT', name: z.name, lower: z.lower, upper: z.upper, poly: z.poly, rtba: false,
      rmk: `${s.title} — ${z.hours.length ? 'activable ' + z.hours.map((h) => h.join('-')).join(', ') + ' UTC' : z.h24 ? 'activable H24' : 'horaires : voir le SUP'}`,
      sup: { num: s.num, url: s.url, active: z.hours.length ? z.hours.some((h) => slotOverlap(h.join('-'), dayStart, t0, t1)) : null } })));
    const allZones = [...((ZONES && ZONES.data) || []), ...supZones];
    // sommet réel des zones limitées « au-dessus du sol » : relief le plus haut sous la zone (points du contour + centre), une requête pour toutes ;
    // relief illisible -> sommet inconnu, la zone est considérée comme gênante
    const aglZones = allZones.filter((z) => /ASFC|AGL/i.test(z.upper || '') && polyRouteDist(z.poly, userPts) <= 40);
    const aglPts = aglZones.map((z) => { const st = Math.max(1, Math.ceil(z.poly.length / 12)); return [...z.poly.filter((_, i) => i % st === 0), z.poly.reduce((c, p) => [c[0] + p[0] / z.poly.length, c[1] + p[1] / z.poly.length], [0, 0])]; });
    const aglEl = aglZones.length ? await elevations(aglPts.flat()).catch(() => null) : [];
    let aglK = 0;
    aglZones.forEach((z, i) => { const n = aglPts[i].length; zoneGround.set(z, aglEl ? Math.round(Math.max(0, ...aglEl.slice(aglK, aglK + n).map((x) => x || 0)) * 3.281) : null); aglK += n; });
    const obstacles = [];
    if (f.avoid !== 'none') {
      for (const z of allZones) {
        if (!vOverlap(z)) continue;
        if (polyRouteDist(z.poly, userPts) > 40) continue;
        if (z.type === 'P') obstacles.push({ z, why: 'zone interdite' });
        else if (f.avoid === 'p+rtba' && z.rtba && rtbaSlots(z).some((s) => slotOverlap(s, dayStart, t0, t1))) obstacles.push({ z, why: 'RTBA active' });
        else if (f.avoid === 'p+rtba' && z.sup && z.sup.active) obstacles.push({ z, why: `ZRT active (SUP ${z.sup.num})` });
        else if (f.avoid === 'easy' && ((z.rtba && rtbaSlots(z).some((s) => slotOverlap(s, dayStart, t0, t1))) || (z.sup && z.sup.active !== false)
          || (/^[RD]$/.test(z.type) && !z.rtba && zoneStatus(z, t0, t1, N.fir || []).st === 'active'))) obstacles.push({ z, why: z.sup ? 'ZRT' : z.rtba ? 'RTBA active' : 'zone active' });
      }
      // route « VFR facile » : contourne seulement ce qu'on ne peut pas survoler par-dessous : classe A, CTR et espaces C / D qui partent
      // du sol (≤ 1000 ft), hors ceux du départ et de l'arrivée ; les TMA à plancher se passent dessous (altitude optimale)
      if (f.avoid === 'easy') {
        const ends = [userPts[0], userPts[userPts.length - 1]];
        for (const s of (ASP && ASP.data) || []) {
          const low = (parseAlt(s.lower) ?? 0) <= 1000 || isAgl(s.lower);
          if (!(s.cls === 'A' || (/^[CD]$/.test(s.cls || '') && (s.kind === 'CTR' || low)))) continue;
          if (ends.some((p) => inPoly(p, s.poly)) || !vOverlap(s) || polyRouteDist(s.poly, userPts) > 15) continue;
          obstacles.push({ z: { ...s, id: s.name, name: `(classe ${s.cls})`, type: s.kind || 'TMA' }, why: `classe ${s.cls}`, comfort: s.cls !== 'A' });
        }
      }
    }
    const directNm = userPts.slice(1).reduce((t, p, i) => t + distNm(userPts[i], p), 0);
    const mg = f.avoid === 'easy' ? 1 : 2;   // route facile : on longe le bord à 1 NM
    let routed = obstacles.length ? avoidRoute(userPts, userIds, obstacles, mg) : { pts: userPts, ids: userIds, detours: [] };
    // détour plafonné : au-delà de max(8 NM, 12 %), on renonce aux contournements « de confort » (CTR, C / D), les plus grands d'abord
    const lenOf = (r) => r.pts.slice(1).reduce((t, p, i) => t + distNm(r.pts[i], p), 0), cap = Math.max(8, directNm * 0.12), kept = [];
    let obs = obstacles.slice();
    while (f.avoid === 'easy' && lenOf(routed) - directNm > cap && obs.some((o) => o.comfort)) {
      const big = obs.filter((o) => o.comfort).sort((x, y) => y.z.poly.length - x.z.poly.length)[0];
      kept.push(big.z.id); obs = obs.filter((o) => o !== big);
      routed = obs.length ? avoidRoute(userPts, userIds, obs, mg) : { pts: userPts, ids: userIds, detours: [] };
    }
    if (f.avoid === 'easy') nameDetours(routed, obs, Object.entries((VFR && VFR.data) || {}).flatMap(([ad, l]) => l.filter((v) => !/HEL|hélicoptère|réservé/i.test(v.desc))
      .map((v) => ({ tok: `${ad.slice(2)}-${v.id}`, p: [v.la, v.lo], desc: v.desc }))), (LANDM && LANDM.towns) || []);
    const pts = routed.pts, ids = routed.ids;
    const adIds = [...new Set([...userIds, f.alt].filter((id) => id && A.aptByIcao[id]))];
    const varDeg = (() => {
      const v = [vacOf(f.dep), vacOf(f.arr)].map((x) => x && x.var).filter((x) => typeof x === 'number');
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    })();

    // --- Vent en altitude
    // altitudes par branche (1re étape seulement, si leur nombre correspond aux branches de la route calculée)
    const lf = (f.legft || '').split(/[\s,;→>-]+/).filter(Boolean).map(Number), legFt = lf.length === pts.length - 1 && lf.every((x) => x >= 500 && x <= 12500) ? lf : null;
    const mids = []; for (let i = 0; i < pts.length - 1; i++) mids.push([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]);
    let winds = null, windErr = null;
    if (horizon < -1 || horizon > 15) windErr = 'Vent non disponible pour cette date (prévisions à 16 jours).';
    else {
      const times = []; let accD = 0;
      for (let i = 0; i < pts.length - 1; i++) { const dd = distNm(pts[i], pts[i + 1]); times.push(new Date(depT.getTime() + (accD + dd / 2) / f.tas * 3600e3)); accD += dd; }
      try {   // altitudes par branche : un tirage de vent par altitude (même requête Open-Meteo, en cache)
        winds = await windsAloft(mids, f.ft, times);
        for (const a of new Set(legFt || [])) if (a !== f.ft) { const w = await windsAloft(mids, a, times); legFt.forEach((x, i) => { if (x === a) winds[i] = w[i]; }); }
      } catch (e) { windErr = 'Vent en altitude indisponible (' + e.message + ').'; } }

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

    // --- Branches (1re branche : surplus de montée + roulage)
    const elevOf = (id) => { const v = vacOf(id), a = A.aptByIcao[id]; return v && v.alt != null ? v.alt : (a && +a.elev) || 0; };
    const climb = climbExtra(f.T, legFt ? legFt[0] : f.ft, elevOf(f.dep), f.tas, f.ff);
    const legs = [];
    let t = depT.getTime(), totDist = 0, totMin = 0, totFuel = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = distNm(pts[i], pts[i + 1]), tc = bearing(pts[i], pts[i + 1]);
      const w = winds && winds[i] && winds[i].spd != null ? winds[i] : { dir: 0, spd: 0 };
      const { wca, gs } = windTriangle(tc, w, f.tas);
      const th = (tc + wca + 360) % 360;
      let min = Math.round(dist / gs * 60);
      let fuel = Math.round(min * f.ff / 60);
      if (i === 0) { min += climb.min; fuel += climb.fuel; }
      const ft = legFt ? legFt[i] : f.ft;
      if (i > 0 && legFt && ft > legFt[i - 1]) { const c = climbExtra(f.T, ft, legFt[i - 1], f.tas, f.ff); min += c.min; fuel += Math.max(0, c.fuel - TAXI_L); }   // remontée en route
      legs.push({ from: ids[i], to: ids[i + 1], a: pts[i], b: pts[i + 1], dist, tc, tm: (tc - varDeg + 360) % 360, th, hm: (th - varDeg + 360) % 360, wca, gs, min, fuel, wind: winds ? w : null, eto: new Date(t + min * 6e4), safe: safe && safe[i], ft });
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
    let reqFuel = totFuel + (altLeg ? altLeg.fuel : 0) + resFuel;
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
    for (const z of allZones) {
      const d = polyRouteDist(z.poly, pts);
      if (d > f.cor) continue;
      zones.push({ z, d, crossed: d === 0, below: vOverlap(z), act: /^[RD]$/.test(z.type) && !z.rtba ? zoneStatus(z, t0, t1, N.fir || []) : null });
    }
    zones.sort((a, b) => (a.z.type + a.z.id).localeCompare(b.z.type + b.z.id));
    const rtba = zones.filter((x) => x.z.rtba).map((x) => {
      const slots = rtbaSlots(x.z);
      return { ...x, slots, conflict: slots.some((s) => slotOverlap(s, dayStart, T0, T1)) };
    });
    const azbaKnown = acts.length > 0 && Math.abs(horizon) < 1.5;

    // --- Terrains : briefing départ / arrivée
    // réserve météo : +x % du carburant d'étape si vent de face moyen > 15 kt ou météo en route marginale
    const wxRoute = await routeWeather(pts, legs, depT, f.ft).catch((e) => ({ err: e.message }));
    const ens = horizon <= 14 && wxRoute && wxRoute.pts && wxRoute.pts.length ? await ensembleProb(wxRoute.pts).catch((e) => ({ err: e.message })) : null;
    const conf = horizon <= 10 && wxRoute && wxRoute.pts && wxRoute.pts.length ? await modelConfidence(wxRoute.pts).catch((e) => ({ err: e.message })) : null;
    const aq = horizon < 4 && wxRoute && wxRoute.pts ? await airQuality(wxRoute.pts).catch((e) => { console.warn('qualité de l\'air', e); return null; }) : null;
    const head = totDist ? legs.reduce((s, lg) => s + (lg.wind ? lg.wind.spd * Math.cos(rad(lg.wind.dir - lg.tc)) : 0) * lg.dist, 0) / totDist : 0;
    const wxWhy = [head > 15 && `vent de face moyen ${Math.round(head)} kt`, wxRoute && wxRoute.worst >= 1 && `météo « ${WXTXT[wxRoute.worst]} »`].filter(Boolean);
    const wxRes = f.wxres > 0 && wxWhy.length ? { L: Math.ceil(totFuel * f.wxres / 100), why: wxWhy, pct: f.wxres } : null;
    if (wxRes) reqFuel += wxRes.L;
    const sun = sunTimes(eta, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    const sunDep = sunTimes(depT, pts[0][0], pts[0][1]);
    const mb = massBalance(f);
    const landMass = mb.mass - totFuel * f.T.fuel.density;
    // centrage à l'atterrissage : carburant consommé pris dans le réservoir principal
    mb.ldgCg = mb.cg == null ? null : (mb.mom - totFuel * f.T.fuel.density * f.T.fuel.tanks[0].arm) / landMass;
    const fcList = [[f.dep, depT], [f.arr, eta], ...(f.alt ? [[f.alt, eta]] : [])];
    const fc = await surfaceForecast(fcList).catch((e) => { console.warn('prévision au sol', e); return []; });
    const terrain = (id, role) => {
      const v = vacOf(id), a = A.aptByIcao[id];
      const w = wx.find((x) => x.id === id);
      const m = (w && w.metar) || (w && w.near && w.near.m) || null;
      // vol dans les 2 h : METAR ; plus tard (ou sans METAR) : prévision Open-Meteo à l'heure du décollage / de l'arrivée
      const when = role === 'DÉPART' ? depT : eta, soon = Math.abs(when - Date.now()) < 2 * 3600e3;
      const p = fc[{ 'DÉPART': 0, 'ARRIVÉE': 1, 'DÉGAGEMENT': 2 }[role]], useFc = !!p && (!soon || !m);
      const wdir = useFc ? p.wdir : m && m.wdir !== 'VRB' ? +m.wdir : null, wspd = useFc ? p.wspd : m ? m.wspd : null;
      const rw = runwayFor(v, wdir, wspd);
      const len = rwyLength(v), grass = isGrass(v);
      const elev = elevOf(id);
      const tIsa = 15 - 2 * elev / 1000, temp = useFc && p.temp != null ? p.temp : m && m.temp != null ? m.temp : tIsa;
      const pa = elev + (!useFc && m && m.altim ? (1013.25 - m.altim) * 27 : 0), da = Math.round((pa + 118.8 * (temp - (15 - 2 * pa / 1000))) / 100) * 100;
      const factor = (1 + 0.10 * elev / 1000) * (1 + 0.10 * Math.max(0, temp - tIsa) / 10);
      const base = f.T.takeoff ? (grass ? (f.T.takeoff.grass || f.T.takeoff.hard * 1.15) : f.T.takeoff.hard) : null;
      // vent : rien si VRB ; vent de face compté seulement avec le METAR d'un vol dans les 2 h (prévision : seule la pénalité de vent arrière reste)
      const head0 = wdir != null && rw ? rw.best.head || 0 : 0;
      const pc = { elev, temp, grass, head: soon && !useFc ? head0 : Math.min(0, head0), mass: role === 'DÉPART' ? mb.mass : landMass };
      const tod = f.T.takeoff && f.T.takeoff.table ? perfDist(f.T.takeoff.table, pc) : base ? Math.round(base * factor / 10) * 10 : null;
      const ldg = f.T.landing && f.T.landing.table ? perfDist(f.T.landing.table, pc) : null;
      const cons = classifyConsignes(v);
      return { id, role, a, v, m, rw, len, grass, elev, temp, da, wdir, wspd, gust: useFc ? p.gust : m ? m.wgst : null, wxSrc: useFc ? 'prévision' : 'METAR', when, tod, ldg, factor, cons, infos: infosVac(v), notams: (adNotams.find((x) => x.id === id) || {}).list || [] };
    };
    const depInfo = terrain(f.dep, 'DÉPART'), arrInfo = terrain(f.arr, 'ARRIVÉE'), altInfo = f.alt ? terrain(f.alt, 'DÉGAGEMENT') : null;

    const cams = (id) => {
      const a = A.aptByIcao[id];
      return A.SOURCES.filter((s) => s.t === 'cam').map((s) => ({ s, d: distNm([a.la, a.lo], [s.la, s.lo]) * 1.852 })).filter((x) => x.d <= 15).sort((x, y) => x.d - y.d).slice(0, 5);
    };

    const res = {
      f, userIds, userPts, ids, pts, detours: routed.detours, obstacles, legs, climb, totDist, totMin, totFuel, eta, depT, altLeg, resFuel, reqFuel, loaded,
      sun, sunDep, varDeg, winds, windErr, elevErr, wx, wxNear, adNotams, enroute, general, obst, sups, zones, rtba, azbaKnown,
      mb, landMass, depInfo, arrInfo, altInfo, cams: { dep: cams(f.dep), arr: cams(f.arr) },
      profile, mids, depElev: elevOf(f.dep), wxRoute, conf, ens, aq, wxRes, directNm, avoided: [...new Set(routed.detours.map((d) => d.around))], crossedOk: kept,
      vprofile: verticalProfile(profile, (ASP && ASP.data) || [], zones, f.ft),
      generated: new Date(), notamGenerated: N.generated, vacCycle: VAC && VAC.cycle, aspSource: ASP && ASP.source,
    };
    // route facile en montagne : si la base des nuages passe sous l'altitude de sécurité, on cherche un passage plus bas par les vallées
    const lowWx = !f._valley && f.avoid === 'easy' && wxRoute && wxRoute.pts
      ? wxRoute.pts.filter((x) => x.low >= 50 && x.baseAmsl != null && legs[x.leg] && legs[x.leg].safe && legs[x.leg].safe.terrain >= 1500 && legs[x.leg].safe.alt > x.baseAmsl) : [];
    if (lowWx.length && res.vprofile) {
      const k = userPts.slice(1).reduce((m, p, i) => (distNm(userPts[i], p) > distNm(userPts[m], userPts[m + 1]) ? i : m), 0);   // branche principale (hors points d'entrée / sortie)
      const vr = await valleyRoute(userPts[k], userPts[k + 1]).catch(() => null);
      if (vr && vr.pts.length && vr.maxFt < res.vprofile.maxTer - 500) {
        const vids = vr.pts.map((p) => { const id = `VL${++customN}`, t = townNear(p, (LANDM && LANDM.towns) || []); CUSTOM[id] = { la: p[0], lo: p[1], name: t && t.d <= 5 ? `vallée, vers ${t.n}` : 'vallée', token: `${p[0].toFixed(4)}/${p[1].toFixed(4)}` }; return id; });
        const alt = await compute({ ...f, _valley: true }, [...userIds.slice(0, k + 1), ...vids, ...userIds.slice(k + 1)]).catch(() => null);
        if (alt && alt.vprofile && alt.vprofile.maxTer < res.vprofile.maxTer - 500 && alt.totDist <= res.totDist * 1.4) {
          return Object.assign(alt, { userPts, directNm, valley: { base: Math.min(...lowWx.map((x) => x.baseAmsl)), from: res.vprofile.maxTer, to: alt.vprofile.maxTer, nm: res.totDist } });
        }
      }
    }
    return res;
  }

  // ================================================================== météo le long de la route
  // Prévision modèle (Open-Meteo) à l'heure de passage : plafond estimé (écart T/Td), nuages bas, visibilité, pluie, orages.
  // avis VFR d'un point de prévision : 0 favorable, 1 marginal, 2 défavorable (plafond estimé par l'écart T / Td)
  function wxLevel(w, cruiseFt) {
    const { T, Td, low, vis, rr, wc, gust, elevFt } = w;
    const baseAgl = T != null && Td != null ? Math.max(0, Math.round((T - Td) * 400 / 100) * 100) : null;
    const baseAmsl = baseAgl != null ? Math.round((baseAgl + elevFt) / 100) * 100 : null;
    let level = 0; const why = [];
    if (vis != null && vis < 5000) { level = 2; why.push(`visi ${Math.round(vis / 100) / 10} km`); } else if (vis != null && vis < 8000) { level = Math.max(level, 1); why.push(`visi ${Math.round(vis / 100) / 10} km`); }
    if (low != null && low >= 70 && baseAgl != null && baseAgl < 1000) { level = 2; why.push(`plafond ~${baseAgl} ft sol`); }
    else if (low != null && low >= 50 && baseAgl != null && baseAgl < 2000) { level = Math.max(level, 1); why.push(`nuages bas ~${baseAgl} ft sol`); }
    if (low != null && low >= 50 && baseAmsl != null && baseAmsl < cruiseFt + 500) { level = Math.max(level, 1); why.push(`base ~${baseAmsl} ft < croisière`); }
    if (wc != null && wc >= 95) { level = 2; why.push('orages'); } else if (rr != null && rr >= 1) { level = Math.max(level, 1); why.push(`pluie ${rr} mm/h`); }
    if (gust != null && gust >= 25) { level = Math.max(level, 1); why.push(`rafales ${Math.round(gust)} kt`); }
    return { ...w, baseAgl, baseAmsl, level, why };
  }
  console.assert(wxLevel({ T: 10, Td: 9, low: 90, vis: 20000, rr: 0, wc: 3, gust: 10, elevFt: 0 }, 2500).level === 2 && wxLevel({ T: 15, Td: 5, low: 10, vis: 30000, rr: 0, wc: 1, gust: 10, elevFt: 0 }, 2500).level === 0, 'wxLevel');
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
      return { ...x, ...wxLevel({ T, Td, low, vis, rr, wc, gust, elevFt: Math.round((d[i].elevation || 0) * 3.281) }, cruiseFt) };
    });
    return { pts: pts2, worst: Math.max(0, ...pts2.map((x) => x.level)) };
  }
  const WXCOL = ['#2ecc40', '#ff9f0a', '#ff3b30'], WXTXT = ['VFR favorable', 'VFR marginal', 'VFR défavorable'];
  // ---------- indice de confiance : mêmes points / heures vus par 3 modèles (Open-Meteo « seamless » : AROME/ARPEGE, ICON, GFS)
  const MODELS = { meteofrance_seamless: 'Météo-France', icon_seamless: 'ICON', gfs_seamless: 'GFS' };
  // v : [{ m, base (ft sol, null = pas de couche basse ≥ 50 %), wind (kt), vis (m) }] -> raisons du désaccord
  function modelSpread(v) {
    const why = [], ft = (x) => (x.base == null ? 'pas de plafond bas' : `~${x.base} ft`);
    const ce = v.map((x) => (x.base == null ? 99999 : x.base)), lo = Math.min(...ce), hi = Math.max(...ce);
    if (lo < 2000 && hi - lo >= 1000) why.push(`plafond : ${v.map((x) => `${MODELS[x.m]} ${ft(x)}`).join(', ')}`);
    const ws = v.filter((x) => x.wind != null);
    if (ws.length > 1 && Math.max(...ws.map((x) => x.wind)) - Math.min(...ws.map((x) => x.wind)) >= 10) why.push(`vent : ${ws.map((x) => `${MODELS[x.m]} ${Math.round(x.wind)} kt`).join(', ')}`);
    const vs = v.filter((x) => x.vis != null);
    if (vs.length > 1 && Math.min(...vs.map((x) => x.vis)) < 5000 && Math.max(...vs.map((x) => x.vis)) >= 8000) why.push(`visibilité : ${vs.map((x) => `${MODELS[x.m]} ${Math.round(x.vis / 1000)} km`).join(', ')}`);
    return why;
  }
  console.assert(modelSpread([{ m: 'gfs_seamless', base: 600, wind: 8 }, { m: 'icon_seamless', base: null, wind: 10 }]).length === 1 && !modelSpread([{ m: 'gfs_seamless', base: 2400, wind: 8 }, { m: 'icon_seamless', base: null, wind: 12 }]).length
    && modelSpread([{ m: 'gfs_seamless', base: null, wind: 5, vis: 3000 }, { m: 'icon_seamless', base: null, wind: 18, vis: 20000 }]).length === 2, 'modelSpread');
  async function modelConfidence(wpts) {
    const n = Math.min(8, wpts.length), S = Array.from({ length: n }, (_, i) => wpts[Math.round(i * (wpts.length - 1) / Math.max(1, n - 1))]);
    const days = [...new Set(S.map((x) => x.at.toISOString().slice(0, 10)))].sort(), M = Object.keys(MODELS);
    let d = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${S.map((x) => x.p[0].toFixed(3)).join(',')}&longitude=${S.map((x) => x.p[1].toFixed(3)).join(',')}`
      + `&hourly=temperature_2m,dew_point_2m,cloud_cover_low,wind_speed_10m,visibility&models=${M.join(',')}&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`);
    if (!Array.isArray(d)) d = [d];
    const pts = S.map((x, i) => {
      const h = d[i].hourly, k = h.time.indexOf(roundHour(x.at)), g = (v, m) => (k < 0 ? null : (h[`${v}_${m}`] || [])[k] ?? null);
      const v = M.map((m) => { const T = g('temperature_2m', m), Td = g('dew_point_2m', m), low = g('cloud_cover_low', m);
        return { m, base: low != null && low >= 50 && T != null && Td != null ? Math.max(0, Math.round((T - Td) * 4) * 100) : null, wind: g('wind_speed_10m', m), vis: g('visibility', m), ok: T != null }; }).filter((y) => y.ok);
      return { along: x.along, at: x.at, n: v.length, why: v.length > 1 ? modelSpread(v) : [] };
    });
    const bad = pts.filter((x) => x.why.length);
    return { pts, bad, n: Math.max(0, ...pts.map((x) => x.n)) };
  }
  // ---------- probabilité (ensemble ECMWF, 51 scénarios) : part des scénarios où toute la route a un plafond > 1500 ft sol et des rafales < 25 kt
  // M : [scénario][point] = { T, Td, low, gust }
  function ensStats(M) {
    const lowCeil = (x) => x.low != null && x.low >= 50 && x.T != null && x.Td != null && (x.T - x.Td) * 400 < 1500, windy = (x) => x.gust != null && x.gust >= 25;
    const n = M.length, pc = (k) => Math.round(100 * k / n);
    const ceil = M.filter((m) => !m.some(lowCeil)).length, gust = M.filter((m) => !m.some(windy)).length, both = M.filter((m) => !m.some((x) => lowCeil(x) || windy(x))).length;
    const pts = (M[0] || []).map((_, i) => pc(M.filter((m) => !lowCeil(m[i])).length));
    return { n, ceil: pc(ceil), gust: pc(gust), both: pc(both), pts };
  }
  console.assert((() => { const ok = { T: 15, Td: 5, low: 80, gust: 10 }, bas = { T: 8, Td: 7, low: 90, gust: 10 }, vent = { T: 15, Td: 5, low: 0, gust: 30 };
    const r = ensStats([[ok, ok], [ok, bas], [vent, ok], [ok, ok]]); return r.n === 4 && r.ceil === 75 && r.gust === 75 && r.both === 50 && r.pts.join() === '100,75'; })(), 'ensStats');
  async function ensembleProb(wpts) {
    const n = Math.min(6, wpts.length), S = Array.from({ length: n }, (_, i) => wpts[Math.round(i * (wpts.length - 1) / Math.max(1, n - 1))]);
    const days = [...new Set(S.map((x) => x.at.toISOString().slice(0, 10)))].sort();
    let d = await omFetch(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${S.map((x) => x.p[0].toFixed(2)).join(',')}&longitude=${S.map((x) => x.p[1].toFixed(2)).join(',')}`
      + `&hourly=temperature_2m,dew_point_2m,cloud_cover_low,wind_gusts_10m&models=ecmwf_ifs025&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`);
    if (!Array.isArray(d)) d = [d];
    const keys = Object.keys(d[0].hourly).filter((k) => /^temperature_2m(_member\d+)?$/.test(k)).map((k) => k.slice('temperature_2m'.length));
    const M = keys.map((sfx) => S.map((x, i) => { const h = d[i].hourly, k = h.time.indexOf(roundHour(x.at)), g = (v) => (k < 0 ? null : (h[v + sfx] || [])[k] ?? null);
      return { T: g('temperature_2m'), Td: g('dew_point_2m'), low: g('cloud_cover_low'), gust: g('wind_gusts_10m') }; })).filter((m) => m.every((x) => x.T != null));
    if (M.length < 10) throw new Error('ensemble incomplet');
    return { ...ensStats(M), at: S.map((x) => ({ along: x.along, at: x.at })) };
  }
  const ensHtml = (b) => { const e = b.ens; if (!e || e.err) return '';
    const worst = e.pts.map((v, i) => ({ v, x: e.at[i] })).sort((a, c) => a.v - c.v)[0];
    return `<div class="${e.both >= 80 ? 'okk' : 'warn'}">📊 <b>Probabilité VFR</b> (${e.n} scénarios ECMWF) : <b>${e.both} %</b> de chances d'avoir partout un plafond au-dessus de 1500 ft sol et des rafales sous 25 kt à l'heure de passage
      (plafond seul : ${e.ceil} %, rafales seules : ${e.gust} %)${worst && worst.v < 90 ? ` · point le plus incertain vers ${worst.x.along.toFixed(0)} NM (${utc(worst.x.at)}) : ${worst.v} %` : ''}. Plafond estimé par l'écart température / point de rosée, indicatif.</div>`; };
  const confHtml = (b) => { const c = b.conf; if (!c || c.err || c.n < 2) return '';
    return c.bad.length ? `<div class="warn">🎲 <b>Prévision incertaine</b> : les modèles (${Object.values(MODELS).join(', ')}) ne sont pas d'accord sur ${c.bad.length} des ${c.pts.length} points comparés — ${esc(c.bad.slice(0, 3).map((x) => `vers ${x.along.toFixed(0)} NM (${utc(x.at)}) : ${x.why.join(' ; ')}`).join(' · '))}. Prévoir une marge, regarder les webcams et la TEMSI avant de partir.</div>`
      : `<p class="meta">🎲 Confiance : ${c.n} modèles (${Object.values(MODELS).join(', ')}) d'accord sur le plafond, le vent et la visibilité aux ${c.pts.length} points comparés.</p>`; };

  // ================================================================== coupe verticale
  // couleurs des espaces par classe, proches des cartes OACI / applications de navigation
  const ASP_COL = { A: '#d32f2f', C: '#3949ab', D: '#1e88e5', E: '#43a047', G: '#9e9e9e', UNC: '#9e9e9e' };
  function verticalProfile(profile, asp, zones, cruiseFt) {
    if (!profile.length) return null;
    const segs = [];
    const add = (name, kind, lower, upper, color) => {
      let cur = null;
      profile.forEach((pp, i) => {
        const inside = inPoly(pp.p, kind.poly);
        if (inside && !cur) cur = { name, from: pp.along, to: pp.along, lower, upper, color, aglL: /ASFC|AGL/i.test(String(kind.lowerS)), aglU: /ASFC|AGL/i.test(String(kind.upperS)), ter: [], pts: [], lowerS: kind.lowerS, upperS: kind.upperS, freq: kind.freq };
        if (inside) { cur.to = pp.along; cur.ter.push(pp.ft); cur.pts.push([pp.along, pp.ft]); }
        if ((!inside || i === profile.length - 1) && cur) { segs.push(cur); cur = null; }
      });
    };
    for (const s of asp) {
      if (s.kind === 'SIV') continue;
      const lo = parseAlt(s.lower), up = parseAlt(s.upper);
      if (lo === null || lo > 12000) continue;
      if (polyRouteDist(s.poly, profile.map((x) => x.p)) > 0) continue;
      add(`${s.name} (${s.cls})`, { poly: s.poly, lowerS: s.lower, upperS: s.upper, freq: s.freq }, lo, Math.min(up ?? 12000, 12000), ASP_COL[s.cls] || '#9e9e9e');
    }
    for (const x of zones) {
      if (!x.crossed) continue;
      const lo = parseAlt(x.z.lower), up = parseAlt(x.z.upper);
      if (lo === null || lo > 12000) continue;
      add(`${x.z.id} ${x.z.name}`, { poly: x.z.poly, lowerS: x.z.lower, upperS: x.z.upper }, lo, Math.min(up ?? 12000, 12000), x.z.rtba ? '#ff3b30' : x.z.type === 'P' ? '#d81b60' : x.z.type === 'D' ? '#fb8c00' : x.z.type === 'ZRT' ? '#e65100' : '#8e24aa');
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
  // profil de vol : altitude par branche avec montée (~400 ft/NM) et descente (~300 ft/NM) jusqu'au tour de piste d'arrivée
  function flightPath(b, alts) {
    const arr = (b.arrInfo ? b.arrInfo.elev : 0) + 1000, out = [[0, b.depElev || 0]];
    let cur = b.depElev || 0, acc = 0;
    b.legs.forEach((lg, i) => {
      const a = alts[i], x1 = acc + lg.dist, next = i < b.legs.length - 1 ? alts[i + 1] : arr;
      if (a > cur) out.push([Math.min(x1, acc + (a - cur) / 400), a]);
      if (next < a) { out.push([Math.max(out[out.length - 1][0], x1 - (a - next) / 300), a]); out.push([x1, next]); cur = next; } else { out.push([x1, a]); cur = a; }
      acc = x1;
    });
    return out;
  }
  console.assert(flightPath({ depElev: 0, arrInfo: { elev: 0 }, legs: [{ dist: 30 }] }, [2000]).map(([x, f]) => `${Math.round(x)}/${f}`).join(' ') === '0/0 5/2000 27/2000 30/1000', 'flightPath');
  // dessin de la coupe ; opts : light (impression), pos { nm, ft } (avion en mode GPS), id
  const CUT = { W: 1000, H: 330, L: 44, R: 10, T: 14, B: 34 };
  function cutGeom(v, b) {
    const o = b.optAlt, opt = o && !o.plan.some((c) => c.hard.length) ? o.plan.map((c) => c.alt) : null;
    const top = Math.min(12500, Math.max(4000, b.f.ft + 2500, ...b.legs.map((l) => (l.ft || 0) + 2500), v.maxTer + 2500, ...(opt || []).map((a) => a + 2000)));
    const { W, H, L, R, T, B } = CUT;
    return { opt, top, X: (nm) => L + nm / v.total * (W - L - R), Y: (ft) => H - B - Math.max(0, Math.min(ft, top)) / top * (H - B - T) };
  }
  // début de la nuit aéronautique le long de la route (NM), ou null si tout le vol est de jour
  function nightAlong(b) {
    const v = b.vprofile; if (!v || !b.night) return null;
    const q = v.profile.find((p) => { const r = routePosAt(b, p.along), st = sunTimes(r.at, r.p[0], r.p[1]); return st && r.at > new Date(st.set.getTime() + 30 * 6e4); });
    return q ? q.along : null;
  }
  function cutSvg(v, b, opts = {}) {
    if (!v) return '';
    const { W, H, L, R, T, B } = CUT, { opt, top, X, Y } = cutGeom(v, b), lt = opts.light;
    const C = lt ? { bg: '#fff', txt: '#222', ax: '#456', grid: '#000' } : { bg: '#0d1b2a', txt: '#fff', ax: '#9bd', grid: '#fff' };
    const pad = v.total / Math.max(1, v.profile.length - 1) / 2;
    // espaces : polygone qui suit le relief quand la limite est en ASFC
    const conf = new Set(v.conflicts);
    const asp = v.segs.filter((sg) => sg.lower < top).map((sg) => {
      const pts = sg.pts.length > 1 ? sg.pts : [[sg.from - pad, sg.pts[0][1]], [sg.from + pad, sg.pts[0][1]]];
      const xs = pts.map(([a], k) => (k === 0 ? Math.max(0, a - pad) : k === pts.length - 1 ? Math.min(v.total, a + pad) : a));
      const up = pts.map(([, g], k) => `${X(xs[k]).toFixed(1)},${Y(sg.upper + (sg.aglU ? g : 0)).toFixed(1)}`), lo = pts.map(([, g], k) => `${X(xs[k]).toFixed(1)},${Y(sg.lower + (sg.aglL ? g : 0)).toFixed(1)}`).reverse();
      const x0 = X(xs[0]), x1 = X(xs[xs.length - 1]), lim = `${sg.lowerS || sg.lower} – ${sg.upperS || sg.upper}`;
      const lbl = x1 - x0 > 60 ? `<text x="${(x0 + 3).toFixed(1)}" y="${(Y(Math.min(sg.upper + (sg.aglU ? Math.max(...sg.ter) : 0), top)) + 10).toFixed(1)}" font-size="9" fill="${sg.color}" font-weight="bold">${esc(sg.name.slice(0, Math.floor((x1 - x0) / 5.5)))}</text>`
        + (x1 - x0 > 90 ? `<text x="${(x0 + 3).toFixed(1)}" y="${(Y(Math.min(sg.upper + (sg.aglU ? Math.max(...sg.ter) : 0), top)) + 20).toFixed(1)}" font-size="8" fill="${sg.color}">${esc(lim)}</text>` : '') : '';
      return `<polygon points="${[...up, ...lo].join(' ')}" fill="${sg.color}" fill-opacity="${conf.has(sg) ? .3 : .14}" stroke="${conf.has(sg) ? '#ff3b30' : sg.color}" stroke-width="${conf.has(sg) ? 2 : 1}"><title>${esc(sg.name)} : ${esc(lim)}${sg.freq ? ' · ' + esc(sg.freq) : ''}</title></polygon>${lbl}`;
    }).join('');
    // nuages (GRAMET : couches à plus de 50 %, en rouge clair si entre 0 et -15 °C) et isotherme 0 °C
    const g = b.gramet && !b.gramet.err ? b.gramet.cols : [];
    const cw = g.length > 1 ? (g[1].along - g[0].along) / 2 : 4;
    const clouds = g.map((c) => c.lv.slice(0, -1).map((x, k) => { const y2 = c.lv[k + 1], cc = (x.cc + y2.cc) / 2, t = (x.T + y2.T) / 2; if (cc < 50 || x.z > top) return '';
      return `<rect x="${X(Math.max(0, c.along - cw)).toFixed(1)}" y="${Y(y2.z).toFixed(1)}" width="${(X(Math.min(v.total, c.along + cw)) - X(Math.max(0, c.along - cw))).toFixed(1)}" height="${Math.max(1, Y(x.z) - Y(y2.z)).toFixed(1)}" fill="${t <= 0 && t >= -15 ? '#ffb4b4' : lt ? '#90a4ae' : '#eceff1'}" fill-opacity="${(cc / 100 * .55).toFixed(2)}"><title>nuages ${Math.round(cc)} %, ${Math.round(t)} °C${t <= 0 && t >= -15 ? ' — givrage possible' : ''}</title></rect>`; }).join('')).join('');
    const g0 = g.filter((c) => c.iso0 != null);
    const iso = g0.length > 1 ? `<polyline points="${g0.map((c) => `${X(c.along).toFixed(1)},${Y(c.iso0).toFixed(1)}`).join(' ')}" fill="none" stroke="#4fc3f7" stroke-dasharray="5 4"><title>isotherme 0 °C</title></polyline>` : '';
    const ter = `M${X(0)},${Y(0)} ` + v.profile.map((p) => `L${X(p.along).toFixed(1)},${Y(p.ft).toFixed(1)}`).join(' ') + ` L${X(v.total)},${Y(0)} Z`;
    const line = (pts) => pts.map(([a, f]) => `${X(a).toFixed(1)},${Y(f).toFixed(1)}`).join(' ');
    const planned = b.legs.map((l) => l.ft || b.f.ft);
    const cruise = `<polyline points="${line(flightPath(b, planned))}" fill="none" stroke="#ff2bd6" stroke-width="2.5"><title>profil prévu ${[...new Set(planned)].join(' / ')} ft</title></polyline>`;
    const best = opt && opt.some((a, i) => a !== planned[i]) ? `<polyline points="${line(flightPath(b, opt))}" fill="none" stroke="#2ecc40" stroke-width="2" stroke-dasharray="6 4"><title>profil conseillé ${opt.join(' → ')} ft</title></polyline>` : '';
    const step = top > 8000 ? 2000 : 1000, grid = [];
    for (let f = 0; f <= top; f += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${Y(f)}" y2="${Y(f)}" stroke="${C.grid}" stroke-opacity=".08"/><text x="${L - 4}" y="${Y(f) + 3}" font-size="9" fill="${C.ax}" text-anchor="end">${f}</text>`);
    const nmStep = v.total > 120 ? 20 : v.total > 50 ? 10 : 5;
    for (let n = 0; n <= v.total; n += nmStep) grid.push(`<text x="${X(n)}" y="${H - B + 11}" font-size="8" fill="${C.ax}" text-anchor="middle">${n}</text>`);
    let acc = 0, lastX = -99; const mk = [];
    // nom des points : sauté s'il chevauche le précédent ou l'arrivée (branches très courtes)
    b.legs.forEach((lg, i) => { const x = X(acc), show = x - lastX > 45 && X(v.total) - x > 45; if (show) lastX = x;
      mk.push(`<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" stroke="${C.grid}" stroke-opacity="${i ? .3 : 0}"/>${show ? `<text x="${x + (i ? 0 : 2)}" y="${H - 6}" font-size="9" fill="${C.txt}" text-anchor="${i ? 'middle' : 'start'}">${esc(lg.from)}</text>` : ''}`); acc += lg.dist; });
    mk.push(`<text x="${X(v.total) - 2}" y="${H - 6}" font-size="9" fill="${C.txt}" text-anchor="end">${esc(b.ids[b.ids.length - 1])}</text>`);
    const wx = b.wxRoute && b.wxRoute.pts ? b.wxRoute.pts.map((p) => `<circle cx="${X(p.along).toFixed(1)}" cy="${H - B + 20}" r="3.5" fill="${WXCOL[p.level]}"><title>${esc(utc(p.at))} ${esc(WXTXT[p.level])} ${esc(p.why.join(', '))}</title></circle>`).join('') : '';
    const calls = callPoints(b).map((c) => `<g><line x1="${X(c.nm).toFixed(1)}" x2="${X(c.nm).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#ffd60a" stroke-dasharray="2 3" stroke-opacity=".7"/><text x="${(X(c.nm) + 2).toFixed(1)}" y="${T + 22}" font-size="10">📞</text><title>Appeler ${esc(c.sg.name)}${c.sg.freq ? ' ' + esc(c.sg.freq) : ''} vers ${c.nm.toFixed(0)} NM (${utc(c.at)}) pour la clairance</title></g>`).join('');
    const tb = turnBacks(b).map((x) => `<g><line x1="${X(x.at).toFixed(1)}" x2="${X(x.at).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#ff9f0a" stroke-width="2" stroke-dasharray="6 3"/><text x="${(X(x.at) + 3).toFixed(1)}" y="${T + 36}" font-size="11" fill="#ff9f0a">↩ ${esc(x.back.icao)}</text><title>Demi-tour au plus tard ici si la base est sous ${x.need} ft (prévu ~${x.bad.baseAmsl} ft plus loin) : repli ${esc(x.back.icao)}</title></g>`).join('');
    const pp = pnrEtp(b), ppm = pp ? [[pp.etp, 'ETP', '#64d2ff', 'Point équitemps : au-delà, continuer est plus rapide que revenir au départ'], [pp.pnr, 'PNR', '#ff6b6b', 'Point de non-retour : au-delà, plus assez de carburant pour revenir au départ avec la réserve finale']]
      .filter(([nm]) => nm > 0 && nm < v.total).map(([nm, l, c, t]) => `<g><line x1="${X(nm).toFixed(1)}" x2="${X(nm).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="${c}" stroke-width="1.5" stroke-dasharray="3 3"/><text x="${(X(nm) + 3).toFixed(1)}" y="${T + 50}" font-size="10" font-weight="bold" fill="${c}">${l}</text><title>${t} (${nm.toFixed(0)} NM)</title></g>`).join('') : '';
    // nuit aéronautique : zone sombre à partir du point où l'on passerait après coucher + 30 min
    const nA = nightAlong(b), night = nA != null ? `<rect x="${X(nA)}" y="${T}" width="${X(v.total) - X(nA)}" height="${H - B - T}" fill="#1a237e" fill-opacity=".35"><title>nuit aéronautique à partir de ${nA.toFixed(0)} NM</title></rect><text x="${X(nA) + 3}" y="${T + 10}" font-size="9" fill="#9fa8da">🌙 nuit aéro</text>` : '';
    const ac = opts.pos ? `<g transform="translate(${X(opts.pos.nm).toFixed(1)},${Y(opts.pos.ft).toFixed(1)})"><circle r="6" fill="#00e5ff" stroke="#000"/><line x1="0" x2="0" y1="6" y2="${(H - B - Y(opts.pos.ft)).toFixed(1)}" stroke="#00e5ff" stroke-dasharray="2 2"/></g>` : '';
    return `<svg ${opts.id ? `id="${opts.id}"` : ''} viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:${C.bg};border-radius:6px;display:block;touch-action:pan-y" font-family="Helvetica, Arial, sans-serif">
      <rect width="${W}" height="${H}" fill="${C.bg}"/>${grid.join('')}${night}${clouds}${asp}${iso}<path d="${ter}" fill="#8d6e63"/>${cruise}${best}${calls}${tb}${ppm}${(b.fields || []).map((x) => `<path d="M${X(x.along).toFixed(1)},${H - B - 1} l-5,-9 h10 z" fill="#2ecc40"><title>Champ ${x.L} × ${x.W} m à ${x.along.toFixed(0)} NM</title></path>`).join('')}${glideGaps(b).map((g) => `<rect x="${X(g.from).toFixed(1)}" y="${H - B - 4}" width="${Math.max(2, X(g.to) - X(g.from)).toFixed(1)}" height="4" fill="#ff3b30"><title>Hors de portée de plané d'un terrain de ${g.from.toFixed(0)} à ${g.to.toFixed(0)} NM (il faudrait ${g.need} ft)</title></rect>`).join('')}${b.osmObst ? b.osmObst.turbines.filter((t) => t.top).map((t) => `<line x1="${X(t.along).toFixed(1)}" x2="${X(t.along).toFixed(1)}" y1="${Y(t.top - t.ft).toFixed(1)}" y2="${Y(t.top).toFixed(1)}" stroke="#00e5ff" stroke-width="2"><title>Éolienne ${t.ft} ft (sommet ~${t.top} ft)</title></line>`).join('') + b.osmObst.lines.map((l) => `<text x="${X(l.along).toFixed(1)}" y="${(Y(l.gnd) - 4).toFixed(1)}" font-size="13" text-anchor="middle">⚡<title>Ligne haute tension${l.kv ? ' ' + l.kv + ' kV' : ''} à ${l.along.toFixed(0)} NM</title></text>`).join('') : ''}${mk.join('')}${wx}${ac}
      <line class="vp-cur" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#ffd60a" stroke-width="1" visibility="hidden"/></svg>`;
  }
  function profileSvg(v, b, sfx = '') {
    if (!v) return '';
    const conf = new Set(v.conflicts), pad = v.total / Math.max(1, v.profile.length - 1) / 2, best = cutGeom(v, b).opt;
    const nA = nightAlong(b), nt = b.night, marg = nt ? Math.round((nt.night - b.eta) / 6e4) : null;
    return `<div class="vp-wrap">${cutSvg(v, b, { id: 'pf-vp' + sfx })}
      <div class="meta" id="pf-vpinfo${sfx}" style="min-height:2.6em">Survole ou touche la coupe pour voir le relief et les espaces à cet endroit (le point s'affiche aussi sur la carte). <button class="btn" id="pf-vp-big${sfx}">🔍 Agrandir</button></div>
      ${nt ? `<p class="meta">${nA != null ? `🌙 <b>Nuit aéronautique à partir de ${nA.toFixed(0)} NM</b>` : `☀️ Vol de jour : arrivée ${utc(b.eta)}, nuit aéro à ${esc(b.f.arr)} ${utc(nt.night)}`}${marg != null && marg > 0 ? ` — marge ${hhmm(marg)} : départ au plus tard ${utc(nt.latestDep)}` : ''}.</p>` : ''}
      <p class="meta"><span style="color:#ff2bd6">━</span> profil prévu${best ? ` · <span style="color:#2ecc40">╌</span> profil conseillé` : ''} · <span style="color:#4fc3f7">╌</span> isotherme 0 °C · nuages en gris (rouge clair : givrage possible) ·
        espaces : <span style="color:${ASP_COL.A}">A</span> <span style="color:${ASP_COL.C}">C</span> <span style="color:${ASP_COL.D}">D</span> <span style="color:${ASP_COL.E}">E</span>, zones <span style="color:#ff3b30">AZBA</span> <span style="color:#d81b60">P</span> <span style="color:#8e24aa">R</span> <span style="color:#fb8c00">D</span> · contour rouge = traversé à l'altitude prévue · 📞 = appeler pour la clairance (5 NM avant).</p></div>
      ${v.segs.length ? `<details><summary><b>Espaces et zones traversés</b> (${v.segs.length})</summary><table class="legs"><tr><th>Espace</th><th>De – à (NM)</th><th>Limites</th><th>Fréquence</th></tr>
        ${[...v.segs].sort((x, y) => x.from - y.from).map((sg) => `<tr${conf.has(sg) ? ' style="color:#ff6b6b;font-weight:bold"' : ''}><td style="text-align:left">${esc(sg.name)}</td><td>${Math.max(0, sg.from - pad).toFixed(0)} – ${Math.min(v.total, sg.to + pad).toFixed(0)}</td><td>${esc(sg.lowerS || sg.lower)} – ${esc(sg.upperS || sg.upper)}</td><td>${esc(sg.freq || '–')}</td></tr>`).join('')}</table></details>` : ''}`;
  }
  // curseur sur la coupe : relief et espaces à la position survolée
  function bindProfile(b, sfx) {
    const sv0 = $('#pf-vp' + sfx); if (!sv0 || !b.vprofile) return;
    cursorOn(b, sv0, $('#pf-vpinfo' + sfx));
    // en grand : bandeau en bas de l'écran, sur toute la largeur (comme les applications de navigation)
    $('#pf-vp-big' + sfx).addEventListener('click', () => {
      document.getElementById('vp-big')?.remove();
      const d = document.createElement('div'); d.id = 'vp-big';
      d.innerHTML = `<button class="btn" style="float:right">✕ Fermer</button><b>✈️ Coupe ${esc(b.ids.join(' → '))}</b><div class="meta vp-info">Survole ou touche la coupe.</div>`;
      const c = ($('#pf-vp' + sfx) || sv0).cloneNode(true); c.removeAttribute('id'); d.insertBefore(c, d.querySelector('.vp-info'));
      d.querySelector('button').addEventListener('click', () => d.remove());
      document.body.appendChild(d); cursorOn(b, c, d.querySelector('.vp-info'));
    });
  }
  let cutMark = null;
  function cursorOn(b, sv, info) {
    const v = b.vprofile;
    const cur = sv.querySelector('.vp-cur'), { W, L: Lm, R } = CUT;
    const show = (e) => {
      const pt = sv.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const x = pt.matrixTransform(sv.getScreenCTM().inverse()).x;
      const nm = Math.max(0, Math.min(v.total, (x - Lm) / (W - Lm - R) * v.total));
      const p = v.profile.reduce((m, q) => (Math.abs(q.along - nm) < Math.abs(m.along - nm) ? q : m), v.profile[0]);
      const sp = v.segs.filter((sg) => nm >= sg.from - 1.5 && nm <= sg.to + 1.5).map((sg) => `${sg.name} ${sg.lower + (sg.aglL ? p.ft : 0)}–${sg.upper + (sg.aglU ? p.ft : 0)} ft`);
      let acc = 0; const lg = b.legs.find((l) => (acc += l.dist) >= nm) || b.legs[b.legs.length - 1];
      cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.setAttribute('visibility', 'visible');
      info.innerHTML = `<b>${nm.toFixed(0)} NM</b> (${esc(lg.from)}→${esc(lg.to)}) · relief ${p.ft} ft · ${sp.length ? esc(sp.join(' · ')) : 'classe G (hors espaces et zones)'}`;
    };
    sv.addEventListener('pointermove', show); sv.addEventListener('pointerdown', show);
    // lien avec la carte : le point survolé s'affiche sur la route ; un clic centre la carte dessus
    const mk = (nm) => { const p = routePosAt(b, nm).p; if (!cutMark) cutMark = L.circleMarker(p, { radius: 7, color: '#000', weight: 2, fillColor: '#ffd60a', fillOpacity: 1, interactive: false }).addTo(map); else cutMark.setLatLng(p); return p; };
    const nmOf = (e) => { const pt = sv.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return Math.max(0, Math.min(v.total, (pt.matrixTransform(sv.getScreenCTM().inverse()).x - Lm) / (W - Lm - R) * v.total)); };
    sv.addEventListener('pointermove', (e) => mk(nmOf(e)));
    sv.addEventListener('click', (e) => map.panTo(mk(nmOf(e))));
    sv.addEventListener('pointerleave', () => { if (cutMark) { map.removeLayer(cutMark); cutMark = null; } });
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
        Consulter <a href="https://sofia-briefing.aviation-civile.gouv.fr/" target="_blank" rel="noopener" style="color:var(--link)">SOFIA-Briefing</a> (rubrique AZBA).</p>`;
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
      const wv = waveRisk(m);
      if (wv) warn.push(`${n} : ${wv}`);
      if (m.iso0 != null && m.iso0 < m.minAlt + 1000) warn.push(`${n} : isotherme 0 °C (~${Math.round(m.iso0 / 100) * 100} ft) proche de l'altitude de franchissement — givrage en cas de nuages.`);
    });
    return { legs, warn };
  }
  // onde de relief et rotors : composante du vent perpendiculaire à la chaîne (Pyrénées : axe ~110°/290°) à hauteur des crêtes
  function waveRisk(m) {
    if (!m.wind || m.wind.spd < 15 || m.hi.ft < 4000) return null;
    const pyr = m.hi.p[0] < 43.4, perp = pyr ? Math.abs(m.wind.spd * Math.sin(rad(m.wind.dir - 110))) : m.wind.spd;
    if (perp < 20) return null;
    const lee = pyr ? (Math.cos(rad(m.wind.dir - 200)) > 0 ? 'côté français (nord, effet de foehn)' : 'côté espagnol (sud)') : 'sous le vent des crêtes';
    return `${perp >= 30 ? 'onde de relief forte probable' : 'onde de relief possible'} — vent ${r3(m.wind.dir)}°/${Math.round(m.wind.spd)} kt, ${Math.round(perp)} kt perpendiculaire à la chaîne : rotors et descendances (jusqu'à 1000-2000 ft/min) ${lee}, turbulence sévère près du relief.${perp >= 30 ? ' Vol déconseillé à proximité des crêtes.' : ' Passer bien plus haut que les crêtes (≥ 3000 ft) ou éviter.'}`;
  }
  console.assert(/forte/.test(waveRisk({ wind: { dir: 200, spd: 35 }, hi: { ft: 8000, p: [42.8, 0] } }) || '') && /nord/.test(waveRisk({ wind: { dir: 200, spd: 35 }, hi: { ft: 8000, p: [42.8, 0] } })) && !waveRisk({ wind: { dir: 110, spd: 35 }, hi: { ft: 8000, p: [42.8, 0] } }), 'waveRisk');
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

  const ptLabel = (b, id) => { const d = (b.detours || []).find((x) => x.id === id), n = d ? d.name : /^VL/.test(id) && CUSTOM[id] ? CUSTOM[id].name : null; return n ? `${id} (${n})` : id; };
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
    if (b.userPts && (b.detours.length || b.valley)) L.polyline(b.userPts, { color: '#40c4ff', weight: 3, opacity: .9, dashArray: '8 7' })
      .bindTooltip(`Route directe : ${b.directNm.toFixed(0)} NM (route facile en magenta : ${b.totDist.toFixed(0)} NM)`, { className: 'tip', sticky: true }).addTo(routeLayer);
    const mo = mountainOf(b);   // onde / rotors : zone sous le vent (approximative, 12 NM de part et d'autre du point haut, 20 NM sous le vent)
    if (mo) mo.legs.forEach((m) => { if (!waveRisk(m)) return; const dn = (m.wind.dir + 180) % 360, ax = m.hi.p[0] < 43.4 ? 110 : (m.wind.dir + 90) % 360, e1 = destPt(m.hi.p, ax, 12), e2 = destPt(m.hi.p, ax + 180, 12);
      L.polygon([e1, e2, destPt(e2, dn, 20), destPt(e1, dn, 20)], { color: '#ff9f0a', weight: 1, fillOpacity: .18, dashArray: '3 4' })
        .bindTooltip(`Sous le vent (${r3(m.wind.dir)}°/${Math.round(m.wind.spd)} kt) : descendances et rotors probables — zone approximative à éviter`, { className: 'tip', sticky: true }).addTo(routeLayer); });
    glideGaps(b).forEach((g) => { const q = []; for (let a = g.from; a <= g.to + 0.01; a += 1) q.push(routePosAt(b, a).p);
      if (q.length > 1) L.polyline(q, { color: '#ff3b30', weight: 10, opacity: .4 }).bindTooltip(`Hors de portée de plané d'un terrain (${g.from.toFixed(0)}-${g.to.toFixed(0)} NM) : il faudrait ${g.need} ft`, { className: 'tip', sticky: true }).addTo(routeLayer); });
    firesNear(b).forEach((x) => L.circleMarker(x.p, { radius: 6, color: '#fff', weight: 1, fillColor: '#ff6d00', fillOpacity: .95 }).bindTooltip(`🔥 Feu détecté par satellite (${esc(x.t)} UTC, ${x.frp} MW)`, { className: 'tip' }).addTo(routeLayer));
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
          .bindTooltip(`${esc(ptLabel(b, b.ids[i]))} <span style="opacity:.7">(glisser pour déplacer)</span>`, { permanent: true, direction: 'right', className: 'tip' })
          .on('dragend', (e) => editRoute(b, i, e.target.getLatLng(), false)).addTo(routeLayer);
      } else {
        L.circleMarker(p, { radius: dt ? 4 : 6, color: '#fff', weight: 2, fillColor: dt ? '#ffd34d' : '#ff2bd6', fillOpacity: 1 })
          .bindTooltip(esc(ptLabel(b, b.ids[i])), { permanent: true, direction: 'right', className: 'tip' }).addTo(routeLayer);
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
    // terrains fermés par NOTAM, TAF et horaires à l'heure de passage
    for (const t of [b.depInfo, b.arrInfo, b.altInfo].filter(Boolean)) {
      t.notams.filter((n) => isClosure(n) && notamAt(n, t.when)).forEach((n) => al.unshift(`⛔ NOTAM ${n.ref} ${t.id} : ${/^MR/.test(n.q || '') ? 'piste fermée' : /^FA/.test(n.q || '') ? 'terrain fermé' : 'fermeture'} à l'heure ${t.role === 'DÉPART' ? 'du départ' : "d'arrivée"} (${utc(t.when)})${n.d ? `, créneaux ${n.d}` : ''} — ${(n.efr || n.e || '').slice(0, 140)}`));
      const tf = tafAt(A.tafs[t.id], t.when);
      if (tf && tf.bad && tf.bad.length) al.push(`TAF ${t.id} vers ${utc(t.when)} : ${tf.bad.join(' ; ')}.`);
      const oh = outsideHours(t.v, t.when);
      if (oh) al.push(`${t.id} : ${t.role === 'DÉPART' ? 'départ' : t.role === 'DÉGAGEMENT' ? 'dégagement éventuel' : 'arrivée'} ${utc(t.when)} en dehors des horaires ATS publiés (${oh.win}, fenêtre la plus large de la saison, à vérifier sur la VAC)${oh.ppr ? ' — PPR mentionné' : ''}.`);
    }
    al.push(...vfrMinima(b), ...icingAlerts(b), ...specialZones(b), ...borderAlerts(b), ...nightAlerts(b), ...safetyAlerts(b));
    dayAlerts(b).forEach((x) => (x.startsWith('⛔') ? al.unshift(x) : al.push(x)));
    if (fuelLines(b).short) al.push(`Réserve finale ${b.f.res} min inférieure au minimum légal (${fuelLines(b).legal} min ${fuelLines(b).legal === 45 ? 'de nuit' : 'de jour'}).`);
    perfWorst(b).filter((x) => !x.ok).forEach((x) => al.push(`${x.t.id} : ${x.k === 'tod' ? 'décollage' : 'atterrissage'} au plus défavorable ${x.worst} m, ${x.need} m avec la marge recommandée, pour ${x.t.len} m de piste — vérifier les performances.`));
    perfWorst(b).filter((x) => x.da - x.t.elev >= 2000).forEach((x) => al.push(`${x.t.id} : altitude-densité ${x.da} ft au plus chaud (terrain à ${x.t.elev} ft) — performances nettement réduites (décollage plus long, montée plus faible).`));
    recentAlerts(b).forEach((x) => (x.startsWith('⛔') ? al.unshift(x) : al.push(x)));
    semiCircular(b).forEach((x) => al.push(`Règle semi-circulaire : ${x.lg.from}→${x.lg.to} (Rm ${r3(x.lg.tm)}°, vers l'${x.east ? 'est' : 'ouest'}) à ${b.f.ft} ft, à plus de 3000 ft sol — prendre ${x.east ? 'un millier impair' : 'un millier pair'} + 500 ft${x.sug ? `, par exemple ${x.sug} ft` : ''}.`));
    const rf = regFt(b.f.rg.name);
    if (rf != null && Math.abs(rf - b.f.ft) > 1500) al.push(`Régime « ${b.f.rg.name} » prévu pour ${rf} ft alors que la croisière est à ${b.f.ft} ft : vitesse et consommation à revoir.`);
    for (const [k, lbl] of [['lic', 'Licence / prorogation'], ['med', 'Certificat médical']]) {
      const dv = b.f[k] ? new Date(b.f[k] + 'T23:59:59Z') : null;
      if (dv && dv < b.eta) al.unshift(`⛔ ${lbl} de ${b.f.pil || 'pilote'} expiré(e) le ${b.f[k].split('-').reverse().join('/')}.`);
      else if (dv && dv - b.depT < 30 * 864e5) al.push(`${lbl} de ${b.f.pil || 'pilote'} valable jusqu'au ${b.f[k].split('-').reverse().join('/')} : à renouveler.`);
    }
    if (b.windErr) al.push(b.windErr + ' Temps calculés sans vent.');
    if (b.elevErr) al.push(b.elevErr);
    if (b.detours.length) al.push(`Route modifiée pour contourner : ${[...new Set(b.detours.map((d) => d.around))].join(', ')} (points ${b.detours.map((d) => (d.name ? `${d.id} ${d.name}` : d.id)).join(', ')}).`);
    if (b.sun && b.eta > new Date(b.sun.set.getTime() + 30 * 6e4)) al.push(`Arrivée après la nuit aéronautique (coucher ${utc(b.sun.set)} + 30 min).`);
    if (b.sunDep && b.depT < new Date(b.sunDep.rise.getTime() - 30 * 6e4)) al.push('Départ avant le jour aéronautique.');
    (b.vigil || []).forEach((v) => al.push(`Vigilance Météo-France ${v.w.some((x) => x.lvl === 3) ? 'ROUGE' : 'ORANGE'} sur ${v.dep} pendant le vol : ${[...new Set(v.w.map((x) => x.ph))].join(', ')}.`));
    if (b.night && b.night.firstDark) al.push(`Nuit aéronautique à partir de ${b.night.firstDark.id} (passage ${utc(b.night.firstDark.eta)}, nuit ${utc(b.night.firstDark.night)}).`);
    if (b.loaded < b.reqFuel) al.push(`Carburant insuffisant : ${b.loaded} L à bord pour ${b.reqFuel} L requis (étape + dégagement + réserve).`);
    if (b.mb.mass > b.f.T.mtow) al.push(`Masse au décollage ${Math.round(b.mb.mass)} kg > MTOW ${b.f.T.mtow} kg.`);
    if (b.mb.cg == null) al.push(`Centrage non calculé : bras de levier ${b.f.T.label} à compléter (manuel de vol / fiche de pesée).`);
    else if (!b.mb.inEnv(b.mb.cg, b.mb.mass)) al.push(`Centrage hors limites au décollage (${b.mb.cg.toFixed(3)} m).`);
    if (b.mb.ldgCg != null && !b.mb.inEnv(b.mb.ldgCg, b.landMass)) al.push(`Centrage hors limites à l'atterrissage à ${b.f.arr} (${b.mb.ldgCg.toFixed(3)} m, ${Math.round(b.landMass)} kg).`);
    if (b.f.ac.note) al.push(`${b.f.ac.reg} : ${b.f.ac.note}. Performances : ${b.f.T.source || 'log ACB'}.`);
    const tanks = b.f.T.fuel.tanks;
    if ((tanks[0].cap && b.f.fuel > tanks[0].cap) || (tanks[1] && b.f.aux > tanks[1].cap)) al.push('Quantité de carburant supérieure à la capacité des réservoirs.');
    for (const x of crossWinds(b)) {
      if (x.max && x.crossG > x.max) al.unshift(`⛔ ${x.t.id} : vent traversier ${Math.round(x.cross)} kt${x.gust ? `, ${Math.round(x.crossG)} kt en rafale` : ''} sur la piste ${x.qfu} > ${x.max} kt démontré (${x.t.wxSrc}) — choisir un autre terrain ou un autre horaire.`);
      else if (x.max && x.crossG >= x.max * .8) al.push(`${x.t.id} : vent traversier ${Math.round(x.crossG)} kt${x.gust ? ' en rafale' : ''} sur la piste ${x.qfu}, proche de la limite démontrée (${x.max} kt).`);
      if (x.head != null && x.head < -5) al.push(`${x.t.id} : vent arrière ${Math.round(-x.head)} kt même sur la meilleure piste (${x.qfu}).`);
    }
    for (const t of [b.depInfo, b.arrInfo]) {
      if (t.len && t.tod && t.tod > t.len * 0.85) al.push(`${t.id} : distance de décollage estimée ${t.tod} m pour une piste de ${t.len} m — vérifier les performances.`);
    }
    for (const t of [b.arrInfo, b.altInfo].filter(Boolean)) if (t.len && t.ldg && t.ldg > t.len * 0.85) al.push(`${t.id} : distance d'atterrissage ${t.ldg} m pour une piste de ${t.len} m — vérifier les performances.`);
    b.rtba.filter((r) => r.conflict && r.below && r.crossed).forEach((r) => al.push(`AZBA : ${r.z.id} ${r.z.name} active pendant le vol (${r.slots.join(', ')} UTC).`));
    if (b.rtba.length && !b.azbaKnown) al.push('Créneaux AZBA non publiés pour cette date : consulter l\'AZBA la veille / le jour même.');
    b.zones.filter((x) => x.crossed && x.below && x.z.type === 'P').forEach((x) => al.push(`Zone interdite encore traversée : ${x.z.id} ${x.z.name} (départ/arrivée à l'intérieur ?).`));
    b.zones.filter((x) => x.crossed && x.below && x.act && x.act.st === 'active').forEach((x) => al.push(`⛔ Zone ${x.z.id} ${x.z.name} (${x.z.lower} – ${x.z.upper}) active pendant le vol (${x.act.why}) et traversée à ${b.f.ft} ft — contourner ou passer au-dessus / en dessous, ou obtenir l'accord du gestionnaire.`));
    b.zones.filter((x) => x.crossed && x.below && x.z.sup && x.z.sup.active !== false).forEach((x) => al.push(`${x.z.sup.active ? '⛔ ZRT active pendant le vol' : 'ZRT activable'} : ${x.z.name} (${x.z.id}, ${x.z.lower} – ${x.z.upper}) traversée — ${x.z.sup.active ? 'contournement obligatoire sauf accord du gestionnaire' : 'vérifier son activation (NOTAM, SIV)'} ; ${x.z.rmk.split(' — ')[1] || ''}.`));
    if (b.wxRoute && b.wxRoute.worst) al.push(`Météo en route : ${WXTXT[b.wxRoute.worst]} (${[...new Set(b.wxRoute.pts.flatMap((p) => p.why))].slice(0, 4).join(', ')}).`);
    if (b.ens && !b.ens.err && b.ens.both < 50) al.push(`Probabilité VFR faible : ${b.ens.both} % des scénarios ECMWF donnent un plafond au-dessus de 1500 ft sol et des rafales sous 25 kt sur toute la route.`);
    if (b.conf && b.conf.bad && b.conf.bad.length) al.push(`Prévision incertaine : les modèles météo divergent sur ${b.conf.bad.length} des ${b.conf.pts.length} points comparés (${b.conf.bad[0].why[0]}).`);
    if (b.gramet && !b.gramet.err && b.gramet.icing) al.push(`GRAMET : givrage probable près de ${b.f.ft} ft (nuage entre 0 et -15 °C) — vol VFR hors nuages impératif, prévoir une altitude plus basse.`);
    if (b.gramet && !b.gramet.err && b.gramet.storm) al.push('GRAMET : instabilité / orages possibles sur le trajet (voir TEMSI).');
    if (b.mountain) b.mountain.warn.forEach((w) => al.push('Montagne : ' + w));
    if (b.vprofile && b.vprofile.conflicts.length) al.push(`Coupe verticale : à ${b.f.ft} ft la route pénètre ${b.vprofile.conflicts.map((c) => c.name).slice(0, 4).join(', ')} — clairance ou changement d'altitude.`);
    if (b.legs.some((l) => l.safe && l.safe.alt > b.f.ft)) al.push(`Altitude de croisière ${b.f.ft} ft inférieure à l'alti sécu de ${b.legs.filter((l) => l.safe && l.safe.alt > b.f.ft).map((l) => `${l.from}-${l.to} (${l.safe.alt} ft)`).join(', ')}.`);
    return al;
  }

  // distances 15 m comparées à la piste (tableaux du manuel si disponibles, sinon estimation)
  function perfLine(b, sfx = '') {
    const it = (t, k, lbl) => t && t[k] ? `${lbl} ${esc(t.id)} <b>${t[k]} m</b>${t.len ? ` / piste ${t.len} m` : ''}${t.grass ? ' (herbe)' : ''} <span class="meta">(${Math.round(t.temp)} °C ${t.wxSrc}, altitude densité ${t.da} ft)</span>` : '';
    const s = [it(b.depInfo, 'tod', 'Décollage'), it(b.arrInfo, 'ldg', 'Atterrissage'), it(b.altInfo, 'ldg', 'Dégagement')].filter(Boolean);
    if (!s.length) return '';
    const tab = b.f.T.takeoff && b.f.T.takeoff.table;
    return `<p class="meta">🛫 ${s.join(' · ')} — ${tab ? 'tableaux du manuel de vol (altitude, température, masse, herbe ; vent de face compté seulement avec le METAR d\'un vol dans les 2 h)' : 'estimation'}, passage 15 m. Montée : ${esc(b.climb.src)}.</p>
      <p class="meta">📝 Route plan de vol (case 15) : <code id="pf-icao${sfx}">${esc(icaoRoute(b))}</code> <button class="btn" id="pf-icao-copy${sfx}">Copier</button></p>`;
  }
  // ---------- carburant minimal détaillé (30) : NCO.OP.125, avion VFR : étape + réserve finale 30 min de jour, 45 min de nuit
  function fuelLines(b) {
    const night = !!(b.night && (b.night.late || b.night.firstDark || b.night.early)), legal = night ? 45 : 30;
    const taxi = TAXI_L, climb = Math.max(0, (b.climb ? b.climb.fuel : taxi) - taxi), cruise = b.totFuel - taxi - climb;
    const rows = [['Roulage', taxi, 'mise en route, roulage, essais moteur'], ['Surplus de montée', climb, b.climb ? b.climb.src : ''], ['Croisière', cruise, `${b.totDist.toFixed(0)} NM au vent prévu`]];
    if (b.altLeg) rows.push([`Dégagement ${b.altLeg.to}`, b.altLeg.fuel, `${b.altLeg.dist.toFixed(0)} NM + approche`]);
    rows.push([`Réserve finale (${b.f.res} min)`, b.resFuel, `minimum légal ${legal} min ${night ? 'de nuit' : 'de jour'} (NCO.OP.125)`]);
    if (b.wxRes) rows.push([`Réserve météo (${b.wxRes.pct} %)`, b.wxRes.L, b.wxRes.why.join(' et ')]);
    return { rows, total: b.reqFuel, loaded: b.loaded, margin: b.loaded - b.reqFuel, legal, short: b.f.res < legal };
  }
  console.assert((() => { const r = fuelLines({ night: null, climb: { fuel: 6, src: '' }, totFuel: 30, totDist: 80, altLeg: null, f: { res: 20 }, resFuel: 9, wxRes: null, reqFuel: 39, loaded: 60 });
    return r.rows[1][1] === 4 && r.rows[2][1] === 24 && r.short && r.margin === 21; })(), 'fuelLines');
  // ---------- performances au plus défavorable (31) et altitude-densité (32)
  // marges recommandées : UK CAA Safety Sense 7 (×1,33 au décollage, ×1,43 à l'atterrissage ; herbe mouillée +10 % au décollage, +15 % à l'atterrissage par rapport à l'herbe sèche)
  function perfWorst(b) {
    const W = b.dayWx;
    return [[b.depInfo, 'tod', 'takeoff', b.mb.mass, 1.33, 1.10], [b.arrInfo, 'ldg', 'landing', b.landMass, 1.43, 1.15], [b.altInfo, 'ldg', 'landing', b.landMass, 1.43, 1.15]].filter(([t]) => t).map(([t, k, tk, mass, fac, wet]) => {
      const pt = W && W.pts.find((x) => x.id === t.id), day = new Date(t.when);
      const tMax = pt ? Math.max(t.temp, ...pt.h.time.map((x, i) => (x.slice(0, 10) === day.toISOString().slice(0, 10) ? pt.h.temperature_2m[i] : -99))) : t.temp;
      const rainy = pt ? pt.h.time.some((x, i) => Math.abs(Date.parse(x + 'Z') - t.when) <= 6 * 3600e3 && pt.h.precipitation[i] >= 0.3) : false;
      const tb = b.f.T[tk] && b.f.T[tk].table, pc = { elev: t.elev, temp: tMax, grass: t.grass, head: Math.min(0, t.rw ? t.rw.best.head || 0 : 0), mass };
      const base = tb ? perfDist(tb, pc) : t[k] ? Math.round(t[k] * (1 + 0.01 * Math.max(0, tMax - t.temp))) : null;
      const worst = base ? Math.round(base * (t.grass && rainy ? wet : 1) / 5) * 5 : null, need = worst ? Math.round(worst * fac / 5) * 5 : null;
      const isa = 15 - 2 * t.elev / 1000, da = Math.round((t.elev + 118.8 * (tMax - isa)) / 100) * 100;
      return { t, k, normal: t[k], worst, need, fac, tMax: Math.round(tMax), wet: t.grass && rainy, da, daNow: t.da, ok: need == null || !t.len || need <= t.len };
    });
  }
  function perfFuelHtml(b) {
    const F = fuelLines(b), P = perfWorst(b);
    return `<details><summary><b>⛽ Carburant minimal détaillé</b> — requis ${F.total} L, à bord ${F.loaded} L, marge <span style="color:${F.margin < 0 ? '#ff6b6b' : 'inherit'}">${F.margin} L</span></summary>
      <table class="legs"><tr><th>Poste</th><th>Litres</th><th>Détail</th></tr>${F.rows.map((r) => `<tr><td style="text-align:left">${esc(r[0])}</td><td>${r[1]}</td><td style="text-align:left">${esc(r[2])}</td></tr>`).join('')}
      <tr><th>Total requis</th><th>${F.total}</th><th></th></tr></table>
      ${F.short ? `<div class="warn">⚠️ Réserve finale ${b.f.res} min inférieure au minimum légal de ${F.legal} min.</div>` : ''}
      <p class="meta">Carburant inutilisable non compté : voir le manuel de vol. Pas d'imprévus de 5 % imposés en NCO, mais une marge reste prudente.</p></details>
      ${P.length ? `<details><summary><b>🛬 Performances au plus défavorable et altitude-densité</b></summary>
      <table class="legs"><tr><th>Terrain</th><th>Prévu</th><th>Défavorable</th><th>Avec marge</th><th>Piste</th><th>Alt.-densité</th></tr>
      ${P.map((x) => `<tr${x.ok ? '' : ' style="color:#ff6b6b;font-weight:bold"'}><td>${esc(x.t.id)} ${x.k === 'tod' ? 'décollage' : 'atterrissage'}</td>${x.normal ? `<td>${x.normal} m</td><td>${x.worst} m <small>(${x.tMax} °C${x.wet ? ', herbe mouillée' : ''}, sans vent de face)</small></td><td>${x.need} m <small>(×${String(x.fac).replace('.', ',')})</small></td>` : '<td colspan="3">pas de tableau dans le manuel saisi : voir le manuel de vol</td>'}<td>${x.t.len ?? '?'} m</td><td>${x.daNow ?? '–'} ft <small>(${x.da} ft au plus chaud)</small></td></tr>`).join('')}</table>
      <p class="meta">Défavorable : température maximale du jour au terrain, pas de vent de face, herbe mouillée s'il pleut dans les 6 h (+10 % au décollage, +15 % à l'atterrissage). Marges recommandées par l'UK CAA (Safety Sense 7). Pente de piste non comptée : voir la VAC.</p></details>` : ''}`;
  }

  // ---------- arrivée (24, 25) : début de descente, vario, intégration, tour de piste, piste probable
  function arrivalPlan(b) {
    const lN = b.legs[b.legs.length - 1], v = b.arrInfo.v || {}, tdpTxt = (v.tdp || [])[0] || '', tdpFt = +((/(\d{3,4})\s*ft/i.exec(tdpTxt) || [])[1] || 0) || (b.arrInfo.elev + 1000);
    const cruise = lN.ft || b.f.ft, drop = Math.max(0, cruise - tdpFt), gs = lN.gs || b.f.tas, vs3 = Math.round(gs * 5 / 50) * 50, vs = Math.min(500, vs3);
    const nm = drop / vs * gs / 60, entry = /^[A-Z]{1,3}-[A-Z0-9]+$/.test(lN.from) ? lN.from : null, ref = entry ? b.legs.reduce((s, l, i) => s + (i < b.legs.length - 1 ? l.dist : 0), 0) : b.totDist - 3;
    const todAlong = Math.max(0, ref - nm), tod = routePosAt(b, todAlong);
    const rw = b.arrInfo.rw, side = /main droite|right[- ]hand|RH\b|à droite/i.test(v.consignes || '') ? 'à droite (VAC)' : /main gauche|left[- ]hand|LH\b|à gauche/i.test(v.consignes || '') ? 'à gauche (VAC)' : 'côté : voir la VAC';
    return { tdpFt, tdpTxt, cruise, drop, vs, vs3, nm, todAlong, tod, entry, rw, side };
  }
  console.assert((() => { const b = { legs: [{ from: 'A', ft: 4500, gs: 100, dist: 30 }], f: { ft: 4500, tas: 100 }, totDist: 30, arrInfo: { elev: 0, v: { tdp: ['1000 ft (1000 ft AAL)'] }, rw: null }, depT: new Date(0) };
    b.legs[0].a = [43, 0]; b.legs[0].tc = 90; const r = arrivalPlan(b); return r.tdpFt === 1000 && r.vs === 500 && Math.round(r.nm * 10) === 117; })(), 'arrivalPlan');
  function arrivalHtml(b) {
    const x = arrivalPlan(b), vp = x.entry ? resolvePt(x.entry) : null;
    return `<details><summary><b>🛬 Arrivée à ${esc(b.f.arr)}</b> — descente vers ${x.todAlong.toFixed(0)} NM (${utc(x.tod.at)}), tour de piste ${x.tdpFt} ft</summary>
      <p class="meta">📉 <b>Début de descente</b> : ${x.drop ? `à ${x.nm.toFixed(1)} NM ${x.entry ? `avant ${esc(x.entry)}` : 'du terrain (3 NM avant)'}, soit vers ${x.todAlong.toFixed(0)} NM du départ (${utc(x.tod.at)}), de ${x.cruise} à ${x.tdpFt} ft à ${x.vs} ft/min (pente de 3° : ${x.vs3} ft/min à cette vitesse sol)` : 'pas de descente : croisière déjà à l\'altitude du tour de piste'}.</p>
      <p class="meta">🧭 <b>Intégration</b> : ${x.entry ? `par ${esc(x.entry)}${vp && vp.desc ? ` (${esc(vp.desc)})` : ''}` : 'en direct (pas de point d\'entrée publié choisi)'} · tour de piste <b>${esc(x.tdpTxt || x.tdpFt + ' ft')}</b> · ${esc(x.side)}
        · piste probable <b>${x.rw ? x.rw.best.qfu : '?'}</b>${x.rw && x.rw.best.head != null ? ` (vent ${x.rw.best.head >= 0 ? 'de face' : 'arrière'} ${Math.abs(Math.round(x.rw.best.head))} kt, travers ${Math.round(x.rw.best.cross)} kt)` : ''}.
        Fréquence : ${esc(((b.arrInfo.v || {}).freqs || [])[0] || 'A/A 123.500')}.</p>
      <p class="meta">Consignes particulières et circuit exact : <a href="data/vac/${esc(b.f.arr)}.pdf" target="_blank" rel="noopener" style="color:var(--link)">VAC ${esc(b.f.arr)}</a>.</p></details>`;
  }
  // ---------- fiche escale (26) : horaires du jour, PPR, carburant, paiement, taxe, contact, vie pratique
  function escaleCardHtml(b, sfx = '') {
    const id = b.f.arr, v = b.arrInfo.v || {}, e = (A.escaleOf && A.escaleOf(id)) || {}, fee = A.feeFor ? A.feeFor(id) : null, oh = outsideHours(v, b.eta), h = atsHours(v);
    const pr = e.pratique || {}, c = (e.contacts || []).find((x) => x.m === e.mail_escale) || {};
    const rows = [
      ['Horaires', h ? (oh ? `⚠️ arrivée ${utc(b.eta)} hors horaires (${oh.win})` : `arrivée ${utc(b.eta)} dans les horaires publiés`) + (h.ppr ? ' · PPR mentionné' : '') : 'H24 ou non précisé dans la VAC'],
      ['PPR / stationnement', (e.ppr || []).slice(0, 2).join(' — ') || 'pas de consigne relevée'],
      ['Carburant', e.none ? 'aucun' : (e.fuel || []).join(', ') || 'voir VAC'], ['Paiement', (e.pay || []).join(', ') || 'non précisé'],
      ['Taxe d\'atterrissage', fee ? `${fee.tarif}${fee.note ? ' — ' + fee.note : ''}` : 'non renseignée'],
      ['Contact', e.mail_escale ? `${e.mail_escale} (${c.r || 'VAC'})` : ''] , ['Téléphone', (e.tel_ad || []).join(' / ')],
      ['Situation', [pr.situation, pr.transport, pr.restaurant, pr.hotel].filter(Boolean).join(' · ')],
    ].filter((r) => r[1]);
    return `<details><summary><b>🏁 Fiche escale ${esc(id)}</b> ${esc((A.aptByIcao[id] || {}).name || '')}</summary><table class="legs">${rows.map((r) => `<tr><td style="text-align:left;white-space:nowrap">${esc(r[0])}</td><td style="text-align:left">${esc(r[1])}</td></tr>`).join('')}</table>
      <p class="meta">Relevé automatique de la VAC et des fiches du site : vérifier sur la VAC et auprès du terrain.
        ${(window.AWW_CONFIG || {}).contact ? `<button class="btn" data-propose="${esc(id)}">📤 Proposer la taxe / une info au club</button> (publiée pour tous les pilotes après vérification)` : ''}</p>
      <label class="meta">📝 Mes notes sur ${esc(id)} (gardées sur cet appareil, rappelées à chaque préparation)<textarea id="pf-note-${esc(id)}${sfx}" rows="2" style="width:100%">${esc(adNote(id))}</textarea></label><button class="btn" data-note="${esc(id)}">Enregistrer la note</button></details>`;
  }
  // ---------- meilleur dégagement (28) : terrains à moins de 40 NM de l'arrivée, ouverts, sans fermeture NOTAM, TAF correct, piste assez longue, carburant
  function bestAlternates(b) {
    const arr = A.aptByIcao[b.f.arr], when = new Date(b.eta.getTime() + 20 * 6e4), need = b.arrInfo.ldg ? Math.round(b.arrInfo.ldg * 1.43) : 600;
    return A.APTS.filter((a) => a.icao !== b.f.arr && a.icao !== b.f.dep && a.icao.startsWith('LF') && vacAt(a.icao)).map((a) => {
      const d = distNm([+arr.la, +arr.lo], [+a.la, +a.lo]); if (d > 40) return null;
      const v = vacAt(a.icao), len = rwyLength(v), why = [], good = [];
      if (outsideHours(v, when)) why.push('fermé à cette heure');
      if (((A.NOTAM || {}).ad || {})[a.icao] && A.NOTAM.ad[a.icao].some((n) => isClosure(n) && notamAt(n, when))) why.push('fermé par NOTAM');
      const tf = tafAt(A.tafs[a.icao], when); if (tf && tf.bad && tf.bad.length) why.push('TAF défavorable'); else if (tf && !tf.out) good.push('TAF correct');
      if (len && len < need) why.push(`piste ${len} m < ${need} m`);
      const fu = fuelAvail(v.escale, b.f.T); if (fu) good.push('carburant'); else if (fu === false) why.push('pas de carburant');
      if (/militaire|MIL\b/i.test((v.infos || '').slice(0, 300)) && !v.cap) why.push('militaire');
      return { a, d, len, why, good, score: why.length * 100 + d - good.length * 5 };
    }).filter(Boolean).sort((x, y) => x.score - y.score).slice(0, 3);
  }
  function altHtml(b, sfx) {
    const L0 = bestAlternates(b); if (!L0.length) return '';
    return `<p class="meta">🔀 Dégagements possibles pour ${esc(b.f.arr)} (${utc(b.eta)} + 20 min) : ${L0.map((x) => `<b>${esc(x.a.icao)}</b> ${esc(x.a.name)} (${x.d.toFixed(0)} NM${x.len ? `, ${x.len} m` : ''}${x.good.length ? ', ' + x.good.join(', ') : ''}${x.why.length ? ` — <span style="color:#ff9f0a">${esc(x.why.join(', '))}</span>` : ''})${x.a.icao !== b.f.alt ? ` <button class="btn" data-setalt="${esc(x.a.icao)}">choisir</button>` : ' ✅ choisi'}`).join(' · ')}</p>`;
  }
  // ---------- avitaillement conseillé en voyage (29)
  function refuelPlan(trip) {
    if (trip.length < 2) return null;
    const out = [];
    trip.forEach((b, k) => { const nx = trip[k + 1]; if (!nx) return;
      const left = Math.round(b.loaded - b.totFuel), needNext = nx.reqFuel, can = fuelAvail((b.arrInfo.v || {}).escale, b.f.T);
      out.push({ id: b.f.arr, left, needNext, must: left < needNext, can, dist: b.totDist }); });
    return out;
  }
  function refuelHtml(trip) {
    const P = refuelPlan(trip); if (!P) return '';
    return `<p class="meta">⛽ <b>Avitaillement conseillé</b> : ${P.map((x) => `${esc(x.id)} : ${x.must ? `<b style="color:${x.can === false ? '#ff6b6b' : '#ff9f0a'}">plein nécessaire</b> (reste ${x.left} L, il faut ${x.needNext} L pour l'étape suivante)${x.can === false ? ' — ⛔ pas de carburant sur place (VAC)' : x.can === null ? ' — carburant non confirmé' : ''}` : `pas nécessaire (reste ${x.left} L, besoin ${x.needNext} L)`}`).join(' · ')}.</p>`;
  }

  function turnBackHtml(b) {
    const T = turnBacks(b); if (!T.length) return '';
    return `<div class="warn">↩️ <b>Points de demi-tour météo</b> : ${T.map((x) => `${esc(x.lg.from)}→${esc(x.lg.to)} : base prévue ~${x.bad.baseAmsl} ft vers ${x.bad.along.toFixed(0)} NM, il faut au moins ${x.need} ft (relief + 1000 ft + 500 ft sous les nuages) — décider au plus tard vers <b>${x.at.toFixed(0)} NM</b> (${utc(routePosAt(b, x.at).at)}), repli <b>${esc(x.back.icao)}</b> ${esc(x.back.name || '')}`).join(' ; ')}. Marqués ↩ sur la coupe.</div>`;
  }
  // ---------- zones actives à l'heure de passage (44) : P, AZBA active, ZRT dans ses créneaux, R / D actives (plein) ; parachutage et R / D à vérifier (pointillés)
  function activeZones(b) {
    const out = [];
    for (const x of b.zones || []) {
      if (!x.crossed && x.d > 3) continue;
      const r = x.z.rtba && (b.rtba || []).find((y) => y.z === x.z), lim = `${x.z.lower} – ${x.z.upper}`, name = `${x.z.id} ${x.z.name}`;
      if (x.z.type === 'P') out.push({ poly: x.z.poly, col: '#d81b60', name, lim, why: 'zone interdite', sure: true });
      else if (x.z.rtba) { if (r && r.conflict) out.push({ poly: x.z.poly, col: '#ff3b30', name, lim, why: `AZBA active ${r.slots.join(', ')} UTC`, sure: true }); }
      else if (x.z.sup) { if (x.z.sup.active !== false) out.push({ poly: x.z.poly, col: '#e65100', name, lim, why: x.z.sup.active ? `ZRT active pendant le vol (SUP ${x.z.sup.num})` : `ZRT activable (SUP ${x.z.sup.num})`, sure: !!x.z.sup.active }); }
      else if (x.act && x.act.st !== 'inactive') out.push({ poly: x.z.poly, col: x.act.st === 'active' ? '#ff3b30' : '#fb8c00', name, lim, why: x.act.st === 'active' ? `active : ${x.act.why}` : `à vérifier : ${x.act.why}`, sure: x.act.st === 'active' });
    }
    const smp = routeSamples(b, 2);
    for (const a of (SPECIAL || {}).act || []) {
      if (Math.min(...smp.map((x) => distNm(x.p, [a.la, a.lo]))) > 3) continue;
      const r = /^FL/.test(a.upper) ? 2.5 : 1.5, poly = []; for (let k = 0; k < 360; k += 30) poly.push(destPt([a.la, a.lo], k, r));
      out.push({ poly, col: '#8e24aa', name: `${a.kind} ${a.name}`, lim: `jusqu'à ${a.upper}`, why: `${a.hours || 'horaires : voir AIP / NOTAM'} — cercle indicatif autour du site (ENR 5.5)`, sure: false });
    }
    return out;
  }
  // ---------- fréquences dans l'ordre du vol (43)
  function freqTimeline(b) {
    const out = [], fq = (id) => ((vacAt(id) || {}).freqs || []);
    out.push({ nm: 0, at: b.depT, where: `${b.f.dep} (départ)`, freq: fq(b.f.dep).join(' · ') || 'A/A 123.500', what: 'ATIS puis sol / tour / AFIS ou auto-information' });
    const v = b.vprofile, seen = new Set();
    let acc = 0;
    b.legs.forEach((lg) => { lg.airspaces.filter((s) => s.kind === 'SIV' && s.freq).forEach((s) => { if (seen.has(s.freq)) return; seen.add(s.freq); out.push({ nm: acc, at: routePosAt(b, acc).at, where: `${s.name} (SIV)`, freq: s.freq, what: 'information de vol, écoute conseillée' }); }); acc += lg.dist; });
    const conf = new Set(v ? v.conflicts : []);
    ((v && v.segs) || []).filter((sg) => sg.freq && !/CTR/.test(sg.name) && sg.from > 3).sort((x, y) => x.from - y.from).forEach((sg) => {
      if (seen.has(sg.freq)) return; seen.add(sg.freq);
      const nm = Math.max(0, sg.from - (conf.has(sg) ? 5 : 1));
      out.push({ nm, at: routePosAt(b, nm).at, where: sg.name, freq: sg.freq, what: conf.has(sg) ? 'traversé à l\'altitude prévue : demander le transit 5 NM avant' : 'au-dessus / en dessous : écoute ou contact recommandé' });
    });
    const ap = typeof arrivalPlan === 'function' ? arrivalPlan(b) : null;
    out.push({ nm: ap ? ap.todAlong : b.totDist - 10, at: ap ? ap.tod.at : routePosAt(b, b.totDist - 10).at, where: `${b.f.arr} (arrivée)`, freq: fq(b.f.arr).join(' · ') || 'A/A 123.500', what: 'ATIS / information, puis tour ou AFIS ou auto-information avant le début de descente' });
    return out.sort((x, y) => x.nm - y.nm);
  }
  function freqHtml(b) {
    const F = freqTimeline(b);
    return `<details><summary><b>📻 Fréquences dans l'ordre du vol</b> (${F.length})</summary><table class="legs"><tr><th>Heure</th><th>NM</th><th>Où</th><th>Fréquence</th><th>Quoi</th></tr>
      ${F.map((x) => `<tr><td>${utc(x.at)}</td><td>${x.nm.toFixed(0)}</td><td style="text-align:left">${esc(x.where)}</td><td style="text-align:left">${esc(x.freq)}</td><td style="text-align:left">${esc(x.what)}</td></tr>`).join('')}</table>
      <p class="meta">Ordre calculé sur la route et l'altitude prévues. Fréquences des espaces : données OpenAir FFVP et VAC, à vérifier sur la carte.</p></details>`;
  }
  // ---------- terrains à éviter pour l'avion (46) : piste trop courte (distance du manuel à la masse max, ISA + 15 °C, avec marge), dès la saisie
  function adCheck(id, T) {
    const v = vacAt(id), a = A.aptByIcao[id]; if (!v || !a) return null;
    const len = rwyLength(v), grass = isGrass(v), elev = v.alt != null ? +v.alt : +a.elev || 0, pc = { elev, temp: 30, grass, head: 0, mass: T.mtow };
    const to = T.takeoff && T.takeoff.table ? perfDist(T.takeoff.table, pc) : null, ld = T.landing && T.landing.table ? perfDist(T.landing.table, pc) : null;
    const need = Math.max(to ? to * 1.33 : 0, ld ? ld * 1.43 : 0), why = [];
    if (len && need && len < need) why.push(`piste ${len} m${grass ? ' (herbe)' : ''} : il faut ~${Math.round(need / 10) * 10} m à la masse max par 30 °C avec la marge recommandée`);
    else if (len && need && len < need * 1.15) why.push(`piste ${len} m${grass ? ' en herbe (herbe mouillée : +10 à 15 %)' : ''}, juste à la masse max par forte chaleur`);
    if (/interdit[^.]{0,60}(?:avions?|ACFT|aéronefs?) (?:non |de plus|>)|réservé aux (?:hélicoptères|ULM|planeurs)/i.test(v.consignes || '')) why.push('restrictions d\'usage dans la VAC (à lire)');
    if (v.prive || v.restreint) why.push(v.prive ? 'usage privé : autorisation nécessaire' : 'usage restreint : autorisation nécessaire');
    return why.length ? { id, why } : null;
  }
  function adCheckHtml() {
    const box = $('#pf-adcheck'); if (!box) return;
    const ac = FLEET.find((x) => x.reg === $('#pf-reg').value) || FLEET[0], T = TYPES[ac.type];
    const ids = [...new Set([$('#pf-dep').value, $('#pf-arr').value, $('#pf-alt').value, ...$('#pf-stages').value.split(/[\s,;]+/), ...$('#pf-wps').value.split(/[\s,;]+/)].map((x) => (x || '').trim().toUpperCase()).filter((x) => /^LF[A-Z]{2}$/.test(x)))];
    const bad = ids.map((id) => adCheck(id, T)).filter(Boolean);
    box.innerHTML = bad.length ? bad.map((x) => `<div class="warn" style="margin:2px 0">⚠️ ${esc(x.id)} pour ${esc(ac.reg)} : ${esc(x.why.join(' ; '))}</div>`).join('') : '';
  }
  // ---------- notes personnelles par terrain (47), gardées sur l'appareil
  const adNote = (id) => (store.get('adnotes', {})[id] || '');
  function notesHtml(b) {
    const ids = [...new Set([b.f.dep, b.f.arr, b.f.alt].filter(Boolean))].filter((id) => adNote(id));
    return ids.length ? `<div class="okk">📝 <b>Tes notes</b> : ${ids.map((id) => `<b>${esc(id)}</b> ${esc(adNote(id))}`).join(' · ')}</div>` : '';
  }
  // ---------- vol local (45) : pas de route, une zone de travail autour du terrain, durée, carburant, espaces, météo
  async function localPrep(f) {
    await loadAip();
    const a = A.aptByIcao[f.dep], c = [+a.la, +a.lo], R = f.lrad || 15, dur = f.ldur || 60, t0 = new Date(f.time), t1 = new Date(t0.getTime() + dur * 6e4);
    const fuelNeed = Math.round(dur * f.ff / 60) + TAXI_L, res = Math.round(f.res / 60 * f.ff), loaded = f.fuel + f.aux, mb = massBalance(f);
    const near = (poly) => poly.some((p) => distNm(c, p) <= R) || inPoly(c, poly);
    const asp = ((ASP && ASP.data) || []).filter((s) => s.kind !== 'SIV' && near(s.poly) && (parseAlt(s.lower) ?? 0) < 6000).sort((x, y) => (parseAlt(x.lower) ?? 0) - (parseAlt(y.lower) ?? 0));
    const zs = ((ZONES && ZONES.data) || []).filter((z) => near(z.poly) && (parseAlt(z.lower) ?? 0) < 6000).map((z) => ({ z, act: /^[RD]$/.test(z.type) && !z.rtba ? zoneStatus(z, t0.getTime(), t1.getTime(), (A.NOTAM || {}).fir || []) : null }));
    const para = ((SPECIAL || {}).act || []).filter((x) => distNm(c, [x.la, x.lo]) <= R);
    let wx = [];
    try {
      const d = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${c[0].toFixed(3)}&longitude=${c[1].toFixed(3)}&hourly=temperature_2m,dew_point_2m,cloud_cover_low,visibility,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_180m,wind_direction_180m,cape&wind_speed_unit=kn&timezone=UTC&start_date=${t0.toISOString().slice(0, 10)}&end_date=${t1.toISOString().slice(0, 10)}`);
      for (let t = t0.getTime(); t <= t1.getTime(); t += 3600e3) { const r = wxAt({ h: d.hourly }, t); if (r) wx.push([t, r]); }
    } catch (e) { console.warn('météo vol local', e); }
    const ad = vacAt(f.dep) || {}, notes = adNote(f.dep);
    const vis = (x) => `${x.lower} – ${x.upper}`;
    return `<h4>🛩️ Vol local au départ de ${esc(f.dep)} ${esc(a.name)} — ${hhmm(dur)}, zone de ${R} NM</h4>
      ${notes ? `<div class="okk">📝 ${esc(notes)}</div>` : ''}
      <p class="meta">⛽ Carburant : vol ${fuelNeed} L (roulage compris) + réserve finale ${res} L = <b>${fuelNeed + res} L</b> ; à bord ${loaded} L, marge <b style="color:${loaded - fuelNeed - res < 0 ? '#ff6b6b' : 'inherit'}">${loaded - fuelNeed - res} L</b>, autonomie ${hhmm(Math.floor((loaded - TAXI_L) / f.ff * 60))}.
        ⚖️ Masse ${Math.round(mb.mass)} / ${f.T.mtow} kg${mb.cg != null ? `, centrage ${mb.cg.toFixed(3)} m ${mb.inEnv(mb.cg, mb.mass) ? '✅' : '❌ hors limites'}` : ''}.</p>
      ${wx.length ? `<p class="meta">🌤️ Météo heure par heure : ${wx.map(([t, r]) => `<span style="color:${WXCOL[r.lv]}">●</span> ${hLoc(t)} ${r.why.length ? esc(r.why.join(', ')) : 'VFR favorable'} (vent ${r3(r.wd)}/${Math.round(r.ws)}${r.gust > r.ws + 5 ? 'G' + Math.round(r.gust) : ''})`).join(' · ')}</p>` : ''}
      <p class="meta">📻 Fréquences du terrain : ${esc((ad.freqs || []).join(' · ') || 'A/A 123.500')} · tour de piste ${esc((ad.tdp || [])[0] || 'voir VAC')}.</p>
      <table class="legs"><tr><th>Espaces et zones à moins de ${R} NM (sous 6000 ft)</th><th>Limites</th><th>Fréquence / état</th></tr>
      ${asp.map((s) => `<tr><td style="text-align:left">${esc(s.name)} (${esc(s.cls || s.kind)})</td><td>${esc(vis(s))}</td><td>${esc(s.freq || '')}</td></tr>`).join('')}
      ${zs.map((x) => `<tr${x.z.type === 'P' || (x.act && x.act.st === 'active') ? ' style="color:#ff6b6b"' : ''}><td style="text-align:left">${esc(x.z.id)} ${esc(x.z.name)}</td><td>${esc(vis(x.z))}</td><td>${x.z.type === 'P' ? 'interdite' : x.act ? esc(x.act.st + ' : ' + x.act.why) : x.z.rtba ? 'AZBA : voir créneaux' : ''}</td></tr>`).join('')}
      ${para.map((x) => `<tr><td style="text-align:left">${esc(x.kind)} ${esc(x.name)}</td><td>jusqu'à ${esc(x.upper)}</td><td>${esc(x.hours || 'voir NOTAM')}</td></tr>`).join('')}</table>
      <p class="meta">Zone de travail : choisir un secteur hors espaces contrôlés et zones actives, au-dessus de 1000 ft sol (500 ft en campagne), en gardant le terrain à portée de plané. NOTAM et AZBA du jour : SOFIA.</p>`;
  }
  // ---------- fiche de genou A5 (49) : l'essentiel sur une page, avec cases pour les heures réelles
  async function kneeboard(b) {
    await needLibs();
    const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' }), W = 148, M = 6;
    const ap = arrivalPlan(b), F = freqTimeline(b);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(latin(`${b.ids[0]} -> ${b.ids[b.ids.length - 1]}  ${b.f.ac.reg}  ${b.depT.toISOString().slice(0, 10)}`), M, 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(latin(`Départ ${utc(b.depT)} · arrivée ${utc(b.eta)} · ${b.totDist.toFixed(0)} NM · ${hhmm(b.totMin)} · carburant à bord ${b.loaded} L (requis ${b.reqFuel} L) · réserve ${b.resFuel} L`), M, 13.5);
    doc.text('QNH : ______   ATIS : ______   Décollage réel : ______   Carbu départ : ______', M, 18);
    let fuel = b.loaded;
    const rows = b.legs.map((lg) => { fuel -= lg.fuel; return [`${lg.from} > ${lg.to}`, r3(lg.hm), String(lg.ft || b.f.ft), lg.safe ? String(lg.safe.alt) : '', lg.dist.toFixed(0), `${lg.min}'`, utc(lg.eto).replace('Z', ''), '', `${Math.round(fuel)}`]; });
    doc.autoTable({ startY: 21, margin: { left: M, right: M }, head: [['Branche', 'Cm', 'Alt', 'Sécu', 'NM', 'Tps', 'HE', 'HR', 'Carbu']], body: rows.map((r) => r.map(latin)),
      styles: { fontSize: 8, cellPadding: 1.1, lineWidth: .2, lineColor: 120 }, headStyles: { fillColor: [0, 90, 140] }, columnStyles: { 0: { cellWidth: 38 }, 7: { cellWidth: 14 } }, theme: 'grid' });
    let y = doc.lastAutoTable.finalY + 4;
    doc.setFont('helvetica', 'bold'); doc.text('Fréquences', M, y); doc.setFont('helvetica', 'normal'); y += 3.5;
    F.forEach((x) => { const t = doc.splitTextToSize(latin(`${utc(x.at)} ${x.nm.toFixed(0)} NM  ${x.where} : ${x.freq}`), W - 2 * M); doc.text(t, M, y); y += 3.2 * t.length; });
    y += 2; doc.setFont('helvetica', 'bold'); doc.text(latin(`Arrivée ${b.f.arr}`), M, y); doc.setFont('helvetica', 'normal'); y += 3.5;
    const arrTxt = doc.splitTextToSize(latin(`Descente vers ${ap.todAlong.toFixed(0)} NM (${utc(ap.tod.at)}) à ${ap.vs} ft/min · ${ap.entry ? 'entrée ' + ap.entry + ' · ' : ''}TDP ${ap.tdpTxt || ap.tdpFt + ' ft'} · ${ap.side} · piste probable ${ap.rw ? ap.rw.best.qfu : '?'} · dégagement ${b.f.alt || '-'}`), W - 2 * M);
    doc.text(arrTxt, M, y); y += 3.2 * arrTxt.length + 2;
    const lm = landmarksOf(b).filter((x) => x.list.length);
    if (lm.length && y < 185) { doc.setFont('helvetica', 'bold'); doc.text('Repères', M, y); doc.setFont('helvetica', 'normal'); y += 3.5;
      lm.forEach((x) => { const t = doc.splitTextToSize(latin(`${x.lg.from}>${x.lg.to} : ${x.list.slice(0, 5).map((c) => `${c.min}' ${c.n}`).join(', ')}`), W - 2 * M); if (y < 195) { doc.text(t, M, y); y += 3.2 * t.length; } }); }
    doc.setFontSize(6.5); doc.setTextColor(100); doc.text(latin('Aide à la préparation : vérifier sur la carte, les VAC et SOFIA.'), M, 205); doc.setTextColor(0);
    const blob = doc.output('blob'), name = `fiche_genou_${b.ids[0]}-${b.ids[b.ids.length - 1]}_${b.depT.toISOString().slice(0, 10)}.pdf`;
    if (window.AWW_saveBriefing) await window.AWW_saveBriefing(name, blob); else download(blob, name);
  }
  // ---------- verdict global (39) : rouge = au moins une alerte bloquante, orange = points à surveiller, vert sinon
  function verdict(b) {
    const al = alertsOf(b), stop = al.filter((x) => /^⛔/.test(x)), why = [], warn = [];
    const imp = b.optAlt ? b.optAlt.plan.filter((c) => c.hard.length) : [];
    if (imp.length) why.push(`${imp.length} branche(s) sans altitude possible (${imp[0].lg.from}→${imp[0].lg.to} : ${imp[0].hard[0].why})`);
    const F = fuelLines(b); if (F.margin < 0) why.push(`carburant insuffisant (${F.margin} L)`);
    perfWorst(b).filter((x) => !x.ok).forEach((x) => warn.push(`${x.t.id} : piste juste au plus défavorable (${x.need} m pour ${x.t.len} m)`));
    crossWinds(b).filter((x) => x.max && x.crossG >= x.max * .8).forEach((x) => warn.push(`vent traversier ${Math.round(x.crossG)} kt à ${x.t.id}`));
    const wx = (b.wxRoute && b.wxRoute.worst) || 0; if (wx === 2) why.push('météo défavorable sur la route'); else if (wx === 1) warn.push('météo marginale sur la route');
    if (b.mb.mass > b.f.T.mtow) why.push(`masse ${Math.round(b.mb.mass)} kg > ${b.f.T.mtow} kg`);
    const reasons = [...stop.map((x) => x.replace(/^⛔\s*/, '')), ...why, ...warn];
    const lv = stop.length || why.length ? 2 : warn.length || al.length > 12 ? 1 : 0;
    return { lv, reasons: reasons.slice(0, 3), n: reasons.length };
  }
  console.assert((() => { const pick = (st, wh, wa, n) => (st || wh ? 2 : wa || n > 12 ? 1 : 0); return pick(1, 0, 0, 1) === 2 && pick(0, 0, 1, 1) === 1 && pick(0, 0, 0, 3) === 0; })(), 'verdict niveaux');
  function verdictHtml(trip) {
    const V = trip.map(verdict), lv = Math.max(...V.map((v) => v.lv)), r = V.flatMap((v, i) => v.reasons.map((x) => (trip.length > 1 ? `étape ${i + 1} : ` : '') + x)).slice(0, 3);
    const lbl = ['On peut partir', 'À surveiller', 'Ne pas partir en l\'état'][lv], col = ['#34c759', '#ff9500', '#ff3b30'][lv];
    const b0 = trip[0], bN = trip[trip.length - 1], e = b0.ens && !b0.ens.err ? b0.ens.both : null;
    const C = 2 * Math.PI * 34, pc = e != null ? e : [100, 66, 33][lv];
    const ring = `<svg class="vring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="vr-bg"/><circle cx="40" cy="40" r="34" stroke="${col}" class="vr-fg" stroke-dasharray="${(C * pc / 100).toFixed(1)} ${C.toFixed(1)}"/>
      <text x="40" y="${e != null ? 44 : 49}" text-anchor="middle" class="vr-t">${e != null ? e + '%' : ['✓', '!', '✕'][lv]}</text>${e != null ? '<text x="40" y="57" text-anchor="middle" class="vr-s">VFR</text>' : ''}</svg>`;
    const dist = trip.reduce((x, b) => x + b.totDist, 0), nt = bN.night;
    const facts = [['Départ', utc(b0.depT)], ['Arrivée', utc(bN.eta)], ['Trajet', `${dist.toFixed(0)} NM · ${hhmm(Math.round((bN.eta - b0.depT) / 6e4))}`], ...(nt ? [['Nuit aéro', utc(nt.night)]] : [])];
    return `<div class="verdict v${lv}">${ring}<div class="vd-txt"><b style="color:${col}">${lbl}</b>
        ${r.length ? `<ul>${r.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>Aucune alerte importante.</p>'}
        <div class="vd-facts">${facts.map(([k, v]) => `<span><small>${k}</small>${esc(v)}</span>`).join('')}</div></div></div>
      <p class="meta">Synthèse automatique des alertes${e != null ? ` · anneau : probabilité VFR (${b0.ens.n} scénarios ECMWF)` : ''} : la décision reste celle du pilote (TEMSI, TAF, NOTAM du jour).</p>`;
  }
  // ---------- scénario « et si » (41) : départ décalé, passager en plus, vent plus fort ; recalcul local sans réseau
  function whatIf(b, { delay = 0, kg = 0, wind = 0 }) {
    let min = 0;
    b.legs.forEach((lg) => { const w = lg.wind ? { dir: lg.wind.dir, spd: lg.wind.spd + wind } : wind ? { dir: (lg.tc + 180) % 360, spd: wind } : null; min += legMinutes(lg.dist, lg.tc, w, b.f.tas); });
    min += b.climb ? b.climb.min : 0;
    const fuel = Math.round(min * b.f.ff / 60) + (b.climb ? b.climb.fuel : 0), req = b.reqFuel - b.totFuel + fuel, eta = new Date(b.depT.getTime() + (delay + min) * 6e4);
    const mass = b.mb.mass + kg, arm = b.f.T.arms.pax, cg = b.mb.cg != null && arm != null ? (b.mb.mom + kg * arm) / mass : null;
    const night = b.night ? b.night.night : null, tod = b.f.T.takeoff && b.f.T.takeoff.table ? perfDist(b.f.T.takeoff.table, { elev: b.depInfo.elev, temp: b.depInfo.temp, grass: b.depInfo.grass, head: 0, mass }) : null;
    const cw = crossWinds(b).find((x) => x.t.role === 'ARRIVÉE'), ws = cw ? Math.hypot(cw.head || 0, cw.cross || 0) : 0;
    return { min: Math.round(min), fuel, margin: b.loaded - req, eta, night, dark: night && eta > night, mass, over: mass > b.f.T.mtow, cg, cgOk: cg == null || b.mb.inEnv(cg, mass), tod, len: b.depInfo.len, cross: cw ? Math.round(ws ? cw.crossG * (ws + wind) / ws : cw.crossG) : null, max: cw ? cw.max : null };
  }
  function whatIfHtml(b, sfx) {
    if (b.stage > 1) return '';
    return `<details><summary><b>🔮 Et si…</b> (départ retardé, passager en plus, vent plus fort)</summary>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label>Départ retardé de <select data-wi="delay"><option>0</option><option>30</option><option>60</option><option>90</option><option>120</option></select> min</label>
      <label>Masse en plus <select data-wi="kg"><option>0</option><option>20</option><option>75</option><option>150</option></select> kg</label>
      <label>Vent plus fort de <select data-wi="wind"><option>0</option><option>5</option><option>10</option><option>15</option><option>20</option></select> kt</label></div>
      <div id="pf-wi${sfx}" class="meta"></div></details>`;
  }
  function bindWhatIf(b, sfx) {
    const box = $('#pf-wi' + sfx); if (!box) return;
    const sels = box.parentElement.querySelectorAll('[data-wi]');
    const upd = () => { const o = {}; sels.forEach((x) => { o[x.dataset.wi] = +x.value; }); const r = whatIf(b, o);
      const c = (ok) => `style="color:${ok ? 'inherit' : '#ff6b6b'};font-weight:${ok ? 'normal' : 'bold'}"`;
      box.innerHTML = `Temps ${hhmm(r.min)} · carburant d'étape ${r.fuel} L · <span ${c(r.margin >= 0)}>marge ${r.margin} L</span><br>
        <span ${c(!r.dark)}>arrivée ${utc(r.eta)}${r.night ? ` (nuit aéro ${utc(r.night)})` : ''}${r.dark ? ' : DE NUIT' : ''}</span> ·
        <span ${c(!r.over && r.cgOk)}>masse ${Math.round(r.mass)} / ${b.f.T.mtow} kg${r.cg != null ? `, centrage ${r.cg.toFixed(3)} m${r.cgOk ? '' : ' HORS LIMITES'}` : ''}</span>
        ${r.tod ? ` · <span ${c(!r.len || r.tod * 1.33 <= r.len)}>décollage ${r.tod} m (${Math.round(r.tod * 1.33)} m avec marge, piste ${r.len || '?'} m)</span>` : ''}
        ${r.cross != null ? ` · <span ${c(!r.max || r.cross <= r.max)}>travers à l'arrivée ${r.cross} kt${r.max ? ` / ${r.max} kt` : ''}</span>` : ''}`; };
    sels.forEach((x) => x.addEventListener('change', upd)); upd();
  }
  // ---------- points de demi-tour météo (42) : base minimale = alti sécu de la branche + 500 ft ; décision 5 NM avant, repli = dernier terrain passé
  function turnBacks(b) {
    const out = []; let acc = 0;
    const dv = diversions(b);
    b.legs.forEach((lg, i) => {
      const need = (lg.safe ? lg.safe.alt : 1500) + 500, pts = ((b.wxRoute && b.wxRoute.pts) || []).filter((p) => p.leg === i);
      const bad = pts.find((p) => p.low >= 50 && p.baseAmsl != null && p.baseAmsl < need);
      if (bad) {
        const at = Math.max(acc, bad.along - 5), back = dv.slice(0, i + 1).flatMap((x, k) => x.list.map((t) => ({ ...t, abs: dv.slice(0, k).reduce((s, y) => s + y.lg.dist, 0) + t.along }))).filter((t) => t.abs <= at).pop();
        out.push({ lg, need, at, bad, back: back ? back.a : A.aptByIcao[b.f.dep] });
      }
      acc += lg.dist;
    });
    return out;
  }

  // ================================================================== sécurité : minima VFR, frontière, zones particulières, givrage
  // points de la route tous les ~step NM, avec la branche et la distance depuis le départ
  function routeSamples(b, step = 3) {
    const out = []; let acc = 0;
    b.legs.forEach((lg, i) => { const n = Math.max(1, Math.ceil(lg.dist / step)); for (let k = (i ? 1 : 0); k <= n; k++) out.push({ p: destPt(lg.a, lg.tc, lg.dist * k / n), lg, along: acc + lg.dist * k / n }); acc += lg.dist; });
    return out;
  }
  const ftOf = (s) => { const v = parseAlt(s); return v == null ? null : v; };

  // ---------- minima VFR (SERA) selon la classe d'espace à l'altitude de croisière
  function vfrMinima(b) {
    if (!b.wxRoute || !b.wxRoute.pts) return [];
    const asp = (ASP && ASP.data) || [], out = [], seen = new Set();
    for (const p of b.wxRoute.pts) {
      const inside = asp.filter((s) => s.kind !== 'SIV' && inPoly(p.p, s.poly) && (ftOf(s.lower) ?? 0) <= b.f.ft && (ftOf(s.upper) ?? 99999) + (/ASFC|AGL/i.test(s.upper || '') ? p.elevFt : 0) >= b.f.ft);
      const ctl = inside.find((s) => /^[ABCDE]$/.test(s.cls || '') || s.kind === 'CTR');
      const low = b.f.ft <= Math.max(3000, (p.elevFt || 0) + 1000);
      const req = ctl ? { vis: b.f.ft >= 10000 ? 8000 : 5000, sep: 1000, lbl: `classe ${ctl.cls || 'D'} (${ctl.name})` }
        : low ? { vis: 1500, sep: 0, lbl: 'classe G sous 3000 ft / 1000 ft sol' } : { vis: 5000, sep: 1000, lbl: 'classe G au-dessus de 3000 ft' };
      const cloudy = p.low != null && p.low >= 50 && p.baseAmsl != null;
      const why = [];
      if (p.vis != null && p.vis < req.vis) why.push(`visibilité ${Math.floor(p.vis / 100) / 10} km`);
      if (cloudy && p.baseAmsl < b.f.ft + req.sep) why.push(`base ~${p.baseAmsl} ft`);
      if (!why.length) continue;
      const key = `${p.leg}|${req.lbl}`; if (seen.has(key)) continue; seen.add(key);
      const lg = b.legs[p.leg];
      out.push(`Minima VFR ${lg.from}→${lg.to} vers ${utc(p.at)} : en ${req.lbl} il faut ${req.vis / 1000} km${req.sep ? ` et ${req.sep} ft sous les nuages (1500 m horizontalement)` : ' et rester hors des nuages en vue du sol'} ; prévu ${why.join(', ')} pour une croisière à ${b.f.ft} ft.`);
    }
    // CTR au départ / à l'arrivée : plafond 1500 ft et 5 km au sol (METAR, vol dans les 2 h)
    for (const t of [b.depInfo, b.arrInfo]) {
      if (!t.m || Math.abs(t.when - Date.now()) > 2 * 3600e3 || !asp.some((s) => s.kind === 'CTR' && t.a && inPoly([t.a.la, t.a.lo], s.poly))) continue;
      const ceil = Math.min(...(t.m.clouds || []).filter((c) => /BKN|OVC|VV/.test(c.cover) && c.base != null).map((c) => c.base), 99999);
      const vis = t.m.visib != null ? (String(t.m.visib).includes('+') ? 10000 : parseFloat(t.m.visib) * 1609) : 10000;
      if (ceil < 1500 || vis < 5000) out.push(`CTR de ${t.id} : plafond ${ceil < 99999 ? ceil + ' ft' : '?'} / visibilité ${Math.round(vis / 100) / 10} km sous les minima VFR (1500 ft et 5 km) — VFR spécial sur autorisation seulement.`);
    }
    return out;
  }

  // ---------- passage de frontière
  const inFrance = (p) => (window.FRANCE || []).some((ring) => inPolyXY(p[1], p[0], ring.map(([la, lo]) => [lo, la])));
  if (window.FRANCE) console.assert(inFrance([43.38, -0.42]) && !inFrance([43.36, -1.79]) && !inFrance([42.55, 1.6]), 'inFrance (Pau, Saint-Sébastien, Andorre)');
  if (window.FRANCE) console.assert(!borderInfo({ f: { dep: 'LFBZ', arr: 'LFBZ' }, legs: [{ a: [43.47, -1.53], tc: 225, dist: 8 }] }), 'pas de frontière au large de Saint-Jean-de-Luz');
  function borderInfo(b) {
    if (!window.FRANCE) return null;
    const ids = [b.f.dep, b.f.arr, b.f.alt].filter(Boolean), foreignAd = ids.filter((id) => !id.startsWith('LF'));
    const out = routeSamples(b, 3).filter((x) => x.p[0] < 43.5 && !inFrance(x.p) && !(x.p[0] > 43.35 && x.p[1] > -1.79));   // seules frontières : Espagne et Andorre ; la mer devant la côte basque (à l'est de la Bidassoa) reste française
    if (!out.length && !foreignAd.length) return null;
    const andorra = out.some((x) => x.p[0] > 42.42 && x.p[0] < 42.66 && x.p[1] > 1.4 && x.p[1] < 1.79);
    const customs = ids.filter((id) => id.startsWith('LF')).map((id) => { const t = (vacAt(id) || {}).infos || '', m = t.split(/MET :8 -/)[1]; return m ? [id, m.split(/Douanes, Police/)[0].replace(/\s+/g, ' ').trim().slice(0, 220)] : null; }).filter(Boolean);
    return { out, andorra, foreignAd, customs, first: out[0] };
  }
  function borderAlerts(b) {
    const x = borderInfo(b); if (!x) return [];
    const al = [`Vol transfrontalier (${x.andorra ? 'Andorre / Espagne' : 'Espagne'}${x.first ? `, à partir de ${x.first.along.toFixed(0)} NM` : ''}) : plan de vol obligatoire (SOFIA, au moins 1 h avant), transpondeur, cartes et fréquences ENAIRE / Andorre.`];
    if (x.foreignAd.length) al.push(`Terrain hors de France (${x.foreignAd.join(', ')}) : espace Schengen pour l'Espagne (pas de contrôle aux frontières), mais PPR / horaires et plan de vol à vérifier sur l'AIP espagnole.`);
    if (x.andorra) al.push('Andorre hors espace Schengen et hors union douanière : pas d\'atterrissage possible en Andorre, survol avec plan de vol.');
    if (x.foreignAd.some((id) => !/^LE/.test(id))) x.customs.forEach(([id, t]) => t && /douane|PPR|police/i.test(t) && al.push(`${id} douane / police (VAC) : ${t}`));
    return al;
  }

  // ---------- givrage carburateur (diagramme CAA « carburettor icing », approché) : 0 nul, 1 faible, 2 modéré, 3 fort ; moteur réduit (descente) : un cran de plus
  const CARB = ['nul', 'faible', 'modéré', 'fort'], CARBCOL = ['#2ecc40', '#2ecc40', '#ff9f0a', '#ff3b30'];
  function carbIce(T, Td, descent) {
    if (T == null || Td == null || T < -10 || T > 35) return 0;
    const sp = Math.max(0, T - Td), c = sp <= 3 && T >= -5 && T <= 20 ? 3 : sp <= 7 && T <= 25 ? 2 : sp <= 13 && T <= 30 ? 1 : 0;
    return descent ? (c ? Math.min(3, c + 1) : sp <= 18 && T <= 30 ? 1 : 0) : c;
  }
  console.assert(carbIce(10, 8) === 3 && carbIce(15, 10) === 2 && carbIce(25, 13) === 1 && carbIce(30, 5) === 0 && carbIce(15, 10, true) === 3 && carbIce(-15, -16) === 0, 'carbIce');
  function carbOf(b) {   // T / Td au sol (prévision le long de la route) ramenés à l'altitude : -2 °C et -0,6 °C par 1000 ft
    const ok = ((b.wxRoute && b.wxRoute.pts) || []).filter((p) => p.T != null && p.Td != null); if (!ok.length) return null;
    const at = (p, ft) => { const h = Math.max(0, ft - p.elevFt) / 1000; return { T: Math.round(p.T - 2 * h), Td: Math.round(p.Td - 0.6 * h) }; };
    const pick = (arr) => arr.reduce((m, x) => (x.lv > m.lv ? x : m), arr[0]);
    const cruise = pick(ok.map((p) => { const ft = (b.legs[p.leg] || b.legs[0]).ft || b.f.ft, v = at(p, ft); return { ...v, ft, lv: carbIce(v.T, v.Td) }; }));
    const last = ok[ok.length - 1], top = b.legs[b.legs.length - 1].ft || b.f.ft;
    const descent = pick([last.elevFt + 1000, (top + last.elevFt) / 2, top].map((ft) => { const v = at(last, ft); return { ...v, ft: Math.round(ft / 100) * 100, lv: carbIce(v.T, v.Td, true) }; }));
    return { cruise, descent };
  }

  // ---------- branches au-dessus de l'eau : distance à la côte comparée au plané (NCO.IDE.A.175 : gilets au-delà de la distance de plané)
  function waterOf(b) {
    if (!window.FRANCE) return null;
    const fin = b.f.T.glide || 9, land = window.FRANCE.flat();
    const sea = routeSamples(b, 1).filter((x) => x.p[0] >= 43.4 && !inFrance(x.p))   // au sud de 43,4° : Espagne (terre), pas la mer
      .map((x) => { const ft = x.lg.ft || b.f.ft; return { ...x, ft, d: Math.min(...land.map((q) => distNm(x.p, q))), glide: ft * fin / 6076 }; });
    if (!sea.length) return null;
    const worst = sea.reduce((m, x) => (x.d - x.glide > m.d - m.glide ? x : m));
    return { sea, worst, beyond: sea.filter((x) => x.d > x.glide) };
  }
  if (window.FRANCE) console.assert((() => { const w = waterOf({ f: { T: {}, ft: 2000 }, legs: [{ a: [46.0, -2.6], tc: 270, dist: 4, ft: 2000 }] }); return w && w.beyond.length > 0 && w.worst.d > 10; })() && !waterOf({ f: { T: {}, ft: 2000 }, legs: [{ a: [43.38, -0.42], tc: 90, dist: 10, ft: 2000 }] }), 'waterOf');

  // ---------- survol des agglomérations : SERA 1000 ft au-dessus de l'obstacle le plus haut ; en France, monomoteur : hauteur plus grande selon la taille
  // (arrêté du 10/10/1957) ; taille estimée ici d'après la population — shortcut: pas de contour des agglomérations, à remplacer par les zones bâties OSM si besoin
  function townsLow(b) {
    const towns = (LANDM && LANDM.towns) || [], prof = b.profile || [], smp = routeSamples(b, 0.5), out = [];
    for (const [n, la, lo, pop] of towns) {
      if (pop < 2000) continue;
      const r = pop >= 50000 ? 2 : pop >= 10000 ? 1 : 0.5, hit = smp.find((x) => Math.abs(x.p[0] - la) < .05 && distNm(x.p, [la, lo]) <= r);
      if (!hit || hit.along < 10 || hit.along > b.totDist - 10) continue;   // départ / arrivée : trajectoires et hauteurs fixées par la VAC et le contrôle
      const g = prof.length ? prof.reduce((m, q) => (distNm(q.p, [la, lo]) < distNm(m.p, [la, lo]) ? q : m)).ft : 0, need = pop >= 50000 ? 5000 : pop >= 10000 ? 3300 : 1650, h = (hit.lg.ft || b.f.ft) - g;
      if (h < need) out.push({ n, pop, along: hit.along, h, need });
    }
    return out.sort((x, y) => x.along - y.along);
  }
  // ---------- position du soleil (hauteur et azimut vrai, degrés) — formules simplifiées (précision ~1°)
  function sunPos(t, la, lo) {
    const d = (+t - 946728000000) / 864e5, g = rad((357.529 + 0.98560028 * d) % 360), q = (280.459 + 0.98564736 * d) % 360;
    const L0 = rad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)), e = rad(23.439 - 0.00000036 * d);
    const ra = Math.atan2(Math.cos(e) * Math.sin(L0), Math.cos(L0)), dec = Math.asin(Math.sin(e) * Math.sin(L0));
    const H = rad(((18.697374558 + 24.06570982441908 * d) % 24) * 15 + lo) - ra, ph = rad(la);
    const el = Math.asin(Math.sin(ph) * Math.sin(dec) + Math.cos(ph) * Math.cos(dec) * Math.cos(H));
    return { el: deg(el), az: (deg(Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(ph) - Math.sin(ph) * Math.cos(H))) + 360) % 360 };
  }
  console.assert((() => { const a = sunPos(Date.UTC(2026, 5, 21, 12, 3), 43.38, -0.42), b = sunPos(Date.UTC(2026, 11, 21, 15, 30), 43.38, -0.42);
    return a.el > 68 && a.el < 71 && a.az > 165 && a.az < 195 && b.el > 2 && b.el < 12 && b.az > 218 && b.az < 240; })(), 'sunPos');
  const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  // soleil bas (0-15°) à moins de 25° de l'axe : en croisière (milieu de chaque branche) et en finale (piste probable à l'arrivée)
  function glareOf(b) {
    const out = [];
    b.legs.forEach((lg) => { const t = lg.eto.getTime() - lg.min * 3e4, p = destPt(lg.a, lg.tc, lg.dist / 2), sp = sunPos(t, p[0], p[1]);
      if (sp.el > 0 && sp.el <= 15 && angDiff(sp.az, lg.tc) <= 25) out.push({ what: `branche ${lg.from}→${lg.to}`, t: new Date(t), sp, off: angDiff(sp.az, lg.tc) }); });
    const rw = b.arrInfo && b.arrInfo.rw, a = A.aptByIcao[b.f.arr];
    if (rw && a) { const qfu = rw.best.qfu, sp = sunPos(b.eta, +a.la, +a.lo); if (sp.el > 0 && sp.el <= 15 && angDiff(sp.az, qfu) <= 25) out.push({ what: `finale piste ${rwyNum(qfu)} à ${b.f.arr}`, t: b.eta, sp, off: angDiff(sp.az, qfu) }); }
    return out;
  }
  // ---------- QNH des METAR dans l'ordre du passage (départ, route, arrivée)
  function qnhList(b) {
    const ad = (id) => (b.wx.find((x) => x.id === id) || {}).metar;
    const l = [[b.f.dep, ad(b.f.dep)], ...b.wxNear.map((x) => [x.m.icaoId, x.m]), [b.f.arr, ad(b.f.arr)]].filter(([, m]) => m && m.altim).map(([id, m]) => ({ id, q: Math.round(m.altim) }));
    return l.filter((x, i) => !i || x.id !== l[i - 1].id);
  }
  // ---------- côte : directions (8) où l'on trouve la mer à 5 NM ; null si terrain à l'intérieur des terres
  function seaDir(p) {
    if (!window.FRANCE) return null;
    const w = [0, 45, 90, 135, 180, 225, 270, 315].filter((az) => { const q = destPt(p, az, 5); return q[0] >= 43.4 && !inFrance(q); });
    if (!w.length) return null;
    return (deg(Math.atan2(w.reduce((s, a) => s + Math.sin(rad(a)), 0), w.reduce((s, a) => s + Math.cos(rad(a)), 0))) + 360) % 360;
  }
  if (window.FRANCE) console.assert(seaDir([43.38, -0.42]) === null && seaDir([44.596, -1.111]) != null && angDiff(seaDir([47.76, -3.44]), 200) < 45, 'seaDir (Pau, Arcachon)');
  // ---------- brise de mer à l'arrivée : terrain côtier, printemps / été, après-midi, chaud, vent général faible
  function seaBreeze(b) {
    const t = b.arrInfo, a = A.aptByIcao[b.f.arr]; if (!t || !a) return null;
    const loc = new Date(b.eta), mo = loc.getMonth() + 1, h = loc.getHours();
    if (mo < 4 || mo > 9 || h < 11 || h > 19 || !(t.temp >= 18) || (t.wspd != null && t.wspd > 12)) return null;
    const sd = seaDir([+a.la, +a.lo]); if (sd == null) return null;
    const rw = runwayFor(t.v, sd, 12);
    return { from: Math.round(sd / 10) * 10, rwy: rw ? rwyNum(rw.best.qfu) : null };
  }
  // ---------- thermiques : été, après-midi, chaud et sec en surface -> turbulence sous la base des cumulus (~400 ft par °C d'écart T / Td)
  function thermals(b) {
    const P = ((b.wxRoute && b.wxRoute.pts) || []).filter((p) => { const d = new Date(p.at), mo = d.getMonth() + 1, h = d.getHours(); return mo >= 5 && mo <= 9 && h >= 11 && h <= 18 && p.T >= 22 && p.Td != null && p.T - p.Td >= 8; });
    if (!P.length) return null;
    const x = P.reduce((m, p) => (p.T > m.T ? p : m));
    return { T: Math.round(x.T), base: Math.round((x.T - x.Td) * 4) * 100, along: x.along };
  }
  // ---------- vitesse d'approche : Vapp de la fiche avion × √(masse / masse max) + la moitié de l'écart de rafale ; sans Vapp : 1,3 VSO (à vérifier)
  function vappOf(b) {
    const sp = b.f.T.speeds || {}, k = Object.keys(sp).find((x) => /^Vapp/.test(x)), base = k ? +sp[k] : sp.VSO ? Math.round(1.3 * sp.VSO) : null;
    if (!base) return null;
    const t = b.arrInfo || {}, mass = Math.max(0.5, Math.min(1, (b.landMass || b.f.T.mtow) / b.f.T.mtow)), gust = t.gust != null && t.wspd != null ? Math.max(0, Math.round((t.gust - t.wspd) / 2)) : 0;
    return { v: Math.round(base * Math.sqrt(mass)) + gust, base, src: k || '1,3 × VSO (à vérifier, pas de Vapp dans la fiche avion)', mass: Math.round(b.landMass || 0), gust };
  }
  console.assert((() => { const v = vappOf({ f: { T: { mtow: 900, speeds: { VSO: 45, 'Vapp (1,45) volets 1': 75 } } }, landMass: 729, arrInfo: { wspd: 10, gust: 20 } }); return v.v === 68 + 5 && v.gust === 5; })(), 'vappOf');
  // ---------- webcams à moins de 5 NM de la route, dans l'ordre du passage (hors départ / arrivée, déjà proposées)
  function routeCams(b) {
    return (A.SOURCES || []).filter((s) => s.t === 'cam').map((s) => ({ s, r: routeDist([s.la, s.lo], b.pts) })).filter((x) => x.r.d <= 5 && x.r.along > 3 && x.r.along < b.totDist - 3)
      .sort((x, y) => x.r.along - y.r.along).slice(0, 30).map((x) => ({ ...x, at: routePosAt(b, x.r.along).at }));
  }
  // ---------- panne radio : espaces contrôlés traversés + consignes « panne radio » des VAC (départ, arrivée, dégagement)
  function radioFail(b) {
    const ctl = [...new Set(b.legs.flatMap((lg) => lg.airspaces.filter((s) => s.kind === 'CTR' || /^[CD]$/.test(s.cls || '')).map((s) => s.name)))];
    const vac = [b.f.dep, b.f.arr, b.f.alt].filter(Boolean).map((id) => { const v = vacAt(id) || {}, t = `${v.consignes || ''} ${v.infos || ''}`.replace(/\s+/g, ' '), m = t.match(/[^.]{0,160}(?:panne (?:de )?radio|radio[- ]?(?:communication )?failure|COM failure)[^.]{0,260}\.?/i); return m ? [id, m[0].trim()] : null; }).filter(Boolean);
    return { ctl, vac };
  }
  // ---------- poussières / brume sèche : épaisseur optique des aérosols (AOD 550 nm) et poussières au sol, Open-Meteo qualité de l'air (prévision 5 jours)
  async function airQuality(P) {
    const days = [...new Set(P.map((x) => x.at.toISOString().slice(0, 10)))].sort();
    let d = await omFetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${P.map((x) => x.p[0].toFixed(2)).join(',')}&longitude=${P.map((x) => x.p[1].toFixed(2)).join(',')}`
      + `&hourly=dust,aerosol_optical_depth&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`);
    if (!Array.isArray(d)) d = [d];
    const v = P.map((x, i) => { const h = d[i].hourly, k = h.time.indexOf(roundHour(x.at)); return k < 0 ? null : { along: x.along, aod: h.aerosol_optical_depth[k], dust: h.dust[k] }; }).filter((x) => x && x.aod != null);
    return v.length ? v.reduce((m, x) => (x.aod > m.aod ? x : m)) : null;
  }
  const hazeLevel = (q) => (!q ? 0 : q.aod >= 0.5 || q.dust >= 100 ? 2 : q.aod >= 0.3 || q.dust >= 50 ? 1 : 0);
  console.assert(hazeLevel({ aod: 0.6, dust: 20 }) === 2 && hazeLevel({ aod: 0.35, dust: 10 }) === 1 && hazeLevel({ aod: 0.1, dust: 5 }) === 0, 'hazeLevel');

  // ---------- feux détectés par satellite (24 h) à moins de 5 NM de la route
  function firesNear(b) {
    return ((FIRES && FIRES.data) || []).map(([la, lo, frp, t]) => ({ p: [la, lo], frp, t, r: routeDist([la, lo], b.pts) })).filter((x) => x.r.d <= 5 && x.r.along >= -2 && x.r.along <= b.totDist + 2).sort((x, y) => x.r.along - y.r.along);
  }

  // ---------- tronçons sans terrain à portée de plané : hauteur au-dessus du terrain - 500 ft, finesse de l'avion (relief entre les deux non compté)
  function glideGaps(b) {
    const fin = b.f.T.glide || 9, apts = (A.APTS || []).filter((a) => a.la != null), out = [];
    let cur = null;
    for (const x of routeSamples(b, 1)) {
      const ft = x.lg.ft || b.f.ft;
      let best = null;
      for (const a of apts) {
        const d = distNm(x.p, [+a.la, +a.lo]); if (d > 40) continue;
        const el = +a.elev || 0, ok = d <= Math.max(0, ft - el - 500) * fin / 6076, n = el + 500 + d * 6076 / fin;
        if (!best || (ok && !best.ok) || (ok === best.ok && n < best.n)) best = { a, d, ok, n };
      }
      if (best && best.ok) { cur = null; continue; }
      const need = best ? best.n : 99999;
      if (!cur) out.push(cur = { from: x.along, to: x.along, need, near: best && best.a.icao }); else { cur.to = x.along; if (need > cur.need) { cur.need = need; cur.near = best && best.a.icao; } }
    }
    return out.map((g) => ({ ...g, need: Math.ceil(g.need / 100) * 100 }));
  }

  // ---------- NOTAM en français simple : abréviations OACI courantes, puis tri par importance
  const NOTAM_FR = [['NOT AVBL', 'indisponible'], ['U/S', 'hors service'], ['CLSD', 'fermé'], ['CLOSED', 'fermé'], ['AVBL', 'disponible'], ['ACT', 'active'], ['ACTIVE', 'active'], ['DUE', 'en raison de'],
    ['WIP', 'travaux en cours'], ['RWY', 'piste'], ['TWY', 'voie de circulation'], ['APN', 'aire de stationnement'], ['AD', 'aérodrome'], ['OBST', 'obstacle'], ['CRANE', 'grue'], ['MAST', 'mât'],
    ['WIND TURBINES?', 'éolienne(s)'], ['LGTD', 'balisé'], ['LGT', 'balisage'], ['ACFT', 'aéronef'], ['PJE', 'parachutage'], ['UAS', 'drone'], ['UAV', 'drone'], ['AEROBATICS?', 'voltige'],
    ['GLIDING', 'vol à voile'], ['BALLOONS?', 'ballon(s)'], ['FIREWORKS', 'feux d\'artifice'], ['MIL', 'militaire'], ['EXER', 'exercice'], ['BTN', 'entre'], ['EXC', 'sauf'], ['DLY', 'tous les jours'],
    ['ABV', 'au-dessus de'], ['BLW', 'au-dessous de'], ['HGT', 'hauteur'], ['ELEV', 'altitude'], ['SFC', 'sol'], ['GND', 'sol'], ['AMSL', 'au-dessus de la mer'], ['AGL', 'au-dessus du sol'],
    ['ASFC', 'au-dessus du sol'], ['RADIUS', 'rayon'], ['CENTRED ON', 'centré sur'], ['PSN', 'position'], ['FREQ', 'fréquence'], ['SVC', 'service'], ['OPS', 'opérations'], ['OPR', 'en service'],
    ['TEMPO', 'temporaire'], ['REF', 'voir'], ['TFC', 'trafic'], ['INFO', 'information'], ['AREA', 'zone'], ['FLW', 'suivant'], ['THR', 'seuil'], ['DTHR', 'seuil décalé'], ['RESTRICTED', 'réglementé'],
    ['PROHIBITED', 'interdit'], ['DANGER', 'dangereux'], ['AIRSPACE', 'espace aérien'], ['MON', 'lun'], ['TUE', 'mar'], ['WED', 'mer'], ['THU', 'jeu'], ['FRI', 'ven'], ['SAT', 'sam'], ['SUN', 'dim'],
    ['SR', 'lever du soleil'], ['SS', 'coucher du soleil'], ['FUEL', 'carburant'], ['AVGAS', 'AVGAS'], ['PPR', 'autorisation préalable']];
  const NOTAM_RE = NOTAM_FR.map(([k, v]) => [new RegExp(`(^|[^A-Z/])${k.replace('/', '\\/')}(?![A-Z/])`, 'g'), v]);
  const notamPlain = (t) => NOTAM_RE.reduce((s, [re, v]) => s.replace(re, `$1${v}`), String(t || '').replace(/\s+/g, ' ').trim());
  console.assert(notamPlain('RWY 13/31 CLSD DUE WIP') === 'piste 13/31 fermé en raison de travaux en cours' && notamPlain('TWY B LGT U/S') === 'voie de circulation B balisage hors service' && notamPlain('PJE ACT') === 'parachutage active', 'notamPlain');
  const notamKind = (n) => (isClosure(n) ? 0 : (n.q || '')[0] === 'R' || /\b(ACT|ACTIVE|PJE|AEROBATIC|UAS|UAV|RTBA)\b/.test(n.e || '') ? 1 : (n.q || '')[0] === 'O' || /\b(OBST|CRANE|WIND TURBINE)/.test(n.e || '') ? 2 : 3);
  const NOTAM_KIND = ['⛔ Fermeture', '🟣 Zone active', '🗼 Obstacle', 'ℹ️ Information'];
  function notamsHtml(b) {
    const L0 = [...b.adNotams.flatMap((x) => x.list.map((n) => ({ n, where: x.id }))), ...b.enroute.concat(b.obst).map((x) => ({ n: x.n, where: `en route, ${x.along.toFixed(0)} NM` })), ...b.general.map((n) => ({ n, where: 'FIR' }))]
      .filter((x) => x.n && x.n.ref).map((x) => ({ ...x, k: notamKind(x.n) })).sort((x, y) => x.k - y.k);
    if (!L0.length) return '';
    return `<details><summary><b>📋 NOTAM de la nav en français simple</b> (${L0.length}, triés : fermetures, zones actives, obstacles, informations)</summary>
      ${L0.map((x) => `<p class="meta" style="margin:3px 0" title="${esc(x.n.e || '')}">${NOTAM_KIND[x.k]} · <b>${esc(x.n.ref)}</b> (${esc(x.where)}, ${fmtNotamT(x.n)}) : ${esc(notamPlain(x.n.efr || x.n.e).slice(0, 300))}</p>`).join('')}
      <p class="meta">Abréviations traduites automatiquement (texte d'origine au survol) : le NOTAM officiel fait foi (SOFIA).</p></details>`;
  }
  const fmtNotamT = (n) => `${n.from ? new Date(n.from).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '?'} → ${n.to && !isNaN(Date.parse(n.to)) ? new Date(n.to).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'PERM / EST'}`;

  // ---------- OpenStreetMap (Overpass) : serveurs publics souvent chargés, on essaie les suivants
  async function osmQuery(q) {
    for (const ep of ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try { const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch (e) { /* serveur suivant */ }
    }
    throw new Error('serveurs OpenStreetMap indisponibles, réessayer plus tard');
  }
  const corridorPoly = (b, nm) => { const smp = routeSamples(b, 5), side = (k) => smp.map((x) => destPt(x.p, x.lg.tc + k, nm)); return [...side(-90), ...side(90).reverse()].map((p) => `${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join(' '); };
  // parcelles (rectangle englobant) : longueur / largeur en m
  const bbSize = (bb) => { const c = [(bb.minlat + bb.maxlat) / 2, (bb.minlon + bb.maxlon) / 2], h = (bb.maxlat - bb.minlat) * 111e3, w = (bb.maxlon - bb.minlon) * 111e3 * Math.cos(rad(c[0])); return { c, L: Math.max(h, w), W: Math.min(h, w) }; };
  // pistes OSM autour d'un terrain : [{ ref, a, b }] (extrémités)
  async function osmRunways(ap) {
    const j = await osmQuery(`[out:json][timeout:25];way["aeroway"="runway"](around:2500,${(+ap.la).toFixed(5)},${(+ap.lo).toFixed(5)});out geom;`);
    return (j.elements || []).filter((e) => e.geometry && e.geometry.length > 1).map((e) => ({ ref: (e.tags && e.tags.ref) || '', a: [e.geometry[0].lat, e.geometry[0].lon], b: [e.geometry[e.geometry.length - 1].lat, e.geometry[e.geometry.length - 1].lon] }));
  }
  // piste dans le sens hdg (vrai) : seuil t et extrémité e ; sinon la première, dans son sens
  const runwayDir = (rws, hdg) => { for (const r of rws) for (const [t, e] of [[r.a, r.b], [r.b, r.a]]) if (hdg == null || angDiff(bearing(t, e), hdg) <= 25) return { r, t, e, hdg: bearing(t, e) }; return rws.length ? { r: rws[0], t: rws[0].a, e: rws[0].b, hdg: bearing(rws[0].a, rws[0].b) } : null; };
  console.assert((() => { const d = runwayDir([{ a: [43, 0], b: [43, 0.02] }], 270); return d && d.t[1] === 0.02 && angDiff(d.hdg, 270) < 1; })(), 'runwayDir');

  // ---------- panne moteur au décollage : champs dans l'axe de la piste de départ (± 30°, jusqu'à 2 NM)
  async function efatoPlan(b) {
    const ap = A.aptByIcao[b.f.dep], v = b.depInfo.v || {}, rw = b.depInfo.rw, hdg0 = rw ? (rw.best.qfu + (v.var || 0) + 360) % 360 : null;
    const rws = await osmRunways(ap).catch(() => []), dir = runwayDir(rws, hdg0);
    const hdg = dir ? dir.hdg : hdg0; if (hdg == null) throw new Error('piste de départ inconnue');
    const end = dir ? dir.e : destPt([+ap.la, +ap.lo], hdg, (b.depInfo.len || 800) / 2 / 1852);
    const poly = [end, destPt(end, hdg - 30, 2), destPt(end, hdg, 2.2), destPt(end, hdg + 30, 2)].map((p) => `${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join(' ');
    const j = await osmQuery(`[out:json][timeout:25];way["landuse"~"^(meadow|farmland|grass)$"](poly:"${poly}");out bb qt;`).catch(() => null);   // OSM indisponible : la photo suffit
    const fields = ((j && j.elements) || []).filter((e) => e.bounds).map((e) => ({ ...bbSize(e.bounds), kind: e.tags && e.tags.landuse })).filter((x) => x.L >= 350 && x.W >= 80 && x.L <= 2500)
      .map((x) => ({ ...x, d: distNm(end, x.c), off: Math.round(((bearing(end, x.c) - hdg + 540) % 360) - 180) })).filter((x) => Math.abs(x.off) <= 35)
      .sort((x, y) => Math.abs(x.off) - Math.abs(y.off) || x.d - y.d).slice(0, 5);
    let img = null;
    try {   // photo de l'axe : cône ± 30° sur 2 NM, piste, champs OSM éventuels
      const W = 960, H = 640, { cv, ctx, P, txt } = await satImage(destPt(end, hdg, 0.9), 14, W, H);
      ctx.fillStyle = 'rgba(0,200,83,.16)'; ctx.strokeStyle = '#00e676'; ctx.lineWidth = 2.5; ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.moveTo(...P(end));
      for (let a = -30; a <= 30; a += 5) ctx.lineTo(...P(destPt(end, hdg + a, 2))); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      if (dir) { ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(...P(dir.t)); ctx.lineTo(...P(dir.e)); ctx.stroke(); }
      [0.5, 1, 1.5, 2].forEach((d) => txt(`${d} NM`, P(destPt(end, hdg, d)), '#b9f6ca', 13));
      fields.forEach((f, k) => { const q = P(f.c); ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q[0], q[1], 14, 0, 7); ctx.stroke(); txt(String(k + 1), [q[0] - 4, q[1] + 5], '#00e5ff'); });
      txt(`${b.f.dep} — décollage piste ${dir && dir.r.ref ? dir.r.ref : ''} : secteur ± 30° sur 2 NM`, [10, 24], '#fff', 16);
      txt('Repère les champs dégagés dans le secteur vert (photo satellite, date inconnue)', [10, H - 12], '#ffd60a', 13);
      img = cv.toDataURL('image/jpeg', .85);
    } catch (e) { console.warn('photo axe', e); }
    return { hdg, end, fields, img, osm: !!j, rwy: dir ? dir.r.ref : rw ? rwyNum(rw.best.qfu) : '' };
  }

  // ---------- éoliennes et lignes haute tension (OSM) à moins de 1,5 NM de la route
  const segX = (p1, p2, q1, q2) => { const d = (p2[1] - p1[1]) * (q2[0] - q1[0]) - (p2[0] - p1[0]) * (q2[1] - q1[1]); if (!d) return null;
    const t = ((q1[1] - p1[1]) * (q2[0] - q1[0]) - (q1[0] - p1[0]) * (q2[1] - q1[1])) / d, u = ((q1[1] - p1[1]) * (p2[0] - p1[0]) - (q1[0] - p1[0]) * (p2[1] - p1[1])) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null; };
  console.assert((() => { const x = segX([0, 0], [0, 2], [-1, 1], [1, 1]); return x && x[0] === 0 && x[1] === 1 && !segX([0, 0], [0, 2], [1, 1], [2, 1]); })(), 'segX');
  async function osmObstacles(b) {
    const poly = corridorPoly(b, 1.5);
    const j = await osmQuery(`[out:json][timeout:30];(node["generator:source"="wind"](poly:"${poly}");way["power"="line"](poly:"${poly}"););out geom qt;`);
    const prof = (b.vprofile && b.vprofile.profile) || [], ground = (al) => (prof.length ? prof.reduce((m, q) => (Math.abs(q.along - al) < Math.abs(m.along - al) ? q : m)).ft : 0);
    const turbines = [], lines = [];
    for (const e of j.elements || []) {
      if (e.type === 'node') {
        const t = e.tags || {}, hm = parseFloat(t.height) || (parseFloat(t['height:hub']) + parseFloat(t['rotor:diameter']) / 2) || null, r = routeDist([e.lat, e.lon], b.pts);
        turbines.push({ p: [e.lat, e.lon], ft: hm ? Math.round(hm * 3.281) : null, along: r.along, d: r.d });
      } else if (e.geometry) {
        const g = e.geometry.map((x) => [x.lat, x.lon]);
        b.legs.forEach((lg, i) => { const acc = b.legs.slice(0, i).reduce((s, l) => s + l.dist, 0);
          for (let k = 0; k < g.length - 1; k++) { const x = segX(lg.a, lg.b, g[k], g[k + 1]); if (x) lines.push({ p: x, along: acc + distNm(lg.a, x), kv: e.tags && e.tags.voltage ? Math.round(+String(e.tags.voltage).split(';')[0] / 1000) : null }); } });
      }
    }
    const tb = turbines.sort((x, y) => x.along - y.along).map((x) => ({ ...x, top: x.ft ? ground(x.along) + x.ft : null }));
    return { turbines: tb, lines: lines.sort((x, y) => x.along - y.along).map((x) => ({ ...x, gnd: ground(x.along) })) };
  }

  // ---------- image satellite (Esri World Imagery) centrée sur ctr, zoom z : renvoie { cv, ctx, P } pour dessiner par-dessus
  async function satImage(ctr, z, W, H) {
    const X = (lo) => (lo + 180) / 360 * 256 * 2 ** z, Y = (la) => (1 - Math.log(Math.tan(rad(la)) + 1 / Math.cos(rad(la))) / Math.PI) / 2 * 256 * 2 ** z;
    const x0 = X(ctr[1]) - W / 2, y0 = Y(ctr[0]) - H / 2, P = (p) => [X(p[1]) - x0, Y(p[0]) - y0];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'); ctx.fillStyle = '#334'; ctx.fillRect(0, 0, W, H);
    const jobs = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++) for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty++) jobs.push(new Promise((res) => {
      const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { ctx.drawImage(im, tx * 256 - x0, ty * 256 - y0); res(true); }; im.onerror = () => res(false);
      im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`; }));
    if (!(await Promise.all(jobs)).some(Boolean)) throw new Error('photo aérienne indisponible');
    const txt = (s2, p, col = '#fff', sz = 15) => { ctx.font = `bold ${sz}px Helvetica, Arial, sans-serif`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(s2, p[0], p[1]); ctx.fillStyle = col; ctx.fillText(s2, p[0], p[1]); };
    ctx.lineCap = 'round';
    return { cv, ctx, P, txt };
  }
  // ---------- photo du terrain d'arrivée (Esri World Imagery) + pistes OSM + schéma du tour de piste + point d'entrée
  async function airfieldPhoto(b) {
    const ap = A.aptByIcao[b.f.arr], v = b.arrInfo.v || {}, rw = b.arrInfo.rw, x0p = arrivalPlan(b);
    const rws = await osmRunways(ap).catch(() => []), dir = runwayDir(rws, rw ? (rw.best.qfu + (v.var || 0) + 360) % 360 : null);
    const right = /droite/.test(x0p.side), sg = right ? 90 : -90, off = 0.7;
    let circ = null;
    if (dir) { const h = dir.hdg, c1 = destPt(dir.e, h, 0.5), c4 = destPt(dir.t, h + 180, 0.8); circ = [dir.t, dir.e, c1, destPt(c1, h + sg, off), destPt(c4, h + sg, off), c4, dir.t]; }
    const ctr = circ ? [circ.reduce((s, p) => s + p[0], 0) / circ.length, circ.reduce((s, p) => s + p[1], 0) / circ.length] : [+ap.la, +ap.lo];
    const W = 960, H = 680, { cv, ctx, P, txt } = await satImage(ctr, 14, W, H);
    rws.forEach((r) => { ctx.strokeStyle = r === (dir && dir.r) ? '#ffd60a' : 'rgba(255,255,255,.8)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(...P(r.a)); ctx.lineTo(...P(r.b)); ctx.stroke(); });
    if (circ) {
      ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 3.5; ctx.setLineDash([14, 8]); ctx.beginPath(); circ.slice(1).forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p)))); ctx.stroke(); ctx.setLineDash([]);
      for (let i = 1; i < circ.length - 1; i++) {   // flèches de sens au milieu de chaque côté
        const a = P(circ[i]), c = P(circ[i + 1]), m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
        ctx.fillStyle = '#ff2bd6'; ctx.beginPath(); ctx.moveTo(m[0] + 12 * Math.cos(ang), m[1] + 12 * Math.sin(ang)); ctx.lineTo(m[0] + 10 * Math.cos(ang + 2.5), m[1] + 10 * Math.sin(ang + 2.5)); ctx.lineTo(m[0] + 10 * Math.cos(ang - 2.5), m[1] + 10 * Math.sin(ang - 2.5)); ctx.fill();
      }
      const mid = (p, q) => [(P(p)[0] + P(q)[0]) / 2, (P(p)[1] + P(q)[1]) / 2];
      txt('vent arrière', mid(circ[3], circ[4]), '#ffb3f0'); txt('base', mid(circ[4], circ[5]), '#ffb3f0'); txt(`finale ${dir.r.ref ? `(${dir.r.ref})` : ''}`, mid(circ[5], circ[6]), '#ffd60a');
    }
    const vp = x0p.entry ? resolvePt(x0p.entry) : null;
    if (vp) { const q = P([vp.la, vp.lo]), inside = q[0] > 20 && q[0] < W - 20 && q[1] > 20 && q[1] < H - 20;
      if (inside) { ctx.fillStyle = '#00e5ff'; ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, 7); ctx.fill(); txt(`entrée ${x0p.entry}`, [q[0] + 10, q[1] - 8], '#00e5ff'); }
      else { const c = [W / 2, H / 2], ang = Math.atan2(q[1] - c[1], q[0] - c[0]), k = Math.min((W / 2 - 40) / Math.abs(Math.cos(ang) || 1e-9), (H / 2 - 30) / Math.abs(Math.sin(ang) || 1e-9)), e = [c[0] + k * Math.cos(ang), c[1] + k * Math.sin(ang)];
        txt(`➜ entrée ${x0p.entry} (${distNm(ctr, [vp.la, vp.lo]).toFixed(1)} NM)`, [Math.min(W - 230, Math.max(8, e[0] - 60)), Math.min(H - 10, Math.max(22, e[1]))], '#00e5ff'); } }
    txt(`${b.f.arr} — tour de piste ${x0p.tdpTxt || x0p.tdpFt + ' ft'} ${right ? 'main droite' : 'main gauche'}${/VAC/.test(x0p.side) ? ' (VAC)' : ' (côté non trouvé dans la VAC : standard à gauche, à vérifier)'}`, [10, 24], '#fff', 16);
    txt('Schéma indicatif — le circuit exact (points, altitudes, zones à éviter) est sur la VAC', [10, H - 12], '#ffd60a', 13);
    return { url: cv.toDataURL('image/jpeg', .85), w: W, h: H, runway: !!dir };
  }
  function safetyAlerts(b) {
    const al = [], c = carbOf(b), w = waterOf(b), tl = townsLow(b), seen = new Set(), q = qnhList(b), th = thermals(b), fz = firesNear(b), gg = glideGaps(b);
    if (hazeLevel(b.aq) >= 2) al.push(`Brume sèche / poussières prévues vers ${b.aq.along.toFixed(0)} NM (épaisseur optique ${b.aq.aod.toFixed(2)}, poussières ${Math.round(b.aq.dust || 0)} µg/m³) : visibilité en vol réduite, horizon flou surtout face au soleil — vérifier les METAR (HZ, DU) et la visibilité en route.`);
    if (fz.length) al.push(`Feu détecté par satellite dans les dernières 24 h à ${fz[0].r.d.toFixed(1)} NM de la route vers ${fz[0].r.along.toFixed(0)} NM${fz.length > 1 ? ` (${fz.length} détections)` : ''} : fumée, Canadair ou hélicoptères possibles, zone interdite temporaire possible (NOTAM). Peut aussi être un brûlage agricole ou un site industriel.`);
    if (gg.length) { const pct = Math.round(gg.reduce((t, g) => t + g.to - g.from + 1, 0) / Math.max(1, b.totDist) * 100), mx = Math.max(...gg.map((g) => g.need));
      al.push(`Hors de portée de plané d'un terrain sur ~${Math.min(100, pct)} % de la route (en rouge sur la coupe et la carte) : en cas de panne moteur, atterrissage en campagne. Pour rester toujours à portée d'un terrain, il faudrait jusqu'à ${mx} ft${mx > 9500 ? ' (irréaliste ici : prévoir les champs)' : ''}. Relief entre la route et le terrain non compté.`); }
    glareOf(b).forEach((g) => al.push(`Soleil bas face à vous en ${g.what} vers ${utc(g.t)} (hauteur ${Math.round(g.sp.el)}°, à ${Math.round(g.off)}° de l'axe) : éblouissement, trafic et relief difficiles à voir — lunettes de soleil, pare-soleil, pare-brise propre, ou changer d'horaire.`));
    if (q.length > 1 && Math.max(...q.map((x) => x.q)) - Math.min(...q.map((x) => x.q)) >= 3) { const lo = q.reduce((m, x) => (x.q < m.q ? x : m)), hi = q.reduce((m, x) => (x.q > m.q ? x : m)); al.push(`QNH de ${hi.q} hPa (${hi.id}) à ${lo.q} hPa (${lo.id}) le long de la route : écart ${hi.q - lo.q} hPa, soit ~${(hi.q - lo.q) * 28} ft d'erreur — recaler l'altimètre en route (QNH du SIV ou du terrain le plus proche).`); }
    if (th) al.push(`Turbulence thermique probable (${th.T} °C, base des cumulus vers ${th.base} ft sol) : ceintures serrées, vitesse réduite en air agité, au-dessus de la base si possible, ou voler le matin.`);
    if (c && Math.max(c.cruise.lv, c.descent.lv) >= 3) al.push(`Givrage carburateur fort probable ${c.cruise.lv >= 3 ? `en croisière (T ${c.cruise.T} °C, point de rosée ${c.cruise.Td} °C vers ${c.cruise.ft} ft)` : `en descente moteur réduit (T ${c.descent.T} °C, point de rosée ${c.descent.Td} °C)`} : réchauffage carburateur régulier, plein chaud avant de réduire.`);
    if (w && w.beyond.length) al.push(`Au-dessus de l'eau vers ${w.worst.along.toFixed(0)} NM : ${w.worst.d.toFixed(0)} NM de la côte pour un plané d'environ ${w.worst.glide.toFixed(0)} NM à ${w.worst.ft} ft — gilets de sauvetage obligatoires pour chaque occupant (NCO.IDE.A.175). Monter plus haut si possible, contact SIV.`);
    if (tl.length) al.push(`Survol d'agglomération trop bas : ${tl.slice(0, 5).map((t) => `${t.n} vers ${t.along.toFixed(0)} NM (~${Math.round(t.h / 100) * 100} ft sol, minimum estimé ${t.need} ft sol)`).join(', ')}${tl.length > 5 ? '…' : ''}. Monomoteur en France : hauteur minimale selon la taille de l'agglomération (arrêté du 10/10/1957, valeurs estimées, à vérifier) et au moins 1000 ft au-dessus de l'obstacle le plus haut (SERA) — contourner ou monter.`);
    b.legs.forEach((lg) => lg.airspaces.filter((s) => /^(RMZ|TMZ)$/.test(s.kind || '') && !seen.has(s.name) && seen.add(s.name)).forEach((s) => al.push(s.kind === 'RMZ'
      ? `${s.name} (RMZ, ${s.lower} – ${s.upper}) traversée : contact radio obligatoire avant d'entrer${s.freq ? ` (${String(s.freq).split(' / ')[0]})` : ''}.`
      : `${s.name} (TMZ, ${s.lower} – ${s.upper}) traversée : transpondeur mode S obligatoire.`)));
    return al;
  }
  function safetyHtml(b) {
    const c = carbOf(b), w = waterOf(b), out = [];
    if (c) out.push(`🧊 Givrage carburateur (estimation, diagramme CAA) : croisière <b style="color:${CARBCOL[c.cruise.lv]}">${CARB[c.cruise.lv]}</b> (T ${c.cruise.T} °C, rosée ${c.cruise.Td} °C vers ${c.cruise.ft} ft) · descente moteur réduit <b style="color:${CARBCOL[c.descent.lv]}">${CARB[c.descent.lv]}</b>. ${Math.max(c.cruise.lv, c.descent.lv) >= 2 ? 'Réchauffage carburateur : contrôle régulier en croisière, plein chaud avant de réduire.' : 'Essai du réchauffage au point d\'arrêt, plein chaud en descente.'}`);
    if (w && !w.beyond.length) out.push(`🌊 Au-dessus de l'eau : au plus ${w.worst.d.toFixed(0)} NM de la côte, plané ≈ ${w.worst.glide.toFixed(0)} NM : gilets non obligatoires, mais conseillés.`);
    const q = qnhList(b), sb = seaBreeze(b), va = vappOf(b);
    if (q.length > 1) out.push(`🧭 QNH le long de la route (METAR actuels) : ${q.map((x) => `${esc(x.id)} ${x.q}`).join(' → ')} hPa.`);
    if (sb) out.push(`🌬️ Brise de mer probable à ${esc(b.f.arr)} l'après-midi : vent de mer ~10-15 kt venant du ${sb.from}° environ${sb.rwy ? `, piste ${sb.rwy} probable` : ''} — la piste en service peut changer par rapport au vent prévu.`);
    if (va) out.push(`🛬 Vitesse d'approche à ${esc(b.f.arr)} : <b>${va.v} kt</b> (${esc(va.src)} ${va.base} kt${va.mass ? `, corrigée pour ${va.mass} kg` : ''}${va.gust ? `, +${va.gust} kt de rafales` : ''}).`);
    return out.map((x) => `<p class="meta">${x}</p>`).join('');
  }
  function moreHtml(b, sfx) {
    const cams = routeCams(b), rf = radioFail(b);
    const aq = b.aq, hz = hazeLevel(aq);
    return `${hz === 1 ? `<p class="meta">🌫️ Légère brume sèche possible (épaisseur optique ${aq.aod.toFixed(2)}) : visibilité un peu réduite, horizon moins net.</p>` : ''}
      ${notamsHtml(b)}
      ${cams.length ? `<details><summary><b>📷 Webcams le long de la route</b> (${cams.length}, heure de passage prévue)</summary><p class="meta">${cams.map((x) => `${utc(x.at)} · <a href="${esc(x.s.u)}" target="_blank" rel="noopener">${esc(x.s.n)}</a> <small>(${x.r.d.toFixed(1)} NM, vers ${x.r.along.toFixed(0)} NM)</small>`).join('<br>')}</p></details>` : ''}
      <details><summary><b>📻 Panne radio</b>${rf.ctl.length ? ` — ${rf.ctl.length} espace(s) contrôlé(s) traversé(s)` : ''}</summary><p class="meta">Transpondeur <b>7600</b>. En conditions VMC : rester VMC, atterrir sur l'aérodrome approprié le plus proche et prévenir l'organisme ATS de l'arrivée (SERA.14083). Continuer à émettre « en aveugle ». Feux de la tour : vert fixe = autorisé à atterrir, vert clignotant = revenir pour atterrir, rouge fixe = céder le passage et continuer à tourner, rouge clignotant = terrain dangereux, ne pas atterrir.</p>
        ${rf.ctl.length ? `<p class="meta">Espaces contrôlés traversés : ${esc(rf.ctl.join(', '))} — sans clairance, ne pas y entrer ; si déjà dedans, suivre la dernière clairance reçue et en sortir par le chemin le plus court prévu.</p>` : ''}
        ${rf.vac.map(([id, t]) => `<p class="meta"><b>${esc(id)}</b> (VAC) : ${esc(t)}</p>`).join('') || '<p class="meta">Pas de consigne « panne radio » trouvée dans les VAC des terrains : vérifier la carte.</p>'}</details>
      <p class="meta"><button class="btn" id="pf-back${sfx}">↩️ Préparer le retour</button> <button class="btn" id="pf-pax${sfx}">🧑‍🤝‍🧑 Fiche briefing passagers</button> <button class="btn" id="pf-fields${sfx}">🌾 Chercher les champs de secours</button> <button class="btn" id="pf-efato${sfx}">🛫 Panne au décollage</button> <button class="btn" id="pf-obst${sfx}">⚡ Éoliennes et lignes HT</button> <span id="pf-fields-st${sfx}"></span></p>
      <div id="pf-fields-out${sfx}"></div><div id="pf-efato-out${sfx}"></div><div id="pf-obst-out${sfx}"></div>
      <details id="pf-photo-box${sfx}"><summary><b>📸 Photo du terrain d'arrivée et schéma du tour de piste</b></summary><div id="pf-photo${sfx}" class="meta">Ouvrir pour charger la photo…</div></details>`;
  }
  // ---------- fiche briefing passagers (page à imprimer)
  function paxBrief(b) {
    const f = b.f, front = f.m2 > 0, rear = f.m3 > 0, w = waterOf(b), canopy = /DR ?4|Robin/i.test(f.T.label);
    const items = [
      ['Ceintures', 'Comment les boucler et les ouvrir. Serrées au roulage, au décollage, à l\'atterrissage et dès que l\'air est agité.'],
      [canopy ? 'Verrière' : 'Portes', `Comment ${canopy ? 'la' : 'les'} ouvrir et fermer (montré au sol). On n'y touche pas en vol sauf si le pilote le demande.`],
      ['Extincteur', 'Où il se trouve et comment s\'en servir (montré au sol).'],
      ['Atterrissage d\'urgence', `Ceinture très serrée, tête protégée, objets rangés. ${canopy ? 'Verrière' : 'Porte'} entrouverte avant l'impact si le pilote le demande. Après l'arrêt : sortir vite, s'éloigner de l'avion, au vent.`],
      ['Interdit', 'Fumer ; toucher les commandes, le palonnier et les manettes ; objets libres dans la cabine ; parler pendant les messages radio, au décollage et à l\'atterrissage.'],
      ['Bagages', 'Rangés et attachés, dans la limite de masse annoncée par le pilote. Rien sur la tablette arrière qui pourrait tomber.'],
      ['Mal de l\'air', 'Sacs à portée de main ; regarder l\'horizon, prévenir le pilote tôt.'],
      ['Trafic', 'Signaler au pilote tout avion ou planeur vu (« avion à 2 heures, plus haut »).'],
      ...(w && w.beyond.length ? [['Gilets de sauvetage', 'Obligatoires sur ce vol : les mettre avant le départ, ne les gonfler qu\'à la sortie de l\'avion.']] : []),
    ];
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Briefing passagers</title><style>body{font:15px/1.45 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:20px}dt{font-weight:bold;margin-top:10px}dd{margin:2px 0 0 0}.m{color:#555}</style></head><body>
      <h1>Briefing passagers — ${esc(f.ac.reg)} ${esc(f.T.label)}</h1><p class="m">${esc(b.ids.filter((x) => !/^(DT|VL)/.test(x)).join(' → '))} · ${b.depT.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })} · ${front ? 'passager avant' : ''}${front && rear ? ' et ' : ''}${rear ? 'passagers arrière' : ''}${!front && !rear ? 'sans passager' : ''} · durée prévue ${hhmm(b.totMin)}</p>
      <dl>${items.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl><p class="m">À lire avec le pilote avant la mise en route. Emplacements exacts : voir l'avion et son manuel de vol.</p></body></html>`;
  }
  // ---------- champs de secours : prairies / cultures OpenStreetMap à moins de 1,5 NM, le plus grand par tranche de 5 NM (taille d'après la boîte englobante)
  // shortcut: taille = rectangle englobant de la zone OSM (souvent plusieurs parcelles), à remplacer par la géométrie réelle (out geom) si les pilotes s'y fient
  async function rescueFields(b) {
    const j = await osmQuery(`[out:json][timeout:25];way["landuse"~"^(meadow|farmland|grass)$"](poly:"${corridorPoly(b, 1.5)}");out bb qt;`);
    const bins = new Map();
    for (const e of j.elements || []) {
      if (!e.bounds) continue;
      const { c, L: L1, W: W1 } = bbSize(e.bounds); if (L1 < 600 || W1 < 200 || L1 > 2500) continue;   // > 2,5 km : grande zone « cultures » d'OSM (routes, haies, maisons), pas une parcelle
      const r = routeDist(c, b.pts), k = Math.floor(r.along / 5), cur = bins.get(k), sc = (x, y) => Math.min(x, 1500) * Math.min(y, 500);
      if (r.d > 1.5) continue;
      if (!cur || sc(L1, W1) > sc(cur.L, cur.W)) bins.set(k, { c, L: Math.round(L1 / 10) * 10, W: Math.round(W1 / 10) * 10, along: r.along, d: r.d, kind: e.tags && e.tags.landuse });
    }
    return [...bins.values()].sort((x, y) => x.along - y.along);
  }


  // ---------- zones particulières : ZSM gypaète (STAC), parachutage / voltige (ENR 5.5), cœur du Parc national des Pyrénées
  // cœur du Parc national des Pyrénées : contour INPN (via OpenStreetMap, relation 1024513), simplifié à ~400 m
  const PNP_CORE = [[42.882,-0.7],[42.888,-0.699],[42.905,-0.675],[42.906,-0.671],[42.906,-0.666],[42.904,-0.662],[42.895,-0.651],[42.896,-0.631],[42.894,-0.624],[42.887,-0.614],[42.881,-0.613],[42.883,-0.609],[42.883,-0.602],[42.881,-0.596],[42.879,-0.595],[42.875,-0.587],[42.871,-0.586],[42.867,-0.59],[42.865,-0.586],[42.86,-0.585],[42.859,-0.581],[42.854,-0.579],[42.849,-0.572],[42.842,-0.573],[42.84,-0.577],[42.834,-0.579],[42.834,-0.574],[42.82,-0.569],[42.819,-0.561],[42.835,-0.559],[42.839,-0.56],[42.848,-0.552],[42.848,-0.543],[42.84,-0.534],[42.845,-0.527],[42.849,-0.525],[42.849,-0.522],[42.857,-0.518],[42.857,-0.515],[42.859,-0.517],[42.864,-0.517],[42.867,-0.52],[42.872,-0.53],[42.877,-0.53],[42.882,-0.516],[42.887,-0.511],[42.883,-0.504],[42.883,-0.493],[42.879,-0.485],[42.874,-0.487],[42.873,-0.49],[42.861,-0.49],[42.856,-0.487],[42.85,-0.487],[42.848,-0.484],[42.842,-0.484],[42.84,-0.487],[42.843,-0.475],[42.85,-0.472],[42.851,-0.468],[42.857,-0.462],[42.858,-0.459],[42.863,-0.458],[42.867,-0.454],[42.875,-0.453],[42.878,-0.45],[42.88,-0.443],[42.883,-0.439],[42.883,-0.433],[42.89,-0.428],[42.892,-0.422],[42.891,-0.413],[42.886,-0.4],[42.865,-0.388],[42.859,-0.388],[42.857,-0.386],[42.845,-0.384],[42.843,-0.381],[42.843,-0.372],[42.846,-0.366],[42.849,-0.348],[42.851,-0.346],[42.856,-0.345],[42.862,-0.338],[42.868,-0.338],[42.876,-0.341],[42.879,-0.34],[42.882,-0.331],[42.882,-0.32],[42.888,-0.321],[42.9,-0.319],[42.904,-0.309],[42.908,-0.304],[42.908,-0.282],[42.906,-0.275],[42.903,-0.273],[42.899,-0.273],[42.897,-0.271],[42.891,-0.271],[42.889,-0.273],[42.885,-0.271],[42.887,-0.254],[42.889,-0.251],[42.889,-0.245],[42.886,-0.242],[42.886,-0.239],[42.89,-0.233],[42.89,-0.228],[42.886,-0.223],[42.877,-0.223],[42.877,-0.215],[42.879,-0.213],[42.879,-0.207],[42.882,-0.199],[42.88,-0.196],[42.871,-0.19],[42.869,-0.183],[42.866,-0.182],[42.869,-0.177],[42.874,-0.174],[42.876,-0.169],[42.875,-0.151],[42.884,-0.145],[42.887,-0.138],[42.887,-0.134],[42.893,-0.121],[42.888,-0.114],[42.884,-0.113],[42.883,-0.111],[42.874,-0.11],[42.874,-0.105],[42.869,-0.1],[42.857,-0.095],[42.853,-0.095],[42.848,-0.092],[42.845,-0.093],[42.824,-0.092],[42.816,-0.095],[42.805,-0.094],[42.801,-0.097],[42.801,-0.099],[42.798,-0.099],[42.796,-0.098],[42.794,-0.093],[42.794,-0.082],[42.79,-0.078],[42.783,-0.075],[42.776,-0.076],[42.771,-0.082],[42.771,-0.081],[42.767,-0.082],[42.765,-0.086],[42.76,-0.09],[42.757,-0.079],[42.758,-0.077],[42.752,-0.071],[42.751,-0.068],[42.75,-0.05],[42.748,-0.048],[42.74,-0.049],[42.733,-0.044],[42.73,-0.044],[42.723,-0.048],[42.716,-0.038],[42.715,-0.031],[42.719,-0.025],[42.719,-0.014],[42.721,-0.011],[42.725,-0.009],[42.726,0.001],[42.733,0.005],[42.736,0.012],[42.736,0.018],[42.738,0.018],[42.741,0.023],[42.745,0.026],[42.748,0.036],[42.748,0.045],[42.745,0.048],[42.737,0.051],[42.738,0.055],[42.733,0.065],[42.732,0.073],[42.736,0.084],[42.74,0.085],[42.746,0.092],[42.751,0.089],[42.755,0.09],[42.757,0.087],[42.764,0.086],[42.767,0.08],[42.774,0.082],[42.78,0.081],[42.781,0.066],[42.785,0.059],[42.791,0.053],[42.79,0.042],[42.792,0.04],[42.799,0.04],[42.803,0.044],[42.812,0.035],[42.814,0.024],[42.82,0.023],[42.827,0.024],[42.831,0.027],[42.831,0.039],[42.834,0.043],[42.833,0.052],[42.835,0.055],[42.834,0.067],[42.836,0.068],[42.839,0.074],[42.836,0.094],[42.846,0.092],[42.853,0.094],[42.856,0.098],[42.854,0.107],[42.845,0.117],[42.842,0.119],[42.837,0.119],[42.832,0.126],[42.826,0.127],[42.824,0.13],[42.82,0.132],[42.808,0.133],[42.81,0.145],[42.807,0.148],[42.805,0.148],[42.804,0.151],[42.806,0.153],[42.808,0.16],[42.809,0.174],[42.805,0.179],[42.801,0.18],[42.796,0.175],[42.787,0.176],[42.784,0.174],[42.783,0.17],[42.785,0.167],[42.785,0.155],[42.781,0.145],[42.776,0.14],[42.769,0.14],[42.768,0.148],[42.766,0.15],[42.768,0.164],[42.767,0.169],[42.765,0.171],[42.76,0.171],[42.756,0.169],[42.753,0.17],[42.745,0.167],[42.74,0.174],[42.732,0.176],[42.73,0.175],[42.726,0.166],[42.725,0.167],[42.721,0.166],[42.719,0.163],[42.721,0.152],[42.719,0.148],[42.718,0.138],[42.712,0.135],[42.709,0.12],[42.707,0.119],[42.706,0.106],[42.708,0.099],[42.713,0.091],[42.712,0.084],[42.711,0.08],[42.707,0.076],[42.7,0.073],[42.699,0.068],[42.695,0.064],[42.692,0.047],[42.699,0.022],[42.698,0.019],[42.693,0.019],[42.689,0.015],[42.681,0.001],[42.681,-0.018],[42.684,-0.022],[42.684,-0.028],[42.688,-0.037],[42.688,-0.046],[42.69,-0.048],[42.688,-0.056],[42.691,-0.064],[42.7,-0.069],[42.704,-0.068],[42.706,-0.07],[42.709,-0.069],[42.714,-0.07],[42.713,-0.082],[42.717,-0.089],[42.718,-0.099],[42.717,-0.109],[42.72,-0.11],[42.725,-0.116],[42.728,-0.116],[42.731,-0.113],[42.736,-0.121],[42.738,-0.122],[42.741,-0.121],[42.747,-0.127],[42.749,-0.127],[42.75,-0.13],[42.755,-0.133],[42.76,-0.14],[42.764,-0.141],[42.764,-0.148],[42.766,-0.153],[42.768,-0.154],[42.775,-0.153],[42.779,-0.158],[42.783,-0.16],[42.79,-0.159],[42.792,-0.16],[42.792,-0.162],[42.788,-0.164],[42.781,-0.178],[42.783,-0.183],[42.783,-0.191],[42.787,-0.193],[42.789,-0.198],[42.792,-0.2],[42.794,-0.208],[42.792,-0.211],[42.792,-0.215],[42.793,-0.218],[42.798,-0.222],[42.797,-0.226],[42.802,-0.232],[42.804,-0.239],[42.807,-0.243],[42.816,-0.243],[42.817,-0.245],[42.815,-0.258],[42.822,-0.267],[42.825,-0.277],[42.833,-0.281],[42.835,-0.29],[42.835,-0.301],[42.838,-0.309],[42.843,-0.313],[42.84,-0.317],[42.835,-0.318],[42.831,-0.322],[42.83,-0.333],[42.833,-0.335],[42.833,-0.345],[42.83,-0.35],[42.825,-0.352],[42.823,-0.356],[42.821,-0.356],[42.818,-0.36],[42.813,-0.362],[42.81,-0.366],[42.805,-0.38],[42.801,-0.379],[42.797,-0.382],[42.795,-0.393],[42.795,-0.396],[42.798,-0.399],[42.803,-0.41],[42.803,-0.414],[42.791,-0.442],[42.796,-0.451],[42.798,-0.451],[42.8,-0.454],[42.8,-0.461],[42.806,-0.48],[42.807,-0.482],[42.81,-0.482],[42.813,-0.486],[42.813,-0.495],[42.819,-0.502],[42.824,-0.504],[42.821,-0.509],[42.815,-0.512],[42.814,-0.516],[42.809,-0.521],[42.797,-0.519],[42.793,-0.522],[42.788,-0.528],[42.788,-0.536],[42.79,-0.541],[42.775,-0.548],[42.774,-0.554],[42.776,-0.557],[42.775,-0.559],[42.777,-0.562],[42.777,-0.569],[42.78,-0.574],[42.791,-0.575],[42.8,-0.569],[42.803,-0.571],[42.804,-0.576],[42.801,-0.581],[42.801,-0.586],[42.799,-0.588],[42.799,-0.594],[42.801,-0.596],[42.801,-0.601],[42.804,-0.604],[42.807,-0.605],[42.816,-0.603],[42.819,-0.606],[42.83,-0.608],[42.832,-0.617],[42.837,-0.625],[42.846,-0.635],[42.849,-0.636],[42.851,-0.65],[42.855,-0.658],[42.862,-0.665],[42.869,-0.666],[42.873,-0.67],[42.877,-0.679],[42.879,-0.68],[42.877,-0.692],[42.875,-0.693],[42.876,-0.697],[42.882,-0.7]];
  function specialZones(b) {
    const S = SPECIAL || {}, smp = routeSamples(b, 1), al = [], seen = new Set();
    for (const z of S.zsm || []) {
      const hit = smp.find((x) => inPoly(x.p, z.poly));
      if (hit && b.f.ft < z.ft && !seen.has(z.name)) { seen.add(z.name); al.push(`ZSM gypaète « ${z.name} » traversée à ${b.f.ft} ft (vers ${hit.along.toFixed(0)} NM) : survol motorisé au-dessus de ${z.ft} ft, ou contourner (zones de sensibilité majeure du STAC, en période de reproduction).`); }
    }
    for (const a of S.act || []) {
      const d = Math.min(...smp.map((x) => distNm(x.p, [a.la, a.lo])));
      const ground = /ASFC|AGL/i.test(a.upper) ? ((b.profile || []).reduce((m, q) => (!m || distNm(q.p, [a.la, a.lo]) < distNm(m.p, [a.la, a.lo]) ? q : m), null) || { ft: 0 }).ft : 0;
      const up = /^FL/.test(a.upper) ? +a.upper.replace(/\D/g, '') * 100 : parseInt(a.upper, 10) + ground;
      if (d <= 3 && b.f.ft <= up + 500) al.push(`Zone de ${a.kind} ${a.num} ${a.name} à ${d.toFixed(1)} NM de la route (jusqu'à ${a.upper}, ${a.hours}) — ${a.rmk.slice(0, 120)}`);
    }
    const pnp = smp.find((x) => inPoly(x.p, PNP_CORE));
    if (pnp) { const ground = Math.max(0, ...(b.profile || []).filter((p) => inPoly(p.p, PNP_CORE)).map((p) => p.ft)); if (b.f.ft < ground + 3300) al.push(`Cœur du Parc national des Pyrénées (vers ${pnp.along.toFixed(0)} NM) : survol à moins de 1000 m (3300 ft) au-dessus du sol interdit — relief jusqu'à ${ground} ft, croisière ${b.f.ft} ft. Vérifier sur la carte OACI.`); }
    return al;
  }

  // ---------- nuages et givrage à l'altitude de croisière (GRAMET)
  // nébulosité et température d'une colonne GRAMET à une altitude (interpolées entre niveaux de pression)
  const grametAt = (c, ft) => { const lv = c.lv; for (let k = 0; k < lv.length - 1; k++) if (lv[k].z <= ft && lv[k + 1].z >= ft) { const r = (ft - lv[k].z) / (lv[k + 1].z - lv[k].z); return { cc: lv[k].cc + (lv[k + 1].cc - lv[k].cc) * r, T: lv[k].T + (lv[k + 1].T - lv[k].T) * r }; } return null; };
  function cruiseIcing(b) {
    const g = b.gramet; if (!g || g.err || !g.cols) return [];
    return g.cols.map((c) => { const v = grametAt(c, b.f.ft); return v && { along: c.along, cc: v.cc, T: v.T, cloud: v.cc >= 50, icing: v.cc >= 50 && v.T <= 0 && v.T >= -15, iso0: c.iso0 }; }).filter(Boolean);
  }
  function icingAlerts(b) {
    const pts = cruiseIcing(b), al = [];
    const spans = (pred) => { const r = []; let cur = null; pts.forEach((p) => { if (pred(p)) { if (!cur) cur = { a: p.along, z: p.along }; cur.z = p.along; } else if (cur) { r.push(cur); cur = null; } }); if (cur) r.push(cur); return r; };
    const fmt = (s) => s.map((x) => `${x.a.toFixed(0)}-${x.z.toFixed(0)} NM`).join(', ');
    const ic = spans((p) => p.icing), cl = spans((p) => p.cloud && !p.icing), iso = pts.filter((p) => p.iso0 != null && p.iso0 < b.f.ft);
    if (ic.length) al.push(`Givrage probable à ${b.f.ft} ft (nuage entre 0 et -15 °C) sur ${fmt(ic)} — descendre sous l'isotherme 0 °C (${Math.round(Math.min(...pts.map((p) => p.iso0 ?? 99999)) / 100) * 100} ft) ou reporter.`);
    if (cl.length) al.push(`Croisière à ${b.f.ft} ft dans les nuages prévus sur ${fmt(cl)} (couverture ≥ 50 % au niveau de vol) — VFR impossible à cette altitude.`);
    if (iso.length && !ic.length) al.push(`Croisière au-dessus de l'isotherme 0 °C sur ${iso.length} point(s) du GRAMET : risque de givrage en cas de nuage ou de précipitations.`);
    return al;
  }

  // ---------- carnet de vol (profil pilote, sur l'appareil) et expérience récente
  const pilotOf = (name) => (store.get('pilots', {})[name] || {});
  function addLog(name, e) { const all = store.get('pilots', {}), pr = all[name] || {}; pr.log = [...(pr.log || []), { ...e, id: Date.now() + Math.random() }].slice(-300); all[name] = pr; store.set('pilots', all); }
  function recentAlerts(b) {
    const f = b.f, p = pilotOf(f.pil), log = p.log || [], al = [];
    if (!f.pil) return al;
    const day = 864e5, t = b.depT.getTime();
    const ldg = log.filter((e) => t - Date.parse(e.d) <= 90 * day && Date.parse(e.d) <= t).reduce((s, e) => s + (+e.n || 0), 0);
    if ((f.m2 > 0 || f.m3 > 0) && ldg < 3) al.unshift(`⛔ Expérience récente : ${ldg} atterrissage(s) dans les 90 jours d'après le carnet (3 décollages et 3 atterrissages requis pour emporter des passagers) — voler seul ou avec un instructeur avant.`);
    else if (!log.length) al.push('Expérience récente non vérifiée : carnet de vol vide sur cet appareil (3 atterrissages dans les 90 jours requis pour emporter des passagers).');
    if (f.lic) {
      const end = Date.parse(f.lic + 'T23:59:59Z');
      if (end - t < 365 * day && !log.some((e) => e.i && Date.parse(e.d) > end - 365 * day)) al.push(`Prorogation SEP avant le ${f.lic.split('-').reverse().join('/')} : 12 h de vol dans les 12 derniers mois dont 1 h avec un instructeur — aucun vol avec instructeur noté au carnet dans cette période.`);
    }
    if (b.night && (b.night.late || b.night.firstDark || b.night.early) && !p.nuit) al.unshift(`⛔ Vol de nuit prévu et qualification de nuit non indiquée dans le profil de ${f.pil}.`);
    return al;
  }
  // VFR de nuit : terrain d'arrivée agréé (VAC) et avion apte
  function nightAlerts(b) {
    if (!b.night || !(b.night.late || b.night.firstDark || b.night.early)) return [];
    const al = [], nightOk = (id) => { const t = (vacAt(id) || {}).infos || '', s = (t.split(/ATS :2 -/)[1] || '').split(/VFR de nuit \/ Night VFR :3/)[0]; return /Non agréé|Not approved|\bNIL\b/i.test(s) ? false : /Agréé|Approved/i.test(s) ? true : null; };
    for (const id of [...(b.night.early ? [b.f.dep] : []), b.f.arr, b.f.alt].filter(Boolean)) {
      const ok = nightOk(id);
      if (ok === false) al.push(`⛔ ${id} n'est pas agréé VFR de nuit (VAC) : arrivée de nuit impossible.`);
      else if (ok === null) al.push(`${id} : agrément VFR de nuit non trouvé dans la VAC, à vérifier (balisage, horaires).`);
    }
    al.push(`Vol de nuit : vérifier que ${b.f.ac.reg} est apte au VFR de nuit (équipements, CDN) et que le balisage des terrains est en service (NOTAM).`);
    return al;
  }

  // ================================================================== « Où voler ? » : terrains atteignables, classés par météo (milieu de route + arrivée), horaires, piste, zones P
  function whereScore(x) { return Math.max(x.wm.level, x.wa.level) * 10 + (x.closed ? 6 : 0) + (x.pz ? 5 : 0) + (x.rwy ? 3 : 0); }
  console.assert(whereScore({ wm: { level: 0 }, wa: { level: 1 }, closed: true }) === 16 && whereScore({ wm: { level: 0 }, wa: { level: 0 } }) === 0, 'whereScore');
  async function whereToFly(f, maxMin, say) {
    const a0 = A.aptByIcao[f.dep]; if (!a0) throw new Error('Indique un terrain de départ connu.');
    const depT = new Date(f.time); if (isNaN(depT)) throw new Error('Heure de départ invalide.');
    say('Chargement des terrains et des zones…'); await loadAip();
    const maxNm = f.tas * maxMin / 60, P0 = [+a0.la, +a0.lo];
    const cand = A.APTS.filter((a) => /^LF[A-Z]{2}$/.test(a.icao) && a.icao !== f.dep && vacAt(a.icao)).map((a) => ({ a, d: distNm(P0, [+a.la, +a.lo]) }))
      .filter((x) => x.d >= 15 && x.d <= maxNm).sort((x, y) => y.d - x.d).slice(0, 40);   // 80 points météo : Open-Meteo compte chaque point comme un appel
    if (!cand.length) throw new Error(`Aucun terrain avec VAC entre 15 et ${Math.round(maxNm)} NM.`);
    cand.forEach((x) => { x.min = x.d / f.tas * 60 + 10; x.eta = new Date(depT.getTime() + x.min * 6e4); x.mid = destPt(P0, bearing(P0, [+x.a.la, +x.a.lo]), x.d / 2); });
    say(`Météo sur ${cand.length} destinations…`);
    const pts = cand.flatMap((x) => [{ p: x.mid, at: new Date((depT.getTime() + x.eta.getTime()) / 2) }, { p: [+x.a.la, +x.a.lo], at: x.eta }]);
    const days = [...new Set(pts.map((x) => x.at.toISOString().slice(0, 10)))].sort(), W = [];
    for (let i = 0; i < pts.length; i += 100) {
      const ch = pts.slice(i, i + 100);
      let d = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${ch.map((x) => x.p[0].toFixed(3)).join(',')}&longitude=${ch.map((x) => x.p[1].toFixed(3)).join(',')}`
        + `&hourly=temperature_2m,dew_point_2m,cloud_cover_low,visibility,precipitation,weather_code,wind_gusts_10m&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`);
      if (!Array.isArray(d)) d = [d];
      ch.forEach((x, j) => { const h = d[j].hourly, k = h.time.indexOf(roundHour(x.at)), g = (v) => (k < 0 ? null : h[v][k]);
        W.push(wxLevel({ T: g('temperature_2m'), Td: g('dew_point_2m'), low: g('cloud_cover_low'), vis: g('visibility'), rr: g('precipitation'), wc: g('weather_code'), gust: g('wind_gusts_10m'), elevFt: Math.round((d[j].elevation || 0) * 3.281) }, f.ft)); });
    }
    const pz = ((ZONES && ZONES.data) || []).filter((z) => z.type === 'P' && (parseAlt(z.lower) ?? 0) < f.ft);
    cand.forEach((x, i) => {
      x.wm = W[2 * i]; x.wa = W[2 * i + 1];
      const line = Array.from({ length: Math.ceil(x.d / 2) + 1 }, (_, k) => destPt(P0, bearing(P0, [+x.a.la, +x.a.lo]), Math.min(x.d, k * 2)));
      x.pz = pz.find((z) => line.some((p) => inPoly(p, z.poly)));
      x.closed = outsideHours(vacAt(x.a.icao), x.eta); x.rwy = adCheck(x.a.icao, f.T); x.fee = A.feeFor ? A.feeFor(x.a.icao) : null;
      x.score = whereScore(x);
    });
    cand.sort((x, y) => x.score - y.score || y.d - x.d);
    const dot = (l) => `<span style="color:${WXCOL[l.level]}">●</span>`;
    return `<h4>🧭 Où voler au départ de ${esc(f.dep)} (${utc(depT)}, ${maxMin} min aller au plus, ${Math.round(f.tas)} kt)</h4>
      <table class="legs"><tr><th>Terrain</th><th>NM</th><th>Aller</th><th>Route</th><th>Arrivée</th><th style="text-align:left">À savoir</th><th></th></tr>
      ${cand.slice(0, 25).map((x) => { const why = [...new Set([...x.wm.why, ...x.wa.why])], note = [x.closed && `fermé à ${utc(x.eta)} (${x.closed.win})`, x.pz && `zone P ${x.pz.id} sur la ligne directe`, x.rwy && x.rwy.why[0], x.fee && x.fee.tarif && `taxe ${x.fee.tarif}`].filter(Boolean);
        return `<tr><td style="text-align:left"><b>${esc(x.a.icao)}</b> ${esc(x.a.name)}</td><td>${x.d.toFixed(0)}</td><td>${Math.round(x.min)}′</td><td title="${esc(x.wm.why.join(', '))}">${dot(x.wm)}</td><td title="${esc(x.wa.why.join(', '))}">${dot(x.wa)}</td>
          <td style="text-align:left">${esc([...why, ...note].join(' · ') || 'rien de signalé')}</td><td><button class="btn" data-goto="${esc(x.a.icao)}">Préparer</button></td></tr>`; }).join('')}</table>
      <p class="meta">Ligne directe, vent non compté, 10 min ajoutées pour le départ et l'arrivée. Météo : prévision Open-Meteo au milieu de la route et à l'arrivée (● vert favorable, orange marginal, rouge défavorable). Zones R / D, AZBA et NOTAM sont vérifiés en cliquant « Préparer ».</p>`;
  }

  // ================================================================== mode entraînement : nav tirée au hasard, à préparer seul puis à comparer
  function trainingStart() {
    const dep = A.aptByIcao[$('#pf-dep').value.trim().toUpperCase()] ? $('#pf-dep').value.trim().toUpperCase() : 'LFBP', a0 = A.aptByIcao[dep];
    const cand = A.APTS.filter((a) => a.icao.startsWith('LF') && a.icao !== dep && VAC && VAC.data && VAC.data[a.icao]).map((a) => ({ a, d: distNm([a0.la, a0.lo], [a.la, a.lo]) })).filter((x) => x.d >= 35 && x.d <= 80);
    if (!cand.length) { $('#pf-prog').textContent = 'Aucun terrain entre 35 et 80 NM.'; return; }
    const pick = cand[Math.floor(Math.random() * cand.length)].a, t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0);
    $('#pf-dep').value = dep; $('#pf-arr').value = pick.icao; $('#pf-wps').value = ''; $('#pf-stages').value = ''; $('#pf-alt').value = '';
    $('#pf-exit').value = 'none'; $('#pf-entry').value = 'none'; $('#pf-time').value = localInput(t);
    const F = [['rm', 'Route magnétique (°)'], ['dist', 'Distance (NM)'], ['cm', 'Cap magnétique (°)'], ['min', 'Temps de vol (min)'], ['fuel', 'Carburant d\'étape (L)'], ['safe', 'Altitude de sécurité (ft)']];
    $('#pf-out').innerHTML = `<div class="okk">🎲 <b>Exercice</b> : nav en direct <b>${esc(dep)} → ${esc(pick.icao)}</b> (${esc(pick.name)}), départ demain 10 h, avion et altitude du formulaire.
      Prépare-la seul (carte, vent prévu, tables), puis saisis tes valeurs et compare avec le calcul du site.</div>
      <div class="prep-form" id="tr-in">${F.map(([k, l]) => `<label>${l}<input data-k="${k}" type="number"></label>`).join('')}</div>
      <div class="prep-actions"><button class="btn primary" id="tr-go">Comparer avec le calcul</button></div>`;
    $('#tr-go').addEventListener('click', async () => {
      const mine = Object.fromEntries([...document.querySelectorAll('#tr-in input')].map((i) => [i.dataset.k, i.value === '' ? null : +i.value]));
      await run(false);
      const b = lastTrip && lastTrip[0]; if (!b) return;
      const lg = b.legs[0], ref = { rm: lg.tm, dist: lg.dist, cm: lg.hm, min: b.totMin, fuel: b.totFuel, safe: lg.safe ? lg.safe.alt : null };
      const tol = { rm: 5, dist: 2, cm: 5, min: 3, fuel: 3, safe: 200 }, ang = (x, y) => Math.abs(((x - y + 540) % 360) - 180);
      const rows = F.map(([k, l]) => { const m = mine[k], r = ref[k]; if (r == null) return null; const e = m == null ? null : (k === 'rm' || k === 'cm' ? ang(m, r) : Math.abs(m - r));
        return `<tr><td style="text-align:left">${l}</td><td>${m ?? '–'}</td><td>${k === 'rm' || k === 'cm' ? r3(r) : Math.round(r)}</td><td>${e == null ? '–' : e <= tol[k] ? '✅' : `❌ (${Math.round(e)})`}</td></tr>`; }).filter(Boolean);
      const ok = F.filter(([k]) => mine[k] != null && ref[k] != null && (k === 'rm' || k === 'cm' ? ang(mine[k], ref[k]) : Math.abs(mine[k] - ref[k])) <= tol[k]).length;
      $('#pf-out').insertAdjacentHTML('afterbegin', `<h4>🎲 Résultat de l'exercice : ${ok}/${F.length}</h4><table class="legs"><tr><th>Valeur</th><th>Toi</th><th>Calcul</th><th>Écart</th></tr>${rows.join('')}</table>
        <p class="meta">Tolérances : ±5° pour la route et le cap, ±2 NM, ±3 min, ±3 L, ±200 ft. Temps et carburant du site : roulage, montée et vent prévu compris.</p>`);
    });
  }

  // ================================================================== compléments de préparation
  const vacAt = (id) => (VAC && VAC.data && VAC.data[id]) || null;
  // temps (min) d'une branche pour une vitesse propre et un vent donnés (même formule que le calcul des branches)
  // dérive (°) et vitesse sol (kt) pour une route vraie, un vent et une vitesse propre
  function windTriangle(tc, w, tas) {
    const ws = w && w.spd != null ? w : { dir: 0, spd: 0 }, wa = rad(ws.dir - tc);
    const wca = deg(Math.asin(Math.max(-1, Math.min(1, (ws.spd / tas) * Math.sin(wa)))));
    return { wca, gs: Math.max(20, tas * Math.cos(rad(wca)) - ws.spd * Math.cos(wa)) };
  }
  function legMinutes(dist, tc, w, tas) { return dist / windTriangle(tc, w, tas).gs * 60; }
  // régime le plus proche d'une altitude (types dont les régimes sont nommés « 5500 ft - … »), sinon celui choisi
  function regimeFor(T, alt, rg) {
    const rs = T.regimes.filter((r) => regFt(r.name) != null);
    if (!rs.length) return rg;
    const best = Math.min(...rs.map((r) => Math.abs(regFt(r.name) - alt))), near = rs.filter((r) => Math.abs(regFt(r.name) - alt) === best);
    return near.find((r) => rg && r.name.split(' - ')[1] === rg.name.split(' - ')[1]) || near[0];
  }

  // ---------- règle semi-circulaire (au-dessus de 3000 ft sol) : Rm 000-179 -> milliers impairs + 500, 180-359 -> pairs + 500
  const semiOk = (ft, tm) => (ft - 500) % 1000 === 0 && ((ft - 500) / 1000) % 2 === (tm < 180 ? 1 : 0);
  console.assert(semiOk(3500, 90) && semiOk(4500, 270) && !semiOk(4500, 90) && !semiOk(5000, 90), 'semiOk');
  function semiCircular(b) {
    const out = []; let acc = 0;
    for (const lg of b.legs) {
      const seg = (b.profile || []).filter((p) => p.along >= acc - .5 && p.along <= acc + lg.dist + .5);
      const lowGround = seg.length ? Math.min(...seg.map((p) => p.ft)) : 0;
      acc += lg.dist;
      const ft = lg.ft || b.f.ft;
      if (ft - lowGround <= 3000 || semiOk(ft, lg.tm)) continue;
      const floor = Math.max(lg.safe ? lg.safe.alt : 0, 3500);
      let sug = null; for (let a = 3500; a <= 12500; a += 1000) if (a >= floor && semiOk(a, lg.tm)) { sug = a; break; }
      out.push({ lg, sug, east: lg.tm < 180 });
    }
    return out;
  }

  // ---------- comparaison d'altitudes de croisière (vent Open-Meteo déjà téléchargé : même requête, en cache)
  async function altitudeCompare(b, mids, depElev) {
    if (!b.winds) return null;
    const times = b.winds.map((w) => w.at), maxSafe = Math.max(0, ...b.legs.map((l) => (l.safe ? l.safe.alt : 0)));
    const rows = [];
    for (const alt of [...new Set([2500, 3500, 4500, 5500, 6500, 7500, b.f.ft])].sort((x, y) => x - y)) {
      const ws = await windsAloft(mids, alt, times), rg = regimeFor(b.f.T, alt, b.f.rg), cl = climbExtra(b.f.T, alt, depElev, rg.tas, rg.ff);
      const cruise = b.legs.reduce((s, lg, i) => s + legMinutes(lg.dist, lg.tc, ws[i], rg.tas), 0);
      const min = Math.round(cruise) + cl.min;
      rows.push({ alt, min, fuel: Math.round(cruise * rg.ff / 60) + cl.fuel, low: alt < maxSafe, semi: b.legs.every((lg) => semiOk(alt, lg.tm)), rg: rg.name, cur: alt === b.f.ft });
    }
    const ok = rows.filter((r) => !r.low), best = ok.sort((x, y) => x.fuel - y.fuel || x.min - y.min)[0], cur = rows.find((r) => r.cur);
    return { rows: rows.sort((x, y) => x.alt - y.alt), best, cur, maxSafe };
  }

  // ---------- altitude optimale par branche : contraintes (relief, zones, espaces, NOTAM, nuages, givrage, règle semi-circulaire) puis moindre carburant
  const OPT_ALTS = []; for (let a = 1500; a <= 9500; a += 500) OPT_ALTS.push(a);
  // contraintes d'une branche : fonctions altitude -> null ou { why, hard } (hard = interdit / impossible, sinon point d'attention)
  function legConstraints(b, i, acc) {
    const lg = b.legs[i], end = acc + lg.dist, total = b.totDist, S = SPECIAL || {}, ck = [];
    const smp = routeSamples(b, 2).filter((x) => x.lg === lg);
    const prof = (b.profile || []).filter((p) => p.along >= acc - .5 && p.along <= end + .5);
    const groundIn = (poly) => Math.max(0, ...prof.filter((p) => inPoly(p.p, poly)).map((p) => p.ft));
    const lowGround = prof.length ? Math.min(...prof.map((p) => p.ft)) : 0;
    const band = (lo, up, why, hard, w, ph) => ck.push((a) => (a >= lo && a <= up ? { why, hard, w, ph } : null));
    if (lg.safe) band(-1e9, lg.safe.alt - 1, `relief ${lg.safe.terrain} ft (+1000 ft)`, true, 1e5);   // le relief passe avant tout le reste
    // montée (~400 ft/NM depuis le départ) et descente (~300 ft/NM, 3°, jusqu'à l'arrivée) ; 1500-2000 ft (intégration) toujours possibles
    const arr = b.legs[b.legs.length - 1].to, ae = A.aptByIcao[arr] ? +A.aptByIcao[arr].elev || 0 : 0;
    band(Math.max(2000, (b.depElev || 0) + 1000 + 400 * end) + 1, 1e9, `montée trop courte depuis ${b.legs[0].from}`, true, 0, true);
    band(Math.max(2000, ae + 1000 + 300 * (total - acc)) + 1, 1e9, `descente trop courte vers ${arr}`, true, 0, true);
    const mt = b.mountain && b.mountain.legs.find((x) => x.lg === lg);
    if (mt) band(-1e9, mt.minAlt - 1, `crêtes ${mt.hi.ft} ft${mt.wind && mt.wind.spd >= 20 ? ` avec vent ${Math.round(mt.wind.spd)} kt (+1500 ft)` : ''}`, true, 1e5);
    if (smp.some((x) => inPoly(x.p, PNP_CORE))) { const g = groundIn(PNP_CORE); band(-1e9, g + 3299, `cœur du Parc national (1000 m au-dessus de ${g} ft)`, true); }
    for (const z of S.zsm || []) if (smp.some((x) => inPoly(x.p, z.poly))) band(-1e9, z.ft - 1, `ZSM gypaète ${z.name} (survol au-dessus de ${z.ft} ft)`, true);
    for (const a of S.act || []) if (Math.min(...smp.filter((x) => x.along > 8 && x.along < total - 8).map((x) => distNm(x.p, [a.la, a.lo]))) <= 3) { const up = /^FL/.test(a.upper) ? +a.upper.replace(/\D/g, '') * 100 : parseInt(a.upper, 10) + (/ASFC|AGL/i.test(a.upper) ? groundIn([[a.la - .05, a.lo - .07], [a.la + .05, a.lo - .07], [a.la + .05, a.lo + .07], [a.la - .05, a.lo + .07]]) : 0); if (up) band(0, up + 500, `${a.kind} ${a.name} (jusqu'à ${a.upper})`, false); }
    // espaces contrôlés (classe A interdite au VFR, C / D / CTR sur clairance), hors 8 NM autour du départ et de l'arrivée de l'étape
    for (const s of (ASP && ASP.data) || []) {
      const cls = s.cls || '', ctl = /^[ACD]$/.test(cls) || s.kind === 'CTR'; if (!ctl) continue;
      const inside = smp.filter((x) => x.along > 8 && x.along < total - 8 && inPoly(x.p, s.poly)); if (!inside.length) continue;
      const g = isAgl(s.lower) || isAgl(s.upper) ? groundIn(s.poly) : 0, lo = (parseAlt(s.lower) ?? 0) + (isAgl(s.lower) ? g : 0), up = (parseAlt(s.upper) ?? 99999) + (isAgl(s.upper) ? g : 0);
      band(lo, up, `${s.name} classe ${cls || 'D'}${cls === 'A' ? ' (interdite au VFR)' : ' (clairance)'}`, cls === 'A');
    }
    // zones P / R / D traversées par la branche : P interdite, RTBA active interdite, R / D à vérifier
    for (const x of b.zones || []) {
      if (polyRouteDist(x.z.poly, [lg.a, lg.b]) > 0) continue;
      const r = x.z.rtba && (b.rtba || []).find((y) => y.z === x.z); if (x.z.rtba && !(r && r.conflict)) continue;
      if (x.z.sup && x.z.sup.active === false) continue;   // ZRT hors de ses créneaux
      if (x.act && x.act.st === 'inactive') continue;   // R / D hors de son horaire publié
      const g = isAgl(x.z.upper) ? groundIn(x.z.poly) : 0;
      band(parseAlt(x.z.lower) ?? 0, (parseAlt(x.z.upper) ?? 99999) + g, `${x.z.id} ${x.z.name}${x.z.rtba ? ' (AZBA active)' : x.z.type === 'P' ? ' (interdite)' : x.z.sup && x.z.sup.active ? ' (ZRT active)' : x.act && x.act.st === 'active' ? ` (active : ${x.act.why})` : ` (${x.act ? x.act.why : 'vérifier l\'activité'})`}`, x.z.type === 'P' || !!x.z.rtba || !!(x.z.sup && x.z.sup.active) || !!(x.act && x.act.st === 'active'));
    }
    // NOTAM qui touchent la branche : zones réglementées / ZRT (code Q « R… ») interdites, activités (« W… » : parachutage, drones, voltige…) et obstacles à noter ;
    // les autres (fréquences, services) n'ont rien à voir avec l'altitude, et ceux de la surface à l'illimité ne se contournent pas verticalement
    for (const e of [...(b.enroute || []), ...(b.obst || [])]) {
      const n = e.n, q = (n.q || '')[0]; if (!/[RWO]/.test(q) || e.along < acc - 1 || e.along > end + 1 || e.d > (n.r || 0) + 1 || n.lower == null || n.upper == null || (n.lower <= 0 && n.upper >= 999)) continue;
      band(n.lower * 100, n.upper * 100, `NOTAM ${n.ref} ${n.q === 'RTTT' ? 'renvoi à un SUP AIP (zones à lire)' : q === 'R' ? 'zone réglementée' : q === 'O' ? 'obstacle' : 'activité'} (${A.fl(n.lower)}-${A.fl(n.upper)})`, q === 'R' && n.q !== 'RTTT');
    }
    // nuages bas prévus (Open-Meteo) : 500 ft sous la base à basse altitude, 1000 ft au-dessus de 3000 ft / 1000 ft sol
    for (const p of (b.wxRoute && b.wxRoute.pts) || []) if (p.leg === i && p.low >= 50 && p.baseAmsl != null) ck.push((a) => (a > p.baseAmsl - (a <= Math.max(3000, (p.elevFt || 0) + 1000) ? 500 : 1000) ? { why: `nuages (base ~${p.baseAmsl} ft)`, hard: true } : null));
    // GRAMET : dans les nuages, givrage
    const cols = b.gramet && !b.gramet.err ? b.gramet.cols.filter((c) => c.along >= acc - 4 && c.along <= end + 4) : [];
    ck.push((a) => { for (const c of cols) { const v = grametAt(c, a); if (v && v.cc >= 50) return { why: v.T <= 0 && v.T >= -15 ? 'givrage (GRAMET)' : 'dans les nuages (GRAMET)', hard: true }; } return null; });
    ck.push((a) => (a - lowGround > 3000 && !semiOk(a, lg.tm) ? { why: 'règle semi-circulaire', hard: true } : null));
    return ck;
  }
  async function optimalAltitudes(b) {
    const T = b.f.T, times = b.winds ? b.winds.map((w) => w.at) : null;
    let acc = 0; const C = b.legs.map((lg, i) => { const c = legConstraints(b, i, acc); acc += lg.dist; return c; });
    // coût de chaque branche à chaque altitude : carburant (vent à l'altitude) + 1000 par interdiction + 6 par point d'attention
    const tab = [];
    for (const alt of OPT_ALTS) {
      const ws = times ? await windsAloft(b.mids, alt, times) : [], rg = regimeFor(T, alt, b.f.rg);
      tab.push(b.legs.map((lg, i) => {
        const hits = C[i].map((f) => f(alt)).filter(Boolean), hard = hits.filter((h) => h.hard), min = legMinutes(lg.dist, lg.tc, ws[i], rg.tas);
        const wt = (hs) => hs.reduce((s, h) => s + (h.w || (h.hard ? 1000 : 6)), 0), cruise = hits.filter((h) => !h.ph);
        return { alt, w: ws[i], min, fuel: min * rg.ff / 60, hard, soft: hits.filter((h) => !h.hard), cost: min * rg.ff / 60 + wt(hits), costU: min * rg.ff / 60 + wt(cruise), hardU: cruise.filter((h) => h.hard).length, whyU: cruise.filter((h) => h.hard).map((h) => `${lg.from}→${lg.to} ${h.why}`), rg };
      }));
    }
    const climbL = (from, to) => (to > from ? climbExtra(T, to, from, b.f.tas, b.f.ff).fuel - TAXI_L : 0);
    // programmation dynamique sur les branches : montée comptée, 1 L de pénalité par changement d'altitude (évite les escaliers)
    let best = OPT_ALTS.map((a, j) => ({ cost: tab[j][0].cost + climbL(b.depElev || 0, a), path: [j] }));
    for (let i = 1; i < b.legs.length; i++) best = OPT_ALTS.map((a, j) => { const p = best.map((x, k) => ({ x, c: x.cost + climbL(OPT_ALTS[k], a) + (k === j ? 0 : 1) })).sort((u, v) => u.c - v.c)[0]; return { cost: p.c + tab[j][i].cost, path: [...p.x.path, j] }; });
    const plan = best.sort((u, v) => u.cost - v.cost)[0].path.map((j, i) => tab[j][i]);
    // plancher : contraintes qui interdisent l'altitude la plus basse (relief…) ; plafond : celles qui interdisent la plus haute (nuages…) ;
    // une contrainte qui interdit les deux ne borne rien (elle est seulement signalée)
    const limits = (i) => {
      const col = tab.map((r) => r[i]), ws = (c) => c.hard.map((h) => h.why).filter((w) => w !== 'règle semi-circulaire');
      const lo = ws(col[0]), hi = ws(col[col.length - 1]), fl = lo.filter((w) => !hi.includes(w)), ce = hi.filter((w) => !lo.includes(w));
      const f = col.filter((c) => ws(c).some((w) => fl.includes(w))).pop(), c = col.find((x) => ws(x).some((w) => ce.includes(w)));
      return { floor: f && { alt: f.alt + 500, why: ws(f).find((w) => fl.includes(w)) }, ceil: c && { alt: c.alt - 500, why: ws(c).find((w) => ce.includes(w)) } };
    };
    const total = (cs) => ({ fuel: Math.round(cs.reduce((s, c) => s + c.fuel, 0)), min: Math.round(cs.reduce((s, c) => s + c.min, 0)), hard: cs.reduce((s, c) => s + c.hardU, 0), why: cs.flatMap((c) => c.whyU) });
    // altitude unique (celle du formulaire) : montée et descente déjà comptées par le log, donc ignorées ici
    const uni = OPT_ALTS.map((a, j) => ({ alt: a, cs: tab[j], cost: tab[j].reduce((s, c) => s + c.costU, 0) + climbL(b.depElev || 0, a) })).sort((u, v) => u.cost - v.cost)[0];
    const curJ = OPT_ALTS.indexOf(b.f.ft);
    return { plan: plan.map((c, i) => ({ ...c, lg: b.legs[i], ...limits(i) })), tot: total(plan), uni: { alt: uni.alt, ...total(uni.cs) }, cur: curJ >= 0 ? total(tab[curJ]) : null, noWind: !times };
  }
  if (TYPES['R3000-180']) { const T = TYPES['R3000-180'], rg = T.regimes[T.defaultRegime];
    optimalAltitudes({ f: { T, rg, tas: rg.tas, ff: rg.ff, ft: 4500 }, legs: [{ from: 'A', to: 'B', dist: 20, tc: 90, tm: 90, a: [43, -0.5], b: [43, -0.06], safe: { alt: 3000, terrain: 2000 } }], totDist: 20, winds: null, profile: [], zones: [], mids: [], depElev: 600 })
      .then((o) => console.assert(o.plan[0].alt === 3000 && o.plan[0].floor.alt === 3000 && /relief/.test(o.plan[0].floor.why) && o.uni.alt === 3000, 'optimalAltitudes : relief puis le plus bas', o)); }
  function optAltHtml(b, sfx = '') {
    const o = b.optAlt; if (!o) return '';
    const d = o.cur ? o.cur.fuel - o.uni.fuel : null;
    return `<h4>🎯 Altitude optimale par branche</h4>
      <table class="legs"><tr><th>Branche</th><th>Altitude</th><th>Vent</th><th>Plancher</th><th>Plafond</th><th>À noter</th></tr>
      ${o.plan.map((c) => `<tr${c.hard.length ? ' style="color:#ff6b6b"' : ''}><td>${esc(c.lg.from)}→${esc(c.lg.to)}</td><td><b>${c.hard.length ? '⛔ impossible' : c.alt + ' ft'}</b></td><td>${c.w ? `${r3(c.w.dir)}/${Math.round(c.w.spd)}` : '–'}</td>
        <td style="text-align:left">${c.floor ? `${c.floor.alt} ft : ${esc(c.floor.why)}` : '–'}</td><td style="text-align:left">${c.ceil ? `${c.ceil.alt} ft : ${esc(c.ceil.why)}` : '9500 ft'}</td>
        <td style="text-align:left">${[...c.hard.map((h) => '⛔ ' + h.why), ...c.soft.map((h) => h.why)].map(esc).join(' · ') || '✅'}</td></tr>`).join('')}</table>
      ${o.plan.filter((c) => c.hard.length).map((c) => `<div class="warn">⛔ ${esc(c.lg.from)}→${esc(c.lg.to)} : aucune altitude entre 1500 et 9500 ft ne respecte toutes les contraintes (${esc(c.hard.map((h) => h.why).join(', '))}) — modifier la route pour contourner, ou reporter.</div>`).join('')}
      <p class="meta">Profil conseillé : <b>${o.plan.map((c) => (c.hard.length ? '⛔' : c.alt)).join(' → ')} ft</b> (${o.tot.fuel} L de croisière, ${hhmm(o.tot.min)}).
        ${o.uni.hard ? `Altitude unique la moins contrainte : <b>${o.uni.alt} ft</b>, mais ⛔ ${esc(o.uni.why.join(' ; '))} — préférer le profil par branche.` : `Altitude unique conseillée : <b>${o.uni.alt} ft</b> (${o.uni.fuel} L, ${hhmm(o.uni.min)})${o.cur && o.uni.alt !== b.f.ft ? `, contre ${o.cur.fuel} L à ${b.f.ft} ft${d > 0 ? ` (−${d} L)` : ''}${o.cur.hard ? ` et ${o.cur.hard} contrainte(s) non respectée(s) à ${b.f.ft} ft` : ''}` : ''}.
        ${o.uni.alt !== b.f.ft ? `<button class="btn" id="pf-optalt${sfx}" data-ft="${o.uni.alt}">Recalculer à ${o.uni.alt} ft</button>` : ''}`}
        ${!o.plan.some((c) => c.hard.length) && (!b.stage || b.stage === 1) && o.plan.some((c) => c.alt !== (c.lg.ft || b.f.ft)) ? `<button class="btn" id="pf-optleg${sfx}" data-legft="${o.plan.map((c) => c.alt).join(' ')}">Appliquer le profil par branche</button>` : ''}</p>
      <p class="meta">Calcul : relief +1000 ft, crêtes et vent, cœur du Parc national, ZSM, parachutage / voltige, espaces contrôlés (hors abords du départ et de l'arrivée), zones P / R / D, AZBA active, NOTAM à limites verticales, base des nuages prévue, GRAMET (nuages, givrage), règle semi-circulaire, puis le moins de carburant avec le vent${o.noWind ? ' (vent indisponible à cette date : sans vent)' : ''}, montée comprise.
        Les SUP AIP n'ont pas de limites verticales dans les données : les lire dans la liste. Choix final au pilote (TEMSI, WINTEM, carte OACI).</p>`;
  }

  // ---------- vent traversier aux terrains (meilleure piste), rafales comprises : METAR si vol dans les 2 h, sinon prévision le long de la route
  function crossWinds(b) {
    const pts = (b.wxRoute && b.wxRoute.pts) || [], max = (b.f.T.speeds || {})['Vw 90° max'] || null;
    return [b.depInfo, b.arrInfo, b.altInfo].filter((t) => t && t.rw && t.rw.best.cross != null).map((t) => {
      const fcG = t.role === 'DÉPART' ? (pts[0] || {}).gust : (pts[pts.length - 1] || {}).gust, wspd = Math.hypot(t.rw.best.head || 0, t.rw.best.cross || 0);
      const gust = t.wxSrc === 'METAR' && t.m && t.m.wgst ? +t.m.wgst : fcG && fcG > wspd + 5 ? fcG : null;
      return { t, qfu: t.rw.best.qfu, head: t.rw.best.head, cross: t.rw.best.cross, gust, crossG: gust && wspd ? t.rw.best.cross * gust / wspd : t.rw.best.cross, max };
    });
  }
  console.assert((() => { const t = { id: 'X', role: 'ARRIVÉE', wxSrc: 'prévision', rw: { best: { qfu: 90, head: 10, cross: 10 } } };
    const r = crossWinds({ f: { T: { speeds: { 'Vw 90° max': 22 } } }, wxRoute: { pts: [{ gust: 28 }] }, depInfo: { rw: null }, arrInfo: t })[0]; return Math.round(r.crossG) === 20 && r.gust === 28; })(), 'crossWinds rafales');
  function crossHtml(b) {
    const xs = crossWinds(b); if (!xs.length) return '';
    return `<p class="meta">💨 Vent traversier : ${xs.map((x) => `<span style="color:${x.max && x.crossG > x.max ? '#ff6b6b' : x.max && x.crossG >= x.max * .8 ? '#ff9f0a' : 'inherit'}">${esc(x.t.id)} piste ${x.qfu} : ${Math.round(x.cross)} kt${x.gust ? ` (${Math.round(x.crossG)} en rafale)` : ''}${x.head != null ? `, ${x.head >= 0 ? 'face' : 'arrière'} ${Math.abs(Math.round(x.head))} kt` : ''}</span>`).join(' · ')}${xs[0].max ? ` — limite démontrée ${xs[0].max} kt` : ' — limite démontrée non renseignée pour cet avion'}.</p>`;
  }

  // ---------- repères visuels par branche : villes, autoroutes, rivières, lacs, avec la minute de passage et le côté
  function landmarksOf(b) {
    const D = LANDM || { towns: [], mw: {}, rv: {}, lk: [] };
    return b.legs.map((lg) => {
      const la0 = Math.min(lg.a[0], lg.b[0]) - .1, la1 = Math.max(lg.a[0], lg.b[0]) + .1, lo0 = Math.min(lg.a[1], lg.b[1]) - .14, lo1 = Math.max(lg.a[1], lg.b[1]) + .14;
      const near = (la, lo) => la >= la0 && la <= la1 && lo >= lo0 && lo <= lo1;
      const at = (p) => { const r = routeDist(p, [lg.a, lg.b]); return r.along >= -0.5 && r.along <= lg.dist + 0.5 ? r : null; };
      const side = (p) => (((bearing(lg.a, p) - lg.tc + 540) % 360) - 180 > 0 ? 'à droite' : 'à gauche');
      const out = [];
      for (const [n, la, lo, pop] of D.towns) { if (!near(la, lo)) continue; const r = at([la, lo]); if (r && r.d <= (pop >= 20000 ? 4 : pop >= 5000 ? 2.5 : 1.2)) out.push({ k: '🏘️', n, along: r.along, d: r.d, side: r.d < .4 ? 'dessous' : side([la, lo]), w: Math.log10(pop) }); }
      const lines = (set, icon, w) => Object.entries(set).forEach(([n, pts]) => {
        const hits = pts.filter(([la, lo]) => near(la, lo)).map((p) => ({ p, r: at(p) })).filter((x) => x.r && x.r.d <= 1);
        if (!hits.length) return;
        const h = hits.sort((x, y) => x.r.d - y.r.d)[0];
        out.push({ k: icon, n: hits.length > 4 ? `${n} (longée)` : n, along: h.r.along, d: h.r.d, side: hits.length > 4 ? side(h.p) : 'croisée', w });
      });
      lines(D.mw, '🛣️', 5); lines(D.rv, '🌊', 4.6);
      for (const [n, la, lo, km2] of D.lk) { if (!near(la, lo)) continue; const r = at([la, lo]); if (r && r.d <= 3) out.push({ k: '💧', n, along: r.along, d: r.d, side: side([la, lo]), w: 4 + km2 / 50 }); }
      const top = out.sort((x, y) => y.w - x.w).slice(0, 8).sort((x, y) => x.along - y.along);
      return { lg, list: top.map((x) => ({ ...x, min: Math.max(0, Math.round(x.along / lg.gs * 60)) })) };
    });
  }
  function landmarksHtml(b) {
    const L0 = landmarksOf(b); if (!L0.some((x) => x.list.length)) return '';
    return `<details><summary><b>🏘️ Repères visuels par branche</b> (minute depuis le début de la branche)</summary>
      ${L0.map((x) => `<p class="meta" style="margin:2px 0"><b>${esc(x.lg.from)}→${esc(x.lg.to)}</b> : ${x.list.map((t) => `${t.k} ${t.min}' ${esc(t.n)} <small>(${t.side}${t.side === 'croisée' || t.side === 'dessous' ? '' : `, ${t.d.toFixed(1)} NM`})</small>`).join(' · ') || 'peu de repères (campagne)'}</p>`).join('')}
      <p class="meta">Villes de plus de 1500 habitants, autoroutes, rivières principales et lacs (OpenStreetMap). À compléter avec la carte OACI (châteaux d'eau, lignes HT, voies ferrées).</p></details>`;
  }

  // ---------- repères évidents le long de la route directe -> points tournants suggérés (22) ou itinéraire « élève » (6)
  // pas : un point tous les ~step NM, à moins de dev NM de la route ; priorité aux grandes villes, lacs, croisements d'autoroutes
  function landmarkRoute(b, step = 17, dev = 3) {
    const D = LANDM || { towns: [] }, a = b.pts[0], z = b.pts[b.pts.length - 1], tot = distNm(a, z), tc = bearing(a, z);
    if (tot < step * 1.4) return [];
    const cands = [];
    for (const [n, la, lo, pop] of D.towns) { if (pop < 3000) continue; const r = routeDist([la, lo], [a, z]); if (r.d <= dev && r.along > 5 && r.along < tot - 5) cands.push({ n, p: [la, lo], along: r.along, d: r.d, w: Math.log10(pop) - r.d * .15 }); }
    for (const [n, la, lo, km2] of D.lk || []) { const r = routeDist([la, lo], [a, z]); if (r.d <= dev + 1 && r.along > 5 && r.along < tot - 5) cands.push({ n, p: [la, lo], along: r.along, d: r.d, w: 4.5 + km2 / 40 }); }
    const out = [];
    for (let k = 1; k * step < tot - step * 0.5; k++) {
      const c = cands.filter((x) => Math.abs(x.along - k * step) <= step * 0.4 && !out.includes(x)).sort((x, y) => y.w - x.w)[0];
      if (c) out.push(c);
    }
    return out.map((c) => ({ ...c, tok: `${c.p[0].toFixed(4)}/${c.p[1].toFixed(4)}` }));
  }
  function landmarkHtml(b, sfx) {
    if (b.stage > 1 || b.legs.length > 4) return '';
    const L1 = landmarkRoute(b), L2 = landmarkRoute(b, 12, 6);
    if (!L1.length && !L2.length) return '';
    const one = (L0, id, lbl) => L0.length ? `<p class="meta">${lbl} : ${L0.map((c) => `<b>${esc(c.n)}</b> (${c.along.toFixed(0)} NM)`).join(' → ')} <button class="btn" data-wps="${esc(L0.map((c) => c.tok).join(' '))}" id="${id}${sfx}">Utiliser</button></p>` : '';
    return `<details><summary><b>📍 Points tournants sur des repères évidents</b></summary>
      ${one(L1, 'pf-lmk1', '22 · Repères tous les ~17 NM, à moins de 3 NM de la route directe')}
      ${one(L2, 'pf-lmk2', 'Itinéraire « élève » : un repère tous les ~12 NM, quitte à s\'écarter jusqu\'à 6 NM')}
      <p class="meta">Villes de plus de 3000 habitants et grands lacs. « Utiliser » remplace les points tournants du formulaire et recalcule (points libres PT1, PT2… dans le log).</p></details>`;
  }
  // ---------- contrôle de l'estime par branche (23)
  function deadReckoning(b) {
    return landmarksOf(b).map((x) => {
      const t0 = x.lg.eto.getTime() - x.lg.min * 6e4, cps = x.list.filter((t) => t.min >= 3).reduce((l, t) => (l.length < 3 && (!l.length || t.min - l[l.length - 1].min >= 4) ? [...l, t] : l), []);   // repères espacés d'au moins 4 min
      return { lg: x.lg, t0, cps: cps.map((c, i) => ({ ...c, at: new Date(t0 + c.min * 6e4), next: cps[i + 1] })) };
    });
  }
  function drHtml(b) {
    const R = deadReckoning(b); if (!R.some((x) => x.cps.length)) return '';
    return `<details><summary><b>⏱️ Contrôle de l'estime</b> (repères attendus et conduite à tenir)</summary>
      ${R.map((x) => `<p class="meta" style="margin:3px 0"><b>${esc(x.lg.from)}→${esc(x.lg.to)}</b> · Cm ${r3(x.lg.hm)}° · ${x.lg.min} min${x.cps.length ? '<br>' + x.cps.map((c) => `${utc(c.at)} (+${c.min}') : ${c.k} ${esc(c.n)} ${esc(c.side)} — si rien à +2 min : vérifier cap, conservateur et vent ; à +5 min : ${c.next ? `chercher ${esc(c.next.n)} (+${c.next.min}')` : `revenir au dernier repère sûr`} ou demander l'aide du SIV`).join('<br>') : ' — peu de repères : tenir le cap et le temps, demander l\'aide du SIV en cas de doute'}</p>`).join('')}
      <p class="meta">Heures UTC calculées au vent prévu. Garder la carte en main : ces repères complètent l'estime, ils ne la remplacent pas.</p></details>`;
  }
  // ---------- comparaison de 2 ou 3 routes (21) : directe, VFR facile, par repères
  async function compareRoutes() {
    const prog = $('#pf-prog');
    try {
      const f = readForm(), b0 = lastTrip && lastTrip[0]; if (!b0) { prog.textContent = 'Calcule d\'abord la route.'; return; }
      const L0 = landmarkRoute(b0, 12, 6), variants = [['Directe', { ...f, wps: '', avoid: 'p+rtba', stages: '', rt: false }], ['VFR facile', { ...f, wps: '', avoid: 'easy', stages: '', rt: false }]];
      if (L0.length) variants.push(['Par repères', { ...f, wps: L0.map((c) => c.tok).join(' '), avoid: 'p+rtba', stages: '', rt: false, exit: 'none', entry: 'auto' }]);
      const res = [];
      for (const [n, fv] of variants) { prog.textContent = `Comparaison des routes : ${n}…`; const t = await buildTrip(fv); res.push([n, fv, t[0]]); }
      const row = (l, f2) => `<tr><td style="text-align:left">${l}</td>${res.map(([, , b]) => `<td>${f2(b)}</td>`).join('')}</tr>`;
      $('#pf-out').insertAdjacentHTML('afterbegin', `<h4>🗺️ Comparaison des routes</h4><table class="legs"><tr><th></th>${res.map(([n]) => `<th>${esc(n)}</th>`).join('')}</tr>
        ${row('Distance', (b) => b.totDist.toFixed(0) + ' NM')}${row('Temps', (b) => hhmm(b.totMin))}${row('Carburant', (b) => b.totFuel + ' L')}
        ${row('Espaces traversés à l\'altitude prévue', (b) => (b.vprofile ? b.vprofile.conflicts.length : '?'))}${row('Zones R / D / ZRT traversées', (b) => b.zones.filter((x) => x.crossed && x.below && x.z.type !== 'P').length)}
        ${row('Relief max', (b) => (b.vprofile ? b.vprofile.maxTer + ' ft' : '?'))}${row('Plus loin d\'un terrain', (b) => Math.max(...diversions(b).map((x) => x.worst.d)).toFixed(0) + ' NM')}
        ${row('Branches sans altitude possible', (b) => (b.optAlt ? b.optAlt.plan.filter((c) => c.hard.length).length : '?'))}
        <tr><td></td>${res.map(([n], i) => `<td><button class="btn" data-route="${i}">Choisir</button></td>`).join('')}</tr></table>
        <p class="meta">Même avion, même altitude, même heure. « Choisir » remplit le formulaire avec cette route et recalcule.</p>`);
      document.querySelectorAll('#pf-out [data-route]').forEach((el) => el.addEventListener('click', () => { const fv = res[+el.dataset.route][1]; $('#pf-wps').value = fv.wps; $('#pf-avoid').value = fv.avoid; if (fv.exit === 'none') $('#pf-exit').value = 'none'; run(false); }));
      prog.textContent = '';
    } catch (e) { console.error(e); prog.textContent = e.message || String(e); }
  }

  // ---------- terrains de déroutement le long de la route
  const DIVERT_NM = 15;
  function diversions(b) {
    const finesse = b.f.T.glide || 9;
    return b.legs.map((lg) => {
      const n = Math.max(2, Math.ceil(lg.dist / 2)), near = new Map(); let worst = { d: 0, at: 0 };
      for (let k = 0; k <= n; k++) {
        const p = destPt(lg.a, lg.tc, lg.dist * k / n);
        let best = null;
        for (const a of A.APTS) { const d = distNm(p, [a.la, a.lo]); if (!best || d < best.d) best = { a, d }; if (d <= 10 && (!near.has(a.icao) || near.get(a.icao).d > d)) near.set(a.icao, { a, d, along: lg.dist * k / n }); }
        if (best && best.d > worst.d) worst = { d: best.d, at: lg.dist * k / n, a: best.a };
      }
      const glide = lg.safe ? Math.max(0, (b.f.ft - lg.safe.terrain) * finesse / 6076) : null;
      return { lg, list: [...near.values()].filter((x) => x.a.icao !== lg.from && x.a.icao !== lg.to).sort((x, y) => x.along - y.along), worst, glide };
    });
  }
  // météo d'un terrain de déroutement à l'heure où l'on passe à côté (10)
  function divWx(b, t) {
    const pt = b.dayWx && b.dayWx.pts.find((x) => x.id === t.a.icao); if (!pt) return null;
    const lgStart = b.legs.slice(0, b.legs.indexOf(t.lg)).reduce((s, l) => s + l.dist, 0);
    return wxAt(pt, routePosAt(b, lgStart + t.along).at);
  }
  function diversionsHtml(b) {
    const dv = diversions(b);
    let ok = 0, all = 0;
    const tag = (x, t) => { const w = divWx(b, { ...t, lg: x.lg }); if (!w) return ''; all++; if (w.lv < 2) ok++;
      return ` <span title="${esc(WXTXT[w.lv])}${w.why.length ? ' : ' + esc(w.why.join(', ')) : ''}" style="color:${WXCOL[w.lv]}">●</span>`; };
    const html = dv.map((x) => `<p class="meta" style="margin:2px 0"><b>${esc(x.lg.from)}→${esc(x.lg.to)}</b> : ${x.list.length ? x.list.slice(0, 6).map((t) => `${esc(t.a.icao)} ${esc(t.a.name)} (${t.d.toFixed(0)} NM, à ${t.along.toFixed(0)} NM)${tag(x, t)}`).join(' · ') : 'aucun terrain à moins de 10 NM'}
        — terrain le plus éloigné : <b>${x.worst.d.toFixed(0)} NM</b>${x.glide != null ? ` (plané ≈ ${x.glide.toFixed(0)} NM depuis ${b.f.ft} ft)` : ''}</p>
        ${x.worst.d > DIVERT_NM ? `<div class="warn">⚠️ ${esc(x.lg.from)}→${esc(x.lg.to)} : jusqu'à ${x.worst.d.toFixed(0)} NM de tout terrain (à ${x.worst.at.toFixed(0)} NM de ${esc(x.lg.from)}) — repérer les champs utilisables sur la carte.</div>` : ''}`).join('');
    return `<h4>Terrains de déroutement le long de la route</h4>${html}
      ${all ? `<p class="meta">● météo prévue au terrain à l'heure de passage (vert favorable, orange marginal, rouge défavorable) : <b>${ok} sur ${all}</b> restent utilisables. Survole le point pour le détail.</p>` : ''}`;
  }


  // ---------- charge restante et graphique de centrage
  function loadMargins(b) {
    const mb = b.mb, T = b.f.T, d = T.fuel.density, arm0 = T.fuel.tanks[0].arm, bagArm = b.f.ac.bagArm || T.arms.bag;
    const margin = T.mtow - mb.mass, capLeft = Math.max(0, (T.fuel.tanks[0].cap || 0) - b.f.fuel);
    const ok = (dm, arm) => mb.cg == null || arm == null || mb.inEnv((mb.mom + dm * arm) / (mb.mass + dm), mb.mass + dm);
    let fuel = 0; while (fuel + 1 <= capLeft && (fuel + 1) * d <= margin && ok((fuel + 1) * d, arm0)) fuel++;
    let bag = 0; while (bag + 1 <= margin && ok(bag + 1, bagArm)) bag++;
    return { margin: Math.round(margin), fuel, bag, limitFuel: fuel < capLeft ? ((fuel + 1) * d > margin ? 'masse max' : 'centrage') : 'réservoir plein', limitBag: bag < Math.floor(margin) ? 'centrage' : 'masse max' };
  }
  function cgSvg(b) {
    const env = b.mb.env; if (!env || b.mb.cg == null) return '';
    const xs = env.map((p) => p[0]), ms = env.map((p) => p[1]).filter((m) => m > 0);
    const x0 = Math.min(...xs) - .02, x1 = Math.max(...xs) + .02, m0 = Math.min(...ms, b.landMass) - 60, m1 = b.f.T.mtow + 40, W = 320, H = 170;
    const X = (x) => 30 + (x - x0) / (x1 - x0) * (W - 40), Y = (m) => H - 20 - (Math.max(m, m0) - m0) / (m1 - m0) * (H - 30);
    const pt = (cg, m, l, c) => `<circle cx="${X(cg)}" cy="${Y(m)}" r="4" fill="${c}"/><text x="${X(cg) + 6}" y="${Y(m) + 4}" font-size="10" fill="currentColor">${l}</text>`;
    const col = (cg, m) => (b.mb.inEnv(cg, m) ? '#2ecc40' : '#ff4136');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:360px;display:block" role="img" aria-label="Enveloppe de centrage">
      <polygon points="${env.map(([x, m]) => `${X(x)},${Y(m)}`).join(' ')}" fill="rgba(0,150,220,.15)" stroke="#39c" />
      <line x1="${X(b.mb.cg)}" y1="${Y(b.mb.mass)}" x2="${X(b.mb.ldgCg)}" y2="${Y(b.landMass)}" stroke="currentColor" stroke-dasharray="3 3"/>
      ${pt(b.mb.cg, b.mb.mass, 'Déc.', col(b.mb.cg, b.mb.mass))}${b.mb.ldgCg != null ? pt(b.mb.ldgCg, b.landMass, 'Att.', col(b.mb.ldgCg, b.landMass)) : ''}
      <text x="30" y="${H - 5}" font-size="9" fill="currentColor">${x0.toFixed(2)} m</text><text x="${W - 40}" y="${H - 5}" font-size="9" fill="currentColor">${x1.toFixed(2)} m</text>
      <text x="2" y="${Y(b.f.T.mtow) + 3}" font-size="9" fill="currentColor">${b.f.T.mtow}</text></svg>`;
  }
  function loadHtml(b) {
    const L = loadMargins(b);
    return `<h4>Masse, centrage et charge restante</h4>
      <p class="meta">Marge sous la masse max : <b>${L.margin} kg</b>. On peut encore ajouter <b>${L.fuel} L</b> de carburant (limite : ${L.limitFuel}) ou <b>${L.bag} kg</b> de bagages (limite : ${L.limitBag}${b.mb.cg == null ? ', centrage non calculé' : ''} ; vérifier aussi la charge max de la soute).</p>
      ${cgSvg(b)}`;
  }

  // ---------- check-list avant départ (mémorisée sur l'appareil, imprimée dans le PDF)
  const CHECK_ITEMS = ['Documents avion : CEN / CDN, certificat d\'immatriculation, assurance, licence station, carnet de route, manuel de vol',
    'Documents pilote : licence et qualification valides, certificat médical, pièce d\'identité', 'Avion réservé, potentiel et carnet de route vérifiés',
    'Météo consultée (TEMSI, WINTEM, METAR / TAF, aviation.meteo.fr)', 'NOTAM, SUP AIP et AZBA consultés (SOFIA)', 'Carburant vérifié (quantité, purge) et huile',
    'Masse et centrage vérifiés', 'Terrains : VAC à jour, PPR / horaires, carburant disponible', 'Plan de vol déposé (si requis) ou prévenu quelqu\'un', 'Visite pré-vol faite'];
  const checkKey = (b) => { const b0 = (b.trip || [b])[0]; return `check.${b0.f.ac.reg}.${b0.f.dep}.${b0.depT.toISOString().slice(0, 10)}`; };
  function checkHtml(b, sfx) {
    const st = store.get(checkKey(b), []);
    return `<h4>Check-list avant départ</h4><div class="checklist" id="pf-check${sfx}">${CHECK_ITEMS.map((t, i) => `<label style="display:block;margin:2px 0"><input type="checkbox" data-i="${i}" ${st[i] ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>`;
  }

  // ---------- coût du vol et comparaison des avions du club
  const feeNum = (id) => { const f = A.feeFor ? A.feeFor(id) : null, m = f && String(f.tarif).replace(',', '.').match(/(\d+(?:\.\d+)?)/); return m ? +m[1] : 0; };
  const seatsOf = (T) => T.seats || 4;
  function tripCost(trip) {
    const f = trip[0].f, min = trip.reduce((s, b) => s + b.totMin, 0), fees = trip.reduce((s, b) => s + feeNum(b.f.arr), 0);
    const price = f.ac.price || (FLEET.find((x) => x.reg === f.ac.baseReg) || {}).price;
    const occ = 1 + (f.m2 > 0 ? 1 : 0) + (f.m3 > 0 ? 2 : 0);
    const cmp = FLEET.filter((ac) => ac.price).map((ac) => {
      const T = TYPES[ac.type], rg = regimeFor(T, f.ft, T.regimes[T.defaultRegime]);
      let tot = 0, maxNeed = 0;
      for (const b of trip) {
        const cl = climbExtra(T, f.ft, 0, rg.tas, rg.ff), m = b.legs.reduce((s, lg) => s + legMinutes(lg.dist, lg.tc, lg.wind, rg.tas), 0) + cl.min;
        tot += m; maxNeed = Math.max(maxNeed, Math.round(m * rg.ff / 60) + cl.fuel + Math.round(f.res / 60 * rg.ff) + (b.altLeg ? Math.round(b.altLeg.min * rg.ff / 60) : 0));
      }
      const cap = T.fuel.tanks.reduce((s, t) => s + (t.cap || 0), 0), why = [];
      if (occ > seatsOf(T)) why.push(`${seatsOf(T)} places`);
      if (maxNeed > cap) why.push(`autonomie (${maxNeed} L requis, ${cap} L)`);
      const mass = (ac.empty || 0) + f.m1 + f.m2 + f.m3 + f.m4 + Math.min(cap, maxNeed) * T.fuel.density;
      if (mass > T.mtow) why.push(`masse ${Math.round(mass)} kg > ${T.mtow} kg`);
      return { ac, T, min: Math.round(tot), cost: Math.round(tot / 60 * ac.price + fees), why };
    }).sort((x, y) => (x.why.length - y.why.length) || x.cost - y.cost);
    return { min, fees, price, cost: price ? Math.round(min / 60 * price + fees) : null, occ, cmp };
  }
  function costHtml(trip) {
    const c = tripCost(trip), n = Math.max(1, trip[0].f.share || 1), best = c.cmp.find((x) => !x.why.length);
    return `<h4>Coût du vol</h4>
      <p class="meta">${esc(trip[0].f.ac.reg)} : ${hhmm(c.min)} de vol${c.price ? ` × ${c.price} €/h` : ' (tarif horaire non renseigné)'}${c.fees ? ` + ${c.fees} € de taxes d'atterrissage` : ''} = <b>${c.cost != null ? c.cost + ' €' : '?'}</b>${c.cost != null && n > 1 ? `, soit <b>${Math.round(c.cost / n)} € par personne</b> (${n})` : ''}. Temps de vol estimé (hors roulage), taxes connues seulement.</p>
      ${best ? `<div class="okk">💶 Avion le moins cher pour ce vol : <b>${esc(best.ac.reg)}</b> (${esc(best.T.label)}) — ${hhmm(best.min)}, ${best.cost} €${c.cost != null && best.ac.reg !== trip[0].f.ac.baseReg ? `, soit ${c.cost - best.cost} € de moins` : ''}.</div>` : ''}
      <table class="legs"><tr><th>Avion</th><th>Temps</th><th>Coût</th><th>Possible ?</th></tr>
      ${c.cmp.map((x) => `<tr><td>${esc(x.ac.reg)} ${esc(x.T.label)}</td><td>${hhmm(x.min)}</td><td>${x.cost} €</td><td>${x.why.length ? '❌ ' + esc(x.why.join(', ')) : '✅'}</td></tr>`).join('')}</table>
      <p class="meta">Comparaison au régime le plus proche de ${trip[0].f.ft} ft, avec le vent prévu ; centrage et carburant disponible aux escales non vérifiés pour les autres avions.</p>
      ${costDetailHtml(trip)}`;
  }
  // coût détaillé par étape (8) : heures de vol, taxes relevées, carburant acheté aux escales, partage ; export pour le club
  function costRows(trip) {
    const f = trip[0].f, c = tripCost(trip), lp = +(f.fuelPrice || 0);
    return trip.map((b) => { const fee = A.feeFor ? A.feeFor(b.f.arr) : null, fn = feeNum(b.f.arr), fl = b.refuelL || 0;
      return { b, min: b.totMin, fly: c.price ? Math.round(b.totMin / 60 * c.price) : null, fee: fn, feeTxt: fee ? fee.tarif : 'non renseignée', fuelL: fl, fuelEur: lp && fl ? Math.round(fl * lp) : null }; });
  }
  function costDetailHtml(trip) {
    const R = costRows(trip), n = Math.max(1, trip[0].f.share || 1), tot = R.reduce((s, r) => s + (r.fly || 0) + r.fee + (r.fuelEur || 0), 0);
    return `<details><summary><b>💶 Coût détaillé par étape</b> — total ${tot} €${n > 1 ? `, ${Math.round(tot / n)} € par personne (${n})` : ''}</summary>
      <table class="legs"><tr><th>Étape</th><th>Temps</th><th>Heures de vol</th><th>Taxe à l'arrivée</th><th>Carburant pris</th></tr>
      ${R.map((r) => `<tr><td>${esc(r.b.f.dep)}→${esc(r.b.f.arr)}</td><td>${hhmm(r.min)}</td><td>${r.fly != null ? r.fly + ' €' : '?'}</td><td>${r.fee ? r.fee + ' €' : esc(r.feeTxt)}</td><td>${r.fuelL ? `${r.fuelL} L${r.fuelEur != null ? ` · ${r.fuelEur} €` : ''}` : '–'}</td></tr>`).join('')}</table>
      <p class="meta">Carburant acheté aux escales : avancé par le pilote, remboursement selon les règles du club (tarif horaire « carburant compris »). Prix au litre : champ « Prix du carburant aux escales ». Taxes : tableau du club ou relevé sur le site, sinon à demander au terrain.
        <button class="btn" id="pf-cost-csv">📤 Export pour le club (CSV)</button></p></details>`;
  }
  function costCsv(trip) {
    const f = trip[0].f, rows = [['Date', 'Avion', 'Pilote', 'Étape', 'Départ UTC', 'Arrivée UTC', 'Temps (min)', 'Heures de vol (€)', "Taxe d'atterrissage (€)", 'Carburant pris (L)', 'Carburant (€)']];
    costRows(trip).forEach((r) => rows.push([r.b.depT.toISOString().slice(0, 10), f.ac.reg, f.pil || '', `${r.b.f.dep}-${r.b.f.arr}`, utc(r.b.depT), utc(r.b.eta), r.min, r.fly ?? '', r.fee || '', r.fuelL || '', r.fuelEur ?? '']));
    return rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  }

  // ---------- fiche radio par étape (messages types, à adapter)
  const rwyNum = (qfu) => String(Math.round(qfu / 10) % 36 || 36).padStart(2, '0');   // QFU 128° -> piste 13
  const cityOf = (id) => ((A.aptByIcao[id] || {}).name || id).split(/ (?:Pyrénées|Pays|Île|Ile|Atlantique|Bretagne|Val|Le Sequestre|Dordogne|Brie|Seyresse)\b|[-–(]/)[0].trim();
  // points d'appel pour la clairance : 5 NM avant l'entrée dans un espace C / D / CTR traversé à l'altitude prévue
  function callPoints(b) {
    const v = b.vprofile; if (!v) return [];
    const pad = v.total / Math.max(1, v.profile.length - 1) / 2, seen = new Set();
    return v.conflicts.filter((sg) => /\((?:C|D)\)|CTR/.test(sg.name)).sort((x, y) => x.from - y.from).filter((sg) => { const k = sg.freq || sg.name; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((sg) => { const entry = Math.max(0, sg.from - pad); return { sg, entry, nm: Math.max(0, entry - 5), at: routePosAt(b, Math.max(0, entry - 5)).at }; });
  }
  function radioCard(b) {
    const f = b.f, reg = f.ac.reg, typ = f.T.label.replace(/^Robin /, '').split(/[ /]/)[0], pob = 1 + (f.m2 > 0 ? 1 : 0) + (f.m3 > 0 ? 2 : 0);
    const svc = (id) => { const l = ((vacAt(id) || {}).freqs || []).join(' | '), fr = (re) => { const m = l.match(re); return m ? m[1] : ''; };
      return { twr: fr(/TWR[^|]*?(\d{3}\.\d{2,3})/), gnd: fr(/(?:GND|SOL)[^|]*?(\d{3}\.\d{2,3})/), afis: fr(/AFIS[^|]*?(\d{3}\.\d{2,3})/), aa: fr(/A\/A[^|]*?(\d{3}\.\d{2,3})/) || '123.500', atis: /ATIS/.test(l) }; };
    const d = svc(f.dep), a = svc(f.arr), cd = cityOf(f.dep), ca = cityOf(f.arr), l0 = b.legs[0], lN = b.legs[b.legs.length - 1];
    const rows = [], add = (nm, phase, fq, msg) => rows.push({ nm, r: [`${phase} · ${utc(routePosAt(b, Math.min(nm, b.totDist)).at)}`, fq, msg] });
    if (d.gnd || d.twr) add(0, 'Mise en route / roulage', `${d.gnd || d.twr}`, `${cd} ${d.gnd ? 'Sol' : 'Tour'}, ${reg}, ${typ}, ${pob} POB, au parking${d.atis ? ", avec l'information" : ''}, VFR à destination de ${ca}, demandons le roulage.`);
    else add(0, 'Roulage', d.afis || d.aa, `${cd} ${d.afis ? 'Info' : 'auto-information'}, ${reg}, ${typ}, roule vers le point d'arrêt piste ${b.depInfo.rw ? rwyNum(b.depInfo.rw.best.qfu) : '..'}${d.afis ? ', pour un vol VFR à destination de ' + ca : ''}.`);
    if (d.twr) add(0.5, 'Sortie', d.twr, `${cd} Tour, ${reg}, ${/^[A-Z]{1,3}-[A-Z]+/.test(l0.to) ? `au point ${l0.to}` : 'quittons la zone'}, ${f.ft} ft, quittons la fréquence.`);
    const seen = new Set(), smp = routeSamples(b, 2);
    let acc = 0;
    b.legs.forEach((lg) => { lg.airspaces.filter((s) => s.call && s.freq && /TMA|CTR|CTA|SIV|RMZ|TMZ/.test(s.kind || '')).forEach((s) => {
      if (seen.has(s.call)) return; seen.add(s.call);
      const ent = (smp.find((x) => x.lg === lg && s.poly && inPoly(x.p, s.poly)) || { along: acc }).along;   // entrée dans l'espace ; appel 5 NM avant (SIV : à l'entrée)
      add(Math.max(lg.from === f.dep ? 1 : 0, ent - (/SIV/.test(s.kind) ? 0 : 5)), `En route (${s.name})`, String(s.freq).split(' / ')[0], `${s.call}, ${reg}, ${typ}, VFR de ${cd} à ${ca}, ${lg.from === f.dep ? 'au départ de ' + cd : 'à proximité de ' + lg.from}, ${f.ft} ft, transpondeur 7000, ${/SIV|INFO/i.test(s.call + s.kind) ? "demandons l'information de vol" : 'demandons le transit'}.`);
    }); acc += lg.dist; });
    callPoints(b).forEach((c) => add(c.nm, `Clairance ${c.sg.name} (vers ${c.nm.toFixed(0)} NM)`, String(c.sg.freq || 'voir carte').split(' / ')[0],
      `${reg}, ${typ}, ${pob} POB, VFR de ${cd} à ${ca}, à 5 NM de la limite de ${c.sg.name.replace(/ \(.\)$/, '')}, ${f.ft} ft, demandons le transit (entrée vers ${c.entry.toFixed(0)} NM).`));
    const ap = arrivalPlan(b), qfu = b.arrInfo.rw ? rwyNum(b.arrInfo.rw.best.qfu) : '..', main = /droite/.test(ap.side) ? ' main droite' : /gauche/.test(ap.side) ? ' main gauche' : '';
    if (a.twr) add(b.totDist - 5, 'Arrivée', a.twr, `${ca} Tour, ${reg}, ${typ}, ${/^[A-Z]{1,3}-[A-Z]+/.test(lN.from) ? `au point ${lN.from}` : `à 5 NM de ${ca}`}, ${f.ft} ft${a.atis ? ", avec l'information" : ''}, pour intégration.`);
    else {
      const who = `${ca} ${a.afis ? 'Info' : ''}`.trim();
      add(b.totDist - 5, 'Arrivée', a.afis || a.aa, `${who}${a.afis ? '' : ' (auto-information)'}, ${reg}, ${typ}, à 5 NM du terrain, ${ap.tdpFt} ft, pour intégration piste ${qfu}.`);
      add(b.totDist, 'Vent arrière', a.afis || a.aa, `${who}, ${reg}, vent arrière${main} piste ${qfu}, ${ap.tdpFt} ft${main ? '' : ' (côté du tour de piste : voir la VAC)'}.`);
      add(b.totDist, 'Finale', a.afis || a.aa, `${who}, ${reg}, en finale piste ${qfu} pour un complet.`);
    }
    return rows.sort((x, y) => x.nm - y.nm).map((x) => x.r);   // tri stable : à NM égal, l'ordre d'ajout reste
  }
  const radioHtml = (b) => `<details><summary><b>📻 Fiche radio de l'étape</b> (messages types, à adapter aux consignes de la VAC)</summary>
      <table class="legs"><tr><th>Phase</th><th>Fréq.</th><th>Message</th></tr>${radioCard(b).map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td style="text-align:left">${esc(r[2])}</td></tr>`).join('')}</table></details>`;

  // ---------- meilleur créneau de départ (même nav, départ de 7 h à 17 h locales)
  // créneaux de départ 7 h - 17 h locales, pour le jour du vol et les jours suivants (une requête ; AZBA connue pour le jour du vol seulement)
  async function departureSlots(trip) {
    const b0 = trip[0], bN = trip[trip.length - 1], dur = bN.eta - b0.depT, dep = A.aptByIcao[b0.f.dep], arr = A.aptByIcao[bN.f.arr];
    const horizon = (b0.depT - Date.now()) / 864e5, nd = Math.max(1, Math.min(7, Math.floor(15 - horizon)));
    const day = b0.depT.toISOString().slice(0, 10), last = new Date(b0.depT.getTime() + nd * 864e5).toISOString().slice(0, 10);
    let d = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${(+dep.la).toFixed(3)},${(+arr.la).toFixed(3)}&longitude=${(+dep.lo).toFixed(3)},${(+arr.lo).toFixed(3)}`
      + `&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation&wind_speed_unit=kn&timezone=UTC&start_date=${day}&end_date=${last}`);
    if (!Array.isArray(d)) d = [d];
    const at = (i, t) => { const h = d[i].hourly, k = h.time.indexOf(roundHour(t)); return k < 0 ? null : { t: h.temperature_2m[k], td: h.dew_point_2m[k], ws: h.wind_speed_10m[k], wd: h.wind_direction_10m[k], g: h.wind_gusts_10m[k], vis: h.visibility[k], rr: h.precipitation[k] }; };
    const vw = (b0.f.T.speeds || {})['Vw 90° max'] || 20, dayStart = Date.UTC(b0.depT.getUTCFullYear(), b0.depT.getUTCMonth(), b0.depT.getUTCDate());
    const cross = (x, id) => { const rw = runwayFor(vacAt(id), x.wd, x.ws); return rw ? Math.round(rw.best.cross) : null; };
    const week = [];
    for (let off = 0; off < nd; off++) {
      const loc = new Date(b0.depT.getTime() + off * 864e5), slots = [];
      for (let h = 7; h <= 17; h++) {
        loc.setHours(h, 0, 0, 0); const t0 = new Date(loc), t1 = new Date(t0.getTime() + dur);
        const p = at(0, t0), q = at(1, t1); if (!p || !q) continue;
        const why = [];
        for (const [x, id, lbl] of [[p, b0.f.dep, 'au départ'], [q, bN.f.arr, 'à l\'arrivée']]) {
          const c = cross(x, id), base = Math.round((x.t - x.td) * 400 / 100) * 100;
          if (c != null && c > vw) why.push(`travers ${c} kt ${lbl}`);
          if (x.g > 25) why.push(`rafales ${Math.round(x.g)} kt ${lbl}`);
          if (x.vis != null && x.vis < 5000) why.push(`visi ${Math.round(x.vis / 100) / 10} km ${lbl}`);
          if (base < 1500) why.push(`base ~${base} ft ${lbl}`);
          if (x.rr >= 1) why.push(`pluie ${x.rr} mm ${lbl}`);
        }
        const sd = sunTimes(t0, +dep.la, +dep.lo), sa = sunTimes(t1, +arr.la, +arr.lo);   // nuit aéronautique : coucher + 30 min, lever - 30 min
        if (sd && t0 < sd.rise.getTime() - 18e5) why.push('avant le jour aéronautique');
        if (sa && t1 > sa.set.getTime() + 18e5) why.push('arrivée de nuit');
        if (!off && trip.some((b) => b.rtba.some((r) => r.crossed && r.below && r.slots.some((s) => slotOverlap(s, dayStart, t0.getTime(), t1.getTime()))))) why.push('AZBA active sur la route');
        slots.push({ t0, h, p, q, why, score: why.length * 100 + Math.max(p.ws, q.ws) });
      }
      if (slots.length) week.push({ day: new Date(loc), slots, best: slots.slice().sort((x, y) => x.score - y.score)[0] });
    }
    if (!week.length) return null;
    const d0 = week.find((w) => w.day.toDateString() === b0.depT.toDateString()) || { slots: [], best: null };   // jour du vol
    return { slots: d0.slots, best: d0.best, week, bestDay: week.slice().sort((x, y) => x.best.score - y.best.score)[0] };
  }
  // climatologie (vol au-delà des prévisions) : jours « VFR possible » à ± 7 jours de la date, sur 10 ans, au départ, au milieu et à l'arrivée
  // code météo journalier = phénomène le plus fort de la journée : estimation prudente
  const climDay = (code, rr, g) => (code <= 3 && rr < 1 && g < 25 ? 0 : (code <= 3 || [45, 48, 51, 53, 61, 80].includes(code)) && rr < 5 && g < 35 ? 1 : 2);
  console.assert(climDay(2, 0, 15) === 0 && climDay(61, 2, 20) === 1 && climDay(95, 0, 20) === 2 && climDay(1, 0, 40) === 2, 'climDay');
  async function climatology(trip) {
    const b0 = trip[0], bN = trip[trip.length - 1], dep = A.aptByIcao[b0.f.dep], arr = A.aptByIcao[bN.f.arr], y = b0.depT.getUTCFullYear();
    const pts = [[+dep.la, +dep.lo], [(+dep.la + +arr.la) / 2, (+dep.lo + +arr.lo) / 2], [+arr.la, +arr.lo]];
    let d = await omFetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${pts.map((p) => p[0].toFixed(2)).join(',')}&longitude=${pts.map((p) => p[1].toFixed(2)).join(',')}`
      + `&start_date=${y - 10}-01-01&end_date=${y - 1}-12-31&daily=weather_code,precipitation_sum,wind_gusts_10m_max&wind_speed_unit=kn&timezone=UTC`);
    if (!Array.isArray(d)) d = [d];
    const doy = (t) => Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 864e5), target = doy(b0.depT.getTime()), n = [0, 0, 0];
    d[0].daily.time.forEach((t, k) => {
      const dd = Math.abs(doy(Date.parse(t)) - target); if (Math.min(dd, 365 - dd) > 7) return;
      n[Math.max(...d.map((x) => climDay(x.daily.weather_code[k] ?? 99, x.daily.precipitation_sum[k] ?? 0, x.daily.wind_gusts_10m_max[k] ?? 0)))]++;
    });
    const tot = n[0] + n[1] + n[2]; if (!tot) return null;
    return { ok: Math.round(n[0] / tot * 100), marg: Math.round(n[1] / tot * 100), bad: Math.round(n[2] / tot * 100), days: tot, years: `${y - 10}-${y - 1}` };
  }
  const climHtml = (trip) => { const c = trip[0].clim; return c ? `<p class="meta">📊 Climatologie (vol au-delà des prévisions) : à cette période (± 7 jours, ${c.years}), <b>${c.ok} %</b> des jours VFR possibles sur la route, ${c.marg} % marginaux, ${c.bad} % défavorables (pluie, orages, brouillard, vent fort ; ${c.days} jours, départ / milieu / arrivée). Archives Open-Meteo, indicatif.</p>` : ''; };
  function slotsHtml(trip) {
    const s = trip[0].slots; if (!s || !s.slots.length) return '';
    const hl = (x) => `${String(x.h).padStart(2, '0')} h`;
    return `<h4>Meilleur créneau de départ (${trip[0].depT.toLocaleDateString('fr-FR')})</h4>
      <div class="${s.best.why.length ? 'warn' : 'okk'}">🕐 Meilleur départ <b>${hl(s.best)}</b> (heure locale) : ${s.best.why.length ? esc(s.best.why.join(', ')) : `vent ${Math.round(s.best.p.ws)} kt au départ, ${Math.round(s.best.q.ws)} kt à l'arrivée, sans contrainte détectée`}.</div>
      <table class="legs trip"><tr><th>Départ</th><th>Vent dép.</th><th>Vent arr.</th><th>Base est.</th><th>Visi</th><th>Contraintes</th></tr>
      ${s.slots.map((x) => `<tr${x === s.best ? ' style="font-weight:bold"' : ''}><td>${hl(x)}</td><td>${r3(x.p.wd)}/${Math.round(x.p.ws)}${x.p.g > x.p.ws + 5 ? 'G' + Math.round(x.p.g) : ''}</td><td>${r3(x.q.wd)}/${Math.round(x.q.ws)}</td>
        <td>${Math.round(Math.min(x.p.t - x.p.td, x.q.t - x.q.td) * 4) * 100} ft</td><td>${Math.round(Math.min(x.p.vis, x.q.vis) / 1000)} km</td><td style="text-align:left">${x.why.length ? esc(x.why.join(', ')) : '✅'}</td></tr>`).join('')}</table>
      ${s.week.length > 1 ? `<h4>Meilleur jour (${s.week.length} jours)</h4><table class="legs trip"><tr><th>Jour</th><th>Meilleur départ</th><th>Contraintes</th></tr>
        ${s.week.map((w) => `<tr${w === s.bestDay ? ' style="font-weight:bold"' : ''}><td>${w.day.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}${w === s.bestDay ? ' ⭐' : ''}</td><td>${hl(w.best)}</td><td style="text-align:left">${w.best.why.length ? esc(w.best.why.join(', ')) : '✅'}</td></tr>`).join('')}</table>
        <p class="meta">AZBA : publiée la veille, comptée pour le jour du vol seulement.</p>` : ''}
      <p class="meta">Prévision Open-Meteo au départ et à l'arrivée (base estimée par l'écart température / point de rosée). Indicatif : confirmer avec TAF, TEMSI et AZBA du jour.</p>`;
  }

  // ================================================================== météo de la journée (une requête Open-Meteo : départ, route, arrivée, déroutements)
  // TAF / METAR en phrases (34)
  const WXW = { RA: 'pluie', DZ: 'bruine', SN: 'neige', SG: 'neige en grains', GR: 'grêle', GS: 'grésil', PL: 'granules de glace', FG: 'brouillard', BR: 'brume', HZ: 'brume sèche', FU: 'fumée', SQ: 'grains', FC: 'trombe', UP: 'précipitations' };
  function tokWords(toks) {
    const out = [];
    for (const x of toks) {
      let m;
      if ((m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(x))) out.push(+m[2] === 0 ? 'vent calme' : `vent ${m[1] === 'VRB' ? 'variable' : m[1] + '°'} ${+m[2]} kt${m[3] ? ` (rafales ${+m[3]})` : ''}`);
      else if (x === 'CAVOK') out.push('CAVOK (visibilité > 10 km, pas de nuage bas)');
      else if (/^\d{4}$/.test(x)) out.push(+x >= 9999 ? 'visibilité > 10 km' : +x >= 5000 ? `visibilité ${+x / 1000} km` : `visibilité ${+x} m`);
      else if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(x))) out.push(`${{ FEW: 'quelques nuages', SCT: 'nuages épars', BKN: 'nuageux', OVC: 'couvert' }[m[1]]} à ${+m[2] * 100} ft${m[3] === 'CB' ? ' avec cumulonimbus' : m[3] ? ' avec cumulus bourgeonnants' : ''}`);
      else if ((m = /^VV(\d{3})$/.exec(x))) out.push(`ciel invisible, visibilité verticale ${+m[1] * 100} ft`);
      else if (x === 'NSC' || x === 'NCD') out.push('pas de nuage significatif');
      else if (x === 'NSW') out.push('fin du temps significatif');
      else if ((m = /^(M?\d\d)\/(M?\d\d)$/.exec(x))) out.push(`température ${m[1].replace('M', '-')} °C, rosée ${m[2].replace('M', '-')} °C`);
      else if ((m = /^Q(\d{4})$/.exec(x))) out.push(`QNH ${m[1]}`);
      else if ((m = /^([+-]|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((?:RA|DZ|SN|SG|GR|GS|PL|FG|BR|HZ|FU|SQ|FC|UP)+)?$/.exec(x)) && (m[2] || m[3])) {
        const ph = (m[3] || '').match(/../g) || [], base = ph.map((c) => WXW[c]).join(' et ');
        const desc = m[2] === 'TS' ? `orage${base ? ' avec ' + base : ''}` : m[2] === 'SH' ? `averses${base ? ' de ' + base : ''}` : m[2] === 'FZ' ? `${base} verglaçant${/pluie|bruine/.test(base) ? 'e' : ''}` : m[2] === 'BC' ? `bancs de ${base}` : m[2] === 'MI' ? `${base} mince` : base;
        const pl = m[2] === 'SH' || m[2] === 'BC';   // « averses », « bancs » : pluriel
        out.push(`${m[1] === '-' ? (pl ? 'faibles ' : 'faible ') : m[1] === '+' ? (pl ? 'fortes ' : 'fort(e) ') : ''}${desc}${m[1] === 'VC' ? ' au voisinage' : ''}`);
      }
    }
    return out.join(', ');
  }
  console.assert(tokWords(['27010G20KT', '4000', '-SHRA', 'BKN015CB']) === 'vent 270° 10 kt (rafales 20), visibilité 4000 m, faibles averses de pluie, nuageux à 1500 ft avec cumulonimbus', 'tokWords');
  const hLoc = (ms, withDay) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', ...(withDay ? { weekday: 'short' } : {}) }).replace(':00', '').replace(/(\d\d)$/, '$1 h');
  function tafWords(taf) {
    const G = tafGroups(taf); if (!G) return [];
    const d0 = new Date(G[0].from).getDate(), lh = (t) => hLoc(t, new Date(t).getDate() !== d0);
    return G.filter((g) => g.toks.length).map((g) => {
      const w = tokWords(g.toks) || 'sans changement notable';
      if (g.kind === 'TAF') return `De ${lh(g.from)} à ${lh(g.to)} : ${w}.`;
      if (g.kind === 'FM') return `À partir de ${lh(g.from)} : ${w}.`;
      if (g.kind === 'BECMG') return `Entre ${lh(g.from)} et ${lh(g.from + 2 * 3600e3)}, devenant : ${w}.`;
      const p = /PROB(\d\d)/.exec(g.kind);
      return `${p ? `Risque ${p[1]} %` : 'Temporairement'} entre ${lh(g.from)} et ${lh(g.to)} : ${w}.`;
    });
  }
  // METAR : observation seule (la tendance TEMPO / BECMG et les remarques sont coupées)
  const metarWords = (m) => (m && m.rawOb ? tokWords(m.rawOb.replace(/^(METAR|SPECI)\s+/, '').split(/\s+(?:TEMPO|BECMG|NOSIG|RMK)\b/)[0].split(/\s+/).slice(2).filter((x) => !/^(AUTO|COR)$/.test(x))) : '');
  function tafHtml(b) {
    const ids = [...new Set([b.f.dep, b.f.arr, b.f.alt].filter(Boolean))];
    const rows = ids.map((id) => { const m = A.metars[id], t = A.tafs[id], tw = tafWords(t);
      return (m || tw.length) ? `<p class="meta" style="margin:3px 0"><b>${esc(id)}</b>${m ? ` — observé à ${hLoc(m.obsTime * 1000)} : ${esc(metarWords(m))}.` : ''}${tw.length ? `<br>${tw.map(esc).join('<br>')}` : ' — pas de TAF.'}</p>` : ''; }).join('');
    return rows ? `<details><summary><b>🗣️ METAR et TAF en clair</b> (heures locales)</summary>${rows}<p class="meta">Traduction automatique : en cas de doute, le texte brut fait foi.</p></details>` : '';
  }

  // prévision horaire du jour aux terrains, le long de la route et aux déroutements
  async function dayWx(trip) {
    const b0 = trip[0], pts = [];
    const add = (id, lbl, p, kind) => { if (p && !pts.some((x) => x.id === id)) pts.push({ id, lbl, p, kind }); };
    const ap = (id) => { const a = A.aptByIcao[id]; return a ? [+a.la, +a.lo] : null; };
    add(b0.f.dep, b0.f.dep, ap(b0.f.dep), 'dep');
    trip.forEach((b) => { [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].forEach((k) => add(`R${b.stage}-${k}`, `route ${b.f.dep}→${b.f.arr}`, routePosAt(b, b.totDist * k).p, 'route')); add(b.f.arr, b.f.arr, ap(b.f.arr), 'arr'); if (b.f.alt) add(b.f.alt, b.f.alt, ap(b.f.alt), 'alt'); });
    trip.forEach((b) => diversions(b).forEach((x) => x.list.slice(0, 4).forEach((t) => add(t.a.icao, t.a.icao, [+t.a.la, +t.a.lo], 'div'))));
    const P = pts.slice(0, 40), days = [...new Set([b0.depT, trip[trip.length - 1].eta].map((d) => d.toISOString().slice(0, 10)))].sort();
    let d = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${P.map((x) => x.p[0].toFixed(3)).join(',')}&longitude=${P.map((x) => x.p[1].toFixed(3)).join(',')}`
      + '&hourly=temperature_2m,dew_point_2m,cloud_cover_low,visibility,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_180m,wind_direction_180m,cape'
      + `&wind_speed_unit=kn&timezone=UTC&start_date=${days[0]}&end_date=${days[days.length - 1]}`);
    if (!Array.isArray(d)) d = [d];
    P.forEach((x, i) => { x.h = d[i].hourly; x.elev = (d[i].elevation || 0) * 3.281; });
    return { pts: P };
  }
  // conditions à une heure donnée en un point : niveau 0 favorable / 1 marginal / 2 défavorable, et le détail
  function wxAt(pt, t) {
    const h = pt && pt.h; if (!h) return null;
    const k = h.time.indexOf(roundHour(new Date(t))); if (k < 0) return null;
    const g = (n) => h[n][k], T = g('temperature_2m'), Td = g('dew_point_2m'), low = g('cloud_cover_low'), vis = g('visibility'), rr = g('precipitation'), wc = g('weather_code');
    const ws = g('wind_speed_10m'), wd = g('wind_direction_10m'), gust = g('wind_gusts_10m'), w180 = g('wind_speed_180m'), d180 = g('wind_direction_180m'), cape = g('cape');
    const base = T != null && Td != null ? Math.max(0, Math.round((T - Td) * 4) * 100) : null, why = []; let lv = 0;
    const fog = (vis != null && vis < 1000) || (low >= 80 && base != null && base < 300) || wc === 45 || wc === 48;
    if (fog) { lv = 2; why.push('brouillard / stratus'); }
    if (vis != null && vis < 5000 && !fog) { lv = 2; why.push(`visi ${Math.round(vis / 100) / 10} km`); } else if (vis != null && vis < 8000) { lv = Math.max(lv, 1); why.push(`visi ${Math.round(vis / 100) / 10} km`); }
    if (low >= 70 && base != null && base < 1000 && !fog) { lv = 2; why.push(`plafond ~${base} ft`); } else if (low >= 50 && base != null && base < 2000) { lv = Math.max(lv, 1); why.push(`nuages bas ~${base} ft`); }
    const storm = wc >= 95 || (cape >= 500 && wc >= 80 && rr >= 1);
    if (storm) { lv = 2; why.push('orage'); } else if (rr >= 1) { lv = Math.max(lv, 1); why.push(`pluie ${rr} mm/h`); }
    if (gust >= 25) { lv = Math.max(lv, 1); why.push(`rafales ${Math.round(gust)} kt`); }
    const u = (s, dir) => [s * Math.sin(rad(dir)), s * Math.cos(rad(dir))], shear = w180 != null && ws != null ? Math.hypot(u(w180, d180)[0] - u(ws, wd)[0], u(w180, d180)[1] - u(ws, wd)[1]) : 0;
    return { lv, why, T, Td, base, vis, low, rr, wc, ws, wd, gust, cape, fog, storm, shear, spread: T != null && Td != null ? T - Td : null };
  }
  console.assert((() => { const h = { time: ['2026-11-26T08:00'], temperature_2m: [5], dew_point_2m: [5], cloud_cover_low: [100], visibility: [300], precipitation: [0], weather_code: [45], wind_speed_10m: [2], wind_direction_10m: [0], wind_gusts_10m: [4], wind_speed_180m: [20], wind_direction_180m: [180], cape: [0] };
    const r = wxAt({ h }, Date.UTC(2026, 10, 26, 8)); return r.fog && r.lv === 2 && Math.round(r.shear) === 22; })(), 'wxAt brouillard + cisaillement');

  // frise heure par heure (33)
  function wxStripHtml(trip) {
    const W = trip[0].dayWx; if (!W) return '';
    const b0 = trip[0], bN = trip[trip.length - 1], day = new Date(b0.depT); day.setHours(6, 0, 0, 0);
    const hours = []; for (let k = 0; k <= 15; k++) hours.push(day.getTime() + k * 3600e3);
    const rows = [['Départ ' + b0.f.dep, W.pts.filter((x) => x.kind === 'dep')], ['Route', W.pts.filter((x) => x.kind === 'route')], ['Arrivée ' + bN.f.arr, W.pts.filter((x) => x.id === bN.f.arr)]];
    const cell = (ps, t) => { const r = ps.map((x) => wxAt(x, t)).filter(Boolean); if (!r.length) return '<td></td>'; const lv = Math.max(...r.map((x) => x.lv)), why = [...new Set(r.flatMap((x) => x.why))];
      const mark = t <= b0.depT.getTime() && b0.depT.getTime() < t + 3600e3 ? '🛫' : t <= bN.eta.getTime() && bN.eta.getTime() < t + 3600e3 ? '🛬' : '';
      return `<td title="${esc(hLoc(t))} : ${esc(WXTXT[lv])}${why.length ? ' — ' + esc(why.join(', ')) : ''}" style="background:${WXCOL[lv]};color:#000;min-width:20px">${mark}</td>`; };
    return `<h4>🌤️ Fenêtre météo du jour (heure locale)</h4><div style="overflow-x:auto"><table class="legs" style="font-size:11px"><tr><th></th>${hours.map((t) => `<th>${new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' }).replace(/\D.*$/, '')}</th>`).join('')}</tr>
      ${rows.filter((r) => r[1].length).map(([l, ps]) => `<tr><td style="text-align:left;white-space:nowrap">${esc(l)}</td>${hours.map((t) => cell(ps, t)).join('')}</tr>`).join('')}</table></div>
      <p class="meta">Vert : VFR favorable · orange : marginal · rouge : défavorable (visibilité, plafond, brouillard, orage, pluie, rafales). 🛫 départ prévu, 🛬 arrivée. Survole une case pour le détail. Modèle Open-Meteo : confirmer avec TAF et TEMSI.</p>`;
  }
  // alertes de la journée pour une étape : brouillard / stratus (12), orages (13), cisaillement et turbulence (11)
  function dayAlerts(b) {
    const W = b.dayWx; if (!W) return [];
    const al = [], day0 = new Date(b.depT); day0.setHours(5, 0, 0, 0);
    const hrs = []; for (let k = 0; k < 18; k++) hrs.push(day0.getTime() + k * 3600e3);
    for (const [id, when, lbl] of [[b.f.dep, b.depT.getTime(), 'départ'], [b.f.arr, b.eta.getTime(), 'arrivée']]) {
      const pt = W.pts.find((x) => x.id === id); if (!pt) continue;
      const f0 = hrs.find((t) => (wxAt(pt, t) || {}).fog);
      if (f0) {
        const end = hrs.find((t) => t > f0 && !(wxAt(pt, t) || {}).fog) || null, vfr = end && hrs.find((t) => t >= end && (wxAt(pt, t) || {}).lv < 2);
        const atTime = (wxAt(pt, when) || {}).fog;
        al.push(`${atTime ? '⛔ ' : ''}Brouillard / stratus prévu à ${id} à partir de ${hLoc(f0)}${end ? `, levée vers ${hLoc(end)}` : ' (pas de levée prévue dans la journée)'}${vfr && vfr > end ? `, plafond encore bas jusque vers ${hLoc(vfr)}` : ''}${atTime ? ` — y compris à l'heure d'${lbl} (${utc(new Date(when))})` : ''}.`);
      } else {
        const eve = hrs.filter((t) => new Date(t).getHours() >= 16).find((t) => { const r = wxAt(pt, t); return r && r.spread != null && r.spread <= 1.5 && r.ws <= 5; });
        if (eve && when > eve - 3600e3) al.push(`${id} : air presque saturé et vent faible en fin de journée (écart température / rosée ≤ 1,5 °C vers ${hLoc(eve)}) — risque de brouillard, ne pas rentrer tard.`);
      }
      const r = wxAt(pt, when);
      if (r && r.shear >= 15) al.push(`${id} : cisaillement près du sol à l'${lbl} (vent ${Math.round(r.ws)} kt au sol, ${Math.round(r.shear)} kt d'écart à 600 ft) — turbulence et variations de vitesse en montée / finale, garder de la marge (Vapp + ½ rafale).`);
      if (r && r.gust - r.ws >= 15) al.push(`${id} : rafales irrégulières à l'${lbl} (${Math.round(r.ws)} kt, rafales ${Math.round(r.gust)} kt) — turbulence près du sol.`);
    }
    // orages : première heure à risque sur la journée, n'importe où sur la route
    const st = hrs.map((t) => ({ t, p: W.pts.filter((x) => x.kind !== 'div').find((x) => (wxAt(x, t) || {}).storm) })).find((x) => x.p);
    if (st) al.push(`${b.eta.getTime() > st.t - 3600e3 ? '⛔ ' : ''}Orages possibles à partir de ${hLoc(st.t)} (${st.p.lbl}) — être posé avant ${hLoc(st.t - 3600e3)}${b.eta.getTime() > st.t - 3600e3 ? ` ; arrivée prévue ${utc(b.eta)} : trop tard` : ''}.`);
    // turbulence près des crêtes : rafales fortes sur relief
    const rough = ((b.wxRoute && b.wxRoute.pts) || []).filter((p) => p.gust >= 25 && p.elevFt >= 2000);
    if (rough.length) al.push(`Turbulence mécanique probable près du relief (rafales ${Math.round(Math.max(...rough.map((p) => p.gust)))} kt sur ${rough.length} point(s) au-dessus de 2000 ft) — passer haut au-dessus des crêtes.`);
    return al;
  }

  // point équitemps (ETP) et point de non-retour (PNR) sur la route, avec le vent prévu
  function pnrEtp(b) {
    if (!b.legs.length) return null;
    const D = b.totDist, out = b.legs.reduce((s, lg) => s + legMinutes(lg.dist, lg.tc, lg.wind, b.f.tas), 0), back = b.legs.reduce((s, lg) => s + legMinutes(lg.dist, (lg.tc + 180) % 360, lg.wind, b.f.tas), 0);
    const go = D / out * 60, gb = D / back * 60, etp = D * gb / (go + gb);
    const usable = b.loaded - b.resFuel - TAXI_L - (b.climb ? b.climb.fuel - TAXI_L : 0), E = Math.max(0, usable / b.f.ff);
    const pnr = E * go * gb / (go + gb);
    const where = (x) => { let acc = 0; for (const lg of b.legs) { if (x <= acc + lg.dist) return `${(x - acc).toFixed(0)} NM après ${lg.from}`; acc += lg.dist; } return b.f.arr; };
    return { etp, pnr, D, go: Math.round(go), gb: Math.round(gb), etpAt: where(etp), pnrAt: pnr < D ? where(pnr) : null };
  }
  console.assert((() => { const x = pnrEtp({ legs: [{ dist: 100, tc: 90, wind: null, from: 'A' }], totDist: 100, f: { tas: 100, ff: 30, arr: 'B' }, loaded: 62, resFuel: 0, climb: null });
    return Math.round(x.etp) === 50 && Math.round(x.pnr) === 100; })(), 'pnrEtp sans vent');   // 60 L utiles à 30 L/h = 2 h -> PNR 100 NM
  function pnrHtml(b) {
    const x = pnrEtp(b); if (!x) return '';
    return `<p class="meta">⚖️ Point équitemps à <b>${x.etp.toFixed(0)} NM</b> du départ (${esc(x.etpAt)}) : au-delà, continuer vers ${esc(b.f.arr)} est plus court que revenir (Vs aller ${x.go} kt, retour ${x.gb} kt). ${x.pnrAt ? `Point de non-retour à <b>${x.pnr.toFixed(0)} NM</b> (${esc(x.pnrAt)}) avec le carburant prévu, réserve finale gardée.` : `Pas de point de non-retour : l'autonomie permet de revenir depuis ${esc(b.f.arr)} en gardant la réserve.`}</p>`;
  }
  function altCmpHtml(b) {
    const c = b.altCmp; if (!c || !c.best) return '';
    const d = c.cur ? { min: c.cur.min - c.best.min, fuel: c.cur.fuel - c.best.fuel } : null;
    return `<details><summary><b>🧭 Altitude de croisière selon le vent</b> — ${c.best.alt === b.f.ft ? `${b.f.ft} ft est déjà la meilleure` : `à ${c.best.alt} ft${d ? ` tu gagnes ${d.min} min et ${d.fuel} L` : ''}`}</summary>
      <table class="legs"><tr><th>Altitude</th><th>Temps</th><th>Carburant</th><th>Régime</th><th>Remarque</th></tr>
      ${c.rows.map((r) => `<tr${r === c.best ? ' style="font-weight:bold"' : ''}><td>${r.alt} ft${r.cur ? ' (prévue)' : ''}</td><td>${hhmm(r.min)}</td><td>${r.fuel} L</td><td>${esc(r.rg.name || r.rg)}</td><td style="text-align:left">${[r.low && `sous l'alti sécu (${c.maxSafe} ft)`, !r.semi && 'hors règle semi-circulaire au-dessus de 3000 ft sol'].filter(Boolean).join(', ') || '✅'}</td></tr>`).join('')}</table>
      <p class="meta">Vent Open-Meteo à l'heure de passage, montée comprise. Choisir aussi selon les espaces aériens, la base des nuages et le givrage.</p></details>`;
  }
  // contact d'escale (e-mail relevé dans la VAC, ou à la main) avec la demande d'informations pré-remplie
  function escaleMailHtml(b) {
    const ids = [...new Set([b.f.arr, b.f.alt].filter(Boolean))];
    return `<p class="meta">✉️ Infos d'escale : ${ids.map((id) => { const e = (A.escaleOf && A.escaleOf(id)) || {}, c = (e.contacts || []).find((x) => x.m === e.mail_escale) || {};
      return e.mail_escale ? `<a href="#" data-esc-mail="${esc(id)}" style="color:var(--link)">${esc(id)} : ${esc(e.mail_escale)}</a> <small>(${esc(c.r || 'VAC')})</small>` : `${esc(id)} : pas d'e-mail publié${(e.tel_ad || []).length ? `, 📞 ${esc(e.tel_ad[0])}` : ''}`; }).join(' · ')}</p>`;
  }
  const vacLinks = (b) => escaleMailHtml(b) + `<p class="meta">📄 VAC (copie du cycle en cours, consultable hors ligne après le calcul) : ${[...new Set([b.f.dep, b.f.arr, b.f.alt].filter(Boolean))].map((id) => `<a href="data/vac/${id}.pdf" target="_blank" rel="noopener">${id}</a>`).join(' · ')}</p>`;
  // ---------- briefing en onglets (un panneau visible à la fois ; tout reste dans la page pour l'impression et les boutons)
  // icônes fines (traits, couleur du texte) à la place des émojis
  const ico = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICONS = {
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01', cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 8.2 4.9 4.9 0 0 1 17 18Z',
    route: 'M5 19a2 2 0 1 0 0-.01M19 5a2 2 0 1 0 0-.01M6.5 17.5 11 13M13 11l4.5-4.5M11 13c1-1 1-1 2-2', runway: 'M10 3 7 21M14 3l3 18M12 5v2M12 10v2M12 15v2M12 20v1',
    radio: 'M12 13v8M9 21h6M8.5 9.5a5 5 0 0 1 7 0M5.6 6.6a9 9 0 0 1 12.8 0M12 13a1.5 1.5 0 1 0 0-.01', shield: 'M12 3 19 6v6c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V6Z M9 12l2 2 4-4',
  };
  const TAB_ICON = { res: ico(ICONS.list), wx: ico(ICONS.cloud), route: ico(ICONS.route), ad: ico(ICONS.runway), radio: ico(ICONS.radio), sec: ico(ICONS.shield) };
  const TABS = [['res', 'Résumé'], ['wx', 'Météo'], ['route', 'Route'], ['ad', 'Terrains'], ['radio', 'Radio'], ['sec', 'Sécurité']];
  function tabsHtml(parts, badge = {}) {
    const ks = TABS.filter(([k]) => (parts[k] || '').trim());
    return `<div class="tabwrap"><div class="tabs" role="tablist">${ks.map(([k, l], i) => `<button type="button" role="tab" aria-selected="${!i}" tabindex="${i ? -1 : 0}" class="tab${i ? '' : ' on'}" data-tab="${k}">${TAB_ICON[k] || ''}${l}${badge[k] ? ` <i class="tbadge">${badge[k]}</i>` : ''}</button>`).join('')}</div>
      ${ks.map(([k], i) => `<div class="tabp${i ? '' : ' on'}" data-tabp="${k}" role="tabpanel">${parts[k]}</div>`).join('')}</div>`;
  }
  document.addEventListener('keydown', (e) => {   // flèches gauche / droite entre les onglets (comme un sélecteur iOS au clavier)
    const t = e.target.closest && e.target.closest('.tabs .tab'); if (!t || !/^Arrow(Left|Right)$/.test(e.key)) return;
    const all = [...t.parentElement.querySelectorAll('.tab')], n = all[(all.indexOf(t) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    e.preventDefault(); n.focus(); n.click();
  });
  document.addEventListener('click', (e) => {   // étapes du formulaire
    const t = e.target.closest('[data-step], [data-goto-step]'); if (!t) return;
    const n = t.dataset.step || t.dataset.gotoStep;
    document.querySelectorAll('.steps .step').forEach((x) => x.classList.toggle('on', x.dataset.step === n));
    document.querySelectorAll('.pf-step').forEach((x) => x.classList.toggle('on', x.dataset.stepp === n));
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.tabs .tab'); if (!t) return;
    const w = t.closest('.tabwrap');
    w.querySelectorAll(':scope > .tabs .tab').forEach((x) => { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', x === t); x.tabIndex = x === t ? 0 : -1; });
    w.querySelectorAll(':scope > .tabp').forEach((x) => x.classList.toggle('on', x.dataset.tabp === t.dataset.tab));
  });
  function summaryHtml(b, sfx = '', top = {}) {
    const al = alertsOf(b);
    const nt = b.night;
    return tabsHtml({
      res: `
      ${changesHtml(b)}
      ${notesHtml(b)}
      <div class="row" style="margin:6px 0"><button class="btn" id="pf-update${sfx}">🔄 Mettre à jour (mêmes paramètres)</button><button class="btn" id="pf-ics${sfx}">📅 Rappels J-1 / J</button><button class="btn" id="pf-gps${sfx}">📍 Mode en vol (GPS)</button><button class="btn" id="pf-knee${sfx}">🗒️ Fiche de genou A5</button>${!b.stage || b.stage === 1 ? `<button class="btn" id="pf-routes${sfx}">🗺️ Comparer 3 routes</button>` : ''}${(!b.stage || b.stage === 1) && b.depT > Date.now() && b.depT - Date.now() < 48 * 3600e3 ? `<button class="btn" id="pf-watch${sfx}" title="Recalcule la nav toutes les 30 min tant que la page est ouverte et prévient si la météo se dégrade">${watch ? '🔕 Arrêter la surveillance' : '🔔 Surveiller jusqu\'au départ'}</button>` : ''}<button class="btn" id="pf-share${sfx}">🔗 Partager</button>${b.f.pil && (!b.stage || b.stage === 1) ? `<button class="btn" id="pf-logit${sfx}">📓 Vol effectué : ajouter au carnet</button>` : ''}</div>
      <h4>Route ${b.ids.join(' → ')}</h4>
      <p class="meta">${esc(b.f.ac.reg)} ${esc(b.f.T.label)} · ${esc(b.f.rg.name)} (${b.f.tas} kt, ${b.f.ff} L/h) · ${b.f.ft} ft</p>
      <table class="legs"><tr><th>Branche</th><th>Alt.</th><th>Alt. séc.</th><th>Rm</th><th>Dist</th><th>Vent</th><th>Cm</th><th>Tps</th><th>Carb.</th></tr>
      ${b.legs.map((l) => `<tr><td>${l.from}→${l.to}</td><td>${l.ft || b.f.ft}</td><td>${l.safe ? l.safe.alt : '–'}</td><td>${r3(l.tm)}°</td><td>${l.dist.toFixed(0)}</td>
        <td>${l.wind ? `${r3(l.wind.dir)}/${Math.round(l.wind.spd)}` : '–'}</td><td>${r3(l.hm)}°</td><td>${l.min}'</td><td>${l.fuel} L</td></tr>`).join('')}
      <tr><th>Total</th><th></th><th></th><th></th><th>${b.totDist.toFixed(0)}</th><th></th><th></th><th>${hhmm(b.totMin)}</th><th>${b.totFuel} L</th></tr></table>
      <p class="meta">Arrivée estimée ${utc(b.eta)} · requis ${b.reqFuel} L (étape ${b.totFuel} + dégagement ${b.altLeg ? b.altLeg.fuel : 0} + réserve ${b.resFuel}${b.wxRes ? ` + réserve météo ${b.wxRes.L} L, ${b.wxRes.pct} % car ${esc(b.wxRes.why.join(' et '))}` : ''}) · à bord ${b.loaded} L.
        Masse décollage ${Math.round(b.mb.mass)} kg / ${b.f.T.mtow} kg, centrage ${b.mb.cg != null ? b.mb.cg.toFixed(3) + ' m' : 'à calculer (bras de levier inconnus)'}${b.mb.ldgCg != null ? ` · atterrissage ${Math.round(b.landMass)} kg, centrage ${b.mb.ldgCg.toFixed(3)} m` : ''}.</p>
      ${b.f.avoid === 'easy' ? `<p class="meta">🧭 Route « VFR facile » : ${b.totDist.toFixed(0)} NM, soit ${b.totDist - b.directNm >= 0.5 ? `+${(b.totDist - b.directNm).toFixed(0)} NM (≈ +${Math.round((b.totDist - b.directNm) / b.f.tas * 60)} min) par rapport à la route directe` : 'pas de détour nécessaire'}${b.avoided.length ? ` — évite ${esc(b.avoided.slice(0, 6).join(', '))}${b.avoided.length > 6 ? '…' : ''}` : ''}${b.crossedOk && b.crossedOk.length ? ` · traversés plutôt qu'un grand détour (clairance) : ${esc(b.crossedOk.join(', '))}` : ''}. Les TMA à plancher se passent dessous : voir l'altitude optimale.${b.detours.length || b.valley ? ' Sur la carte : route facile en magenta, route directe en bleu pointillé.' : ''}</p>
      ${clearHtml(b) ? `<p class="meta">📻 Clairances à demander : ${clearHtml(b)}</p>` : ''}
      ${b.valley ? `<p class="meta">⛰️ Plafond bas (base ~${b.valley.base} ft) sur le relief : route par les vallées, point le plus haut sous la route ${b.valley.to} ft au lieu de ${b.valley.from} ft (${b.totDist.toFixed(0)} NM au lieu de ${b.valley.nm.toFixed(0)}). Rester sous la base, garder un demi-tour possible (vallée qui se ferme), vérifier sur la carte OACI.</p>` : ''}` : ''}
      ${perfFuelHtml(b)}
      ${loadHtml(b)}
      ${nt ? `<p class="meta">☀️ Coucher du soleil à ${esc(b.f.arr)} ${utc(nt.set)} · nuit aéronautique ${utc(nt.night)} · <b>dernier décollage possible ${utc(nt.latestDep)}</b> pour arriver de jour.</p>` : ''}` + (top.res || ''),
      wx: (top.wx || '') + `
      ${tafHtml(b)}
      <h4>Météo le long de la route (prévision à l'heure de passage)</h4>
      ${b.wxRoute && b.wxRoute.pts ? `<div class="wxbar">${b.wxRoute.pts.map((p) => `<span style="background:${WXCOL[p.level]}" title="${esc(utc(p.at))} · ${esc(WXTXT[p.level])}${p.why.length ? ' : ' + esc(p.why.join(', ')) : ''} · nuages bas ${p.low ?? '?'} % · base ~${p.baseAgl ?? '?'} ft sol · visi ${p.vis != null ? Math.round(p.vis / 1000) + ' km' : '?'}"></span>`).join('')}</div>
        <p class="meta">${WXTXT[b.wxRoute.worst]} sur l'ensemble du trajet${b.wxRoute.worst ? ' — ' + esc([...new Set(b.wxRoute.pts.flatMap((p) => p.why))].slice(0, 5).join(', ')) : ''}. Survole les pastilles pour le détail.</p>` : `<p class="meta">Indisponible (${esc((b.wxRoute && b.wxRoute.err) || '?')}).</p>`}
      ${ensHtml(b)}
      ${confHtml(b)}
      <h4>GRAMET — coupe météo de la route</h4>
      ${b.gramet && !b.gramet.err ? `<canvas id="pf-gramet${sfx}" class="gramet-cv" width="1000" height="470"></canvas>` : ''}
      <p class="meta">${grametSummary(b.gramet, b)} Modèle Open-Meteo à l'heure de passage.</p>
      <div class="row">${b.gramet && !b.gramet.err ? `<button class="btn" id="pf-gramet-big${sfx}">🔍 Agrandir</button>` : ''}<a class="btn" href="${esc(ogimetUrl(b))}" target="_blank" rel="noopener">GRAMET Ogimet (GFS)</a><a class="btn" href="https://aviation.meteo.fr" target="_blank" rel="noopener">TEMSI / WINTEM (aviation.meteo.fr)</a></div>
      ${mountainHtml(b)}`,
      route: `
      <h4>✈️ Coupe verticale de la route</h4>
      ${profileSvg(b.vprofile, b, sfx)}
      ${b.vprofile && b.vprofile.conflicts.length ? `<div class="warn">À ${b.f.ft} ft, la route entre dans : ${esc(b.vprofile.conflicts.map((c) => c.name).join(', '))}.</div>` : ''}
      ${crossHtml(b)}
      ${turnBackHtml(b)}
      ${pnrHtml(b)}
      ${optAltHtml(b, sfx)}
      ${landmarksHtml(b)}
      ${drHtml(b)}
      ${landmarkHtml(b, sfx)}
      ${altCmpHtml(b)}
      ${azbaHtml(b)}
      <h4>Exporter la route</h4>
      <div class="row"><button class="btn" id="pf-gpx${sfx}">GPX (SkyDemon, Garmin, etc.)</button><button class="btn" id="pf-fpl${sfx}">Garmin .fpl (ForeFlight, Garmin Pilot)</button></div>`,
      ad: `
      ${perfLine(b, sfx)}
      ${altHtml(b, sfx)}
      ${arrivalHtml(b)}
      ${escaleCardHtml(b, sfx)}
      ${diversionsHtml(b)}
      ${vacLinks(b)}`,
      radio: `
      ${freqHtml(b)}
      ${radioHtml(b)}
      <h4>Fréquences en route</h4>
      ${b.legs.map((l) => `<p class="meta" style="margin:2px 0"><b>${l.from}→${l.to}</b> : ${l.airspaces.map((s) => `${esc(s.name)} ${esc(s.freq)}`).join(' · ') || 'classe G (A/A 123.500 / SIV)'}</p>`).join('')}
      ${fplHtml(b, sfx)}`,
      sec: `
      ${nt && nt.firstDark ? `<div class="warn">🌙 Il fera nuit aéronautique à partir de <b>${esc(nt.firstDark.id)}</b> (passage ${utc(nt.firstDark.eta)}, nuit aéro sur place ${utc(nt.firstDark.night)}) : ${nt.pts.filter((x) => x.dark).map((x) => esc(x.id)).join(', ')} de nuit. VFR de nuit = qualification requise.</div>` : ''}
      ${al.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join('') || '<div class="okk">Aucune alerte majeure détectée automatiquement.</div>'}
      ${safetyHtml(b)}
      ${moreHtml(b, sfx)}
      ${whatIfHtml(b, sfx)}`,
    }, { sec: al.length });
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

    // ---------------------------------------------------------------- 0. PAGE DE GARDE : verdict, chiffres clés, croquis de la route
    progress('PDF : page de garde…');
    {
      const V = verdict(b), col = [[52, 199, 89], [255, 149, 0], [255, 59, 48]][V.lv], e = b.ens && !b.ens.err ? b.ens.both : null;
      doc.setFillColor(0, 102, 153); doc.rect(0, 0, W, 44, 'F'); doc.setTextColor(255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text(latin(`${b.f.dep}  ->  ${b.f.arr}`), M + 4, 20);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      doc.text(latin(`${b.depT.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} · départ ${utc(b.depT)} · ${b.f.ac.reg} ${b.f.T.label}${b.f.pil ? ' · ' + b.f.pil : ''}`), M + 4, 30);
      doc.setFontSize(8.5); doc.text(latin(`Briefing de préparation · généré le ${b.generated.toISOString().slice(0, 16).replace('T', ' ')}Z`), M + 4, 38);
      // verdict
      doc.setFillColor(...col); doc.roundedRect(M, 52, 128, 58, 4, 4, 'F'); doc.setTextColor(255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(latin(['On peut partir', 'À surveiller', 'Ne pas partir en l\'état'][V.lv]), M + 6, 64);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      let yy = 72; (V.reasons.length ? V.reasons : ['Aucune alerte importante détectée.']).forEach((r) => { doc.splitTextToSize(latin('• ' + r), 116).slice(0, 2).forEach((l) => { doc.text(l, M + 6, yy); yy += 4.4; }); });
      if (e != null) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(latin(`Probabilité VFR : ${e} % (${b.ens.n} scénarios ECMWF)`), M + 6, 105); }
      // chiffres clés
      const F = fuelLines(b), tiles = [['Distance', `${b.totDist.toFixed(0)} NM`], ['Temps de vol', hhmm(b.totMin)], ['Arrivée', utc(b.eta)], ['Carburant requis', `${b.reqFuel} L`],
        ['Embarqué', `${b.f.fuel + (b.f.aux || 0)} L (marge ${F.margin} L)`], ['Masse décollage', `${Math.round(b.mb.mass)} / ${b.f.T.mtow} kg`], ['Altitude', `${b.f.ft} ft`], ['Nuit aéro', b.night ? utc(b.night.night) : '-']];
      tiles.forEach(([k, v], i) => { const x = M + (i % 4) * 32, yt = 118 + Math.floor(i / 4) * 24;
        doc.setFillColor(238, 244, 249); doc.roundedRect(x, yt, 30, 21, 3, 3, 'F'); doc.setTextColor(100); doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.text(latin(k.toUpperCase()), x + 2.5, yt + 6);
        doc.setTextColor(0); doc.setFont('helvetica', 'bold'); doc.setFontSize(v.length > 12 ? 8 : 11); doc.text(doc.splitTextToSize(latin(v), 26).slice(0, 2), x + 2.5, yt + 13); });
      // croquis de la route (projection simple, nord en haut)
      const bx = 148, by = 52, bw = W - bx - M, bh = H - by - 16, pts = b.pts, las = pts.map((p) => p[0]), los = pts.map((p) => p[1]), k = Math.cos(rad((Math.min(...las) + Math.max(...las)) / 2));
      const sx = Math.max(.01, (Math.max(...los) - Math.min(...los)) * k), sy = Math.max(.01, Math.max(...las) - Math.min(...las)), sc = Math.min((bw - 24) / sx, (bh - 24) / sy);
      const X = (p) => bx + bw / 2 + ((p[1] - (Math.min(...los) + Math.max(...los)) / 2) * k) * sc, Y = (p) => by + bh / 2 - (p[0] - (Math.min(...las) + Math.max(...las)) / 2) * sc;
      doc.setFillColor(246, 248, 250); doc.roundedRect(bx, by, bw, bh, 4, 4, 'F');
      doc.setDrawColor(255, 43, 214); doc.setLineWidth(1.2); for (let i = 1; i < pts.length; i++) doc.line(X(pts[i - 1]), Y(pts[i - 1]), X(pts[i]), Y(pts[i]));
      doc.setFontSize(8); b.ids.forEach((id, i) => { const p = pts[i]; if (!p) return; doc.setFillColor(i === 0 || i === pts.length - 1 ? 0 : 255, 102, 153); doc.circle(X(p), Y(p), i === 0 || i === pts.length - 1 ? 1.8 : 1.1, 'F');
        doc.setTextColor(30); doc.setFont('helvetica', i === 0 || i === pts.length - 1 ? 'bold' : 'normal'); doc.text(latin(id), X(p) + 2.5, Y(p) - 1.5); });
      doc.setTextColor(120); doc.setFontSize(7); doc.text(latin('Croquis de la route (nord en haut) - carte OACI pages suivantes'), bx + 4, by + bh - 4);
      doc.setTextColor(0);
      doc.addPage('a4', 'landscape');
    }

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
        body.push([lg.safe ? String(lg.safe.alt) : '', `${lg.ft && lg.ft !== b.f.ft ? lg.ft + ' ft  ' : ''}Rm ${r3(lg.tm)}°  Cm ${r3(lg.hm)}°  (vent ${lg.wind ? r3(lg.wind.dir) + '/' + Math.round(lg.wind.spd) : '-'}, Vs ${Math.round(lg.gs)})`,
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
    para(`Croisière ${b.f.ft} ft · ${b.f.rg.name} : Vp ${b.f.tas} kt, ${b.f.ff} L/h · Rm/Cm magnétiques (déclinaison ${b.varDeg.toFixed(1)}°). Alti sécu = relief max ±5 NM + 1000 ft (hors obstacles : voir carte). 1re branche : ${b.climb.src}. Route plan de vol (case 15) : ${icaoRoute(b)}.`, { size: 7, color: [90, 90, 90] });
    para(`Espaces/fréquences : ${b.aspSource || 'OpenAir FFVP'} + SIV eAIP ENR 2.2 - données non officielles, vérifier sur la carte OACI et les VAC.`, { size: 7, color: [90, 90, 90] });

    // page 2 du log : masse & centrage, performances, carburant
    newPage('landscape', 'LOG DE NAVIGATION - MASSE, CENTRAGE ET PERFORMANCES');
    const mb = b.mb;
    const n3 = (v) => (typeof v === 'number' ? v.toFixed(3) : 'à compléter');
    table(['Élément', 'Masse (kg)', 'Bras (m)', 'Moment'], mb.rows.map((r) => [r[0], r[1].toFixed(0), n3(r[2]), typeof r[2] === 'number' ? (r[1] * r[2]).toFixed(1) : '-']).concat([
      [{ content: 'Total décollage', styles: { fontStyle: 'bold' } }, { content: mb.mass.toFixed(0), styles: { fontStyle: 'bold' } }, { content: n3(mb.cg), styles: { fontStyle: 'bold' } }, mb.mom != null ? mb.mom.toFixed(1) : '-'],
      ['MTOW / marge', `${b.f.T.mtow} / ${Math.round(b.f.T.mtow - mb.mass)}`, mb.cg == null ? (b.f.T.cgLimits ? `limites ${b.f.T.cgLimits.join(' - ')} m` : 'centrage à calculer') : mb.inEnv(mb.cg, mb.mass) ? 'Centrage OK' : 'HORS LIMITES', ''],
      ['Masse à l\'atterrissage (est.)', b.landMass.toFixed(0), n3(mb.ldgCg), mb.ldgCg == null ? '' : mb.inEnv(mb.ldgCg, b.landMass) ? 'Centrage OK' : 'HORS LIMITES'],
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
    const ptsMb = mb.cg == null ? [] : [[mb.cg, mb.mass, 'TO'], [mb.ldgCg, b.landMass, 'LDG']];
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
      ...(b.wxRes ? [['Réserve météo', `${b.wxRes.L} L (${b.wxRes.pct} % : ${b.wxRes.why.join(', ')})`]] : []),
      [{ content: 'Requis', styles: { fontStyle: 'bold' } }, { content: `${b.reqFuel} L`, styles: { fontStyle: 'bold' } }],
      ['Marge', `${b.loaded - b.reqFuel} L, soit ${Math.round((b.loaded - b.reqFuel) / b.f.ff * 60)} min`],
      ['Autonomie totale', hhmm(b.loaded / b.f.ff * 60)], ['Repère', `1 L = ${b.f.T.minPerLitre} min`],
    ], { x: M, width: 110, size: 8, keepY: true });
    const yFuel = doc.lastAutoTable.finalY;
    // performances décollage
    const perfRow = (t) => t ? [t.id, `${t.elev} ft`, `${Math.round(t.temp)}°C ${t.wxSrc === 'prévision' ? '(prév.)' : ''}\nZd ${t.da} ft`, t.grass ? 'herbe' : 'dur', t.len ? `${t.len} m` : '?', t.tod ? `${t.tod} m` : 'manuel de vol', t.ldg ? `${t.ldg} m` : '-',
      t.rw ? `QFU ${t.rw.best.qfu}° : ${t.rw.best.head != null ? `${t.rw.best.head >= 0 ? 'face' : 'arrière'} ${Math.abs(Math.round(t.rw.best.head))} kt, travers ${Math.round(t.rw.best.cross)} kt` : 'vent ?'}` : '-'] : null;
    table(['Terrain', 'Alt.', 'Temp.', 'Piste', 'Longueur', 'Décollage 15 m', 'Atterr. 15 m', 'Piste probable / vent'],
      [perfRow(b.depInfo), perfRow(b.arrInfo), perfRow(b.altInfo)].filter(Boolean), { x: M + 115, y: yFuelStart, size: 7.5, keepY: true });
    y = Math.max(yFuel, doc.lastAutoTable.finalY) + 3;
    if (b.f.T.takeoff && b.f.T.takeoff.table) para(`Distances calculées avec les tableaux du manuel de vol : altitude et température du terrain (METAR, sinon ISA), masse au décollage / à l'atterrissage, vent METAR sur la piste probable (sans vent si VRB ; vent de face compté seulement pour un vol dans les 2 h, vent arrière toujours), +${Math.round((b.f.T.takeoff.table.grass - 1) * 100)} % (décollage) / +${Math.round((((b.f.T.landing && b.f.T.landing.table) || b.f.T.takeoff.table).grass - 1) * 100)} % (atterrissage) sur herbe sèche. Herbe mouillée, pente et état de la piste non pris en compte.`, { size: 7, color: [90, 90, 90] });
    else if (b.f.T.takeoff) para(`${b.f.T.takeoff.note} : ${b.f.T.takeoff.hard} m (dur)${b.f.T.takeoff.grass ? ` / ${b.f.T.takeoff.grass} m (herbe)` : ''}, majorée ~10 % par 1000 ft d'altitude terrain et ~10 % par 10 °C au-dessus de l'ISA (estimation - utiliser les abaques du manuel de vol / DF15).`, { size: 7, color: [90, 90, 90] });
    if (b.f.T.landing && !b.f.T.landing.table) para(`${b.f.T.landing.note} : ${b.f.T.landing.hard} m (dur)${b.f.T.landing.grass ? ` / ${b.f.T.landing.grass} m (herbe)` : ''} (abaques du manuel de vol).`, { size: 7, color: [90, 90, 90] });

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
      const ec = A.escaleOf ? A.escaleOf(t.id) || {} : {};
      rows.push(['Contact escale', ec.mail_escale ? `${ec.mail_escale} (${((ec.contacts || []).find((c) => c.m === ec.mail_escale) || {}).r || 'VAC'})` : `pas d'e-mail publié : ${(ec.tel_ad || []).join(' / ') || 'voir VAC'}`]);
      if (kind === 'DÉPART') {
        rows.push([b.f.T.takeoff && b.f.T.takeoff.table ? 'Décollage (manuel)' : 'Décollage (estimé)', `${t.tod ? t.tod + ' m' : 'non disponible - voir manuel de vol'} (15 m) pour ${t.len ? t.len + ' m de piste' : 'piste ?'} ${t.grass ? '(herbe)' : '(dur)'} — masse ${Math.round(b.mb.mass)} kg`]);
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
        if (t.ldg) rows.push(['Atterrissage (manuel)', `${t.ldg} m (depuis 15 m) pour ${t.len ? t.len + ' m de piste' : 'piste ?'} ${t.grass ? '(herbe)' : '(dur)'} — masse ${Math.round(b.landMass)} kg`]);
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
    try {   // photo du terrain d'arrivée avec le schéma du tour de piste (déjà chargée dans le résumé, sinon chargée ici)
      const ph = b.arrPhoto || await airfieldPhoto(b);
      if (ph) {
        newPage('landscape', latin(`TERRAIN D'ARRIVEE ${b.f.arr} - PHOTO ET SCHEMA DU TOUR DE PISTE`));
        const maxW = W - 2 * M, maxH = H - 30, sc = Math.min(maxW / ph.w, maxH / ph.h);
        doc.addImage(ph.url, 'JPEG', M + (maxW - ph.w * sc) / 2, 18, ph.w * sc, ph.h * sc);
        doc.setFontSize(6.5); doc.setTextColor(90); doc.text(latin('Photo Esri World Imagery, pistes OpenStreetMap. Schema indicatif (cote et altitude d\'apres la VAC) : le circuit officiel est sur la VAC.'), M, H - 8); doc.setTextColor(0);
      }
    } catch (e) { console.warn('photo terrain', e); }
    // bande de carte (strip-map) : une image OACI par branche ; branches est-ouest en bandes horizontales (2 l'une sous l'autre),
    // branches nord-sud en bandes verticales (2 côte à côte) ; une nouvelle page quand l'orientation change
    try {
      const legs = b.legs.filter((lg) => lg.dist >= 6);
      let page = null, slot = 0;
      for (let i = 0; i < legs.length; i++) {
        const lg = legs[i], k = b.legs.indexOf(lg), vert = Math.abs(Math.sin(rad(lg.tc))) < 0.6;
        const st = await renderNavMap({ ...b, pts: [lg.a, lg.b], ids: [lg.from, lg.to], legs: [lg], altLeg: null }, (t) => progress && progress(t.replace('carte OACI', `bande de carte ${i + 1}/${legs.length}`)), { ratio: vert ? 132 / 168 : 277 / 82 });
        if (!st) break;
        if (page !== (vert ? 'v' : 'h') || slot === 2) { newPage('landscape', 'BANDE DE CARTE PAR BRANCHE - OACI-VFR 1/500 000'); page = vert ? 'v' : 'h'; slot = 0; }
        const bw = vert ? (W - 2 * M - 4) / 2 : W - 2 * M, bh = vert ? H - 32 : (H - 26) / 2 - 8;
        const x0 = vert ? M + slot * (bw + 4) : M, y0 = vert ? 19 : 19 + slot * (H - 26) / 2, sc = Math.min(bw / st.w, bh / st.h);
        doc.setFontSize(vert ? 7.5 : 8.5); doc.setFont('helvetica', 'bold');
        doc.text(doc.splitTextToSize(latin(`${k + 1}. ${lg.from} -> ${lg.to} : Rm ${r3(lg.tm)}°, Cm ${r3(lg.hm)}°, ${lg.dist.toFixed(0)} NM, ${lg.min} min, alti sécu ${lg.safe ? lg.safe.alt + ' ft' : 'à vérifier'}, croisière ${lg.ft || b.f.ft} ft`), bw), x0, y0 + 3);
        doc.setFont('helvetica', 'normal');
        doc.addImage(st.url, 'JPEG', x0 + (bw - st.w * sc) / 2, y0 + (vert ? 8 : 5), st.w * sc, st.h * sc);
        slot++;
      }
    } catch (e) { console.warn('bande de carte', e); }
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
    // coupe : même dessin qu'à l'écran (version claire), sinon l'ancien tracé
    const cut = b.vprofile ? await svgToJpeg(cutSvg(b.vprofile, b, { light: true }), 2000, 660).catch((e) => { console.warn('coupe PDF', e); return null; }) : null;
    if (cut) {
      const cw = W - 2 * M, ch = cw * 0.33; ensure(ch + 22); h2('Coupe verticale');
      doc.addImage(cut, 'JPEG', M, y, cw, ch); y += ch + 2;
      para(`Rose : profil prévu (montée et descente comprises)${cutGeom(b.vprofile, b).opt ? ' · vert pointillé : profil conseillé' : ''} · espaces colorés par classe (A rouge, C bleu foncé, D bleu, E vert), contour rouge = traversé à l'altitude prévue · gris : nuages (rouge clair : givrage) · bleu pointillé : isotherme 0 °C${nightAlong(b) != null ? ' · zone sombre : nuit aéronautique' : ''}. Altitudes en ft, distances en NM.`, { size: 7, color: [90, 90, 90] });
    } else { h2('Coupe verticale'); drawProfilePdf(doc, b, M, y + 1, W - 2 * M, 62); y += 72; }
    h2('Météo le long de la route (prévision modèle à l\'heure de passage)');
    if (b.wxRoute && b.wxRoute.pts) {
      table(['Heure', 'Pos.', 'Avis', 'Nuages bas', 'Base est.', 'Visi', 'Pluie', 'Rafales', 'Détail'], b.wxRoute.pts.map((p) => [utc(p.at), `${p.along.toFixed(0)} NM`,
        { content: WXTXT[p.level], styles: { textColor: p.level === 2 ? [190, 20, 20] : p.level === 1 ? [200, 110, 0] : [20, 130, 40], fontStyle: 'bold' } },
        p.low != null ? `${p.low} %` : '?', p.baseAgl != null ? `${p.baseAgl} ft sol / ${p.baseAmsl} ft` : '?', p.vis != null ? `${Math.round(p.vis / 1000)} km` : '?',
        p.rr != null ? `${p.rr} mm` : '?', p.gust != null ? `${Math.round(p.gust)} kt` : '?', p.why.join(', ')]), { size: 7 });
      para('Base estimée par l\'écart température / point de rosée (x 400 ft) - indicatif, ne remplace pas les TEMSI.', { size: 7, color: [90, 90, 90] });
      if (b.ens && !b.ens.err) para(`Probabilité VFR (${b.ens.n} scénarios ECMWF) : ${b.ens.both} % (plafond > 1500 ft sol partout : ${b.ens.ceil} %, rafales < 25 kt partout : ${b.ens.gust} %).`, { size: 7.5, color: b.ens.both >= 80 ? [20, 130, 40] : [190, 90, 0] });
      if (b.conf && b.conf.bad && b.conf.n > 1) para(b.conf.bad.length ? `Prévision incertaine (modèles ${Object.values(MODELS).join(', ')}) : ${b.conf.bad.slice(0, 3).map((x) => `vers ${x.along.toFixed(0)} NM (${utc(x.at)}) : ${x.why.join(' ; ')}`).join(' · ')}.` : `Confiance : ${b.conf.n} modèles d'accord aux ${b.conf.pts.length} points comparés.`, { size: 7.5, color: b.conf.bad.length ? [190, 90, 0] : [20, 130, 40] });
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

    // ---------------------------------------------------------------- compléments : altitude, déroutements, charge, coût, radio, check-list
    progress('PDF : compléments…');
    newPage('portrait', 'COMPLÉMENTS');
    if (b.altCmp && b.altCmp.best) {
      h2('Altitude de croisière selon le vent');
      table(['Altitude', 'Temps', 'Carburant', 'Régime', 'Remarque'], b.altCmp.rows.map((r) => [`${r.alt} ft${r.cur ? ' (prévue)' : ''}${r === b.altCmp.best ? ' *' : ''}`, hhmm(r.min), `${r.fuel} L`, r.rg,
        [r.low && 'sous l\'alti sécu', !r.semi && 'hors règle semi-circulaire'].filter(Boolean).join(', ') || 'OK']), { size: 7.5 });
    }
    if (b.optAlt) {
      h2('Altitude optimale par branche');
      table(['Branche', 'Altitude', 'Plancher', 'Plafond', 'A noter'], b.optAlt.plan.map((c) => [`${c.lg.from} -> ${c.lg.to}`, c.hard.length ? 'IMPOSSIBLE' : `${c.alt} ft`, c.floor ? `${c.floor.alt} ft : ${c.floor.why}` : '-', c.ceil ? `${c.ceil.alt} ft : ${c.ceil.why}` : '9500 ft',
        [...c.hard.map((h) => 'INTERDIT : ' + h.why), ...c.soft.map((h) => h.why)].join(' ; ') || 'OK']), { size: 7.3 });
      para(`Profil conseillé : ${b.optAlt.plan.map((c) => (c.hard.length ? 'IMPOSSIBLE' : c.alt)).join(' -> ')} ft (${b.optAlt.tot.fuel} L). ${b.optAlt.uni.hard ? `Altitude unique la moins contrainte : ${b.optAlt.uni.alt} ft, mais : ${b.optAlt.uni.why.join(' ; ')}.` : `Altitude unique conseillée : ${b.optAlt.uni.alt} ft (${b.optAlt.uni.fuel} L).`}`, { size: 8 });
    }
    const semi = semiCircular(b);
    if (semi.length) para(`Règle semi-circulaire (au-dessus de 3000 ft sol : Rm 000-179 milliers impairs + 500, Rm 180-359 milliers pairs + 500) : ${semi.map((x) => `${x.lg.from}-${x.lg.to} Rm ${r3(x.lg.tm)} -> ${x.sug || '?'} ft`).join(' ; ')}.`, { size: 8, color: [170, 40, 0] });
    const drr = deadReckoning(b);
    if (drr.some((x) => x.cps.length)) {
      h2('Contrôle de l\'estime');
      table(['Branche', 'Repères attendus (heure UTC, minute, côté) — si rien à +2 min : vérifier cap et vent ; à +5 min : repère suivant ou SIV'], drr.map((x) => [`${x.lg.from} -> ${x.lg.to}\nCm ${r3(x.lg.hm)} - ${x.lg.min} min`, x.cps.map((c) => `${utc(c.at)} (+${c.min}') ${c.n} (${c.side})`).join('\n') || 'peu de repères : cap et temps']), { size: 7.3 });
    }
    const lmk = landmarksOf(b);
    if (lmk.some((x) => x.list.length)) {
      h2('Repères visuels par branche');
      table(['Branche', 'Repères (minute depuis le début de la branche, côté)'], lmk.map((x) => [`${x.lg.from} -> ${x.lg.to}`, x.list.map((t) => `${t.min}' ${t.n} (${t.side})`).join(' · ') || '-']), { size: 7.3 });
    }
    h2('Terrains de déroutement le long de la route');
    table(['Branche', 'Terrains à moins de 10 NM (distance, position)', 'Plus loin d\'un terrain'], diversions(b).map((x) => [`${x.lg.from} -> ${x.lg.to}`,
      x.list.slice(0, 6).map((t) => `${t.a.icao} ${t.a.name} (${t.d.toFixed(0)} NM, à ${t.along.toFixed(0)} NM)`).join('\n') || 'aucun', `${x.worst.d.toFixed(0)} NM${x.glide != null ? `\nplané ~${x.glide.toFixed(0)} NM` : ''}`]), { size: 7.3 });
    const pe = pnrEtp(b);
    if (pe) { h2('Point équitemps et point de non-retour'); para(`Point équitemps à ${pe.etp.toFixed(0)} NM du départ (${pe.etpAt}), Vs aller ${pe.go} kt / retour ${pe.gb} kt. ${pe.pnrAt ? `Point de non-retour à ${pe.pnr.toFixed(0)} NM (${pe.pnrAt}).` : 'Pas de point de non-retour (retour possible depuis la destination, réserve gardée).'}`, { size: 8.5 }); }
    h2('Charge restante');
    const lm = loadMargins(b);
    para(`Marge sous la masse max ${lm.margin} kg : encore ${lm.fuel} L de carburant (limite ${lm.limitFuel}) ou ${lm.bag} kg de bagages (limite ${lm.limitBag}).`, { size: 8.5 });
    if (!b.stage || b.stage === 1) {
      const tc = tripCost(b.trip || [b]);
      h2('Coût du vol');
      para(`${b.f.ac.reg} : ${hhmm(tc.min)} x ${tc.price || '?'} EUR/h${tc.fees ? ` + ${tc.fees} EUR de taxes` : ''} = ${tc.cost != null ? tc.cost + ' EUR' : '?'}${tc.cost != null && (b.f.share || 1) > 1 ? `, soit ${Math.round(tc.cost / b.f.share)} EUR par personne` : ''}.`, { size: 8.5 });
      table(['Avion', 'Temps', 'Coût', 'Possible ?'], tc.cmp.map((x) => [`${x.ac.reg} ${x.T.label}`, hhmm(x.min), `${x.cost} EUR`, x.why.join(', ') || 'oui']), { size: 7.5 });
    }
    h2('Fiche radio (messages types, à adapter)');
    table(['Phase', 'Fréq.', 'Message'], radioCard(b), { size: 7.5, at: { columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 16 } } } });
    if (!b.stage || b.stage === 1) {
      h2('Check-list avant départ');
      const st = store.get(checkKey(b), []);
      CHECK_ITEMS.forEach((t, i) => para(`[${st[i] ? 'X' : ' '}] ${t}`, { size: 8.5, gap: .6 }));
    }

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
            let r = await fetch(`data/vac/${id}.pdf`).catch(() => null);
            if (!r || !r.ok || !/pdf/.test(r.headers.get('content-type') || '')) r = await fetch(VAC.data[id].url);
            if (!r.ok) throw new Error(r.status);
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
    fm = { trip, legs, box, follow: true, prev: null, marker: null, t0: {}, divert: false, cockpit: false, trail: L.polyline([], { color: '#00e5ff', weight: 3, opacity: .8 }).addTo(map), lock: null };
    map.on('dragstart', fmDrag);
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { if (fm) fm.lock = l; }).catch(() => {});
    fm.watch = navigator.geolocation.watchPosition(onFix, (e) => { box.innerHTML = `<div class="if-wait">GPS indisponible : ${esc(e.message)} <button class="btn" id="if-stop">Quitter</button></div>`; box.querySelector('#if-stop').onclick = stopFlight; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  function fmDrag() { if (fm) fm.follow = false; }
  // espaces à la position (NM depuis le départ de l'étape) et à l'altitude, et le prochain espace rencontré à cette altitude
  function aspAhead(v, nm, ft) {
    const ter = (x) => (v.profile.reduce((m, q) => (Math.abs(q.along - x) < Math.abs(m.along - x) ? q : m), v.profile[0]) || { ft: 0 }).ft;
    const inV = (sg, x) => { const g = ter(x); return ft >= sg.lower + (sg.aglL ? g : 0) && ft <= sg.upper + (sg.aglU ? g : 0); };
    const cur = v.segs.filter((sg) => nm >= sg.from - 1.5 && nm <= sg.to + 1.5 && inV(sg, nm));
    const next = v.segs.filter((sg) => sg.from - 1.5 > nm && !cur.includes(sg) && inV(sg, sg.from)).sort((x, y) => x.from - y.from)[0];
    return { cur, next: next && { sg: next, d: Math.max(0, next.from - 1.5 - nm) } };
  }
  console.assert((() => { const v = { profile: [{ along: 0, ft: 0 }, { along: 20, ft: 0 }], segs: [{ name: 'TMA X (D)', from: 10, to: 20, lower: 3000, upper: 6000 }] }, r = aspAhead(v, 2, 4500);
    return !r.cur.length && r.next && Math.round(r.next.d) === 7 && !aspAhead(v, 2, 2000).next; })(), 'aspAhead');
  // mode en vol : petite coupe avec l'avion, espace actuel et suivant
  function cutNowHtml(lg, best, altFt) {
    const b = lg.brief, v = b.vprofile; if (!v) return '';
    const nm = fm.legs.filter((x) => x.brief === b && x.i < lg.i).reduce((s, x) => s + x.dist, 0) + best.along, ft = altFt ?? lg.ft ?? b.f.ft;
    const a = aspAhead(v, nm, ft);
    return `<div class="if-cut">${cutSvg(v, b, { pos: { nm, ft } })}</div>
      <div class="if-row"><small>${a.cur.length ? `Dans : <b>${esc(a.cur.map((s) => s.name).join(', '))}</b>` : 'Hors espace contrôlé (classe G)'}${a.next ? ` · ensuite <b>${esc(a.next.sg.name)}</b> dans ${a.next.d.toFixed(0)} NM (${esc(a.next.sg.lowerS || a.next.sg.lower)} – ${esc(a.next.sg.upperS || a.next.sg.upper)})${a.next.sg.freq ? ' · ' + esc(a.next.sg.freq) : ''}` : ''}${altFt == null ? ' — altitude prévue (pas d\'altitude GPS)' : ''}</small></div>`;
  }
  // écart par rapport au log : temps (heure de décollage détectée au GPS) et carburant estimé (conso du régime)
  function devHtml(lg, best, p) {
    const b = lg.brief, t0 = fm.t0[b.stage || 1]; if (!t0) return '<div class="if-row"><small>Écarts au log : en attente du décollage (Vs > 40 kt).</small></div>';
    const legsB = fm.legs.filter((x) => x.brief === b), before = legsB.filter((x) => x.i < lg.i), frac = lg.dist ? best.along / lg.dist : 0;
    const planMin = before.reduce((s, x) => s + x.min, 0) + lg.min * frac, planFuel = before.reduce((s, x) => s + x.fuel, 0) + lg.fuel * frac;
    const realMin = (Date.now() - t0) / 6e4, dMin = Math.round(realMin - planMin);
    const estLeft = Math.round(b.loaded - TAXI_L - (b.climb ? b.climb.fuel - TAXI_L : 0) - realMin * b.f.ff / 60), planLeft = Math.round(b.loaded - planFuel);
    const endu = Math.max(0, (estLeft - b.resFuel) / b.f.ff * 60);
    return `<div class="if-grid if-dev"><div><small>Écart temps</small><b class="${dMin > 5 ? 'warnc' : ''}">${dMin >= 0 ? '+' : ''}${dMin} min</b></div>
      <div><small>Carbu. estimé</small><b class="${estLeft < planLeft - 5 ? 'warnc' : ''}">${estLeft} L</b><small>log ${planLeft} L</small></div>
      <div><small>Autonomie avant réserve</small><b class="${endu < 20 ? 'warnc' : ''}">${hhmm(endu)}</b></div></div>`;
  }
  // déroutement : les 3 terrains les plus proches de la position, avec cap, distance, temps, carburant, piste et météo
  function divertHtml(p, v, lg) {
    const varDeg = lg.tc - lg.tm, ff = lg.brief.f.ff;
    const near = A.APTS.map((a) => ({ a, d: distNm(p, [a.la, a.lo]) })).sort((x, y) => x.d - y.d).slice(0, 3);
    return `<div class="if-div">${near.map(({ a, d }) => {
      const m = A.metars[a.icao], vac = vacAt(a.icao) || {}, rw = (vac.rwy || [])[0], min = d / v * 60;
      return `<div class="if-row"><b>${esc(a.icao)}</b> ${esc(a.name)} · Cm <b>${r3((bearing(p, [a.la, a.lo]) - varDeg + 360) % 360)}°</b> · ${d.toFixed(1)} NM · ${Math.round(min)} min · ${Math.max(1, Math.round(min * ff / 60))} L
        <br><small>${rw ? 'piste ' + esc(rw) + (isGrass(vac) ? ' herbe' : '') + ' · ' : ''}${m ? `${esc(m.fltCat || '')} ${esc((m.rawOb || '').replace(/^METAR |^SPECI /, '').slice(0, 70))}` : 'pas de METAR'}${(vac.freqs || [])[0] ? ' · ' + esc(vac.freqs[0].slice(0, 40)) : ''}</small></div>`;
    }).join('')}</div>`;
  }
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
    if (gs != null && gs > 40 && !fm.t0[best.lg.brief.stage || 1]) fm.t0[best.lg.brief.stage || 1] = pos.timestamp;   // décollage détecté
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
      ${cutNowHtml(lg, best, altFt)}
      ${devHtml(lg, best, p)}
      ${fm.divert ? divertHtml(p, v, lg) : ''}
      <div class="if-row"><button class="btn" id="if-follow">${fm.follow ? '🔒 Suivi' : '🎯 Recentrer'}</button><button class="btn" id="if-div">${fm.divert ? '✕ Fermer déroutement' : '🛬 Dérouter'}</button><button class="btn" id="if-cock">${fm.cockpit ? '🗺️ Normal' : '🖥️ Cockpit'}</button><button class="btn" id="if-stop">✕ Quitter</button></div>
      <div class="if-note">Aide à la navigation de secours — ne remplace ni la carte, ni l'estime, ni les instruments.</div>`;
    fm.box.querySelector('#if-stop').onclick = stopFlight;
    fm.box.querySelector('#if-follow').onclick = () => { fm.follow = true; map.setView(p, Math.max(map.getZoom(), 10)); };
    fm.box.querySelector('#if-div').onclick = () => { fm.divert = !fm.divert; onFix(pos); };
    fm.box.querySelector('#if-cock').onclick = () => { fm.cockpit = !fm.cockpit; fm.box.classList.toggle('cockpit', fm.cockpit); onFix(pos); };
    fm.box.classList.toggle('cockpit', !!fm.cockpit);
  }

  // ================================================================== historique des préparations (12)
  const HIST_CACHE = 'aww-history';
  const FORM_KEYS = ['dep', 'arr', 'alt', 'wps', 'time', 'reg', 'regime', 'ft', 'res', 'm1', 'm2', 'm3', 'm4', 'fuel', 'aux', 'cor', 'avoid', 'pil', 'immat', 'empty', 'exit', 'entry', 'stages', 'turn', 'refuel', 'stalts', 'share', 'wxres', 'legft', 'rt', 'stload', 'fuelPrice', 'local', 'ldur', 'lrad'];
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
  // ---- nettoyage du stockage de l'appareil (localStorage et caches qui grossissent au fil des navs)
  // listes cochées « check.<immat>.<terrain>.<AAAA-MM-JJ> » de plus de 30 jours -> supprimées
  const oldChecks = (keys, now = Date.now()) => keys.filter((k) => { const m = /^aww\.prep2\.check\..*\.(\d{4}-\d{2}-\d{2})$/.exec(k); return m && now - Date.parse(m[1]) > 30 * 864e5; });
  console.assert(JSON.stringify(oldChecks(['aww.prep2.check.F-HAFF.LFBP.2026-09-01', 'aww.prep2.check.F-HAFF.LFBP.2026-11-25', 'aww.prep2.form'], Date.parse('2026-11-26'))) === '["aww.prep2.check.F-HAFF.LFBP.2026-09-01"]', 'oldChecks');
  async function cleanStorage() {
    try {
      const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      oldChecks(keys).forEach((k) => localStorage.removeItem(k));
      const snaps = store.get('snaps', {}), seen = store.get('remindSeen', {});   // rappels déjà vus d'une nav qui n'existe plus
      store.set('remindSeen', Object.fromEntries(Object.entries(seen).filter(([k]) => k in snaps)));
    } catch (e) { console.warn('nettoyage localStorage', e); }
    if (!window.caches) return;
    try {   // fichiers d'historique dont la préparation a été retirée de la liste
      const ids = new Set(store.get('hist', []).map((e) => String(e.id))), c = await caches.open(HIST_CACHE);
      for (const r of await c.keys()) { const m = /\/hist\/([^/]+)\//.exec(new URL(r.url).pathname); if (m && !ids.has(m[1])) await c.delete(r); }
    } catch (e) { console.warn('nettoyage historique', e); }
    try {   // VAC gardées hors ligne : les 40 dernières suffisent (ordre d'ajout)
      const c = await caches.open('aww-offline-vac'), k = await c.keys();
      for (const r of k.slice(0, Math.max(0, k.length - 40))) await c.delete(r);
    } catch (e) { console.warn('nettoyage VAC', e); }
  }
  setTimeout(cleanStorage, 20000);
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
    const NUM = ['regime', 'ft', 'res', 'm1', 'm2', 'm3', 'm4', 'fuel', 'aux', 'cor', 'empty', 'turn', 'share', 'wxres'];
    const safe = (k, v) => NUM.includes(k) ? (Number(v) || 0) : k === 'refuel' || k === 'rt' ? v === true || v === 'true' : String(v).replace(/[^A-Za-z0-9 ./+-]/g, '').slice(0, 120);
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
  async function renderNavMap(b, progress, opt = {}) {   // opt.ratio : format de l'image (bande de carte par branche)
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
    const ratio = opt.ratio || 277 / 172;
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
    const u = Math.max(W, H) / 1000;   // unité graphique : proportionnelle au grand côté de l'image (lisible sur A4, bandes verticales comprises)
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

  // SVG -> image JPEG (fond blanc) pour le PDF
  function svgToJpeg(svg, w, h) {
    return new Promise((ok, ko) => {
      const im = new Image(), url = URL.createObjectURL(new Blob([svg.replace('width="100%"', `width="${w}" height="${h}"`)], { type: 'image/svg+xml;charset=utf-8' }));
      im.onload = () => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h); URL.revokeObjectURL(url); ok(cv.toDataURL('image/jpeg', 0.85)); };
      im.onerror = () => { URL.revokeObjectURL(url); ko(new Error('SVG illisible')); };
      im.src = url;
    });
  }
  // Coupe verticale dans le PDF (secours si l'image ne peut pas être faite)
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
  // fichier texte (GPX, FPL) ; ne pas l'appeler « download » : la fonction du même nom (blob, nom) serait écrasée
  const downloadText = (name, text, type) => download(new Blob([text], { type }), name);
  function exportGpx(b) {
    const P = routePoints(b), nm = `${b.userIds[0]}-${b.userIds[b.userIds.length - 1]}`;
    const wpt = P.map((p) => `  <wpt lat="${p.la.toFixed(6)}" lon="${p.lo.toFixed(6)}"><name>${xmlEsc(p.id)}</name><desc>${xmlEsc(p.name)}</desc></wpt>`).join('\n');
    const rte = P.map((p) => `    <rtept lat="${p.la.toFixed(6)}" lon="${p.lo.toFixed(6)}"><name>${xmlEsc(p.id)}</name><desc>${xmlEsc(p.name)}</desc></rtept>`).join('\n');
    downloadText(`route_${nm}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Aero Meteo Webcams Ouest" xmlns="http://www.topografix.com/GPX/1/1">\n${wpt}\n  <rte><name>${xmlEsc(nm)}</name>\n${rte}\n  </rte>\n</gpx>\n`, 'application/gpx+xml');
  }
  function exportFpl(b) {
    const P = routePoints(b), nm = `${b.userIds[0]}-${b.userIds[b.userIds.length - 1]}`;
    const ident = (p, i) => (p.type === 'AIRPORT' ? p.id : (p.id.replace(/-/g, '') || `WP${i}`)).slice(0, 12);
    const wps = P.map((p, i) => `    <waypoint>\n      <identifier>${xmlEsc(ident(p, i))}</identifier>\n      <type>${p.type}</type>\n      <country-code>${p.type === 'AIRPORT' ? 'LF' : ''}</country-code>\n      <lat>${p.la.toFixed(6)}</lat>\n      <lon>${p.lo.toFixed(6)}</lon>\n      <comment>${xmlEsc(p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 /]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25))}</comment>\n      <elevation>${p.alt}</elevation>\n    </waypoint>`).join('\n');
    const rp = P.map((p, i) => `    <route-point>\n      <waypoint-identifier>${xmlEsc(ident(p, i))}</waypoint-identifier>\n      <waypoint-type>${p.type}</waypoint-type>\n      <waypoint-country-code>${p.type === 'AIRPORT' ? 'LF' : ''}</waypoint-country-code>\n    </route-point>`).join('\n');
    downloadText(`route_${nm}.fpl`, `<?xml version="1.0" encoding="utf-8"?>\n<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">\n  <created>${new Date().toISOString().slice(0, 19)}Z</created>\n  <waypoint-table>\n${wps}\n  </waypoint-table>\n  <route>\n    <route-name>${xmlEsc(nm)}</route-name>\n    <flight-plan-index>1</flight-plan-index>\n${rp}\n  </route>\n</flight-plan>\n`, 'application/xml');
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
