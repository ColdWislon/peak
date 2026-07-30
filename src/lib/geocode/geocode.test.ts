import { describe, expect, it } from 'vitest';
import { parsePlaces } from './index';

describe('parsePlaces', () => {
  it('extrait nom, contexte et coordonnées', () => {
    const results = parsePlaces([
      {
        lat: '45.9237',
        lon: '6.8694',
        name: 'Chamonix-Mont-Blanc',
        display_name: 'Chamonix-Mont-Blanc, Haute-Savoie, Auvergne-Rhône-Alpes, France',
      },
      { lat: '45.8326', lon: '6.8652', display_name: 'Mont Blanc, Haute-Savoie, France' },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: 'Chamonix-Mont-Blanc', lat: 45.9237, lon: 6.8694 });
    expect(results[0]!.detail).toBe('Haute-Savoie, Auvergne-Rhône-Alpes, France');
    expect(results[1]!.name).toBe('Mont Blanc');
  });

  it('ignore les entrées sans coordonnées et les réponses inattendues', () => {
    expect(parsePlaces([{ name: 'Perdu' }])).toEqual([]);
    expect(parsePlaces({})).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
  });
});
