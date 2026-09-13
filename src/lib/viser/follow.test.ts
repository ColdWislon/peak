import { describe, expect, it } from 'vitest';
import { MOVE_MIN_INTERVAL_MS, shouldMoveViewpoint } from './follow';

const here = { lat: 45.9237, lon: 6.8694 };
/** ~1 m de latitude. */
const DEG_PER_M = 1 / 111_320;

function fix(northM: number, accuracyM = 10, timeMs = 100_000) {
  return { lat: here.lat + northM * DEG_PER_M, lon: here.lon, accuracyM, timeMs };
}

describe('shouldMoveViewpoint', () => {
  it('reste en place pour un déplacement sous le seuil', () => {
    expect(shouldMoveViewpoint(here, fix(20), null)).toBe(false);
  });

  it('suit un vrai déplacement précis', () => {
    expect(shouldMoveViewpoint(here, fix(60), null)).toBe(true);
  });

  it('ignore un déplacement plus petit que l’incertitude du relevé', () => {
    expect(shouldMoveViewpoint(here, fix(80, 200), null)).toBe(false);
    // …mais suit quand le déplacement dépasse cette incertitude.
    expect(shouldMoveViewpoint(here, fix(400, 200), null)).toBe(true);
  });

  it('rejette un relevé trop grossier, même lointain', () => {
    expect(shouldMoveViewpoint(here, fix(5_000, 900), null)).toBe(false);
  });

  it('ne recharge pas plus vite que la cadence', () => {
    const t = 100_000;
    expect(shouldMoveViewpoint(here, fix(60, 10, t), t - MOVE_MIN_INTERVAL_MS / 2)).toBe(false);
    expect(shouldMoveViewpoint(here, fix(60, 10, t), t - MOVE_MIN_INTERVAL_MS)).toBe(true);
  });

  it('rejette un relevé sans coordonnées', () => {
    expect(shouldMoveViewpoint(here, { lat: NaN, lon: 0, accuracyM: 5, timeMs: 0 }, null)).toBe(
      false,
    );
  });
});
