# Collecte toutes les 15 minutes : déclenchement externe

GitHub ne garantit pas les tâches planifiées : en pratique la collecte (NOTAM, SUP AIP) tourne parfois
toutes les 5 à 10 heures seulement. Un service gratuit de tâches planifiées peut la déclencher à l'heure.

Les METAR / TAF ne sont pas concernés : le site les lit déjà en direct.

## 1. Créer un jeton GitHub limité à ce dépôt (5 min)
1. GitHub → photo de profil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Nom : `declenchement collecte` · Expiration : 1 an (penser à le renouveler).
3. **Repository access** : *Only select repositories* → `aero-meteo-webcams-ouest`.
4. **Permissions** → *Repository permissions* → **Actions : Read and write** (rien d'autre).
5. Générer et copier le jeton (il commence par `github_pat_`). Ne le donner à personne, ne pas le mettre dans le dépôt.

Ce jeton permet seulement de lancer / annuler les workflows de ce dépôt : il ne donne accès ni au code ni au compte.

## 2. Créer la tâche sur cron-job.org (gratuit)
1. Créer un compte sur https://cron-job.org puis **Create cronjob**.
2. **URL** : `https://api.github.com/repos/cyprien64/aero-meteo-webcams-ouest/actions/workflows/pages.yml/dispatches`
3. **Execution schedule** : *Every 15 minutes*.
4. Onglet **Advanced** :
   - **Request method** : `POST`
   - **Headers** :
     - `Accept: application/vnd.github+json`
     - `Authorization: Bearer <le jeton>`
     - `X-GitHub-Api-Version: 2022-11-28`
     - `User-Agent: cron-job`
   - **Request body** : `{"ref":"main"}`
5. Enregistrer, puis **Test run** : la réponse attendue est **204**. Dans l'onglet *Actions* du dépôt, une exécution « workflow_dispatch » apparaît.

## Vérifier
Sur le site, la ligne d'état sous la légende indique « collecte il y a … min ». Elle ne doit plus dépasser 20–30 min.
Si cron-job.org renvoie 401 ou 403 : le jeton a expiré ou n'a pas la permission *Actions : Read and write*.
