"""Prépare le modèle Excel du log de nav ACB pour l'extension :
- retire l'adresse e-mail de l'auteur, calcChain, onglet sélectionné ; recalcul complet à l'ouverture
- produit log_meta.json : cellules à remplir pour chaque feuille avion (déduites du contenu)."""
import sys, re, json, zipfile, io
import openpyxl
src, out_xlsx, out_meta = sys.argv[1:4]
wb = openpyxl.load_workbook(src)  # formules
zin = zipfile.ZipFile(src)
names = zin.namelist()
wbxml = zin.read('xl/workbook.xml').decode('utf-8')
rels = zin.read('xl/_rels/workbook.xml.rels').decode('utf-8')
sheets = re.findall(r'<sheet name="([^"]+)" sheetId="\d+" r:id="(rId\d+)"/>', wbxml)
target = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels)) | {k: v for v, k in re.findall(r'Target="([^"]+)"[^>]*Id="(rId\d+)"', rels)}
meta = {'sheets': {}}
for idx, (name, rid) in enumerate(sheets):
    if name in ('INFOS', 'DATA', 'mach7', 'df15'):
        continue
    ws = wb[name]
    path = 'xl/' + target[rid]
    g = lambda c: ws[c].value
    # cellules de masse (colonne E = libellé, G = valeur)
    mass = {}
    for r in range(5, 14):
        lab = str(g(f'E{r}') or '')
        if lab.startswith('Pilot'): mass['pilot'] = f'G{r}'
        elif lab.startswith('Copilot'): mass['copilot'] = f'G{r}'
        elif lab.startswith('Pax'): mass.setdefault('pax', []).append(f'G{r}')
        elif lab.startswith('Bag'): mass['bag'] = f'G{r}'
        elif lab.startswith('Gas'): mass['fuel'] = f'G{r}'
        elif lab.startswith('Fuel'): mass['aux'] = f'G{r}'
    # lignes de branche : P = formule IF(Oxx...)
    legs = [r for r in range(9, 60) if isinstance(g(f'P{r}'), str) and g(f'P{r}').startswith('=IF(O')]
    tot = next(r for r in range(30, 60) if g(f'N{r}') == 'Totaux')
    main = sorted(int(x) for x in re.findall(r'O(\d+)=""', g(f'O{tot}')))
    deg = [r for r in legs if r not in main and r < tot]
    # blocs d'info (colonne A)
    blocks = []
    for r in range(1, 64):
        if g(f'A{r}') == 'INFO':
            blocks.append({'start': r})
    info = []
    for bi, b in enumerate(blocks):
        end = blocks[bi + 1]['start'] if bi + 1 < len(blocks) else 64
        d = {'ident': f'A{b["start"] + 2}'}
        for r in range(b['start'], end):
            lab = g(f'A{r}')
            if lab in ('RWY', 'VW', 'VISI', 'TT/TD', 'QNH', 'FEW', 'SCT', 'BKN', 'OVC', 'FLT', 'Para', 'Birds', 'TBO'):
                d.setdefault(lab, f'B{r}')
        info.append(d)
    # bloc de droite (X) : INFO/RWY/FLT/VW/KT/VISI/QNH ... (valeurs en W ? on écrit en W)
    meta['sheets'][name] = {
        'index': idx, 'path': path, 'type': g('E35'), 'mass': mass, 'legs': main, 'deg': deg, 'tot': tot,
        'info': info, 'clearRows': [9, max(deg + main) + 2],
        'fuelDensity': 0.84 if 'CDI' in str(g('E35')) else 0.72,
    }
json.dump(meta, open(out_meta, 'w'), ensure_ascii=False, indent=1)
# --- nettoyage du classeur
zout = zipfile.ZipFile(out_xlsx, 'w', zipfile.ZIP_DEFLATED)
for n in names:
    if n == 'xl/calcChain.xml':
        continue
    data = zin.read(n)
    if n == 'xl/sharedStrings.xml':
        data = data.decode('utf-8').replace('gerard.florit@wanadoo.fr', '(auteur du modèle : Golf-Fox)').encode('utf-8')
    elif n == 'xl/workbook.xml':
        s = data.decode('utf-8')
        s = re.sub(r'<calcPr[^>]*/>', '<calcPr calcId="191029" fullCalcOnLoad="1"/>', s)
        data = s.encode('utf-8')
    elif n == 'xl/_rels/workbook.xml.rels':
        data = re.sub(r'<Relationship [^>]*calcChain[^>]*/>', '', data.decode('utf-8')).encode('utf-8')
    elif n == '[Content_Types].xml':
        data = re.sub(r'<Override [^>]*calcChain[^>]*/>', '', data.decode('utf-8')).encode('utf-8')
    elif n.startswith('xl/worksheets/sheet') and n.endswith('.xml'):
        data = data.decode('utf-8').replace(' tabSelected="1"', '').encode('utf-8')
    zout.writestr(zin.getinfo(n), data)
zout.close()
print(json.dumps({k: {kk: v[kk] for kk in ('type', 'mass', 'legs', 'deg', 'tot', 'info')} for k, v in meta['sheets'].items()}, ensure_ascii=False, indent=0)[:4000])
