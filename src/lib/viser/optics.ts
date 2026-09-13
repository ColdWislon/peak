/**
 * Optique de la caméra : lissage du FOV mesuré par les recalages successifs.
 *
 * Sur une crête peu accidentée, la mise en correspondance confond une erreur
 * de FOV et une erreur de cap (étirer ou décaler une ligne presque droite
 * laisse le même résidu) : une mesure isolée flotte de plusieurs degrés
 * (rapport terrain n° 10 : 41,4°, 46,0°, 51,5°, 53,5° pour le même capteur).
 * On garde donc un historique de mesures pondérées par ce qu'elles valent —
 * amplitude de la crête et qualité de l'alignement — et l'optique en usage est
 * leur médiane pondérée : une mesure aberrante ne la tire pas. Module pur, testé.
 */

export interface FovSample {
  /** FOV du petit côté du capteur mesuré (°). */
  fovDeg: number;
  /** Poids dans ]0, 1] : ce que cette mesure vaut. */
  weight: number;
}

/** Mesures conservées : au-delà, les plus anciennes s'effacent. */
export const MAX_FOV_SAMPLES = 8;
/** Amplitude de crête (°) en deçà de laquelle le FOV n'est pas mesurable. */
export const FOV_MIN_SPREAD_DEG = 3;
/** Amplitude (°) à partir de laquelle une mesure vaut son plein poids. */
const FOV_FULL_SPREAD_DEG = 10;
/** Alignement (MAE, °) au-delà duquel une mesure ne vaut plus rien. */
const FOV_MAE_CEILING_DEG = 1.5;

/**
 * Poids d'une mesure : proportionnel à l'amplitude verticale de la crête
 * détectée (une ligne plate ne contraint pas l'échelle) et dégressif avec le
 * résidu de l'alignement. Toujours strictement positif pour une mesure adoptée.
 */
export function fovSampleWeight(spreadDeg: number, maeDeg: number): number {
  const spread = Math.min(1, Math.max(0.1, spreadDeg / FOV_FULL_SPREAD_DEG));
  const fit = Math.min(1, Math.max(0.1, 1 - maeDeg / FOV_MAE_CEILING_DEG));
  return Number((spread * fit).toFixed(3));
}

/** Ajoute une mesure en fin d'historique, borné aux plus récentes. */
export function addFovSample(samples: readonly FovSample[], sample: FovSample): FovSample[] {
  return [...samples, sample].slice(-MAX_FOV_SAMPLES);
}

/** Médiane pondérée des mesures (°), null sans mesure. */
export function smoothedFovDeg(samples: readonly FovSample[]): number | null {
  const valid = samples.filter((s) => Number.isFinite(s.fovDeg) && s.weight > 0);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.fovDeg - b.fovDeg);
  const total = sorted.reduce((sum, s) => sum + s.weight, 0);
  let acc = 0;
  for (const sample of sorted) {
    acc += sample.weight;
    if (acc >= total / 2) return sample.fovDeg;
  }
  return sorted[sorted.length - 1]!.fovDeg;
}
