import {
  apparentElevationAngle,
  degToRad,
  EFFECTIVE_EARTH_RADIUS_M,
  normalizeBearing,
  radToDeg,
} from '../geo';
import { projectToScreen, type ViewGeometry } from '../labels';
import type { ElevationSampler } from '../visibility';

/**
 * Recalage automatique sur l'horizon (mode Viser) : trois briques pures.
 * 1. Profil d'horizon théorique depuis le relief (marche de rayon 360°).
 * 2. Détection de la ligne ciel→terrain dans une image caméra réduite.
 * 3. Mise en correspondance des deux profils → correction cap/assiette.
 */

/** Distance (m) où commence la marche : le relief sous l'œil n'est pas testé. */
const RAY_START_M = 300;
/**
 * Pas de marche relatif à la distance : un sommet de crête manqué de Δd le long
 * du rayon, sur une pente de ~35°, fausse l'angle d'horizon de ~0,7·Δd/d — ce
 * ratio borne cette erreur à ~0,1°. Le pas est donc fin au premier plan (là où
 * les crêtes proches dominent l'horizon et où un pas fixe de 150 m rabotait
 * jusqu'à 1° de relief) et s'élargit avec la distance sans perte angulaire.
 */
const RAY_STEP_RATIO = 0.0025;

/**
 * Angle d'élévation maximal du terrain (rad) pour chaque pas d'azimut,
 * depuis l'œil. Bin i = azimut i × stepDeg.
 *
 * `maxElevationM` (plafond du relief chargé) permet de couper chaque rayon dès
 * qu'aucun terrain au-delà ne peut plus dépasser l'horizon déjà trouvé — en
 * montagne, la marche s'arrête en général à quelques dizaines de kilomètres.
 */
export function computeDemSkyline(
  sample: ElevationSampler,
  eyeElevation: number,
  options: {
    stepDeg?: number;
    maxDistanceM?: number;
    /** Pas de marche minimal (m), au premier plan. */
    stepM?: number;
    /** Altitude maximale du relief échantillonnable (m), si connue. */
    maxElevationM?: number;
  } = {},
): Float32Array {
  const stepDeg = options.stepDeg ?? 0.5;
  const maxDistanceM = options.maxDistanceM ?? 90_000;
  const minStepM = options.stepM ?? 30;
  const bins = Math.round(360 / stepDeg);
  const out = new Float32Array(bins);
  const ceiling =
    options.maxElevationM === undefined
      ? null
      : skylineCeiling(options.maxElevationM - eyeElevation, maxDistanceM);

  for (let i = 0; i < bins; i++) {
    const az = degToRad(i * stepDeg);
    const dirEast = Math.sin(az);
    const dirNorth = Math.cos(az);
    let best = -Infinity;
    for (let d = RAY_START_M; d <= maxDistanceM; d += Math.max(minStepM, d * RAY_STEP_RATIO)) {
      const angle = apparentElevationAngle(d, sample(dirEast * d, dirNorth * d) - eyeElevation);
      if (angle > best) best = angle;
      if (ceiling !== null && ceiling(d) <= best) break;
    }
    out[i] = best;
  }
  return out;
}

/**
 * Borne supérieure (rad) de l'angle d'élévation qu'un relief plafonné à
 * `maxHeightDiffM` au-dessus de l'œil peut atteindre à une distance ≥ d.
 * Plafond au-dessus de l'œil : la borne décroît avec la distance (la fonction
 * atan((H − d²/2R)/d) est décroissante) et vaut sa valeur en d. Plafond SOUS
 * l'œil (observateur au point culminant) : elle culmine en d* = √(2R·|H|) —
 * on l'évalue là, borné à l'intervalle restant.
 */
function skylineCeiling(maxHeightDiffM: number, maxDistanceM: number): (d: number) => number {
  if (maxHeightDiffM >= 0) return (d) => apparentElevationAngle(d, maxHeightDiffM);
  const peakDistance = Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M * -maxHeightDiffM);
  return (d) =>
    apparentElevationAngle(Math.min(maxDistanceM, Math.max(d, peakDistance)), maxHeightDiffM);
}

