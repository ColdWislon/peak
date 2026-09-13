import { haversineDistance, type LatLon } from '../geo';
import { cellKey, cellsCoveringDisc, cellOf, cellRectangles, type Cell } from './cells';
import type { Peak } from './index';
import { fetchPeaksIn } from './overpass';

/**
 * Données locales de sommets (décision n° 5 du PLAN.md) : le globe est
 * découpé en cellules fixes (`peaks/cells`), chacune chargée d'Overpass au
 * plus une fois par semaine puis conservée en mémoire ET en IndexedDB.
 * Un point de vue n'interroge le réseau que pour les cellules de son disque
 * qu'on n'a pas encore — un pas du suivi GPS, un glissé de carte ou un retour
 * sur un massif visité ne rechargent rien. Sans réseau, des cellules périmées
 * valent mieux que rien : elles sont servies si Overpass ne répond pas.
 * Toute erreur de cache dégrade silencieusement vers le réseau.
 */

const DB_NAME = 'cimes';
const DB_VERSION = 2;
const STORE = 'sommets-cellules';
const LEGACY_STORE = 'overpass';
const TTL_MS = 7 * 24 * 3600 * 1000;
/** Cellules gardées en mémoire (au-delà, les plus anciennes repartent en IndexedDB). */
const MAX_MEMORY_CELLS = 400;
/** Délai d'ouverture d'IndexedDB au-delà duquel on se passe du cache persistant. */
const OPEN_TIMEOUT_MS = 4_000;

interface CellEntry {
  key: string;
  storedAt: number;
  peaks: Peak[];
}

const memory = new Map<string, CellEntry>();
const inflight = new Map<string, Promise<void>>();
let dbPromise: Promise<IDBDatabase> | null = null;
/** Après un échec d'ouverture, on se passe d'IndexedDB jusqu'à cet instant. */
let idbRetryAt = 0;
const RETRY_AFTER_FAILURE_MS = 30_000;

function idbUsable(): boolean {
  return typeof indexedDB !== 'undefined' && Date.now() >= idbRetryAt;
}

/**
 * Ouvre la base, sans jamais rester suspendu : une ouverture bloquée par un
 * autre onglet (ancienne version qui garde sa connexion) ou muette (Safari
 * au lancement) rejette au bout de `OPEN_TIMEOUT_MS`, et les sommets viennent
 * alors du réseau comme s'il n'y avait pas de cache.
 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('IndexedDB ne répond pas')), OPEN_TIMEOUT_MS);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(LEGACY_STORE)) db.deleteObjectStore(LEGACY_STORE);
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onblocked = () => fail(new Error('IndexedDB bloquée par un autre onglet'));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close(); // arrivée trop tard : on a déjà renoncé
        return;
      }
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => fail(request.error ?? new Error('IndexedDB inaccessible'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
    idbRetryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
  });
  return dbPromise;
}

function readEntries(db: IDBDatabase, keys: readonly string[]): Promise<CellEntry[]> {
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const found: CellEntry[] = [];
    let pending = keys.length;
    if (pending === 0) resolve(found);
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result) found.push(request.result as CellEntry);
        if (--pending === 0) resolve(found);
      };
      request.onerror = () => reject(request.error ?? new Error('Lecture cache impossible'));
    }
  });
}

function writeEntries(db: IDBDatabase, entries: readonly CellEntry[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const entry of entries) store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Écriture cache impossible'));
    tx.onabort = () => reject(tx.error ?? new Error('Écriture cache annulée'));
  });
}

function remember(entry: CellEntry): void {
  memory.delete(entry.key); // réinsertion en fin : ordre = ancienneté d'usage
  memory.set(entry.key, entry);
  while (memory.size > MAX_MEMORY_CELLS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

function recall(key: string): CellEntry | undefined {
  const entry = memory.get(key);
  if (entry) remember(entry);
  return entry;
}

/** Charge d'Overpass les cellules données et les range en mémoire et en IndexedDB. */
async function fetchCells(
  cells: readonly Cell[],
  fetcher: typeof fetchPeaksIn,
  now: number,
): Promise<void> {
  const peaks = await fetcher(cellRectangles(cells));
  const grouped = new Map<string, CellEntry>();
  for (const cell of cells) {
    const key = cellKey(cell);
    grouped.set(key, { key, storedAt: now, peaks: [] });
  }
  for (const peak of peaks) {
    grouped.get(cellKey(cellOf(peak)))?.peaks.push(peak);
  }
  const entries = [...grouped.values()];
  for (const entry of entries) remember(entry);
  if (idbUsable()) {
    try {
      await writeEntries(await openDb(), entries);
    } catch {
      // Tant pis pour la persistance, les cellules sont en mémoire.
    }
  }
}

/**
 * Sommets à moins de `radiusM` de `center`, servis des données locales ;
 * seules les cellules manquantes ou périmées sont demandées à Overpass, en
 * une requête, partagée avec les appels concurrents qui les attendent aussi.
 */
export async function peaksAround(
  center: LatLon,
  radiusM: number,
  fetcher: typeof fetchPeaksIn = fetchPeaksIn,
  now: () => number = Date.now,
): Promise<Peak[]> {
  const cells = cellsCoveringDisc(center, radiusM);
  const keys = cells.map(cellKey);
  const isFresh = (entry: CellEntry | undefined) =>
    entry !== undefined && now() - entry.storedAt < TTL_MS;

  // 1. Mémoire, puis IndexedDB pour ce qui n'y est pas (périmé compris : il
  //    servira de secours si le réseau manque).
  const notInMemory = keys.filter((key) => !isFresh(memory.get(key)));
  if (notInMemory.length > 0 && idbUsable()) {
    try {
      for (const entry of await readEntries(await openDb(), notInMemory)) {
        const current = memory.get(entry.key);
        if (!current || current.storedAt < entry.storedAt) remember(entry);
      }
    } catch {
      // Cache indisponible : on passe au réseau.
    }
  }

  // 2. Réseau pour les cellules manquantes, une seule fois par cellule même
  //    si plusieurs points de vue les attendent en même temps.
  const missing = cells.filter((cell) => !isFresh(memory.get(cellKey(cell))));
  const toFetch = missing.filter((cell) => !inflight.has(cellKey(cell)));
  if (toFetch.length > 0) {
    const promise = fetchCells(toFetch, fetcher, now());
    for (const cell of toFetch) inflight.set(cellKey(cell), promise);
    void promise
      .catch(() => {})
      .finally(() => {
        for (const cell of toFetch) {
          if (inflight.get(cellKey(cell)) === promise) inflight.delete(cellKey(cell));
        }
      });
  }
  const awaited = new Set(missing.map((cell) => inflight.get(cellKey(cell))));
  try {
    await Promise.all(awaited);
  } catch (error) {
    // Overpass injoignable : les cellules périmées font l'affaire, si on les a toutes.
    if (!keys.every((key) => memory.has(key))) throw error;
  }

  // 3. Assemblage : un sommet appartient à une seule cellule, pas de doublon.
  const result: Peak[] = [];
  for (const key of keys) {
    const entry = recall(key);
    if (!entry) continue;
    for (const peak of entry.peaks) {
      if (haversineDistance(center, peak) <= radiusM) result.push(peak);
    }
  }
  return result;
}

/** Vide la couche mémoire (tests). */
export function resetPeaksMemoryCache(): void {
  memory.clear();
  inflight.clear();
  dbPromise = null;
  idbRetryAt = 0;
}
