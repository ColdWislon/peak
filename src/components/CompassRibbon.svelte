<script lang="ts">
  import { cardinalFor } from '../lib/i18n/fr';
  import type { CompassTick } from '../lib/viser/compass';

  let { ticks, headingDeg }: { ticks: CompassTick[]; headingDeg: number } = $props();
</script>

<!-- Ruban de boussole : graduations calculées par lib/viser/compass, ici on affiche. -->
<div class="compass">
  <div class="band" aria-hidden="true">
    {#each ticks as tick (tick.azimuthDeg)}
      <div
        class="tick"
        class:major={tick.major}
        class:cardinal={tick.cardinal}
        class:north={tick.azimuthDeg === 0}
        style="left: {tick.x}px"
      >
        {#if tick.cardinal}<span class="letter">{cardinalFor(tick.azimuthDeg)}</span>{/if}
      </div>
    {/each}
    <div class="caret"></div>
  </div>
  <div class="readout" aria-live="off">
    {Math.round(headingDeg) % 360}° · {cardinalFor(headingDeg)}
  </div>
</div>

<style>
  .compass {
    position: absolute;
    top: 3rem;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    pointer-events: none;
  }

  .band {
    position: relative;
    width: 100%;
    height: 2.2rem;
    background: linear-gradient(color-mix(in srgb, var(--bg) 45%, transparent), transparent);
    /* Fondu des bords : le ruban « sort du cadre » au lieu d'être coupé net. */
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
  }

  .tick {
    position: absolute;
    bottom: 0.15rem;
    width: 1px;
    height: 0.4rem;
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--text) 55%, transparent);
    box-shadow: 0 1px 2px rgb(0 0 0 / 50%);
  }

  .tick.major {
    height: 0.65rem;
    background: color-mix(in srgb, var(--text) 80%, transparent);
  }

  .tick.cardinal {
    width: 2px;
    height: 0.8rem;
  }

  .letter {
    position: absolute;
    bottom: calc(100% + 0.15rem);
    left: 50%;
    transform: translateX(-50%);
    color: var(--text);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
  }

  .tick.north {
    background: var(--accent);
  }

  .tick.north .letter {
    color: var(--accent);
  }

  .caret {
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 2px;
    height: 1.05rem;
    transform: translateX(-50%);
    background: var(--accent);
    box-shadow: 0 0 4px color-mix(in srgb, var(--accent) 70%, transparent);
  }

  .readout {
    padding: 0.3rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
  }
</style>
