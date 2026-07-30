import { describe, expect, it } from 'vitest';
import { GeoHeightField, HeightField } from './heightField';
import { decodeTerrarium, decodeTerrariumRgba, encodeTerrarium } from './terrarium';
import {
  latToTileY,
  lonToTileX,
  metersPerPixel,
  terrariumTileUrl,
  TILE_SIZE,
  tileXToLon,
  tileYToLat,
} from './tiles';

const CHAMONIX = { lat: 45.9237, lon: 6.8694 };

describe('maths des tuiles', () => {
  it('place (0, 0) au centre de la grille', () => {
    expect(lonToTileX(0, 1)).toBeCloseTo(1, 10);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 10);
  });

  it('est inversible (aller-retour lon/lat ↔ tuile)', () => {
    const z = 12;
    expect(tileXToLon(lonToTileX(CHAMONIX.lon, z), z)).toBeCloseTo(CHAMONIX.lon, 9);
    expect(tileYToLat(latToTileY(CHAMONIX.lat, z), z)).toBeCloseTo(CHAMONIX.lat, 9);
  });

  it('borne les latitudes hors WebMercator', () => {
    expect(latToTileY(89.9, 0)).toBeCloseTo(0, 6);
    expect(latToTileY(-89.9, 0)).toBeCloseTo(1, 6);
  });

  it("calcule la résolution sol connue à l'équateur au zoom 0", () => {
    // 2πR / 256 ≈ 156 543 m/pixel : valeur de référence WebMercator.
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543.03, 1);
    expect(metersPerPixel(60, 1)).toBeCloseTo((156_543.03 / 2) * Math.cos(Math.PI / 3), 0);
  });

  it("génère l'URL terrarium attendue", () => {
    expect(terrariumTileUrl(12, 2125, 1448)).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2125/1448.png',
    );
  });
});

describe('encodage terrarium', () => {
  it('décode le zéro de référence', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
  });

  it('boucle encode → decode au 1/256 de mètre près', () => {
    for (const elevation of [0, 4808.75, -10.5, 8848, -428]) {
      const { r, g, b } = encodeTerrarium(elevation);
      expect(decodeTerrarium(r, g, b)).toBeCloseTo(elevation, 2);
    }
  });

  it('rejette les altitudes hors plage', () => {
    expect(() => encodeTerrarium(40000)).toThrow(RangeError);
    expect(() => encodeTerrarium(-40000)).toThrow(RangeError);
  });

  it('décode un tampon RGBA en ignorant l’alpha', () => {
    const a = encodeTerrarium(1000);
    const b = encodeTerrarium(-5.25);
    const rgba = new Uint8ClampedArray([a.r, a.g, a.b, 255, b.r, b.g, b.b, 0]);
    const out = decodeTerrariumRgba(rgba);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(1000, 2);
    expect(out[1]).toBeCloseTo(-5.25, 2);
  });
});

describe('HeightField', () => {
  const grid = new HeightField(2, 2, new Float32Array([0, 1, 2, 3]));

  it('refuse un tampon de mauvaise taille', () => {
    expect(() => new HeightField(2, 2, new Float32Array(3))).toThrow(RangeError);
  });

  it('échantillonne exactement aux centres de pixels', () => {
    expect(grid.sampleBilinear(0, 0)).toBe(0);
    expect(grid.sampleBilinear(1, 0)).toBe(1);
    expect(grid.sampleBilinear(0, 1)).toBe(2);
    expect(grid.sampleBilinear(1, 1)).toBe(3);
  });

  it('interpole au milieu des quatre pixels', () => {
    expect(grid.sampleBilinear(0.5, 0.5)).toBe(1.5);
  });

  it('étire les bords hors emprise (clamp)', () => {
    expect(grid.sampleBilinear(-3, -3)).toBe(0);
    expect(grid.sampleBilinear(5, 5)).toBe(3);
  });
});

describe('GeoHeightField', () => {
  it('retrouve une altitude constante partout dans son emprise', () => {
    const z = 12;
    const x0 = Math.floor(lonToTileX(CHAMONIX.lon, z));
    const y0 = Math.floor(latToTileY(CHAMONIX.lat, z));
    const data = new Float32Array(TILE_SIZE * TILE_SIZE).fill(4808);
    const geo = new GeoHeightField(z, x0, y0, new HeightField(TILE_SIZE, TILE_SIZE, data));

    expect(geo.tilesX).toBe(1);
    expect(geo.contains(CHAMONIX)).toBe(true);
    expect(geo.elevationAt(CHAMONIX)).toBeCloseTo(4808, 6);
  });

  it('interpole linéairement un gradient ouest → est', () => {
    const z = 10;
    const x0 = 100;
    const y0 = 200;
    // Altitude = indice de colonne : le gradient doit se retrouver par interpolation.
    const data = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) data[y * TILE_SIZE + x] = x;
    }
    const geo = new GeoHeightField(z, x0, y0, new HeightField(TILE_SIZE, TILE_SIZE, data));

    // Point aux trois quarts de la largeur de la tuile, à mi-hauteur.
    const lon = tileXToLon(x0 + 0.75, z);
    const lat = tileYToLat(y0 + 0.5, z);
    expect(geo.elevationAt({ lat, lon })).toBeCloseTo(0.75 * TILE_SIZE - 0.5, 6);
  });

  it('signale les points hors emprise', () => {
    const geo = new GeoHeightField(
      12,
      0,
      0,
      new HeightField(TILE_SIZE, TILE_SIZE, new Float32Array(TILE_SIZE * TILE_SIZE)),
    );
    expect(geo.contains(CHAMONIX)).toBe(false);
  });
});
