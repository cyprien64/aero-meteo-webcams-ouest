#!/usr/bin/env python3
"""Collecte des données « en direct » de la carte Aéro Météo Webcams Ouest.

Produit dans data/live/ :
  metar.json, taf.json   — aviationweather.gov (zone Pyrénées → Bretagne)
  notam.json             — NOTAM SOFIA (SIA) : FIR Brest + Bordeaux et aérodromes de la zone
  supaip.json            — liste des SUP AIP métropole (SIA), géolocalisés d'après leur titre

Bibliothèque standard uniquement. Utilisé par la GitHub Action (.github/workflows/pages.yml).
Si une source échoue et que FALLBACK_URL est défini, la dernière version publiée est reprise.
"""
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'live')
os.makedirs(OUT, exist_ok=True)
FALLBACK_URL = os.environ.get('FALLBACK_URL', '').rstrip('/')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
BBOX = '42.0,-5.4,49.0,2.6'
SOFIA = 'https://sofia-briefing.aviation-civile.gouv.fr'
NOW = datetime.now(timezone.utc)

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def get(url, data=None, timeout=90, headers=None):
    h = {'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9'}
    h.update(headers or {})
    body = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=h)
    with opener.open(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')


def save(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  -> {name} ({os.path.getsize(os.path.join(OUT, name)) // 1024} ko)')


def fallback(name):
    if not FALLBACK_URL:
        return False
    try:
        txt = get(f'{FALLBACK_URL}/data/live/{name}', timeout=30)
        json.loads(txt)
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            f.write(txt)
        print(f'  -> {name} repris de la version publiée')
        return True
    except Exception as e:  # noqa: BLE001
        print('  fallback impossible :', e)
        return False


def in_zone(la, lo):
    if la < 42.0 or la > 48.95 or lo < -5.4:
        return False
    if la < 46.0:
        return lo <= 2.6
    if la < 48.0:
        return lo <= 2.0
    return lo <= 0.6


def aerodromes():
    src = open(os.path.join(ROOT, 'data', 'sources.js'), encoding='utf-8').read()
    m = re.search(r'window\.AERODROMES = (\[.*?\]);', src, re.S)
    return json.loads(m.group(1))


# ---------------------------------------------------------------- METAR / TAF
def collect_metar_taf():
    print('METAR / TAF')
    for kind in ('metar', 'taf'):
        try:
            d = json.loads(get(f'https://aviationweather.gov/api/data/{kind}?bbox={BBOX}&format=json'))
            keep = ('icaoId', 'obsTime', 'reportTime', 'temp', 'dewp', 'wdir', 'wspd', 'wgst', 'visib', 'altim',
                    'wxString', 'rawOb', 'lat', 'lon', 'elev', 'name', 'clouds', 'fltCat', 'metarType',
                    'issueTime', 'rawTAF', 'validTimeFrom', 'validTimeTo')
            d = [{k: x[k] for k in keep if k in x} for x in d]
            save(f'{kind}.json', {'generated': NOW.isoformat(), 'data': d})
        except Exception as e:  # noqa: BLE001
            print(f'  {kind} : échec', e)
            fallback(f'{kind}.json')


# ---------------------------------------------------------------- NOTAM (SOFIA)
def parse_coord(s):
    m = re.match(r'(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])', s or '')
    if not m:
        return None, None
    la = int(m.group(1)) + int(m.group(2)) / 60
    lo = int(m.group(4)) + int(m.group(5)) / 60
    return round(la * (1 if m.group(3) == 'N' else -1), 4), round(lo * (1 if m.group(6) == 'E' else -1), 4)


def sofia_post(params):
    valid_from = NOW.strftime('%Y-%m-%dT%H:%M:%SZ')
    data = {'valid_from': valid_from, 'uuid': '', 'isFromSofia': 'true'}
    data.update(params)
    txt = get(SOFIA + '/sofia', data, timeout=120, headers={'X-Requested-With': 'XMLHttpRequest',
                                                             'Referer': SOFIA + '/sofia/pages/prepavol.html'})
    st = re.search(r'<div id="Status">(\d+)</div>', txt)
    msg = re.search(r'<div id="Message">(.*?)</div>', txt, re.S)
    if not st or st.group(1) != '200' or not msg:
        raise RuntimeError('SOFIA status ' + (st.group(1) if st else '?'))
    return json.loads(html.unescape(msg.group(1)))


def walk_notams(o):
    if isinstance(o, dict):
        if 'itemE' in o and 'qLine' in o:
            yield o
            return
        for v in o.values():
            yield from walk_notams(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk_notams(v)


def slim_notam(n):
    q = n.get('qLine') or {}
    la, lo = parse_coord(n.get('coordinates'))
    ml = n.get('multiLanguage') or {}
    return {
        'id': n.get('id'),
        'ref': f"{n.get('series', '')}{n.get('number', '')}/{n.get('year', '')}",
        'type': n.get('type'),
        'a': n.get('itemA'),
        'fir': q.get('fir'), 'q': (q.get('code23') or '') + (q.get('code45') or ''),
        'traffic': q.get('traffic'), 'scope': q.get('scope'),
        'lower': q.get('lower'), 'upper': q.get('upper'),
        'la': la, 'lo': lo, 'r': n.get('radius'),
        'from': n.get('startValidity'), 'to': n.get('endValidity'),
        'd': n.get('itemD'), 'f': n.get('itemF'), 'g': n.get('itemG'),
        'e': n.get('itemE'), 'efr': ml.get('itemE'),
    }


def collect_notam():
    print('NOTAM SOFIA')
    try:
        get(SOFIA + '/sofia/pages/prepavol.html', timeout=60)  # cookie de session
        fir = sofia_post({':operation': 'postAreaPibRequest', 'duration': '2400', 'traffic': 'VI',
                          'fl_lower': '000', 'fl_upper': '195', 'fir[]': ['LFRR', 'LFBB']})
        fir_list = {n['id']: slim_notam(n) for n in walk_notams(fir.get('listnotams', {}))}
        print(f'  FIR LFRR+LFBB : {len(fir_list)} NOTAM')

        ad = {}
        icaos = [a[0] for a in aerodromes() if a[0].startswith('LF')]

        def batch(lst):
            try:
                d = sofia_post({':operation': 'postAeroPibRequest', 'duration': '2400', 'traffic': 'VI', 'aero[]': lst})
                for blk in (d.get('listnotams') or {}).get('AD', []) or []:
                    code = blk.get('code')
                    items = [slim_notam(n) for n in walk_notams(blk)]
                    if items:
                        ad.setdefault(code, {})
                        for it in items:
                            ad[code][it['id']] = it
            except Exception as e:  # noqa: BLE001
                if len(lst) > 1:
                    h = len(lst) // 2
                    batch(lst[:h]); batch(lst[h:])
                else:
                    print('  AD ignoré', lst[0], e)
            time.sleep(0.5)

        for i in range(0, len(icaos), 20):
            batch(icaos[i:i + 20])
        ad = {k: sorted(v.values(), key=lambda x: x['from'] or '') for k, v in ad.items()}
        print(f'  Aérodromes avec NOTAM : {len(ad)} ({sum(len(v) for v in ad.values())} NOTAM)')
        if not fir_list and not ad:
            raise RuntimeError('aucun NOTAM reçu')
        save('notam.json', {'generated': NOW.isoformat(), 'source': 'SOFIA-Briefing (SIA/DGAC)',
                            'fir': sorted(fir_list.values(), key=lambda x: x['from'] or ''), 'ad': ad})
    except Exception as e:  # noqa: BLE001
        print('  NOTAM : échec', e)
        fallback('notam.json')


# ---------------------------------------------------------------- SUP AIP (SIA)
def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r"[^a-z0-9]+", ' ', s.replace("'", ' ')).strip()


STOP = {'creation', 'zone', 'zones', 'region', 'centre', 'sud', 'nord', 'est', 'ouest', 'aerodrome', 'travaux',
        'modification', 'experimentation', 'exercice', 'temporaire', 'temporaires', 'reglementee', 'reglementees',
        'dangereuse', 'vols', 'aeronef', 'aeronefs', 'drone', 'drones', 'piste', 'balisage', 'mer', 'port', 'la', 'le',
        'les', 'saint', 'sainte', 'camp', 'base', 'vue', 'hors', 'jour', 'nuit', 'fort', 'plage', 'mont', 'ile', 'bois',
        'chateau', 'aire', 'aires', 'parc', 'source', 'col', 'grand', 'pont', 'lac', 'cap', 'roche', 'auto', 'test'}


def collect_supaip():
    print('SUP AIP')
    try:
        page = get('https://www.sia.aviation-civile.gouv.fr/documents/supaip/aip/id/6')
        gz = json.load(open(os.path.join(ROOT, 'scripts', 'gazetteer.json'), encoding='utf-8'))
        apts = aerodromes()
        apt_by_icao = {a[0]: a for a in apts}
        # Toutes les communes de France : en cas d'homonymes, la plus peuplée l'emporte
        # (un nom qui désigne surtout une commune hors zone ne sera donc pas placé dans la zone).
        names = {}
        for nom, la, lo, dep, pop in gz['communes']:
            k = norm(nom)
            if (len(k) < 4 and pop < 10000) or len(k) < 3 or k in STOP or k.split()[0] in ('saint', 'sainte'):
                continue
            if pop < 1000 and '-' not in nom:
                continue
            if k not in names or names[k][3] < pop:
                names[k] = (nom, la, lo, pop)
        for a in apts:
            k = norm(re.sub(r'[-/].*$', '', a[1]))
            if len(k) >= 4 and k not in STOP and k not in names:
                names[k] = (a[1], a[2], a[3], 0)
        deps = {norm(v[0]): (v[0], v[1], v[2]) for v in gz['departements'].values()}
        deps_code = gz['departements']

        out = []
        for row in re.findall(r'<tr class="tr_ligne_document(.*?)</tr>', page, re.S):
            m = re.search(r'href="([^"]+)"[^>]*>\s*<b>(.*?)</b>\s*<span>(.*?)<i', row, re.S)
            if not m:
                continue
            url, num, title = m.group(1), m.group(2).strip(), re.sub(r'\s+', ' ', html.unescape(m.group(3))).strip()
            dates = re.findall(r'<strong>(\d{4}-\d{2}-\d{2})</strong>', row)
            flags = {f: bool(re.search(rf'name="{f}"[^>]*\n?\s*checked', row)) for f in ('IFR', 'VFR', 'AIRAC')}
            places = []
            for icao in re.findall(r'\bLF[A-Z]{2}\b', title):
                if icao in apt_by_icao:
                    a = apt_by_icao[icao]
                    places.append({'n': icao, 'la': a[2], 'lo': a[3], 'k': 'ad'})
            for code in re.findall(r'\((\d{2}|2[AB])\)', title):
                if code in deps_code:
                    d = deps_code[code]
                    places.append({'n': d[0], 'la': d[1], 'lo': d[2], 'k': 'dep'})
            nt = ' ' + norm(title) + ' '
            # communes : on teste les n-grammes de 1 à 4 mots dont le 1er mot a une majuscule dans le titre
            raw_words = re.findall(r"[A-Za-zÀ-ÿ0-9]+", title.replace("'", ' '))
            for i in range(len(raw_words)):
                if not raw_words[i][0].isupper():
                    continue
                for n in (4, 3, 2, 1):
                    k = norm(' '.join(raw_words[i:i + n]))
                    if k in names:
                        nom, la, lo, _ = names[k]
                        if not any(p['n'] == nom for p in places):
                            places.append({'n': nom, 'la': la, 'lo': lo, 'k': 'com'})
                        break
            for k, (nom, la, lo) in deps.items():
                if f' {k} ' in nt and not any(p['n'] == nom for p in places):
                    places.append({'n': nom, 'la': la, 'lo': lo, 'k': 'dep'})
            zone = [p for p in places if in_zone(p['la'], p['lo'])]
            # Un aérodrome cité hors zone (ex. LFPT) ou une région extérieure => SUP hors zone
            foreign = [c for c in re.findall(r'\bLF[A-Z]{2}\b', title) if c not in apt_by_icao]
            if foreign or re.search(r'parisien|ile-de-france|normandie|bourgogne|grand est|provence|alpes|corse', nt):
                if not any(p['k'] == 'ad' for p in zone):
                    places, zone = places or [{'n': 'hors zone'}], []
            out.append({'num': num, 'title': title, 'url': url, 'from': dates[0] if dates else None,
                        'to': dates[1] if len(dates) > 1 else None, 'ifr': flags['IFR'], 'vfr': flags['VFR'],
                        'places': zone, 'outside': bool(places) and not zone})
        print(f'  {len(out)} SUP AIP, {sum(1 for x in out if x["places"])} localisés dans la zone')
        if not out:
            raise RuntimeError('liste vide')
        save('supaip.json', {'generated': NOW.isoformat(), 'source': 'SIA — SUP AIP Métropole', 'data': out})
    except Exception as e:  # noqa: BLE001
        print('  SUP AIP : échec', e)
        fallback('supaip.json')


# ---------------------------------------------------------------- AIP : cycle AIRAC, zones P/R/D, VAC
SIA_DVD = 'https://www.sia.aviation-civile.gouv.fr/media/dvd'
MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']


def current_cycle():
    """Renvoie (dossier eAIP, date AIRAC ISO) du cycle publié en vigueur."""
    from datetime import date, timedelta
    ref = date(2024, 1, 25)
    n = (NOW.date() - ref).days // 28
    for k in (n, n - 1):
        d = ref + timedelta(days=28 * k)
        folder = f'eAIP_{d.day:02d}_{MONTHS[d.month - 1]}_{d.year}'
        try:
            req = urllib.request.Request(f'{SIA_DVD}/{folder}/FRANCE/AIRAC-{d.isoformat()}/html/eAIP/FR-ENR-5.1-fr-FR.html',
                                         method='HEAD', headers={'User-Agent': UA})
            with opener.open(req, timeout=30) as r:
                if r.status == 200:
                    return folder, d.isoformat()
        except Exception:  # noqa: BLE001
            continue
    raise RuntimeError('cycle AIRAC introuvable')


def dms(s):
    m = re.match(r"(\d{2,3})°(\d{2})'(\d{2}(?:\.\d+)?)\"([NSEW])", s.strip())
    if not m:
        return None
    v = int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600
    return round(-v if m.group(4) in 'SW' else v, 5)


COORD = r"(\d{2}°\d{2}'\d{2}(?:\.\d+)?\"[NS])\s*,\s*(\d{3}°\d{2}'\d{2}(?:\.\d+)?\"[EW])"


def _dest(la, lo, brg, dist_nm):
    import math
    R = 3440.065
    d = dist_nm / R
    la1, lo1, b = map(math.radians, (la, lo, brg))
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return [round(math.degrees(la2), 5), round(math.degrees(lo2), 5)]


def _brg(la1, lo1, la2, lo2):
    import math
    y = math.sin(math.radians(lo2 - lo1)) * math.cos(math.radians(la2))
    x = (math.cos(math.radians(la1)) * math.sin(math.radians(la2)) -
         math.sin(math.radians(la1)) * math.cos(math.radians(la2)) * math.cos(math.radians(lo2 - lo1)))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _to_nm(v, u):
    v = float(v.replace(',', '.'))
    return v if u == 'NM' else v / 1.852 if u == 'km' else v / 1852


def parse_geometry(text):
    """Polygone (sommets + arcs + cercles) décrit en texte eAIP. Renvoie (points, fin du texte géométrique)."""
    pts, pos, pending_arc = [], 0, None
    tok = re.compile(r'(?P<c>' + COORD + r')|(?P<arc>arc (?P<dir>horaire|anti-horaire) de (?P<r>[\d.,]+) ?(?P<u>NM|km|m) de rayon centré sur )'
                     r'|(?P<circ>[Cc]ercle de (?P<cr>[\d.,]+) ?(?P<cu>NM|km|m) de rayon centré sur )')
    end = 0
    for m in tok.finditer(text):
        if m.start() - end > 80 and pts:
            break
        end = m.end()
        if m.group('circ'):
            c = re.match(r'\s*' + COORD, text[m.end():])
            if c:
                la, lo = dms(c.group(1)), dms(c.group(2))
                r = _to_nm(m.group('cr'), m.group('cu'))
                pts = [_dest(la, lo, a, r) for a in range(0, 360, 15)]
                end = m.end() + c.end()
            break
        if m.group('arc'):
            pending_arc = (m.group('dir'), _to_nm(m.group('r'), m.group('u')))
            continue
        p = [dms(m.group(2)), dms(m.group(3))]
        if pending_arc and pending_arc[0] != 'C':
            pending_arc = ('C', pending_arc, p)   # cette coordonnée est le centre de l'arc
            continue
        if pending_arc and pts:
            _, (dirn, r), c = pending_arc
            a1 = _brg(c[0], c[1], pts[-1][0], pts[-1][1])
            a2 = _brg(c[0], c[1], p[0], p[1])
            span = (a2 - a1) % 360 if dirn == 'horaire' else -((a1 - a2) % 360)
            n = max(2, int(abs(span) / 10))
            for i in range(1, n):
                pts.append(_dest(c[0], c[1], a1 + span * i / n, r))
            pending_arc = None
        pts.append(p)
    return pts, end


def collect_zones(folder, cycle):
    """Zones P, R, D de l'ENR 5.1 (géométrie simplifiée aux sommets) dans la zone élargie."""
    page = get(f'{SIA_DVD}/{folder}/FRANCE/AIRAC-{cycle}/html/eAIP/FR-ENR-5.1-fr-FR.html', timeout=180)
    rows = re.split(r'(?=<tr[^>]*id="mid--[^"]*TXT_NAME-NOM_USUEL")', page)
    out = []
    for blk in rows[1:]:
        head, _, rest = blk.partition('</tr>')
        spans = [html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'<span[^>]*>([^<]*)</span>', head)]
        spans = [s for s in spans if s]
        if len(spans) < 3 or spans[1] not in ('P', 'R', 'D'):
            continue
        typ, num = spans[1], spans[2]
        name = ' '.join(spans[3:])
        body = rest.split('TXT_NAME-NOM_USUEL')[0]
        text = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', body))).replace('’', "'")
        poly, end = parse_geometry(text)
        if len(poly) < 3:
            continue
        la = sum(p[0] for p in poly) / len(poly)
        lo = sum(p[1] for p in poly) / len(poly)
        if not (41.5 < la < 49.5 and -6.5 < lo < 3.5):
            continue
        tail = text[end:]
        m = re.match(r'\s*(.+?)\s*-{4,}\s*(.+?(?:ASFC|AMSL|AGL|SFC|UNL|FL ?\d{2,3}))', tail)
        upper, lower = (m.group(1).strip(), m.group(2).strip()) if m else ('?', '?')
        rmk = tail[m.end():] if m else tail
        rmk = re.split(r'Gestionnaire|Administrator', rmk)[0]
        rtba = 'très basse altitude' in text or 'RTBA' in text or 'Low flying high speed' in text
        out.append({'id': f'{typ} {num}', 'type': typ, 'name': name, 'upper': upper[:40], 'lower': lower[:40],
                    'poly': poly, 'rtba': rtba, 'rmk': rmk.strip()[:500]})
    print(f'  {len(out)} zones P/R/D dans la zone ({sum(1 for z in out if z["rtba"])} RTBA)')
    return out


def decode_mt(s):
    return re.sub(r'/MT(\d+)', lambda m: bytes([int(m.group(1))]).decode('cp1252', errors='replace')
                  if int(m.group(1)) < 256 else '', s)


def parse_vac(icao, data):
    import io
    import pypdf
    r = pypdf.PdfReader(io.BytesIO(data))
    pages = [decode_mt(p.extract_text() or '') for p in r.pages]
    chart = pages[0] if pages else ''
    lines = [l.strip() for l in chart.splitlines() if l.strip()]
    info = {'icao': icao, 'pages': len(pages)}
    m = re.search(r'ALT AD\s*:\s*(\d+)\s*\((\d+) ?hPa\)', chart)
    if m:
        info['alt'], info['hpa'] = int(m.group(1)), int(m.group(2))
    m = re.search(r'VAR\s*:\s*(-?\d+(?:[.,]\d)?)°\s*([EW])?', chart)
    if m:
        v = float(m.group(1).replace(',', '.'))
        info['var'] = -v if m.group(2) == 'W' else v
    for k, pat in (('vfr', r'ATTERRISSAGE A VUE'), ('cap', r'Ouvert à la CAP'), ('restreint', r'Usage restreint|Restricted use'),
                   ('prive', r'Usage privé|Private use')):
        if re.search(pat, '\n'.join(pages)):
            info[k] = True
    freqs = []
    for l in lines:
        m = re.match(r'^(APP|TWR|AFIS|A/A|ATIS|INFO|SOL|GND|VDF|CTL|PRE|DEL|SIV)\s*:\s*(.+)$', l)
        if m and re.search(r'\d{3}\.\d{2,3}', m.group(2)):
            freqs.append(f'{m.group(1)} : {m.group(2)}')
    info['freqs'] = list(dict.fromkeys(freqs))
    rwy = re.search(r'RWY QFU.*?\n(.*?)(?:Aides lumineuses|Lighting|$)', chart, re.S)
    if rwy:
        blob = rwy.group(1)
        info['qfu'] = sorted(set(re.findall(r'\b([0-3]\d0|[0-3]\d[1-9])\b(?! ?x)', blob.split('x')[0])))[:6]
        info['rwy'] = list(dict.fromkeys(re.findall(r'(\d{3,4} ?x ?\d{2,3})', blob)))[:4]
        surf = re.findall(r'(Revêtue|Non revêtue|Herbe|Grass|Paved|Unpaved)', blob)
        if surf:
            info['surface'] = list(dict.fromkeys(surf))[:2]
    tdp = re.findall(r'\b(\d{3,4})\((\d{3,4})\)', chart)
    if tdp:
        info['tdp'] = [f'{a} ft ({b} ft AAL)' for a, b in dict.fromkeys(tdp)][:3]
    spaces = []
    for i, l in enumerate(lines):
        if re.match(r'^(CTR|TMA|CTA|SIV|RMZ|TMZ|LF-?[RDP] ?\d|[RDP] ?\d{1,3}[A-Z]?\b|ZRT|ZIT)', l) and len(l) < 60:
            nxt = lines[i + 1] if i + 1 < len(lines) else ''
            lim = nxt if re.search(r'\d|SFC|FL', nxt) and len(nxt) < 30 else ''
            spaces.append((l + (' : ' + lim if lim else '')).replace('  ', ' '))
    info['espaces'] = list(dict.fromkeys(s.rstrip('D').strip() for s in spaces))[:10]
    nav = re.findall(r'\((?:D|T)\) ?([A-Z]{2,3}) (\d{3}\.\d{1,3})', chart)
    info['nav'] = [f'{a} {b}' for a, b in dict.fromkeys(nav)][:4]
    obst = re.findall(r'Obstacles? ?\n?(\d{3,4})\s*\n?(\d{3})° ?(\d+(?:\.\d)?) ?NM', chart)
    info['obst'] = [f'{a} ft au {b}° {c} NM' for a, b, c in dict.fromkeys(obst)][:5]
    txt = '\n'.join(pages[1:])
    cons = re.search(r'Consignes particulières.*?\n(.*?)(?:©|Informations diverses|$)', txt, re.S)
    if cons:
        info['consignes'] = re.sub(r'[ \t]+', ' ', cons.group(1)).strip()[:3500]
    misc = re.search(r'Informations diverses.*?\n(.*?)(?:AMDT|$)', txt, re.S)
    if misc:
        info['infos'] = re.sub(r'[ \t]+', ' ', misc.group(1)).strip()[:2500]
    fuel = re.search(r'(Carburants?[^\n]*\n?[^\n]*)', txt)
    if fuel:
        info['carburant'] = re.sub(r'\s+', ' ', fuel.group(1))[:300]
    return info


def collect_aip():
    print('AIP (cycle AIRAC, zones, VAC)')
    try:
        folder, cycle = current_cycle()
        print('  cycle', cycle, folder)
    except Exception as e:  # noqa: BLE001
        print('  cycle : échec', e)
        fallback('zones.json'); fallback('vac.json')
        return
    # Réutilise la version publiée si elle est du même cycle (évite de retélécharger les VAC)
    if FALLBACK_URL and os.environ.get('FORCE_AIP') != '1':
        try:
            prev = json.loads(get(f'{FALLBACK_URL}/data/live/vac.json', timeout=30))
            prevz = json.loads(get(f'{FALLBACK_URL}/data/live/zones.json', timeout=30))
            if prev.get('cycle') == cycle and prevz.get('cycle') == cycle:
                save('vac.json', prev); save('zones.json', prevz)
                print('  inchangé (même cycle)')
                return
        except Exception:  # noqa: BLE001
            pass
    try:
        save('zones.json', {'generated': NOW.isoformat(), 'cycle': cycle, 'source': 'SIA eAIP ENR 5.1',
                            'data': collect_zones(folder, cycle)})
    except Exception as e:  # noqa: BLE001
        print('  zones : échec', e)
        fallback('zones.json')
    vac = {}
    base = f'{SIA_DVD}/{folder}/Atlas-VAC/PDF_AIPparSSection/VAC/AD/AD-2.'
    for a in aerodromes():
        icao = a[0]
        if not icao.startswith('LF'):
            continue
        try:
            req = urllib.request.Request(base + icao + '.pdf', headers={'User-Agent': UA})
            with opener.open(req, timeout=60) as r:
                if 'pdf' not in (r.headers.get('Content-Type') or ''):
                    continue
                data = r.read()
            info = parse_vac(icao, data)
            info['url'] = base + icao + '.pdf'
            vac[icao] = info
        except urllib.error.HTTPError:
            continue
        except Exception as e:  # noqa: BLE001
            print('  VAC', icao, 'erreur', e)
        time.sleep(0.2)
    print(f'  {len(vac)} cartes VAC analysées')
    if vac:
        save('vac.json', {'generated': NOW.isoformat(), 'cycle': cycle, 'source': 'SIA eAIP — Atlas VAC', 'data': vac})
    else:
        fallback('vac.json')


if __name__ == '__main__':
    what = sys.argv[1:] or ['metar', 'notam', 'supaip', 'aip']
    if 'metar' in what:
        collect_metar_taf()
    if 'notam' in what:
        collect_notam()
    if 'supaip' in what:
        collect_supaip()
    if 'aip' in what:
        collect_aip()
