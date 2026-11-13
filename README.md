# Aéro Météo Webcams — Pyrénées → Bretagne

Carte de préparation des vols inspirée de http://international.aero.free.fr/webcams/lfdt.html, étendue à tout l'Ouest :
Pyrénées, Pays basque, Landes, Gironde, Charentes, Vendée, Pays de la Loire, Bretagne.

Utilisable de deux façons :
- **Site web** (GitHub Pages) : https://cyprien64.github.io/aero-meteo-webcams-ouest/
- **Extension Chrome / Edge / Brave** : ce même dossier.

## Contenu
| Calque | Source | Mise à jour |
|---|---|---|
| METAR / TAF (manche à air VFR/MVFR/IFR/LIFR) | aviationweather.gov | extension : direct · site : toutes les 30 min |
| NOTAM en route (FIR Brest LFRR + Bordeaux LFBB, SFC–FL195, 24 h) | SOFIA-Briefing (SIA/DGAC) | toutes les 30 min |
| NOTAM d'aérodrome (fiche aérodrome + pastille orange) | SOFIA-Briefing | toutes les 30 min |
| SUP AIP Métropole (localisés d'après leur titre) | SIA | toutes les 30 min |
| Aérodromes sans METAR | OurAirports | fixe |
| Webcams d'aérodromes | cam-aero.eu + site Inter Aéro | liens |
| Webcams côte / montagne / ville | Vision-Environnement, Viewsurf, Skaping… | liens + aperçu |
| Observations | Météociel / Météo-France | liens |
| Balises vent | PiouPiou / OpenWindMap (direct), FFVL | direct |
| Radar pluie animé | RainViewer | direct |

Clic sur un point → la webcam/la station s'ouvre dans une fenêtre dédiée.
Clic sur un aérodrome → METAR/TAF décodés, NOTAM, SUP AIP proches, webcams à moins de 25 km, liens meteoblue, Windy, carte OACI, SafeSky…

## Préparation de vol (briefing PDF)
Bouton **✈️ Préparer un vol** : départ, arrivée, points tournants, dégagement, heure, avion du club, régime, altitude, masses, carburant.

Avions (repris du log de nav ACB) : DR400 Rotax 912iS (F-HAFF, F-HPYR, F-GLDS, F-GKQR), DR401 / DR400-140B CDI 155 (F-HCOY, F-HNDI),
DR400/120 2+2 (F-GSUR) — performances, consommations, enveloppes de centrage et vitesses dans `data/aircraft.js`.
Ajoutés d'après des sources publiques, **à vérifier avec le manuel de vol** (bras de levier et masses à vide à compléter) :
Jodel D112 (F-PKFC), Grob G120A (D-EPDH), Robin R3000/180 (F-HMRA).

**Log de nav Excel** : le bouton génère, en plus du PDF, le classeur du log ACB (`data/template/log_nav_acb.xlsx`)
rempli tel quel — feuille de l'avion activée, formules, mise en forme et graphiques de centrage conservés
(points, Rm, distances, alti sécu, fréquences, déroutement, masses, cases INFO départ/arrivée depuis le METAR).
Excel recalcule les temps et le carburant à l'ouverture.

La route contourne automatiquement les zones interdites (P) et, au choix, les zones RTBA actives pendant le vol (points DT1, DT2…).

Le PDF contient :
- **log de navigation** au format du log ACB : cases départ/arrivée (ATIS, piste, vent, visi, nuages, TT/TD, QNH pré-remplis depuis le METAR),
  alti sécu par branche (relief ±5 NM + 1000 ft), Rm/Cm, distance, temps, heure estimée, carburant requis, et pour chaque branche
  les espaces aériens traversés avec leur indicatif et leur fréquence (CTR/TMA/CTA : OpenAir FFVP ; SIV : eAIP ENR 2.2), déroutement ;
- masse et centrage (graphique d'enveloppe), carburant requis / autonomie, vitesses, distances de décollage estimées ;
- **briefing départ et briefing arrivée** d'après la VAC : piste probable selon le vent, composantes de vent, distances, fréquences,
  tour de piste, espaces autour, consignes de la VAC triées (départ / arrivée / générales), infos pratiques, NOTAM du terrain ;
- croquis de route avec zones P/R/D, RTBA et CTR/TMA traversées ;
- METAR/TAF des terrains et des stations le long de la route ;
- NOTAM terrains, NOTAM en route (couloir), obstacles, NOTAM de portée FIR ;
- SUP AIP près de la route ;
- AZBA : zones RTBA traversées et créneaux d'activation (NOTAM « RTBA ACT ») + zones P/R/D (eAIP ENR 5.1) ;
- fiche par terrain extraite de la VAC (altitude, pistes, tour de piste, fréquences, espaces, obstacles, carburant, consignes) ;
- les cartes VAC officielles jointes à la fin (extension Chrome ; sur le site web, liens vers les VAC car le SIA bloque le téléchargement direct).

## Navigation : points VFR, météo en route, coupe verticale, export
- **Points de report VFR** (export XML du SIA, Licence Ouverte — `data/vfr_points.json`, regénérable avec `scripts/build_vfr.py`) :
  point de sortie / d'entrée automatique ou au choix, utilisables comme points tournants (ex. `BP-N`), calque sur la carte.
- **Météo le long de la route** à l'heure de passage (Open-Meteo) : nuages bas, base estimée, visibilité, pluie, orages, rafales → avis VFR vert / orange / rouge.
- **Coupe verticale** : relief, altitude de croisière, CTR/TMA/zones traversées, conflits signalés.
- **Export** GPX (SkyDemon, Garmin…) et Garmin `.fpl` (ForeFlight, Garmin Pilot).
- **Fonds de carte** : carte OACI-VFR 1/500 000, carte de France 1/1 000 000 (SCAN 1000) et carte régionale (SCAN Régional) de l'IGN (Géoplateforme), schéma hors ligne, sombre, relief, satellite.
- **Repères toutes les 5 min de vol** (étiquette toutes les 10 min) et **cartouche par branche** (temps, cap magnétique, distance, vitesse sol), sur la carte, le croquis et une page « Carte de navigation » sur fond OACI 1/500 000 dans le PDF.
- **Coupe des espaces aériens** (bouton ✂️ ou clic droit sur la carte, bouton dans chaque fiche aérodrome) : empilement des espaces
  du sol au FL195 au-dessus d'un point, ou coupe A → B avec le relief ; pour chaque espace : classe, limites, indicatif et fréquence,
  règles de pénétration (clairance, radio, transpondeur, VMC, RMZ/TMZ, zones P/R/D, RTBA).
- **GRAMET** : coupe météo de la route à l'heure de passage (Open-Meteo, 1000 à 500 hPa) — nuages par niveau, givrage probable,
  isothermes 0 / -10 °C, vent en barbules, pluie et orages, relief et altitude de croisière ; à l'écran et en page du PDF,
  avec lien vers le GRAMET Ogimet (GFS) et vers TEMSI / WINTEM.
- **Calques** : CTR/TMA/CTA et SIV avec fréquences, zones P/R/D, RTBA actives du jour, points VFR.
- **Tablette hors ligne** : le site s'installe comme une application (« Ajouter à l'écran d'accueil ») ; le dernier briefing (PDF + Excel) reste consultable sans réseau.

## Voyage, mise à jour, montagne, vol
- **Escales / aller-retour** : champ « Escales suivantes » (ex. `LFCH LFBP`), temps d'escale, avitaillement ou non ;
  tableau du voyage (horaires, carburant à bord / consommé / restant, dernier décollage avant la nuit aéronautique),
  un PDF unique (synthèse + check-list carburant et horaires + briefing de chaque étape) et un log Excel par étape.
- **Mise à jour J-1 / J** : bouton 🔄 et comparaison automatique avec le briefing précédent (nouveaux NOTAM, AZBA, météo,
  alertes, SUP AIP, temps de vol) à l'écran et dans le PDF ; bouton 📅 pour ajouter les rappels (veille 18 h et jour J) au calendrier.
- **AZBA** : zones RTBA proches avec créneaux publiés ou non, lien SOFIA-Briefing.
- **Vol en montagne** (relief > 3 000 ft) : relief max par branche, altitude de franchissement conseillée, vent et isotherme 0 °C
  à hauteur des crêtes (GRAMET), cols proches, dégagements en vallée, règles de base.
- **Vent** interpolé à l'altitude exacte et à l'heure de passage de chaque branche.
- **Route modifiable à la souris** : glisser un point tournant, ou une poignée « + » au milieu d'une branche pour en ajouter un
  (points libres `43.2050/-0.4570` dans les points tournants).
- **Mode en vol (GPS)** sur tablette : position, branche active, cap direct, distance et heure au prochain point, écart,
  vitesse sol, fréquences en cours et suivantes, écran maintenu allumé. Aide de secours uniquement.
- **Historique** (📚) : les 25 dernières préparations (PDF, Excel) sur l'appareil, avec « Refaire ».
- **Bras de levier** saisissables par avion dans le formulaire (fiche de pesée), mémorisés sur l'appareil.
- **Taxes d'atterrissage partagées** : bouton « Proposer ce tarif au club » dans la fiche d'un aérodrome → formulaire GitHub (issue
  « taxe ») ; une fois l'étiquette **valide** ajoutée par l'administrateur, le tarif est publié à la collecte suivante (`data/live/fees_club.json`).

## Surveillance automatique
- `data/live/status.json` : état de chaque source à chaque collecte ; `scripts/health.py` fait échouer le workflow
  (→ e-mail de GitHub) si les NOTAM ou les METAR ne se mettent plus à jour.
- Contrôle hebdomadaire des webcams (`cams_status.json`) : les webcams en panne sont grisées sur la carte.
- Commit automatique de maintien pour éviter la suspension des tâches planifiées après 60 jours.

## Escale : carburant, paiement, taxe d'atterrissage
Dans la fiche de chaque aérodrome (et dans les briefings départ / arrivée du PDF) :
- **carburants disponibles et moyens de paiement**, extraits automatiquement de la VAC officielle (rubrique AVT), avec l'exploitant et son téléphone ;
- **taxe d'atterrissage** : il n'existe pas de base officielle. Elle vient du fichier `data/fees.json` (tableau du club, à compléter)
  ou d'une saisie personnelle dans la fiche (mémorisée dans le navigateur), avec des liens vers airfield.directory, aeroPS et le site de l'aérodrome.

Exemple pour `data/fees.json` :
```json
{ "aerodromes": { "LFBP": { "tarif": "15 € TTC", "note": "< 1,5 t", "maj": "2026-11", "source": "brochure tarifaire Pau" } } }
```

## Fonctionnement de la mise à jour
La GitHub Action `.github/workflows/pages.yml` lance `scripts/collect.py` toutes les 30 min, qui écrit
`data/live/{metar,taf,notam,supaip}.json` (et, une fois par cycle AIRAC, `zones.json` et `vac.json`), puis publie le site sur GitHub Pages.
(GitHub suspend les tâches planifiées d'un dépôt sans activité depuis 60 jours : il suffit alors de la relancer depuis l'onglet *Actions*.)

## Installer l'extension
1. `chrome://extensions` → activer le **Mode développeur**
2. **Charger l'extension non empaquetée** → choisir ce dossier
3. Les NOTAM / SUP AIP à jour sont lus depuis le site GitHub Pages (adresse dans `config.js`).

## Avertissement
Outil d'aide uniquement. Les NOTAM et SUP AIP sont recopiés automatiquement et la localisation des SUP AIP est déduite de leur titre :
la préparation réglementaire se fait sur SOFIA-Briefing, le site du SIA et aviation.meteo.fr. Vérifier la date et l'heure de chaque webcam.
