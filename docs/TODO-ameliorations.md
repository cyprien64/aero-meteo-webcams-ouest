# Améliorations de la préparation de vol — liste de travail

Demandées le 25/11/2026. Cocher `[x]` chaque point terminé, vérifié et publié.
Une session automatique reprend les points non cochés le jeudi 26/11/2026 à 3 h 20 (heure de Paris) si la session interactive n'a pas tout fini.

Règles du projet (à respecter) :
- code dans `prepavol.js` (une IIFE), `map.js`, `map.css`, `scripts/collect.py`, `sw.js` ; augmenter `VERSION` de `sw.js` à chaque publication ;
- un `console.assert` pour toute logique nouvelle non triviale ; **aucun assert au chargement ne doit utiliser une `const` définie plus bas** (TDZ : tout le module tombe) ;
- ne pas committer `data/live/*` ni `data/template/log_nav_acb.xlsx` ;
- commits signés `-c user.email=322521137+cyprien64@users.noreply.github.com -c user.name=cyprien64`, message terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ;
- textes de l'interface en français simple ; ne jamais inventer de données (performances, contacts) : sinon « à vérifier ».

## Météo et sécurité
- [x] 10. Plafond et visibilité à l'heure de passage pour chaque terrain de déroutement ; lesquels restent utilisables.
- [x] 11. Turbulence et cisaillement : vent fort près du sol au décollage / à l'atterrissage, turbulence près des crêtes.
- [x] 12. Brouillard et stratus : risque de formation / levée (écart T / Td, heure, saison).
- [x] 13. Orages : heure de début probable le long de la route (CAPE, précipitations), alerte « rentrer avant ».
- [x] 33. Fenêtre météo du jour : frise heure par heure (départ, route, arrivée) favorable / marginal / défavorable.
- [x] 34. TAF et METAR traduits en phrases courtes en français.
- [x] 35. Tendance par rapport à la préparation précédente (amélioration / dégradation).

## Masse, carburant, performances
- [x] 7. Masse au décollage par étape (passagers / bagages différents à chaque escale).
- [x] 30. Carburant minimal légal détaillé ligne par ligne (roulage, étape, imprévus, dégagement, réserve finale).
- [x] 31. Performances au plus défavorable (herbe mouillée, pente, température max, rafales) avec marge sur la piste.
- [x] 32. Altitude-densité de chaque terrain le jour du vol, alerte en été / montagne.

## Terrains et escales
- [x] 25. Intégration au terrain d'arrivée : point d'entrée, altitude du tour de piste, côté, piste probable.
- [x] 26. Fiche escale complète par terrain en une carte (horaires du jour, PPR, carburant, paiement, taxe, restaurant, transport).
- [x] 27. Horaires des terrains de dégagement vérifiés à l'heure prévue.
- [x] 28. Choix automatique du meilleur dégagement (ouvert, météo, longueur de piste, carburant).
- [x] 29. Avitaillement optimisé en voyage (où faire le plein).

## Route et navigation
- [x] 6. Itinéraire par les points VFR et repères évidents (élèves).
- [x] 21. 2 ou 3 routes proposées et comparées (directe, facile, repères).
- [x] 22. Points tournants suggérés sur des repères évidents tous les 15-20 NM.
- [x] 23. Contrôle de l'estime par branche : repère attendu à la minute Y, sinon action.
- [x] 24. Point de début de descente (TOD), vario conseillé, heure de passage.

## Documents
- [ ] 5. Bande de carte le long de la route dans le PDF (strip-map par branche).
- [ ] 8. Coût réel du voyage (taxes, carburant aux escales, partage, export club).
- [ ] 9. Plan de vol OACI pré-rempli complet à copier dans SOFIA.
