import { parseFavorites, serializeFavorites, toggleFavorite } from './index';

/**
 * Favoris réactifs partagés ($state de module Svelte 5), persistés en
 * localStorage sous une clé distincte des réglages : ce sont des données de
 * l'utilisateur, pas des préférences.
 */

const STORAGE_KEY = 'cimes:favoris';

function readStored(): number[] {
  try {
    return parseFavorites(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export const favorites: { ids: number[] } = $state({ ids: readStored() });

export function isFavorite(id: number): boolean {
  return favorites.ids.includes(id);
}

export function toggleFavoritePeak(id: number): void {
  favorites.ids = toggleFavorite(favorites.ids, id);
  try {
    localStorage.setItem(STORAGE_KEY, serializeFavorites(favorites.ids));
  } catch {
    // Stockage indisponible (navigation privée…) : favoris de session seulement.
  }
}
