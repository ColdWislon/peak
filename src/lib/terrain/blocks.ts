import { destinationPoint, type LatLon } from '../geo';
import { HeightField } from './heightField';
import { latToTileY, lonToTileX, TILE_SIZE } from './tiles';

/** Bloc rectangulaire de tuiles XYZ contiguës, au même zoom. */
export interface TileBlock {
  zoom: number;
  /** Colonne de la tuile nord-ouest. */
  x0: number;
  /** Ligne de la tuile nord-ouest. */
  y0: number;
  tilesX: number;
  tilesY: number;
}

/**
 * Bloc de tuiles couvrant un disque de `radiusM` mètres autour de `center`.
 * Limite connue de la v1 : pas de gestion de l'antiméridien (le bloc ne
 * s'enroule pas en longitude), sans conséquence pour les massifs visés.
 */
export function tileBlockAround(center: LatLon, radiusM: number, zoom: number): TileBlock {
  const north = destinationPoint(center, 0, radiusM);
  const east = destinationPoint(center, 90, radiusM);
  const south = destinationPoint(center, 180, radiusM);
  const west = destinationPoint(center, 270, radiusM);

  const maxIndex = 2 ** zoom - 1;
  const clamp = (v: number) => Math.max(0, Math.min(maxIndex, v));

  const x0 = clamp(Math.floor(lonToTileX(west.lon, zoom)));
  const x1 = clamp(Math.floor(lonToTileX(east.lon, zoom)));
  const y0 = clamp(Math.floor(latToTileY(north.lat, zoom)));
  const y1 = clamp(Math.floor(latToTileY(south.lat, zoom)));

  return { zoom, x0, y0, tilesX: x1 - x0 + 1, tilesY: y1 - y0 + 1 };
}

/** Nombre total de tuiles d'un bloc. */
export function tileCount(block: TileBlock): number {
  return block.tilesX * block.tilesY;
}

/**
 * Assemble les tuiles d'un bloc en un unique HeightField.
 * `getTile(x, y)` fournit les 256×256 altitudes de la tuile, ou `undefined`
 * si elle a échoué au chargement (le trou est rempli à 0 : niveau de la mer).
 */
export function stitchBlock(
  block: TileBlock,
  getTile: (x: number, y: number) => Float32Array | undefined,
): HeightField {
  const width = block.tilesX * TILE_SIZE;
  const height = block.tilesY * TILE_SIZE;
  const data = new Float32Array(width * height);

  for (let ty = 0; ty < block.tilesY; ty++) {
    for (let tx = 0; tx < block.tilesX; tx++) {
      const tile = getTile(block.x0 + tx, block.y0 + ty);
      if (!tile) continue;
      for (let row = 0; row < TILE_SIZE; row++) {
        const src = row * TILE_SIZE;
        const dst = (ty * TILE_SIZE + row) * width + tx * TILE_SIZE;
        data.set(tile.subarray(src, src + TILE_SIZE), dst);
      }
    }
  }

  return new HeightField(width, height, data);
}
