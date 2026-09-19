import { degToRad, normalizeBearing, radToDeg, signedDeltaDeg } from '../geo';
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

/**
 * Seuil d'affichage du ruban brut (°) : en deçà, le recalage ne déplacerait
 * pas le ruban d'un pixel visible — deux rubans identiques n'apprendraient
 * rien.
 */
export const RAW_BAND_MIN_OFFSET_DEG = 0.5;

export interface CompassBands {
  /** Ruban aligné sur les repères à l'écran (cap recalé). */
  aimed: CompassTick[];
  /** Même ruban au cap des capteurs seuls ; vide si le recalage est négligeable. */
  raw: CompassTick[];
  /** Cap affiché (°) : celui des étiquettes et de l'horizon. */
  headingDeg: number;
  /** Cap des capteurs avant recalage (°). */
  rawHeadingDeg: number;
  /** Recalage appliqué (°, arc court signé) : `headingDeg = rawHeadingDeg + offset`. */
  offsetDeg: number;
}

/**
 * Les deux rubans du mode Viser : celui du cap recalé (le seul qui soit
 * d'accord avec les étiquettes) et celui du cap brut des capteurs, pour lire
 * d'un coup d'œil de combien la boussole du téléphone est à côté.
 * `view.headingDeg` est le cap DÉJÀ recalé, `headingOffsetDeg` ce qui lui a
 * été ajouté (glissé du doigt et/ou recalage sur l'horizon).
 */
export function compassBands(view: ViewGeometry, headingOffsetDeg: number): CompassBands {
  const offsetDeg = signedDeltaDeg(headingOffsetDeg);
  const rawHeadingDeg = normalizeBearing(view.headingDeg - offsetDeg);
  return {
    aimed: compassTicks(view),
    raw:
      Math.abs(offsetDeg) < RAW_BAND_MIN_OFFSET_DEG
        ? []
        : compassTicks({ ...view, headingDeg: rawHeadingDeg }),
    headingDeg: normalizeBearing(view.headingDeg),
    rawHeadingDeg,
    offsetDeg,
  };
}
