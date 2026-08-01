import { describe, expect, it } from 'vitest';
import type { ViewGeometry } from '../labels';
import { compassTicks, halfHorizontalFovDeg, TICK_STEP_DEG } from './compass';

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
