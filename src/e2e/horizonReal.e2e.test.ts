import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  apparentElevationAngle,
  haversineDistance,
  initialBearing,
  radToDeg,
  type LatLon,
} from '../lib/geo';
import { makeBlendedSampler } from '../lib/panorama/sampler';
import { stitchBlock, tileBlockAround, type TileBlock } from '../lib/terrain/blocks';
import { GeoHeightField } from '../lib/terrain/heightField';
import { decodeTerrariumRgba } from '../lib/terrain/terrarium';
import { terrariumTileUrl } from '../lib/terrain/tiles';
import { computeDemSkyline } from '../lib/viser/skyline';
import type { ElevationSampler } from '../lib/visibility';
import { decodePng } from './png';

/**
 * Bout en bout « données réelles » (opt-in : CIMES_E2E=1) : télécharge les
 * vraies tuiles AWS Terrain Tiles autour de Chamonix, déroule la chaîne de
 * production réelle (assemblage → champ géoréférencé → échantillonneur fondu →
 * profil d'horizon) et vérifie que des sommets connus ressortent au bon cap et
 * au bon angle d'élévation. Attrape les erreurs de géoréférencement et de
 * décodage que les tests unitaires synthétiques ne peuvent pas voir.
 * Réseau requis ; les tuiles sont mises en cache sur disque entre exécutions.
 */

const run = promisify(execFile);

const CHAMONIX: LatLon = { lat: 45.9237, lon: 6.8694 };
/** Sommets de contrôle (nœuds OSM) vus depuis le centre de Chamonix.
 *  `dominant` : le sommet EST la ligne d'horizon à son cap (rien de plus haut
 *  angulairement sur son rayon) — on peut alors vérifier cap et angle exacts.
 *  Sinon (Aiguille Verte, masquée par la crête du Montenvers depuis le centre
 *  ville), seul le plancher vaut : le profil doit au moins atteindre le sommet. */
const SUMMITS = [
  { name: 'Mont Blanc', lat: 45.83262, lon: 6.86521, elevation: 4808, dominant: true },
  { name: 'Aiguille du Midi', lat: 45.87843, lon: 6.88752, elevation: 3842, dominant: true },
  { name: 'Aiguille Verte', lat: 45.93454, lon: 7.00311, elevation: 4122, dominant: false },
] as const;

const INNER = { zoom: 12, radiusM: 24_000 };
const OUTER = { zoom: 10, radiusM: 70_000 };
const SKYLINE_STEP_DEG = 0.25;
const SKYLINE_MAX_M = 60_000;

const CACHE_DIR = join(process.cwd(), 'node_modules', '.cache', 'cimes-e2e-tiles');

function tileJobs(block: TileBlock): Array<{ x: number; y: number; url: string; file: string }> {
  const jobs = [];
  for (let ty = 0; ty < block.tilesY; ty++) {
    for (let tx = 0; tx < block.tilesX; tx++) {
      const x = block.x0 + tx;
      const y = block.y0 + ty;
      jobs.push({
        x,
        y,
        url: terrariumTileUrl(block.zoom, x, y),
        file: join(CACHE_DIR, `${block.zoom}-${x}-${y}.png`),
      });
    }
  }
  return jobs;
}

let downloadBatch = 0;

/** Télécharge les tuiles manquantes en parallèle (curl honore HTTPS_PROXY). */
async function downloadMissing(jobs: Array<{ url: string; file: string }>): Promise<void> {
  const missing = jobs.filter((job) => !existsSync(job.file));
  if (missing.length === 0) return;
  const config = missing.map((job) => `url = "${job.url}"\noutput = "${job.file}"`).join('\n');
  const configFile = join(CACHE_DIR, `curl-config-${downloadBatch++}.txt`);
  writeFileSync(configFile, config);
  await run(
    'curl',
    ['-sS', '--fail', '--parallel', '--parallel-max', '8', '--retry', '2', '--config', configFile],
    {
      timeout: 180_000,
    },
  );
}

