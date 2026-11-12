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

## Fonctionnement de la mise à jour
La GitHub Action `.github/workflows/pages.yml` lance `scripts/collect.py` toutes les 30 min, qui écrit
`data/live/{metar,taf,notam,supaip}.json`, puis publie le site sur GitHub Pages.
(GitHub suspend les tâches planifiées d'un dépôt sans activité depuis 60 jours : il suffit alors de la relancer depuis l'onglet *Actions*.)

## Installer l'extension
1. `chrome://extensions` → activer le **Mode développeur**
2. **Charger l'extension non empaquetée** → choisir ce dossier
3. Les NOTAM / SUP AIP à jour sont lus depuis le site GitHub Pages (adresse dans `config.js`).

## Avertissement
Outil d'aide uniquement. Les NOTAM et SUP AIP sont recopiés automatiquement et la localisation des SUP AIP est déduite de leur titre :
la préparation réglementaire se fait sur SOFIA-Briefing, le site du SIA et aviation.meteo.fr. Vérifier la date et l'heure de chaque webcam.
