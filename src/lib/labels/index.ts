import { apparentElevationAngle, degToRad, normalizeBearing, radToDeg } from '../geo';
import { peakDisplayName, peakImportance, type NamePreference, type Peak } from '../peaks';
import type { Units } from '../settings';
import type { PeakSight } from '../visibility/protocol';

/**
 * Placement des étiquettes de sommets : projection écran sans Three.js
 * (reproduit la caméra YXZ du moteur), priorisation et anti-chevauchement
 * glouton. Module pur, testé — l'overlay Svelte ne fait qu'afficher.
 *
 * Les étiquettes sont des capsules COUCHÉES à 45° vers le haut-droit (nom puis
 * altitude), ancrées par leur extrémité basse au sommet d'un trait de rappel
 * vertical planté sur la pointe du sommet — la mise en page de PeakVisor : les
 * noms se lisent le long de la crête sans la masquer.
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
  lat: number;
  lon: number;
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
  /** Cap du sommet (°) : la fiche annonce « 12,4 km vers SO ». */
  azimuthDeg: number;
  lat: number;
  lon: number;
  /** Point d'ancrage écran (px) : la pointe du sommet. */
  x: number;
  y: number;
  /**
   * Surélévation (px) de la capsule au-dessus de sa place normale, quand une
   * étiquette plus importante occupe déjà celle-ci : le trait de rappel
   * s'allonge d'autant. 0 pour une étiquette posée à sa place.
   */
  lift: number;
}

/** Sommet visible dans le cadre, étiqueté ou non : un point sur la crête. */
export interface PeakDot {
  id: number;
  x: number;
  y: number;
}