/** Horizon détecté dans l'image : ligne (px) et confiance (0..1) par colonne. */
export interface DetectedSkyline {
  rows: Float32Array;
  confidence: Float32Array;
  width: number;
  height: number;
}

/**
 * Détection sans apprentissage. On descend chaque colonne depuis le haut et on
 * s'arrête là où le pixel QUITTE le ciel (assombri ou dé-bleui par rapport à la
 * référence lue en haut de colonne) : c'est ce que fait l'œil, et c'est le seul
 * critère qui tienne quand la montagne est claire et brumeuse alors qu'un
 * premier plan d'arbres et de toits est beaucoup plus sombre — cas du rapport
 * terrain n° 5, où la coupure à contraste maximal se posait 13° trop bas, sur
 * la cime des arbres, et emportait tout le recalage avec elle.
 *
 * Repli sur l'ancienne coupure à contraste maximal quand le haut de la colonne
 * ne ressemble pas à du ciel (sombre ou texturé) : la référence serait alors du
 * terrain, et descendre depuis elle n'aurait aucun sens.
 */

/** Part de la hauteur servant de référence « ciel » en haut de colonne. */
const SKY_REF_FRACTION = 0.06;
/** Écart relatif (luminance ou bleu) à partir duquel on a quitté le ciel. */
const SKY_DEVIATION = 0.18;
/** Lignes de confirmation : un oiseau ou un liseré JPEG ne fait pas un horizon. */
const CONFIRM_ROWS = 3;
/** Luminance minimale d'une référence de ciel crédible. */
const MIN_SKY_LUMA = 60;
/** Écart max dans la bande de référence : au-delà, c'est texturé (du terrain). */
const MAX_SKY_SPREAD = 30;

export function detectImageSkyline(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): DetectedSkyline {
  const rows = new Float32Array(width);
  const confidence = new Float32Array(width);
  const luma = new Float32Array(height);
  const blueness = new Float32Array(height);
  const score = new Float32Array(height);
  // Assez de lignes pour que du terrain texturé se trahisse par son écart-type,
  // jamais plus d'un sixième de l'image (l'horizon peut être haut dans le cadre).
  const refRows = Math.max(
    4,
    Math.min(Math.max(4, Math.floor(height / 6)), Math.round(height * SKY_REF_FRACTION)),
  );
  const band = new Float32Array(refRows);

  const median = (values: Float32Array, count: number): number => {
    band.set(values.subarray(0, count));
    const slice = Array.from(band.subarray(0, count)).sort((a, b) => a - b);
    return slice[Math.floor(count / 2)]!;
  };

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const o = (y * width + x) * 4;
      const r = rgba[o]!;
      const g = rgba[o + 1]!;
      const b = rgba[o + 2]!;
      luma[y] = 0.299 * r + 0.587 * g + 0.114 * b;
      blueness[y] = b - r;
      // « Cielité » : luminosité + dominante bleue (sert au repli et à la confiance).
      score[y] = (luma[y]! + b) / 2;
    }

    const skyLuma = median(luma, refRows);
    const skyBlue = median(blueness, refRows);
    let spread = 0;
    for (let y = 0; y < refRows; y++) {
      spread = Math.max(spread, Math.abs(luma[y]! - skyLuma));
    }
    const skyLike = skyLuma >= MIN_SKY_LUMA && spread <= MAX_SKY_SPREAD;

    let boundary = -1;
    if (skyLike) {
      // Seul l'assombrissement (ou la perte de bleu) compte : un nuage plus
      // clair que le ciel n'est pas un horizon.
      const leftSky = (y: number): boolean =>
        (skyLuma - luma[y]!) / Math.max(30, skyLuma) > SKY_DEVIATION ||
        (skyBlue - blueness[y]!) / Math.max(20, skyBlue) > SKY_DEVIATION;
      for (let y = 1; y < height - 1; y++) {
        if (!leftSky(y)) continue;
        let confirmed = true;
        for (let k = 1; k <= CONFIRM_ROWS && y + k < height; k++) {
          if (!leftSky(y + k)) {
            confirmed = false;
            break;
          }
        }
        if (confirmed) {
          // Affinage : le seuil déclenche un peu SOUS le bord (halo de brume,
          // réduction de l'image). Le vrai bord est la ligne de plus fort
          // gradient dans la fenêtre voisine.
          boundary = steepestEdge(score, y, height);
          break;
        }
      }
    }

    if (boundary < 0) boundary = maxContrastRow(score, height);
    rows[x] = boundary;
    confidence[x] = contrastAt(score, boundary, height);
  }
  return { rows, confidence, width, height };
}

