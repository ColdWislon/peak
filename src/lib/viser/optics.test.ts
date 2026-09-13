import { describe, expect, it } from 'vitest';
import { addFovSample, fovSampleWeight, MAX_FOV_SAMPLES, smoothedFovDeg } from './optics';

describe('fovSampleWeight', () => {
  it('vaut plein poids sur une crête ample bien alignée', () => {
    expect(fovSampleWeight(12, 0)).toBe(1);
  });

  it('pèse peu sur une crête plate ou un alignement médiocre', () => {
    expect(fovSampleWeight(3, 0.2)).toBeLessThan(0.3);
    expect(fovSampleWeight(12, 1.2)).toBeLessThan(0.25);
  });

  it('reste strictement positif', () => {
    expect(fovSampleWeight(0, 5)).toBeGreaterThan(0);
  });
});

describe('smoothedFovDeg', () => {
  it('rend null sans mesure', () => {
    expect(smoothedFovDeg([])).toBeNull();
  });

  it('rend la mesure seule', () => {
    expect(smoothedFovDeg([{ fovDeg: 53.5, weight: 0.4 }])).toBe(53.5);
  });

  it('ignore une mesure aberrante quand les autres concordent', () => {
    // Rapport terrain n° 10 : 41,4° et 46,0° sur crête plate, 51,5° et 53,5°
    // sur crêtes amples — la médiane pondérée suit les mesures qui valent.
    const samples = [
      { fovDeg: 53.5, weight: 0.8 },
      { fovDeg: 51.5, weight: 0.7 },
      { fovDeg: 41.4, weight: 0.15 },
      { fovDeg: 46, weight: 0.2 },
    ];
    expect(smoothedFovDeg(samples)).toBe(51.5);
  });

  it('une mesure ancienne finit par s’effacer', () => {
    let samples = [{ fovDeg: 41, weight: 1 }];
    for (let i = 0; i < MAX_FOV_SAMPLES; i++) {
      samples = addFovSample(samples, { fovDeg: 52, weight: 0.5 });
    }
    expect(samples).toHaveLength(MAX_FOV_SAMPLES);
    expect(samples.every((s) => s.fovDeg === 52)).toBe(true);
    expect(smoothedFovDeg(samples)).toBe(52);
  });

  it('addFovSample ne mute pas la liste reçue', () => {
    const samples = [{ fovDeg: 50, weight: 1 }];
    addFovSample(samples, { fovDeg: 52, weight: 1 });
    expect(samples).toHaveLength(1);
  });
});
