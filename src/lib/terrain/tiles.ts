/**
 * Maths des tuiles « slippy map » (grille WebMercator/XYZ) utilisées par les
 * AWS Terrain Tiles. Aucune E/S ici : le chargement réseau vit dans loader.ts.
 */

/** Côté d'une tuile terrarium, en pixels. */
export const TILE_SIZE = 256;

/** Rayon de la sphère WebMercator (m) — convention des tuiles XYZ, distinct du rayon moyen. */
export const WEB_MERCATOR_RADIUS_M = 6_378_137;

/** Latitude maximale représentable en WebMercator. */
export const MAX_MERCATOR_LAT = 85.05112878;

/** Gabarit d'URL des tuiles d'élévation terrarium, au format MapLibre. */
export const TERRARIUM_TILE_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** URL d'une tuile d'élévation terrarium (AWS Terrain Tiles, sans clé). */
export function terrariumTileUrl(z: number, x: number, y: number): string {
  return TERRARIUM_TILE_TEMPLATE.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/** Abscisse de tuile (fractionnaire) pour une longitude au zoom donné. */
export function lonToTileX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom;
}

/** Ordonnée de tuile (fractionnaire) pour une latitude au zoom donné. */
export function latToTileY(lat: number, zoom: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const phi = (clamped * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * 2 ** zoom;
}

/** Longitude du bord ouest de la colonne de tuiles `x` (accepte les fractions). */
export function tileXToLon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

/** Latitude du bord nord de la ligne de tuiles `y` (accepte les fractions). */
export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** zoom);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Résolution sol (m/pixel) d'une tuile à cette latitude et ce zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  const phi = (lat * Math.PI) / 180;
  return (2 * Math.PI * WEB_MERCATOR_RADIUS_M * Math.cos(phi)) / (TILE_SIZE * 2 ** zoom);
}