/** Joint les résultats du worker aux sommets et prépare les candidats triés. */
export function toCandidates(
  sights: PeakSight[],
  peaks: Peak[],
  eyeElevation: number,
  namePreference: NamePreference = 'fr',
): LabelCandidate[] {
  const byId = new Map(peaks.map((p) => [p.id, p]));
  const candidates: LabelCandidate[] = [];

  for (const sight of sights) {
    if (!sight.visible) continue;
    const peak = byId.get(sight.id);
    if (!peak) continue;
    candidates.push({
      id: sight.id,
      name: peakDisplayName(peak, namePreference),
      elevation: sight.elevation,
      distanceM: sight.distanceM,
      azimuthDeg: normalizeBearing(radToDeg(Math.atan2(sight.east, sight.north))),
      elevAngleRad: apparentElevationAngle(sight.distanceM, sight.elevation - eyeElevation),
      // Priorité de placement : l'importance ABSOLUE (altitude + proéminence),
      // pas l'apparente qui sert à choisir les sommets. Quand les étiquettes se
      // chevauchent, c'est le géant lointain qui garde sa place — un modeste
      // sommet proche, plus haut à l'écran, ne doit pas le faire disparaître ;
      // lui est surélevé (voir placeLabels), pas supprimé.
      score: peakImportance({ elevation: sight.elevation, prominence: peak.prominence }),
      lat: peak.lat,
      lon: peak.lon,
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

/** Inclinaison des capsules (°, sens trigonométrique : vers le haut-droit). */
export const LABEL_ANGLE_DEG = 45;
/** Épaisseur d'une capsule (px), nom et altitude sur une seule ligne. */
export const LABEL_THICKNESS = 34;
/** Longueur minimale du trait de rappel (px) entre la pointe et la capsule. */
export const LABEL_LEADER_MIN = 48;
/** Espace laissé entre deux capsules voisines (px). */
const STACK_GAP = 6;
/** Niveaux de surélévation tentés au-dessus de la place normale (0 = à sa place). */
const MAX_STACK_LEVELS = 3;
/** Largeur moyenne d'un caractère (px) et marges intérieures d'un segment de capsule. */
const CHAR_WIDTH = 8.4;
const SEGMENT_PADDING = 22;

const COS_A = Math.cos(degToRad(LABEL_ANGLE_DEG));
const SIN_A = Math.sin(degToRad(LABEL_ANGLE_DEG));
/**
 * Marche de surélévation : monter d'un niveau décale la capsule, en travers de
 * son axe, d'exactement une épaisseur plus l'écart — une voisine posée au même
 * endroit est dégagée d'un coup.
 */
const LIFT_STEP = (LABEL_THICKNESS + STACK_GAP) / COS_A;

/** Longueur estimée d'une capsule (px) : nom, puis altitude « 4808 m ». */
export function estimateLabelLength(name: string, elevation: number): number {
  const elevationText = `${Math.round(elevation)} m`;
  return (
    Math.max(3, name.length) * CHAR_WIDTH +
    SEGMENT_PADDING +
    elevationText.length * CHAR_WIDTH +
    SEGMENT_PADDING
  );
}

/**
 * Boîte d'une capsule dans le repère INCLINÉ (u le long de l'axe de la
 * capsule, v en travers) : toutes les capsules partagent l'inclinaison, elles
 * y sont des rectangles alignés — le test de chevauchement est exact.
 */
interface TiltedBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

function labelBox(candidate: LabelCandidate, x: number, y: number, lift: number): TiltedBox {
  const startY = y - LABEL_LEADER_MIN - lift; // extrémité basse de la capsule
  const u = x * COS_A - startY * SIN_A;
  const v = x * SIN_A + startY * COS_A;
  const length = estimateLabelLength(candidate.name, candidate.elevation);
  return {
    u0: u,
    u1: u + length,
    v0: v - LABEL_THICKNESS / 2,
    v1: v + LABEL_THICKNESS / 2,
  };
}

function overlaps(a: TiltedBox, b: TiltedBox): boolean {
  return a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
}

/** Vrai si le point projeté tombe dans le cadre (marge en px tolérée). */
function inFrame(point: ScreenPoint, view: ViewGeometry, margin: number): boolean {
  return (
    !point.behind &&
    point.x >= -margin &&
    point.x <= view.width + margin &&
    point.y >= -margin &&
    point.y <= view.height + margin
  );
}

/**
 * Place les étiquettes visibles à l'écran : projection, rejet hors cadre,
 * puis placement glouton par score décroissant (les candidats arrivent triés).
 * Une étiquette dont la place est prise n'est pas jetée : elle est surélevée
 * d'un ou plusieurs niveaux, trait de rappel allongé, jusqu'à trouver un
 * espace libre — un petit sommet devant un géant garde son nom sans lui
 * voler le sien. Quand l'extrémité basse de la capsule sortirait par le haut
 * de l'écran, elle disparaît (la capsule peut, elle, dépasser du cadre :
 * son début reste lisible).
 */
export function placeLabels(candidates: LabelCandidate[], view: ViewGeometry): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const boxes: TiltedBox[] = [];
  const margin = 40;

  for (const candidate of candidates) {
    const point = projectToScreen(candidate.azimuthDeg, candidate.elevAngleRad, view);
    if (!inFrame(point, view, margin)) continue;

    for (let level = 0; level < MAX_STACK_LEVELS; level++) {
      const lift = level * LIFT_STEP;
      if (point.y - LABEL_LEADER_MIN - lift < 0) break; // plus de place au-dessus : on renonce
      const box = labelBox(candidate, point.x, point.y, lift);
      if (boxes.some((b) => overlaps(b, box))) continue;

      boxes.push(box);
      placed.push({
        id: candidate.id,
        name: candidate.name,
        elevation: candidate.elevation,
        distanceM: candidate.distanceM,
        azimuthDeg: candidate.azimuthDeg,
        lat: candidate.lat,
        lon: candidate.lon,
        x: point.x,
        y: point.y,
        lift,
      });
      break;
    }
  }

  return placed;
}

/**
 * Tous les sommets visibles qui tombent dans le cadre, étiquetés ou non :
 * l'overlay pose un point sur chaque pointe, pour que la crête se lise même
 * là où les noms n'ont pas trouvé de place.
 */
export function projectPeaks(candidates: LabelCandidate[], view: ViewGeometry): PeakDot[] {
  const dots: PeakDot[] = [];
  for (const candidate of candidates) {
    const point = projectToScreen(candidate.azimuthDeg, candidate.elevAngleRad, view);
    if (!inFrame(point, view, 0)) continue;
    dots.push({ id: candidate.id, x: point.x, y: point.y });
  }
  return dots;
}

const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

/** « 4 808 m » (ou « 15 774 ft » en unités impériales). */
export function formatElevation(elevation: number, units: Units = 'metric'): string {
  if (units === 'imperial') {
    return `${Math.round(elevation * FEET_PER_METER).toLocaleString('fr-FR')} ft`;
  }
  return `${Math.round(elevation).toLocaleString('fr-FR')} m`;
}

/** « 12,4 km » / « 850 m » — ou « 7,7 mi » / « 520 ft » en unités impériales. */
export function formatDistance(distanceM: number, units: Units = 'metric'): string {
  if (units === 'imperial') {
    const miles = distanceM / METERS_PER_MILE;
    if (miles < 0.1) return `${Math.round(distanceM * FEET_PER_METER)} ft`;
    return `${miles.toLocaleString('fr-FR', { maximumFractionDigits: miles < 10 ? 1 : 0 })} mi`;
  }
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  const km = distanceM / 1000;
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}
