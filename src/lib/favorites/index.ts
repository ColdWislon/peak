/**
 * Sommets favoris (étoile sur l'étiquette et dans la fiche) : liste
 * d'identifiants OSM persistée en localStorage. Module pur, testé — la
 * réactivité et la persistance vivent dans store.svelte.ts.
 */

const MAX_FAVORITES = 500;

/** Relit une liste stockée ; tout ce qui n'est pas un identifiant entier est ignoré. */
export function parseFavorites(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: number[] = [];
    for (const value of parsed) {
      if (typeof value === 'number' && Number.isInteger(value) && !ids.includes(value)) {
        ids.push(value);
      }
    }
    return ids.slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function serializeFavorites(ids: readonly number[]): string {
  return JSON.stringify(ids);
}

/** Ajoute l'identifiant s'il manque, le retire s'il est présent. */
export function toggleFavorite(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}
