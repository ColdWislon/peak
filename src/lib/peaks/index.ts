import { apparentElevationAngle, haversineDistance, type LatLon } from '../geo';

/** Un sommet issu d'OpenStreetMap (nœud `natural=peak` nommé). */
export interface Peak {
  /** Identifiant du nœud OSM. */
  id: number;
  /** Nom local (tag `name`). */
  name: string;
  /** Nom français (tag `name:fr`), quand OSM le connaît. */
  nameFr: string | null;
  lat: number;
  lon: number;
  /** Altitude du tag `ele` (m), si présente et plausible. */
  elevation: number | null;
  /** Proéminence (m) — rare dans OSM mais précieuse pour prioriser. */
  prominence: number | null;
  wikidata: string | null;
}

/** Quel nom afficher : français quand disponible, ou toujours le nom local. */
export type NamePreference = 'fr' | 'local';

export function peakDisplayName(peak: Peak, preference: NamePreference): string {
  return preference === 'fr' ? (peak.nameFr ?? peak.name) : peak.name;
}

/**
 * Importance d'un sommet pour la priorisation : l'altitude, plus un bonus de
 * proéminence (un 3000 très proéminent compte plus qu'une antécime de 4000).
 */
export function peakImportance(peak: Pick<Peak, 'elevation' | 'prominence'>): number {
  return (peak.elevation ?? -Infinity) + (peak.prominence ?? 0) * 2;
}

/** Rectangle géographique (degrés), bords inclus. */
export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Requête Overpass QL : sommets nommés dans l'union de rectangles donnée.
 * Plusieurs rectangles en une seule requête (cf. `peaks/cache`) : Overpass
 * dédoublonne lui-même les nœuds pris dans deux rectangles.
 */
export function buildPeaksQuery(areas: readonly Bounds[]): string {
  const fmt = (deg: number) => deg.toFixed(6);
  const statements = areas
    .map(
      (b) =>
        `node["natural"="peak"]["name"](${fmt(b.south)},${fmt(b.west)},${fmt(b.north)},${fmt(b.east)});`,
    )
    .join('');
  return `[out:json][timeout:60];(${statements});out body;`;
}

/**
 * Altitude d'un tag `ele` OSM, tolérante aux variantes rencontrées sur le
 * terrain (« 4808 m », « 4,808 », espaces) ; `null` si illisible ou absurde.
 */
export function parseElevation(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.-]/g, '');
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < -500 || value > 9100) return null;
  return value;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

/**
 * Convertit une réponse Overpass (`out:json`) en sommets. Les éléments
 * malformés sont ignorés ; le nom français est préféré quand il existe.
 */
export function parsePeaks(json: unknown): Peak[] {
  const elements = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];

  const peaks: Peak[] = [];
  for (const el of elements) {
    if (el?.type !== 'node') continue;
    if (typeof el.id !== 'number' || typeof el.lat !== 'number' || typeof el.lon !== 'number') {
      continue;
    }
    const name = el.tags?.['name'] ?? el.tags?.['name:fr'];
    if (!name) continue;

    peaks.push({
      id: el.id,
      name,
      nameFr: el.tags?.['name:fr'] ?? null,
      lat: el.lat,
      lon: el.lon,
      elevation: parseElevation(el.tags?.['ele']),
      prominence: parseElevation(el.tags?.['prominence']),
      wikidata: el.tags?.['wikidata'] ?? null,
    });
  }
  return peaks;
}

/**
 * Garde les `limit` sommets les plus importants (altitude + proéminence,
 * les sommets sans altitude en dernier) — évite de noyer l'affichage et le
 * calcul de visibilité sous des centaines de points.
 */
export function topPeaks(peaks: Peak[], limit: number): Peak[] {
  return [...peaks].sort((a, b) => peakImportance(b) - peakImportance(a)).slice(0, limit);
}

/**
 * Importance APPARENTE depuis un point de vue : à l'écran, ce qui compte n'est
 * pas l'altitude absolue mais l'angle sous lequel le sommet se détache.
 *
 * Sans ça (rapport terrain n° 6), depuis Chambéry les 300 sommets retenus dans
 * un rayon de 75 km sont tous des 2500-3800 de Vanoise et de Belledonne —
 * masqués par la muraille des Bauges — et la crête que l'utilisateur a sous les
 * yeux, un modeste 1550 à 7 km, ne fait même pas partie du lot : aucune
 * étiquette, alors que l'horizon est parfaitement calé.
 */
export function apparentImportance(
  peak: Pick<Peak, 'elevation' | 'prominence'>,
  distanceM: number,
  eyeElevation: number,
): number {
  if (peak.elevation === null || peak.elevation === undefined) return -Infinity;
  const distance = Math.max(1, distanceM);
  // Hauteur apparente (courbure et réfraction comprises).
  const angle = apparentElevationAngle(distance, peak.elevation - eyeElevation);
  // Relief propre vu à cette distance : départage deux sommets de même hauteur
  // apparente — une antécime pèse moins qu'un sommet isolé.
  const relief = Math.atan((peak.prominence ?? 0) / distance);
  return angle + 0.5 * relief;
}

/** Les `limit` sommets les plus marquants VUS DE `viewpoint` (œil à `eyeElevation`). */
export function topPeaksFrom(
  peaks: Peak[],
  viewpoint: LatLon,
  eyeElevation: number,
  limit: number,
): Peak[] {
  return [...peaks]
    .map((peak) => ({
      peak,
      score: apparentImportance(peak, haversineDistance(viewpoint, peak), eyeElevation),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.peak);
}
