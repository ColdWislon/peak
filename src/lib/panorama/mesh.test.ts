import { describe, expect, it } from 'vitest';
import { curvatureDrop } from '../geo';
import { elevationToColor } from './colors';
import { buildPolarTerrainMesh } from './mesh';

const flat = () => 100;
const white: [number, number, number] = [1, 1, 1];
const opts = { azimuthSegments: 8, radialSegments: 4, minRadiusM: 100, maxRadiusM: 1000 };

describe('buildPolarTerrainMesh', () => {
  it('produit les bons volumes de sommets et de triangles', () => {
    const mesh = buildPolarTerrainMesh(flat, () => white, opts);
    expect(mesh.vertexCount).toBe(1 + 8 * 4);
    expect(mesh.positions).toHaveLength(mesh.vertexCount * 3);
    expect(mesh.colors).toHaveLength(mesh.vertexCount * 3);
    expect(mesh.indices).toHaveLength(8 * 3 + 8 * 3 * 6);
  });

  it('rejette une grille dégénérée', () => {
    expect(() => buildPolarTerrainMesh(flat, () => white, { azimuthSegments: 2 })).toThrow(
      RangeError,
    );
  });

  it("n'indexe que des sommets existants (couture refermée)", () => {
    const mesh = buildPolarTerrainMesh(flat, () => white, opts);
    let max = 0;
    for (const idx of mesh.indices) {
      expect(idx).toBeLessThan(mesh.vertexCount);
      max = Math.max(max, idx);
    }
    expect(max).toBe(mesh.vertexCount - 1);
  });

  it('applique la chute de courbure : un sol plat s’abaisse avec la distance', () => {
    const mesh = buildPolarTerrainMesh(flat, () => white, opts);
    // Sommet central : altitude vraie.
    expect(mesh.positions[1]).toBeCloseTo(100, 6);
    // Premier et dernier anneau du premier azimut (nord) : y = 100 − drop(r).
    const firstY = mesh.positions[1 * 3 + 1]!;
    const lastY = mesh.positions[4 * 3 + 1]!;
    // Tolérance au millimètre : les positions sont stockées en Float32.
    expect(firstY).toBeCloseTo(100 - curvatureDrop(100), 3);
    expect(lastY).toBeCloseTo(100 - curvatureDrop(1000), 3);
    expect(lastY).toBeLessThan(firstY);
  });

  it('oriente les axes : azimut 0 = nord = −z, azimut 90° = est = +x', () => {
    const mesh = buildPolarTerrainMesh(flat, () => white, opts);
    // a=0, i=0 → plein nord à 100 m.
    expect(mesh.positions[3]).toBeCloseTo(0, 6);
    expect(mesh.positions[5]).toBeCloseTo(-100, 6);
    // a=2 (90°), i=0 → plein est à 100 m.
    const v = (1 + 2 * 4 + 0) * 3;
    expect(mesh.positions[v]).toBeCloseTo(100, 6);
    expect(mesh.positions[v + 2]).toBeCloseTo(0, 6);
  });

  it('colore selon l’altitude vraie, avant courbure', () => {
    const mesh = buildPolarTerrainMesh(() => 3500, elevationToColor, opts);
    const expected = elevationToColor(3500);
    expect(mesh.colors[0]).toBeCloseTo(expected[0], 6);
    expect(mesh.colors[1]).toBeCloseTo(expected[1], 6);
    expect(mesh.colors[2]).toBeCloseTo(expected[2], 6);
  });
});

describe('elevationToColor', () => {
  it('rend l’eau bleue et la haute montagne blanche', () => {
    const water = elevationToColor(-5);
    expect(water[2]).toBeGreaterThan(water[0]);
    const snow = elevationToColor(4808);
    expect(snow[0]).toBeGreaterThan(0.9);
    expect(snow[1]).toBeGreaterThan(0.9);
    expect(snow[2]).toBeGreaterThan(0.9);
  });

  it('interpole continûment entre les paliers', () => {
    const a = elevationToColor(2650);
    const b = elevationToColor(3000);
    const mid = elevationToColor(2825);
    for (let c = 0; c < 3; c++) {
      expect(mid[c]).toBeGreaterThan(Math.min(a[c]!, b[c]!) - 1e-9);
      expect(mid[c]).toBeLessThan(Math.max(a[c]!, b[c]!) + 1e-9);
    }
  });
});
