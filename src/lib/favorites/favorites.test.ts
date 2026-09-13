import { describe, expect, it } from 'vitest';
import { parseFavorites, serializeFavorites, toggleFavorite } from './index';

describe('favoris', () => {
  it('boucle avec serializeFavorites', () => {
    expect(parseFavorites(serializeFavorites([12, 7, 3]))).toEqual([12, 7, 3]);
  });

  it('ignore ce qui n’est pas un identifiant, sans doublon', () => {
    expect(parseFavorites('[1, "2", 2.5, null, 1, 3]')).toEqual([1, 3]);
  });

  it('retombe sur une liste vide pour null, JSON cassé ou autre chose qu’une liste', () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites('{pas du json')).toEqual([]);
    expect(parseFavorites('{"ids":[1]}')).toEqual([]);
  });

  it('bascule un favori sans muter la liste reçue', () => {
    const ids = [1, 2];
    expect(toggleFavorite(ids, 3)).toEqual([1, 2, 3]);
    expect(toggleFavorite(ids, 1)).toEqual([2]);
    expect(ids).toEqual([1, 2]);
  });
});
