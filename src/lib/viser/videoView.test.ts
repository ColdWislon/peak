import { describe, expect, it } from 'vitest';
import { coverCrop, screenFovDeg, shortSideFovDeg } from './videoView';

describe('coverCrop', () => {
  it('paysage : toute la largeur du cadre, bande verticale centrée (cas du rapport terrain)', () => {
    // iPhone en paysage : vue 750×326, flux 640×480 (4:3).
    const crop = coverCrop(640, 480, 750, 326);
    expect(crop.sx).toBe(0);
    expect(crop.sw).toBe(640);
    expect(crop.sh).toBeCloseTo(278.19, 1);
    expect(crop.sy).toBeCloseTo((480 - crop.sh) / 2, 6);
  });

  it('portrait : toute la hauteur du cadre, bande horizontale centrée', () => {
    const crop = coverCrop(480, 640, 375, 600);
    expect(crop.sy).toBe(0);
    expect(crop.sh).toBe(640);
    expect(crop.sw).toBeCloseTo(400, 6);
    expect(crop.sx).toBeCloseTo(40, 6);
  });

  it('aspects identiques : plein cadre', () => {
    const crop = coverCrop(640, 480, 320, 240);
    expect(crop).toEqual({ sx: 0, sy: 0, sw: 640, sh: 480 });
  });
});

describe('screenFovDeg / shortSideFovDeg', () => {
  it('paysage : le FOV d’écran est bien plus étroit que celui du capteur', () => {
    // ~58 % de la hauteur du cadre visible → tan compressé d'autant.
    expect(screenFovDeg(55, 640, 480, 750, 326)).toBeCloseTo(33.57, 1);
  });

  it('portrait : le FOV vertical d’écran est celui du grand côté du capteur', () => {
    // Hauteur du cadre entièrement visible : 2·atan(tan(55/2)·640/480).
    expect(screenFovDeg(55, 480, 640, 375, 600)).toBeCloseTo(69.53, 1);
  });

  it('aller-retour exact entre FOV d’écran et FOV du petit côté', () => {
    for (const [vw, vh, cw, ch] of [
      [640, 480, 750, 326],
      [480, 640, 375, 600],
      [1280, 720, 900, 500],
    ] as const) {
      const screen = screenFovDeg(62, vw, vh, cw, ch);
      expect(shortSideFovDeg(screen, vw, vh, cw, ch)).toBeCloseTo(62, 6);
    }
  });

  it('même valeur quel que soit le sens du flux à découpe égale', () => {
    // Le petit côté du capteur est le même en 640×480 et 480×640.
    const landscape = screenFovDeg(55, 640, 480, 640, 480);
    const portrait = screenFovDeg(55, 480, 640, 480, 640);
    expect(landscape).toBeCloseTo(55, 6);
    expect(portrait).toBeGreaterThan(55); // grand côté vertical en portrait
  });
});
