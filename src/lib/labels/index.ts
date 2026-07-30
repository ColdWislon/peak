import { apparentElevationAngle, degToRad, normalizeBearing, radToDeg } from '../geo';
import type { Peak } from '../peaks';
import type { PeakSight } from '../visibility/protocol';

/**
 * Placement des étiquettes de sommets : projection écran sans Three.js
 * (reproduit la caméra YXZ du moteur), priorisation et anti-chevauchement
 * glouton. Module pur, testé — l'overlay Svelte ne fait qu'afficher.
 */

export interface LabelCandidate {
  id: number;
  name: string;
  /** Altitude retenue (m). */
  elevation: number;
  distanceM: number;
  /** Cap du sommet vu de l'œil (°). */
  azimuthDeg: number;
  /** Angle d'élévation apparent (rad). */
  elevAngleRad: number;
  /** Priorité d'affichage (plus grand = gardé en premier). */
  score: number;
}

export interface ViewGeometry {
  headingDeg: number;
  pitchDeg: number;
  /** Champ de vision vertical (°). */
  fovDeg: number;
  width: number;
  height: number;
}

export interface PlacedLabel {
  id: number;
  name: string;
  elevation: number;
  distanceM: number;
  /** Point d'ancrage écran (px) : la pointe du sommet. */
  x: number;
  y: number;
}

/** Joint les résultats du worker aux sommets et prépare les candidats triés. */
export function toCandidates(
  sights: PeakSight[],
  peaks: Peak[],
  eyeElevation: number,
): LabelCandidate[] {
  const byId = new Map(peaks.map((p) => [p.id, p]));
  const candidates: LabelCandidate[] = [];

  for (const sight of sights) {
    if (!sight.visible) continue;
    const peak = byId.get(sight.id);
    if (!peak) continue;
    candidates.push({
      id: sight.id,
      name: peak.name,
      elevation: sight.elevation,
      distanceM: sight.distanceM,
      azimuthDeg: normalizeBearing(radToDeg(Math.atan2(sight.east, sight.north))),
      elevAngleRad: apparentElevationAngle(sight.distanceM, sight.elevation - eyeElevation),
      score: sight.elevation,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Vrai si le point est derrière le plan caméra (à ne pas afficher). */
  behind: boolean;
}

/** Projette une direction (azimut, angle d'élévation) sur l'écran de la vue. */
export function projectToScreen(
  azimuthDeg: number,
  elevAngleRad: number,
  view: ViewGeometry,
): ScreenPoint {
  const relAzimuth = degToRad(((((azimuthDeg - view.headingDeg) % 360) + 540) % 360) - 180);
  const pitch = degToRad(view.pitchDeg);

  // Direction unitaire en espace caméra avant assiette (x droite, y haut, −z devant).
  const cosE = Math.cos(elevAngleRad);
  const x = Math.sin(relAzimuth) * cosE;
  let y = Math.sin(elevAngleRad);
  let z = -Math.cos(relAzimuth) * cosE;

  // Annule l'assiette : rotation d'angle −pitch autour de X (Rx(−p)·v).
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const y2 = y * cosP + z * sinP;
  const z2 = -y * sinP + z * cosP;
  y = y2;
  z = z2;

  if (z >= -1e-9) return { x: NaN, y: NaN, behind: true };

  const tanHalfFovY = Math.tan(degToRad(view.fovDeg) / 2);
  const aspect = view.width / Math.max(1, view.height);
  const ndcX = x / -z / (tanHalfFovY * aspect);
  const ndcY = y / -z / tanHalfFovY;

  return {
    x: ((ndcX + 1) / 2) * view.width,
    y: ((1 - ndcY) / 2) * view.height,
    behind: false,
  };
}

/** Boîte estimée d'une étiquette (nom + ligne d'infos) ancrée au-dessus du point. */
function labelBox(candidate: LabelCandidate, x: number, y: number) {
  const width = Math.max(64, candidate.name.length * 7.2 + 16);
  const height = 34;
  return { left: x - width / 2, top: y - height - 12, width, height };
}

function overlaps(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/**
 * Place les étiquettes visibles à l'écran : projection, rejet hors cadre,
 * puis sélection gloutonne par score décroissant sans chevauchement.
 */
export function placeLabels(candidates: LabelCandidate[], view: ViewGeometry): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const boxes: Array<{ left: number; top: number; width: number; height: number }> = [];
  const margin = 40;

  for (const candidate of candidates) {
    const point = projectToScreen(candidate.azimuthDeg, candidate.elevAngleRad, view);
    if (point.behind) continue;
    if (
      point.x < -margin ||
      point.x > view.width + margin ||
      point.y < -margin ||
      point.y > view.height + margin
    ) {
      continue;
    }

    const box = labelBox(candidate, point.x, point.y);
    if (boxes.some((b) => overlaps(b, box))) continue;

    boxes.push(box);
    placed.push({
      id: candidate.id,
      name: candidate.name,
      elevation: candidate.elevation,
      distanceM: candidate.distanceM,
      x: point.x,
      y: point.y,
    });
  }

  return placed;
}

/** « 4 808 m » — altitude formatée à la française. */
export function formatElevation(elevation: number): string {
  return `${Math.round(elevation).toLocaleString('fr-FR')} m`;
}

/** « 12,4 km » (ou « 850 m » sous le kilomètre). */
export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  const km = distanceM / 1000;
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}
