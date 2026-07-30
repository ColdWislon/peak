<script lang="ts">
  import PanoramaView from './components/PanoramaView.svelte';
  import { fr } from './lib/i18n/fr';

  /** Point de vue par défaut : Chamonix, face au massif du Mont-Blanc (PLAN.md). */
  const DEFAULT_VIEWPOINT = { lat: 45.9237, lon: 6.8694 };
</script>

<div class="app">
  <header>
    <h1>{fr.appName}</h1>
  </header>

  <PanoramaView viewpoint={DEFAULT_VIEWPOINT} />

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
    z-index: 2;
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
