<script lang="ts">
  import { fr } from './lib/i18n/fr';
</script>

<main>
  <h1>{fr.appName}</h1>
  <p class="tagline">{fr.tagline}</p>
  <p class="status">{fr.underConstruction}</p>
</main>

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

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: 3rem;
    letter-spacing: 0.04em;
  }

  .tagline {
    margin: 0;
    color: var(--accent);
    font-size: 1.15rem;
  }

  .status {
    margin-top: 1.5rem;
    color: var(--muted);
    font-size: 0.9rem;
  }

  footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    font-size: 0.75rem;
    text-align: center;
  }
</style>
