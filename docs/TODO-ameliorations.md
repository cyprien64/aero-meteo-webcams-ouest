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
- [ ] 5. Bande de carte le long de la route dans le PDF (strip-map par branche). — Code écrit (buildPdf, renderNavMap opt.ratio) mais PDF non vérifié : générer un PDF et contrôler les pages « BANDE DE CARTE ».
- [x] 8. Coût réel du voyage (taxes, carburant aux escales, partage, export club).
- [x] 9. Plan de vol OACI pré-rempli complet à copier dans SOFIA.

## Ensuite (session automatique, demandé le 25/11/2026)
Une fois les points ci-dessus faits : choisir et réaliser d'autres améliorations utiles à la préparation du vol et à la fiabilité du site. Les ajouter ici avant de commencer (une ligne chacune, `- [ ]`), puis les cocher une fois faites.
Idées de fiabilité à étudier en priorité : test automatique de chargement de `prepavol.js` dans un faux DOM (Node) lancé par le workflow avant publication (bloque si un `console.assert` échoue ou si le module ne se charge pas) ; contrôle des fichiers `data/live/*.json` (taille, champs) avec repli sur la version publiée ; signalement clair dans l'interface quand une source est en échec ou trop ancienne ; nettoyage des caches et du stockage local qui grossissent.
- [x] A. Test automatique `tests/test_site.js` (faux navigateur Node) lancé par le workflow avant publication : bloque si un script plante ou si un `console.assert` échoue, et vérifie les fichiers de `SHELL` de `sw.js`. Il a trouvé l'assert `tokWords` faux (corrigé).
- [x] B. Contrôle des fichiers `data/live` avant publication : fichier presque vide -> version publiée gardée, anomalie notée « suspect » dans `status.json` (`collect.py`, MIN_ITEMS / suspect).
- [x] C. Bandeau sur la carte quand une source est en échec, suspecte ou trop ancienne, ou si la collecte est arrêtée (`map.js`, staleSources).
- [x] D. Nettoyage du stockage : listes cochées de plus de 30 jours, rappels orphelins, fichiers d'historique orphelins, VAC hors ligne limitées à 40 (`prepavol.js`, cleanStorage).

## Préparation, lot du 26/11/2026
- [x] 39. Verdict global vert / orange / rouge en tête, avec les 3 raisons principales.
- [x] 41. Scénario « et si » : départ décalé, passager en plus, vent plus fort.
- [x] 42. Points de demi-tour météo sur la coupe, avec terrain de repli.
- [x] 43. Fréquences dans l'ordre du vol avec heure et point de changement.
- [x] 44. Zones actives à l'heure de passage en surbrillance sur la carte.
- [x] 45. Préparation d'un vol local (zone de travail, durée, carburant).
- [x] 46. Terrains à éviter pour l'avion (piste courte, herbe détrempée).
- [x] 47. Notes personnelles par terrain, rappelées à la préparation.
- [x] 48. Taxes et infos d'escale partagées entre pilotes du club. — Le circuit existait (proposition par e-mail, issues « taxe » / « pratique » validées, fees_club.json) ; ajout du bouton « Proposer » dans la fiche escale de la préparation.
- [x] 49. Fiche de genou A5 d'une page.
- [x] E. Bande de carte du PDF : branches nord-sud en bandes verticales côte à côte, étiquettes à la taille du grand côté de l'image.

## Route « VFR facile », lot du 26/11/2026
- [x] F. Clairances à demander dans le résumé de la route facile (passer sous X ft ou appeler la fréquence à N NM) : `clearancesOf`.
- [x] G. Contournement au plus près (marge 1 NM) ; points de contournement nommés d'après la ville la plus proche : `nameDetours`.
- [x] H. Point VFR publié à ≤ 3 NM préféré au point de contournement s'il garde la route hors de la zone (les routes de transit des VAC ne sont pas dans les données).
- [x] I. Plafond bas sur le relief : route par les vallées (couloir ±15 NM, point le plus haut le plus bas) si elle abaisse le relief sous la route d'au moins 500 ft et rallonge de 40 % au plus : `lowPath`, `valleyRoute`.
- [x] J. Route directe en bleu pointillé sur la carte à côté de la route facile.

## Sécurité, lot du 26/11/2026 (2)
- [x] K. Givrage carburateur croisière / descente (diagramme CAA approché) : `carbIce`, `carbOf`, alerte si fort.
- [x] L. Ondes / rotors : zone sous le vent dessinée sur la carte (l'alerte `waveRisk` existait).
- [x] M. Point équitemps / non-retour marqués sur la coupe et donc dans le PDF (le calcul `pnrEtp` existait).
- [x] N. Branches au-dessus de l'eau : distance à la côte comparée au plané, gilets obligatoires au-delà (`waterOf`).
- [x] O. Survol d'agglomérations trop bas (taille estimée d'après la population, à vérifier) : `townsLow`. Parc national et ZSM existaient ; réserves naturelles : pas de données.
- [x] P. RMZ / TMZ traversées : contact radio / transpondeur obligatoire. La frontière (plan de vol) existait.
