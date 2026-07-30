<script lang="ts">
  import { onMount } from 'svelte';
  import type { LatLon } from '../lib/geo';
  import { cardinalFor, fr } from '../lib/i18n/fr';
  import {
    placeLabels,
    toCandidates,
    formatDistance,
    formatElevation,
    type LabelCandidate,
    type PlacedLabel,
  } from '../lib/labels';
  import { PanoramaEngine, type PanoramaContext } from '../lib/panorama/engine';
  import { topPeaks, type Peak } from '../lib/peaks';
  import { peaksAround } from '../lib/peaks/cache';
  import type { PeakSight, VisibilityRequest } from '../lib/visibility/protocol';
  import PeakLabels from './PeakLabels.svelte';

  /** Rayon de recherche des sommets (m) — au-delà, la brume les mange. */
  const PEAKS_RADIUS_M = 75_000;
  /** Nombre maximal de sommets envoyés au calcul de visibilité. */
  const PEAKS_LIMIT = 300;

  let { viewpoint }: { viewpoint: LatLon } = $props();

  let canvas: HTMLCanvasElement;
  let engine: PanoramaEngine | undefined;
  let worker: Worker | undefined;

  let loading = $state(true);
  let progress = $state(0);
  let failed = $state(false);
  let heading = $state(0);
  let labels = $state<PlacedLabel[]>([]);
  let selected = $state<PlacedLabel | null>(null);

  let context: PanoramaContext | undefined;
  let peaks: Peak[] = [];
  let candidates: LabelCandidate[] = [];
  let relayoutQueued = false;

  function relayout(): void {
    if (!engine || relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(() => {
      relayoutQueued = false;
      if (!engine) return;
      labels = placeLabels(candidates, {
        headingDeg: engine.view.heading,
        pitchDeg: engine.view.pitch,
        fovDeg: engine.view.fov,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    });
  }

  function onSights(sights: PeakSight[]): void {
    if (!context) return;
    candidates = toCandidates(sights, peaks, context.eyeElevation);
    relayout();
  }

  async function loadPeaks(): Promise<void> {
    if (!context || !worker) return;
    try {
      peaks = topPeaks(await peaksAround(context.viewpoint, PEAKS_RADIUS_M), PEAKS_LIMIT);
    } catch {
      // Overpass indisponible : le panorama reste utilisable sans étiquettes.
      return;
    }
    const request: VisibilityRequest = {
      viewpoint: context.viewpoint,
      eyeElevation: context.eyeElevation,
      innerRadiusM: context.innerRadiusM,
      inner: context.inner,
      outer: context.outer,
      peaks: peaks.map(({ id, lat, lon, elevation }) => ({ id, lat, lon, elevation })),
    };
    worker.postMessage(request, [context.inner.data.buffer, context.outer.data.buffer]);
  }

  async function load(): Promise<void> {
    if (!engine) return;
    loading = true;
    failed = false;
    progress = 0;
    labels = [];
    selected = null;
    candidates = [];
    try {
      context = await engine.load(viewpoint, (done, total) => {
        progress = done / Math.max(1, total);
      });
    } catch {
      failed = true;
      loading = false;
      return;
    }
    loading = false;
    void loadPeaks();
  }

  onMount(() => {
    engine = new PanoramaEngine(canvas, (view) => {
      heading = view.heading;
      relayout();
    });
    heading = engine.view.heading;

    worker = new Worker(new URL('../workers/visibility.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<PeakSight[]>) => onSights(event.data);

    void load();
    return () => {
      worker?.terminate();
      engine?.dispose();
    };
  });
</script>

<div class="panorama">
  <canvas bind:this={canvas}></canvas>

  <PeakLabels {labels} onselect={(label) => (selected = label)} />

  <div class="hud" aria-live="off">
    {Math.round(heading)}° · {cardinalFor(heading)}
  </div>

  {#if selected}
    <aside class="card">
      <button class="close" onclick={() => (selected = null)} aria-label={fr.peakCard.close}>
        ×
      </button>
      <h2>{selected.name}</h2>
      <p>
        {fr.peakCard.elevation} : <strong>{formatElevation(selected.elevation)}</strong><br />
        {fr.peakCard.distance} : <strong>{formatDistance(selected.distanceM)}</strong>
      </p>
    </aside>
  {/if}

  {#if loading}
    <div class="veil">
      <p>{fr.panorama.loadingTerrain}</p>
      <progress value={progress} max="1"></progress>
    </div>
  {:else if failed}
    <div class="veil">
      <p>{fr.panorama.loadError}</p>
      <button class="retry" onclick={() => void load()}>{fr.panorama.retry}</button>
    </div>
  {/if}
</div>

<style>
  .panorama {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }

  canvas:active {
    cursor: grabbing;
  }

  .hud {
    position: absolute;
    top: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
    pointer-events: none;
  }

  .card {
    position: absolute;
    left: 50%;
    bottom: 2.4rem;
    transform: translateX(-50%);
    min-width: 14rem;
    max-width: min(22rem, 90vw);
    padding: 0.8rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
  }

  .card h2 {
    margin: 0 1.2rem 0.35rem 0;
    font-size: 1.05rem;
  }

  .card p {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .card strong {
    color: var(--text);
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

  .veil {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    text-align: center;
    padding: 1rem;
  }

  progress {
    width: min(18rem, 70vw);
    accent-color: var(--accent);
  }

  .retry {
    padding: 0.5rem 1.2rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    font-size: 1rem;
    cursor: pointer;
  }

  .retry:hover {
    border-color: var(--accent);
  }
</style>
