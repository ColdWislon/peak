<script lang="ts" module>
  /** Ce que la fiche affiche : une étiquette placée (Viser, panorama) ou un sommet de la carte. */
  export interface PeakCardInfo {
    id: number;
    name: string;
    elevation: number | null;
    /** Distance et cap depuis le point de vue — inconnus vus de la carte. */
    distanceM?: number;
    azimuthDeg?: number;
    lat: number;
    lon: number;
  }
</script>

<script lang="ts">
  import { isFavorite, toggleFavoritePeak } from '../lib/favorites/store.svelte';
  import type { LatLon } from '../lib/geo';
  import { cardinalFor, fr } from '../lib/i18n/fr';
  import { formatDistance, formatElevation } from '../lib/labels';
  import { settings } from '../lib/settings/store.svelte';

  let {
    peak,
    onclose,
    onteleport,
    onmap,
  }: {
    peak: PeakCardInfo;
    onclose: () => void;
    /** « Téléporter » : voir le panorama depuis ce sommet. */
    onteleport: (target: LatLon) => void;
    /** Absent sur la carte, qui montre déjà le sommet. */
    onmap?: (target: LatLon) => void;
  } = $props();

  const favorite = $derived(isFavorite(peak.id));

  /** Sentiers de randonnée OSM autour du sommet (Waymarked Trails, données libres). */
  const routesUrl = $derived(
    `https://hiking.waymarkedtrails.org/#?map=13.0/${peak.lat.toFixed(5)}/${peak.lon.toFixed(5)}`,
  );

  // Feuille glissable : tirer vers le bas la referme (la poignée est aussi un bouton).
  let dragStartY: number | null = null;
  let dragDy = $state(0);

  function onDown(e: PointerEvent): void {
    if ((e.target as HTMLElement | null)?.closest('button, a')) return;
    dragStartY = e.clientY;
    dragDy = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent): void {
    if (dragStartY === null) return;
    dragDy = Math.max(0, e.clientY - dragStartY);
  }
  function onUp(): void {
    if (dragStartY === null) return;
    const shouldClose = dragDy > 48;
    dragStartY = null;
    dragDy = 0;
    if (shouldClose) onclose();
  }
</script>

<div
  class="card"
  role="dialog"
  tabindex="-1"
  aria-label={peak.name}
  style:transform="translateX(-50%) translateY({dragDy}px)"
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointercancel={onUp}
>
  <button class="handle" aria-label={fr.peakCard.close} onclick={onclose}></button>

  <div class="head">
    <h2>{peak.name}</h2>
    <div class="facts">
      {#if peak.elevation !== null}
        <div class="fact">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 18.5 9 8l3.6 5.6 2.6-3.6 6.3 8.5z" />
            <path d="M7 11.2 9 8l2 3.2" />
          </svg>
          <span>{formatElevation(peak.elevation, settings.units)}</span>
        </div>
      {/if}
      {#if peak.distanceM !== undefined && peak.azimuthDeg !== undefined}
        <div class="fact distance">
          {fr.peakCard.towards(
            formatDistance(peak.distanceM, settings.units),
            cardinalFor(peak.azimuthDeg),
          )}
        </div>
      {/if}
    </div>
  </div>

  <div class="actions">
    <button
      class="action icon"
      class:on={favorite}
      aria-pressed={favorite}
      aria-label={favorite ? fr.peakCard.unfavorite : fr.peakCard.favorite}
      title={favorite ? fr.peakCard.unfavorite : fr.peakCard.favorite}
      onclick={() => toggleFavoritePeak(peak.id)}
    >
      <svg viewBox="0 0 24 24" class="star">
        <path d="M12 3.2l2.7 5.7 6.2.8-4.5 4.3 1.1 6.2L12 17.2l-5.5 3 1.1-6.2L3.1 9.7l6.2-.8z" />
      </svg>
    </button>
    <a
      class="action"
      href={routesUrl}
      target="_blank"
      rel="noreferrer"
      title={fr.peakCard.routesTitle}
    >
      <svg viewBox="0 0 24 24" class="route" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 15v-3.5h6.5M12 9l2.5 2.5L12 14" />
      </svg>
      {fr.peakCard.routes}
    </a>
    <button
      class="action wide"
      title={fr.peakCard.teleportTitle}
      onclick={() => onteleport({ lat: peak.lat, lon: peak.lon })}
    >
      {fr.peakCard.teleport}
    </button>
    {#if onmap}
      <button
        class="action icon"
        aria-label={fr.peakCard.showOnMap}
        title={fr.peakCard.showOnMap}
        onclick={() => onmap?.({ lat: peak.lat, lon: peak.lon })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="6.5" />
          <circle cx="12" cy="12" r="1.6" />
          <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .card {
    position: absolute;
    left: 50%;
    bottom: 0;
    z-index: 5;
    width: min(100%, 34rem);
    padding: 0.5rem 1.1rem calc(1rem + var(--safe-bottom));
    border-radius: 1.6rem 1.6rem 0 0;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 -4px 24px rgb(0 0 0 / 22%);
    touch-action: none;
  }

  .handle {
    display: block;
    width: 4.5rem;
    height: 0.45rem;
    margin: 0.15rem auto 0.7rem;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    cursor: pointer;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.9rem;
  }

  h2 {
    margin: 0.25rem 0 0;
    font-size: 1.75rem;
    font-weight: 400;
    line-height: 1.15;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }

  .facts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
    color: var(--muted);
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .fact {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0;
  }

  .fact svg {
    width: 1.6rem;
    height: 1.6rem;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .fact.distance {
    border-top: 1px solid var(--border);
    font-size: 0.95rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    height: 3rem;
    padding: 0 1rem;
    border: none;
    border-radius: 0.9rem;
    background: var(--surface-2);
    color: var(--accent-ink);
    font: inherit;
    font-size: 1.05rem;
    text-decoration: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .action:hover {
    background: color-mix(in srgb, var(--surface-2) 70%, var(--accent) 30%);
    text-decoration: none;
  }

  .action.wide {
    flex: 1;
  }

  .action.icon {
    flex-shrink: 0;
    width: 3rem;
    padding: 0;
  }

  .action svg {
    width: 1.5rem;
    height: 1.5rem;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .action svg.route {
    fill: var(--accent);
    stroke: #fff;
    stroke-width: 1.6;
  }

  .action.on svg.star {
    fill: var(--accent);
  }

  @media (max-width: 380px) {
    .action {
      font-size: 0.95rem;
      padding: 0 0.7rem;
    }
  }
</style>
