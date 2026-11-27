/* Préparation de vol — documents : log Excel (modèle ACB), briefing PDF, carte de navigation, export GPX / plan de vol.
 * Chargé juste après prepavol.js (extras.js), dont il reprend les outils par AWW.prep. */
(() => {
  'use strict';
  const A = window.AWW, PV = A && A.prep;
  if (!PV) return;
  const {
    $, CHECK_ITEMS, MODELS, MOUNTAIN_RULES, WXTXT, airfieldPhoto, alertsOf, checkKey, cutGeom, cutSvg, deadReckoning, destPt, diversions, download, drawGramet, esc, fuelLines, grametSummary, hhmm, histSave, icaoRoute, landmarksOf, latin, loadMargins, nightAlong, ogimetUrl, pnrEtp, r3, rad, radioCard, resolvePt, routeDist, routeMarks, semiCircular, store, tripCost, utc, verdict, vfrOf,
  } = PV;

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
    const elevOf = (id) => { const v = PV.vac() && PV.vac().data && PV.vac().data[id]; const a = A.aptByIcao[id]; return v && v.alt != null ? v.alt : (a && a.elev ? +a.elev : null); };
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
    const vacIds = vacList.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && PV.vac().data[v]);
    const failed = [];
    if (window.PDFLib && (vacIds.length || parts.length > 1)) {
      try {
        const out = await PDFLib.PDFDocument.load(parts[0]);
        for (const p of parts.slice(1)) { const src = await PDFLib.PDFDocument.load(p); (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg)); }
        for (const id of vacIds) {
          progress(`PDF : ajout de la VAC ${id}…`);
          try {
            let r = await fetch(`data/vac/${id}.pdf`).catch(() => null);
            if (!r || !r.ok || !/pdf/.test(r.headers.get('content-type') || '')) r = await fetch(PV.vac().data[id].url);
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
      return { id: id.replace(/[^A-Z0-9-]/g, ''), name: r ? (r.kind === 'ad' ? r.name : (r.desc || id)) : id, la: b.pts[i][0], lo: b.pts[i][1], type: r && r.kind === 'ad' ? 'AIRPORT' : 'USER WAYPOINT', alt: r && r.kind === 'ad' ? (r.ad && PV.vac().data[r.ad] && PV.vac().data[r.ad].alt) || 0 : b.f.ft };
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
  Object.assign(PV, { buildPdf, buildTripPdf, buildXlsx, exportFpl, exportGpx });
  window.AWW_PREP = true;   // préparation complète (prepavol.js + documents) : extras.js laisse passer les clics
})();
