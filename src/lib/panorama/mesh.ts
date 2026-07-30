import { curvatureDrop } from '../geo';
import type { Rgb } from './colors';

/**
 * Construction du maillage de terrain en grille polaire centrée sur l'œil :
 * la densité décroît naturellement avec la distance (LOD sans couture).
 * Module pur (tableaux typés uniquement) — Three.js n'apparaît que dans engine.ts.
 *
 * Repère local : x = est, y = altitude, z = sud (−z pointe au nord).
 */

export interface PolarMeshOptions {
  /** Nombre de secteurs d'azimut (défaut 720, soit 0,5°). */
  azimuthSegments?: number;
  /** Nombre d'anneaux radiaux (défaut 160). */
  radialSegments?: number;
  /** Rayon du premier anneau (m). */
  minRadiusM?: number;
  /** Rayon du dernier anneau (m). */
  maxRadiusM?: number;
}

export interface TerrainMeshData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

/**
 * Échantillonne `sampleElevation` (mètres est/nord → altitude m) sur une grille
 * polaire et produit sommets, couleurs et indices. La courbure terrestre
 * (réfraction comprise) est soustraite de l'altitude selon la distance ; la
 * couleur reflète l'altitude vraie, avant courbure.
 */
export function buildPolarTerrainMesh(
  sampleElevation: (east: number, north: number) => number,
  colorFor: (elevation: number) => Rgb,
  options: PolarMeshOptions = {},
): TerrainMeshData {
  const azimuths = options.azimuthSegments ?? 720;
  const rings = options.radialSegments ?? 160;
  const minR = options.minRadiusM ?? 50;
  const maxR = options.maxRadiusM ?? 110_000;

  if (azimuths < 3 || rings < 2) {
    throw new RangeError(`Grille polaire trop petite : ${azimuths}×${rings}`);
  }

  const vertexCount = 1 + azimuths * rings;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  const writeVertex = (index: number, x: number, y: number, z: number, color: Rgb) => {
    const o = index * 3;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    colors[o] = color[0];
    colors[o + 1] = color[1];
    colors[o + 2] = color[2];
  };

  // Sommet central : le sol sous l'œil.
  const centerElevation = sampleElevation(0, 0);
  writeVertex(0, 0, centerElevation, 0, colorFor(centerElevation));

  const growth = maxR / minR;
  for (let a = 0; a < azimuths; a++) {
    const az = (a / azimuths) * 2 * Math.PI;
    const sin = Math.sin(az);
    const cos = Math.cos(az);
    for (let i = 0; i < rings; i++) {
      const r = minR * growth ** (i / (rings - 1));
      const east = sin * r;
      const north = cos * r;
      const elevation = sampleElevation(east, north);
      const y = elevation - curvatureDrop(r);
      writeVertex(1 + a * rings + i, east, y, -north, colorFor(elevation));
    }
  }

  // Indices : éventail central + quads entre anneaux, avec couture d'azimut refermée.
  const indices = new Uint32Array(azimuths * 3 + azimuths * (rings - 1) * 6);
  let k = 0;
  const vert = (a: number, i: number) => 1 + (a % azimuths) * rings + i;

  // Même sens de rotation que les quads, sinon les normales moyennées du
  // premier anneau s'annulent (bande noire à l'écran).
  for (let a = 0; a < azimuths; a++) {
    indices[k++] = 0;
    indices[k++] = vert(a + 1, 0);
    indices[k++] = vert(a, 0);
  }
  for (let a = 0; a < azimuths; a++) {
    for (let i = 0; i < rings - 1; i++) {
      const v00 = vert(a, i);
      const v01 = vert(a, i + 1);
      const v10 = vert(a + 1, i);
      const v11 = vert(a + 1, i + 1);
      indices[k++] = v00;
      indices[k++] = v10;
      indices[k++] = v11;
      indices[k++] = v00;
      indices[k++] = v11;
      indices[k++] = v01;
    }
  }

  return { positions, colors, indices, vertexCount };
}
