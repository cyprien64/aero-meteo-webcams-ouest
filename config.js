// Adresse du site GitHub Pages qui publie data/live/ (NOTAM, SUP AIP, METAR) toutes les 30 min.
// Utilisée par l'extension Chrome pour avoir des NOTAM / SUP AIP à jour.
window.AWW_CONFIG = {
  liveUrl: 'https://cyprien64.github.io/aero-meteo-webcams-ouest/',
  // Adresse e-mail qui reçoit « Signaler un problème » et les propositions (taxes, vie pratique).
  // Vide : le bouton télécharge seulement le journal, à envoyer à la personne qui a partagé le site.
  contact: 'cyprien64@orange.fr',
  // Clé Géoplateforme (IGN) pour la carte OACI-VFR : vide = clé publique des démonstrations IGN (peut changer sans prévenir).
  // Clé gratuite propre au site : à demander sur le portail Géoplateforme de l'IGN (cartes.gouv.fr, à vérifier).
  ignKey: '',
};
