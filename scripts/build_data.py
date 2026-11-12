"""Assemble data.js + geo files for the extension.
usage: python3 -I build_data.py <dl_dir> <extension_dir>"""
import json, re, sys, csv, os

dl, ext = sys.argv[1], sys.argv[2]
os.makedirs(ext + '/data', exist_ok=True)


def in_zone(la, lo):
    """Zone : Pyrénées (+ bordure espagnole) -> Bretagne / Pays de la Loire."""
    if la < 42.0 or la > 48.95 or lo < -5.4:
        return False
    if la < 46.0:
        return lo <= 2.6
    if la < 48.0:
        return lo <= 2.0
    return lo <= 0.6


def size_from_fn(fn):
    m = re.search(r'(\d{3,4})x(\d{3,4})', fn)
    if m:
        return int(m.group(1)), int(m.group(2))
    return {
        'webcam_cam_aero': (1024, 768), 'webcam_cam_aero_right': (1024, 768),
        'webcam_meteociel': (1120, 0), 'piou_piou': (800, 0), 'metar_list': (1400, 0),
        'webcam_panoramic': (0, 0), 'webcam_meteoamikuze': (1440, 0),
    }.get(fn, (1280, 800))


def clean_title(t):
    return re.sub(r'\s+', ' ', t).strip()


items = []
seen_urls = set()

# 1) Points repris du site d'origine (moitié ouest de la carte LFDT)
orig_file = dl + '/orig_west_geo.json' if os.path.exists(dl + '/orig_west_geo.json') else dl + '/orig_west.json'
for o in json.load(open(orig_file, encoding='utf-8')):
    u, fn, t = o['url'], o['fn'], clean_title(o['title'])
    if fn == 'link' or not t:
        continue
    if 'aviationweather' in u:
        continue  # remplacé par METAR/TAF en direct
    if t in ('Map', 'Metar-taf', 'Gliders (Flarm)', 'SafeSky', 'flightradar24'):
        continue  # outils -> barre d'outils
    if 'Radar' in t or 'Satellite' in t:
        continue  # -> barre d'outils
    w, h = size_from_fn(fn)
    if 'meteociel' in u:
        typ = 'obs'
    elif fn == 'piou_piou':
        typ = 'wind'
    elif 'weather_taf' in u:
        typ = 'fcst'
    else:
        typ = 'cam'
    aero = bool(re.search(r'a[ée]ro|ULM|LF[A-Z]{2}|cam-aero|Planeurs|Para|Gyro', t + u, re.I))
    if u in seen_urls:
        continue
    seen_urls.add(u)
    it = dict(t=typ, n=t, u=u, la=o['lat'], lo=o['lon'], w=w, h=h, s='ia')
    if typ == 'cam' and aero:
        it['a'] = 1
    if typ == 'cam' and re.search(r'\.(jpe?g|png)(\?|$)', u, re.I):
        it['img'] = u
    items.append(it)

# 2) Réseau cam-aero.eu (webcams d'aérodromes, coordonnées GPS officielles)
dyn = json.load(open(dl + '/dyn.json', encoding='utf-8'))['cams']
for c in dyn:
    if c.get('out'):
        continue
    la, lo = c['y'], c['x']
    if not in_zone(la, lo):
        continue
    u = c['link']
    key = u.replace('http://', 'https://').rstrip('/')
    if any(key.split('raspicamaero/')[1].split('/')[0] in s for s in seen_urls):
        continue
    seen_urls.add(u)
    name = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', c['name']).replace('_', ' ')
    items.append(dict(t='cam', a=1, n='%s - %s (Station Aéro - cam-aero.eu)' % (c['code'], name), u=u,
                      la=round(la, 4), lo=round(lo, 4), w=1024, h=768, s='ca'))

# 3) Vision-Environnement (webcams géolocalisées, très nombreuses en Bretagne / Atlantique)
def slug(s):
    import unicodedata
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').lower()
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'webcam'

