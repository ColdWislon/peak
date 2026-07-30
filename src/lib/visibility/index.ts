import { apparentElevationAngle } from '../geo';

/** Altitude du terrain (m) aux coordonnées locales est/nord (m). */
export type ElevationSampler = (east: number, north: number) => number;

export interface VisibilityOptions {
  /** Altitude de l'œil (m). */
  eyeElevation: number;
  /** Pas de marche le long du rayon (m). */
  stepM?: number;
  /**
   * Marge soustraite au terrain occultant (m) : absorbe le bruit du DEM (~30 m)
   * et le lissage des crêtes, quitte à montrer un sommet à peine caché.
   */
  toleranceM?: number;
}

/** En deçà de cette distance, un sommet est toujours considéré visible. */
const ALWAYS_VISIBLE_M = 500;

/**
 * Ligne de vue par marche de rayon : la cible (est, nord, altitude) est-elle
 * visible depuis l'œil placé à l'origine ? On compare, à chaque pas, l'angle
 * d'élévation apparent du terrain (courbure/réfraction comprises) à celui de
 * la cible ; le premier échantillon qui dépasse masque la cible.
 */
export function isVisible(
  sample: ElevationSampler,
  east: number,
  north: number,
  targetElevation: number,
  options: VisibilityOptions,
): boolean {
  const { eyeElevation, stepM = 120, toleranceM = 30 } = options;

  const distance = Math.hypot(east, north);
  if (distance <= ALWAYS_VISIBLE_M) return true;

  const targetAngle = apparentElevationAngle(distance, targetElevation - eyeElevation);
  const dirEast = east / distance;
  const dirNorth = north / distance;

  // On ne teste ni le relief sous l'œil ni la butte terminale : c'est la cible.
  const last = distance - stepM;
  for (let d = stepM; d < last; d += stepM) {
    const terrain = sample(dirEast * d, dirNorth * d);
    const terrainAngle = apparentElevationAngle(d, terrain - toleranceM - eyeElevation);
    if (terrainAngle > targetAngle) return false;
  }
  return true;
}
