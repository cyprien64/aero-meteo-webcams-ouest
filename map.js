/* Aéro Météo Webcams — Pyrénées → Bretagne
 * Carte interactive inspirée de international.aero.free.fr/webcams/lfdt.html
 * étendue à tout l'Ouest de la France.
 */
(() => {
  'use strict';

  const BBOX = { s: 42.0, w: -5.4, n: 49.0, e: 2.6 };
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
  const view = store.get('view', { c: [45.9, -1.4], z: 7 });
  const map = L.map('map', { zoomSnap: 0.5, minZoom: 5, maxZoom: 15, worldCopyJump: false, preferCanvas: false })
    .setView(view.c, view.z);
  map.on('moveend', () => {
    const c = map.getCenter();
    store.set('view', { c: [+c.lat.toFixed(3), +c.lng.toFixed(3)], z: map.getZoom() });
  });
  map.attributionControl.setPrefix('<a href="http://international.aero.free.fr/" target="_blank">Inspiré d\'Inter Aéro</a>');

  map.createPane('basePane').style.zIndex = 150;
  const radarPane = map.createPane('radarPane');
  radarPane.style.zIndex = 350; radarPane.style.opacity = 0.75;

  const schema = L.geoJSON(window.BASEMAP, {
    pane: 'basePane', interactive: false,
    style: (f) => {
      const k = f.properties.k;
      if (k === 'nb') return { color: '#ffffff', weight: 1, opacity: .7, fillColor: '#0a6a9c', fillOpacity: 1 };
      if (k === 'reg') return { color: '#ffffff', weight: 1.4, opacity: .9, fill: false };
      return { color: '#ffffff', weight: .5, opacity: .25, fillColor: '#0b74aa', fillOpacity: 1 };
    },
  });
  const tileOpt = { maxZoom: 15 };
  const bases = {
    schema,
    carto: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { ...tileOpt, attribution: '© OpenStreetMap, © CARTO' }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { ...tileOpt, maxNativeZoom: 15, attribution: '© OpenStreetMap, SRTM, © OpenTopoMap' }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { ...tileOpt, attribution: 'Imagerie © Esri' }),
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

  // Noms des aérodromes visibles seulement à partir d'un certain zoom
  const updateZoomClass = () => {
    const z = map.getZoom();
    map.getContainer().classList.toggle('z-lo', z < 7);
    map.getContainer().classList.toggle('z-mid', z < 8.5);
  };
  map.on('zoomend', updateZoomClass); updateZoomClass();
  const zs = document.createElement('style');
  zs.textContent = `.z-lo .apt-plain .apt-label{display:none}.z-mid .apt-label small{display:none}.z-lo .apt-metar .apt-label{font-size:10px}`;
  document.head.appendChild(zs);

  // ---------- Icônes ----------
  const svgCam = (fill) => `<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${fill}" stroke="#003a5c" stroke-width="1.5"/><path d="M6 9.2c0-.7.5-1.2 1.2-1.2h1.6l1-1.5h4.4l1 1.5h1.6c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H7.2c-.7 0-1.2-.5-1.2-1.2z" fill="#003a5c"/><circle cx="12" cy="12.2" r="2.6" fill="${fill}"/></svg>`;
  const svgFlag = `<svg width="18" height="22" viewBox="0 0 18 22"><path d="M3 21V2" stroke="#fff" stroke-width="1.6"/><path d="M3.8 2.5h11l-3 3.5 3 3.5h-11z" fill="#ff4b3e" stroke="#7a0f08" stroke-width=".6"/></svg>`;
  const svgSock = (cat) => `<svg width="30" height="22" viewBox="0 0 30 22"><path d="M2 21V3" stroke="#fff" stroke-width="1.8"/><path d="M3 3l24 3.5v6L3 15z" fill="#fff" style="stroke:var(--${cat})" stroke-width="2"/><path d="M8 3.7v10.6M14 4.6v8.8M20 5.5v7.1" stroke="#ff2a2a" stroke-width="3.2"/></svg>`;
  const windColor = (kmh) => kmh == null ? '#9aa' : kmh < 10 ? '#3cdc6c' : kmh < 20 ? '#c7f03c' : kmh < 30 ? '#ffb21e' : kmh < 40 ? '#ff5a1e' : '#d11fd1';
  const svgArrow = (deg, col) => `<svg width="26" height="26" viewBox="0 0 26 26" style="transform:rotate(${deg}deg)"><path d="M13 2l6.5 20L13 18l-6.5 4z" fill="${col}" stroke="#002a40" stroke-width="1.2"/></svg>`;

  const divIcon = (html, size, anchor, cls = 'mk') => L.divIcon({ html, className: cls, iconSize: size, iconAnchor: anchor });

  function tipHtml(title, img) {
    return `<b>${esc(title)}</b>${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : ''}<div style="opacity:.7;font-size:11px">Clic : ouvrir</div>`;
  }

  // ---------- Couches de points (webcams, observations, balises) ----------
  const layers = {
    metar: L.layerGroup(), apt: L.layerGroup(), camAero: L.layerGroup(), cam: L.layerGroup(),
    obs: L.layerGroup(), wind: L.layerGroup(), radar: L.layerGroup(),
    notam: L.layerGroup(), supaip: L.layerGroup(),
  };
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
    const mk = L.marker([s.la, s.lo], { icon, title: '', riseOnHover: true })
      .bindTooltip(tipHtml(s.n, s.img), { className: 'tip', direction: 'top', offset: [0, -10] })
      .on('click', () => openWin(s.u, s.w, s.h));
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
    const nN = (NOTAM.ad[a.icao] || []).length;
    const badge = nN ? `<b class="nbadge" title="${nN} NOTAM">${nN}</b>` : '';
    const lbl = `<span class="apt-label" style="position:absolute;left:${m ? 16 : 9}px;top:-7px">${a.icao}${badge}<small>${esc(a.name)}</small></span>`;
    if (m) {
      const cat = m.fltCat || 'UNK';
      return divIcon(`<div style="position:relative">${svgSock(cat)}${lbl}</div>`, [30, 22], [3, 20], 'mk apt-metar');
    }
    return divIcon(`<div style="position:relative"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.2" fill="#0b4f78" stroke="#9be34b" stroke-width="2"/></svg>${lbl}</div>`, [12, 12], [6, 6], 'mk apt-plain');
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
      const mk = L.marker([a.la, a.lo], { icon: aptIcon(a), zIndexOffset: metars[a.icao] ? 500 : 0 })
        .bindTooltip(aptTip(a), { className: 'tip', direction: 'top', offset: [0, -12] })
        .on('click', () => showAerodrome(a.icao));
      mk.addTo(metars[a.icao] ? layers.metar : layers.apt);
      aptMarkers[a.icao] = mk;
    }
    // Stations METAR absentes de la base (ex. Espagne) : ajout direct
    for (const m of Object.values(metars)) {
      if (aptByIcao[m.icaoId]) continue;
      const a = { icao: m.icaoId, name: (m.name || '').replace(/,.*$/, ''), la: m.lat, lo: m.lon, elev: Math.round((m.elev || 0) * 3.281) };
      APTS.push(a); aptByIcao[a.icao] = a;
      L.marker([a.la, a.lo], { icon: aptIcon(a), zIndexOffset: 500 })
        .bindTooltip(aptTip(a), { className: 'tip', direction: 'top', offset: [0, -12] })
        .on('click', () => showAerodrome(a.icao)).addTo(layers.metar);
      searchIndex.push({ label: `${a.icao} ${a.name}`, sub: 'Aérodrome', lat: a.la, lon: a.lo, action: () => showAerodrome(a.icao) });
    }
  }
  for (const a of APTS) searchIndex.push({ label: `${a.icao} ${a.name}`, sub: 'Aérodrome', lat: a.la, lon: a.lo, action: () => showAerodrome(a.icao) });

  // ---------- Données en direct ----------
  const status = $('#status');
  const setStatus = (t) => { status.textContent = t; };
  const bboxParam = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }

  // Extension : appels directs (permissions d'hôte). Site web (GitHub Pages) : fichiers data/live/
  // rafraîchis automatiquement par la GitHub Action (les API officielles bloquent le CORS).
  const IS_EXT = !!(window.chrome && chrome.runtime && chrome.runtime.id);
  const CFG = window.AWW_CONFIG || {};
  async function getLive(name) {
    const bases = IS_EXT && CFG.liveUrl ? [CFG.liveUrl.replace(/\/$/, '') + '/', ''] : [''];
    let last;
    for (const b of bases) {
      try { return await getJSON(`${b}data/live/${name}?t=${Date.now()}`); } catch (e) { last = e; }
    }
    throw last;
  }

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
      drawAerodromes();
      setStatus(`${Object.keys(metars).length} METAR · ${Object.keys(tafs).length} TAF · maj ${new Date().toISOString().slice(11, 16)} UTC`);
      if (openedIcao) showAerodrome(openedIcao, false);
    } catch (e) {
      console.warn(e);
      drawAerodromes();
      setStatus('METAR indisponibles (connexion ?) — nouvel essai dans 10 min');
    }
  }

  const windLive = L.layerGroup().addTo(layers.wind);
  async function loadPiouPiou() {
    try {
      const d = (await getJSON('https://api.pioupiou.fr/v1/live/all')).data || [];
      windLive.clearLayers();
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
        L.marker([loc.latitude, loc.longitude], { icon })
          .bindTooltip(`<b>${esc(name)}</b> (OpenWindMap)<br>Vent ${hd ?? '?'}° · moy ${avg ?? '?'} km/h · rafales ${max ?? '?'} km/h<br><span style="opacity:.7">il y a ${age} min</span>`, { className: 'tip', direction: 'top' })
          .on('click', () => openWin(`https://www.openwindmap.org/PP${p.id}`, 800, 0))
          .addTo(windLive);
      }
    } catch (e) { console.warn('pioupiou', e); }
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

  // ---------- Gestion des calques ----------
  const layerState = store.get('layers', {});
  document.querySelectorAll('input[data-layer]').forEach((cb) => {
    const k = cb.dataset.layer;
    if (k in layerState) cb.checked = layerState[k];
    const apply = () => {
      if (cb.checked) layers[k].addTo(map); else map.removeLayer(layers[k]);
      layerState[k] = cb.checked; store.set('layers', layerState);
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

  function showAerodrome(icao, fly = true) {
    const a = aptByIcao[icao]; if (!a) return;
    openedIcao = icao;
    const m = metars[icao], t = tafs[icao];
    const near = SOURCES.filter((s) => s.t !== 'fcst').map((s) => ({ s, d: distKm(a.la, a.lo, s.la, s.lo) }))
      .filter((x) => x.d <= 25).sort((x, y) => x.d - y.d);
    const cams = near.filter((x) => x.s.t === 'cam').slice(0, 12);
    const others = near.filter((x) => x.s.t !== 'cam').slice(0, 8);
    const lat = fmtCoord(a.la, 'N', 'S'), lon = fmtCoord(a.lo, 'E', 'W');
    const links = [
      ['Météogramme meteoblue', `https://www.meteoblue.com/fr/meteo/semaine/${lat}${lon}`, 1200, 0],
      ['Windy', `https://www.windy.com/?${a.la},${a.lo},10`, 1200, 0],
      ['METAR/TAF 12 h', `https://aviationweather.gov/api/data/metar?ids=${icao}&hours=12&sep=true&taf=true`, 1100, 0],
      ['Fiche Aerobreak', `https://map.aerobreak.com/aerodrome-${icao}.html`, 1280, 0],
      ['Carte OACI Géoportail', `https://www.geoportail.gouv.fr/carte?c=${a.lo},${a.la}&z=11&l0=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN-OACI::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`, 1400, 0],
      ['Trafic SafeSky', `https://live.safesky.app/map?lat=${a.la}&lng=${a.lo}&zoom=10`, 1400, 0],
    ];
    if (fcstByIcao[icao]) links.unshift(['Prévisions Inter Aéro', fcstByIcao[icao].u, 1174, 984]);
    const html = `
      <h3><span class="icao">${icao}</span> ${esc(a.name)}</h3>
      <p class="meta">${lat} ${lon}${a.elev !== '' && a.elev != null ? ` · ${a.elev} ft` : ''}
        ${m ? ` · <span class="cat c-${m.fltCat || 'UNK'}">${m.fltCat || '?'}</span>` : ''}</p>
      ${m ? `<h4>METAR</h4><pre>${esc(m.rawOb)}</pre>${decodeMetar(m)}` : '<p class="meta">Pas de METAR pour cet aérodrome — voir la station la plus proche.</p>'}
      ${t ? `<h4>TAF</h4><pre>${esc(t.rawTAF.replace(/\s(?=(BECMG|TEMPO|PROB\d\d|FM\d{6}))/g, '\n  '))}</pre>` : ''}
      ${!m ? nearestMetarHtml(a) : ''}
      ${escaleHtml(icao)}
      ${notamAdHtml(icao)}
      ${supNearHtml(a)}
      <h4>Liens météo</h4>
      <div class="row">${links.map((l, i) => `<button class="btn" data-link="${i}">${esc(l[0])}</button>`).join('')}</div>
      <h4>Webcams à moins de 25 km (${cams.length})</h4>
      ${cams.length ? `<div class="cams">${cams.map((x, i) => `
        <div class="cam" data-cam="${i}" title="${esc(x.s.n)}">
          ${x.s.img ? `<img src="${esc(x.s.img)}" loading="lazy" alt="">` : '<div class="noimg">📷</div>'}
          <span>${esc(x.s.n)} · ${x.d.toFixed(0)} km</span>
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
    bindDocLinks(detailBody);
    detail.hidden = false;
    if (fly) map.flyTo([a.la, a.lo], Math.max(map.getZoom(), 9), { duration: .6 });
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
        map.flyTo([h.lat, h.lon], Math.max(map.getZoom(), 10), { duration: .6 });
        h.action();
      });
      results.appendChild(li);
    }
  });

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
  function notamHtml(n, withA = false) {
    const txt = n.efr || n.e || '';
    const act = isActive(n);
    return `<div class="notam${act ? '' : ' future'}" style="border-left-color:${notamColor(n.q)}">
      <div class="nh"><b>${esc(n.ref)}</b>${withA && n.a ? ` · ${esc(n.a)}` : ''} · Q ${esc(n.q || '')}
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
  async function loadEscale() {
    try { VACD = (await getLive('vac.json')).data || {}; } catch (e) { console.warn('vac', e); }
    try { const r = await fetch('data/fees.json', { cache: 'no-store' }); FEES = (await r.json()).aerodromes || {}; } catch (e) { console.warn('fees', e); }
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
        ${tels.length ? `<dt>Téléphone</dt><dd>${[...new Set(tels)].map((t) => `<a href="tel:${esc(t.replace(/\s/g, ''))}" style="color:#fff">${esc(t)}</a>`).join(' · ')}</dd>` : ''}
        <dt>Taxe d'atterrissage</dt><dd>${fee ? `<b>${esc(fee.tarif)}</b>${fee.note ? ' — ' + esc(fee.note) : ''} <span class="meta">(${esc(fee.source || 'tableau du club')}${fee.maj ? ', ' + esc(fee.maj) : ''})</span>` : '<span class="meta">non renseignée</span>'}</dd>
      </dl>
      <div class="row" style="margin-top:4px">
        <input id="fee-in" placeholder="ex. 10 € TTC, gratuit…" value="${fee && fee.source === 'saisie personnelle' ? esc(fee.tarif) : ''}" style="flex:1;min-width:140px;margin:0">
        <button class="btn" id="fee-save">Enregistrer la taxe</button>
      </div>
      <div class="row" style="margin-top:4px">
        <button class="btn" data-ext="https://airfield.directory/airfield/${icao}">Tarifs (airfield.directory)</button>
        <button class="btn" data-ext="https://www.aerops.com/fr/airports-1/fee-info/${icao}/">Tarifs (aeroPS)</button>
        ${e && e.site ? `<button class="btn" data-ext="${esc(/^https?:/.test(e.site) ? e.site : 'https://' + e.site)}">Site de l'aérodrome</button>` : ''}
      </div>`;
  }
  function bindEscale(el, icao) {
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
  }

  function notamAdHtml(icao) {
    const list = NOTAM.ad[icao] || [];
    if (!list.length) return NOTAM.generated ? '<h4>NOTAM aérodrome</h4><p class="meta">Aucun NOTAM pour les prochaines 24 h.</p>' : '';
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
    for (const n of NOTAM.fir) {
      if (n.la == null || n.lo == null) continue;
      if (n.lower != null && n.lower > maxFl) continue;
      const isObst = (n.q || '')[0] === 'O';
      if (isObst && hideObst) continue;
      const tip = `<b>NOTAM ${esc(n.ref)}</b> · ${fl(n.lower)}–${fl(n.upper)}<br>${fmtT(n.from)} → ${fmtT(n.to)}<br>${esc((n.efr || n.e || '').slice(0, 220))}${(n.efr || n.e || '').length > 220 ? '…' : ''}`;
      const open = () => showList(`NOTAM ${n.ref}`, notamHtml(n, true));
      if (isObst || !n.r || n.r <= 1) {
        L.marker([n.la, n.lo], { icon: divIcon(isObst ? svgObst : `<svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="${notamColor(n.q)}" stroke="#222"/></svg>`, [14, 14], [7, 7]) })
          .bindTooltip(tip, { className: 'tip', direction: 'top' }).on('click', open).addTo(layers.notam);
      } else if (n.r <= 30) {
        const col = notamColor(n.q);
        L.circle([n.la, n.lo], { radius: n.r * 1852, color: col, weight: isActive(n) ? 2 : 1, dashArray: isActive(n) ? null : '5 5', fillColor: col, fillOpacity: .08 })
          .bindTooltip(tip, { className: 'tip', sticky: true }).on('click', open).addTo(layers.notam);
      }
    }
  }
  function drawSup() {
    layers.supaip.clearLayers();
    for (const s of SUP) {
      s.places.forEach((p) => {
        L.marker([p.la, p.lo], { icon: divIcon(svgSup, [24, 26], [12, 13]), zIndexOffset: 300 })
          .bindTooltip(`<b>SUP AIP ${esc(s.num)}</b> (${esc(p.n)})<br>${esc(s.title)}<br>du ${esc(s.from || '?')} au ${esc(s.to || '?')}`, { className: 'tip', direction: 'top' })
          .on('click', () => openWin(s.url, 1000, 0))
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
    const inView = NOTAM.fir.filter((n) => n.la != null && v.contains([n.la, n.lo]));
    const noPos = NOTAM.fir.filter((n) => n.la == null);
    const byCat = (a, b) => (a.q || '').localeCompare(b.q || '');
    showList('NOTAM en route — FIR Brest & Bordeaux', `
      <p class="meta">${NOTAM.fir.length} NOTAM (24 h, SFC–FL195) · ${inView.length} dans la vue actuelle · collecte ${fmtT(NOTAM.generated)}.</p>
      ${inView.sort(byCat).map((n) => notamHtml(n, true) + `<div class="row"><button class="btn small-btn" data-flyto="${n.la},${n.lo}">📍 voir</button></div>`).join('')}
      ${NOTAM.fir.some((n) => n.r > 30) ? `<p class="meta small-print">Les NOTAM de rayon &gt; 30 NM ne sont pas dessinés sur la carte mais figurent dans cette liste.</p>` : ''}
      ${noPos.length ? `<h4>Sans position (${noPos.length})</h4>${noPos.map((n) => notamHtml(n, true)).join('')}` : ''}
      <p class="meta small-print">Données SOFIA-Briefing (SIA/DGAC). Outil d'aide : faire un dossier de vol officiel sur SOFIA.</p>`);
  }

  async function loadNotamSup() {
    const st = [];
    try {
      NOTAM = await getLive('notam.json');
      drawNotam(); drawAerodromes();
      const nAd = Object.values(NOTAM.ad).reduce((s, l) => s + l.length, 0);
      st.push(`${NOTAM.fir.length + nAd} NOTAM`);
    } catch (e) { console.warn('notam', e); st.push('NOTAM indisponibles'); }
    try {
      SUP = (await getLive('supaip.json')).data || [];
      drawSup();
      st.push(`${SUP.length} SUP AIP`);
    } catch (e) { console.warn('sup', e); st.push('SUP AIP indisponibles'); }
    $('#status2').textContent = st.join(' · ') + (NOTAM.generated ? ` (collecte ${fmtT(NOTAM.generated)})` : '');
    if (openedIcao) showAerodrome(openedIcao, false);
  }
  $('#notam-obst').addEventListener('change', drawNotam);
  $('#notam-fl').addEventListener('change', drawNotam);
  $('#btn-notam-list').addEventListener('click', showNotamList);
  $('#btn-sup-list').addEventListener('click', showSupList);

  // ---------- API interne pour le module de préparation de vol (flightprep.js) ----------
  window.AWW = {
    map, L, esc, openWin, getLive, getJSON, distKm, IS_EXT, fmtT, fl, isActive, notamColor,
    metars, tafs, aptByIcao, APTS, SOURCES,
    get NOTAM() { return NOTAM; }, get SUP() { return SUP; }, escaleOf, feeFor,
    showPanel(title, html) { showList(title, html); },
    detailBody, detail,
  };

  // ---------- Démarrage ----------
  drawAerodromes();
  loadMetarTaf();
  loadPiouPiou();
  loadNotamSup();
  loadEscale();
  setInterval(() => { loadMetarTaf(); loadPiouPiou(); loadNotamSup(); if (radarFrames.length) loadRadar(); }, REFRESH_MS);
})();
