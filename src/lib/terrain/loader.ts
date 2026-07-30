import type { LatLon } from '../geo';
import { stitchBlock, tileBlockAround, tileCount, type TileBlock } from './blocks';
import { GeoHeightField } from './heightField';
import { decodeTerrariumRgba } from './terrarium';
import { terrariumTileUrl, TILE_SIZE } from './tiles';

/**
 * Chargement réseau des tuiles terrarium — seule partie du module terrain qui
 * touche au navigateur (fetch, ImageBitmap, OffscreenCanvas). Couche volontairement
 * mince : tout ce qui se calcule est dans blocks.ts / heightField.ts, testés.
 */

const cache = new Map<string, Promise<Float32Array | undefined>>();
const CACHE_MAX_ENTRIES = 512;

function rememberTile(key: string, value: Promise<Float32Array | undefined>): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** Télécharge et décode une tuile terrarium ; `undefined` en cas d'échec. */
export function loadTileElevations(
  zoom: number,
  x: number,
  y: number,
): Promise<Float32Array | undefined> {
  const key = `${zoom}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = fetchAndDecode(zoom, x, y).catch(() => undefined);
  rememberTile(key, pending);
  return pending;
}

async function fetchAndDecode(zoom: number, x: number, y: number): Promise<Float32Array> {
  const response = await fetch(terrariumTileUrl(zoom, x, y));
  if (!response.ok) {
    throw new Error(`Tuile ${zoom}/${x}/${y} : HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Contexte 2d indisponible');
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    return decodeTerrariumRgba(image.data);
  } finally {
    bitmap.close();
  }
}

export interface LoadBlockOptions {
  /** Téléchargements simultanés (défaut : 8). */
  concurrency?: number;
  /** Appelé après chaque tuile (chargée ou échouée) avec l'avancement 0..1. */
  onProgress?: (done: number, total: number) => void;
}

/** Charge toutes les tuiles d'un bloc et les assemble en champ géoréférencé. */
export async function loadBlockHeightField(
  block: TileBlock,
  options: LoadBlockOptions = {},
): Promise<GeoHeightField> {
  const { concurrency = 8, onProgress } = options;
  const total = tileCount(block);
  const tiles = new Map<string, Float32Array>();

  const jobs: Array<{ x: number; y: number }> = [];
  for (let ty = 0; ty < block.tilesY; ty++) {
    for (let tx = 0; tx < block.tilesX; tx++) {
      jobs.push({ x: block.x0 + tx, y: block.y0 + ty });
    }
  }

  let done = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const data = await loadTileElevations(block.zoom, job.x, job.y);
      if (data) tiles.set(`${job.x}/${job.y}`, data);
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const field = stitchBlock(block, (x, y) => tiles.get(`${x}/${y}`));
  return new GeoHeightField(block.zoom, block.x0, block.y0, field);
}

/** Raccourci : champ géoréférencé couvrant un disque autour d'un point. */
export async function loadHeightFieldAround(
  center: LatLon,
  radiusM: number,
  zoom: number,
  options?: LoadBlockOptions,
): Promise<GeoHeightField> {
  return loadBlockHeightField(tileBlockAround(center, radiusM, zoom), options);
}
