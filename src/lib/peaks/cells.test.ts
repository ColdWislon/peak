import { describe, expect, it } from 'vitest';
import { haversineDistance } from '../geo';
import { CELL_DEG, cellBounds, cellKey, cellOf, cellRectangles, cellsCoveringDisc } from './cells';

const CHAMONIX = { lat: 45.9237, lon: 6.8694 };

describe('cellOf', () => {
  it('range un point dans la cellule dont il est au-dessus du bord sud-ouest', () => {
    const cell = cellOf(CHAMONIX);
    const b = cellBounds(cell);
    expect(b.south).toBeLessThanOrEqual(CHAMONIX.lat);
    expect(b.north).toBeGreaterThan(CHAMONIX.lat);
    expect(b.west).toBeLessThanOrEqual(CHAMONIX.lon);
    expect(b.east).toBeGreaterThan(CHAMONIX.lon);
    expect(b.north - b.south).toBeCloseTo(CELL_DEG, 9);
  });

  it('a des bords inclus au sud et à l’ouest, exclus au nord et à l’est', () => {
    expect(cellKey(cellOf({ lat: 46, lon: 7 }))).toBe(cellKey(cellOf({ lat: 46.1, lon: 7.1 })));
    expect(cellKey(cellOf({ lat: 46, lon: 7 }))).not.toBe(cellKey(cellOf({ lat: 45.99, lon: 7 })));
  });

  it('enroule la longitude autour de l’antiméridien', () => {
    expect(cellKey(cellOf({ lat: 0, lon: 180 }))).toBe(cellKey(cellOf({ lat: 0, lon: -180 })));
    expect(cellKey(cellOf({ lat: 0, lon: 190 }))).toBe(cellKey(cellOf({ lat: 0, lon: -170 })));
  });
});

describe('cellsCoveringDisc', () => {
  it('contient la cellule du centre et toute cellule d’un sommet dans le rayon', () => {
    const cells = cellsCoveringDisc(CHAMONIX, 75_000);
    const keys = new Set(cells.map(cellKey));
    expect(keys.has(cellKey(cellOf(CHAMONIX)))).toBe(true);
    // Échantillonnage du disque : chaque point à moins de 75 km tombe dans une cellule listée.
    for (let bearing = 0; bearing < 360; bearing += 15) {
      for (const distance of [1_000, 40_000, 74_900]) {
        const rad = (bearing * Math.PI) / 180;
        const point = {
          lat: CHAMONIX.lat + (Math.cos(rad) * distance) / 111_000,
          lon: CHAMONIX.lon + (Math.sin(rad) * distance) / (111_000 * Math.cos(0.8)),
        };
        if (haversineDistance(CHAMONIX, point) > 75_000) continue;
        expect(keys.has(cellKey(cellOf(point)))).toBe(true);
      }
    }
  });

  it('écarte les cellules des coins qui ne touchent pas le disque', () => {
    const cells = cellsCoveringDisc(CHAMONIX, 75_000);
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    const columns = Math.max(...xs) - Math.min(...xs) + 1;
    const rows = Math.max(...ys) - Math.min(...ys) + 1;
    expect(cells.length).toBeLessThan(columns * rows);
    expect(cells.length).toBeGreaterThan((columns * rows) / 2);
  });

  it('ne liste chaque cellule qu’une fois, du sud au nord', () => {
    const cells = cellsCoveringDisc(CHAMONIX, 10_000);
    expect(new Set(cells.map(cellKey)).size).toBe(cells.length);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.y).toBeGreaterThanOrEqual(cells[i - 1]!.y);
    }
  });

  it('un tout petit disque tient dans une cellule', () => {
    expect(cellsCoveringDisc({ lat: 45.9, lon: 6.9 }, 100)).toHaveLength(1);
  });

  it('traverse l’antiméridien sans s’étendre sur tout le globe', () => {
    const cells = cellsCoveringDisc({ lat: -16, lon: 179.95 }, 30_000);
    expect(cells.length).toBeLessThan(20);
    const xs = new Set(cells.map((c) => c.x));
    expect(xs.has(cellOf({ lat: -16, lon: 179.9 }).x)).toBe(true);
    expect(xs.has(cellOf({ lat: -16, lon: -179.9 }).x)).toBe(true);
  });
});

describe('cellRectangles', () => {
  it('fusionne un bloc plein en un seul rectangle', () => {
    const cells = [];
    for (let y = 10; y <= 12; y++) for (let x = 20; x <= 23; x++) cells.push({ x, y });
    expect(cellRectangles(cells)).toEqual([
      { south: 10 * CELL_DEG, north: 13 * CELL_DEG, west: 20 * CELL_DEG, east: 24 * CELL_DEG },
    ]);
  });

  it('découpe une forme en L en rectangles disjoints couvrant exactement les cellules', () => {
    // Rangée du haut complète + colonne de droite : ce que laisse un déplacement en diagonale.
    const cells = [
      { x: 20, y: 12 },
      { x: 21, y: 12 },
      { x: 22, y: 12 },
      { x: 22, y: 11 },
      { x: 22, y: 10 },
    ];
    const rects = cellRectangles(cells);
    expect(rects).toHaveLength(2);
    const area = rects.reduce(
      (sum, r) => sum + ((r.north - r.south) * (r.east - r.west)) / (CELL_DEG * CELL_DEG),
      0,
    );
    expect(area).toBeCloseTo(cells.length, 9);
  });

  it('ignore les doublons et l’ordre d’arrivée', () => {
    const rects = cellRectangles([
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(rects).toHaveLength(1);
  });

  it('rend une liste vide pour aucune cellule', () => {
    expect(cellRectangles([])).toEqual([]);
  });
});
