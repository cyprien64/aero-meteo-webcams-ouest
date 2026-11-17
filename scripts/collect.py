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
import math
import http.cookiejar
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

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


STATUS = {}   # état de chaque fichier pour la surveillance (status.json)


def save(name, obj, reused=False):
    STATUS[name] = 'repris (inchangé)' if reused else 'ok'
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  -> {name} ({os.path.getsize(os.path.join(OUT, name)) // 1024} ko)')


def fallback(name):
    STATUS[name] = 'échec'
    if not FALLBACK_URL:
        return False
    try:
        txt = get(f'{FALLBACK_URL}/data/live/{name}', timeout=30)
        json.loads(txt)
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            f.write(txt)
        print(f'  -> {name} repris de la version publiée')
        STATUS[name] = 'échec (version précédente conservée)'
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
    # SOFIA refuse une heure de début passée, même de quelques secondes : heure du moment + 1 min
    valid_from = (datetime.now(timezone.utc) + timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%M:00Z')
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
        # Horizon : 72 h si SOFIA l'accepte (préparation la veille / l'avant-veille), sinon 48 h puis 24 h
        area = lambda d: sofia_post({':operation': 'postAreaPibRequest', 'duration': d, 'traffic': 'VI',  # noqa: E731
                                     'fl_lower': '000', 'fl_upper': '195', 'fir[]': ['LFRR', 'LFBB']})
        fir, dur = area('2400'), '2400'          # indispensable
        for d in ('7200', '4800'):                # en plus si SOFIA l'accepte (jusqu'à 96 h d'après le formulaire)
            try:
                fir, dur = area(d), d
                break
            except Exception as e:  # noqa: BLE001
                print(f'  durée {d} refusée : {e}')
        horizon = int(dur[:2])
        fir_list = {n['id']: slim_notam(n) for n in walk_notams(fir.get('listnotams', {}))}
        print(f'  FIR LFRR+LFBB : {len(fir_list)} NOTAM sur {horizon} h')

        ad = {}
        icaos = [a[0] for a in aerodromes() if a[0].startswith('LF')]

        def batch(lst):
            try:
                d = sofia_post({':operation': 'postAeroPibRequest', 'duration': dur, 'traffic': 'VI', 'aero[]': lst})
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
        save('notam.json', {'generated': NOW.isoformat(), 'horizon': horizon, 'source': 'SOFIA-Briefing (SIA/DGAC)',
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


VFR_RE = re.compile(r'''(\d{2})\s?°\s?(\d{2})\s?[’'”“"°]\s?(\d{2}(?:[.,]\d+)?)\s?[”“"’']{1,2}\s?([NS])\s?[-–]\s?(\d{3})\s?°\s?(\d{2})\s?[’'”“"°]\s?(\d{2}(?:[.,]\d+)?)\s?[”“"’']{1,2}\s?([EW])\s?([A-Z][A-Z0-9]{0,3})(?:\s*\(.{0,3}\))?\s*$''')


def parse_vfr_points(text):
    """Points de report VFR du tableau de la VAC : « description  43°29’41” N - 000°22’12” W N » (le dernier mot est l'identifiant)."""
    out, prev = {}, ''
    for line in (l.strip() for l in text.splitlines()):
        m = VFR_RE.search(line)
        if not m:
            prev = line
            continue
        g = m.groups()
        la = int(g[0]) + int(g[1]) / 60 + float(g[2].replace(',', '.')) / 3600
        lo = int(g[4]) + int(g[5]) / 60 + float(g[6].replace(',', '.')) / 3600
        desc = line[:m.start()].strip(' :-') or prev.strip(' :-')
        pid = g[8]
        if pid not in out:   # la VAC répète parfois le tableau (français / anglais)
            out[pid] = {'id': pid, 'la': round(la if g[3] == 'N' else -la, 5), 'lo': round(lo if g[7] == 'E' else -lo, 5), 'desc': re.sub(r'\s+', ' ', desc)[:120]}
        prev = ''
    return sorted(out.values(), key=lambda p: p['id'])


assert parse_vfr_points('Lème : Château d’eau / Water tower43°29’41” N - 000°22’12” WN\nMonein\n43°24’54” N - 000°34’32” WW\nSautron47° 15\' 26" N - 001° 41\' 07" WNW (1)') == [
    {'id': 'N', 'la': 43.49472, 'lo': -0.37, 'desc': 'Lème : Château d’eau / Water tower'},
    {'id': 'NW', 'la': 47.25722, 'lo': -1.68528, 'desc': 'Sautron'},
    {'id': 'W', 'la': 43.415, 'lo': -0.57556, 'desc': 'Monein'}]


def parse_vac(icao, data):
    import io
    import pypdf
    r = pypdf.PdfReader(io.BytesIO(data))
    pages = [decode_mt(p.extract_text() or '') for p in r.pages]
    charts = [p for p in pages if 'ALT AD' in p or 'TODA' in p or 'ATTERRISSAGE A VUE' in p] or pages[:1]
    chart = '\n'.join(charts)
    lines = [l.strip() for l in chart.splitlines() if l.strip()]
    info = {'icao': icao, 'pages': len(pages)}
    pts = parse_vfr_points('\n'.join(pages))
    if pts:
        info['vfrpts'] = pts
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
    # Lignes du tableau des pistes : "QFU1 QFU2 LONGUEUR x LARGEUR Nature", parfois éclatées sur plusieurs lignes
    qfus, dims, surf = [], [], []
    for m in re.finditer(r'((?:\b[0-3]\d{2}\b[\s\n]*){1,2})(\d{3,4}) ?x ?(\d{2,3})\s*(Non revêtue|Revêtue|Herbe)?', chart):
        q = [x for x in re.findall(r'[0-3]\d{2}', m.group(1)) if 0 < int(x) <= 360]
        if not q:
            continue
        qfus += q
        dims.append(f'{m.group(2)} x {m.group(3)}')
        if m.group(4):
            surf.append(m.group(4))
    # Format « Distances déclarées » (grands terrains) : "Revêtue\nPaved2102 x 45\n101\n281"
    for m in re.finditer(r'(Non revêtue|Revêtue)\s*\n?(?:Unpaved|Paved)?\s*(\d{3,4}) ?x ?(\d{2,3})\s*\n(\d{3})\s*\n(\d{3})', '\n'.join(pages)):
        q = [x for x in (m.group(4), m.group(5)) if 0 < int(x) <= 360]
        if q and abs(int(q[0]) - int(q[-1])) in (180,) or len(q) == 1:
            qfus += q
            dims.append(f'{m.group(2)} x {m.group(3)}')
            surf.append(m.group(1))
    # Format courant : "11\n29\n112\n292" (désignations puis QFU) dans le tableau des pistes
    for m in re.finditer(r'\b(\d{2})[LRC]?\s*\n\s*(\d{2})[LRC]?\s*\n\s*(\d{3})\s*\n\s*(\d{3})', chart):
        r1, r2, q1, q2 = (int(x) for x in m.groups())
        if abs(abs(q1 - q2) - 180) <= 2 and abs(q1 - r1 * 10) <= 15 and abs(q2 - r2 * 10) <= 15:
            qfus += [m.group(3), m.group(4)]
    qfus = list(dict.fromkeys(qfus))
    if not qfus:   # désignation de piste à 2 chiffres (ex. "07 / 25") -> QFU approché
        m = re.search(r'TODA\s*ASDA\s*LDA\s*\n(\d{2})\s*\n(\d{2})\b', chart)
        if m:
            qfus = [f'{int(m.group(1)) * 10:03d}', f'{int(m.group(2)) * 10:03d}']
    dims = list(dict.fromkeys(dims + [f'{a} x {b}' for a, b in re.findall(r'(\d{3,4}) ?x ?(\d{2,3})\b', chart) if 200 <= int(a) <= 4000]))
    surf = list(dict.fromkeys(surf + re.findall(r'(Non revêtue|Revêtue|Herbe)', chart)))
    info['qfu'] = list(dict.fromkeys(qfus))[:6]
    info['rwy'] = list(dict.fromkeys(dims))[:4]
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
    # --- Escale : carburants disponibles, moyens de paiement, exploitant (rubriques 10 et 4 de la VAC)
    alltxt = '\n'.join(pages)
    fb = re.search(r':\s*9\s*-(.*?)AVT\s*:\s*10', alltxt, re.S)
    ftxt = re.sub(r'\s+', ' ', fb.group(1)).strip() if fb else (info.get('carburant') or '')
    if ftxt:
        types = []
        for pat, lab in ((r'100 ?LL|AVGAS', '100LL'), (r'UL ?91', 'UL91'), (r'SP ?98', 'SP98'), (r'MOGAS', 'MOGAS'), (r'AERO ?SUPER', 'UL Aéro Super+'), (r'JET ?A-?1|Jet ?A-?1', 'Jet A1')):
            if re.search(pat, ftxt, re.I):
                types.append(lab)
        pay = []
        for pat, lab in ((r'carte TOTAL|TOTAL card|TOTAL', 'carte Total'), (r'SHELL', 'carte Shell'), (r'AIR ?BP', 'carte Air BP'),
                         (r'carte (?:bancaire|de crédit|bleue)|credit card|\bCB\b|VISA|MASTERCARD', 'carte bancaire'),
                         (r'espèces|cash', 'espèces'), (r'chèque|cheque', 'chèque'),
                         (r'automate|automatique|automatic|libre[- ]service|self', 'automate (libre-service)'),
                         (r'heures d.ouverture|HOR\b|SKED|\bHJ\b|horaires', 'aux horaires d\'ouverture'),
                         (r'\bPPR\b', 'sur PPR'), (r'sur demande|on request', 'sur demande')):
            if re.search(pat, ftxt, re.I):
                pay.append(lab)
        none = bool(re.match(r'^(NIL|Néant)\b', ftxt)) and not types
        fr = ' '.join(s for s in re.split(r'(?<=[.])\s+', ftxt) if not re.search(r'\b(Payment|automatic dispenser|by credit|Lubricants?|Outside|on-call|cards)\b', s))
        info['escale'] = {'fuel': types, 'pay': pay, 'none': none, 'texte': (fr or ftxt)[:420],
                          'tel': list(dict.fromkeys(re.findall(r'(?:\+33 ?|0)\d(?:[ .]?\d{2}){4}', ftxt)))[:3]}
    ob = re.search(r':\s*3\s*-(.*?)Exploitant d.a[ée]rodrome', alltxt, re.S)
    if ob:
        o = re.sub(r'\s+', ' ', ob.group(1)).strip()
        info.setdefault('escale', {})['exploitant'] = o[:220]
        info['escale']['tel_ad'] = list(dict.fromkeys(re.findall(r'(?:\+33 ?|0)\d(?:[ .]?\d{2}){4}', o)))[:3]
        site = re.search(r'(?:www\.|https?://)[^\s,;]+', o)
        if site:
            info['escale']['site'] = site.group(0).rstrip('.')
    return info


OPENAIR_URL = 'https://planeur-net.github.io/airspace/france.txt'
VAC_PARSER = 4   # à incrémenter quand l'analyse des VAC change (force une nouvelle analyse)


def _oa_coord(s):
    m = re.match(r'\s*(\d+):(\d+):(\d+(?:\.\d+)?)\s*([NS])\s+(\d+):(\d+):(\d+(?:\.\d+)?)\s*([EW])', s)
    if not m:
        return None
    la = int(m.group(1)) + int(m.group(2)) / 60 + float(m.group(3)) / 3600
    lo = int(m.group(5)) + int(m.group(6)) / 60 + float(m.group(7)) / 3600
    return [round(-la if m.group(4) == 'S' else la, 5), round(-lo if m.group(8) == 'W' else lo, 5)]


def parse_openair(txt):
    """Espaces CTR / TMA / CTA / RMZ / TMZ avec fréquence (AF) et indicatif (AG)."""
    out, cur, center, cw = [], None, None, True

    def close():
        if cur and len(cur['poly']) >= 3:
            out.append(cur)
    for raw in txt.splitlines():
        line = raw.split('*')[0].rstrip()
        if not line:
            continue
        key, _, val = line.partition(' ')
        val = val.strip()
        if key == 'AC':
            close()
            cur = {'cls': val, 'name': '', 'type': '', 'upper': '', 'lower': '', 'freq': '', 'call': '', 'poly': []}
            center, cw = None, True
        elif cur is None:
            continue
        elif key == 'AN':
            cur['name'] = val
        elif key == 'AY':
            cur['type'] = val
        elif key == 'AH':
            cur['upper'] = val
        elif key == 'AL':
            cur['lower'] = val
        elif key == 'AF':
            cur['freq'] = val
        elif key == 'AG':
            cur['call'] = val
        elif key == 'DP':
            p = _oa_coord(val)
            if p:
                cur['poly'].append(p)
        elif key == 'V':
            if val.startswith('X='):
                center = _oa_coord(val[2:])
            elif val.startswith('D='):
                cw = val[2:].strip() != '-'
        elif key == 'DB' and center:
            a, _, b = val.partition(',')
            p1, p2 = _oa_coord(a), _oa_coord(b)
            if p1 and p2:
                import math
                dx = (p1[1] - center[1]) * 60 * math.cos(math.radians(center[0]))
                dy = (p1[0] - center[0]) * 60
                r = math.hypot(dx, dy)
                a1 = _brg(center[0], center[1], p1[0], p1[1])
                a2 = _brg(center[0], center[1], p2[0], p2[1])
                span = (a2 - a1) % 360 if cw else -((a1 - a2) % 360)
                n = max(2, int(abs(span) / 10))
                for i in range(0, n + 1):
                    cur['poly'].append(_dest(center[0], center[1], a1 + span * i / n, r))
        elif key == 'DC' and center:
            r = float(val.split()[0])
            cur['poly'] = [_dest(center[0], center[1], a, r) for a in range(0, 360, 15)]
    close()
    keep = []
    for a in out:
        kind = (a['type'] or a['name'].split(' ')[0]).upper()
        if kind not in ('CTR', 'TMA', 'CTA', 'RMZ', 'TMZ', 'SIV', 'FIS'):
            continue
        la = sum(p[0] for p in a['poly']) / len(a['poly'])
        lo = sum(p[1] for p in a['poly']) / len(a['poly'])
        if not (41.8 < la < 49.6 and -6.5 < lo < 3.6):
            continue
        a['kind'] = kind
        a['poly'] = [[round(p[0], 4), round(p[1], 4)] for p in a['poly']]
        keep.append(a)
    return keep


def collect_siv(folder, cycle):
    """SIV (secteurs d'information de vol) de l'ENR 2.2 : géométrie, limites, indicatif, fréquences."""
    page = get(f'{SIA_DVD}/{folder}/FRANCE/AIRAC-{cycle}/html/eAIP/FR-ENR-2.2-fr-FR.html', timeout=180)
    text = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', page))).replace('’', "'")
    out = []
    for m in re.finditer(r"SIV ([A-ZÀ-Ü' -]+?(?: partie [A-Z0-9.]+(?: partie [A-Z0-9.]+)?)?) (?=\d{2}°\d{2}')", text):
        name = 'SIV ' + m.group(1).strip()
        seg = text[m.end():m.end() + 6000]
        poly, end = parse_geometry(seg)
        if len(poly) < 3:
            continue
        tail = seg[end:end + 400]
        LIM = r'(FL ?\d{2,3}|\d{3,5} ?ft (?:ASFC|AMSL|AGL)|SFC|GND|UNL)'
        up = re.search(LIM, tail)
        dash = tail.find('----')
        lo = re.search(LIM, tail[dash:]) if dash >= 0 else None
        upper = up.group(1) if up else '?'
        lower = lo.group(1) if lo else '?'
        after = tail[dash + lo.end():] if lo else tail
        freqs = re.findall(r'\d{3}\.\d{2,3}', after[:160])
        call = re.search(r'([A-ZÀ-Ü][A-ZÀ-Ü\' -]+ INFO)', after[:120])
        la = sum(p[0] for p in poly) / len(poly)
        lo = sum(p[1] for p in poly) / len(poly)
        if not (41.8 < la < 49.6 and -6.5 < lo < 3.6) or not freqs:
            continue
        out.append({'kind': 'SIV', 'cls': 'G/E', 'name': name, 'upper': upper[:30], 'lower': lower[:30],
                    'freq': ' / '.join(dict.fromkeys(freqs[:3])), 'call': call.group(1).strip() if call else name.replace('SIV', '').split(' partie')[0].strip() + ' INFO',
                    'poly': [[round(p[0], 4), round(p[1], 4)] for p in poly]})
    # dédoublonnage par nom
    uniq = {}
    for s in out:
        uniq.setdefault(s['name'], s)
    print(f'  {len(uniq)} SIV (ENR 2.2)')
    return list(uniq.values())


def collect_airspaces(cycle, folder=None):
    try:
        txt = get(OPENAIR_URL, timeout=120)
        ver = re.search(r'\*version=\s*(.+)', txt)
        data = parse_openair(txt)
        print(f'  {len(data)} espaces CTR/TMA/CTA/RMZ/TMZ avec fréquences (OpenAir FFVP)')
        if folder:
            try:
                data += collect_siv(folder, cycle)
            except Exception as e:  # noqa: BLE001
                print('  SIV : échec', e)
        save('airspaces.json', {'generated': NOW.isoformat(), 'cycle': cycle, 'version': ver.group(1).strip() if ver else '',
                                'source': 'Fichier OpenAir FFVP / planeur-net (non officiel)', 'data': data})
    except Exception as e:  # noqa: BLE001
        print('  espaces : échec', e)
        fallback('airspaces.json')


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
            preva = json.loads(get(f'{FALLBACK_URL}/data/live/airspaces.json', timeout=30))
            if prev.get('cycle') == cycle and prev.get('v') == VAC_PARSER and prevz.get('cycle') == cycle and preva.get('cycle') == cycle:
                save('vac.json', prev, True); save('zones.json', prevz, True); save('airspaces.json', preva, True)
                print('  inchangé (même cycle)')
                return
        except Exception:  # noqa: BLE001
            pass
    collect_airspaces(cycle, folder)
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
        save('vac.json', {'generated': NOW.isoformat(), 'cycle': cycle, 'v': VAC_PARSER, 'source': 'SIA eAIP — Atlas VAC', 'data': vac})
    else:
        fallback('vac.json')


# ---------------------------------------------------------------- webcams : pannes (hebdomadaire) et images figées (toutes les 6 h)
IMG_RE = re.compile(r'\.(jpe?g|png|webp)(\?|$)', re.I)


def collect_cams():
    print('Webcams (pannes + images figées)')
    prev = None
    if FALLBACK_URL:
        try:
            prev = json.loads(get(f'{FALLBACK_URL}/data/live/cams_status.json', timeout=30))
        except Exception:  # noqa: BLE001
            prev = None
    prev = prev or {}
    force = os.environ.get('FORCE_CAMS') == '1'

    def age_h(key):
        try:
            return (NOW - datetime.fromisoformat(prev[key])).total_seconds() / 3600
        except Exception:  # noqa: BLE001
            return 1e9
    out = dict(prev)
    src = open(os.path.join(ROOT, 'data', 'sources.js'), encoding='utf-8').read()
    items = json.loads(re.search(r'window\.SOURCES = (\[.*?\]);', src, re.S).group(1))
    cams = [x for x in items if x.get('t') == 'cam']
    from concurrent.futures import ThreadPoolExecutor
    changed = False

    # 1) pannes : contrôle hebdomadaire de toutes les adresses
    if force or age_h('checked') >= 24 * 7:
        urls = sorted({x['u'] for x in cams})

        def check(u):
            try:
                req = urllib.request.Request(u, headers={'User-Agent': UA, 'Range': 'bytes=0-2048'})
                with urllib.request.urlopen(req, timeout=15) as r:
                    r.read(512)
                    return u, None
            except urllib.error.HTTPError as e:
                return u, (f'HTTP {e.code}' if e.code in (404, 410, 500, 502, 503) else None)   # 401/403/429 : blocage anti-robot, pas une panne
            except Exception as e:  # noqa: BLE001
                return u, type(e).__name__ + ': ' + str(e)[:60]
        with ThreadPoolExecutor(16) as ex:
            res = list(ex.map(check, urls))
        out.update({'checked': NOW.isoformat(), 'total': len(urls), 'dead': {u: why for u, why in res if why}})
        print(f'  {len(urls)} webcams contrôlées, {len(out["dead"])} hors service')
        changed = True

    # 2) images figées : même image (empreinte) depuis plus de 24 h, ou image serveur datée de plus de 24 h
    if force or age_h('img_checked') >= 6:
        import hashlib
        from email.utils import parsedate_to_datetime
        imgs_prev = prev.get('imgs') or {}
        urls = sorted({x.get('img') or x['u'] for x in cams if x.get('img') or IMG_RE.search(x['u'])})

        def grab(u):
            try:
                req = urllib.request.Request(u, headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=20) as r:
                    body = r.read(6 * 1024 * 1024)
                    lm = r.headers.get('Last-Modified')
                lm_iso = None
                if lm:
                    try:
                        lm_iso = parsedate_to_datetime(lm).astimezone(timezone.utc).isoformat()
                    except Exception:  # noqa: BLE001
                        pass
                return u, hashlib.sha1(body).hexdigest()[:16], lm_iso
            except Exception:  # noqa: BLE001
                return u, None, None
        with ThreadPoolExecutor(12) as ex:
            res = list(ex.map(grab, urls))
        imgs, frozen = {}, {}
        for u, h, lm in res:
            if not h:
                continue
            old = imgs_prev.get(u) or {}
            since = old.get('since') if old.get('h') == h else NOW.isoformat()
            imgs[u] = {'h': h, 'since': since or NOW.isoformat(), 'lm': lm}
            still = (NOW - datetime.fromisoformat(imgs[u]['since'])).total_seconds() / 3600
            lm_age = (NOW - datetime.fromisoformat(lm)).total_seconds() / 3600 if lm else 0
            moved = bool(old.get('h')) and old['h'] != h   # l'image a changé depuis le contrôle précédent : vivante
            if not moved and (still >= 24 or lm_age >= 24):
                frozen[u] = min(imgs[u]['since'], lm) if lm else imgs[u]['since']
        out.update({'img_checked': NOW.isoformat(), 'imgs': imgs, 'frozen': frozen})
        print(f'  {len(imgs)}/{len(urls)} images lues, {len(frozen)} figées depuis plus de 24 h')
        changed = True

    if changed:
        save('cams_status.json', out)
    else:
        save('cams_status.json', prev, True)
        print('  contrôles récents : inchangé')


PPR_RE = re.compile(r'\bPPR\b|\bO/R\b|\bPN\b|préavis|prior (?:permission|notice)|autorisation préalable|réservation|parking|stationnement', re.I)
MAIL_RE = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
URL_RE = re.compile(r'(?:https?://|www\.)[^\s,;()]+')


def vie_pratique(v):
    """Rubriques « Situation », « Transports » (16), « Hôtels, restaurants » (17) et « Divers » de la VAC.
    Dans le texte extrait, la valeur précède son titre : « NIL.Transports :16 - Sur AD.Hôtels, restaurants :17 - »."""
    t = str(v.get('infos') or '')
    out = {}
    m = re.search(r'([^\n]*?)\.?\s*Situation\s*/\s*Location\s*:\s*1\s*-', t)
    if m:
        out['situation'] = m.group(1).strip(' .')
        c = re.search(r'km\s+(?:[NSEW]{1,3}\s+)?(.+?)\s*\(', out['situation'])
        if c:
            out['ville'] = c.group(1).strip()
    for key, label, num in (('transports', r'Transports', 16), ('hotels', r'H[oô]tels?\s*,\s*restaurants', 17), ('divers', r'Divers\s*/\s*Miscellaneous', 18)):
        m = re.search(rf':\s*{num - 1}\s*-(.*?){label}\s*:\s*{num}\s*-', t, re.S)
        if m:
            val = re.sub(r'\s+', ' ', m.group(1).replace('←', '')).strip(' .-')
            if val and val.upper() != 'NIL':
                out[key] = val[:300]
    return out


assert vie_pratique({'infos': '10 km NW Pau (64 - Pyrénées Atlantiques).Situation / Location :1 -\nACB :15 -\nTAXI O/R AFISTransports :16 -\nRestaurant sur / on AD.Hôtels, restaurants :17 -'}) == {
    'situation': '10 km NW Pau (64 - Pyrénées Atlantiques)', 'ville': 'Pau', 'transports': 'TAXI O/R AFIS', 'hotels': 'Restaurant sur / on AD'}


OSM_KINDS = [('taxi', 'amenity', 'taxi', 10, 3), ('gare', 'railway', 'station|halt', 20, 3), ('loc', 'amenity', 'car_rental', 15, 4), ('velo', 'amenity', 'bicycle_rental', 5, 2)]


def collect_osm(cycle):
    """Taxis, gares, loueurs de voitures et de vélos autour de chaque terrain (OpenStreetMap), une fois par cycle AIRAC."""
    print('OpenStreetMap autour des terrains')
    if FALLBACK_URL:
        try:
            prev = json.loads(get(f'{FALLBACK_URL}/data/live/osm_near.json', timeout=30))
            if prev.get('cycle') == cycle:
                save('osm_near.json', prev, True)
                print('  inchangé (même cycle)')
                return
        except Exception:  # noqa: BLE001
            pass
    q = ('[out:json][timeout:180];(nwr["amenity"~"^(taxi|car_rental|bicycle_rental)$"]({b});nwr["railway"~"^(station|halt)$"]({b}););out center tags;'
         .format(b='42.0,-5.4,49.2,2.7'))
    els = None
    for ep in ('https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter') * 2:   # serveurs publics souvent chargés
        try:
            els = json.loads(get(ep, {'data': q}, timeout=240, headers={'User-Agent': 'aero-meteo-webcams-ouest (carte de club, GitHub Pages)'}))['elements']
            break
        except Exception as e:  # noqa: BLE001
            print('  ', ep, e)
            time.sleep(20)
    if not els:
        fallback('osm_near.json')
        return
    out = {}
    for icao, name, la, lo, *_ in aerodromes():
        near = {}
        for kind, key, vals, km, n in OSM_KINDS:
            cand = []
            for e in els:
                t = e.get('tags') or {}
                if not re.fullmatch(vals, t.get(key) or '') or t.get('usage') == 'tourism' or 'petit train' in (t.get('name') or '').lower():
                    continue
                ela, elo = e.get('lat', (e.get('center') or {}).get('lat')), e.get('lon', (e.get('center') or {}).get('lon'))
                if ela is None:
                    continue
                d = math.hypot((elo - lo) * math.cos(math.radians(la)) * 111.32, (ela - la) * 110.57)
                if d <= km:
                    cand.append({'n': (t.get('name') or t.get('operator') or '')[:60], 'd': round(d, 1), 'la': round(ela, 5), 'lo': round(elo, 5),
                                 'tel': (t.get('phone') or t.get('contact:phone') or '')[:40], 'web': (t.get('website') or t.get('contact:website') or '')[:120]})
            cand.sort(key=lambda x: x['d'])
            if cand:
                near[kind] = cand[:n]
        if near:
            out[icao] = near
    print(f'  {len(els)} points OSM, {len(out)} terrains avec au moins un service proche')
    save('osm_near.json', {'generated': NOW.isoformat(), 'cycle': cycle, 'source': '© contributeurs OpenStreetMap (ODbL)', 'data': out})


def ppr_contacts(v):
    """Phrases de la VAC sur le PPR / préavis / stationnement, avec les e-mails et sites cités (texte tel quel, à vérifier)."""
    txt = re.sub(r'-\n(?=[a-zà-ü])', '', '\n'.join(str(v.get(k) or '') for k in ('infos', 'consignes', 'carburant')))
    lines = [re.sub(r'\s+', ' ', l).strip() for l in txt.splitlines()]
    snips = []
    for i, l in enumerate(lines):
        if re.search(r'RFFS|SSLIA|Niveau \d|Level \d|Péril animalier', l):
            continue   # niveaux de protection incendie « sur demande » : sans objet pour l'aviation légère
        if not PPR_RE.search(l) or re.search(r'\b(?:for|with|the|these|only|from|outside|before|which|have)\b', l, re.I) and not re.search(r'[àéèêç]', l):
            continue   # garde la version française des consignes bilingues
        s = l
        for nxt in lines[i + 1:i + 3]:   # numéro ou adresse sur la ligne suivante
            if re.search(r'TEL|@|http|www\.|\d{2} \d{2} \d{2}', nxt) and len(s) < 220:
                s += ' ' + nxt
        s = s[:240]
        if s not in snips and not any(s in x for x in snips):
            snips.append(s)
    allt = '\n'.join(lines)
    mails = sorted({m.rstrip('.') for m in MAIL_RE.findall(allt)})
    web = sorted({u.rstrip('.') for u in URL_RE.findall(allt)})
    return {'ppr': snips[:4], 'mails': mails[:4], 'web': web[:3]}


assert ppr_contacts({'infos': 'PPR 48 HR par/ by TEL : 06 08 53 01 67\nE-mail : bsi-pau@douane.finances.gouv.fr'}) == {
    'ppr': ['PPR 48 HR par/ by TEL : 06 08 53 01 67 E-mail : bsi-pau@douane.finances.gouv.fr'], 'mails': ['bsi-pau@douane.finances.gouv.fr'], 'web': []}


VIG_PH = [('wind', 'vent violent'), ('snow', 'neige-verglas'), ('ice', 'neige-verglas'), ('thunder', 'orages'), ('fog', 'brouillard'),
          ('high-temp', 'canicule'), ('high temp', 'canicule'), ('low-temp', 'grand froid'), ('low temp', 'grand froid'),
          ('coastal', 'vagues-submersion'), ('forest', 'feux de forêt'), ('avalanche', 'avalanches'), ('flood', 'crues'), ('rain', 'pluie-inondation')]


def collect_vigilance():
    """Vigilance Météo-France par département, via le flux public MeteoAlarm (EUMETNET, licence équivalente CC BY 4.0)."""
    print('Vigilance (MeteoAlarm)')
    try:
        x = get('https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-france', timeout=60)
        deps = {}
        for e in re.findall(r'<entry>(.*?)</entry>', x, re.S):
            g = lambda tag: (re.search(f'<{tag}>([^<]*)</{tag}>', e) or [None, ''])[1]  # noqa: E731
            title = g('title').lower()
            lvl = next((n for n, w in ((3, 'red'), (2, 'orange'), (1, 'yellow')) if title.startswith(w)), 0)
            if not lvl or g('cap:status') != 'Actual' or g('cap:message_type') == 'Cancel':
                continue
            ev = (g('cap:event') + ' ' + title).lower()
            ph = next((fr for en, fr in VIG_PH if en in ev), g('cap:event'))
            deps.setdefault(html.unescape(g('cap:areaDesc')), []).append(
                {'lvl': lvl, 'ph': ph, 'from': g('cap:onset') or g('cap:effective'), 'to': g('cap:expires')})
        for k, v in deps.items():   # une ligne par phénomène et période
            deps[k] = [dict(t) for t in {tuple(sorted(d.items())) for d in v}]
        print(f'  {len(deps)} départements en vigilance jaune ou plus')
        save('vigilance.json', {'generated': NOW.isoformat(), 'source': 'Météo-France via MeteoAlarm (EUMETNET)', 'deps': deps})
    except Exception as e:  # noqa: BLE001
        print('  vigilance : échec', e)
        fallback('vigilance.json')


def club_issues(label):
    """Issues GitHub d'un type (« taxe », « pratique ») validées par l'étiquette « valide » et non modifiées depuis : [(issue, champs)]."""
    repo, token = os.environ.get('GITHUB_REPOSITORY'), os.environ.get('GITHUB_TOKEN')
    if not repo:
        raise RuntimeError('GITHUB_REPOSITORY absent')
    h = {'Accept': 'application/vnd.github+json'}
    if token:
        h['Authorization'] = 'Bearer ' + token
    issues = json.loads(get(f'https://api.github.com/repos/{repo}/issues?labels={label},valide&state=all&per_page=100&sort=created&direction=asc', timeout=30, headers=h))
    # l'auteur peut modifier son texte après la validation : on ne publie que les issues non modifiées depuis la pose de « valide »
    owner, name = repo.split('/')
    q = ('query($o:String!,$n:String!){repository(owner:$o,name:$n){issues(labels:["valide"],first:100,states:[OPEN,CLOSED]){nodes{'
         'number lastEditedAt timelineItems(itemTypes:[LABELED_EVENT],last:20){nodes{... on LabeledEvent{createdAt label{name}}}}}}}}')
    req = urllib.request.Request('https://api.github.com/graphql', data=json.dumps({'query': q, 'variables': {'o': owner, 'n': name}}).encode(),
                                 headers={**h, 'Content-Type': 'application/json', 'User-Agent': UA})
    with opener.open(req, timeout=30) as r:
        nodes = json.load(r)['data']['repository']['issues']['nodes']
    trusted = set()
    for nd in nodes:
        val = max((e['createdAt'] for e in nd['timelineItems']['nodes'] if e and e['label']['name'] == 'valide'), default=None)
        if val and (not nd['lastEditedAt'] or nd['lastEditedAt'] <= val):
            trusted.add(nd['number'])
    out = []
    for it in issues:
        if it['number'] not in trusted:
            print(f"  #{it['number']} modifiée après validation : ignorée (re-valider en retirant puis remettant « valide »)")
            continue
        fields, cur = {}, None
        for line in (it.get('body') or '').splitlines():
            m = re.match(r'^###\s+(.*)$', line)
            if m:
                cur = m.group(1).strip().lower()
                fields[cur] = ''
            elif cur is not None and line.strip() and line.strip() != '_No response_':
                fields[cur] = (fields[cur] + ' ' + line.strip()).strip()
        icao = (fields.get('code oaci') or '').upper().strip()
        if re.fullmatch(r'[A-Z]{4}', icao):
            out.append((it, icao, fields))
    return out


def collect_fees():
    """Taxes d'atterrissage proposées par les membres (issues « taxe » validées)."""
    try:
        out = {}
        for it, icao, fields in club_issues('taxe'):
            if not fields.get('tarif'):
                continue
            out[icao] = {'tarif': fields['tarif'][:60], 'note': (fields.get('remarque') or '')[:160],
                         'maj': (fields.get('date du constat') or it['created_at'][:7])[:10],
                         'source': ('club : ' + (fields.get('source') or 'membre'))[:80], 'ref': it['number']}
        save('fees_club.json', {'generated': NOW.isoformat(), 'aerodromes': out})
    except Exception as e:  # noqa: BLE001
        print('fees :', e)
        fallback('fees_club.json')


def collect_pratique():
    """Infos pratiques proposées par les membres : taxis, transports, restaurants… (issues « pratique » validées)."""
    try:
        out = {}
        for it, icao, fields in club_issues('pratique'):
            txt = (fields.get('informations') or '').strip()
            if txt:
                out.setdefault(icao, []).append({'txt': txt[:600], 'maj': it['created_at'][:10], 'ref': it['number']})
        save('pratique_club.json', {'generated': NOW.isoformat(), 'aerodromes': out})
    except Exception as e:  # noqa: BLE001
        print('pratique :', e)
        fallback('pratique_club.json')


def write_status():
    prev = {}
    if FALLBACK_URL:
        try:
            prev = json.loads(get(f'{FALLBACK_URL}/data/live/status.json', timeout=30)).get('files', {})
        except Exception:  # noqa: BLE001
            prev = {}
    files = {}
    for name in set(prev) | set(STATUS):
        st = STATUS.get(name, 'non exécuté')
        last_ok = NOW.isoformat() if st.startswith('ok') or st.startswith('repris') else (prev.get(name) or {}).get('last_ok')
        files[name] = {'state': st, 'last_ok': last_ok}
    with open(os.path.join(OUT, 'status.json'), 'w', encoding='utf-8') as f:
        json.dump({'run': NOW.isoformat(), 'files': files}, f, ensure_ascii=False, indent=1)
    print('État :', {k: v['state'] for k, v in files.items()})


if __name__ == '__main__':
    what = sys.argv[1:] or ['metar', 'notam', 'supaip', 'aip', 'cams', 'fees', 'pratique', 'vigilance']
    if 'metar' in what:
        collect_metar_taf()
    if 'notam' in what:
        collect_notam()
    if 'supaip' in what:
        collect_supaip()
    if 'aip' in what:
        collect_aip()
    if 'cams' in what:
        collect_cams()
    if 'fees' in what:
        collect_fees()
    if 'pratique' in what:
        collect_pratique()
    if 'vigilance' in what:
        collect_vigilance()
    if os.path.exists(os.path.join(OUT, 'vac.json')):   # extrait léger pour la carte (carburant, paiement) : 700 ko -> quelques dizaines
        vac = json.load(open(os.path.join(OUT, 'vac.json'), encoding='utf-8'))
        if 'osm' in what or not sys.argv[1:]:
            collect_osm(vac.get('cycle'))
        osm = json.load(open(os.path.join(OUT, 'osm_near.json'), encoding='utf-8')).get('data', {}) if os.path.exists(os.path.join(OUT, 'osm_near.json')) else {}
        # points de report VFR du cycle en cours, lus dans les VAC ; terrain sans tableau dans sa VAC : ancien export SIA
        old = json.load(open(os.path.join(ROOT, 'data', 'vfr_points.json'), encoding='utf-8'))
        pts = {k: v['vfrpts'] for k, v in (vac.get('data') or {}).items() if v.get('vfrpts')}
        kept = {k: [dict(p, old=old.get('effDate')) for p in v] for k, v in old['data'].items() if k not in pts}
        if pts:
            save('vfr_points.json', {'source': f"SIA - VAC du cycle {vac.get('cycle')} (+ export XML SIA du {old.get('effDate')} pour {len(kept)} terrains)",
                                     'effDate': vac.get('cycle'), 'data': {**kept, **pts}})
        save('escale.json', {'generated': vac.get('generated'), 'cycle': vac.get('cycle'),
                             'data': {k: {'escale': {**(v.get('escale') or {}), **ppr_contacts(v), 'qfu': v.get('qfu') or [], 'pratique': vie_pratique(v), 'osm': osm.get(k, {})}} for k, v in (vac.get('data') or {}).items()}})
    write_status()
