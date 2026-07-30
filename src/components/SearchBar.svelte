<script lang="ts">
  import type { LatLon } from '../lib/geo';
  import { searchPlaces, type PlaceResult } from '../lib/geocode';
  import { fr } from '../lib/i18n/fr';

  let { onpick }: { onpick: (viewpoint: LatLon) => void } = $props();

  let query = $state('');
  let results = $state<PlaceResult[]>([]);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let open = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function search(): Promise<void> {
    const q = query.trim();
    if (q.length < 3) return;
    busy = true;
    message = null;
    try {
      results = await searchPlaces(q);
      message = results.length ? null : fr.search.noResults;
      open = true;
    } catch {
      results = [];
      message = fr.search.error;
      open = true;
    } finally {
      busy = false;
    }
  }

  function onInput(): void {
    clearTimeout(timer);
    if (query.trim().length < 3) {
      open = false;
      results = [];
      return;
    }
    // Politique Nominatim : requêtes espacées — debounce > 1 s.
    timer = setTimeout(() => void search(), 1100);
  }

  function pick(place: PlaceResult): void {
    open = false;
    results = [];
    query = place.name;
    onpick({ lat: place.lat, lon: place.lon });
  }

  function locate(): void {
    if (!navigator.geolocation) {
      message = fr.search.geolocError;
      open = true;
      return;
    }
    busy = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        busy = false;
        open = false;
        onpick({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => {
        busy = false;
        message = fr.search.geolocError;
        open = true;
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }
</script>

<div class="search">
  <input
    type="search"
    placeholder={fr.search.placeholder}
    bind:value={query}
    oninput={onInput}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        void search();
      }
    }}
    aria-label={fr.search.placeholder}
  />
  <button class="locate" onclick={locate} title={fr.search.locate} aria-label={fr.search.locate}>
    ◎
  </button>
  {#if busy}<span class="busy">…</span>{/if}

  {#if open && (results.length || message)}
    <ul class="results">
      {#each results as place (place.lat + '/' + place.lon)}
        <li>
          <button onclick={() => pick(place)}>
            <span class="name">{place.name}</span>
            {#if place.detail}<span class="detail">{place.detail}</span>{/if}
          </button>
        </li>
      {/each}
      {#if message}<li class="message">{message}</li>{/if}
    </ul>
  {/if}
</div>

<style>
  .search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    pointer-events: auto;
  }

  input {
    width: min(19rem, 56vw);
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    color: var(--text);
    font-size: 0.9rem;
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .locate {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    color: var(--accent);
    font-size: 1rem;
    cursor: pointer;
  }

  .locate:hover {
    border-color: var(--accent);
  }

  .busy {
    color: var(--muted);
  }

  .results {
    position: absolute;
    top: calc(100% + 0.35rem);
    left: 0;
    width: min(24rem, 80vw);
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--surface);
    box-shadow: 0 8px 28px rgb(0 0 0 / 40%);
    z-index: 5;
  }

  .results li button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: none;
    border-radius: 0.4rem;
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .results li button:hover {
    background: var(--surface-2);
  }

  .results .name {
    font-weight: 600;
    font-size: 0.88rem;
  }

  .results .detail {
    color: var(--muted);
    font-size: 0.75rem;
  }

  .message {
    padding: 0.45rem 0.6rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
