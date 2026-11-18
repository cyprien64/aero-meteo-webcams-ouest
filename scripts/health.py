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
    # une seule alerte par panne : on échoue au passage qui franchit le seuil (GitHub saute ou retarde des passages,
    # d'où la comparaison avec l'ancienneté au passage précédent plutôt qu'une fenêtre fixe)
    prev_age = age - (now - datetime.fromisoformat(st['prev_run'])).total_seconds() / 3600 if st.get('prev_run') else age - 0.5   # sans passage précédent connu : fenêtre de 30 min
    if age > hours and prev_age <= hours:
        bad.append(f'{name} non mis à jour depuis {age:.0f} h ({f.get("state")})')
if bad:
    print('::error::' + ' | '.join(bad))
    sys.exit(1)
print('Données à jour.')
