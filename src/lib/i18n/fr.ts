/**
 * Chaînes de l'interface, centralisées ici (décision n° 9 du PLAN.md) :
 * le français est la seule langue de la v1, mais tout passe par ce module
 * pour qu'une traduction future soit une simple substitution de table.
 */
export const fr = {
  appName: 'Cimes',
  tagline: 'Identifiez les sommets autour de vous',
  panorama: {
    loadingTerrain: 'Chargement du relief…',
    loadError: 'Impossible de charger le relief. Vérifiez la connexion puis réessayez.',
    retry: 'Réessayer',
  },
  peaks: {
    searching: 'Recherche des sommets…',
    unavailable: 'Sommets indisponibles (Overpass ne répond pas)',
    retry: 'Réessayer',
    none: 'Aucun sommet nommé à moins de 75 km',
    noneVisible: 'Aucun sommet visible depuis ce point de vue',
  },
  search: {
    placeholder: 'Rechercher un lieu…',
    locate: 'Me géolocaliser',
    noResults: 'Aucun résultat',
    error: 'Recherche indisponible pour le moment',
    geolocError: 'Position introuvable — vérifiez les autorisations',
  },
  peakCard: {
    elevation: 'Altitude',
    distance: 'Distance',
    close: 'Fermer',
  },
  modes: {
    panorama: 'Panorama',
    map: 'Carte',
    viser: 'Viser',
  },
  viser: {
    intro:
      'Pointez votre téléphone vers la montagne : Cimes superpose les noms des sommets visibles sur l’image de la caméra. Autorisez la caméra et les capteurs de mouvement.',
    start: 'Activer caméra et capteurs',
    cameraError: 'Caméra ou capteurs refusés — vérifiez les autorisations du navigateur.',
    calibrateHint: 'Décalé ? Glissez pour recaler (↔ cap, ↕ hauteur)',
    dragHint: 'Capteurs indisponibles : glissez pour viser',
    calibrateAuto: 'Recaler sur l’horizon',
    horizonLocked: 'Horizon calé',
    horizonNotFound: 'Horizon introuvable — recalez à la main',
  },
  settings: {
    title: 'Réglages',
    quality: 'Qualité de rendu',
    qualityAuto: 'Auto',
    qualityHigh: 'Élevée',
    qualityEco: 'Économique',
    units: 'Unités',
    unitsMetric: 'Mètres (m, km)',
    unitsImperial: 'Pieds (ft, mi)',
    names: 'Noms des sommets',
    namesFr: 'Français si disponible',
    namesLocal: 'Nom local',
    install: 'Installer l’app',
    installIosHint:
      'Dans Safari : bouton Partager, puis « Sur l’écran d’accueil ». Cimes se lance alors en plein écran, hors-ligne compris.',
    debug: 'Débogage',
    copyReport: 'Copier le rapport de débogage',
    reportCopied: 'Rapport copié — collez-le dans la conversation avec Claude',
    reportFailed: 'Copie impossible — sélectionnez le texte ci-dessous',
  },
  map: {
    panoramaHere: 'Panorama ici',
    seePanorama: 'Voir le panorama d’ici',
  },
  attributions: {
    intro: 'Données :',
    osm: '© contributeurs OpenStreetMap',
    terrain: 'Tuiles d’élévation AWS/Mapzen',
    basemap: 'Fond de carte OpenFreeMap',
  },
} as const;

/** Points cardinaux (8 secteurs) pour l'affichage du cap. */
export const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

/** Nom du secteur cardinal du cap donné (degrés). */
export function cardinalFor(headingDeg: number): string {
  const index = Math.round((((headingDeg % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[index]!;
}
