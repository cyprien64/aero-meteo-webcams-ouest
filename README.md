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
