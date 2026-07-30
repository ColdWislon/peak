/**
 * Service worker de Cimes (phase 3 du PLAN.md).
 * - Coque applicative (assets hachés même-origine) : cache-first.
 * - Navigations : réseau d'abord, repli sur la coque en hors-ligne.
 * - Tuiles d'élévation (S3) : cache-first plafonné, les massifs déjà
 *   visités restent explorables sans connexion.
 * Écrit à la main : pas de manifeste de précache, le cache se remplit à l'usage.
 */

const SHELL_CACHE = 'cimes-coque-v1';
const TILE_CACHE = 'cimes-tuiles-v1';
const TILE_HOST = 's3.amazonaws.com';
const MAX_TILE_ENTRIES = 600;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add('./'))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(SHELL_CACHE, event.request));
  } else if (url.host === TILE_HOST) {
    event.respondWith(cacheFirstBounded(TILE_CACHE, event.request));
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('./', response.clone());
    return response;
  } catch {
    const fallback = await cache.match('./');
    return fallback ?? Response.error();
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function cacheFirstBounded(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trimCache(cache);
  }
  return response;
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_TILE_ENTRIES;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}
