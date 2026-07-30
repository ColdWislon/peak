import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from './index';

describe('parseSettings', () => {
  it('boucle avec serializeSettings', () => {
    const settings = { quality: 'eco', units: 'imperial', names: 'local' } as const;
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
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
    });
  });

  it('ne partage jamais l’objet par défaut (pas de mutation croisée)', () => {
    const a = parseSettings(null);
    a.units = 'imperial';
    expect(parseSettings(null).units).toBe('metric');
  });
});
