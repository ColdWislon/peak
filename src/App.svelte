<script lang="ts">
  import MapView from './components/MapView.svelte';
  import PanoramaView from './components/PanoramaView.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ViserView from './components/ViserView.svelte';
  import type { LatLon } from './lib/geo';
  import { fr } from './lib/i18n/fr';
  import { parseMode, parseViewpoint, viewpointToSearch, type ViewMode } from './lib/viewpoint/url';

  /** Point de vue par défaut : Chamonix, face au massif du Mont-Blanc (PLAN.md). */
  const DEFAULT_VIEWPOINT = { lat: 45.9237, lon: 6.8694 };

  let viewpoint = $state<LatLon>(parseViewpoint(location.search) ?? DEFAULT_VIEWPOINT);
  let mode = $state<ViewMode>(parseMode(location.search));

  function syncUrl(): void {
    history.replaceState(null, '', viewpointToSearch(viewpoint, mode));
  }

  /** Téléporte (recherche, géolocalisation) en restant dans le mode courant. */
  function teleport(next: LatLon): void {
    viewpoint = next;
    syncUrl();
  }

  /** Depuis la carte : bascule dans le panorama à cet endroit. */
  function teleportToPanorama(next: LatLon): void {
    viewpoint = next;
    mode = 'panorama';
    syncUrl();
  }

  function switchMode(next: ViewMode): void {
    if (mode === next) return;
    mode = next;
    syncUrl();
  }
</script>

<div class="app">
  <header>
    <h1>{fr.appName}</h1>
    <SearchBar onpick={teleport} />
    <nav class="modes" aria-label="Mode d’affichage">
      <button class:active={mode === 'panorama'} onclick={() => switchMode('panorama')}>
        {fr.modes.panorama}
      </button>
      <button class:active={mode === 'carte'} onclick={() => switchMode('carte')}>
        {fr.modes.map}
      </button>
      <button class:active={mode === 'viser'} onclick={() => switchMode('viser')}>
        {fr.modes.viser}
      </button>
    </nav>
    <SettingsPanel />
  </header>

  {#if mode === 'panorama'}
    <PanoramaView {viewpoint} />
  {:else if mode === 'carte'}
    <MapView {viewpoint} onteleport={teleportToPanorama} />
  {:else}
    <ViserView {viewpoint} />
  {/if}
</div>

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    position: absolute;
    top: calc(0.65rem + var(--safe-top));
    left: calc(0.9rem + var(--safe-left));
    right: calc(0.9rem + var(--safe-right));
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    pointer-events: none;
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    letter-spacing: 0.06em;
    text-shadow: 0 1px 4px rgb(0 0 0 / 45%);
  }

  .modes {
    margin-left: auto;
    display: flex;
    padding: 0.15rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    pointer-events: auto;
  }

  .modes button {
    padding: 0.32rem 0.85rem;
    border: none;
    border-radius: 999px;
    background: none;
    color: var(--muted);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .modes button.active {
    background: var(--surface-2);
    color: var(--text);
  }

  /* Portrait / écrans étroits : l'en-tête en une seule ligne flottante ne
     tient pas. Il repasse dans le flux (la vue commence dessous, plus aucun
     chevauchement avec le HUD ni la boussole) et s'enroule sur deux rangées :
     titre + modes + réglages, puis la recherche en pleine largeur. */
  @media (max-width: 640px) {
    header {
      position: relative;
      top: 0;
      left: 0;
      right: 0;
      flex-wrap: wrap;
      row-gap: 0.55rem;
      column-gap: 0.6rem;
      padding: calc(0.65rem + var(--safe-top)) calc(0.9rem + var(--safe-right)) 0.65rem
        calc(0.9rem + var(--safe-left));
    }

    header :global(.search) {
      order: 4;
      flex: 1 1 100%;
    }
  }
</style>