/** Ligne de plus fort assombrissement dans ±3 lignes autour d'une transition. */
function steepestEdge(score: Float32Array, row: number, height: number): number {
  let best = row;
  let bestDrop = -Infinity;
  for (let y = Math.max(1, row - 3); y <= Math.min(height - 2, row + 1); y++) {
    const drop = score[y - 1]! - score[y + 1]!;
    if (drop > bestDrop) {
      bestDrop = drop;
      best = y;
    }
  }
  return best;
}

/** Coupure maximisant moyenne(haut) − moyenne(bas) : repli hors ciel crédible. */
function maxContrastRow(score: Float32Array, height: number): number {
  let sum = 0;
  const prefix = new Float32Array(height + 1);
  for (let y = 0; y < height; y++) {
    sum += score[y]!;
    prefix[y + 1] = sum;
  }
  let bestRow = 0;
  let bestContrast = -Infinity;
  for (let y = 2; y <= height - 2; y++) {
    const contrast = prefix[y]! / y - (prefix[height]! - prefix[y]!) / (height - y);
    if (contrast > bestContrast) {
      bestContrast = contrast;
      bestRow = y;
    }
  }
  return bestRow;
}

/** Confiance : contraste local (8 lignes de part et d'autre), normalisé. */
function contrastAt(score: Float32Array, row: number, height: number): number {
  const span = 8;
  let above = 0;
  let aboveN = 0;
  for (let y = Math.max(0, row - span); y < row; y++) {
    above += score[y]!;
    aboveN++;
  }
  let below = 0;
  let belowN = 0;
  for (let y = row + 1; y < Math.min(height, row + 1 + span); y++) {
    below += score[y]!;
    belowN++;
  }
  if (aboveN === 0 || belowN === 0) return 0;
  return Math.max(0, Math.min(1, (above / aboveN - below / belowN) / 96));
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
  /**
   * Vrai quand le FOV retenu bute sur une borne de recherche : l'optimum est
   * hors plage, donc la valeur n'est PAS mesurée — juste bornée. Elle ne doit
   * pas être persistée comme étalonnage (faux avec un flux 16:9, dont le petit
   * côté descend sous les bornes pensées pour un cadre 4:3).
   */
  fovAtBound: boolean;
  /** Erreur absolue moyenne (°) des colonnes concordantes au meilleur alignement. */
  maeDeg: number;
  /** Colonnes exploitées (confiance suffisante). */
  usedColumns: number;
  /** Colonnes concordantes (erreur sous le plafond) au meilleur alignement. */
  inlierColumns: number;
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
  return rayAngles(rx, ry, Math.cos(p), Math.sin(p));
}

/**
 * Rayon caméra (rx, ry, −1) redressé de l'assiette (rotation X d'angle p) :
 * azimut relatif et élévation (°). Cœur de `pixelToAngles`, sans conversion
 * ni tangentes recalculées — appelé des dizaines de milliers de fois par la
 * mise en correspondance.
 */
function rayAngles(
  rx: number,
  ry: number,
  cosP: number,
  sinP: number,
): { azRelDeg: number; elevDeg: number } {
  const wy = ry * cosP + sinP;
  const wz = ry * sinP - cosP;
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
 * Profil théorique en degrés, bouclé (une case de plus pour interpoler sans
 * modulo), et sa lecture interpolée — la version chaude de `demAngleDeg`.
 */
function makeProfileLookup(skyline: Float32Array, stepDeg: number): (azimuthDeg: number) => number {
  const len = skyline.length;
  const profile = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) profile[i] = radToDeg(skyline[i]!);
  profile[len] = profile[0]!;
  const binsPerDeg = 1 / stepDeg;
  return (azimuthDeg) => {
    let pos = azimuthDeg * binsPerDeg;
    pos -= Math.floor(pos / len) * len;
    if (pos >= len) pos -= len; // arrondi flottant sur un azimut à peine négatif
    const i = Math.floor(pos);
    const a = profile[i]!;
    return a + (profile[i + 1]! - a) * (pos - i);
  };
}

