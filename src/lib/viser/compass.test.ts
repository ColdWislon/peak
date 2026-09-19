import { describe, expect, it } from 'vitest';
import type { ViewGeometry } from '../labels';
import {
  compassBands,
  compassTicks,
  halfHorizontalFovDeg,
  RAW_BAND_MIN_OFFSET_DEG,
  TICK_STEP_DEG,
} from './compass';

/** Vue carrée commode : FOV 90° et aspect 1 → demi-champ horizontal de 45° exactement. */
const SQUARE: ViewGeometry = { headingDeg: 0, pitchDeg: 0, fovDeg: 90, width: 800, height: 800 };

describe('halfHorizontalFovDeg', () => {
  it('vue carrée à FOV 90° : demi-champ de 45°', () => {
    expect(halfHorizontalFovDeg(SQUARE)).toBeCloseTo(45, 9);
  });

  it('portrait téléphone : le champ horizontal est plus étroit que le vertical', () => {
    // Mêmes nombres que les tests de videoView : FOV vertical 69,53°, vue 375×600.
    const half = halfHorizontalFovDeg({ ...SQUARE, fovDeg: 69.53, width: 375, height: 600 });
    expect(half * 2).toBeLessThan(69.53);
    expect(half).toBeCloseTo(23.45, 1);
  });
});

describe('compassTicks', () => {
  it('cap nord, vue carrée : N au centre, bords du ruban aux bords du champ', () => {
    const ticks = compassTicks(SQUARE);
    // Multiples de 5° dans [−45°, +45°] : 19 graduations, de 315° à 45°.
    expect(ticks).toHaveLength(19);
    const north = ticks.find((t) => t.azimuthDeg === 0)!;
    expect(north.x).toBeCloseTo(400, 6);
    expect(north.cardinal).toBe(true);
    expect(ticks[0]!).toMatchObject({ azimuthDeg: 315, cardinal: true });
    expect(ticks[0]!.x).toBeCloseTo(0, 6);
    expect(ticks.at(-1)!).toMatchObject({ azimuthDeg: 45, cardinal: true });
    expect(ticks.at(-1)!.x).toBeCloseTo(800, 6);
  });

  it('graduations ordonnées de gauche à droite et symétriques autour du cap', () => {
    const ticks = compassTicks(SQUARE);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!.x).toBeGreaterThan(ticks[i - 1]!.x);
    }
    const west5 = ticks.find((t) => t.azimuthDeg === 355)!;
    const east5 = ticks.find((t) => t.azimuthDeg === 5)!;
    expect(400 - west5.x).toBeCloseTo(east5.x - 400, 6);
  });

  it('projection en tangente : les graduations s’espacent vers les bords (pas linéaire)', () => {
    const ticks = compassTicks(SQUARE);
    const x = (az: number) => ticks.find((t) => t.azimuthDeg === az)!.x;
    const center = x(5) - x(0);
    const edge = x(45) - x(40);
    expect(edge).toBeGreaterThan(center * 1.5);
  });

  it('franchissement du nord : azimuts normalisés dans [0, 360), N visible', () => {
    const ticks = compassTicks({ ...SQUARE, headingDeg: 350 });
    expect(ticks.every((t) => t.azimuthDeg >= 0 && t.azimuthDeg < 360)).toBe(true);
    const north = ticks.find((t) => t.azimuthDeg === 0)!;
    // rel = +10° → x = 400·(1 + tan 10°).
    expect(north.x).toBeCloseTo(400 * (1 + Math.tan((10 * Math.PI) / 180)), 6);
    expect(ticks.some((t) => t.azimuthDeg === 305)).toBe(true);
    expect(ticks.some((t) => t.azimuthDeg === 35)).toBe(true);
  });

  it('hiérarchie des graduations : 45° cardinale, 15° haute, 5° fine', () => {
    const ticks = compassTicks(SQUARE);
    const at = (az: number) => ticks.find((t) => t.azimuthDeg === az)!;
    expect(at(45)).toMatchObject({ cardinal: true, major: true });
    expect(at(15)).toMatchObject({ cardinal: false, major: true });
    expect(at(5)).toMatchObject({ cardinal: false, major: false });
    expect(TICK_STEP_DEG).toBe(5);
  });

  it('l’assiette est ignorée : ruban identique en visant l’horizon ou le sol', () => {
    const level = compassTicks({ ...SQUARE, headingDeg: 123.4 });
    const down = compassTicks({ ...SQUARE, headingDeg: 123.4, pitchDeg: -35 });
    expect(down).toEqual(level);
  });

  it('cap quelconque en portrait : toutes les graduations restent dans la vue', () => {
    const view = { ...SQUARE, headingDeg: 267.8, fovDeg: 69.53, width: 375, height: 600 };
    const ticks = compassTicks(view);
    expect(ticks.length).toBeGreaterThan(5);
    for (const tick of ticks) {
      expect(tick.x).toBeGreaterThanOrEqual(0);
      expect(tick.x).toBeLessThanOrEqual(375);
      expect(tick.azimuthDeg % TICK_STEP_DEG).toBe(0);
    }
  });
});

describe('compassBands', () => {
  it('sans recalage : un seul ruban, le cap brut est le cap affiché', () => {
    const bands = compassBands({ ...SQUARE, headingDeg: 120 }, 0);
    expect(bands.aimed).toEqual(compassTicks({ ...SQUARE, headingDeg: 120 }));
    expect(bands.raw).toEqual([]);
    expect(bands.headingDeg).toBe(120);
    expect(bands.rawHeadingDeg).toBe(120);
    expect(bands.offsetDeg).toBe(0);
  });

  it('recalage : le ruban brut est celui des capteurs, décalé du recalage', () => {
    const bands = compassBands({ ...SQUARE, headingDeg: 120 }, 18);
    expect(bands.rawHeadingDeg).toBeCloseTo(102, 9);
    expect(bands.raw).toEqual(compassTicks({ ...SQUARE, headingDeg: 102 }));
    // Même azimut : le ruban brut le place plus à droite (le nord brut est
    // « en avance » de 18° sur le nord recalé).
    const at = (ticks: ReturnType<typeof compassTicks>, az: number) =>
      ticks.find((t) => t.azimuthDeg === az)!.x;
    expect(at(bands.raw, 120)).toBeGreaterThan(at(bands.aimed, 120));
  });

  it('recalage négligeable : pas de second ruban (les deux seraient confondus)', () => {
    const under = compassBands({ ...SQUARE, headingDeg: 12 }, RAW_BAND_MIN_OFFSET_DEG / 2);
    expect(under.raw).toEqual([]);
    const over = compassBands({ ...SQUARE, headingDeg: 12 }, RAW_BAND_MIN_OFFSET_DEG);
    expect(over.raw.length).toBeGreaterThan(0);
  });

  it('recalage rendu par l’arc court et caps normalisés au franchissement du nord', () => {
    const bands = compassBands({ ...SQUARE, headingDeg: 5 }, 350);
    expect(bands.offsetDeg).toBeCloseTo(-10, 9);
    expect(bands.rawHeadingDeg).toBeCloseTo(15, 9);
    expect(bands.headingDeg).toBe(5);
    expect(bands.raw.every((t) => t.azimuthDeg >= 0 && t.azimuthDeg < 360)).toBe(true);
  });
});
