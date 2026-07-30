import { describe, expect, it } from 'vitest';
import { destinationPoint } from '../geo';
import { GeoHeightField, HeightField } from '../terrain/heightField';
import { latToTileY, lonToTileX, TILE_SIZE } from '../terrain/tiles';
import { makeBlendedSampler } from './sampler';

const CHAMONIX = { lat: 45.9237, lon: 6.8694 };

/** Champ constant couvrant un disque d'au moins radiusM autour du centre. */
function constantField(elevation: number, zoom: number, radiusM: number): GeoHeightField {
  const north = destinationPoint(CHAMONIX, 0, radiusM);
  const south = destinationPoint(CHAMONIX, 180, radiusM);
  const west = destinationPoint(CHAMONIX, 270, radiusM);
  const east = destinationPoint(CHAMONIX, 90, radiusM);
  const x0 = Math.floor(lonToTileX(west.lon, zoom));
  const x1 = Math.floor(lonToTileX(east.lon, zoom));
  const y0 = Math.floor(latToTileY(north.lat, zoom));
  const y1 = Math.floor(latToTileY(south.lat, zoom));
  const w = (x1 - x0 + 1) * TILE_SIZE;
  const h = (y1 - y0 + 1) * TILE_SIZE;
  return new GeoHeightField(
    zoom,
    x0,
    y0,
    new HeightField(w, h, new Float32Array(w * h).fill(elevation)),
  );
}

describe('makeBlendedSampler', () => {
  const inner = constantField(1000, 12, 26_000);
  const outer = constantField(500, 10, 120_000);
  const sample = makeBlendedSampler(CHAMONIX, inner, outer, 24_000);

  it('sert le champ proche avant le fondu', () => {
    expect(sample(0, 0)).toBeCloseTo(1000, 6);
    expect(sample(0, 19_000)).toBeCloseTo(1000, 6);
  });

  it('sert le champ lointain après le rayon proche', () => {
    expect(sample(0, 30_000)).toBeCloseTo(500, 6);
  });

  it('interpole linéairement dans la bande de fondu', () => {
    expect(sample(0, 22_000)).toBeCloseTo(750, 4);
    expect(sample(0, 21_000)).toBeCloseTo(875, 4);
  });

  it('rend 0 (niveau de la mer) hors de toute emprise', () => {
    expect(sample(500_000, 500_000)).toBe(0);
  });
});
