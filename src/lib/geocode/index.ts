/**
 * Recherche de lieux via Nominatim (OSM). Politique d'usage : au plus une
 * requête par seconde — le debounce est à la charge de l'appelant (SearchBar).
 */

export interface PlaceResult {
  name: string;
  /** Contexte lisible (commune, région, pays). */
  detail: string;
  lat: number;
  lon: number;
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

interface NominatimItem {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
}

/** Convertit une réponse Nominatim (format jsonv2) en résultats propres. */
export function parsePlaces(json: unknown): PlaceResult[] {
  if (!Array.isArray(json)) return [];
  const results: PlaceResult[] = [];

  for (const item of json as NominatimItem[]) {
    const lat = Number.parseFloat(item?.lat ?? '');
    const lon = Number.parseFloat(item?.lon ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const display = item.display_name ?? '';
    const segments = display.split(',').map((s) => s.trim());
    const name = item.name || segments[0] || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const detail = segments.slice(1, 4).join(', ');

    results.push({ name, detail, lat, lon });
  }
  return results;
}

/** Interroge Nominatim (résultats en français, 5 max). */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const url =
    `${ENDPOINT}?format=jsonv2&limit=5&accept-language=fr` +
    `&q=${encodeURIComponent(query.trim())}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Nominatim : HTTP ${response.status}`);
  return parsePlaces(await response.json());
}