/** Pas de la grille grossière (°) : le profil est à 0,5°, l'affinage fait le reste. */
const COARSE_HEADING_STEP_DEG = 0.5;
const COARSE_PITCH_STEP_DEG = 0.5;
/** Niveaux d'affinage (le pas est divisé par deux à chacun) : 0,5° → 0,03°. */
const REFINE_LEVELS = 4;
/** Pénalités de départage (voir `matchSkyline`). */
const PITCH_PENALTY_PER_DEG = 0.05;
const HEADING_PENALTY_PER_DEG = 0.001;
const FOV_PENALTY_PER_DEG = 0.002;

/**
 * Cherche la correction (cap, assiette) qui aligne l'horizon détecté sur le
 * profil théorique. Retourne null si trop peu de colonnes sont exploitables.
 *
 * Deux étages. (1) Grille grossière sur cap × assiette (× FOV si demandé) avec
 * un modèle d'assiette au premier ordre : la lecture du profil ne dépend que
 * du cap, elle est donc faite une fois par cap et réutilisée pour toutes les
 * assiettes — c'est ce qui rend la recherche ~30 fois moins chère qu'une
 * évaluation complète par pose, et permet de la lancer sur le fil principal
 * sans figer l'interface. (2) Affinage EXACT (les angles de chaque colonne
 * sont recalculés à l'assiette et au FOV testés) par descente sur grille
 * resserrée autour de l'optimum grossier : la correction rendue n'est plus
 * quantifiée au pas de la grille (0,25°/0,5° auparavant, soit jusqu'à 0,25°
 * d'erreur d'assiette systématique), et l'approximation de l'étage 1 —
 * l'assiette ne translate pas exactement les colonnes de bord — est levée.
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
    /** Plafond d'erreur par colonne (°) : au-delà, la colonne est un parasite. */
    outlierCapDeg?: number;
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
  // Coût robuste : l'erreur d'une colonne est plafonnée, pour qu'une minorité
  // accrochée sur un bord parasite (reflets, premier plan) ne tire pas tout
  // l'alignement — cas réel du rapport terrain (mer + contre-jour).
  const outlierCapDeg = options.outlierCapDeg ?? 3;

  const columns: number[] = [];
  for (let x = 0; x < detected.width; x++) {
    if (detected.confidence[x]! >= minConfidence) columns.push(x);
  }
  if (columns.length < detected.width * 0.25) return null;
  const n = columns.length;

  const lookup = makeProfileLookup(demSkyline, demStepDeg);
  const aspect = detected.width / detected.height;
  // Coordonnées écran normalisées des colonnes retenues (indépendantes du FOV).
  const ndcX = new Float64Array(n);
  const ndcY = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const x = columns[k]!;
    ndcX[k] = (2 * (x + 0.5)) / detected.width - 1;
    ndcY[k] = 1 - (2 * (detected.rows[x]! + 0.5)) / detected.height;
  }
  // Rayons caméra (rx, ry, −1) des colonnes au FOV courant, recalculés au
  // changement de FOV seulement (l'affinage en teste rarement un nouveau).
  const rx = new Float64Array(n);
  const ry = new Float64Array(n);
  let currentFov = NaN;
  const setFov = (fovDeg: number): void => {
    if (fovDeg === currentFov) return;
    currentFov = fovDeg;
    const tanV = Math.tan(degToRad(fovDeg) / 2);
    const tanH = tanV * aspect;
    for (let k = 0; k < n; k++) {
      rx[k] = ndcX[k]! * tanH;
      ry[k] = ndcY[k]! * tanV;
    }
  };

  const fovSearch = options.fovSearch;
  const minFov = fovSearch?.minDeg ?? 40;
  const maxFov = fovSearch?.maxDeg ?? 80;
  const fovCoarse = fovSearch?.coarseStepDeg ?? 4;
  const fovFine = fovSearch?.fineStepDeg ?? 1;

  // Un horizon localement rectiligne rend cap et assiette interchangeables :
  // on départage en préférant l'assiette des capteurs (pénalité sur pOff).
  // Sur un horizon PLAT le cap est indéterminé : la pénalité minuscule sur
  // hOff casse l'égalité vers « pas de correction de cap ». Et la surface de
  // coût est plate en FOV (le cap absorbe une partie de la compression) : un
  // a priori très doux vers le FOV courant départage sans jamais dominer
  // l'écart réel mesuré (~0,005°/° de FOV sur un horizon net).
  const penalty = (hOff: number, pOff: number, fovDeg: number): number =>
    PITCH_PENALTY_PER_DEG * Math.abs(pOff) +
    HEADING_PENALTY_PER_DEG * Math.abs(hOff) +
    (fovSearch ? FOV_PENALTY_PER_DEG * Math.abs(fovDeg - view.fovDeg) : 0);

  /**
   * Étage 1 : meilleure pose (cap, assiette) sur la grille grossière pour un
   * FOV donné. Modèle d'assiette au premier ordre : une correction pOff
   * translate l'élévation d'une colonne de pOff·cos(azimut relatif) — exact
   * en dérivée, à toute assiette — et son azimut n'est pas touché.
   */
  const az0 = new Float64Array(n);
  const el0 = new Float64Array(n);
  const cosAz = new Float64Array(n);
  const residual = new Float64Array(n);
  const coarse = (fovDeg: number): { hOff: number; pOff: number; cost: number } => {
    setFov(fovDeg);
    const p = degToRad(view.pitchDeg);
    const cosP = Math.cos(p);
    const sinP = Math.sin(p);
    for (let k = 0; k < n; k++) {
      const a = rayAngles(rx[k]!, ry[k]!, cosP, sinP);
      az0[k] = view.headingDeg + a.azRelDeg;
      el0[k] = a.elevDeg;
      cosAz[k] = Math.cos(degToRad(a.azRelDeg));
    }
    let best = { hOff: 0, pOff: 0, cost: Infinity };
    for (let hOff = -searchDeg; hOff <= searchDeg; hOff += COARSE_HEADING_STEP_DEG) {
      for (let k = 0; k < n; k++) residual[k] = lookup(az0[k]! + hOff) - el0[k]!;
      for (let pOff = -pitchSearchDeg; pOff <= pitchSearchDeg; pOff += COARSE_PITCH_STEP_DEG) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          const err = Math.abs(residual[k]! - pOff * cosAz[k]!);
          sum += err < outlierCapDeg ? err : outlierCapDeg;
        }
        const cost = sum / n + penalty(hOff, pOff, fovDeg);
        if (cost < best.cost) best = { hOff, pOff, cost };
      }
    }
    return best;
  };

  /** Coût exact d'une pose : angles de chaque colonne recalculés à cette assiette et ce FOV. */
  const exactCost = (hOff: number, pOff: number, fovDeg: number): number => {
    setFov(fovDeg);
    const p = degToRad(view.pitchDeg + pOff);
    const cosP = Math.cos(p);
    const sinP = Math.sin(p);
    const heading = view.headingDeg + hOff;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const a = rayAngles(rx[k]!, ry[k]!, cosP, sinP);
      const err = Math.abs(lookup(heading + a.azRelDeg) - a.elevDeg);
      sum += err < outlierCapDeg ? err : outlierCapDeg;
    }
    return sum / n + penalty(hOff, pOff, fovDeg);
  };

  // Étage 1 sur le FOV courant, ou balayage grossier puis fin du FOV.
  type Pose = { hOff: number; pOff: number; fovDeg: number; cost: number };
  let seed: Pose;
  if (!fovSearch) {
    seed = { ...coarse(view.fovDeg), fovDeg: view.fovDeg };
  } else {
    let best: Pose | null = null;
    const consider = (fovDeg: number) => {
      const r = coarse(fovDeg);
      if (!best || r.cost < best.cost) best = { ...r, fovDeg };
    };
    for (let f = minFov; f <= maxFov; f += fovCoarse) consider(f);
    const center = best!.fovDeg;
    for (
      let f = Math.max(minFov, center - fovCoarse);
      f <= Math.min(maxFov, center + fovCoarse);
      f += fovFine
    ) {
      consider(f);
    }
    seed = best!;
  }

  // Étage 2 : descente exacte sur grille resserrée autour de l'optimum grossier.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let pose = { ...seed, cost: exactCost(seed.hOff, seed.pOff, seed.fovDeg) };
  const step = {
    h: COARSE_HEADING_STEP_DEG,
    p: COARSE_PITCH_STEP_DEG,
    f: fovSearch ? fovFine : 0,
  };
  const fovDeltas = fovSearch ? [-1, 0, 1] : [0];
  for (let level = 0; level < REFINE_LEVELS; level++) {
    for (let moves = 0; moves < 8; moves++) {
      let next = pose;
      for (const dh of [-1, 0, 1]) {
        for (const dp of [-1, 0, 1]) {
          for (const df of fovDeltas) {
            if (dh === 0 && dp === 0 && df === 0) continue;
            const hOff = clamp(pose.hOff + dh * step.h, -searchDeg, searchDeg);
            const pOff = clamp(pose.pOff + dp * step.p, -pitchSearchDeg, pitchSearchDeg);
            const fovDeg = clamp(pose.fovDeg + df * step.f, minFov, maxFov);
            const cost = exactCost(hOff, pOff, fovDeg);
            if (cost < next.cost - 1e-12) next = { hOff, pOff, fovDeg, cost };
          }
        }
      }
      if (next === pose) break;
      pose = next;
    }
    step.h /= 2;
    step.p /= 2;
    step.f /= 2;
  }

  // Statistiques de l'alignement retenu, colonnes concordantes seulement :
  // la MAE rapportée juge la qualité du verrouillage, pas les parasites.
  setFov(pose.fovDeg);
  const p = degToRad(view.pitchDeg + pose.pOff);
  const cosP = Math.cos(p);
  const sinP = Math.sin(p);
  let inliers = 0;
  let inlierSum = 0;
  for (let k = 0; k < n; k++) {
    const a = rayAngles(rx[k]!, ry[k]!, cosP, sinP);
    const err = Math.abs(lookup(view.headingDeg + pose.hOff + a.azRelDeg) - a.elevDeg);
    if (err < outlierCapDeg) {
      inliers++;
      inlierSum += err;
    }
  }

  return {
    headingOffsetDeg: pose.hOff,
    pitchOffsetDeg: pose.pOff,
    fovDeg: pose.fovDeg,
    // Optimum collé à une borne : la vraie valeur est probablement au-delà.
    fovAtBound:
      fovSearch !== undefined &&
      (pose.fovDeg <= minFov + fovFine / 2 || pose.fovDeg >= maxFov - fovFine / 2),
    maeDeg: inliers > 0 ? inlierSum / inliers : Infinity,
    usedColumns: n,
    inlierColumns: inliers,
  };
}

/** MAE maximale (°) des colonnes concordantes pour appliquer un recalage.
 *  Plus stricte que l'ancien seuil (1,5° sur TOUTES les colonnes) : la MAE des
 *  seules concordantes d'un vrai verrouillage est ≲ 0,5° — au-delà de 1°, on
 *  regarde probablement un horizon penché (roulis) ou un bord parasite. */
const MAX_RELIABLE_MAE_DEG = 1.0;
/** Part minimale de colonnes concordantes : en deçà, l'alignement suit peut-être
 *  un bord parasite majoritaire plutôt que l'horizon (rapport terrain : reflets
 *  en contre-jour marin accrochés bien sous l'horizon vrai). */
const MIN_INLIER_FRACTION = 0.6;

/**
 * Un recalage ne s'applique que si l'alignement est net ET porté par une
 * majorité franche de colonnes — une MAE basse sur une petite minorité
 * concordante reste un verrouillage douteux.
 */
export function isMatchReliable(match: SkylineMatch): boolean {
  return (
    match.maeDeg <= MAX_RELIABLE_MAE_DEG &&
    match.inlierColumns >= Math.ceil(MIN_INLIER_FRACTION * match.usedColumns)
  );
}
