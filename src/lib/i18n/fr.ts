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