for w in json.load(open(dl + '/ve_west.json', encoding='utf-8')):
    la, lo = float(w['lat']), float(w['lon'])
    if w.get('region') in ('Île-de-France',) or not in_zone(la, lo):
        continue
    tok = (str(w['key']).strip() + '-' + slug(w.get('id') or w['nom'])) if w.get('key') else slug(w.get('id') or w['nom'])
    u = 'https://www.vision-environnement.com/webcam/%s/%s/%s/' % (slug(w['pays']), slug(w['region']), slug(tok))
    if u in seen_urls:
        continue
    seen_urls.add(u)
    sb = w.get('streamby')
    n = w['nom'] + (' - ' + sb if sb and sb != '0' else '') + ' (vision-environnement.com)'
    items.append(dict(t='cam', n=n, u=u, la=round(la, 4), lo=round(lo, 4), w=1600, h=900, s='ve', img=w.get('img')))

# 4) Stations Météociel de l'Ouest (identifiants OMM vérifiés sur meteociel.fr)
MC = [
    (7100, 'Ouessant', 48.47, -5.06), (7101, 'Ploudalmézeau', 48.53, -4.66), (7103, 'Pointe du Raz', 48.04, -4.73),
    (7104, 'Camaret', 48.28, -4.59), (7106, 'Landivisiau LFRJ', 48.53, -4.15), (7107, 'Brignogan', 48.68, -4.33),
    (7109, 'Lanvéoc LFRL', 48.28, -4.45), (7110, 'Brest LFRB', 48.44, -4.41), (7116, 'Île de Batz', 48.75, -4.02),
    (7117, "Ploumanac'h", 48.83, -3.47), (7118, 'Lannion LFRO', 48.75, -3.46), (7120, 'Saint-Brieuc LFRT', 48.54, -2.85),
    (7121, 'Île de Bréhat', 48.85, -3.00), (7125, 'Dinard LFRD', 48.59, -2.08), (7127, 'Grouin de Cancale', 48.71, -1.84),
    (7130, 'Rennes LFRN', 48.07, -1.73), (7133, 'Granville LFRF', 48.84, -1.61), (7134, 'Laval LFOV', 48.03, -0.74),
    (7139, 'Alençon', 48.45, 0.11), (7200, 'Pointe de Penmarc\'h', 47.80, -4.37), (7201, 'Quimper LFRQ', 47.97, -4.17),
    (7203, 'Île de Groix', 47.65, -3.50), (7205, 'Lorient LFRH', 47.76, -3.44), (7207, 'Belle-Île Le Talut', 47.29, -3.22),
    (7216, 'Pointe de Chémoulin', 47.23, -2.30), (7222, 'Nantes LFRS', 47.15, -1.61), (7230, 'Angers-Beaucouzé', 47.48, -0.61),
    (7235, 'Le Mans LFRM', 47.94, 0.19), (7240, 'Tours LFOT', 47.44, 0.73), (7245, 'Blois', 47.68, 1.21),
    (7247, 'Romorantin', 47.32, 1.69), (7300, "Île d'Yeu", 46.69, -2.33), (7306, 'La Roche-sur-Yon LFRI', 46.70, -1.38),
    (7314, 'Pointe de Chassiron', 46.05, -1.41), (7315, 'La Rochelle Le Bout Blanc', 46.15, -1.15),
    (7316, 'La Rochelle LFBH', 46.18, -1.19), (7330, 'Niort LFBN', 46.32, -0.40), (7335, 'Poitiers LFBI', 46.59, 0.31),
    (7412, 'Cognac LFBG', 45.66, -0.31), (7420, 'Angoulême LFBU', 45.73, 0.22), (7434, 'Limoges LFBL', 45.86, 1.18),
    (7510, 'Bordeaux LFBD', 44.83, -0.69),
]
for code, name, la, lo in MC:
    u = 'https://www.meteociel.fr/temps-reel/obs_villes.php?code2=%d' % code
    if u in seen_urls:
        continue
    seen_urls.add(u)
    items.append(dict(t='obs', n='Observations %s (Météociel / Météo France)' % name, u=u, la=la, lo=lo, w=1120, h=0, s='mc'))

