import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, type Settings } from './index';

describe('parseSettings', () => {
  it('boucle avec serializeSettings', () => {
    const settings: Settings = {
      quality: 'eco',
      units: 'imperial',
      names: 'local',
      cameraShortFovDeg: 68.5,
      cameraStreamAspect: 1.333,
      cameraFovSamples: [{ fovDeg: 68.5, weight: 0.6 }],
    };
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });

  it('rejette un FOV caméra absurde', () => {
    expect(parseSettings('{"cameraShortFovDeg":300}').cameraShortFovDeg).toBeNull();
    expect(parseSettings('{"cameraShortFovDeg":"large"}').cameraShortFovDeg).toBeNull();
  });

  it('ignore l’ancien cameraFovDeg (FOV d’écran, sémantique différente)', () => {
    expect(parseSettings('{"cameraFovDeg":68.5}').cameraShortFovDeg).toBeNull();
  });

  it('rejette un aspect de flux absurde, garde un aspect plausible', () => {
    expect(parseSettings('{"cameraStreamAspect":0}').cameraStreamAspect).toBeNull();
    expect(parseSettings('{"cameraStreamAspect":"16:9"}').cameraStreamAspect).toBeNull();
    expect(parseSettings('{"cameraStreamAspect":1.778}').cameraStreamAspect).toBe(1.778);
    // Étalonnage d'avant ce champ : aspect inconnu, la mesure reste utilisable.
    expect(parseSettings('{"cameraShortFovDeg":55}').cameraStreamAspect).toBeNull();
  });

  it('ne garde que des mesures de FOV plausibles', () => {
    const parsed = parseSettings(
      '{"cameraFovSamples":[{"fovDeg":52,"weight":0.5},{"fovDeg":300,"weight":1},' +
        '{"fovDeg":50,"weight":0},"x",{"fovDeg":48}]}',
    );
    expect(parsed.cameraFovSamples).toEqual([{ fovDeg: 52, weight: 0.5 }]);
    expect(parseSettings('{"cameraFovSamples":"aucune"}').cameraFovSamples).toEqual([]);
  });

  it('retombe sur les défauts pour null, JSON cassé ou valeurs inconnues', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{pas du json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"quality":"ultra","units":"coudées","names":"latin"}')).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('complète les champs manquants sans toucher aux valides', () => {
    expect(parseSettings('{"units":"imperial"}')).toEqual({
      quality: 'auto',
      units: 'imperial',
      names: 'fr',
      cameraShortFovDeg: null,
      cameraStreamAspect: null,
      cameraFovSamples: [],
    });
  });

  it('ne partage jamais l’objet par défaut (pas de mutation croisée)', () => {
    const a = parseSettings(null);
    a.units = 'imperial';
    expect(parseSettings(null).units).toBe('metric');
  });
});
