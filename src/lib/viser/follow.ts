import { haversineDistance, type LatLon } from '../geo';

/**
 * Suivi continu de la position (mode Viser) : décide si un relevé GPS vaut un
 * déplacement du point de vue. Chaque déplacement recharge le relief et les
 * sommets et relance le calcul de visibilité : on ne bouge que quand on a
 * vraiment bougé, pas au gré du bruit du récepteur. Module pur, testé.
 */

export interface PositionFix extends LatLon {
  /** Rayon d'incertitude annoncé par le navigateur (m). */
  accuracyM: number;
  /** Horodatage du relevé (ms). */
  timeMs: number;
}

/** En deçà, le relief n'a pas changé à l'échelle du DEM (~30 m) : on reste. */
export const MOVE_MIN_M = 30;
/** Deux déplacements ne s'enchaînent pas plus vite : le calcul doit suivre. */
export const MOVE_MIN_INTERVAL_MS = 10_000;
/** Au-delà, le relevé est trop grossier pour guider la visée (Wi-Fi, cellulaire). */
export const ACCURACY_MAX_M = 500;

/**
 * Vrai si le point de vue doit rejoindre le relevé : il en est éloigné de
 * plus que le seuil ET de plus que l'incertitude du relevé (un fix à 200 m près
 * qui « bouge » de 80 m n'a rien vu bouger), sans dépasser la cadence.
 */
export function shouldMoveViewpoint(
  current: LatLon,
  fix: PositionFix,
  lastMoveMs: number | null,
): boolean {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return false;
  if (fix.accuracyM > ACCURACY_MAX_M) return false;
  if (lastMoveMs !== null && fix.timeMs - lastMoveMs < MOVE_MIN_INTERVAL_MS) return false;
  const distance = haversineDistance(current, fix);
  return distance >= Math.max(MOVE_MIN_M, fix.accuracyM);
}
