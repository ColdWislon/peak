import { destinationPoint, haversineDistance, normalizeLon, type LatLon } from '../geo';
import type { Bounds } from './index';

/**
 * Découpage du globe en cellules fixes pour le stockage local des sommets.
 * Une cellule est l'unité de cache : chargée une fois d'Overpass, elle sert
 * ensuite tous les points de vue qu'elle recouvre, quel que soit le rayon
 * demandé. Un pas de 30 m du suivi GPS ou un glissé de carte ne redemande
 * donc rien tant que le disque cherché reste dans des cellules déjà connues.
 * Module pur, testé.
 */

/** Côté d'une cellule (degrés) : ~28 km nord-sud, ~19 km est-ouest à 45°. */
export const CELL_DEG = 0.25;
const COLUMNS = Math.round(360 / CELL_DEG);
const MAX_ROW = Math.round(90 / CELL_DEG) - 1;

/** Indices entiers d'une cellule : `x` colonne (longitude), `y` rangée (latitude). */
export interface Cell {
  x: number;
  y: number;
}

function wrapX(x: number): number {
  return ((((x + COLUMNS / 2) % COLUMNS) + COLUMNS) % COLUMNS) - COLUMNS / 2;
}

function clampY(y: number): number {
  return Math.max(-MAX_ROW - 1, Math.min(MAX_ROW, y));
}

export function cellKey(cell: Cell): string {
  return `${cell.y}:${cell.x}`;
}

/** Cellule contenant un point (bords ouest et sud inclus). */
export function cellOf(point: LatLon): Cell {
  return {
    x: wrapX(Math.floor(normalizeLon(point.lon) / CELL_DEG)),
    y: clampY(Math.floor(point.lat / CELL_DEG)),
  };
}

export function cellBounds(cell: Cell): Bounds {
  return {
    south: cell.y * CELL_DEG,
    north: (cell.y + 1) * CELL_DEG,
    west: cell.x * CELL_DEG,
    east: (cell.x + 1) * CELL_DEG,
  };
}

/** Point de la cellule le plus proche de `center` (en degrés, longitude déroulée). */
function nearestPointOf(cell: Cell, center: LatLon): LatLon {
  const b = cellBounds(cell);
  const dWest = normalizeLon(b.west - center.lon);
  const dEast = dWest + CELL_DEG;
  const lonOffset = dWest > 0 ? dWest : dEast < 0 ? dEast : 0;
  return {
    lat: Math.max(b.south, Math.min(b.north, center.lat)),
    lon: normalizeLon(center.lon + lonOffset),
  };
}

/**
 * Cellules qui recoupent le disque de `radiusM` autour de `center`, rangée
 * par rangée du sud au nord puis d'ouest en est (ordre stable pour les tests
 * et le regroupement en rectangles).
 */
export function cellsCoveringDisc(center: LatLon, radiusM: number): Cell[] {
  const north = destinationPoint(center, 0, radiusM).lat;
  const south = destinationPoint(center, 180, radiusM).lat;
  const west = destinationPoint(center, 270, radiusM).lon;
  const east = destinationPoint(center, 90, radiusM).lon;

  const y0 = clampY(Math.floor(south / CELL_DEG));
  const y1 = clampY(Math.floor(Math.min(north, 90 - 1e-9) / CELL_DEG));
  const x0 = Math.floor(west / CELL_DEG);
  let x1 = Math.floor(east / CELL_DEG);
  if (x1 < x0) x1 += COLUMNS; // le disque chevauche l'antiméridien
  if (x1 - x0 + 1 > COLUMNS) x1 = x0 + COLUMNS - 1;

  const cells: Cell[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cell = { x: wrapX(x), y };
      if (haversineDistance(center, nearestPointOf(cell, center)) <= radiusM) cells.push(cell);
    }
  }
  return cells;
}

/**
 * Regroupe des cellules en rectangles de cellules contiguës : dans chaque
 * rangée, les suites de colonnes consécutives ; puis les rangées voisines
 * qui portent exactement la même suite sont fusionnées. Chaque rectangle
 * devient un bloc de la requête Overpass — l'union couvre exactement les
 * cellules demandées, rien de plus.
 */
export function cellRectangles(cells: readonly Cell[]): Bounds[] {
  const byRow = new Map<number, number[]>();
  for (const cell of cells) {
    const row = byRow.get(cell.y) ?? [];
    if (!row.includes(cell.x)) row.push(cell.x);
    byRow.set(cell.y, row);
  }
  // Suites de colonnes par rangée (x0..x1 inclus).
  const runs = new Map<number, Array<[number, number]>>();
  for (const [y, xs] of byRow) {
    xs.sort((a, b) => a - b);
    const rowRuns: Array<[number, number]> = [];
    for (const x of xs) {
      const last = rowRuns[rowRuns.length - 1];
      if (last && x === last[1] + 1) last[1] = x;
      else rowRuns.push([x, x]);
    }
    runs.set(y, rowRuns);
  }
  const rows = [...runs.keys()].sort((a, b) => a - b);
  const rects: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  for (const y of rows) {
    for (const [x0, x1] of runs.get(y)!) {
      const below = rects.find((r) => r.y1 === y - 1 && r.x0 === x0 && r.x1 === x1);
      if (below) below.y1 = y;
      else rects.push({ x0, x1, y0: y, y1: y });
    }
  }
  return rects.map((r) => ({
    south: r.y0 * CELL_DEG,
    north: (r.y1 + 1) * CELL_DEG,
    west: r.x0 * CELL_DEG,
    east: (r.x1 + 1) * CELL_DEG,
  }));
}
