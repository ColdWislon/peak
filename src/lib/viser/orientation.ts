import { degToRad, normalizeBearing, radToDeg } from '../geo';

/**
 * Conversion de l'orientation de l'appareil (DeviceOrientationEvent, angles
 * intrinsèques Z-X'-Y'' du W3C) vers la direction visée par la caméra arrière.
 * Module pur, testé — le composant Viser ne fait que brancher les événements.
 */

export interface AimAngles {
  /** Cap visé (°, 0 = nord, 90 = est). */
  headingDeg: number;
  /** Assiette (° au-dessus de l'horizon, négatif vers le sol). */
  pitchDeg: number;
}

/**
 * Direction de la caméra arrière (−z de l'appareil) exprimée en cap/assiette.
 * Repère monde : X = est, Y = nord, Z = zénith ; R = Rz(α)·Rx(β)·Ry(γ).
 */
export function orientationToAim(alphaDeg: number, betaDeg: number, gammaDeg: number): AimAngles {
  const a = degToRad(alphaDeg);
  const b = degToRad(betaDeg);
  const g = degToRad(gammaDeg);

  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);

  // Troisième colonne de R (axe z de l'appareil dans le monde), négée :
  const east = -(ca * sg + sa * sb * cg);
  const north = -(sa * sg - ca * sb * cg);
  const up = -(cb * cg);

  return {
    headingDeg: normalizeBearing(radToDeg(Math.atan2(east, north))),
    pitchDeg: radToDeg(Math.asin(Math.max(-1, Math.min(1, up)))),
  };
}

/**
 * iOS ne fournit pas d'alpha absolu mais `webkitCompassHeading` (cap du haut
 * de l'appareil, horaire) : équivalent d'un alpha absolu inversé.
 */
export function iosCompassToAlpha(webkitCompassHeading: number): number {
  return normalizeBearing(360 - webkitCompassHeading);
}
