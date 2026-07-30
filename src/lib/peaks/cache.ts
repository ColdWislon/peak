import type { LatLon } from '../geo';
import type { Peak } from './index';
import { fetchPeaksAround } from './overpass';

/**
 * Cache IndexedDB des réponses Overpass (décision n° 5 du PLAN.md) : soulage
 * l'API publique et rend les points de vue déjà visités instantanés.
 * Toute erreur de cache dégrade silencieusement vers le réseau.
 */

const DB_NAME = 'cimes';
const STORE = 'overpass';
const TTL_MS = 7 * 24 * 3600 * 1000;

interface CacheEntry {
  key: string;
  storedAt: number;
  peaks: Peak[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB inaccessible'));
  });
}

function readEntry(db: IDBDatabase, key: string): Promise<CacheEntry | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as CacheEntry | undefined);
    request.onerror = () => reject(request.error ?? new Error('Lecture cache impossible'));
  });
}

function writeEntry(db: IDBDatabase, entry: CacheEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Écriture cache impossible'));
  });
}

function cacheKey(center: LatLon, radiusM: number): string {
  return `peaks:${center.lat.toFixed(3)}:${center.lon.toFixed(3)}:${Math.round(radiusM)}`;
}

/** Sommets autour d'un point, servis du cache si frais, sinon d'Overpass. */
export async function peaksAround(
  center: LatLon,
  radiusM: number,
  fetcher: typeof fetchPeaksAround = fetchPeaksAround,
): Promise<Peak[]> {
  const key = cacheKey(center, radiusM);
  const hasIdb = typeof indexedDB !== 'undefined';

  if (hasIdb) {
    try {
      const db = await openDb();
      const entry = await readEntry(db, key);
      if (entry && Date.now() - entry.storedAt < TTL_MS) return entry.peaks;
    } catch {
      // Cache indisponible : on passe au réseau.
    }
  }

  const peaks = await fetcher(center, radiusM);

  if (hasIdb) {
    try {
      const db = await openDb();
      await writeEntry(db, { key, storedAt: Date.now(), peaks });
    } catch {
      // Tant pis pour le cache, le résultat réseau est déjà là.
    }
  }
  return peaks;
}
