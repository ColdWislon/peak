import { describe, expect, it } from 'vitest';
import { deviceEquivFocalMm, priorShortFovDeg, shortFovFromEquivFocal } from './deviceFov';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/124 Mobile';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

describe('deviceEquivFocalMm', () => {
  it('reconnaît les familles Android par le modèle Client Hints', () => {
    expect(deviceEquivFocalMm('Pixel 8 Pro', ANDROID_UA)?.equivFocalMm).toBe(25);
    expect(deviceEquivFocalMm('Pixel 4a', ANDROID_UA)?.equivFocalMm).toBe(27);
    expect(deviceEquivFocalMm('SM-S918B', ANDROID_UA)?.equivFocalMm).toBe(23);
    expect(deviceEquivFocalMm('SM-G991U', ANDROID_UA)?.equivFocalMm).toBe(26);
  });

  it("reconnaît l'iPhone au user-agent (pas de modèle exposé par Safari)", () => {
    expect(deviceEquivFocalMm(null, IPHONE_UA)?.family).toBe('iPhone');
  });

  it('rend null pour un appareil inconnu', () => {
    expect(deviceEquivFocalMm('Etrange X1', ANDROID_UA)).toBeNull();
    expect(deviceEquivFocalMm(null, DESKTOP_UA)).toBeNull();
  });
});

describe('shortFovFromEquivFocal', () => {
  it('26 mm équivalent : ~53° en 4:3, ~41° en 16:9 (recadrage vertical)', () => {
    expect(shortFovFromEquivFocal(26, 1440, 1080)).toBeCloseTo(53.1, 1);
    expect(shortFovFromEquivFocal(26, 1920, 1080)).toBeCloseTo(41.1, 1);
  });

  it('est indifférent à l’orientation du flux (portrait = paysage)', () => {
    expect(shortFovFromEquivFocal(26, 1080, 1920)).toBeCloseTo(
      shortFovFromEquivFocal(26, 1920, 1080),
      6,
    );
  });

  it('un flux plus carré que 4:3 garde le petit côté entier du capteur', () => {
    expect(shortFovFromEquivFocal(26, 1000, 1000)).toBeCloseTo(
      shortFovFromEquivFocal(26, 1440, 1080),
      6,
    );
  });
});

describe('priorShortFovDeg', () => {
  it('appareil inconnu en 4:3 : exactement le défaut (aucune régression)', () => {
    const prior = priorShortFovDeg({
      model: null,
      userAgent: DESKTOP_UA,
      videoW: 1440,
      videoH: 1080,
      fallbackShortFovDeg: 55,
    });
    expect(prior.shortFovDeg).toBeCloseTo(55, 6);
  });

  it('appareil inconnu en 16:9 : le défaut est corrigé de l’aspect (~42,7°)', () => {
    const prior = priorShortFovDeg({
      model: null,
      userAgent: DESKTOP_UA,
      videoW: 1920,
      videoH: 1080,
      fallbackShortFovDeg: 55,
    });
    expect(prior.shortFovDeg).toBeCloseTo(42.7, 1);
    expect(prior.source).toContain('aspect');
  });

  it('iPhone en 16:9 : famille + aspect (~41°), source explicite', () => {
    const prior = priorShortFovDeg({
      model: null,
      userAgent: IPHONE_UA,
      videoW: 1920,
      videoH: 1080,
      fallbackShortFovDeg: 55,
    });
    expect(prior.shortFovDeg).toBeCloseTo(41.1, 1);
    expect(prior.source).toContain('iPhone');
  });

  it('Galaxy S récent en 4:3 : optique plus large que le défaut (~58,9°)', () => {
    const prior = priorShortFovDeg({
      model: 'SM-S928B',
      userAgent: ANDROID_UA,
      videoW: 1440,
      videoH: 1080,
      fallbackShortFovDeg: 55,
    });
    expect(prior.shortFovDeg).toBeCloseTo(58.9, 1);
  });
});
