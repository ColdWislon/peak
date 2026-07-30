/**
 * Chaînes de l'interface, centralisées ici (décision n° 9 du PLAN.md) :
 * le français est la seule langue de la v1, mais tout passe par ce module
 * pour qu'une traduction future soit une simple substitution de table.
 */
export const fr = {
  appName: 'Cimes',
  tagline: 'Identifiez les sommets autour de vous',
  underConstruction: 'Panorama 3D en construction — phase 1 du plan.',
  attributions: {
    intro: 'Données :',
    osm: '© contributeurs OpenStreetMap',
    terrain: 'Tuiles d’élévation AWS/Mapzen',
    basemap: 'Fond de carte OpenFreeMap',
  },
} as const;
