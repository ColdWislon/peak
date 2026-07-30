<script lang="ts">
  import { formatDistance, formatElevation, type PlacedLabel } from '../lib/labels';
  import { settings } from '../lib/settings/store.svelte';

  let {
    labels,
    onselect,
  }: {
    labels: PlacedLabel[];
    onselect?: (label: PlacedLabel) => void;
  } = $props();
</script>

<div class="layer">
  {#each labels as label (label.id)}
    <button
      class="label"
      style="left: {label.x}px; top: {label.y}px"
      onclick={() => onselect?.(label)}
    >
      <span class="name">{label.name}</span>
      <span class="meta"
        >{formatElevation(label.elevation, settings.units)} · {formatDistance(
          label.distanceM,
          settings.units,
        )}</span
      >
    </button>
  {/each}
</div>

<style>
  .layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .label {
    position: absolute;
    transform: translate(-50%, calc(-100% - 14px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
    padding: 0.2rem 0.55rem;
    border: none;
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--bg) 58%, transparent);
    color: var(--text);
    font-size: 0.78rem;
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    pointer-events: auto;
    text-shadow: 0 1px 3px rgb(0 0 0 / 55%);
  }

  /* Trait de rappel vers la pointe du sommet. */
  .label::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    width: 1px;
    height: 14px;
    background: color-mix(in srgb, var(--text) 65%, transparent);
  }

  .label:hover {
    background: color-mix(in srgb, var(--surface-2) 85%, transparent);
  }

  .name {
    font-weight: 600;
  }

  .meta {
    color: var(--accent);
    font-size: 0.68rem;
  }
</style>
