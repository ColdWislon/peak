<script lang="ts">
  import { onMount } from 'svelte';
  import MapView from './components/MapView.svelte';
  import PanoramaView from './components/PanoramaView.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ViserView from './components/ViserView.svelte';
  import { logDebug, registerDebugProvider } from './lib/debug/report';
  import type { LatLon } from './lib/geo';
  import { fr } from './lib/i18n/fr';
  import {
    parseMode,
    parseViewpoint,
    viewpointToSearch,
    type ViewMode,
    type ViewpointSource,
  } from './lib/viewpoint/url';

  /** Point de vue par défaut : Chamonix, face au massif du Mont-Blanc (PLAN.md). */
  const DEFAULT_VIEWPOINT = { lat: 45.9237, lon: 6.8694 };

  const urlViewpoint = parseViewpoint(location.search);
  let viewpoint = $state<LatLon>(urlViewpoint ?? DEFAULT_VIEWPOINT);
  let viewpointSource = $state<ViewpointSource>(urlViewpoint ? 'url' : 'defaut');
  let mode = $state<ViewMode>(parseMode(location.search));
  let menuOpen = $state(false);
  let searchOpen = $state(false);
  /** « Voir sur la carte » : la carte se centre sur le sommet sans déplacer le point de vue. */
  let mapCenter = $state<LatLon | null>(null);

  function syncUrl(): void {
    history.replaceState(null, '', viewpointToSearch(viewpoint, mode));
  }

  /** Téléporte (recherche, géolocalisation) en restant dans le mode courant. */
  function teleport(next: LatLon, source: ViewpointSource): void {
    viewpoint = next;
    viewpointSource = source;
    mapCenter = null;
    syncUrl();
  }

  /** Depuis la carte : bascule dans le panorama à cet endroit. */
  function teleportToPanorama(next: LatLon): void {
    viewpoint = next;
    viewpointSource = 'carte';
    mapCenter = null;
    mode = 'panorama';
    syncUrl();
  }

  /** Depuis une fiche de sommet (« Téléporter ») : le panorama vu de sa pointe. */
  function teleportToPeak(next: LatLon): void {
    teleportToPanorama(next);
    viewpointSource = 'sommet';
  }

  /** Depuis une fiche de sommet : la carte centrée dessus, point de vue inchangé. */
  function showOnMap(target: LatLon): void {
    mapCenter = target;
    switchMode('carte');
  }

  onMount(() => {
    const unregister = registerDebugProvider('app', () => ({
      mode,
      pointDeVue: viewpoint,
      sourcePointDeVue: viewpointSource,
    }));

    // L'app s'ouvre en Viser : un horizon calculé depuis le point de vue par
    // défaut ne veut rien dire là où l'utilisateur se trouve. Sans coordonnées
    // dans l'URL (lien partagé), on demande donc la position dès l'ouverture ;
    // un refus laisse simplement le point de vue par défaut, modifiable par la
    // recherche.
    if (!urlViewpoint && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          teleport({ lat: position.coords.latitude, lon: position.coords.longitude }, 'gps');
          logDebug('app:position', {
            source: 'gps',
            precisionM: Math.round(position.coords.accuracy),
          });
        },
        (error) => logDebug('app:position', { source: 'defaut', erreur: error.message }),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      );
    }
    return unregister;
  });

  function switchMode(next: ViewMode): void {
    if (mode === next) return;
    mode = next;
    syncUrl();
  }

  /** Bouton « 3D » : la carte 3D, ou retour à la visée quand on y est déjà. */
  function toggleMap(): void {
    switchMode(mode === 'carte' ? 'viser' : 'carte');
  }

  /** Bouton de droite : visée caméra ↔ panorama de synthèse. */
  function togglePanorama(): void {
    switchMode(mode === 'viser' ? 'panorama' : 'viser');
  }
</script>

<div class="app">
  {#if mode === 'panorama'}
    <PanoramaView {viewpoint} onteleport={teleportToPeak} onmap={showOnMap} />
  {:else if mode === 'carte'}
    <MapView center={mapCenter ?? viewpoint} onteleport={teleportToPanorama} />
  {:else}
    <ViserView
      {viewpoint}
      {viewpointSource}
      onteleport={teleportToPeak}
      onmap={showOnMap}
      onposition={(next) => teleport(next, 'gps')}
    />
  {/if}

  <!-- Chrome flottant façon PeakVisor : boutons ronds blancs par-dessus la vue. -->
  <div class="chrome" hidden={searchOpen}>
    <div class="column">
      <button
        class="btn-round"
        aria-label={fr.modes.menu}
        aria-expanded={menuOpen}
        title={fr.modes.menu}
        onclick={() => (menuOpen = !menuOpen)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <button
        class="btn-round"
        aria-label={fr.search.open}
        title={fr.search.open}
        onclick={() => (searchOpen = true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
      </button>
      <button
        class="btn-round"
        class:active={mode === 'carte'}
        aria-label={fr.modes.map}
        aria-pressed={mode === 'carte'}
        title={fr.modes.map}
        onclick={toggleMap}
      >
        {fr.modes.map3d}
      </button>
    </div>

    <button
      class="btn-round right"
      aria-label={mode === 'viser' ? fr.modes.panorama : fr.modes.viser}
      title={mode === 'viser' ? fr.modes.panorama : fr.modes.viser}
      onclick={togglePanorama}
    >
      {#if mode === 'viser'}
        <!-- Ligne de crête : le panorama de synthèse. -->
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 18.5 6.5 9.5l3.2 4.4 3.6-7.4 3 5.2 1.8-2.4L22 18.5" />
          <path d="M2 18.5h20" />
        </svg>
      {:else}
        <!-- Caméra : la visée. -->
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 8h3.2l1.6-2.5h6.4L16.8 8H20v11H4z" />
          <circle cx="12" cy="13" r="3.2" />
        </svg>
      {/if}
    </button>
  </div>

  <SearchBar
    open={searchOpen}
    onclose={() => (searchOpen = false)}
    onpick={(next, source) => {
      teleport(next, source);
      searchOpen = false;
    }}
  />
  <SettingsPanel
    open={menuOpen}
    {mode}
    onmode={(next) => {
      switchMode(next);
      menuOpen = false;
    }}
    onclose={() => (menuOpen = false)}
  />
</div>

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .chrome {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
  }

  .column {
    position: absolute;
    top: var(--chrome-top);
    left: var(--chrome-left);
    display: flex;
    flex-direction: column;
    gap: var(--chrome-gap);
  }

  .right {
    position: absolute;
    top: var(--chrome-top);
    right: var(--chrome-right);
  }
</style>
