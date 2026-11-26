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
- [x] 5. Bande de carte le long de la route dans le PDF (strip-map par branche). — Vérifiée le 26/11/2026 sur un vrai PDF Pau → Lasbordes (carte OACI, route, repères 10 NM, cartouche temps / cap / distance).
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

## Lot du 26/11/2026 (3)
- [x] Q. Webcams à moins de 5 NM de la route avec l'heure de passage (`routeCams`).
- [x] R. Soleil bas face à la route (croisière et finale) : `sunPos`, `glareOf`.
- [x] S. Fiche briefing passagers à imprimer (`paxBrief`).
- [x] T. Panne radio : 7600, SERA.14083, feux de la tour, espaces contrôlés traversés, consignes des VAC (2 VAC seulement en ont dans leur texte).
- [x] U. Champs de secours OpenStreetMap à la demande, sur la carte et la coupe (taille approchée par le rectangle englobant).
- [x] V. Meilleur jour sur 7 jours (une requête, AZBA pour le jour du vol seulement).
- [x] W. Climatologie sur 10 ans pour un vol au-delà de 15 jours (`climatology`).
- [x] X. QNH des METAR le long de la route, alerte au-delà de 3 hPa.
- [x] Y. Thermiques l'été et brise de mer aux terrains côtiers (`thermals`, `seaBreeze`, `seaDir`).
- [x] Z. Vitesse d'approche corrigée (masse, rafales) : `vappOf`.

## Lot du 26/11/2026 (4)
- [x] AA. Panne moteur au décollage : photo satellite de l'axe (± 30° sur 2 NM) et champs OSM, briefing à dire (`efatoPlan`).
- [x] AB. Tronçons hors de portée de plané d'un terrain, en rouge sur la coupe et la carte (`glideGaps`).
- [x] AC. Brume sèche / poussières (Open-Meteo qualité de l'air, `airQuality`, `hazeLevel`).
- [x] AD. Feux détectés par satellite (NASA FIRMS, fichiers publics 24 h, `collect_fires`, `firesNear`).
- [x] AE. NOTAM en français simple, triés par importance (`notamPlain`, `notamKind`).
- [x] AF. Photo du terrain d'arrivée avec pistes OSM, schéma du tour de piste et point d'entrée, aussi dans le PDF (`airfieldPhoto`).
- [x] AG. Éoliennes et lignes haute tension (OSM) sur la carte et la coupe (`osmObstacles`).

## Lot du 26/11/2026 (5)
- [x] AH. Indice de confiance : plafond, vent et visibilité comparés entre Météo-France, ICON et GFS sur 8 points de la route ; « prévision incertaine » si désaccord (`modelSpread`, `modelConfidence`).
- [x] AI. Fiche radio dans l'ordre du vol avec l'heure, appels en route à l'entrée réelle des espaces, vent arrière et finale en auto-information / AFIS (`radioCard` existait).
- [x] AJ. Vol retour : bouton « Préparer le retour » (route inversée, départ = arrivée + escale) ; l'aller-retour reprend la route de l'aller à l'envers (`revLeg`).

## Lot du 26/11/2026 (6)
- [x] AK. « Où voler ? » : 40 terrains atteignables au plus dans le temps aller choisi, classés par météo (milieu de route + arrivée), horaires, zones P, piste, taxe ; bouton « Préparer » (`whereToFly`, `wxLevel` extrait de `routeWeather`).
- [x] AL. Probabilité VFR : ensemble ECMWF (51 scénarios), part des scénarios avec plafond > 1500 ft sol et rafales < 25 kt sur toute la route (`ensStats`, `ensembleProb`).
- [x] AM. Zone étendue à toute la France métropolitaine : 439 terrains (OurAirports), webcams cam-aero.eu et vision-environnement de toute la France, NOTAM des 5 FIR, bornes de `collect.py` et de la carte, repères visuels OSM.
- [x] AN. Interface : thème clair façon Apple (automatique selon l'appareil, bouton 🌓), tuiles d'accueil (Préparer, Où voler, Mesurer), boutons bleus, interrupteurs verts ; le thème sombre actuel est gardé.

## Interface, lot du 26/11/2026 (7)
- [x] AO. Briefing en onglets : Résumé, Météo, Route, Terrains, Radio, Sécurité (`tabsHtml`) ; vol simple : fenêtre météo, créneaux, coût et liste de contrôle rangés dedans.
- [x] AP. Formulaire de préparation en 3 étapes (Trajet, Avion et chargement, Pilote), options d'escale repliées.
- [x] AQ. Verdict en grand : anneau (probabilité VFR), 3 raisons, heures clés.
- [x] AR. Tiroir du panneau sur téléphone (réduit / moitié / plein écran), animations douces (désactivées si « réduire les animations »).
- [x] AS. Icônes fines à la place des émojis (barre, tuiles, rubriques, onglets).
- [x] AT. Fond « Schéma » clair en thème clair ; marqueurs METAR (pastille + trait de vent, cercle orange si rafales ≥ 25 kt), webcams et regroupements redessinés.
- [x] AU. Fiche terrain : bandeau webcam, catégorie de vol en grand, schéma de la piste avec le vent.
- [x] AV. PDF : page de garde (verdict, probabilité VFR, chiffres clés, croquis de la route).
- [x] AW. Test de chargement : `L.geoJSON` appelle son style (attrape une const utilisée avant sa déclaration).

## Lot du 26/11/2026 (8)
- [x] AX. Curseur horaire sur la carte : départ simulé de 6 h à 20 h, avis VFR et vent à l'heure de passage de chaque point de la route, bande des bonnes heures, bouton « Utiliser » (`timeSlider`, `slidePts`, données de `dayWx`, 5 points par étape).
- [x] AY. Vitesse : mesurée sur le site publié (~1 Mo compressé au démarrage, surtout les NOTAM ; lecture JSON < 20 ms sur ordinateur ; VAC chargées seulement à la préparation) ; rien de bloquant, pas de changement.
- [x] AZ. Workflow : actions GitHub en versions Node 24 (checkout v7, cache v6, configure-pages v6, upload-pages-artifact v5, deploy-pages v5).
- [x] BA. Lisibilité : contrastes ≥ 4,5:1 dans les deux thèmes (textes secondaires, couleurs vives du HTML généré), contour de focus au clavier, flèches entre les onglets, poignée du tiroir au clavier.

## Lot du 26/11/2026 (9)
- [x] BB. Collecte en deux : rapide toutes les 15 min (METAR, TAF, NOTAM, SUP AIP, vigilance, feux, club ; fichiers lents republiés tels quels, état « gardé ») et complète la nuit, au push et à la demande (VAC, zones, OSM, webcams) ; cache des VAC en lecture seule pour la collecte rapide.
- [x] BC. Collecte : terrains NOTAM sans réponse sautés 24 h, journal au fil de l'eau, durée limitée à 30 min.
- [x] BD. Alertes : tour d'une CTR traversée fermée à l'heure de passage (horaires VAC) ; SIV assuré seulement hors des horaires ATS d'un aérodrome ouvert (remarque ENR 2.2, champ `rmk`).
- [x] BE. Curseur horaire : pluie / orages (grille ≤ 56 points) et vent au niveau de pression de la croisière sur la carte (`gridWx`).
- [x] BF. Service worker : fichiers fixes de data/ en cache d'abord ; données en direct avec délai de 8 s avant la copie locale ; vac.json plus préchargé ; préconnexion Open-Meteo et Géoplateforme.
