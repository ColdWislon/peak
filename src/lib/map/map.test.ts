import { describe, expect, it } from 'vitest';
import { roundRadiusM, visibleRadiusM } from './index';

describe('visibleRadiusM', () => {
  it('couvre la demi-diagonale du viewport', () => {
    // À l'équateur, zoom 0 : 156 543 m/px ; viewport 3-4-5 → diagonale 500 px.
    expect(visibleRadiusM(0, 0, 300, 400)).toBeCloseTo((156_543.03 * 500) / 2, -2);
  });

  it('diminue quand on zoome', () => {
    expect(visibleRadiusM(46, 12, 1280, 800)).toBeLessThan(visibleRadiusM(46, 8, 1280, 800));
  });
});

describe('roundRadiusM', () => {
  it('arrondit au pas de 5 km avec plancher', () => {
    expect(roundRadiusM(23_400)).toBe(25_000);
    expect(roundRadiusM(22_400)).toBe(20_000);
    expect(roundRadiusM(1_200)).toBe(5_000);
  });
});