async function loadRealField(block: TileBlock): Promise<GeoHeightField> {
  const jobs = tileJobs(block);
  await downloadMissing(jobs);
  const tiles = new Map<string, Float32Array>();
  for (const job of jobs) {
    const { width, height, rgba } = decodePng(readFileSync(job.file));
    expect(width).toBe(256);
    expect(height).toBe(256);
    tiles.set(`${job.x}/${job.y}`, decodeTerrariumRgba(rgba));
  }
  const field = stitchBlock(block, (x, y) => tiles.get(`${x}/${y}`));
  return new GeoHeightField(block.zoom, block.x0, block.y0, field);
}

describe.skipIf(!process.env.CIMES_E2E)('bout en bout : tuiles réelles → horizon', () => {
  let sample: ElevationSampler;
  let eyeElevation = 0;
  let skyline: Float32Array;

  beforeAll(async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    const [inner, outer] = await Promise.all([
      loadRealField(tileBlockAround(CHAMONIX, INNER.radiusM, INNER.zoom)),
      loadRealField(tileBlockAround(CHAMONIX, OUTER.radiusM, OUTER.zoom)),
    ]);
    expect(inner.contains(CHAMONIX)).toBe(true);
    eyeElevation = inner.elevationAt(CHAMONIX) + 1.7;
    sample = makeBlendedSampler(CHAMONIX, inner, outer, INNER.radiusM);
    skyline = computeDemSkyline(sample, eyeElevation, {
      stepDeg: SKYLINE_STEP_DEG,
      maxDistanceM: SKYLINE_MAX_M,
    });
  }, 300_000);

  /** Lecture interpolée du profil (°), même convention que demAngleDeg. */
  function skylineDeg(azimuthDeg: number): number {
    const pos = (((azimuthDeg % 360) + 360) % 360) / SKYLINE_STEP_DEG;
    const i = Math.floor(pos) % skyline.length;
    const j = (i + 1) % skyline.length;
    const t = pos - Math.floor(pos);
    return radToDeg(skyline[i]! * (1 - t) + skyline[j]! * t);
  }

  it('place l’œil à l’altitude de la vallée de Chamonix', () => {
    expect(eyeElevation).toBeGreaterThan(980);
    expect(eyeElevation).toBeLessThan(1120);
  });

  it('produit un profil fini sur 360°', () => {
    expect(skyline).toHaveLength(Math.round(360 / SKYLINE_STEP_DEG));
    for (const angle of skyline) expect(Number.isFinite(angle)).toBe(true);
  });

  for (const summit of SUMMITS) {
    it(`voit ${summit.name} au bon cap et au bon angle`, () => {
      const bearing = initialBearing(CHAMONIX, summit);
      const distance = haversineDistance(CHAMONIX, summit);
      const expected = radToDeg(apparentElevationAngle(distance, summit.elevation - eyeElevation));

      // Plancher universel : le sommet est du terrain sur son rayon, le profil
      // ne peut pas passer dessous (marge : lissage du DEM, z12 ≈ 27 m/pixel).
      const atBearing = skylineDeg(bearing);
      expect(atBearing).toBeGreaterThan(expected - 0.9);
      if (!summit.dominant) return;

      // Sommet dominant : le profil à son cap est SON angle, pas plus…
      expect(atBearing).toBeLessThan(expected + 0.3);

      // …et le maximum local du profil tombe à son cap vrai — c'est le test du
      // gauchissement d'azimut (l'équirectangulaire le décalait de ~0,1-0,4°).
      let bestAz = bearing - 2;
      let bestVal = -Infinity;
      for (let az = bearing - 2; az <= bearing + 2; az += 0.05) {
        const v = skylineDeg(az);
        if (v > bestVal) {
          bestVal = v;
          bestAz = az;
        }
      }
      expect(Math.abs(bestAz - bearing)).toBeLessThanOrEqual(0.6);
    });
  }
});