for it in items:
    if it.get('img') is None:
        it.pop('img', None)

# 5) Aérodromes (OurAirports, domaine public)
apts = []
for r in csv.DictReader(open(dl + '/airports.csv', encoding='utf-8')):
    if r['type'] not in ('small_airport', 'medium_airport', 'large_airport'):
        continue
    la, lo = float(r['latitude_deg']), float(r['longitude_deg'])
    ident = r['ident']
    if r['iso_country'] == 'FR' and ident.startswith('LF') and len(ident) == 4 and in_zone(la, lo):
        pass
    elif r['iso_country'] in ('ES', 'AD') and ident in ('LESO', 'LEPP', 'LEHC', 'LECI', 'LESU', 'LEBB', 'LEVT', 'LEXJ', 'LELL'):
        pass
    else:
        continue
    name = re.sub(r'\s+(A[ée]rodrome|Airport|Airfield|Air Base|Aeroport|Aéroport)\b.*$', '', r['name'], flags=re.I)
    name = re.sub(r'^(A[ée]rodrome|A[ée]roport) (de |d\'|du |des )?', '', name, flags=re.I)
    apts.append([ident, name.strip(), round(la, 4), round(lo, 4), r['elevation_ft'] or '', r['type'][0]])
apts.sort()

# Recalage : un point d'origine qui cite un code OACI est placé sur l'aérodrome (léger décalage)
apt_pos = {a[0]: (a[2], a[3]) for a in apts}
import itertools
off = itertools.cycle([(0.012, 0.0), (0.0, 0.016), (-0.012, 0.0), (0.0, -0.016), (0.009, 0.012), (-0.009, -0.012)])
for it in items:
    if it['s'] != 'ia':
        continue
    m = re.findall(r'LF[A-Z]{2}', it['n'])
    if m and m[0] in apt_pos:
        la, lo = apt_pos[m[0]]
        d = next(off) if it['t'] != 'fcst' else (0, 0)
        it['la'], it['lo'] = round(la + d[0], 4), round(lo + d[1], 4)

counts = {}
for it in items:
    counts[it['t'] + ('-aero' if it.get('a') else '')] = counts.get(it['t'] + ('-aero' if it.get('a') else ''), 0) + 1
print('items', len(items), counts, 'aerodromes', len(apts))

with open(ext + '/data/sources.js', 'w', encoding='utf-8') as f:
    f.write('// Généré automatiquement — sources météo / webcams de la zone Pyrénées → Bretagne\n')
    f.write('window.SOURCES = ' + json.dumps(items, ensure_ascii=False, separators=(',', ':')).replace('},{', '},\n{') + ';\n')
    f.write('window.AERODROMES = ' + json.dumps(apts, ensure_ascii=False, separators=(',', ':')) + ';\n')

# 6) Fond de carte schématique : régions françaises + pays voisins
reg = json.load(open(dl + '/regions.geojson', encoding='utf-8'))
world = json.load(open(dl + '/world.geojson', encoding='utf-8'))
nb = [f for f in world['features'] if f['properties'].get('name') in ('Spain', 'United Kingdom')]
dep = json.load(open(dl + '/depts.geojson', encoding='utf-8'))


def rnd(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 3), round(c[1], 3)]
    return [rnd(x) for x in c]


def slim(feats, kind):
    out = []
    for f in feats:
        out.append({'type': 'Feature', 'properties': {'k': kind, 'n': f['properties'].get('nom') or f['properties'].get('name')},
                    'geometry': {'type': f['geometry']['type'], 'coordinates': rnd(f['geometry']['coordinates'])}})
    return out

geo = {'type': 'FeatureCollection', 'features': slim(nb, 'nb') + slim(dep['features'], 'dep') + slim(reg['features'], 'reg')}
with open(ext + '/data/basemap.js', 'w', encoding='utf-8') as f:
    f.write('window.BASEMAP = ' + json.dumps(geo, separators=(',', ':')) + ';\n')
print('basemap', os.path.getsize(ext + '/data/basemap.js'))
