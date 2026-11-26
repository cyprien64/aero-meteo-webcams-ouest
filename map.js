/* Aéro Météo Webcams — France métropolitaine
 * Carte interactive inspirée de international.aero.free.fr/webcams/lfdt.html
 * étendue à tout l'Ouest de la France.
 */
(() => {
  'use strict';

  const BBOX = { s: 41.3, w: -5.6, n: 51.2, e: 9.7 };   // France métropolitaine
  const REFRESH_MS = 10 * 60 * 1000;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('aww.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('aww.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // ---------- Fenêtres webcam (comme les window.open du site d'origine) ----------
  let winOffset = 0;
  function openWin(url, w = 1280, h = 800) {
    const sw = screen.availWidth, sh = screen.availHeight;
    const width = Math.min(w > 0 ? w : sw - 70, sw);
    const height = Math.min(h > 0 ? h : sh - 100, sh);
    winOffset = (winOffset + 30) % 240;
    const left = 10 + winOffset, top = 10 + winOffset;
    if (window.chrome && chrome.windows && chrome.windows.create) {
      chrome.windows.create({ url, type: 'popup', width: Math.round(width), height: Math.round(height), left, top });
    } else {
      window.open(url, '_blank', `resizable=1,scrollbars=1,width=${width},height=${height},left=${left},top=${top}`);
    }
  }

  // ---------- Horloge UTC ----------
  const clock = $('#clock');
  const tick = () => { clock.textContent = new Date().toISOString().slice(11, 19) + ' UTC'; };
  tick(); setInterval(tick, 1000);

  // ---------- Carte ----------
  const view = store.get('view', { c: [46.6, 2.4], z: 6 });
  const map = L.map('map', { zoomSnap: 0.5, minZoom: 5, maxZoom: 15, worldCopyJump: false, preferCanvas: true })
    .setView(view.c, view.z);
  map.on('moveend', () => {
    const c = map.getCenter();
    store.set('view', { c: [+c.lat.toFixed(3), +c.lng.toFixed(3)], z: map.getZoom() });
  });
  map.zoomControl.setPosition('bottomright');
  // verre dépoli coupé pendant les déplacements de la carte (le flou recalculé à chaque image saccade sur tablette)
  map.on('movestart zoomstart', () => document.body.classList.add('moving')).on('moveend zoomend', () => document.body.classList.remove('moving'));
  map.attributionControl.setPrefix('<a href="http://international.aero.free.fr/" target="_blank">Inspiré d\'Inter Aéro</a>');

  map.createPane('basePane').style.zIndex = 150;
  const radarPane = map.createPane('radarPane');
  radarPane.style.zIndex = 350; radarPane.style.opacity = 0.75;
  map.createPane('maskPane').style.zIndex = 360; map.getPane('maskPane').style.pointerEvents = 'none';
  map.createPane('outlinePane').style.zIndex = 395; map.getPane('outlinePane').style.pointerEvents = 'none';
  map.createPane('haloPane').style.zIndex = 590; map.getPane('haloPane').style.pointerEvents = 'none';

  // couleurs du fond « Schéma » : bleu nuit (thème sombre) ou terre claire / mer bleu pâle façon Plans (thème clair)
  const light = () => document.documentElement.dataset.theme === 'light';
  function schemaStyle(k) {
    const L0 = light();
    if (k === 'nb') return L0 ? { color: '#b8b5ab', weight: 1, opacity: .9, fillColor: '#e4e2da', fillOpacity: 1 } : { color: '#ffffff', weight: 1, opacity: .7, fillColor: '#0a6a9c', fillOpacity: 1 };
    if (k === 'reg') return L0 ? { color: '#8e8e93', weight: 1.2, opacity: .8, fill: false } : { color: '#ffffff', weight: 1.4, opacity: .9, fill: false };
    return L0 ? { color: '#a9a69c', weight: .5, opacity: .5, fillColor: '#f5f3ec', fillOpacity: 1 } : { color: '#ffffff', weight: .5, opacity: .25, fillColor: '#0b74aa', fillOpacity: 1 };
  }
  const schema = L.geoJSON(window.BASEMAP, {
    pane: 'basePane', interactive: false, smoothFactor: 2,
    style: (f) => schemaStyle(f.properties.k),
  });
  const tileOpt = { maxZoom: 15 };
  const geopf = (layer, tms, style, priv) => `https://data.geopf.fr/${priv ? 'private/wmts?apikey=ign_scan_ws&' : 'wmts?'}SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=${tms}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg`;
  const GEOPF = window.AWW_GEOPF = {
    oaci: geopf('GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN-OACI', 'PM_6_11', 'normal', true),
    scan1000: geopf('IGNF_CARTES_SCAN-1000', 'PM_0_10', 'SCAN1000'),
    scanreg: geopf('IGNF_CARTES_SCAN-REGIONAL', 'PM_0_12', 'SCANREG'),
  };
  const bases = {
    schema,
    carto: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { ...tileOpt, attribution: '© OpenStreetMap, © CARTO' }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { ...tileOpt, maxNativeZoom: 15, attribution: '© OpenStreetMap, SRTM, © OpenTopoMap' }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { ...tileOpt, attribution: 'Imagerie © Esri' }),
    // Cartes IGN (Géoplateforme) : OACI-VFR 1/500 000, SCAN 1000 (1/1 000 000), SCAN Régional (1/250 000)
    oaci: L.tileLayer(GEOPF.oaci, { minZoom: 5, minNativeZoom: 6, maxNativeZoom: 11, maxZoom: 13, attribution: 'Carte OACI-VFR © IGN / SIA' }),
    scan1000: L.tileLayer(GEOPF.scan1000, { maxNativeZoom: 10, maxZoom: 13, attribution: 'SCAN 1000 © IGN' }),
    scanreg: L.tileLayer(GEOPF.scanreg, { maxNativeZoom: 12, maxZoom: 14, attribution: 'SCAN Régional © IGN' }),
  };
  let currentBase = null;
  function setBase(k) {
    if (!bases[k]) k = 'schema';
    if (currentBase) map.removeLayer(currentBase);
    currentBase = bases[k].addTo(map);
    $('#basemap').value = k;
    store.set('base', k);
  }
  $('#basemap').addEventListener('change', (e) => setBase(e.target.value));
  setBase(store.get('base', 'schema'));

  // ---------- Contour de la France, régions, masque hors France ----------
  const frOutline = L.layerGroup();
  (window.FRANCE || []).forEach((poly) => L.polygon(poly, { pane: 'outlinePane', interactive: false, smoothFactor: 2, color: '#00e5ff', weight: 2.6, opacity: .95, fill: false }).addTo(frOutline));
  (window.BASEMAP && window.BASEMAP.features || []).filter((f) => f.properties.k === 'reg').forEach((f) => L.geoJSON(f, { pane: 'outlinePane', interactive: false, smoothFactor: 2, style: { color: '#ffffff', weight: 1.2, opacity: .55, dashArray: '6 4', fill: false } }).addTo(frOutline));
  const outlineStyle = () => { const L0 = light(); frOutline.eachLayer((l) => l.setStyle(l instanceof L.GeoJSON ? { color: L0 ? '#8e8e93' : '#ffffff' } : { color: L0 ? '#007aff' : '#00e5ff' })); };
  outlineStyle();
  document.addEventListener('aww-theme', () => { schema.setStyle((f) => schemaStyle(f.properties.k)); outlineStyle(); });
  const frMask = L.polygon([[[60, -30], [60, 30], [30, 30], [30, -30]], ...(window.FRANCE || [])], { pane: 'maskPane', interactive: false, stroke: false, fillColor: '#000814', fillOpacity: .38 });
  const syncFr = () => {
    const o = $('#fr-outline').checked, m = $('#fr-mask').checked;
    if (o) frOutline.addTo(map); else map.removeLayer(frOutline);
    if (m) frMask.addTo(map); else map.removeLayer(frMask);
    store.set('fr', { o, m });
  };
  { const s = store.get('fr', { o: true, m: false }); $('#fr-outline').checked = s.o; $('#fr-mask').checked = s.m; }
  $('#fr-outline').addEventListener('change', syncFr); $('#fr-mask').addEventListener('change', syncFr); syncFr();

  // Noms des aérodromes visibles seulement à partir d'un certain zoom
  const updateZoomClass = () => {
    const z = map.getZoom();
    map.getContainer().classList.toggle('z-lo', z < 7);
    map.getContainer().classList.toggle('z-mid', z < 8.5);
    map.getContainer().classList.toggle('z-hi', z >= 10);
  };
  map.on('zoomend', updateZoomClass); updateZoomClass();
  const zs = document.createElement('style');
  zs.textContent = `.z-lo .apt-plain .apt-label{display:none}.z-mid .apt-label small{display:none}.z-lo .apt-metar .apt-label{font-size:10px}.z-hi .apt-label{font-size:15px}.z-hi .apt-label small{font-size:12.5px}`;
  document.head.appendChild(zs);

  // ---------- Icônes ----------
  // webcam : pastille ronde (jaune = aérodrome), pictogramme bleu nuit, ombre douce
  const svgCam = (fill) => `<svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"><circle cx="12" cy="12" r="10.5" fill="${fill}" stroke="#fff" stroke-width="1.6"/><path d="M6.6 9.4c0-.6.5-1.1 1.1-1.1h1.5l.9-1.4h3.8l.9 1.4h1.5c.6 0 1.1.5 1.1 1.1v5.4c0 .6-.5 1.1-1.1 1.1H7.7c-.6 0-1.1-.5-1.1-1.1z" fill="#0b2a44"/><circle cx="12" cy="12.1" r="2.2" fill="${fill}"/></svg>`;
  const svgFlag = `<svg width="18" height="22" viewBox="0 0 18 22"><path d="M3 21V2" stroke="#fff" stroke-width="1.6"/><path d="M3.8 2.5h11l-3 3.5 3 3.5h-11z" fill="#ff4b3e" stroke="#7a0f08" stroke-width=".6"/></svg>`;
  // METAR : pastille de la catégorie de vol, trait de vent vers la direction d'où il vient (longueur selon la force)
  const svgMetar = (cat, m) => {
    const d = m.wdir != null && m.wdir !== 'VRB' && (m.wspd || 0) >= 3 ? +m.wdir : null, len = Math.min(10, 3 + (m.wspd || 0) / 3), y = (17 - 7 - len).toFixed(1);
    const g = (m.wgst || 0) >= 25 ? '<circle cx="17" cy="17" r="10.5" fill="none" stroke="#ff9500" stroke-width="1.6" stroke-dasharray="3 2"/>' : '';
    return `<svg width="34" height="34" viewBox="0 0 34 34" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">${d != null ? `<g transform="rotate(${d} 17 17)"><path d="M17 10V${y}" stroke="#0b2a44" stroke-width="3.4" stroke-linecap="round"/><path d="M17 10V${y}" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>` : ''}${g}<circle cx="17" cy="17" r="7" style="fill:var(--${cat})" stroke="#fff" stroke-width="2.2"/></svg>`;
  };
  const windColor = (kmh) => kmh == null ? '#9aa' : kmh < 10 ? '#3cdc6c' : kmh < 20 ? '#c7f03c' : kmh < 30 ? '#ffb21e' : kmh < 40 ? '#ff5a1e' : '#d11fd1';
  const svgArrow = (deg, col) => `<svg width="26" height="26" viewBox="0 0 26 26" style="transform:rotate(${deg}deg)"><path d="M13 2l6.5 20L13 18l-6.5 4z" fill="${col}" stroke="#002a40" stroke-width="1.2"/></svg>`;

  const divIcon = (html, size, anchor, cls = 'mk') => L.divIcon({ html, className: cls, iconSize: size, iconAnchor: anchor });

  function tipHtml(title, img) {
    return `<b>${esc(title)}</b>${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : ''}<div style="opacity:.7;font-size:11px">Clic : ouvrir</div>`;
  }

  // ---------- Éléments superposés : un clic sur un point entouré d'autres points propose la liste ----------
  const PICK_PX = 16;
  let pickOff = false;   // désactivé pendant les modes coupe / mesure / choix d'un terrain
  function bindPick(mk, label, action) {
    mk._pick = { label, action };
    mk.on('click', (e) => {
      L.DomEvent.stop(e);
      if (pickOff || window.AWW_PICKING) { map.fire('click', { latlng: e.latlng, layerPoint: e.layerPoint, containerPoint: e.containerPoint, originalEvent: e.originalEvent }); return; }
      const near = pickNear(e.latlng);
      if (near.length > 1) showChooser(near, e.latlng); else action();
    });
    return mk;
  }
  function visiblePickables() {
    const out = [];
    const walk = (g) => g.eachLayer((l) => { if (l._pick && l.getLatLng) { if (l._map) out.push(l); } else if (l.eachLayer) walk(l); });
    Object.entries(layers).forEach(([, g]) => { if (map.hasLayer(g)) walk(g); });
    return out;
  }
  function pickNear(ll) {
    const z = map.getZoom(), c = map.project(ll, z);
    return visiblePickables().map((l) => ({ l, d: map.project(l.getLatLng(), z).distanceTo(c) })).filter((x) => x.d <= PICK_PX).sort((a, b) => a.d - b.d).map((x) => x.l);
  }
  function showChooser(list, ll) {
    showList(`${list.length} éléments superposés ici`, `<p class="meta">Plusieurs points se chevauchent à cet endroit : choisis celui à ouvrir (ou zoome sur la carte).</p>
      <div class="chooser">${list.map((l, i) => `<button class="btn wide" data-pick="${i}">${esc(l._pick.label)}</button>`).join('')}</div>
      <div class="row"><button class="btn" id="pick-zoom">🔍 Zoomer ici</button><button class="btn" id="pick-stack">✂️ Espaces aériens au-dessus</button></div>`);
    detailBody.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => list[+b.dataset.pick]._pick.action()));
    $('#pick-zoom').addEventListener('click', () => map.flyTo(ll, Math.min(map.getZoom() + 2, 14), { duration: .5 }));
    $('#pick-stack').addEventListener('click', () => showStack(ll.lat, ll.lng));
  }
  // Halo jaune avec le nombre d'éléments là où des points se chevauchent (recalculé au zoom / déplacement)
  const haloLayer = L.layerGroup().addTo(map);
  let haloTimer = null;
  function drawHalos() {
    clearTimeout(haloTimer);
    haloTimer = setTimeout(() => {
      haloLayer.clearLayers();
      const z = map.getZoom(), b = map.getBounds().pad(.1);
      if (z < 9) return;   // vue large : tout se touche, les halos n'apporteraient que du bruit (le clic propose quand même la liste)
      const pts = visiblePickables().filter((l) => b.contains(l.getLatLng())).map((l) => ({ l, p: map.project(l.getLatLng(), z) }));
      const cell = {}, key = (x, y) => `${x},${y}`;
      pts.forEach((o) => { const k = key(Math.floor(o.p.x / PICK_PX), Math.floor(o.p.y / PICK_PX)); (cell[k] = cell[k] || []).push(o); });
      const used = new Set();
      for (const o of pts) {
        if (used.has(o)) continue;
        const cx = Math.floor(o.p.x / PICK_PX), cy = Math.floor(o.p.y / PICK_PX), grp = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) (cell[key(cx + dx, cy + dy)] || []).forEach((q) => { if (!used.has(q) && q.p.distanceTo(o.p) <= PICK_PX) grp.push(q); });
        if (grp.length < 2) continue;
        grp.forEach((q) => used.add(q));
        const c = map.unproject(L.point(grp.reduce((s, q) => s + q.p.x, 0) / grp.length, grp.reduce((s, q) => s + q.p.y, 0) / grp.length), z);
        L.marker(c, { pane: 'haloPane', interactive: false, icon: L.divIcon({ className: 'halo', html: `<b>${grp.length}</b>`, iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(haloLayer);
      }
    }, 120);
  }
  map.on('zoomend moveend', drawHalos);

  // ---------- Couches de points (webcams, observations, balises) ----------
  // Regroupement des points en vue large : pastilles numérotées qui s'ouvrent quand on zoome (dès le zoom 9 tout est détaillé)
  const KIND = { '📷': 'webcam', '✈️': 'terrain', '🚩': 'observation', '💨': 'balise vent', '📄': 'SUP AIP' };
  const ptsCluster = L.markerClusterGroup({
    disableClusteringAtZoom: 9, maxClusterRadius: 46, showCoverageOnHover: false, spiderfyOnMaxZoom: false, chunkedLoading: true,
    iconCreateFunction: (c) => {
      const kids = c.getAllChildMarkers(), cnt = {};
      kids.forEach((m) => { const k = KIND[((m._pick && m._pick.label) || '').split(' ')[0]] || 'point'; cnt[k] = (cnt[k] || 0) + 1; });
      const n = kids.length, sz = n < 10 ? 30 : n < 40 ? 36 : 42;
      const title = Object.entries(cnt).map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`).join(', ');
      return L.divIcon({ className: 'clu', iconSize: [sz, sz], html: `<b title="${title} — clic pour zoomer">${n}</b>` });
    },
  }).addTo(map);
  const sub = () => L.featureGroup.subGroup(ptsCluster);
  const layers = {
    metar: L.layerGroup(), apt: sub(), camAero: sub(), cam: sub(),
    obs: sub(), wind: sub(), radar: L.layerGroup(), vig: L.layerGroup(), foudre: L.layerGroup(),
    notam: L.layerGroup(), supaip: sub(),
    asp: L.layerGroup(), siv: L.layerGroup(), zones: L.layerGroup(), rtba: L.layerGroup(), vfr: L.layerGroup(),
  };
  let AIR = null, airLoading = null;   // calques espaces aériens (chargés à la demande)
  const searchIndex = []; // {label, sub, lat, lon, action}
  const SOURCES = window.SOURCES || [];
  const fcstByIcao = {};

  for (const s of SOURCES) {
    if (s.t === 'fcst') {
      const m = s.n.match(/LF[A-Z]{2}/g);
      (m || []).forEach((icao) => { fcstByIcao[icao] = s; });
      continue;
    }
    let icon, layer;
    if (s.t === 'cam') {
      layer = s.a ? layers.camAero : layers.cam;
      icon = divIcon(svgCam(s.a ? '#ffd34d' : '#e8f6ff'), [22, 22], [11, 11]);
    } else if (s.t === 'obs') {
      layer = layers.obs; icon = divIcon(svgFlag, [18, 22], [3, 21]);
    } else if (s.t === 'wind') {
      layer = layers.wind;
      icon = divIcon(`<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="#7fffd4" stroke="#003a5c" stroke-width="2"/></svg>`, [18, 18], [9, 9]);
    } else continue;
    const mk = s._mk = L.marker([s.la, s.lo], { icon, title: '', riseOnHover: true })
      .bindTooltip(tipHtml(s.n, s.img), { className: 'tip', direction: 'top', offset: [0, -10] });
    bindPick(mk, (s.t === 'cam' ? '📷 ' : s.t === 'obs' ? '🚩 ' : '💨 ') + s.n, () => openWin(s.u, s.w, s.h));
    mk.addTo(layer);
    searchIndex.push({ label: s.n, sub: s.t === 'cam' ? 'Webcam' : s.t === 'obs' ? 'Observations' : 'Vent', lat: s.la, lon: s.lo, action: () => openWin(s.u, s.w, s.h) });
  }

  // ---------- Aérodromes ----------
  const APTS = (window.AERODROMES || []).map(([icao, name, la, lo, elev, size]) => ({ icao, name, la, lo, elev, size }));
  const aptByIcao = Object.fromEntries(APTS.map((a) => [a.icao, a]));
  const metars = {}, tafs = {};
  const aptMarkers = {};

  function aptIcon(a) {
    const m = metars[a.icao];
    const nN = (NOTAM.ad[a.icao] || []).length, nNew = (NOTAM.ad[a.icao] || []).filter((n) => n.isNew).length;
    const badge = nN ? `<b class="nbadge${nNew ? ' nnew' : ''}" title="${nN} NOTAM${nNew ? ` dont ${nNew} nouveau(x)` : ''}">${nN}</b>` : '';
    const lbl = `<span class="apt-label" style="position:absolute;left:${m ? 27 : 9}px;top:${m ? 5 : -7}px">${a.icao}${badge}<small>${esc(a.name)}</small></span>`;
    if (m) return divIcon(`<div style="position:relative">${svgMetar(m.fltCat || 'UNK', m)}${lbl}</div>`, [34, 34], [17, 17], 'mk apt-metar');
    return divIcon(`<div style="position:relative"><svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="#073450" stroke="#6fe000" stroke-width="2.6"/></svg>${lbl}</div>`, [14, 14], [7, 7], 'mk apt-plain');
  }
  function aptTip(a) {
    const m = metars[a.icao];
    const e = escaleOf(a.icao), fee = feeFor(a.icao);
    const esc2 = e ? `<br>⛽ ${e.none ? 'pas de carburant' : (e.fuel && e.fuel.length ? e.fuel.join(' · ') : '?')}${fee ? ` · taxe ${esc(fee.tarif)}` : ''}` : (fee ? `<br>Taxe ${esc(fee.tarif)}` : '');
    return `<b>${a.icao}</b> ${esc(a.name)}${m ? `<br><span class="cat c-${m.fltCat || 'UNK'}">${m.fltCat || '?'}</span> <code style="font-size:11px">${esc(m.rawOb)}</code>` : ''}${esc2}`;
  }
  function drawAerodromes() {
    layers.metar.clearLayers(); layers.apt.clearLayers();
    for (const a of APTS) {
      const mk = bindPick(L.marker([a.la, a.lo], { icon: aptIcon(a), zIndexOffset: metars[a.icao] ? 500 : 0 })
        .bindTooltip(aptTip(a), { className: 'tip', direction: 'top', offset: [0, -12] }), `✈️ ${a.icao} ${a.name}`, () => showAerodrome(a.icao));
      mk.addTo(metars[a.icao] ? layers.metar : layers.apt);
      aptMarkers[a.icao] = mk;
    }
    // Stations METAR absentes de la base (ex. Espagne) : ajout direct
    for (const m of Object.values(metars)) {
      if (aptByIcao[m.icaoId]) continue;
      const a = { icao: m.icaoId, name: (m.name || '').replace(/,.*$/, ''), la: m.lat, lo: m.lon, elev: Math.round((m.elev || 0) * 3.281) };
      APTS.push(a); aptByIcao[a.icao] = a;
      bindPick(L.marker([a.la, a.lo], { icon: aptIcon(a), zIndexOffset: 500 })
        .bindTooltip(aptTip(a), { className: 'tip', direction: 'top', offset: [0, -12] }), `✈️ ${a.icao} ${a.name}`, () => showAerodrome(a.icao)).addTo(layers.metar);
      searchIndex.push({ label: `${a.icao} ${a.name}`, sub: 'Aérodrome', lat: a.la, lon: a.lo, action: () => showAerodrome(a.icao) });
    }
    drawHalos(); drawFavs();
  }
  for (const a of APTS) searchIndex.push({ label: `${a.icao} ${a.name}`, sub: 'Aérodrome', lat: a.la, lon: a.lo, action: () => showAerodrome(a.icao) });

  // ---------- Données en direct ----------
  const status = $('#status');
  const setStatus = (t) => { status.textContent = t; };
  const bboxParam = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;

  async function getJSON(url, cache = 'no-store') {
    const r = await fetch(url, { cache });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }

  // Extension : appels directs (permissions d'hôte). Site web (GitHub Pages) : fichiers data/live/
  // rafraîchis automatiquement par la GitHub Action (les API officielles bloquent le CORS).
  const IS_EXT = !!(window.chrome && chrome.runtime && chrome.runtime.id);
  const CFG = window.AWW_CONFIG || {};
  const STATIC_LIVE = ['zones.json', 'airspaces.json', 'vac.json', 'escale.json', 'cams_status.json', 'vfr_points.json'];
  async function getLive(name) {
    const bases = IS_EXT && CFG.liveUrl ? [CFG.liveUrl.replace(/\/$/, '') + '/', ''] : [''];
    let last;
    for (const b of bases) {
      const fresh = !STATIC_LIVE.includes(name);
      try { return await getJSON(`${b}data/live/${name}${fresh ? `?t=${Date.now()}` : ''}`, fresh ? 'no-store' : 'default'); } catch (e) { last = e; }
    }
    throw last;
  }

  // ---------- METAR / TAF en direct sur le site (met.no, CORS ouvert) : la GitHub Action peut avoir plusieurs heures de retard ----------
  const toUnix = (dd, hh, mm) => {
    const n = new Date(); let y = n.getUTCFullYear(), mo = n.getUTCMonth();
    if (+dd > n.getUTCDate() + 1) { mo--; if (mo < 0) { mo = 11; y--; } }
    return Date.UTC(y, mo, +dd, +hh, +mm) / 1000;
  };
  function parseMetar(raw) {
    const s = raw.replace(/=\s*$/, '').replace(/\s+/g, ' ').trim();
    const tok = s.split(' ');
    let i = 0, type = 'METAR';
    if (/^(METAR|SPECI)$/.test(tok[0])) type = tok[i++];
    const icao = tok[i++], tm = /^(\d\d)(\d\d)(\d\d)Z$/.exec(tok[i++] || '');
    if (!tm || !/^[A-Z]{4}$/.test(icao)) return null;
    const m = { icaoId: icao, rawOb: s, obsTime: toUnix(tm[1], tm[2], tm[3]), clouds: [], metarType: type };
    let vis = null; const wx = [];
    for (; i < tok.length; i++) {
      const x = tok[i]; let r;
      if (/^(TEMPO|BECMG|NOSIG|RMK)$/.test(x)) break;
      if ((r = /^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/.exec(x))) { const k = r[5] === 'MPS' ? 1.944 : 1; m.wdir = r[1] === 'VRB' ? 'VRB' : +r[1]; m.wspd = Math.round(+r[2] * k); if (r[4]) m.wgst = Math.round(+r[4] * k); continue; }
      if (x === 'CAVOK') { vis = 10000; continue; }
      if ((r = /^(\d{4})(NDV)?$/.exec(x)) && vis == null) { vis = +r[1]; continue; }
      if ((r = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)/.exec(x))) { m.clouds.push({ cover: r[1] === 'VV' ? 'OVX' : r[1], base: r[2] === '///' ? null : +r[2] * 100 }); continue; }
      if ((r = /^(M?\d\d)\/(M?\d\d)?$/.exec(x))) { const f = (v) => v == null ? null : v[0] === 'M' ? -+v.slice(1) : +v; m.temp = f(r[1]); m.dewp = f(r[2]); continue; }
      if ((r = /^Q(\d{4})$/.exec(x))) { m.altim = +r[1]; continue; }
      if (/^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$/.test(x) || /^[-+]?(VC)?(TS|SH)$/.test(x)) wx.push(x);
    }
    if (vis != null) m.visib = vis >= 9999 ? '10+' : +(vis / 1609.34).toFixed(2);
    const unknown = vis == null || m.clouds.some((c) => ['BKN', 'OVC', 'OVX'].includes(c.cover) && c.base == null);   // capteur en panne (////)
    if (wx.length) m.wxString = wx.join(' ');
    const ceil = m.clouds.filter((c) => ['BKN', 'OVC', 'OVX'].includes(c.cover) && c.base != null).reduce((a, c) => Math.min(a, c.base), 99999);
    const vkm = vis == null ? 99 : vis / 1000;
    m.fltCat = unknown && ceil >= 3000 && vkm > 8 ? 'UNK' : ceil < 500 || vkm < 1.6 ? 'LIFR' : ceil < 1000 || vkm < 4.8 ? 'IFR' : ceil <= 3000 || vkm <= 8 ? 'MVFR' : 'VFR';
    return m;
  }
  console.assert(['LFBP 171200Z 24010KT CAVOK 12/10 Q1012', 'LFBP 171200Z 24010KT 9999 OVC003 12/10 Q1012', 'LFBP 171200Z AUTO 24010KT //// BKN/// 12/10 Q1012', 'LFBP 171200Z 24010KT 3000 BKN/// 12/10 Q1012']
    .map((r) => parseMetar(r).fltCat).join() === 'VFR,LIFR,UNK,IFR', 'parseMetar : catégories de vol');
  async function liveMetNo(ids) {
    const q = ids.join(',');
    const [mt, tf] = await Promise.all([
      fetch(`https://api.met.no/weatherapi/tafmetar/1.0/metar.txt?icao=${q}`).then((r) => r.ok ? r.text() : ''),
      fetch(`https://api.met.no/weatherapi/tafmetar/1.0/taf.txt?icao=${q}`).then((r) => r.ok ? r.text() : '').catch(() => ''),
    ]);
    const met = [], taf = [];
    mt.split(/=\s*\n?/).map((l) => l.trim()).filter(Boolean).forEach((l) => { const m = parseMetar(l); if (m) met.push(m); });
    tf.split(/=\s*\n?/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach((l) => {
      const r = /^(?:TAF )?(?:AMD |COR )?([A-Z]{4}) (\d\d)(\d\d)(\d\d)Z/.exec(l);
      if (r) taf.push({ icaoId: r[1], rawTAF: 'TAF ' + l.replace(/^TAF /, ''), issueTime: new Date(toUnix(r[2], r[3], r[4]) * 1000).toISOString() });
    });
    return { met, taf };
  }
  let metarSrc = '';

  async function loadMetarTaf() {
    try {
      const [mt, tf] = IS_EXT ? await Promise.all([
        getJSON(`https://aviationweather.gov/api/data/metar?bbox=${bboxParam}&format=json`),
        getJSON(`https://aviationweather.gov/api/data/taf?bbox=${bboxParam}&format=json`).catch(() => []),
      ]) : await Promise.all([
        getLive('metar.json').then((d) => d.data),
        getLive('taf.json').then((d) => d.data).catch(() => []),
      ]);
      for (const k of Object.keys(metars)) delete metars[k];
      for (const m of mt) {
        const keep = aptByIcao[m.icaoId] || /^LE/.test(m.icaoId);
        if (!keep) continue;
        if (!metars[m.icaoId] || metars[m.icaoId].obsTime < m.obsTime) metars[m.icaoId] = m;
      }
      for (const t of tf) if (!tafs[t.icaoId] || tafs[t.icaoId].issueTime < t.issueTime) tafs[t.icaoId] = t;
      metarSrc = IS_EXT ? 'direct' : 'collecte';
      if (!IS_EXT) {   // site : on complète par les observations en direct
        try {
          const ids = [...new Set([...Object.keys(metars), ...STATIONS])].filter((k) => /^(LF|LE)/.test(k));
          const live = await liveMetNo(ids);
          let n = 0;
          for (const m of live.met) {
            const old = metars[m.icaoId], a = aptByIcao[m.icaoId];
            if (!old && !a) continue;
            if (old && old.obsTime >= m.obsTime) continue;
            metars[m.icaoId] = { ...(old || {}), lat: old ? old.lat : a.la, lon: old ? old.lon : a.lo, elev: old ? old.elev : Math.round((+a.elev || 0) / 3.281), name: old ? old.name : a.name, ...m };
            n++;
          }
          for (const t of live.taf) if (!tafs[t.icaoId] || tafs[t.icaoId].issueTime < t.issueTime) tafs[t.icaoId] = { ...(tafs[t.icaoId] || {}), ...t };
          metarSrc = 'direct';   // source directe consultée (même si elle n'avait rien de plus récent que la collecte)
        } catch (e) { console.warn('METAR direct (met.no) indisponibles, données de la collecte', e); }
      }
      Object.keys(metars).forEach((k) => STATIONS.add(k)); store.set('stations', [...STATIONS]);
      drawAerodromes();
      const newest = Math.max(...Object.values(metars).map((m) => m.obsTime || 0));
      const age = Math.round((Date.now() / 1000 - newest) / 60);
      const hhmm = (d) => d.toISOString().slice(11, 16);
      const nxt = new Date(Math.floor(newest / 1800) * 1800e3 + 1800e3 + 5 * 6e4);   // METAR toutes les 30 min, publiés ~5 min après
      setStatus(`${Object.keys(metars).length} METAR · ${Object.keys(tafs).length} TAF · ${metarSrc === 'direct' ? 'en direct' : 'collecte'} · dernier METAR ${hhmm(new Date(newest * 1000))} UTC (il y a ${age} min), prochain vers ${hhmm(nxt)}`);
      status.style.color = age > 45 ? 'var(--warn-text)' : '';
      if (openedIcao) showAerodrome(openedIcao, false);
    } catch (e) {
      console.warn(e);
      drawAerodromes();
      setStatus('METAR indisponibles (connexion ?) — nouvel essai dans 10 min');
      throw e;
    }
  }
  const STATIONS = new Set(store.get('stations', []));

  let windLive = [];
  async function loadPiouPiou() {
    try {
      const d = (await getJSON('https://api.pioupiou.fr/v1/live/all')).data || [];
      windLive.forEach((m) => layers.wind.removeLayer(m)); windLive = [];
      const now = Date.now();
      for (const p of d) {
        const loc = p.location || {}, me = p.measurements || {};
        if (loc.latitude == null || loc.longitude == null) continue;
        if (loc.latitude < BBOX.s || loc.latitude > BBOX.n || loc.longitude < BBOX.w || loc.longitude > BBOX.e) continue;
        if (!me.date || now - Date.parse(me.date) > 3 * 3600e3 || (p.status && p.status.state !== 'on')) continue;
        const avg = me.wind_speed_avg, max = me.wind_speed_max, hd = me.wind_heading;
        const icon = divIcon(svgArrow((hd ?? 0) + 180, windColor(avg)), [26, 26], [13, 13]);
        const name = (p.meta && p.meta.name) || 'PiouPiou ' + p.id;
        const age = Math.round((now - Date.parse(me.date)) / 60000);
        const wm = bindPick(L.marker([loc.latitude, loc.longitude], { icon })
          .bindTooltip(`<b>${esc(name)}</b> (OpenWindMap)<br>Vent ${hd ?? '?'}° · moy ${avg ?? '?'} km/h · rafales ${max ?? '?'} km/h<br><span style="opacity:.7">il y a ${age} min</span>`, { className: 'tip', direction: 'top' }),
        `💨 ${name}`, () => openWin(`https://www.openwindmap.org/PP${p.id}`, 800, 0));
        layers.wind.addLayer(wm); windLive.push(wm);
      }
    } catch (e) { console.warn('pioupiou', e); throw e; }
  }

  // ---------- Radar pluie (RainViewer) ----------
  let radarFrames = [], radarIdx = 0, radarTimer = null, radarLayers = [], radarPlaying = true;
  async function loadRadar() {
    try {
      const d = await getJSON('https://api.rainviewer.com/public/weather-maps.json');
      radarFrames = ((d.radar && d.radar.past) || []).slice(-6); // 1 h, limite le nombre de tuiles
      radarLayers.forEach((l) => layers.radar.removeLayer(l));
      radarLayers = radarFrames.map((f) => L.tileLayer(`${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        pane: 'radarPane', opacity: 0, maxNativeZoom: 7, maxZoom: 15, attribution: 'Radar © RainViewer',
      }));
      radarLayers.forEach((l) => layers.radar.addLayer(l));
      radarIdx = radarFrames.length - 1;
      showRadarFrame();
    } catch (e) { console.warn('radar', e); $('#radar-time').textContent = 'indisponible'; }
  }
  function showRadarFrame() {
    radarLayers.forEach((l, i) => l.setOpacity(i === radarIdx ? 1 : 0));
    const f = radarFrames[radarIdx];
    if (f) $('#radar-time').textContent = new Date(f.time * 1000).toISOString().slice(11, 16) + ' UTC';
  }
  function radarLoop(on) {
    clearInterval(radarTimer);
    if (on && radarPlaying) radarTimer = setInterval(() => {
      radarIdx = (radarIdx + 1) % Math.max(radarLayers.length, 1); showRadarFrame();
    }, 900);
  }
  $('#radar-play').addEventListener('click', () => {
    radarPlaying = !radarPlaying; $('#radar-play').textContent = radarPlaying ? '⏸' : '▶';
    radarLoop(map.hasLayer(layers.radar));
  });

  // ---------- Vigilance Météo-France (flux MeteoAlarm, collecté avec le reste) et éclairs (satellite MTG, EUMETSAT) ----------
  let VIG = null;
  const VIG_COL = ['', '#ffd60a', '#ff8a00', '#e3001b'], VIG_TXT = ['', 'jaune', 'orange', 'rouge'];
  const normDep = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-'’]/g, ' ');
  const DEPS = (window.BASEMAP && window.BASEMAP.features || []).filter((f) => f.properties.k === 'dep');
  const vigOf = (name, a = Date.now(), b = a) => ((VIG && VIG.byNorm[normDep(name)]) || []).filter((w) => Date.parse(w.from) <= b && Date.parse(w.to) >= a);
  async function loadVig() {
    const d = await getLive('vigilance.json');
    VIG = { ...d, byNorm: Object.fromEntries(Object.entries(d.deps || {}).map(([k, v]) => [normDep(k), v])) };
    if (map.hasLayer(layers.vig)) drawVig();
  }
  function drawVig() {
    layers.vig.clearLayers();
    if (!VIG) return;
    for (const f of DEPS) {
      const w = vigOf(f.properties.n, Date.now(), Date.now() + 24 * 3600e3);
      if (!w.length) continue;
      const lvl = Math.max(...w.map((x) => x.lvl));
      const hm = (s) => new Date(s).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      L.geoJSON(f, { smoothFactor: 2, style: { color: VIG_COL[lvl], weight: 2, fillColor: VIG_COL[lvl], fillOpacity: lvl > 1 ? .32 : .16 } })
        .bindTooltip(`<b>${esc(f.properties.n)}</b> — vigilance ${VIG_TXT[lvl]}<br>${w.sort((x, y) => y.lvl - x.lvl).map((x) => `<span style="color:${VIG_COL[x.lvl]}">●</span> ${esc(x.ph)} (${VIG_TXT[x.lvl]}) : ${hm(x.from)} → ${hm(x.to)}`).join('<br>')}<br><span style="opacity:.7">Météo-France via MeteoAlarm — prochaines 24 h</span>`, { className: 'tip', sticky: true })
        .addTo(layers.vig);
    }
  }
  // Vigilance sur un point (pour la préparation de vol)
  const inRing = (lo, la, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / (yj - yi) + xi) c = !c; } return c; };
  function depAt(la, lo) {
    return DEPS.find((f) => { const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; return polys.some((p) => inRing(lo, la, p[0])); });
  }
  let foudreLayer = null, foudreTimer = null;
  function setFoudre(on) {
    clearInterval(foudreTimer);
    if (!on) { layers.foudre.clearLayers(); foudreLayer = null; return; }
    if (!foudreLayer) foudreLayer = L.tileLayer.wms('https://view.eumetsat.int/geoserver/wms', { layers: 'mtg_fd:li_afa', format: 'image/png', transparent: true, version: '1.3.0', opacity: .9, attribution: 'Éclairs : EUMETSAT MTG Lightning Imager' }).addTo(layers.foudre);
    foudreTimer = setInterval(() => foudreLayer.setParams({ _t: Date.now() }), 5 * 60 * 1000);   // dernière image toutes les 5 min
  }

  // ---------- Gestion des calques ----------
  const layerState = store.get('layers', {});
  document.querySelectorAll('input[data-layer]').forEach((cb) => {
    const k = cb.dataset.layer;
    if (k in layerState) cb.checked = layerState[k];
    const apply = () => {
      if (cb.checked) layers[k].addTo(map); else map.removeLayer(layers[k]);
      drawHalos();
      if (cb.checked && ['asp', 'siv', 'zones', 'rtba', 'vfr'].includes(k)) loadAirLayers();
      layerState[k] = cb.checked; store.set('layers', layerState);
      if (k === 'foudre') setFoudre(cb.checked);
      if (k === 'vig' && cb.checked) drawVig();
      if (k === 'radar') {
        $('#radar-ctrl').hidden = !cb.checked;
        if (cb.checked && !radarFrames.length) loadRadar().then(() => radarLoop(true));
        else radarLoop(cb.checked);
      }
    };
    cb.addEventListener('change', apply); apply();
  });

  // ---------- Fiche aérodrome ----------
  const detail = $('#detail'), detailBody = $('#detail-body');
  let openedIcao = null;
  $('#detail-close').addEventListener('click', () => { detail.hidden = true; openedIcao = null; });

  const toRad = (d) => d * Math.PI / 180;
  function distKm(a, b, c, d) {
    const x = toRad(d - b) * Math.cos(toRad((a + c) / 2)), y = toRad(c - a);
    return Math.sqrt(x * x + y * y) * 6371;
  }
  const fmtCoord = (v, p, n) => `${Math.abs(v).toFixed(3)}${v >= 0 ? p : n}`;

  function decodeMetar(m) {
    const rows = [];
    if (m.obsTime) {
      const age = Math.round((Date.now() / 1000 - m.obsTime) / 60);
      rows.push(['Observé', `${new Date(m.obsTime * 1000).toISOString().slice(11, 16)} UTC (il y a ${age} min)`]);
    }
    if (m.wdir != null) rows.push(['Vent', `${m.wdir === 'VRB' ? 'Variable' : m.wdir + '°'} ${m.wspd ?? 0} kt${m.wgst ? ' rafales ' + m.wgst + ' kt' : ''}`]);
    if (m.visib != null) {
      const v = String(m.visib).includes('+') ? '≥ 10 km' : `${Math.round(parseFloat(m.visib) * 1.609 * 10) / 10} km`;
      rows.push(['Visibilité', v]);
    }
    if (m.wxString) rows.push(['Temps', m.wxString]);
    if (m.clouds && m.clouds.length) rows.push(['Nuages', m.clouds.map((c) => c.cover + (c.base != null ? ' ' + c.base + ' ft' : '')).join(', ')]);
    if (m.temp != null) rows.push(['Temp / Rosée', `${m.temp} °C / ${m.dewp ?? '?'} °C`]);
    if (m.altim != null) rows.push(['QNH', `${Math.round(m.altim)} hPa`]);
    return `<dl class="decoded">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  // ---------- TAF en clair : une ligne par période (base, BECMG, TEMPO, PROB, FM) ----------
  const WX_FR = { MI: 'mince', BC: 'en bancs', PR: 'partiel', DR: 'chasse basse', BL: 'chasse haute', SH: 'averses', TS: 'orage', FZ: 'se congelant',
    DZ: 'bruine', RA: 'pluie', SN: 'neige', SG: 'neige en grains', PL: 'granules de glace', GR: 'grêle', GS: 'grésil', UP: 'précipitations',
    BR: 'brume', FG: 'brouillard', FU: 'fumée', VA: 'cendres', DU: 'poussière', SA: 'sable', HZ: 'brume sèche', PO: 'tourbillons', SQ: 'grains', FC: 'trombe', SS: 'tempête de sable', DS: 'tempête de poussière' };
  const SKY_FR = { FEW: 'quelques nuages', SCT: 'nuages épars', BKN: 'nuages fragmentés', OVC: 'ciel couvert' };
  const tafH = (dd, hh, mm) => `${+dd} à ${+hh} h${mm && mm !== '00' ? ' ' + mm : ''}`;
  const tafSpan = (s) => { const r = /^(\d\d)(\d\d)\/(\d\d)(\d\d)$/.exec(s); return r && (r[1] === r[3] ? `le ${+r[1]} de ${+r[2]} h à ${+r[4]} h` : `du ${tafH(r[1], r[2])} au ${tafH(r[3], r[4])}`); };
  function tafToken(t) {
    let r;
    if ((r = /^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(t))) return +r[2] === 0 ? 'vent calme' : `vent ${r[1] === 'VRB' ? 'variable' : r[1] + '°'} ${+r[2]} kt${r[3] ? ` rafales ${+r[3]} kt` : ''}`;
    if ((r = /^(\d{3})V(\d{3})$/.exec(t))) return `direction variant de ${r[1]}° à ${r[2]}°`;
    if (/^\d{4}$/.test(t)) return t === '9999' ? 'visibilité ≥ 10 km' : `visibilité ${+t < 1000 ? +t + ' m' : (+t / 1000).toLocaleString('fr') + ' km'}`;
    if (t === 'CAVOK') return 'CAVOK (visibilité ≥ 10 km, pas de nuage sous 5000 ft, pas de CB)';
    if (t === 'NSW') return 'fin du temps significatif';
    if (t === 'NSC' || t === 'SKC') return 'pas de nuage significatif';
    if ((r = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/.exec(t))) {
      const h = r[2] === '///' ? '?' : +r[2] * 100;
      return r[1] === 'VV' ? `ciel invisible, visibilité verticale ${h} ft` : `${SKY_FR[r[1]]} à ${h} ft${r[3] ? (r[3] === 'CB' ? ' (cumulonimbus)' : ' (cumulus bourgeonnants)') : ''}`;
    }
    if ((r = /^T([XN])(M?\d\d)\/(\d\d)(\d\d)Z$/.exec(t))) return `température ${r[1] === 'X' ? 'max' : 'min'} ${r[2].replace('M', '-')} °C le ${tafH(r[3], r[4])}`;
    if ((r = /^(\+|-|VC)?((?:MI|BC|PR|DR|BL|SH|TS|FZ)*)((?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*)$/.exec(t)) && (r[2] || r[3])) {
      const words = (r[2] + r[3]).match(/../g).map((c) => WX_FR[c]);
      return `${r[1] === '+' ? 'fort(e) ' : r[1] === '-' ? 'faible ' : ''}${words.join(' ')}${r[1] === 'VC' ? ' au voisinage' : ''}`;
    }
    return `(${t})`;
  }
  function tafPlain(raw) {
    const toks = raw.replace(/=\s*$/, '').trim().split(/\s+/);
    const out = [];
    let cur = null, i = 0;
    while (i < toks.length && !/^\d{4}\/\d{4}$/.test(toks[i])) i++;   // saute TAF, AMD, code OACI, heure d'émission
    if (i < toks.length) { cur = { k: `Valable ${tafSpan(toks[i])} (heures UTC)`, v: [] }; out.push(cur); i++; }
    const isProb = () => cur && /^Probabilité/.test(cur.k) && !cur.v.length;
    for (; i < toks.length; i++) {
      const t = toks[i]; let r;
      if (t === 'RMK') break;
      if ((r = /^PROB(\d\d)$/.exec(t))) { cur = { k: `Probabilité ${r[1]} %`, v: [] }; out.push(cur); continue; }
      if (t === 'BECMG' || t === 'TEMPO') {
        const lab = t === 'BECMG' ? 'Évolution progressive' : 'Temporairement';
        if (isProb() && !/,/.test(cur.k)) cur.k += ', ' + lab.toLowerCase(); else { cur = { k: lab, v: [] }; out.push(cur); }
        if (tafSpan(toks[i + 1] || '')) cur.k += ' ' + tafSpan(toks[++i]);
        continue;
      }
      if ((r = /^FM(\d\d)(\d\d)(\d\d)$/.exec(t))) { cur = { k: `À partir du ${tafH(r[1], r[2], r[3])}`, v: [] }; out.push(cur); continue; }
      if (isProb() && tafSpan(t)) { cur.k += ' ' + tafSpan(t); continue; }
      if (cur) cur.v.push(tafToken(t));
    }
    return out;
  }
  {
    const p = tafPlain('TAF LFBP 171100Z 1712/1812 24010KT 9999 SCT030 BECMG 1714/1716 27015G25KT TEMPO 1718/1722 4000 SHRA BKN012CB PROB30 TEMPO 1800/1806 0800 FG=');
    console.assert(p.length === 4 && p[0].k === 'Valable du 17 à 12 h au 18 à 12 h (heures UTC)' && p[0].v.join('|') === 'vent 240° 10 kt|visibilité ≥ 10 km|nuages épars à 3000 ft', 'tafPlain base', p[0]);
    console.assert(!tafPlain('TAF LFXX 171100Z NIL=').length, 'tafPlain NIL -> TAF brut affiché');
    console.assert(p[1].k === 'Évolution progressive le 17 de 14 h à 16 h' && p[1].v[0] === 'vent 270° 15 kt rafales 25 kt', 'tafPlain becmg', p[1]);
    console.assert(p[2].v.join('|') === 'visibilité 4 km|averses pluie|nuages fragmentés à 1200 ft (cumulonimbus)', 'tafPlain tempo', p[2]);
    console.assert(p[3] && p[3].k === 'Probabilité 30 %, temporairement le 18 de 0 h à 6 h' && p[3].v.join('|') === 'visibilité 800 m|brouillard', 'tafPlain prob', p[3]);
  }
  const tafHtml = (raw) => { const p = tafPlain(raw); return p.length ? `<ul class="taf-plain">${p.map((g) => `<li><b>${esc(g.k)}</b>${g.v.length ? ' : ' + esc(g.v.join(', ')) : ''}</li>`).join('')}</ul>` : `<p class="taf-plain">${esc(raw)}</p>`; };

  function showAerodrome(icao, fly = true) {
    const a = aptByIcao[icao]; if (!a) return;
    openedIcao = icao;
    const m = metars[icao], t = tafs[icao];
    const near = SOURCES.filter((s) => s.t !== 'fcst').map((s) => ({ s, d: distKm(a.la, a.lo, s.la, s.lo) }))
      .filter((x) => x.d <= 25).sort((x, y) => x.d - y.d);
    const cams = near.filter((x) => x.s.t === 'cam').slice(0, 12);
    const others = near.filter((x) => x.s.t !== 'cam').slice(0, 8);
    const lat = fmtCoord(a.la, 'N', 'S'), lon = fmtCoord(a.lo, 'E', 'W');
    const hero = (cams.find((x) => x.s.img && !x.s.oldPreview && !x.s.dead && !x.s.frozen && x.d <= 10) || {}).s?.img;   // image de webcam proche en bandeau
    // format reconnu par meteoblue : lat N, longitude signée E, altitude en m, fuseau (sinon il renvoie vers Paris)
    const mb = `${a.la.toFixed(3)}N${a.lo.toFixed(3)}E${Math.round((+a.elev || 0) / 3.281)}_Europe%2FParis`;
    const links = [
      ['📈 Météogramme meteoblue', `https://www.meteoblue.com/fr/meteo/prevision/meteogramweb/${mb}`, 1200, 0],
      ['Meteoblue 7 jours', `https://www.meteoblue.com/fr/meteo/semaine/${mb}`, 1200, 0],
      ['Windy', `https://www.windy.com/?${a.la},${a.lo},10`, 1200, 0],
      ['METAR/TAF 12 h', `https://aviationweather.gov/api/data/metar?ids=${icao}&hours=12&sep=true&taf=true`, 1100, 0],
      ['Fiche Aerobreak', `https://map.aerobreak.com/aerodrome-${icao}.html`, 1280, 0],
      ['Carte OACI Géoportail', `https://www.geoportail.gouv.fr/carte?c=${a.lo},${a.la}&z=11&l0=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN-OACI::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`, 1400, 0],
      ['Trafic SafeSky', `https://live.safesky.app/map?lat=${a.la}&lng=${a.lo}&zoom=10`, 1400, 0],
    ];
    if (fcstByIcao[icao]) links.unshift(['Prévisions Inter Aéro', fcstByIcao[icao].u, 1174, 984]);
    const html = `
      <div class="ad-hero${hero ? '' : ' noimg'}"${hero ? ` style="background-image:url('${esc(hero)}')"` : ''}>
        <div class="ad-hero-txt"><h3><span class="icao">${icao}</span> ${esc(a.name)} <button class="fav-star${favs().includes(icao) ? ' on' : ''}" id="fav-star" title="Ajouter / retirer des favoris">${favs().includes(icao) ? '★' : '☆'}</button></h3>
        <p>${lat} ${lon}${a.elev !== '' && a.elev != null ? ` · ${a.elev} ft` : ''}</p></div></div>
      ${m ? `<div class="ad-now"><span class="ad-cat c-${m.fltCat || 'UNK'}">${m.fltCat || '?'}</span><div>${[m.wdir != null ? `vent ${m.wdir === 'VRB' ? 'variable' : String(m.wdir).padStart(3, '0') + '°'} ${m.wspd} kt${m.wgst ? ` rafales ${m.wgst}` : ''}` : '', m.temp != null ? `${Math.round(m.temp)} °C` : '', m.altim ? `QNH ${Math.round(m.altim)}` : ''].filter(Boolean).map(esc).join(' · ')}<small>METAR ${esc((m.rawOb.match(/\b\d{6}Z\b/) || [''])[0])}</small></div>${rwyDiagram(icao, m)}</div>
        <h4>METAR</h4><pre>${esc(m.rawOb)}</pre>${decodeMetar(m)}${rwyWindHtml(icao, m)}` : '<p class="meta">Pas de METAR pour cet aérodrome — voir la station la plus proche.</p>'}
      ${t ? `<h4>TAF <span class="seg" id="taf-mode"><button data-m="clair">En clair</button><button data-m="code">Codé</button></span></h4>
        <div class="taf-box" data-m="${store.get('tafMode', 'clair')}">${tafHtml(t.rawTAF)}<pre>${esc(t.rawTAF.replace(/\s(?=(BECMG|TEMPO|PROB\d\d|FM\d{6}))/g, '\n  '))}</pre></div>` : ''}
      ${!m ? nearestMetarHtml(a) : ''}
      ${escaleHtml(icao)}
      ${pratiqueHtml(icao, a)}
      ${notamAdHtml(icao)}
      ${supNearHtml(a)}
      <h4>Liens météo</h4>
      <div class="row">${links.map((l, i) => `<button class="btn" data-link="${i}">${esc(l[0])}</button>`).join('')}</div>
      <h4>Webcams à moins de 25 km (${cams.length})</h4>
      ${cams.length ? `<div class="cams">${cams.map((x, i) => `
        <div class="cam" data-cam="${i}" title="${esc(x.s.n)}">
          ${x.s.img && !x.s.oldPreview ? `<img src="${esc(x.s.img)}" loading="lazy" alt="">` : '<div class="noimg">📷</div>'}
          <span>${x.s.dead ? '⛔ ' : x.s.frozen ? '⚠️ figée · ' : ''}${esc(x.s.n)} · ${x.d.toFixed(0)} km</span>
        </div>`).join('')}</div>` : '<p class="meta">Aucune webcam référencée à proximité.</p>'}
      ${others.length ? `<h4>Observations & vent à proximité</h4><div class="row">${others.map((x, i) => `<button class="btn" data-other="${i}">${x.s.t === 'obs' ? '🚩' : '💨'} ${esc(x.s.n.replace(/\s*\(.*$/, ''))} · ${x.d.toFixed(0)} km</button>`).join('')}</div>` : ''}
    `;
    detailBody.innerHTML = html;
    detailBody.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('div'), { className: 'noimg', textContent: '📷' })); }));
    detailBody.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => { const l = links[+b.dataset.link]; openWin(l[1], l[2], l[3]); }));
    detailBody.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => { const s = cams[+b.dataset.cam].s; openWin(s.u, s.w, s.h); }));
    detailBody.querySelectorAll('[data-other]').forEach((b) => b.addEventListener('click', () => { const s = others[+b.dataset.other].s; openWin(s.u, s.w, s.h); }));
    detailBody.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showAerodrome(b.dataset.goto)));
    bindEscale(detailBody, icao);
    bindPratique(detailBody, icao, a);
    $('#fav-star').addEventListener('click', () => { const f = favs(); store.set('favs', f.includes(icao) ? f.filter((x) => x !== icao) : [...f, icao]); drawFavs(); showAerodrome(icao, false); });
    bindDocLinks(detailBody);
    const tafBox = detailBody.querySelector('.taf-box');
    if (tafBox) detailBody.querySelectorAll('#taf-mode button').forEach((b) => b.addEventListener('click', () => { tafBox.dataset.m = b.dataset.m; store.set('tafMode', b.dataset.m); }));
    detailBody.insertAdjacentHTML('beforeend', '<h4>Espaces aériens</h4><button class="btn" id="ad-stack">✂️ Coupe des espaces au-dessus du terrain (règles, fréquences)</button>');
    $('#ad-stack').addEventListener('click', () => showStack(a.la, a.lo, `Espaces au-dessus de ${icao}`));
    detail.hidden = false;
    if (fly) map.flyTo([a.la, a.lo], Math.max(map.getZoom(), 9), { duration: .6 });
  }

  // Schéma de la piste la mieux orientée avec la flèche du vent (vue du dessus, nord en haut)
  function rwyDiagram(icao, m) {
    const e = escaleOf(icao), q = ((e && e.qfu) || []).map(Number).filter((x) => x > 0);
    if (!q.length || m.wdir == null || m.wdir === 'VRB' || !m.wspd) return '';
    const h = q.sort((x, y) => Math.cos((m.wdir - y) * Math.PI / 180) - Math.cos((m.wdir - x) * Math.PI / 180))[0];
    const r = (m.wdir - h) * Math.PI / 180, hw = Math.round(m.wspd * Math.cos(r)), xw = Math.abs(Math.round(m.wspd * Math.sin(r)));
    const rn = String(Math.round(h / 10) % 36 || 36).padStart(2, '0');
    return `<div class="rwy-box"><svg class="rwy-dia" viewBox="0 0 64 64" aria-hidden="true">
      <g transform="rotate(${h} 32 32)"><rect x="27" y="8" width="10" height="48" rx="2" class="rd-rwy"/><path d="M32 12v40" class="rd-axis"/></g>
      <g transform="rotate(${m.wdir} 32 32)"><path d="M32 2v14M27.5 11 32 17l4.5-6" class="rd-wind"/></g>
      </svg><small>Piste ${rn}<br>${hw >= 0 ? 'face' : 'arrière'} ${Math.abs(hw)} kt<br>travers ${xw} kt</small></div>`;
  }
  // Vent dans l'axe de chaque piste (QFU de la VAC) : face / arrière et travers, rafales comprises
  function rwyWindHtml(icao, m) {
    const e = escaleOf(icao), q = ((e && e.qfu) || []).map(Number).filter((x) => x > 0);
    if (!q.length || m.wdir == null) return '';
    if (m.wdir === 'VRB' || !m.wspd) return `<p class="meta">Vent ${m.wdir === 'VRB' ? 'variable' : 'calme'} ${m.wspd || 0} kt : toutes les pistes.</p>`;
    const rows = q.map((h) => {
      const r = (m.wdir - h) * Math.PI / 180, hw = Math.round(m.wspd * Math.cos(r)), xw = Math.round(m.wspd * Math.sin(r));
      const gx = m.wgst ? Math.abs(Math.round(m.wgst * Math.sin(r))) : null;
      return { h, hw, xw, gx };
    }).sort((x, y) => y.hw - x.hw);
    return `<table class="rwy-w">${rows.map((x, i) => `<tr${i === 0 ? ' class="best"' : ''}><td>QFU ${String(x.h).padStart(3, '0')}</td><td>${x.hw >= 0 ? 'face' : '<b style="color:#ff6b6b">arrière</b>'} ${Math.abs(x.hw)} kt</td><td>travers ${Math.abs(x.xw)} kt ${x.xw ? (x.xw > 0 ? 'de droite' : 'de gauche') : ''}${x.gx ? ` (rafales ${x.gx})` : ''}</td></tr>`).join('')}</table>`;
  }
  // Terrains favoris : boutons en haut du panneau (catégorie de vol + vent)
  const favs = () => store.get('favs', ['LFBP']);
  function drawFavs() {
    const el = $('#favs'); if (!el) return;
    el.innerHTML = favs().map((i) => {
      const m = metars[i];
      return `<button data-fav="${i}" title="${esc((aptByIcao[i] || {}).name || '')}${m ? ' — ' + esc(m.rawOb) : ''}"><i class="dot c-${m ? m.fltCat || 'UNK' : 'NONE'}"></i>${i}${m && m.wdir != null ? `<small>${m.wdir === 'VRB' ? 'VRB' : String(m.wdir).padStart(3, '0')}/${m.wspd}${m.wgst ? 'G' + m.wgst : ''}</small>` : ''}</button>`;
    }).join('') + '<span class="meta fav-hint">★ dans une fiche pour ajouter</span>';
    el.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', () => { highlight((aptByIcao[b.dataset.fav] || {}).la, (aptByIcao[b.dataset.fav] || {}).lo, b.dataset.fav); showAerodrome(b.dataset.fav); }));
  }

  function nearestMetarHtml(a) {
    const list = Object.values(metars).map((m) => ({ m, d: distKm(a.la, a.lo, m.lat, m.lon) })).sort((x, y) => x.d - y.d).slice(0, 3);
    if (!list.length) return '';
    return `<h4>METAR les plus proches</h4>${list.map(({ m, d }) => `
      <p style="margin:4px 0"><button class="btn" data-goto="${m.icaoId}">${m.icaoId} · ${d.toFixed(0)} km</button>
      <span class="cat c-${m.fltCat || 'UNK'}">${m.fltCat || '?'}</span></p><pre>${esc(m.rawOb)}</pre>`).join('')}`;
  }

  // ---------- Outils (équivalents des boutons du site d'origine) ----------
  const metarIds = () => Object.keys(metars).filter((k) => k.startsWith('LF')).sort().join(',');
  const TOOLS = [
    ['🛰 Satellite France', 'https://neige.meteociel.fr/satellite/anim_vis_fr.gif', 778, 778],
    ['🛰 Satellite Europe', 'https://modeles20.meteociel.fr/satellite/animsatviscolmtgeu.gif', 778, 778],
    ['📡 Radar Sud-Ouest', 'http://international.aero.free.fr/xxx_weather/radar_south-west.html', 839, 601],
    ['📡 Radar Espagne N.', 'http://international.aero.free.fr/xxx_weather/radar_spain_north.html', 961, 721],
    ['⚡ Foudre', 'https://map.blitzortung.org/#6.5/46.2/-1.5', 1300, 0],
    ['🌬 Windy Ouest', 'https://www.windy.com/?46.0,-1.5,6', 1300, 0],
    ['📋 METAR/TAF zone', () => `https://aviationweather.gov/api/data/metar?ids=${metarIds()}&hours=6&sep=true&taf=true`, 1400, 0],
    ['✈️ Aeroweb', 'https://aviation.meteo.fr/', 1300, 0],
    ['📑 SIA (VAC)', 'https://www.sia.aviation-civile.gouv.fr/', 1300, 0],
    ['⚠️ NOTAM SOFIA', 'https://sofia-briefing.aviation-civile.gouv.fr/', 1300, 0],
    ['🗺 Carte OACI', 'https://www.geoportail.gouv.fr/carte?c=-1.5,46.2&z=7&l0=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN-OACI::GEOPORTAIL:OGC:WMTS(1)&permalink=yes', 1400, 0],
    ['🛩 SafeSky', 'https://live.safesky.app/map?lat=46.2&lng=-1.5&zoom=6.5', 1440, 0],
    ['🪂 Planeurs (Flarm)', 'https://live.glidernet.org/#c=46.2,-1.5&z=7&s=1', 1440, 0],
    ['📡 Flightradar24', 'https://www.flightradar24.com/46.2,-1.5/7', 1440, 0],
    ['🏠 Site Inter Aéro', 'http://international.aero.free.fr/webcams/lfdt.html', 0, 0],
    ['⚠️ NOTAM carte (notaminfo)', 'https://www.notaminfo.com/francemap', 1400, 0],
    ['⚠️ Suivi NOTAM (Amenai)', 'https://notam.amenai.net/mobile/tracking', 1200, 0],
    ['🛩 Spotair (trafic)', 'https://www.spotair.mobi/', 1400, 0],
    ['💨 Balises Holfuy', 'https://holfuy.com/fr/map', 1300, 0],
    ['📷 Webcams Infoclimat', 'https://www.infoclimat.fr/annuaire-webcams-meteo.html', 1300, 0],
    ['📷 Webcams aéroports (Worldcam)', 'https://fr.worldcam.eu/webcams/category/airports', 1300, 0],
    ['📷 Webcams aéroports (OpenCCTV)', 'https://opencctv.org/cameras/category/airport', 1300, 0],
    ['📷 Webcams Catalogne (FAC)', 'https://federacioaeria.cat/serveis/meteo/webcams/', 1300, 0],
    ['🌌 Caméras « all-sky »', 'https://www.thomasjacquin.com/allsky-map/', 1300, 0],
    ['🦺 Sécurité des vols (VFR-pilote)', 'https://vfr-pilote.fr/security/', 1200, 0],
  ];
  const toolsEl = $('#tools');
  for (const [label, url, w, h] of TOOLS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => openWin(typeof url === 'function' ? url() : url, w, h));
    toolsEl.appendChild(b);
  }

  // ---------- Recherche ----------
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const results = $('#results');
  $('#search').addEventListener('input', (e) => {
    const q = norm(e.target.value.trim());
    results.innerHTML = '';
    if (q.length < 2) return;
    const words = q.split(/\s+/);
    const hits = searchIndex.filter((x) => { const l = norm(x.label); return words.every((w) => l.includes(w)); })
      .sort((a, b) => (a.sub === 'Aérodrome' ? -1 : 0) - (b.sub === 'Aérodrome' ? -1 : 0)).slice(0, 40);
    for (const h of hits) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${esc(h.label)}</b> <span style="opacity:.6">· ${h.sub}</span>`;
      li.addEventListener('click', () => {
        map.flyTo([h.lat, h.lon], Math.max(map.getZoom(), h.sub === 'Aérodrome' ? 12 : 11), { duration: .6 });
        h.action();
        highlight(h.lat, h.lon, h.label);
      });
      results.appendChild(li);
    }
  });

  // Repère bien visible sur le résultat choisi (cercle pulsant + nom en grand pendant 10 s)
  const hiLayer = L.layerGroup().addTo(map);
  let hiTimer = null;
  function highlight(lat, lon, label) {
    hiLayer.clearLayers(); clearTimeout(hiTimer);
    L.marker([lat, lon], { interactive: false, zIndexOffset: 2000, icon: L.divIcon({ className: 'hi-pulse', html: `<i></i><b>${esc(label)}</b>`, iconSize: [60, 60], iconAnchor: [30, 30] }) }).addTo(hiLayer);
    hiTimer = setTimeout(() => hiLayer.clearLayers(), 10000);
  }

  // ---------- Panneau repliable ----------
  const panel = $('#panel');
  const setCollapsed = (c) => { panel.classList.toggle('collapsed', c); $('#collapse').textContent = c ? '+' : '–'; store.set('collapsed', c); };
  $('#collapse').addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
  setCollapsed(store.get('collapsed', false));

  // ---------- NOTAM (SOFIA) et SUP AIP (SIA) ----------
  let NOTAM = { fir: [], ad: {} }, SUP = [];
  const fmtT = (s) => {
    if (!s) return 'PERM';
    const d = new Date(s);
    if (isNaN(d)) return esc(s);
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${d.toISOString().slice(11, 16)}Z`;
  };
  const isActive = (n) => {
    const now = Date.now();
    const to = Date.parse(n.to);
    return (!n.from || Date.parse(n.from) <= now) && (isNaN(to) || to >= now); // "PERM" => permanent
  };
  // Fenêtre « mon vol » : NOTAM actifs entre deux heures (sinon : maintenant)
  const flightWin = () => {
    const a = Date.parse($('#notam-from').value), b = Date.parse($('#notam-to').value);
    return isNaN(a) ? null : { a, b: isNaN(b) || b < a ? a + 2 * 3600e3 : b };
  };
  const inWin = (n, w) => {
    const from = n.from ? Date.parse(n.from) : -Infinity, to = Date.parse(n.to);
    return from <= w.b && (isNaN(to) || to >= w.a);
  };
  const altSel = () => +($('#alt-filter') && $('#alt-filter').value) || 0;
  const darken = (hex, k = .35) => {
    const n = parseInt(hex.slice(1), 16), f = (v) => Math.round(v * (1 - k));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  };
  const fl = (v) => v == null ? '?' : v === 0 ? 'SFC' : v >= 999 ? 'UNL' : `FL${String(v).padStart(3, '0')}`;
  function notamColor(q) {
    const c = (q || '').slice(0, 2);
    if (/^R[ARDPT]/.test(c)) return '#ff3b30';      // zones réglementées / dangereuses / interdites
    if (c[0] === 'W') return '#ff9f0a';              // avertissements (drones, para, voltige, tirs…)
    if (c[0] === 'O') return '#ffd60a';              // obstacles
    if (c[0] === 'A') return '#bf5af2';              // organisation de l'espace
    if (/^[NIGCL]/.test(c)) return '#64d2ff';        // radionav, communications, balisage
    return '#e5e5ea';
  }
  // NOTAM apparus depuis la visite précédente : vus pour la première fois sur cet appareil pendant la visite en cours
  const SESSION_START = (() => {
    try { let s = sessionStorage.getItem('awwSession'); if (!s) { s = String(Date.now()); sessionStorage.setItem('awwSession', s); } return +s; } catch { return Date.now(); }
  })();
  let newCount = 0;
  function markNewNotams() {
    const seen = store.get('notamSeen', {}), now = Date.now(), first = !Object.keys(seen).length, cur = {};
    const all = [...NOTAM.fir, ...Object.values(NOTAM.ad).flat()];
    newCount = 0;
    for (const n of all) {
      cur[n.ref] = seen[n.ref] || (first ? 1 : now);
      n.isNew = cur[n.ref] >= SESSION_START;   // 1re visite : tout est marqué « déjà vu » (1)
    }
    newCount = Object.values(cur).filter((ts) => ts >= SESSION_START).length;   // un NOTAM peut figurer en route et sur un terrain
    store.set('notamSeen', cur);   // les NOTAM disparus sont oubliés
  }
  function notamHtml(n, withA = false) {
    const txt = n.efr || n.e || '';
    const act = isActive(n);
    return `<div class="notam${act ? '' : ' future'}" style="border-left-color:${notamColor(n.q)}">
      <div class="nh">${n.isNew ? '<i class="new">NOUVEAU</i> ' : ''}<b>${esc(n.ref)}</b>${withA && n.a ? ` · ${esc(n.a)}` : ''} · Q ${esc(n.q || '')}
        <span>${act ? '<i class="on">ACTIF</i>' : '<i>à venir</i>'}</span></div>
      <div class="nv">${fmtT(n.from)} → ${fmtT(n.to)} · ${fl(n.lower)} – ${fl(n.upper)}${n.d ? ` · ${esc(n.d)}` : ''}</div>
      <pre>${esc(txt)}</pre></div>`;
  }
  // ---------- Escale : carburant, paiement, taxe d'atterrissage ----------
  let VACD = {}, FEES = {};
  const escaleOf = (icao) => (VACD[icao] && VACD[icao].escale) || null;
  function feeFor(icao) {
    try { const loc = JSON.parse(localStorage.getItem('aww.fee.' + icao) || 'null'); if (loc && loc.tarif) return { ...loc, source: 'saisie personnelle' }; } catch { /* ignore */ }
    return FEES[icao] && FEES[icao].tarif ? FEES[icao] : null;
  }
  async function loadCamStatus() {
    try {
      const st = await getLive('cams_status.json');
      const dead = st.dead || {}, when = (st.checked || '').slice(0, 10), frozen = st.frozen || {};
      const fd = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const svgFrozen = (fill) => svgCam(fill).replace('<svg ', '<svg style="filter:sepia(1) saturate(4) hue-rotate(-20deg)" ');
      for (const s of SOURCES) {
        if (s.t !== 'cam' || !s._mk) continue;
        if (dead[s.u]) {
          s._mk.setIcon(divIcon(svgCam('#8a8f94'), [22, 22], [11, 11]));
          s._mk.setOpacity(0.6);
          s._mk.setTooltipContent(tipHtml(s.n + ` — hors service lors du contrôle du ${when} (${dead[s.u]})`, null));
          s.dead = true;
          continue;
        }
        const img = s.img || (/\.(jpe?g|png|webp)(\?|$)/i.test(s.u) ? s.u : null);
        if (!img || !frozen[img]) continue;
        if (img === s.u) {   // la webcam n'est qu'une image, et elle ne change plus
          s._mk.setIcon(divIcon(svgFrozen('#e8f6ff'), [22, 22], [11, 11]));
          s._mk.setOpacity(0.75);
          s._mk.setTooltipContent(tipHtml(s.n, img) + `<div class="cam-old">⚠️ Image figée : inchangée depuis le ${fd(frozen[img])} — webcam probablement arrêtée.</div>`);
          s.frozen = frozen[img];
        } else {             // seul l'aperçu est ancien : on le masque, la webcam elle-même peut fonctionner
          s._mk.setTooltipContent(tipHtml(s.n, null) + `<div class="cam-old">Aperçu ancien (${fd(frozen[img])}) masqué — clic pour l'image en direct.</div>`);
          s.oldPreview = true;
        }
      }
    } catch (e) { /* pas encore de contrôle */ }
  }
  async function loadEscale() {
    try { VACD = (await getLive('escale.json').catch(() => getLive('vac.json'))).data || {}; } catch (e) { console.warn('vac', e); drawAerodromes(); throw e; }
    try { const r = await fetch('data/fees.json', { cache: 'no-store' }); FEES = (await r.json()).aerodromes || {}; } catch (e) { console.warn('fees', e); }
    try { const club = (await getLive('fees_club.json')).aerodromes || {}; FEES = { ...FEES, ...club }; } catch (e) { /* pas encore de tarif partagé */ }
    try { PRAT = (await getLive('pratique_club.json')).aerodromes || {}; } catch (e) { /* pas encore d'info partagée */ }
    drawAerodromes();
  }
  function escaleHtml(icao) {
    const e = escaleOf(icao), fee = feeFor(icao);
    const fuel = !e ? '<span class="meta">non renseigné (pas de VAC)</span>'
      : e.none ? '<b>Pas de carburant</b>'
        : (e.fuel && e.fuel.length ? e.fuel.map((f) => `<span class="fuel">${esc(f)}</span>`).join(' ') : '<span class="meta">voir VAC</span>');
    const pay = e && e.pay && e.pay.length ? e.pay.map(esc).join(' · ') : '<span class="meta">non précisé</span>';
    const tels = [...((e && e.tel) || []), ...((e && e.tel_ad) || [])];
    return `<h4>Escale</h4>
      <dl class="decoded">
        <dt>Carburant</dt><dd>${fuel}</dd>
        <dt>Paiement</dt><dd>${pay}</dd>
        ${e && e.texte ? `<dt>Détail (VAC)</dt><dd style="font-size:11px">${esc(e.texte)}</dd>` : ''}
        ${e && e.exploitant ? `<dt>Exploitant</dt><dd style="font-size:11px">${esc(e.exploitant)}</dd>` : ''}
        ${tels.length ? `<dt>Téléphone</dt><dd>${[...new Set(tels)].map((t) => `<a href="tel:${esc(t.replace(/\s/g, ''))}" style="color:inherit">${esc(t)}</a>`).join(' · ')}</dd>` : ''}
        <dt>Taxe d'atterrissage</dt><dd>${fee ? `<b>${esc(fee.tarif)}</b>${fee.note ? ' — ' + esc(fee.note) : ''} <span class="meta">(${esc(fee.source || 'tableau du club')}${fee.maj ? ', ' + esc(fee.maj) : ''})</span>` : '<span class="meta">non renseignée</span>'}</dd>
      </dl>
      <div class="row" style="margin-top:4px">
        <input id="fee-in" placeholder="ex. 10 € TTC, gratuit…" value="${fee && fee.source === 'saisie personnelle' ? esc(fee.tarif) : ''}" style="flex:1;min-width:140px;margin:0">
        <button class="btn" id="fee-save">Enregistrer la taxe</button>
      </div>
      ${CFG.contact ? `<div class="row" style="margin-top:4px"><button class="btn" id="fee-share">📤 Proposer ce tarif au club</button><span class="meta" style="flex:1">envoyé par e-mail, publié après vérification</span></div>` : ''}
      ${pprHtml(icao, e)}
      <div class="row" style="margin-top:4px">
        <button class="btn" data-ext="https://airfield.directory/airfield/${icao}">Tarifs (airfield.directory)</button>
        <button class="btn" data-ext="https://www.aerops.com/fr/airports-1/fee-info/${icao}/">Tarifs (aeroPS)</button>
        ${e && e.site ? `<button class="btn" data-ext="${esc(/^https?:/.test(e.site) ? e.site : 'https://' + e.site)}">Site de l'aérodrome</button>` : ''}
      </div>`;
  }
  // ---------- Vie pratique : VAC (transports, hôtels), infos du club, notes perso, liens et OpenStreetMap autour du terrain ----------
  let PRAT = {};
  function pratiqueHtml(icao, a) {
    const e = escaleOf(icao) || {}, p = e.pratique || {}, ville = p.ville || a.name.split(/[ -]/)[0];
    let note = ''; try { note = localStorage.getItem('aww.prat.' + icao) || ''; } catch { /* ignore */ }
    const enc = encodeURIComponent, pj = (q) => `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${enc(q)}&ou=${enc(ville)}`;
    const links = [
      ['🚕 Taxis', pj('taxi')], ['🚗 Location de voiture', pj('location de voitures')],
      ['🚆 Bus / train vers ' + ville, `https://www.google.com/maps/dir/?api=1&origin=${a.la},${a.lo}&destination=${enc(ville)}&travelmode=transit`],
      ['🏨 Hébergement', `https://www.google.com/maps/search/h%C3%B4tel/@${a.la},${a.lo},13z`], ['🍽️ Restaurants', `https://www.google.com/maps/search/restaurant/@${a.la},${a.lo},14z`],
    ];
    const vac = [['📍 Situation', p.situation], ['🚌 Transports', p.transports], ['🍽️ Hôtels, restaurants', p.hotels], ['ℹ️ Divers', p.divers]].filter((x) => x[1]);
    return `<details class="pratique"><summary>🧳 Vie pratique : taxis, transports, restos</summary>
      ${vac.length ? `<dl class="decoded">${vac.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="meta small-print">D'après la VAC.</p>` : ''}
      ${(PRAT[icao] || []).map((x) => `<div class="okk">👥 ${esc(x.txt)} <span class="meta">(club, ${esc(x.maj)})</span></div>`).join('')}
      <div class="row">${links.map(([l, u]) => `<button class="btn" data-ext="${esc(u)}">${esc(l)}</button>`).join('')}</div>
      ${osmHtml(a, e.osm || {})}
      <h4>Mes contacts pour ce terrain</h4>
      <textarea id="prat-note" rows="3" placeholder="Taxi : 06 … · Code portail … · Restaurant …">${esc(note)}</textarea>
      <div class="row"><button class="btn" id="prat-save">💾 Enregistrer sur cet appareil</button>${CFG.contact ? '<button class="btn" id="prat-share">📤 Proposer au club</button>' : ''}</div>
    </details>`;
  }
  // taxis, gares, loueurs collectés une fois par cycle dans OpenStreetMap (les serveurs publics sont trop lents pour une requête en direct)
  function osmHtml(a, o) {
    const T = [['taxi', '🚕 Stations de taxi'], ['gare', '🚆 Gares'], ['loc', '🚗 Location de voiture'], ['velo', '🚲 Vélos en libre-service']];
    const html = T.filter(([k]) => (o[k] || []).length).map(([k, title]) => `<p class="osm-cat">${title}</p><ul class="osm">${o[k].map((x) =>
      `<li><b>${esc(x.n || (k === 'taxi' ? 'Station de taxi' : 'Sans nom'))}</b> · ${x.d < 1 ? Math.round(x.d * 1000) + ' m' : x.d + ' km'}${x.tel ? ` · <a href="tel:${esc(x.tel.replace(/[^+\d]/g, ''))}">📞 ${esc(x.tel)}</a>` : ''}${x.web ? ` · <a class="lnk" data-ext="${esc(/^https?:/.test(x.web) ? x.web : 'https://' + x.web)}">site</a>` : ''}
        · <a class="lnk" data-ext="https://www.google.com/maps/dir/?api=1&origin=${a.la},${a.lo}&destination=${x.la},${x.lo}">itinéraire</a></li>`).join('')}</ul>`).join('');
    return `<h4>Autour du terrain</h4>${html || '<p class="meta">Rien de référencé à proximité dans OpenStreetMap.</p>'}<p class="meta small-print">© contributeurs OpenStreetMap — données libres, parfois incomplètes.</p>`;
  }
  // e-mail pré-rempli vers l'adresse de config.js (aucun lien vers le dépôt GitHub dans le site partagé)
  const mailTo = (subject, body) => { location.href = `mailto:${CFG.contact}?subject=${encodeURIComponent('[Aéro Météo] ' + subject)}&body=${encodeURIComponent(body)}`; };
  function bindPratique(el, icao, a) {
    const save = el.querySelector('#prat-save');
    if (save) save.addEventListener('click', () => {
      try { const v = el.querySelector('#prat-note').value.trim(); if (v) localStorage.setItem('aww.prat.' + icao, v); else localStorage.removeItem('aww.prat.' + icao); save.textContent = '✅ Enregistré'; } catch { /* ignore */ }
    });
    const share = el.querySelector('#prat-share');
    if (share) share.addEventListener('click', () => {
      mailTo(`Infos pratiques ${icao}`, `Terrain : ${icao}\nInfos :\n${el.querySelector('#prat-note').value.trim()}`);
    });
  }

  // ---------- PPR / stationnement : contacts relevés dans la VAC + demande pré-remplie ----------
  function pprHtml(icao, e) {
    if (!e) return '';
    const mails = e.mails || [], web = (e.web || []).map((u) => (/^https?:/.test(u) ? u : 'https://' + u));
    const tels = [...new Set([...(e.tel_ad || []), ...(e.tel || [])])];
    return `<h4>PPR / stationnement</h4>
      ${(e.ppr || []).length ? `<ul class="ppr">${e.ppr.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p class="meta">Pas de consigne PPR relevée dans la VAC.</p>'}
      ${e.exploitant ? `<p class="meta">Exploitant : ${esc(e.exploitant)}</p>` : ''}
      ${e.mail_escale ? `<p style="margin:4px 0"><b>Contact pour l'escale :</b> <button class="btn primary" data-ppr-mail="${esc(e.mail_escale)}">✉️ ${esc(e.mail_escale)}</button>
        <span class="meta">${esc(((e.contacts || []).find((c) => c.m === e.mail_escale) || {}).r || '')}${((e.contacts || []).find((c) => c.m === e.mail_escale) || {}).src ? ' · relevé hors VAC, à vérifier' : ' · VAC'}</span></p>`
        : '<p class="meta">Pas d\'e-mail d\'escale publié : appeler le terrain (numéros ci-dessous).</p>'}
      <div class="row">
        ${(e.contacts || mails.map((m) => ({ m }))).filter((c) => c.m !== e.mail_escale).map((c) => `<button class="btn" data-ppr-mail="${esc(c.m)}">✉️ ${esc(c.m)}${c.r ? ` <small>(${esc(c.r)})</small>` : ''}</button>`).join('')}
        ${tels.map((t) => `<a class="btn" href="tel:${esc(t.replace(/\s/g, ''))}">📞 ${esc(t)}</a>`).join('')}
        ${web.map((u) => `<button class="btn" data-ext="${esc(u)}">🌐 ${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</button>`).join('')}
        <button class="btn" data-ppr-copy="1">📋 Copier une demande type</button>
      </div>
      <p class="meta small-print">Contacts recopiés automatiquement de la VAC (ils peuvent concerner la douane, le carburant ou l'exploitant) : choisir le bon interlocuteur et vérifier sur la VAC.</p>`;
  }
  function pprText(icao) {
    const a = aptByIcao[icao] || { name: '' };
    let f = {}; try { f = JSON.parse(localStorage.getItem('aww.prep2.form') || '{}'); } catch { /* ignore */ }
    const st = (window.AWW_LASTTRIP || []).find((b) => b.f && b.f.arr === icao);
    const fmt = (d) => d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const arr = st ? fmt(st.eta) : 'le … vers …h…';
    const dep = st && st.trip && st.trip[st.stage] ? fmt(st.trip[st.stage].depT) : '…';
    const reg = f.immat || f.reg || '…';
    return {
      subject: `Demande PPR / stationnement ${icao} — ${reg}`,
      body: `Bonjour,\n\nJe souhaiterais me poser à ${a.name} (${icao}) ${st ? 'le ' + arr : arr} (heure locale), départ prévu ${dep}.\n`
        + `Avion : ${reg}${f.reg && f.immat && f.immat !== f.reg ? ' (' + f.reg + ')' : ''}, aviation générale, vol privé VFR, avion léger.\n\n`
        + `Pourriez-vous me confirmer l'accord (PPR si nécessaire) et une place de stationnement, ainsi que les informations d'escale : horaires d'ouverture, carburant disponible${st && st.trip && st.trip[st.stage] ? ` (besoin d'environ ${Math.max(0, Math.round(st.trip[st.stage].loaded - Math.max(0, st.loaded - st.totFuel)))} L de ${st.f.T.fuel.name.split(' (')[0]})` : ''} et moyens de paiement, taxe d'atterrissage, accès et restauration ?\n\n`
        + `Pilote : …\nTéléphone : …\n\nMerci par avance, cordialement.`,
    };
  }
  function bindEscale(el, icao) {
    el.querySelectorAll('[data-ppr-mail]').forEach((b) => b.addEventListener('click', () => {
      const t = pprText(icao);
      location.href = `mailto:${b.dataset.pprMail}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`;
    }));
    el.querySelectorAll('[data-ppr-copy]').forEach((b) => b.addEventListener('click', async () => {
      const t = pprText(icao), txt = `${t.subject}\n\n${t.body}`;
      try { await navigator.clipboard.writeText(txt); b.textContent = '✅ Demande copiée'; } catch { prompt('Copie ce texte :', txt); }
    }));
    el.querySelectorAll('[data-ext]').forEach((b) => b.addEventListener('click', () => openWin(b.dataset.ext, 1200, 0)));
    const save = el.querySelector('#fee-save');
    if (save) save.addEventListener('click', () => {
      const v = el.querySelector('#fee-in').value.trim();
      try {
        if (v) localStorage.setItem('aww.fee.' + icao, JSON.stringify({ tarif: v, maj: new Date().toISOString().slice(0, 7) }));
        else localStorage.removeItem('aww.fee.' + icao);
      } catch { /* ignore */ }
      showAerodrome(icao, false); drawAerodromes();
    });
    const share = el.querySelector('#fee-share');
    if (share) share.addEventListener('click', () => {
      const v = el.querySelector('#fee-in').value.trim();
      mailTo(`Taxe ${icao}`, `Terrain : ${icao}\nTarif : ${v}\nRelevé : ${new Date().toISOString().slice(0, 7)}`);
    });
  }

  function notamAdHtml(icao) {
    const list = NOTAM.ad[icao] || [];
    if (!list.length) return NOTAM.generated ? `<h4>NOTAM aérodrome</h4><p class="meta">Aucun NOTAM pour les prochaines ${NOTAM.horizon || 24} h.</p>` : '';
    return `<h4>NOTAM aérodrome (${list.length})</h4>${list.map((n) => notamHtml(n)).join('')}
      <p class="meta small-print">Source SOFIA-Briefing (SIA) · collecte ${fmtT(NOTAM.generated)} · vérifier sur SOFIA avant le vol.</p>`;
  }
  function supNearHtml(a) {
    const near = SUP.filter((s) => s.places.some((p) => distKm(a.la, a.lo, p.la, p.lo) <= 40));
    if (!near.length) return '';
    return `<h4>SUP AIP à proximité (${near.length})</h4>${near.map(supHtml).join('')}`;
  }
  function supHtml(s) {
    return `<div class="sup"><button class="btn" data-doc="${esc(s.url)}">📄 SUP ${esc(s.num)}</button>
      <span>${esc(s.title)}</span><div class="nv">du ${esc(s.from || '?')} au ${esc(s.to || '?')}${s.vfr ? ' · VFR' : ''}${s.ifr ? ' · IFR' : ''}</div></div>`;
  }
  function bindDocLinks(el) {
    el.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => openWin(b.dataset.doc, 1000, 0)));
  }

  const svgSup = `<svg width="24" height="26" viewBox="0 0 24 26"><path d="M3 1h12l6 6v18H3z" fill="#fff" stroke="#b34700" stroke-width="1.6"/><path d="M15 1v6h6" fill="#ffd0a8" stroke="#b34700" stroke-width="1.2"/><text x="12" y="20" font-size="7.5" font-weight="700" text-anchor="middle" fill="#b34700" font-family="system-ui,sans-serif">SUP</text></svg>`;
  const svgObst = `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1l6 12H1z" fill="#ffd60a" stroke="#5a4500" stroke-width="1.2"/></svg>`;

  function drawNotam() {
    layers.notam.clearLayers();
    const hideObst = $('#notam-obst') && !$('#notam-obst').checked;
    const maxFl = +($('#notam-fl') ? $('#notam-fl').value : 999);
    const w = flightWin(), alt = altSel();
    const wv = w || { a: Date.now(), b: Date.now() + 24 * 3600e3 };   // sans « mon vol » : les prochaines 24 h
    let shown = 0;
    for (const n of NOTAM.fir) {
      if (n.la == null || n.lo == null) continue;
      if (n.lower != null && n.lower > maxFl) continue;
      if (!inWin(n, wv)) continue;
      if (alt && ((n.lower != null && n.lower * 100 > alt) || (n.upper != null && n.upper * 100 < alt))) continue;
      shown++;
      const isObst = (n.q || '')[0] === 'O';
      if (isObst && hideObst) continue;
      const tip = `${n.isNew ? '🆕 ' : ''}<b>NOTAM ${esc(n.ref)}</b> · ${fl(n.lower)}–${fl(n.upper)}<br>${fmtT(n.from)} → ${fmtT(n.to)}<br>${esc((n.efr || n.e || '').slice(0, 220))}${(n.efr || n.e || '').length > 220 ? '…' : ''}`;
      const open = () => showList(`NOTAM ${n.ref}`, notamHtml(n, true));
      const act = w ? true : isActive(n);
      if (isObst || !n.r || n.r <= 1) {
        bindPick(L.marker([n.la, n.lo], { icon: divIcon(isObst ? svgObst : `<svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="${notamColor(n.q)}" stroke="#000" stroke-width="1.6"/></svg>`, [16, 16], [8, 8]) })
          .bindTooltip(tip, { className: 'tip', direction: 'top' }), `⚠️ NOTAM ${n.ref}`, open).addTo(layers.notam);
      } else if (n.r <= 30) {
        const col = notamColor(n.q);
        L.circle([n.la, n.lo], { radius: n.r * 1852, color: darken(col, .3), weight: act ? 3 : 1.5, dashArray: act ? null : '6 5', fillColor: col, fillOpacity: act ? .2 : .1 })
          .bindTooltip(tip, { className: 'tip', sticky: true }).on('click', (e) => { if (!pickOff && !window.AWW_PICKING) open(); }).addTo(layers.notam);
      }
    }
    const info = $('#notam-win-info');
    if (info) info.textContent = w ? `${shown} NOTAM localisés actifs entre ${new Date(w.a).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} et ${new Date(w.b).toLocaleTimeString('fr-FR', { timeStyle: 'short' })}${NOTAM.generated && w.b > Date.parse(NOTAM.generated) + (NOTAM.horizon || 24) * 3600e3 ? ` — attention : la collecte ne couvre que ${NOTAM.horizon || 24} h, vérifier sur SOFIA` : ''}.` : '';
    drawHalos();
  }
  function drawSup() {
    layers.supaip.clearLayers();
    for (const s of SUP) {
      s.places.forEach((p) => {
        bindPick(L.marker([p.la, p.lo], { icon: divIcon(svgSup, [24, 26], [12, 13]), zIndexOffset: 300 })
          .bindTooltip(`<b>SUP AIP ${esc(s.num)}</b> (${esc(p.n)})<br>${esc(s.title)}<br>du ${esc(s.from || '?')} au ${esc(s.to || '?')}`, { className: 'tip', direction: 'top' }),
        `📄 SUP AIP ${s.num} — ${s.title.slice(0, 60)}`, () => openWin(s.url, 1000, 0))
          .addTo(layers.supaip);
      });
    }
  }

  function showList(title, html) {
    openedIcao = null;
    detailBody.innerHTML = `<h3>${esc(title)}</h3>${html}`;
    bindDocLinks(detailBody);
    detailBody.querySelectorAll('[data-flyto]').forEach((b) => b.addEventListener('click', () => {
      const [la, lo] = b.dataset.flyto.split(',').map(Number); map.flyTo([la, lo], 10, { duration: .6 });
    }));
    detail.hidden = false;
  }
  function showSupList() {
    const inZone = SUP.filter((s) => s.places.length), other = SUP.filter((s) => !s.places.length && !s.outside);
    showList('SUP AIP Métropole', `
      <p class="meta">${SUP.length} SUP AIP en vigueur ou à venir · ${inZone.length} localisés dans la zone (d'après leur titre — vérifier le PDF).</p>
      <h4>Dans la zone (${inZone.length})</h4>${inZone.map((s) => supHtml(s) + `<div class="row">${s.places.map((p) => `<button class="btn small-btn" data-flyto="${p.la},${p.lo}">📍 ${esc(p.n)}</button>`).join('')}</div>`).join('')}
      <h4>Non localisés / national (${other.length})</h4>${other.map(supHtml).join('')}
      <p class="meta small-print">Liste complète : <button class="btn" data-doc="https://www.sia.aviation-civile.gouv.fr/documents/supaip/aip/id/6">site du SIA</button></p>`);
  }
  function showNotamList() {
    const v = map.getBounds();
    const w = flightWin();
    const wv = w || { a: Date.now(), b: Date.now() + 24 * 3600e3 };
    const inView = NOTAM.fir.filter((n) => n.la != null && v.contains([n.la, n.lo]) && inWin(n, wv));
    const noPos = NOTAM.fir.filter((n) => n.la == null);
    const byCat = (a, b) => (a.q || '').localeCompare(b.q || '');
    showList('NOTAM en route — FIR Brest & Bordeaux', `
      <p class="meta">${NOTAM.fir.length} NOTAM (${NOTAM.horizon || 24} h, SFC–FL195) · ${inView.length} dans la vue actuelle${w ? ' et actifs pendant ton vol' : ' et actifs dans les 24 h'} · collecte ${fmtT(NOTAM.generated)}.</p>
      ${inView.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || byCat(a, b)).map((n) => notamHtml(n, true) + `<div class="row"><button class="btn small-btn" data-flyto="${n.la},${n.lo}">📍 voir</button></div>`).join('')}
      ${NOTAM.fir.some((n) => n.r > 30) ? `<p class="meta small-print">Les NOTAM de rayon &gt; 30 NM ne sont pas dessinés sur la carte mais figurent dans cette liste.</p>` : ''}
      ${noPos.length ? `<h4>Sans position (${noPos.length})</h4>${noPos.map((n) => notamHtml(n, true)).join('')}` : ''}
      <p class="meta small-print">Données SOFIA-Briefing (SIA/DGAC). Outil d'aide : faire un dossier de vol officiel sur SOFIA.</p>`);
  }

  async function loadNotamSup() {
    const st = [];
    try {
      NOTAM = await getLive('notam.json');
      markNewNotams();
      drawNotam(); drawAerodromes();
      const nAd = Object.values(NOTAM.ad).reduce((s, l) => s + l.length, 0);
      st.push(`${NOTAM.fir.length + nAd} NOTAM${newCount ? ` dont ${newCount} nouveaux depuis ta dernière visite` : ''}`);
    } catch (e) { console.warn('notam', e); st.push('NOTAM indisponibles'); }
    try {
      SUP = (await getLive('supaip.json')).data || [];
      drawSup();
      drawAirLayers();
      st.push(`${SUP.length} SUP AIP`);
    } catch (e) { console.warn('sup', e); st.push('SUP AIP indisponibles'); }
    const ageH = NOTAM.generated ? (Date.now() - Date.parse(NOTAM.generated)) / 3600e3 : 0;
    $('#status2').textContent = st.join(' · ') + (NOTAM.generated ? ` (collecte il y a ${ageH < 1 ? Math.round(ageH * 60) + ' min' : ageH.toFixed(1).replace('.', ',') + ' h'})` : '') + (ageH > 2 ? ' ⚠️ collecte en retard : vérifier sur SOFIA' : '');
    $('#status2').style.color = ageH > 2 ? 'var(--warn-text)' : '';
    if (openedIcao) showAerodrome(openedIcao, false);
    if (st.some((x) => /indisponibles/.test(x))) throw new Error(st.join(' · '));
  }
  $('#notam-obst').addEventListener('change', drawNotam);
  $('#notam-fl').addEventListener('change', drawNotam);
  ['#notam-from', '#notam-to'].forEach((s) => $(s).addEventListener('change', () => {
    if (s === '#notam-from' && $('#notam-from').value && !$('#notam-to').value) {
      const d = new Date(Date.parse($('#notam-from').value) + 2 * 3600e3);
      $('#notam-to').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    drawNotam();
  }));
  $('#notam-win-clear').addEventListener('click', () => { $('#notam-from').value = ''; $('#notam-to').value = ''; drawNotam(); });
  $('#btn-notam-list').addEventListener('click', showNotamList);
  $('#btn-sup-list').addEventListener('click', showSupList);

  // ---------- Calques espaces aériens, zones, RTBA du jour, points VFR ----------
  function loadAirLayers() {
    if (!airLoading) airLoading = window.AWW_LOG.task('Espaces aériens et zones', async () => {
      const [asp, zones, vfr] = await Promise.all([
        getLive('airspaces.json').catch(() => ({ data: [] })),
        getLive('zones.json').catch(() => ({ data: [] })),
        getLive('vfr_points.json').catch(() => fetch('data/vfr_points.json').then((r) => r.json())).catch(() => ({ data: {} })),
      ]);
      AIR = { asp: asp.data || [], zones: zones.data || [], vfr: vfr.data || {}, vfrDate: vfr.effDate };
      drawAirLayers();
      if (!AIR.asp.length && !AIR.zones.length) throw new Error('fichiers espaces / zones vides');
    });
    return airLoading;
  }
  function rtbaToday() {
    const out = {}, now = new Date(), day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (const n of (NOTAM && NOTAM.fir) || []) {
      const t = (n.e || '') + ' ' + (n.efr || '');
      if (!/RTBA/.test(t)) continue;
      if (n.from && Date.parse(n.from) > day0 + 864e5) continue;
      const re = /ZONE\s+(R\s?\d+\s?[A-Z]?\d?)\s+([A-Z' .-]+?)\s+((?:\d{4}-\d{4}:ACTIVE\s*)+)/g;
      let m; while ((m = re.exec(t))) { const k = m[1].replace(/\s/g, ''); out[k] = [...new Set([...(out[k] || []), ...m[3].match(/\d{4}-\d{4}/g)])]; }
    }
    return out;
  }
  // Un clic sur un espace ou une zone affiche tout ce qui est empilé à cet endroit (espaces superposés, règles, fréquences)
  const stackOnClick = (e) => { if (pickOff || window.AWW_PICKING) return; L.DomEvent.stop(e); showStack(e.latlng.lat, e.latlng.lng); };
  const atAlt = (lowerS, upperS, alt) => {
    if (!alt) return true;
    const lo = altFt(lowerS), hi = altFt(upperS);
    return (lo == null || lo <= alt) && (hi == null || hi >= alt);
  };
  function drawAirLayers() {
    if (!AIR) return;
    ['asp', 'siv', 'zones', 'rtba', 'vfr'].forEach((k) => layers[k].clearLayers());
    const alt = altSel();
    for (const s of AIR.asp) {
      if (!atAlt(s.lower, s.upper, alt)) continue;
      const siv = s.kind === 'SIV', ctr = s.kind === 'CTR';
      const col = siv ? '#2e9e3e' : ctr ? '#0d5bd6' : '#2f7fe0';
      L.polygon(s.poly, { color: col, weight: siv ? 1.6 : ctr ? 2.4 : 1.8, dashArray: siv ? '3 5' : ctr ? null : '8 5', fillColor: col, fillOpacity: ctr ? .16 : siv ? .03 : .06, smoothFactor: 1.5 })
        .bindTooltip(`<b>${esc(s.name)}</b> (classe ${esc(s.cls)})<br>${esc(s.lower)} – ${esc(s.upper)}<br>${esc(s.call)} <b>${esc(s.freq)}</b><br><span style="opacity:.7">Clic : espaces superposés ici et règles</span>`, { className: 'tip', sticky: true })
        .on('click', stackOnClick)
        .addTo(siv ? layers.siv : layers.asp);
    }
    const act = rtbaToday();
    for (const z of AIR.zones) {
      if (!atAlt(z.lower, z.upper, alt)) continue;
      const key = z.id.replace(/\s/g, ''), slots = act[key];
      const col = z.type === 'P' ? '#e0105a' : z.type === 'D' ? '#ff8a00' : '#9c27b0';
      const tip = `<b>${esc(z.id)} ${esc(z.name)}</b><br>${esc(z.lower)} – ${esc(z.upper)}${slots ? `<br><b style="color:#ff6b6b">RTBA active aujourd'hui : ${esc(slots.join(', '))} UTC</b>` : ''}<br><span style="opacity:.75">${esc((z.rmk || '').slice(0, 180))}</span><br><span style="opacity:.7">Clic : espaces superposés ici et règles</span>`;
      if (z.rtba && slots) L.polygon(z.poly, { color: '#c4001a', weight: 3, fillColor: '#ff3b30', fillOpacity: .3 }).bindTooltip(tip, { className: 'tip', sticky: true }).on('click', stackOnClick).addTo(layers.rtba);
      L.polygon(z.poly, { smoothFactor: 1.5, color: darken(col, .25), weight: 2, fillColor: col, fillOpacity: z.type === 'P' ? .3 : .14 }).bindTooltip(tip, { className: 'tip', sticky: true }).on('click', stackOnClick).addTo(layers.zones);
    }
    for (const [ad, pts] of Object.entries(AIR.vfr)) {
      for (const p of pts) {
        bindPick(L.marker([p.la, p.lo], { icon: L.divIcon({ className: 'mk', iconSize: [12, 12], iconAnchor: [6, 6], html: `<div style="position:relative"><svg width="12" height="12"><path d="M6 0l6 12H0z" fill="#fff" stroke="#002a40" stroke-width="1.4"/></svg><span class="vfr-label" style="position:absolute;left:13px;top:-2px">${esc(p.id)}</span></div>` }) })
          .bindTooltip(`<b>${ad.slice(2)}-${esc(p.id)}</b> (${ad})<br>${esc(p.desc)}<br><span style="opacity:.7">${p.old ? `Point de l'export SIA du ${esc(p.old)} (absent du tableau de la VAC actuelle)` : `VAC du cycle ${esc(AIR.vfrDate || '')}`} — vérifier sur la VAC</span>`, { className: 'tip', direction: 'top' }),
        `🔺 Point VFR ${ad.slice(2)}-${p.id} (${ad})`, () => showAerodrome(ad))
          .addTo(layers.vfr);
      }
    }
    drawHalos();
  }
  $('#alt-filter').value = store.get('altFilter', '');
  $('#alt-filter').addEventListener('change', (e) => {
    store.set('altFilter', e.target.value);
    if (e.target.value) ['asp', 'zones'].forEach((k) => { const cb = document.querySelector(`input[data-layer="${k}"]`); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); } });
    drawAirLayers(); drawNotam();
  });


  // ---------- Coupe des espaces aériens (clic sur la carte) + règles de pénétration ----------
  const inPolyM = (p, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ya, xa] = poly[i], [yb, xb] = poly[j];
      if ((ya > p[0]) !== (yb > p[0]) && p[1] < (xb - xa) * (p[0] - ya) / (yb - ya) + xa) c = !c;
    }
    return c;
  };
  const altFt = (s) => {
    if (!s) return null;
    if (/^\s*(SFC|GND)\s*$/i.test(s)) return 0;
    if (/UNL/i.test(s)) return 99999;
    let m = s.match(/FL\s?(\d{2,3})/i); if (m) return +m[1] * 100;
    m = s.match(/(\d{3,5})\s?FT/i); if (m) return +m[1];
    if (/SFC|GND/i.test(s)) return 0;
    return null;
  };
  const isAglS = (s) => /ASFC|AGL/i.test(s || '');
  const CLS_RULES = {
    A: ['VFR interdit (sauf dérogation particulière).'],
    B: ['Clairance obligatoire avant d\'entrer.', 'Contact radio bilatéral permanent.'],
    C: ['Clairance obligatoire avant d\'entrer.', 'Contact radio bilatéral permanent.', 'Transpondeur (mode A+C ou S) obligatoire.', 'Séparation VFR / IFR assurée, information de trafic VFR / VFR.', 'VMC : visibilité 5 km (8 km au-dessus du FL100), 1 500 m horizontalement et 1 000 ft verticalement des nuages.'],
    D: ['Clairance obligatoire avant d\'entrer.', 'Contact radio bilatéral permanent.', 'Transpondeur allumé (mode C ou S) — vérifier sur la VAC / l\'AIP s\'il est exigé.', 'Information de trafic VFR / IFR et VFR / VFR (pas de séparation).', 'VMC : 5 km, 1 500 m horizontalement et 1 000 ft verticalement des nuages ; 250 kt max sous le FL100.'],
    E: ['Pas de clairance pour le VFR.', 'Contact radio non obligatoire (sauf RMZ / TMZ ou mention contraire) mais recommandé.', 'VMC : 5 km (8 km au-dessus du FL100), 1 500 m et 1 000 ft des nuages.'],
    G: ['Pas de clairance.', 'Au-dessus de 3 000 ft AMSL / 1 000 ft ASFC : 5 km, 1 500 m et 1 000 ft des nuages.', 'En dessous : 5 km (1 500 m si ≤ 140 kt), hors nuages et en vue du sol.', 'Auto-information 123.500 hors fréquence publiée.'],
  };
  const KIND_RULES = {
    CTR: 'Zone de contrôle d\'aérodrome : contacter la tour avant la limite, entrer / sortir par les points de report VFR de la VAC.',
    TMA: 'Région de contrôle terminale : contacter l\'approche avant la limite avec une demande de transit (indicatif, type, position, altitude, intentions).',
    CTA: 'Région de contrôle : contacter l\'organisme avant la limite avec une demande de transit.',
    RMZ: 'Zone à utilisation obligatoire de radio : annoncer indicatif, type, position, niveau et intentions avant d\'entrer, puis garder l\'écoute.',
    TMZ: 'Zone à utilisation obligatoire de transpondeur : transpondeur allumé (mode A+C ou S) obligatoire.',
    SIV: 'Secteur d\'information de vol : contact recommandé (information de vol, trafic, alerte), code transpondeur attribué.',
    P: 'Zone interdite : pénétration interdite.',
    R: 'Zone réglementée : pénétration interdite pendant l\'activité sauf autorisation (horaires, conditions et contact dans les remarques / AIP ENR 5.1, SUP AIP, NOTAM).',
    D: 'Zone dangereuse : pénétration non interdite mais à éviter pendant l\'activité ; se renseigner auprès de l\'organisme indiqué.',
    RTBA: 'RTBA (réseau très basse altitude défense) : pénétration interdite pendant l\'activité — consulter l\'AZBA (créneaux de la veille / du jour).',
  };
  function aspColor(v) {
    if (v.rtba) return '#ff3b30';
    if (v.kind === 'P') return '#d81b60';
    if (v.kind === 'R') return '#8e24aa';
    if (v.kind === 'D') return '#fb8c00';
    if (v.kind === 'SIV') return '#66bb6a';
    if (v.kind === 'RMZ') return '#00acc1';
    if (v.kind === 'TMZ') return '#7e57c2';
    return { A: '#c62828', B: '#ad1457', C: '#6a1b9a', D: '#1e88e5', E: '#43a047' }[v.cls] || '#64b5f6';
  }
  function aspVolumes() {
    const out = [];
    const act = rtbaToday();
    for (const s of AIR.asp) out.push({ name: s.name, kind: s.kind, cls: s.cls, lowerS: s.lower, upperS: s.upper, freq: s.freq, call: s.call, poly: s.poly });
    for (const z of AIR.zones) {
      const slots = act[z.id.replace(/\s/g, '')];
      out.push({ name: `${z.id} ${z.name}`, kind: z.type, cls: z.type, lowerS: z.lower, upperS: z.upper, rmk: z.rmk, poly: z.poly, rtba: !!z.rtba, slots });
    }
    return out.map((v) => ({ ...v, lo: altFt(v.lowerS), hi: Math.min(altFt(v.upperS) ?? 19500, 66000), loAgl: isAglS(v.lowerS), hiAgl: isAglS(v.upperS), color: aspColor(v) }))
      .filter((v) => v.lo !== null && v.poly && v.poly.length > 2);
  }
  function rulesOf(v) {
    const r = [];
    if (v.rtba) r.push(KIND_RULES.RTBA);
    else if (KIND_RULES[v.kind]) r.push(KIND_RULES[v.kind]);
    if (!['P', 'R', 'D'].includes(v.kind)) {
      const c = (v.cls || '').split('/')[0];
      if (CLS_RULES[c] && !(v.kind === 'SIV' && c === 'G')) r.push(...CLS_RULES[c].map((x) => `Classe ${c} : ${x}`));
      if (v.kind === 'SIV') r.push('Classe G/E selon la tranche : voir la carte OACI.');
    }
    return r;
  }
  function aspCard(v, extra = '') {
    return `<div class="asp-card" style="border-left-color:${v.color}">
      <div class="asp-h"><b>${esc(v.name)}</b> <span class="asp-cls" style="background:${v.color}">${esc(['P', 'R', 'D'].includes(v.kind) ? (v.rtba ? 'RTBA' : 'Zone ' + v.kind) : `${v.kind} · classe ${v.cls}`)}</span></div>
      <div class="asp-lim">⬇ ${esc(v.lowerS)} &nbsp; ⬆ ${esc(v.upperS)}${extra}</div>
      ${v.freq ? `<div class="asp-f">📻 ${esc(v.call || '')} <b>${esc(v.freq)}</b></div>` : ''}
      ${v.slots ? `<div class="asp-f" style="color:#ff6b6b"><b>Active aujourd'hui : ${esc(v.slots.join(', '))} UTC</b></div>` : ''}
      <ul>${rulesOf(v).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${v.rmk ? `<details><summary>Remarques AIP</summary><p class="meta">${esc(v.rmk)}</p></details>` : ''}
    </div>`;
  }
  async function elevFt(points) {
    try {   // tuiles d'altitude de prepavol.js (sans quota) ; Open-Meteo seulement si elles manquent
      const m = window.AWW_elevations ? await window.AWW_elevations(points) : (await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${points.map((p) => p[0].toFixed(4)).join(',')}&longitude=${points.map((p) => p[1].toFixed(4)).join(',')}`)).json()).elevation;
      return m.map((x) => Math.max(0, Math.round(x * 3.281)));
    } catch { return points.map(() => 0); }
  }
  // échelle verticale : 0–6 000 ft sur 55 % de la hauteur, puis jusqu'au FL195
  const vScale = (ft, top, bot) => { const f = Math.min(ft, 19500); const k = f <= 6000 ? f / 6000 * .55 : .55 + (f - 6000) / 13500 * .45; return bot - k * (bot - top); };
  const vTicks = [[0, 'SOL'], [1000, '1000'], [2000, '2000'], [3000, '3000'], [4000, '4000'], [5000, '5000'], [6500, 'FL065'], [10000, 'FL100'], [11500, 'FL115'], [14500, 'FL145'], [19500, 'FL195']];
  async function showStack(lat, lon, title) {
    await loadAirLayers();
    const p = [lat, lon];
    const [ter] = await elevFt([p]);
    const vols = aspVolumes().filter((v) => inPolyM(p, v.poly)).map((v) => ({ ...v, a: v.lo + (v.loAgl ? ter : 0), b: v.hi + (v.hiAgl ? ter : 0) }))
      .sort((x, y) => x.a - y.a || y.b - x.b);
    const W = 430, H = 380, top = 10, bot = H - 14, x0 = 52;
    const lanes = [];
    vols.forEach((v) => { let i = lanes.findIndex((e) => e <= v.a); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = v.b; v.lane = i; });
    const nl = Math.max(1, lanes.length), lw = (W - x0 - 6) / nl;
    const rects = vols.map((v) => {
      const y1 = vScale(v.b, top, bot), y2 = vScale(v.a, top, bot), x = x0 + v.lane * lw + 2;
      const lbl = y2 - y1 > 22 ? `<text x="${x + 4}" y="${y1 + 12}" font-size="10" font-weight="700" fill="#fff">${esc(v.name.slice(0, Math.floor(lw / 6.2)))}</text><text x="${x + 4}" y="${y1 + 23}" font-size="9" fill="#dfe">${esc(v.freq || (v.kind === 'P' ? 'INTERDITE' : ''))}</text>` : '';
      return `<g><title>${esc(v.name)} — ${esc(v.lowerS)} / ${esc(v.upperS)}${v.freq ? ' — ' + esc(v.call || '') + ' ' + esc(v.freq) : ''}</title><rect x="${x}" y="${y1}" width="${lw - 4}" height="${Math.max(2, y2 - y1)}" rx="4" fill="${v.color}" fill-opacity=".45" stroke="${v.color}" stroke-width="1.5"/>${lbl}</g>`;
    }).join('');
    const ticks = vTicks.map(([f, t]) => `<line x1="${x0 - 4}" x2="${W}" y1="${vScale(f, top, bot)}" y2="${vScale(f, top, bot)}" stroke="#fff" stroke-opacity=".08"/><text x="2" y="${vScale(f, top, bot) + 3}" font-size="9" fill="#9bd">${t}</text>`).join('');
    const ground = `<rect x="${x0 - 4}" y="${vScale(ter, top, bot)}" width="${W - x0 + 4}" height="${bot - vScale(ter, top, bot) + 14}" fill="#8d6e63" fill-opacity=".9"/><text x="${W - 4}" y="${bot + 10}" font-size="9" fill="#fff" text-anchor="end">sol ${ter} ft</text>`;
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="cut-svg">${ticks}${rects}${ground}</svg>`;
    const below = vols.length ? '' : '<div class="okk">Aucun espace contrôlé ni zone : classe G jusqu\'au FL065 au moins (auto-information 123.500, SIV conseillé).</div>';
    showList(title || `Coupe des espaces — ${lat.toFixed(3)}, ${lon.toFixed(3)}`, `
      <p class="meta">Empilement des espaces au-dessus de ce point, du sol au FL195 (échelle dilatée sous 6 000 ft). Les limites « ASFC » sont ramenées au relief (${ter} ft). Survole un bloc pour le détail.</p>
      ${svg}${below}
      <h4>Règles de pénétration et fréquences</h4>
      ${vols.map((v) => aspCard(v, ` <span class="meta">(${Math.round(v.a)}–${v.b >= 19500 ? 'FL195+' : Math.round(v.b)} ft)</span>`)).join('')}
      <p class="legend small-print">Espaces : fichier OpenAir FFVP (non officiel), zones P/R/D : eAIP ENR 5.1. Vérifier sur la carte OACI en vigueur, l'AIP et les NOTAM / SUP AIP.</p>`);
  }
  async function showSection(a, b) {
    await loadAirLayers();
    const n = 80, pts = [];
    for (let i = 0; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    const totNm = distKm(a[0], a[1], b[0], b[1]) / 1.852;
    const ter = await elevFt(pts);
    const vols = [];
    for (const v of aspVolumes()) {
      if (v.lo > 19000) continue;
      let cur = null;
      pts.forEach((p, i) => {
        const ins = inPolyM(p, v.poly);
        if (ins && !cur) cur = { i0: i, i1: i, tmax: 0 };
        if (ins) { cur.i1 = i; cur.tmax = Math.max(cur.tmax, ter[i]); }
        if ((!ins || i === n) && cur) { vols.push({ ...v, i0: cur.i0, i1: cur.i1, a: v.lo + (v.loAgl ? cur.tmax : 0), b: v.hi + (v.hiAgl ? cur.tmax : 0) }); cur = null; }
      });
    }
    const W = 460, H = 300, top = 8, bot = H - 22, x0 = 46, X = (i) => x0 + i / n * (W - x0 - 6);
    vols.sort((x, y) => (y.b - y.a) - (x.b - x.a));
    const rects = vols.map((v) => {
      const xa = X(Math.max(0, v.i0 - .5)), xb = X(Math.min(n, v.i1 + .5)), y1 = vScale(v.b, top, bot), y2 = vScale(v.a, top, bot);
      const lbl = xb - xa > 46 && y2 - y1 > 14 ? `<text x="${xa + 3}" y="${y1 + 11}" font-size="9" font-weight="700" fill="#fff">${esc(v.name.slice(0, Math.floor((xb - xa) / 5.6)))}</text>` : '';
      return `<g><title>${esc(v.name)} — ${esc(v.lowerS)} / ${esc(v.upperS)}${v.freq ? ' — ' + esc(v.call || '') + ' ' + esc(v.freq) : ''}</title><rect x="${xa}" y="${y1}" width="${Math.max(2, xb - xa)}" height="${Math.max(2, y2 - y1)}" fill="${v.color}" fill-opacity=".3" stroke="${v.color}" stroke-width="1.2"/>${lbl}</g>`;
    }).join('');
    const ticks = vTicks.map(([f, t]) => `<line x1="${x0 - 4}" x2="${W}" y1="${vScale(f, top, bot)}" y2="${vScale(f, top, bot)}" stroke="#fff" stroke-opacity=".08"/><text x="2" y="${vScale(f, top, bot) + 3}" font-size="9" fill="#9bd">${t}</text>`).join('');
    const terPath = `M${X(0)},${bot} ` + ter.map((t, i) => `L${X(i).toFixed(1)},${vScale(t, top, bot).toFixed(1)}`).join(' ') + ` L${X(n)},${bot} Z`;
    const nmTicks = [0, .25, .5, .75, 1].map((k) => `<text x="${X(n * k)}" y="${H - 6}" font-size="9" fill="#9bd" text-anchor="${k === 0 ? 'start' : k === 1 ? 'end' : 'middle'}">${Math.round(totNm * k)} NM</text>`).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="cut-svg">${ticks}${rects}<path d="${terPath}" fill="#8d6e63" fill-opacity=".9"/>${nmTicks}<text x="${X(0) + 2}" y="${bot - 4}" font-size="10" font-weight="700" fill="#fff">A</text><text x="${X(n) - 10}" y="${bot - 4}" font-size="10" font-weight="700" fill="#fff">B</text></svg>`;
    const uniq = [...new Map(vols.sort((x, y) => x.i0 - y.i0 || x.a - y.a).map((v) => [v.name + v.lowerS, v])).values()];
    showList(`Coupe A → B (${totNm.toFixed(0)} NM)`, `
      <p class="meta">Coupe verticale des espaces aériens et du relief le long du segment, du sol au FL195 (échelle dilatée sous 6 000 ft). Survole un bloc pour le détail. Clique ailleurs sur la carte pour une nouvelle coupe.</p>
      ${svg}
      <h4>Espaces traversés (${uniq.length}) — règles et fréquences</h4>
      ${uniq.map((v) => aspCard(v, ` <span class="meta">· de ${Math.round(v.i0 / n * totNm)} à ${Math.round(v.i1 / n * totNm)} NM</span>`)).join('') || '<div class="okk">Aucun espace contrôlé ni zone : classe G.</div>'}
      <p class="legend small-print">Espaces : fichier OpenAir FFVP (non officiel), zones P/R/D : eAIP ENR 5.1. Vérifier sur la carte OACI en vigueur, l'AIP et les NOTAM / SUP AIP.</p>`);
  }
  const cutLayer = L.layerGroup().addTo(map);
  let cutMode = false, cutA = null;
  const cutBtn = $('#btn-cut'), cutHint = $('#cut-hint');
  function setCut(on) {
    cutMode = on; cutA = null; cutLayer.clearLayers(); pickOff = on;
    cutBtn.classList.toggle('on', on);
    cutHint.hidden = !on;
    map.getContainer().style.cursor = on ? 'crosshair' : '';
    if (on) cutHint.textContent = '1er clic : empilement au-dessus du point · 2e clic : coupe A → B.';
  }
  cutBtn.addEventListener('click', () => setCut(!cutMode));
  map.on('click', (e) => {
    if (!cutMode) return;
    const p = [e.latlng.lat, e.latlng.lng];
    if (!cutA) {
      cutLayer.clearLayers(); cutA = p;
      L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#ffd34d', fillOpacity: 1 }).bindTooltip('A', { permanent: true, direction: 'right', className: 'tip' }).addTo(cutLayer);
      cutHint.textContent = 'Clique le point B pour la coupe A → B (ou Échap).';
      showStack(p[0], p[1]);
    } else {
      L.polyline([cutA, p], { color: '#ffd34d', weight: 3, dashArray: '8 6' }).addTo(cutLayer);
      L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#ffd34d', fillOpacity: 1 }).bindTooltip('B', { permanent: true, direction: 'right', className: 'tip' }).addTo(cutLayer);
      showSection(cutA, p); cutA = null;
      cutHint.textContent = 'Nouveau clic : nouvelle coupe. Re-clique sur le bouton pour quitter.';
    }
  });
  map.on('contextmenu', (e) => showStack(e.latlng.lat, e.latlng.lng));
  window.addEventListener('aww-clear', () => { if (cutMode) setCut(false); cutLayer.clearLayers(); hiLayer.clearLayers(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cutMode) setCut(false); });

  // ---------- API interne pour le module de préparation de vol (flightprep.js) ----------
  window.AWW = {
    map, L, esc, openWin, getLive, getJSON, distKm, IS_EXT, fmtT, fl, isActive, notamColor, altFt,
    metars, tafs, aptByIcao, APTS, SOURCES,
    showStack: (la, lo, t) => showStack(la, lo, t),
    get NOTAM() { return NOTAM; }, get SUP() { return SUP; }, escaleOf, feeFor, pprText,
    showPanel(title, html) { showList(title, html); },
    detailBody, detail, store, highlight,
    setPickOff(v) { pickOff = v; },
    get AIR() { return AIR; }, loadAirLayers,
    vigOnRoute(pts, a, b) {   // départements traversés en vigilance orange / rouge pendant le vol
      if (!VIG) return [];
      const out = new Map();
      pts.forEach(([la, lo]) => { const f = depAt(la, lo); if (f && !out.has(f.properties.n)) out.set(f.properties.n, vigOf(f.properties.n, a, b).filter((w) => w.lvl >= 2)); });
      return [...out].filter(([, w]) => w.length).map(([dep, w]) => ({ dep, w }));
    },
    setNotamWindow(a, b) {
      const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      $('#notam-from').value = f(a); $('#notam-to').value = f(b); drawNotam();
    },
  };

  // ---------- Application hors ligne (tablette) : service worker + dernier briefing ----------
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    // copie hors ligne (~2,5 Mo) téléchargée après l'affichage de la carte, pour ne pas ralentir le premier chargement
    addEventListener('load', () => setTimeout(() => navigator.serviceWorker.register('sw.js')
      .then((reg) => setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000))   // tablette restée ouverte : vérifie toutes les 30 min
      .catch((e) => console.warn('sw', e)), 4000));
    // nouveau sw.js (VERSION changée) qui prend la main : la page tourne encore avec l'ancien code -> proposer de recharger
    const hadCtrl = !!navigator.serviceWorker.controller;   // sinon c'est la toute première installation, rien à proposer
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadCtrl || $('#update-bar')) return;
      document.body.insertAdjacentHTML('beforeend', '<div id="update-bar" class="glass">✨ Nouvelle version du site disponible <button id="upd-go">Recharger</button><button class="x" id="upd-x" title="Plus tard">✕</button></div>');
      $('#upd-go').addEventListener('click', () => location.reload());
      $('#upd-x').addEventListener('click', () => $('#update-bar').remove());
    });
  }
  async function showLastBriefing() {
    if (!window.caches) return;
    const c = await caches.open('aww-briefings');
    const keys = await c.keys();
    const metaR = await c.match('meta.json');
    const meta = metaR ? await metaR.json() : {};
    const items = [];
    for (const k of keys) {
      const n = new URL(k.url).pathname.split('/').pop();
      if (n === 'meta.json') continue;
      items.push(n);
    }
    showList('Dernier briefing', items.length ? `<p class="meta">Enregistré le ${esc(meta.date || '?')} — consultable sans réseau.</p>`
      + items.map((n) => `<p><button class="btn" data-lastfile="${esc(n)}">${n.endsWith('.pdf') ? '📄' : '📊'} ${esc(n)}</button></p>`).join('')
      : '<p class="meta">Aucun briefing enregistré.</p>');
    detailBody.querySelectorAll('[data-lastfile]').forEach((b) => b.addEventListener('click', async () => {
      const r = await c.match(b.dataset.lastfile); if (!r) return;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = b.dataset.lastfile; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
    }));
  }
  window.AWW_saveBriefing = async (name, blob) => {
    try {
      if (!window.caches) return;
      const c = await caches.open('aww-briefings');
      if (name.endsWith('.pdf')) { for (const k of await c.keys()) await c.delete(k); }
      await c.put(name, new Response(blob));
      await c.put('meta.json', new Response(JSON.stringify({ date: new Date().toLocaleString('fr-FR') })));
      $('#btn-last').hidden = false;
    } catch (e) { console.warn('cache briefing', e); }
  };
  $('#btn-last').addEventListener('click', showLastBriefing);
  if (window.caches) caches.open('aww-briefings').then((c) => c.keys()).then((k) => { if (k.length) $('#btn-last').hidden = false; }).catch(() => {});

  // ---------- Démarrage (chaque chargement est suivi : indicateur en haut de la carte + journal) ----------
  // ---------- état des sources (data/live/status.json écrit par la collecte) : source en échec, suspecte ou trop ancienne
  const SRC_LIMITS = { 'metar.json': [3, 'METAR'], 'taf.json': [8, 'TAF'], 'notam.json': [8, 'NOTAM'], 'supaip.json': [48, 'SUP AIP'], 'special.json': [72, 'zones particulières'],
    'vac.json': [24 * 20, 'VAC'], 'zones.json': [24 * 40, 'zones P / R / D'], 'airspaces.json': [24 * 40, 'espaces aériens'] };
  const hAgo = (h) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} jours`);
  function staleSources(st, now = Date.now()) {
    const out = [], files = (st && st.files) || {};
    if (st && st.run && (now - Date.parse(st.run)) / 36e5 > 2) out.push(`collecte arrêtée depuis ${hAgo((now - Date.parse(st.run)) / 36e5)}`);
    for (const [name, [lim, lbl]] of Object.entries(SRC_LIMITS)) {
      const f = files[name]; if (!f) continue;
      const age = f.last_ok ? (now - Date.parse(f.last_ok)) / 36e5 : Infinity;
      if (age > lim) out.push(`${lbl} : ${f.last_ok ? `dernière collecte réussie il y a ${hAgo(age)}` : 'jamais collecté'}${f.state && !/^(ok|repris)/.test(f.state) ? `, dernier essai : ${f.state}` : ''}`);
      else if (/^suspect/.test(f.state || '')) out.push(`${lbl} : ${f.state}`);
    }
    return out;
  }
  console.assert((() => { const now = Date.parse('2026-11-26T12:00:00Z'), r = staleSources({ run: '2026-11-26T11:45:00Z', files: { 'metar.json': { state: 'échec', last_ok: '2026-11-26T06:00:00Z' }, 'taf.json': { state: 'ok', last_ok: '2026-11-26T11:45:00Z' } } }, now);
    return r.length === 1 && /METAR : dernière collecte réussie il y a 6 h, dernier essai : échec/.test(r[0]); })(), 'staleSources');
  async function loadSourceStatus() {
    const bad = staleSources(await getLive('status.json'));
    if (bad.length) throw new Error(`données anciennes, à vérifier sur les sites officiels — ${bad.join(' ; ')}`);
  }
  const T = window.AWW_LOG.task;
  drawAerodromes();
  T('METAR / TAF', loadMetarTaf);
  T('NOTAM / SUP AIP', loadNotamSup); T('Sources de données', loadSourceStatus);
  T('Balises vent', loadPiouPiou);
  // fichiers lourds (VAC 700 ko) chargés une fois la carte affichée
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  idle(() => { T('Fiches escale (VAC)', loadEscale); loadCamStatus(); T('Vigilance', loadVig); T('Sources de données', loadSourceStatus); });
  setInterval(() => T('METAR / TAF', loadMetarTaf), 5 * 60 * 1000);
  setInterval(() => { T('Balises vent', loadPiouPiou); T('NOTAM / SUP AIP', loadNotamSup); if (radarFrames.length) loadRadar(); }, REFRESH_MS);
  $('#btn-log').addEventListener('click', () => {
    showList('Signaler un problème', `<p>Le <b>journal</b> est un petit fichier texte qui liste ce qui a chargé ou échoué sur cet appareil. Il aide à trouver la panne.</p>
      <div class="row"><button class="btn${CFG.contact ? '' : ' primary'}" id="rep-log">📋 Télécharger le journal</button>${CFG.contact ? '<button class="btn primary" id="rep-mail">✉️ Écrire un e-mail</button>' : ''}</div>
      <p class="meta">${CFG.contact ? 'L\'e-mail contient déjà les dernières erreurs. Décris ce que tu faisais et, si possible, joins le journal.' : 'Envoie ce fichier, avec deux mots sur ce que tu faisais, à la personne qui t\'a partagé le site.'}</p>`);
    $('#rep-log').addEventListener('click', () => window.AWW_LOG.download());
    if (CFG.contact) $('#rep-mail').addEventListener('click', () => {
      const L = window.AWW_LOG, errs = L.lines.filter((l) => /\[(ERREUR|error|warn|http|réseau|lent)/.test(l)).slice(-12).join('\n');
      mailTo('Problème', `Ce que je faisais / ce qui ne marche pas :\n\n\n---\nNavigateur : ${navigator.userAgent}\nÉcran : ${innerWidth}×${innerHeight}\n${errs || 'aucune erreur notée'}`.slice(0, 1800));
    });
  });
  $('#btn-zip').addEventListener('click', () => {
    showList('Télécharger le site', `<p>Archive complète du site (carte, préparation de vol, données du moment) :</p>
      <p><a class="btn primary" href="${IS_EXT ? CFG.liveUrl : ''}site.zip" download>⬇️ Télécharger le zip</a></p>
      <h4>Utiliser la copie téléchargée</h4>
      <ol class="meta"><li>Décompresser le zip.</li><li>Chrome / Edge / Brave : <code>chrome://extensions</code> → activer le <b>Mode développeur</b> → <b>Charger l'extension non empaquetée</b> → choisir le dossier.</li>
      <li>L'extension lit les NOTAM / SUP AIP à jour sur le site et les METAR en direct.</li></ol>
      <p class="meta">Ouvrir directement <code>map.html</code> depuis le disque ne suffit pas : le navigateur bloque la lecture des fichiers de données. Sur tablette, utiliser plutôt « Ajouter à l'écran d'accueil » (fonctionne hors ligne).</p>`);
  });
})();
