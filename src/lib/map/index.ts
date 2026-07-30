import { metersPerPixel } from '../terrain/tiles';

/**
 * Aides pures du mode carte : quel rayon de recherche de sommets pour la vue
 * courante, arrondi pour que le cache IndexedDB soit réutilisé entre deux
 * déplacements voisins.
 */

/** Rayon (m) couvrant la demi-diagonale du viewport à ce zoom/latitude. */
export function visibleRadiusM(
  lat: number,
  zoom: number,
  widthPx: number,
  heightPx: number,
): number {
  return (metersPerPixel(lat, zoom) * Math.hypot(widthPx, heightPx)) / 2;
}

/** Arrondit un rayon au pas donné (5 km par défaut), plancher d'un pas. */
export function roundRadiusM(radiusM: number, stepM = 5_000): number {
  return Math.max(stepM, Math.round(radiusM / stepM) * stepM);
}
