import { describe, expect, it } from 'vitest';
import { fr } from './fr';

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

describe('i18n fr', () => {
  it('ne contient aucune chaîne vide', () => {
    const strings = collectStrings(fr);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) {
      expect(s.trim()).not.toBe('');
    }
  });
});
