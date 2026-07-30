<script lang="ts">
  import { onMount } from 'svelte';
  import type { LatLon } from '../lib/geo';
  import { cardinalFor, fr } from '../lib/i18n/fr';
  import { PanoramaEngine } from '../lib/panorama/engine';

  let { viewpoint }: { viewpoint: LatLon } = $props();

  let canvas: HTMLCanvasElement;
  let engine: PanoramaEngine | undefined;
  let loading = $state(true);
  let progress = $state(0);
  let failed = $state(false);
  let heading = $state(0);

  async function load(): Promise<void> {
    if (!engine) return;
    loading = true;
    failed = false;
    progress = 0;
    try {
      await engine.load(viewpoint, (done, total) => {
        progress = done / Math.max(1, total);
      });
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    engine = new PanoramaEngine(canvas, (view) => {
      heading = view.heading;
    });
    heading = engine.view.heading;
    void load();
    return () => engine?.dispose();
  });
</script>

<div class="panorama">
  <canvas bind:this={canvas}></canvas>

  <div class="hud" aria-live="off">
    {Math.round(heading)}° · {cardinalFor(heading)}
  </div>

  {#if loading}
    <div class="veil">
      <p>{fr.panorama.loadingTerrain}</p>
      <progress value={progress} max="1"></progress>
    </div>
  {:else if failed}
    <div class="veil">
      <p>{fr.panorama.loadError}</p>
      <button onclick={() => void load()}>{fr.panorama.retry}</button>
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

  button {
    padding: 0.5rem 1.2rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    font-size: 1rem;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--accent);
  }
</style>
