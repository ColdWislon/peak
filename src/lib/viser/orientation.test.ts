import { describe, expect, it } from 'vitest';
import { iosCompassToAlpha, orientationToAim } from './orientation';

describe('orientationToAim', () => {
  it('téléphone vertical, caméra plein nord', () => {
    const aim = orientationToAim(0, 90, 0);
    expect(aim.headingDeg).toBeCloseTo(0, 6);
    expect(aim.pitchDeg).toBeCloseTo(0, 6);
  });

  it("téléphone vertical tourné vers l'est", () => {
    const aim = orientationToAim(270, 90, 0);
    expect(aim.headingDeg).toBeCloseTo(90, 6);
    expect(aim.pitchDeg).toBeCloseTo(0, 6);
  });

  it('inclinaison vers le ciel : assiette positive', () => {
    // Penché de 30° en arrière depuis la verticale.
    const aim = orientationToAim(0, 120, 0);
    expect(aim.headingDeg).toBeCloseTo(0, 6);
    expect(aim.pitchDeg).toBeCloseTo(30, 6);
  });

  it('à plat sur la table, écran vers le ciel : caméra vers le sol', () => {
    expect(orientationToAim(0, 0, 0).pitchDeg).toBeCloseTo(-90, 6);
  });

  it('un léger gamma en position verticale décale le cap du même ordre', () => {
    const droit = orientationToAim(0, 90, 0);
    const decale = orientationToAim(0, 90, 8);
    const ecartAngulaire = Math.abs(((decale.headingDeg - droit.headingDeg + 540) % 360) - 180);
    expect(ecartAngulaire).toBeLessThan(9);
    expect(Math.abs(decale.pitchDeg - droit.pitchDeg)).toBeLessThan(2);
  });
});

describe('iosCompassToAlpha', () => {
  it('inverse le cap boussole webkit', () => {
    expect(iosCompassToAlpha(0)).toBe(0);
    expect(iosCompassToAlpha(90)).toBe(270);
    expect(iosCompassToAlpha(270)).toBe(90);
  });
});
