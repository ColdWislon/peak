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

  // Les angles des colonnes dépendent du FOV testé : tout est recalculé par candidat.
  const evaluate = (fovDeg: number): { match: SkylineMatch; cost: number } => {
    const samples = columns.map((x) =>
      pixelToAngles(x, detected.rows[x]!, detected.width, detected.height, view.pitchDeg, fovDeg),
    );
    let bestHOff = 0;
    let bestPOff = 0;
    let bestCost = Infinity;
    for (let hOff = -searchDeg; hOff <= searchDeg; hOff += 0.25) {
      for (let pOff = -pitchSearchDeg; pOff <= pitchSearchDeg; pOff += 0.5) {
        let sum = 0;
        for (const s of samples) {
          const expected = demAngleDeg(demSkyline, view.headingDeg + hOff + s.azRelDeg, demStepDeg);
          sum += Math.min(outlierCapDeg, Math.abs(expected - (s.elevDeg + pOff)));
        }
        const mean = sum / samples.length;
        // Un horizon localement rectiligne rend cap et assiette interchangeables :
        // on départage en préférant l'assiette des capteurs (pénalité sur pOff).
        // Et sur un horizon PLAT le cap est indéterminé : la pénalité minuscule
        // sur hOff casse l'égalité vers « pas de correction de cap » au lieu du
        // premier candidat de la grille (−25°).
        const cost = mean + 0.05 * Math.abs(pOff) + 0.001 * Math.abs(hOff);
        if (cost < bestCost) {
          bestCost = cost;
          bestHOff = hOff;
          bestPOff = pOff;
        }
      }
    }

    // Statistiques du meilleur alignement, colonnes concordantes seulement :
    // la MAE rapportée juge la qualité du verrouillage, pas les parasites.
    let inliers = 0;
    let inlierSum = 0;
    for (const s of samples) {
      const expected = demAngleDeg(demSkyline, view.headingDeg + bestHOff + s.azRelDeg, demStepDeg);
      const err = Math.abs(expected - (s.elevDeg + bestPOff));
      if (err < outlierCapDeg) {
        inliers++;
        inlierSum += err;
      }
    }
    return {
      match: {
        headingOffsetDeg: bestHOff,
        pitchOffsetDeg: bestPOff,
        fovDeg,
        fovAtBound: false,
        maeDeg: inliers > 0 ? inlierSum / inliers : Infinity,
        usedColumns: samples.length,
        inlierColumns: inliers,
      },
      cost: bestCost,
    };
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
  const best = bestOverall!.match;
  // Optimum collé à une borne : la vraie valeur est probablement au-delà.
  best.fovAtBound = best.fovDeg <= minDeg + fine / 2 || best.fovDeg >= maxDeg - fine / 2;
  return best;
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
