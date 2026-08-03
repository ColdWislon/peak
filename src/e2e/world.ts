import {
  destinationPoint,
  EFFECTIVE_EARTH_RADIUS_M,
  haversineDistance,
  type LatLon,
} from '../lib/geo';
import { encodeTerrarium } from '../lib/terrain/terrarium';
import { TILE_SIZE, tileXToLon, tileYToLat } from '../lib/terrain/tiles';
import { encodeRgbPng } from './png';

/**
 * Monde synthétique des tests de bout en bout : un relief analytique défini en
 * lat/lon (bosses gaussiennes), la même fonction servant à générer les tuiles
 * terrarium factices ET la silhouette de référence exacte (grand cercle sur
 * Terre à rayon effectif). Tout écart app ↔ référence est donc un défaut de la
 * chaîne, jamais une divergence de données.
 */

export const WORLD_VIEWPOINT: LatLon = { lat: 45.9237, lon: 6.8694 };
/** Altitude de la plaine (m) — le point de vue est en terrain quasi plat. */
export const WORLD_BASE_M = 200;

export interface WorldRidge {
  bearingDeg: number;
  distanceM: number;
  heightM: number;
  sigmaM: number;
}

/** Crêtes visibles cap 90° (± demi-champ ~18°) : trois bosses nettes étagées
 *  et un fond lointain large — assez de structure pour verrouiller le cap. */
export const WORLD_RIDGES: WorldRidge[] = [
  { bearingDeg: 78, distanceM: 30_000, heightM: 2200, sigmaM: 2_000 },
  { bearingDeg: 95, distanceM: 45_000, heightM: 4000, sigmaM: 2_500 },
  { bearingDeg: 104, distanceM: 22_000, heightM: 1600, sigmaM: 1_500 },
  { bearingDeg: 90, distanceM: 85_000, heightM: 2800, sigmaM: 15_000 },
];

const centers = WORLD_RIDGES.map((ridge) => ({
  ...ridge,
  center: destinationPoint(WORLD_VIEWPOINT, ridge.bearingDeg, ridge.distanceM),
}));

/** Altitude du monde synthétique (m) au point demandé. */
export function worldElevation(p: LatLon): number {
  let elevation = WORLD_BASE_M;
  for (const ridge of centers) {
    const d = haversineDistance(ridge.center, p);
    elevation += ridge.heightM * Math.exp(-(d * d) / (2 * ridge.sigmaM * ridge.sigmaM));
  }
  return elevation;
}

/** Altitude de l'œil dans le monde synthétique (sol + 1,7 m, comme le Viser). */
export function worldEyeElevation(): number {
  return worldElevation(WORLD_VIEWPOINT) + 1.7;
}

/**
 * Silhouette de référence exacte : angle d'élévation maximal (°) du terrain
 * le long du grand cercle de cap initial `bearingDeg`, formule sphérique
 * exacte sur le rayon effectif (réfraction standard), pas de 50 m.
 */
export function exactSkylineDeg(bearingDeg: number, maxDistanceM = 95_000): number {
  const R = EFFECTIVE_EARTH_RADIUS_M;
  const eye = worldEyeElevation();
  let best = -Infinity;
  for (let s = 50; s <= maxDistanceM; s += 50) {
    const p = destinationPoint(WORLD_VIEWPOINT, bearingDeg, s);
    const h = worldElevation(p);
    const a = s / R;
    const angle = Math.atan2((R + h) * Math.cos(a) - (R + eye), (R + h) * Math.sin(a));
    if (angle > best) best = angle;
  }
  return (best * 180) / Math.PI;
}

export interface ReferenceSkyline {
  startDeg: number;
  stepDeg: number;
  /** Élévations (°) de startDeg à endDeg inclus. */
  elevDeg: number[];
}

/** Table de silhouette (°) prête à être injectée dans la page du test. */
export function referenceSkyline(
  startDeg: number,
  endDeg: number,
  stepDeg: number,
): ReferenceSkyline {
  const elevDeg: number[] = [];
  for (let az = startDeg; az <= endDeg + 1e-9; az += stepDeg) {
    elevDeg.push(exactSkylineDeg(az));
  }
  return { startDeg, stepDeg, elevDeg };
}

const tileCache = new Map<string, Buffer>();

/** Tuile terrarium PNG du monde synthétique (échantillonnée aux centres de pixels). */
export function worldTilePng(z: number, x: number, y: number): Buffer {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;

  const rgb = new Uint8Array(TILE_SIZE * TILE_SIZE * 3);
  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = tileYToLat(y + (py + 0.5) / TILE_SIZE, z);
    for (let px = 0; px < TILE_SIZE; px++) {
      const lon = tileXToLon(x + (px + 0.5) / TILE_SIZE, z);
      const { r, g, b } = encodeTerrarium(worldElevation({ lat, lon }));
      const o = (py * TILE_SIZE + px) * 3;
      rgb[o] = r;
      rgb[o + 1] = g;
      rgb[o + 2] = b;
    }
  }
  const png = encodeRgbPng(TILE_SIZE, TILE_SIZE, rgb);
  tileCache.set(key, png);
  return png;
}

/** Le sommet étiqueté du monde : la grande crête du cap 95°. */
export const WORLD_PEAK = {
  id: 424242,
  name: 'Pointe de la Revue',
  position: centers[1]!.center,
  elevation: Math.round(worldElevation(centers[1]!.center)),
};

/** Réponse Overpass factice : le sommet étiqueté, au format `out:json`. */
export function worldOverpassJson(): string {
  return JSON.stringify({
    elements: [
      {
        type: 'node',
        id: WORLD_PEAK.id,
        lat: WORLD_PEAK.position.lat,
        lon: WORLD_PEAK.position.lon,
        tags: { natural: 'peak', name: WORLD_PEAK.name, ele: String(WORLD_PEAK.elevation) },
      },
    ],
  });
}
