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
  /** Erreur absolue moyenne (°) au meilleur alignement. */
  maeDeg: number;
  /** Colonnes exploitées (confiance suffisante). */
  usedColumns: number;
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
  } = {},
): SkylineMatch | null {
  const demStepDeg = options.demStepDeg ?? 0.5;
  const searchDeg = options.searchDeg ?? 25;
  // L'assiette des capteurs (gravité) est fiable à ~±2° : fenêtre courte.
  const pitchSearchDeg = options.pitchSearchDeg ?? 4;
  const minConfidence = options.minConfidence ?? 0.35;

  const samples: Array<{ azRelDeg: number; elevDeg: number }> = [];
  for (let x = 0; x < detected.width; x++) {
    if (detected.confidence[x]! < minConfidence) continue;
    samples.push(
      pixelToAngles(
        x,
        detected.rows[x]!,
        detected.width,
        detected.height,
        view.pitchDeg,
        view.fovDeg,
      ),
    );
  }
  if (samples.length < detected.width * 0.25) return null;

  let best: SkylineMatch | null = null;
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
      const cost = mae + 0.05 * Math.abs(pOff);
      if (cost < bestCost) {
        bestCost = cost;
        best = {
          headingOffsetDeg: hOff,
          pitchOffsetDeg: pOff,
          maeDeg: mae,
          usedColumns: samples.length,
        };
      }
    }
  }
  return best;
}
