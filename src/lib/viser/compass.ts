import { degToRad, normalizeBearing, radToDeg } from '../geo';
import { projectToScreen, type ViewGeometry } from '../labels';

/**
 * Ruban de boussole du mode Viser : graduations d'azimut projetées sur la
 * largeur de l'écran avec la même caméra que les étiquettes (tangente du FOV
 * horizontal), pour que « N » tombe exactement sous les sommets plein nord.
 * L'assiette est ignorée : le ruban est un affichage tête haute, il ne bouge
 * pas quand on vise le sol ou le ciel. Module pur, testé — le composant
 * Svelte ne fait qu'afficher.
 */

/** Pas des graduations fines (°). */
export const TICK_STEP_DEG = 5;
/** Graduations hautes (°). */
const MAJOR_STEP_DEG = 15;
/** Points cardinaux et intercardinaux (°) : une lettre est affichée. */
const CARDINAL_STEP_DEG = 45;

export interface CompassTick {
  /** Azimut de la graduation (°, [0, 360), multiple du pas). */
  azimuthDeg: number;
  /** Abscisse écran (px). */
  x: number;
  /** Graduation haute (multiple de 15°). */
  major: boolean;
  /** Point cardinal (multiple de 45°) : porte sa lettre. */
  cardinal: boolean;
}

/** Demi-champ de vision horizontal (°) — même convention que la projection des étiquettes. */
export function halfHorizontalFovDeg(view: ViewGeometry): number {
  const aspect = view.width / Math.max(1, view.height);
  return radToDeg(Math.atan(Math.tan(degToRad(view.fovDeg) / 2) * aspect));
}

/** Graduations visibles du ruban, de gauche à droite, pour la vue donnée. */
export function compassTicks(view: ViewGeometry): CompassTick[] {
  const half = halfHorizontalFovDeg(view);
  const flat: ViewGeometry = { ...view, pitchDeg: 0 };
  const first = Math.ceil((view.headingDeg - half) / TICK_STEP_DEG) * TICK_STEP_DEG;
  const last = Math.floor((view.headingDeg + half) / TICK_STEP_DEG) * TICK_STEP_DEG;

  const ticks: CompassTick[] = [];
  for (let raw = first; raw <= last; raw += TICK_STEP_DEG) {
    const azimuthDeg = normalizeBearing(raw);
    const point = projectToScreen(azimuthDeg, 0, flat);
    if (point.behind) continue;
    ticks.push({
      azimuthDeg,
      x: point.x,
      major: azimuthDeg % MAJOR_STEP_DEG === 0,
      cardinal: azimuthDeg % CARDINAL_STEP_DEG === 0,
    });
  }
  return ticks;
}
