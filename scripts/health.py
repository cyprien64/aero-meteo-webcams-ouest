#!/usr/bin/env python3
"""Échoue (code 1) si les données essentielles ne se mettent plus à jour : GitHub envoie alors un e-mail
au propriétaire du dépôt (échec d'un workflow planifié)."""
import json, os, sys
from datetime import datetime, timezone

st = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'data', 'live', 'status.json'), encoding='utf-8'))
now = datetime.now(timezone.utc)
LIMITS = {'notam.json': 6, 'metar.json': 3, 'supaip.json': 48, 'vac.json': 24 * 35}   # heures sans succès tolérées
bad = []
for name, hours in LIMITS.items():
    f = st['files'].get(name) or {}
    lo = f.get('last_ok')
    age = (now - datetime.fromisoformat(lo)).total_seconds() / 3600 if lo else 9999
    print(f'{name:14s} {f.get("state", "?"):40s} dernier succès il y a {age:.1f} h (max {hours} h)')
    # une seule alerte par panne : la collecte tourne toutes les 15 min, on n'échoue qu'au franchissement du seuil
    if hours < age <= hours + 0.5:
        bad.append(f'{name} non mis à jour depuis {age:.0f} h ({f.get("state")})')
if bad:
    print('::error::' + ' | '.join(bad))
    sys.exit(1)
print('Données à jour.')
