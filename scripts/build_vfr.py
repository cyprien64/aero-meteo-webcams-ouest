"""Points de report VFR (NavFix de type VFR) de l'export XML du SIA -> data/vfr_points.json.
Usage : python3 scripts/build_vfr.py XML_SIA_aaaa-mm-jj.xml
L'export est téléchargeable gratuitement sur le site du SIA (produits numériques, « Données aéronautiques XML »,
Licence Ouverte) ; une archive publique est aussi disponible sur data.gouv.fr."""
import json, os, re, sys

src = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(src, encoding='latin-1').read()
eff = re.search(r'effDate="([^"]+)"', s)
b = s[s.find('<NavFixS>'):s.find('</NavFixS>')]
apts = json.loads(re.search(r'window\.AERODROMES = (\[.*?\]);', open(os.path.join(root, 'data', 'sources.js'), encoding='utf-8').read(), re.S).group(1))
codes = {a[0] for a in apts}
out = {}
for m in re.finditer(r'<NavFix [^>]*>(.*?)</NavFix>', b, re.S):
    x = m.group(1)
    if '<NavType>VFR' not in x:
        continue
    g = lambda t: (re.search(f'<{t}>([^<]*)</{t}>', x) or [None, None])[1]
    ident, la, lo, desc = g('Ident'), float(g('Latitude')), float(g('Longitude')), (g('Description') or '').strip()
    pfx, _, name = ident.partition('-')
    icao = 'LF' + pfx
    if icao not in codes or not name:
        continue
    out.setdefault(icao, []).append({'id': name, 'la': round(la, 5), 'lo': round(lo, 5), 'desc': re.sub(r'\s+', ' ', desc)})
for v in out.values():
    v.sort(key=lambda p: p['id'])
json.dump({'source': 'SIA - export XML (Licence Ouverte)', 'effDate': eff.group(1) if eff else '', 'data': out},
          open(os.path.join(root, 'data', 'vfr_points.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'aérodromes,', sum(len(v) for v in out.values()), 'points VFR')
