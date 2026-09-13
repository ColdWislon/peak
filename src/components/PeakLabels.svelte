<script lang="ts">
  import {
    formatElevation,
    LABEL_ANGLE_DEG,
    LABEL_LEADER_MIN,
    LABEL_THICKNESS,
    type PeakDot,
    type PlacedLabel,
  } from '../lib/labels';
  import { settings } from '../lib/settings/store.svelte';

  let {
    labels,
    dots = [],
    selectedId = null,
    favoriteIds = [],
    onselect,
  }: {
    labels: PlacedLabel[];
    /** Sommets visibles dans le cadre, étiquetés ou non : un point sur chaque pointe. */
    dots?: PeakDot[];
    selectedId?: number | null;
    favoriteIds?: readonly number[];
    onselect?: (label: PlacedLabel) => void;
  } = $props();

  // Les sommets étiquetés portent déjà leur pointe : seuls les autres reçoivent un point nu.
  const bareDots = $derived(dots.filter((dot) => !labels.some((label) => label.id === dot.id)));
</script>

<!-- Étiquettes façon PeakVisor : capsule blanche couchée à 45° (nom, puis
     altitude sur fond turquoise), trait de rappel vertical jusqu'à la pointe
     du sommet, point sur la pointe. Géométrie décidée par lib/labels. -->
<div
  class="layer"
  style="--angle: {LABEL_ANGLE_DEG}deg; --thickness: {LABEL_THICKNESS}px"
  aria-hidden={labels.length === 0 ? 'true' : undefined}
>
  {#each bareDots as dot (dot.id)}
    <span class="dot bare" style="left: {dot.x}px; top: {dot.y}px"></span>
  {/each}

  {#each labels as label (label.id)}
    <div
      class="peak"
      class:selected={label.id === selectedId}
      style="left: {label.x}px; top: {label.y}px; --leader: {LABEL_LEADER_MIN + label.lift}px"
    >
      <span class="dot"></span>
      <span class="leader"></span>
      <button
        class="label"
        aria-pressed={label.id === selectedId}
        onclick={() => onselect?.(label)}
      >
        <span class="name">{label.name}</span>
        <span class="ele">{formatElevation(label.elevation, settings.units)}</span>
        {#if favoriteIds.includes(label.id)}
          <span class="star" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M12 3.2l2.7 5.7 6.2.8-4.5 4.3 1.1 6.2L12 17.2l-5.5 3 1.1-6.2L3.1 9.7l6.2-.8z"
              />
            </svg>
          </span>
        {/if}
      </button>
    </div>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* Ancre de taille nulle posée sur la pointe du sommet : tout se place autour. */
  .peak {
    position: absolute;
    width: 0;
    height: 0;
  }

  .dot {
    position: absolute;
    left: 0;
    top: 0;
    width: 7px;
    height: 7px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px #fff;
  }

  .dot.bare {
    width: 6px;
    height: 6px;
    opacity: 0.85;
  }

  /* Trait de rappel : de la pointe au bas de la capsule, allongé de la surélévation. */
  .leader {
    position: absolute;
    left: -0.75px;
    top: calc(-1 * var(--leader));
    width: 1.5px;
    height: var(--leader);
    background: rgb(255 255 255 / 92%);
    box-shadow: 0 0 2px rgb(0 0 0 / 25%);
  }

  /* Capsule couchée : son extrémité basse (milieu du bord gauche avant
     rotation) est posée au sommet du trait, elle file vers le haut-droit. */
  .label {
    position: absolute;
    left: 0;
    top: calc(-1 * var(--leader));
    display: inline-flex;
    align-items: stretch;
    height: var(--thickness);
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgb(0 0 0 / 28%);
    transform: translateY(-50%) rotate(calc(-1 * var(--angle)));
    transform-origin: 0 50%;
    cursor: pointer;
    pointer-events: auto;
    -webkit-tap-highlight-color: transparent;
  }

  .name {
    display: flex;
    align-items: center;
    padding: 0 0.7rem 0 0.95rem;
    font-weight: 500;
  }

  .ele {
    display: flex;
    align-items: center;
    padding: 0 0.9rem 0 0.7rem;
    border-radius: 0 999px 999px 0;
    background: var(--accent);
    color: #fff;
    font-variant-numeric: tabular-nums;
  }

  .selected .label {
    box-shadow:
      0 0 0 3px var(--accent),
      0 2px 8px rgb(0 0 0 / 30%);
  }

  .selected .dot {
    background: #fff;
    box-shadow: 0 0 0 1.5px var(--accent);
  }

  /* Étoile de favori à l'extrémité haute de la capsule, remise d'aplomb. */
  .star {
    position: absolute;
    right: -0.45rem;
    top: -0.7rem;
    width: 1.35rem;
    height: 1.35rem;
    transform: rotate(var(--angle));
  }

  .star svg {
    width: 100%;
    height: 100%;
    fill: #fff;
    stroke: var(--accent);
    stroke-width: 1.4;
    stroke-linejoin: round;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 25%));
  }
</style>
