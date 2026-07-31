import { apparentElevationAngle, degToRad, normalizeBearing, radToDeg } from '../geo';
import { projectToScreen, type ViewGeometry } from '../labels';
import type { ElevationSampler } from '../visibility';

/**
 * Recalage automatique sur l'horizon (mode Viser) : trois briques pures.
 * 1. Profil d'horizon théorique depuis le relief (marche de rayon 360°).
 * 2. Détection de la ligne ciel→terrain dans une image caméra réduite.
 * 3. Mise en correspondance des deux profils → correction cap/assiette.
 */

/**
 * Angle d'élévation maximal du terrain (rad) pour chaque pas d'azimut,
 * depuis l'œil. Bin i = azimut i × stepDeg.
 */
export function computeDemSkyline(
  sample: ElevationSampler,
  eyeElevation: number,
  options: { stepDeg?: number; maxDistanceM?: number; stepM?: number } = {},
): Float32Array {
  const stepDeg = options.stepDeg ?? 0.5;
  const maxDistanceM = options.maxDistanceM ?? 90_000;
  const stepM = options.stepM ?? 150;
  const bins = Math.round(360 / stepDeg);
  const out = new Float32Array(bins);

  for (let i = 0; i < bins; i++) {
    const az = degToRad(i * stepDeg);
    const dirEast = Math.sin(az);
    const dirNorth = Math.cos(az);
    let best = -Infinity;
    for (let d = 300; d <= maxDistanceM; d += stepM) {
      const angle = apparentElevationAngle(d, sample(dirEast * d, dirNorth * d) - eyeElevation);
      if (angle > best) best = angle;
    }
    out[i] = best;
  }
  return out;
}

/** Horizon détecté dans l'image : ligne (px) et confiance (0..1) par colonne. */
export interface DetectedSkyline {
  rows: Float32Array;
  confidence: Float32Array;
  width: number;
  height: number;
}

/**
 * Détection sans apprentissage : le ciel est clair (lumineux et bleuté), le
 * terrain sombre. Pour chaque colonne, on choisit la coupure maximisant le
 * contraste moyenne(haut) − moyenne(bas) via des sommes préfixes ; la
 * confiance est ce contraste normalisé.
 */
export function detectImageSkyline(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): DetectedSkyline {
  const rows = new Float32Array(width);
  const confidence = new Float32Array(width);
  const score = new Float32Array(height);
  const prefix = new Float32Array(height + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const o = (y * width + x) * 4;
      const r = rgba[o]!;
      const g = rgba[o + 1]!;
      const b = rgba[o + 2]!;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      // « Cielité » : luminosité + dominante bleue.
      score[y] = (luma + b) / 2;
    }
    prefix[0] = 0;
    for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y]! + score[y]!;

    let bestRow = 0;
    let bestContrast = -Infinity;
    for (let y = 2; y <= height - 2; y++) {
      const top = prefix[y]! / y;
      const bottom = (prefix[height]! - prefix[y]!) / (height - y);
      const contrast = top - bottom; // ciel au-dessus, terrain en dessous
      if (contrast > bestContrast) {
        bestContrast = contrast;
        bestRow = y;
      }
    }
    rows[x] = bestRow;
    confidence[x] = Math.max(0, Math.min(1, bestContrast / 96));
  }
  return { rows, confidence, width, height };
}

/**
 * Projette le profil d'horizon théorique sur l'écran (mêmes conventions de
 * caméra que les étiquettes) : une liste de points gauche → droite, prête à
 * devenir une polyligne SVG. Déborde légèrement du champ pour ne pas laisser
 * de trous aux bords pendant les rotations.
 */
export function skylineScreenPoints(
  demSkyline: Float32Array,
  demStepDeg: number,
  view: ViewGeometry,
): Array<{ x: number; y: number }> {
  const tanV = Math.tan(degToRad(view.fovDeg) / 2);
  const tanH = tanV * (view.width / Math.max(1, view.height));
  const halfFovHDeg = radToDeg(Math.atan(tanH));
  const points: Array<{ x: number; y: number }> = [];

  for (
    let azRel = -halfFovHDeg - 2 * demStepDeg;
    azRel <= halfFovHDeg + 2 * demStepDeg;
    azRel += demStepDeg
  ) {
    const azimuth = view.headingDeg + azRel;
    const elevRad = degToRad(demAngleDeg(demSkyline, azimuth, demStepDeg));
    const p = projectToScreen(azimuth, elevRad, view);
    if (!p.behind) points.push({ x: p.x, y: p.y });
  }
  return points;
}

export interface SkylineView {
  headingDeg: number;
  pitchDeg: number;
  /** FOV vertical de l'image analysée (°). */
  fovDeg: number;
}

export interface SkylineMatch {
  /** À ajouter au cap courant. */
  headingOffsetDeg: number;
  /** À ajouter à l'assiette courante. */
  pitchOffsetDeg: number;
  /** FOV vertical retenu (°) — égal à `view.fovDeg` sans estimation. */
  fovDeg: number;
  /** Erreur absolue moyenne (°) au meilleur alignement. */
  maeDeg: number;
  /** Colonnes exploitées (confiance suffisante). */
  usedColumns: number;
}

/** Plage d'estimation du FOV caméra (le web ne l'expose pas : on le mesure). */
export interface FovSearch {
  minDeg?: number;
  maxDeg?: number;
  coarseStepDeg?: number;
  fineStepDeg?: number;
}

