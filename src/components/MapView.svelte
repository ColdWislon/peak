<script lang="ts">
  import { Map as LibreMap, Marker, NavigationControl } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { onMount } from 'svelte';
  import type { LatLon } from '../lib/geo';
  import { fr } from '../lib/i18n/fr';
  import { formatElevation } from '../lib/labels';
  import { roundRadiusM, visibleRadiusM } from '../lib/map';
  import { peakDisplayName, topPeaks, type Peak } from '../lib/peaks';
  import { peaksAround } from '../lib/peaks/cache';
  import { settings } from '../lib/settings/store.svelte';
  import { TERRARIUM_TILE_TEMPLATE } from '../lib/terrain/tiles';
  import PeakCard from './PeakCard.svelte';

  /** Style vectoriel OpenFreeMap (gratuit, sans clé — décision n° 4 du PLAN.md). */
  const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  /** En deçà de ce zoom, trop de sommets : pas de marqueurs. */
  const MIN_MARKER_ZOOM = 8;
  const MAX_MARKERS = 80;
  const MAX_PEAKS_RADIUS_M = 75_000;

  let {
    center,
    onteleport,
  }: {
    /** Centre demandé : le point de vue, ou le sommet à montrer (« Voir sur la carte »). */
    center: LatLon;
    onteleport: (p: LatLon) => void;
  } = $props();

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
    name.textContent = peakDisplayName(peak, settings.names);
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
    const mapCenter = map.getCenter();
    const radius = roundRadiusM(
      Math.min(
        MAX_PEAKS_RADIUS_M,
        visibleRadiusM(mapCenter.lat, map.getZoom(), container.clientWidth, container.clientHeight),
      ),
    );
    let peaks: Peak[];
    try {
      peaks = topPeaks(
        await peaksAround({ lat: mapCenter.lat, lon: mapCenter.lng }, radius),
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
      center: [center.lon, center.lat],
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

  // Suit les recentrages décidés ailleurs (recherche, géolocalisation, fiche).
  $effect(() => {
    const { lat, lon } = center;
    if (!map) return;
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 11) });
  });

  // Les marqueurs sont du DOM construit à la main : on les régénère quand
  // les unités ou la préférence de nom changent (le premier passage est
  // couvert par l'événement load).
  let markersInitialized = false;
  $effect(() => {
    void settings.units;
    void settings.names;
    if (!markersInitialized) {
      markersInitialized = true;
      return;
    }
    if (map) void refreshPeaks();
  });

  function panoramaHere(): void {
    if (!map) return;
    const mapCenter = map.getCenter();
    onteleport({ lat: mapCenter.lat, lon: mapCenter.lng });
  }
</script>

<div class="map">
  <div class="canvas" bind:this={container}></div>

  <button class="fab pill" onclick={panoramaHere}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 18.5 6.5 9.5l3.2 4.4 3.6-7.4 3 5.2 1.8-2.4L22 18.5" />
      <path d="M2 18.5h20" />
    </svg>
    {fr.map.panoramaHere}
  </button>

  {#if selected}
    <PeakCard
      peak={{
        id: selected.id,
        name: peakDisplayName(selected, settings.names),
        elevation: selected.elevation,
        lat: selected.lat,
        lon: selected.lon,
      }}
      onclose={() => (selected = null)}
      {onteleport}
    />
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
    align-items: center;
    gap: 0;
    height: 1.7rem;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 2px 6px rgb(0 0 0 / 28%);
  }

  :global(.peak-marker::after) {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    width: 1.5px;
    height: 10px;
    background: rgb(255 255 255 / 92%);
  }

  :global(.peak-marker-name) {
    padding: 0 0.55rem 0 0.7rem;
    font-weight: 500;
  }

  :global(.peak-marker-ele) {
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 0.65rem 0 0.5rem;
    border-radius: 0 999px 999px 0;
    background: var(--accent);
    color: #fff;
    font-variant-numeric: tabular-nums;
  }

  /* L'attribution MapLibre doit rester au-dessus de la barre home iOS. */
  :global(.maplibregl-ctrl-bottom-left),
  :global(.maplibregl-ctrl-bottom-right) {
    margin-bottom: var(--safe-bottom);
  }

  .fab {
    position: absolute;
    left: 50%;
    bottom: calc(1.4rem + var(--safe-bottom));
    transform: translateX(-50%);
    height: var(--round);
    padding: 0 1.2rem;
    border: none;
    color: var(--accent-ink);
    font: inherit;
    font-size: 0.95rem;
    cursor: pointer;
  }

  .fab svg {
    width: 1.4rem;
    height: 1.4rem;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .fab:hover {
    background: var(--surface-2);
  }
</style>
