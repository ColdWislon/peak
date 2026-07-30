<script lang="ts">
  import PanoramaView from './components/PanoramaView.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import type { LatLon } from './lib/geo';
  import { fr } from './lib/i18n/fr';
  import { parseViewpoint, viewpointToSearch } from './lib/viewpoint/url';

  /** Point de vue par défaut : Chamonix, face au massif du Mont-Blanc (PLAN.md). */
  const DEFAULT_VIEWPOINT = { lat: 45.9237, lon: 6.8694 };

  let viewpoint = $state<LatLon>(parseViewpoint(location.search) ?? DEFAULT_VIEWPOINT);

  /** Téléporte le panorama et rend l'URL partageable. */
  function teleport(next: LatLon): void {
    viewpoint = next;
    history.replaceState(null, '', viewpointToSearch(next));
  }
</script>

<div class="app">
  <header>
    <h1>{fr.appName}</h1>
    <SearchBar onpick={teleport} />
  </header>

  <PanoramaView {viewpoint} />

  <footer>
    {fr.attributions.intro}
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
      {fr.attributions.osm}
    </a>
    ·
    <a
      href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
      target="_blank"
      rel="noreferrer"
    >
      {fr.attributions.terrain}
    </a>
    ·
    <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
      {fr.attributions.basemap}
    </a>
  </footer>
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
    top: 0.65rem;
    left: 0.9rem;
    right: 0.9rem;
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

  footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2;
    padding: 0.3rem 0.75rem;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    color: var(--muted);
    font-size: 0.68rem;
    text-align: center;
  }
</style>