/** Direction (azimut relatif, élévation) du pixel (x, y), assiette comprise. */
export function pixelToAngles(
  x: number,
  y: number,
  width: number,
  height: number,
  pitchDeg: number,
  fovDeg: number,
): { azRelDeg: number; elevDeg: number } {
  const tanV = Math.tan(degToRad(fovDeg) / 2);
  const tanH = tanV * (width / height);
  const ndcX = (2 * (x + 0.5)) / width - 1;
  const ndcY = 1 - (2 * (y + 0.5)) / height;
  const rx = ndcX * tanH;
  const ry = ndcY * tanV;
  const p = degToRad(pitchDeg);
  // Rayon caméra (rx, ry, −1) redressé de l'assiette (rotation X d'angle p).
  const wy = ry * Math.cos(p) + Math.sin(p);
  const wz = ry * Math.sin(p) - Math.cos(p);
  const norm = Math.hypot(rx, wy, wz);
  return {
    azRelDeg: radToDeg(Math.atan2(rx, -wz)),
    elevDeg: radToDeg(Math.asin(wy / norm)),
  };
}

/** Lecture interpolée du profil théorique (rad → °), azimut bouclé. */
function demAngleDeg(skyline: Float32Array, azimuthDeg: number, stepDeg: number): number {
  const pos = normalizeBearing(azimuthDeg) / stepDeg;
  const i = Math.floor(pos) % skyline.length;
  const j = (i + 1) % skyline.length;
  const t = pos - Math.floor(pos);
  return radToDeg(skyline[i]! * (1 - t) + skyline[j]! * t);
}

/**
 * Cherche la correction (cap, assiette) qui aligne l'horizon détecté sur le
 * profil théorique. Retourne null si trop peu de colonnes sont exploitables.
 */
export function matchSkyline(
  detected: DetectedSkyline,
  view: SkylineView,
  demSkyline: Float32Array,
  options: {
    demStepDeg?: number;
    searchDeg?: number;
    pitchSearchDeg?: number;
    minConfidence?: number;
    /** Si présent, le FOV est estimé en plus du cap et de l'assiette. */
    fovSearch?: FovSearch;
  } = {},
): SkylineMatch | null {
  const demStepDeg = options.demStepDeg ?? 0.5;
  const searchDeg = options.searchDeg ?? 25;
  // Les biais d'assiette constatés sur le terrain dépassent parfois 4-5°
  // (calibration accéléromètre + fusion navigateur) : fenêtre à ±8°.
  const pitchSearchDeg = options.pitchSearchDeg ?? 8;
  const minConfidence = options.minConfidence ?? 0.35;

  const columns: number[] = [];
  for (let x = 0; x < detected.width; x++) {
    if (detected.confidence[x]! >= minConfidence) columns.push(x);
  }
  if (columns.length < detected.width * 0.25) return null;

  // Les angles des colonnes dépendent du FOV testé : tout est recalculé par candidat.
  const evaluate = (fovDeg: number): { match: SkylineMatch; cost: number } => {
    const samples = columns.map((x) =>
      pixelToAngles(x, detected.rows[x]!, detected.width, detected.height, view.pitchDeg, fovDeg),
    );
    let match: SkylineMatch = {
      headingOffsetDeg: 0,
      pitchOffsetDeg: 0,
      fovDeg,
      maeDeg: Infinity,
      usedColumns: samples.length,
    };
    let bestCost = Infinity;
    for (let hOff = -searchDeg; hOff <= searchDeg; hOff += 0.25) {
      for (let pOff = -pitchSearchDeg; pOff <= pitchSearchDeg; pOff += 0.5) {
        let sum = 0;
        for (const s of samples) {
          const expected = demAngleDeg(demSkyline, view.headingDeg + hOff + s.azRelDeg, demStepDeg);
          sum += Math.abs(expected - (s.elevDeg + pOff));
        }
        const mae = sum / samples.length;
        // Un horizon localement rectiligne rend cap et assiette interchangeables :
        // on départage en préférant l'assiette des capteurs (pénalité sur pOff).
        // Et sur un horizon PLAT le cap est indéterminé : la pénalité minuscule
        // sur hOff casse l'égalité vers « pas de correction de cap » au lieu du
        // premier candidat de la grille (−25°).
        const cost = mae + 0.05 * Math.abs(pOff) + 0.001 * Math.abs(hOff);
        if (cost < bestCost) {
          bestCost = cost;
          match = {
            headingOffsetDeg: hOff,
            pitchOffsetDeg: pOff,
            fovDeg,
            maeDeg: mae,
            usedColumns: samples.length,
          };
        }
      }
    }
    return { match, cost: bestCost };
  };

  if (!options.fovSearch) return evaluate(view.fovDeg).match;

  // Estimation du FOV : balayage grossier puis fin, avec un a priori doux vers
  // le FOV courant (un horizon plat ne contraint pas l'optique : on n'en change
  // alors pas sans raison).
  const minDeg = options.fovSearch.minDeg ?? 40;
  const maxDeg = options.fovSearch.maxDeg ?? 80;
  const coarse = options.fovSearch.coarseStepDeg ?? 4;
  const fine = options.fovSearch.fineStepDeg ?? 1;

  let bestOverall: { match: SkylineMatch; cost: number } | null = null;
  const consider = (fovDeg: number) => {
    const r = evaluate(fovDeg);
    // A priori très doux : la surface de coût est plate en FOV (le cap absorbe
    // une partie de la compression) — il départage sans jamais dominer l'écart
    // réel mesuré (~0,005°/° de FOV sur un horizon net).
    const cost = r.cost + 0.002 * Math.abs(fovDeg - view.fovDeg);
    if (!bestOverall || cost < bestOverall.cost) bestOverall = { match: r.match, cost };
  };

  for (let f = minDeg; f <= maxDeg; f += coarse) consider(f);
  const center = bestOverall!.match.fovDeg;
  for (
    let f = Math.max(minDeg, center - coarse);
    f <= Math.min(maxDeg, center + coarse);
    f += fine
  ) {
    consider(f);
  }
  return bestOverall!.match;
}
