import { describe, expect, it } from 'vitest';
import { stitchBlock, tileBlockAround, tileCount } from './blocks';
import { latToTileY, lonToTileX, TILE_SIZE } from './tiles';

const CHAMONIX = { lat: 45.9237, lon: 6.8694 };

describe('tileBlockAround', () => {
  it('contient toujours la tuile du centre', () => {
    const z = 12;
    const block = tileBlockAround(CHAMONIX, 5_000, z);
    const cx = Math.floor(lonToTileX(CHAMONIX.lon, z));
    const cy = Math.floor(latToTileY(CHAMONIX.lat, z));

    expect(cx).toBeGreaterThanOrEqual(block.x0);
    expect(cx).toBeLessThan(block.x0 + block.tilesX);
    expect(cy).toBeGreaterThanOrEqual(block.y0);
    expect(cy).toBeLessThan(block.y0 + block.tilesY);
  });

  it('grandit avec le rayon demandé', () => {
    const small = tileCount(tileBlockAround(CHAMONIX, 2_000, 12));
    const large = tileCount(tileBlockAround(CHAMONIX, 30_000, 12));
    expect(large).toBeGreaterThan(small);
    // ~30 km de rayon à z12 vers 46° N : environ 9×9 tuiles, jamais des centaines.
    expect(large).toBeLessThan(200);
  });

  it('reste dans la grille près des bords du monde', () => {
    const block = tileBlockAround({ lat: 84.9, lon: 179.5 }, 200_000, 4);
    expect(block.x0).toBeGreaterThanOrEqual(0);
    expect(block.y0).toBeGreaterThanOrEqual(0);
    expect(block.x0 + block.tilesX).toBeLessThanOrEqual(16);
    expect(block.y0 + block.tilesY).toBeLessThanOrEqual(16);
  });
});

describe('stitchBlock', () => {
  it('assemble deux tuiles côte à côte et comble les manquantes à 0', () => {
    const block = { zoom: 5, x0: 10, y0: 20, tilesX: 2, tilesY: 1 };
    const west = new Float32Array(TILE_SIZE * TILE_SIZE).fill(100);

    const field = stitchBlock(block, (x, y) => {
      if (x === 10 && y === 20) return west;
      return undefined; // tuile est manquante
    });

    expect(field.width).toBe(2 * TILE_SIZE);
    expect(field.height).toBe(TILE_SIZE);
    expect(field.at(0, 0)).toBe(100);
    expect(field.at(TILE_SIZE - 1, TILE_SIZE - 1)).toBe(100);
    expect(field.at(TILE_SIZE, 0)).toBe(0);
    expect(field.at(2 * TILE_SIZE - 1, 128)).toBe(0);
  });

  it('préserve la géométrie ligne par ligne', () => {
    const block = { zoom: 5, x0: 0, y0: 0, tilesX: 1, tilesY: 2 };
    const top = new Float32Array(TILE_SIZE * TILE_SIZE).fill(1);
    const bottom = new Float32Array(TILE_SIZE * TILE_SIZE).fill(2);

    const field = stitchBlock(block, (_x, y) => (y === 0 ? top : bottom));

    expect(field.at(128, TILE_SIZE - 1)).toBe(1);
    expect(field.at(128, TILE_SIZE)).toBe(2);
  });
});
