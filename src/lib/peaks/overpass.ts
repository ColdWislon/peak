import type { LatLon } from '../geo';
import { buildPeaksQuery, parsePeaks, type Peak } from './index';

/** Endpoints Overpass publics, essayés dans l'ordre (repli en cas de panne). */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

/**
 * Interroge Overpass pour les sommets nommés autour d'un point.
 * Chaque endpoint est tenté à son tour ; la dernière erreur est propagée.
 */
export async function fetchPeaksAround(center: LatLon, radiusM: number): Promise<Peak[]> {
  const query = buildPeaksQuery(center, radiusM);
  let lastError: unknown = new Error('Aucun endpoint Overpass configuré');

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) {
        throw new Error(`Overpass ${endpoint} : HTTP ${response.status}`);
      }
      return parsePeaks(await response.json());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
