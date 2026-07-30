<script lang="ts">
  import { Map as LibreMap, Marker, NavigationControl } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { onMount } from 'svelte';
  import type { LatLon } from '../lib/geo';
  import { fr } from '../lib/i18n/fr';
  import { formatElevation } from '../lib/labels';
  import { roundRadiusM, visibleRadiusM } from '../lib/map';
  import { topPeaks, type Peak } from '../lib/peaks';
  import { peaksAround } from '../lib/peaks/cache';
  import { settings } from '../lib/settings/store.svelte';
  import { TERRARIUM_TILE_TEMPLATE } from '../lib/terrain/tiles';

  /** Style vectoriel OpenFreeMap (gratuit, sans clé — décision n° 4 du PLAN.md). */
  const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  /** En deçà de ce zoom, trop de sommets : pas de marqueurs. */
  const MIN_MARKER_ZOOM = 8;
  const MAX_MARKERS = 80;
  const MAX_PEAKS_RADIUS_M = 75_000;

  let { viewpoint, onteleport }: { viewpoint: LatLon; onteleport: (p: LatLon) => void } = $props();

  let container: HTMLDivElement;
  let map: LibreMap | undefined;
  let markers: Marker[] = [];
  let selected = $state<Peak | null>(null);
  let refreshToken = 0;

  function clearMarkers(): void {
    for (const marker of markers) marker.remove();
    markers = [];
  }

  function makeMarker(peak: Peak): Marker {
    const el = document.createElement('button');
    el.className = 'peak-marker';
    const name = document.createElement('span');
    name.className = 'peak-marker-name';
    name.textContent = peak.name;
    el.append(name);
    if (peak.elevation !== null) {
      const ele = document.createElement('span');
      ele.className = 'peak-marker-ele';
      ele.textContent = formatElevation(peak.elevation, settings.units);
      el.append(ele);
    }
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      selected = peak;
    });
    return new Marker({ element: el, anchor: 'bottom' }).setLngLat([peak.lon, peak.lat]);
  }

  async function refreshPeaks(): Promise<void> {
    if (!map) return;
    const token = ++refreshToken;
    if (map.getZoom() < MIN_MARKER_ZOOM) {
      clearMarkers();
      return;
    }
    const center = map.getCenter();
    const radius = roundRadiusM(
      Math.min(
        MAX_PEAKS_RADIUS_M,
        visibleRadiusM(center.lat, map.getZoom(), container.clientWidth, container.clientHeight),
      ),
    );
    let peaks: Peak[];
    try {
      peaks = topPeaks(
        await peaksAround({ lat: center.lat, lon: center.lng }, radius),
        MAX_MARKERS,
      );
    } catch {
      return; // Overpass indisponible : la carte reste utilisable sans marqueurs.
    }
    if (token !== refreshToken || !map) return; // réponse dépassée par un autre déplacement
    clearMarkers();
    for (const peak of peaks) markers.push(makeMarker(peak).addTo(map));
  }

  onMount(() => {
    map = new LibreMap({
      container,
      style: BASEMAP_STYLE,
      center: [viewpoint.lon, viewpoint.lat],
      zoom: 11,
      pitch: 60,
      maxPitch: 75,
      attributionControl: { compact: true, customAttribution: fr.attributions.terrain },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');

    map.on('load', () => {
      if (!map) return;
      // Deux sources raster-dem distinctes : MapLibre gère mal le partage
      // d'une même source entre le terrain 3D et l'ombrage.
      map.addSource('relief-3d', {
        type: 'raster-dem',
        tiles: [TERRARIUM_TILE_TEMPLATE],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 12,
      });
      map.addSource('relief-ombrage', {
        type: 'raster-dem',
        tiles: [TERRARIUM_TILE_TEMPLATE],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 12,
      });
      map.setTerrain({ source: 'relief-3d', exaggeration: 1.1 });
      const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
      map.addLayer(
        {
          id: 'ombrage',
          type: 'hillshade',
          source: 'relief-ombrage',
          paint: { 'hillshade-exaggeration': 0.35 },
        },
        firstSymbol,
      );
      void refreshPeaks();
    });
    map.on('moveend', () => void refreshPeaks());
    // Fond de carte inaccessible : le relief et les marqueurs suffisent.
    map.on('error', () => {});

    return () => {
      clearMarkers();
      map?.remove();
      map = undefined;
    };
  });

  // Suit les téléportations décidées ailleurs (recherche, géolocalisation).
  $effect(() => {
    const { lat, lon } = viewpoint;
    if (!map) return;
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 11) });
  });

  // Les marqueurs sont du DOM construit à la main : on les régénère quand
  // les unités changent (le premier passage est couvert par l'événement load).
  let unitsInitialized = false;
  $effect(() => {
    void settings.units;
    if (!unitsInitialized) {
      unitsInitialized = true;
      return;
    }
    if (map) void refreshPeaks();
  });

  function panoramaHere(): void {
    if (!map) return;
    const center = map.getCenter();
    onteleport({ lat: center.lat, lon: center.lng });
  }
</script>

<div class="map">
  <div class="canvas" bind:this={container}></div>

  <button class="fab" onclick={panoramaHere}>⛰ {fr.map.panoramaHere}</button>

  {#if selected}
    <aside class="card">
      <button class="close" onclick={() => (selected = null)} aria-label={fr.peakCard.close}>
        ×
      </button>
      <h2>{selected.name}</h2>
      <p>
        {#if selected.elevation !== null}
          {fr.peakCard.elevation} :
          <strong>{formatElevation(selected.elevation, settings.units)}</strong>
        {/if}
      </p>
      <button
        class="go"
        onclick={() => selected && onteleport({ lat: selected.lat, lon: selected.lon })}
      >
        {fr.map.seePanorama}
      </button>
    </aside>
  {/if}
</div>

<style>
  .map {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .canvas {
    position: absolute;
    inset: 0;
  }

  :global(.peak-marker) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
    padding: 0.18rem 0.5rem;
    border: none;
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    color: var(--text);
    font-size: 0.72rem;
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    text-shadow: 0 1px 3px rgb(0 0 0 / 55%);
  }

  :global(.peak-marker::after) {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    width: 1px;
    height: 8px;
    background: color-mix(in srgb, var(--text) 65%, transparent);
  }

  :global(.peak-marker-name) {
    font-weight: 600;
  }

  :global(.peak-marker-ele) {
    color: var(--accent);
    font-size: 0.64rem;
  }

  .fab {
    position: absolute;
    left: 50%;
    bottom: 1.4rem;
    transform: translateX(-50%);
    padding: 0.55rem 1.1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    color: var(--text);
    font-size: 0.9rem;
    cursor: pointer;
    box-shadow: 0 4px 18px rgb(0 0 0 / 35%);
  }

  .fab:hover {
    border-color: var(--accent);
  }

  .card {
    position: absolute;
    left: 50%;
    bottom: 4.6rem;
    transform: translateX(-50%);
    min-width: 14rem;
    max-width: min(22rem, 90vw);
    padding: 0.8rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
  }

  .card h2 {
    margin: 0 1.2rem 0.3rem 0;
    font-size: 1.05rem;
  }

  .card p {
    margin: 0 0 0.6rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .card strong {
    color: var(--text);
  }

  .go {
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-2);
    color: var(--accent);
    font-size: 0.88rem;
    cursor: pointer;
  }

  .go:hover {
    border-color: var(--accent);
  }

  .close {
    position: absolute;
    top: 0.35rem;
    right: 0.5rem;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 1.1rem;
    cursor: pointer;
  }

  .close:hover {
    color: var(--text);
  }
</style>
