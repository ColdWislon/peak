<script lang="ts">
  import type { LatLon } from '../lib/geo';
  import { searchPlaces, type PlaceResult } from '../lib/geocode';
  import { fr } from '../lib/i18n/fr';
  import type { ViewpointSource } from '../lib/viewpoint/url';

  let {
    open,
    onclose,
    onpick,
  }: {
    open: boolean;
    onclose: () => void;
    onpick: (viewpoint: LatLon, source: ViewpointSource) => void;
  } = $props();

  let input = $state<HTMLInputElement | undefined>();
  let query = $state('');
  let results = $state<PlaceResult[]>([]);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Le champ apparaît à la demande (bouton loupe) : il prend le clavier aussitôt.
  $effect(() => {
    if (open) input?.focus();
  });

  async function search(): Promise<void> {
    const q = query.trim();
    if (q.length < 3) return;
    busy = true;
    message = null;
    try {
      results = await searchPlaces(q);
      message = results.length ? null : fr.search.noResults;
    } catch {
      results = [];
      message = fr.search.error;
    } finally {
      busy = false;
    }
  }

  function onInput(): void {
    clearTimeout(timer);
    if (query.trim().length < 3) {
      results = [];
      message = null;
      return;
    }
    // Politique Nominatim : requêtes espacées — debounce > 1 s.
    timer = setTimeout(() => void search(), 1100);
  }

  function pick(place: PlaceResult): void {
    results = [];
    query = place.name;
    onpick({ lat: place.lat, lon: place.lon }, 'recherche');
  }

  function locate(): void {
    if (!navigator.geolocation) {
      message = fr.search.geolocError;
      return;
    }
    busy = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        busy = false;
        onpick({ lat: position.coords.latitude, lon: position.coords.longitude }, 'gps');
      },
      () => {
        busy = false;
        message = fr.search.geolocError;
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function close(): void {
    clearTimeout(timer);
    onclose();
  }
</script>

{#if open}
  <div class="search" role="search">
    <div class="field">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </svg>
      <input
        bind:this={input}
        type="search"
        placeholder={fr.search.placeholder}
        bind:value={query}
        oninput={onInput}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            clearTimeout(timer);
            void search();
          } else if (e.key === 'Escape') {
            close();
          }
        }}
        aria-label={fr.search.placeholder}
      />
      {#if busy}<span class="busy" aria-hidden="true">…</span>{/if}
      <button class="tool" onclick={locate} title={fr.search.locate} aria-label={fr.search.locate}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="6.5" />
          <circle cx="12" cy="12" r="1.6" />
          <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
        </svg>
      </button>
      <button class="tool" onclick={close} aria-label={fr.search.close} title={fr.search.close}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>

    {#if results.length || message}
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
{/if}

<style>
  .search {
    position: absolute;
    top: var(--chrome-top);
    left: var(--chrome-left);
    right: var(--chrome-right);
    z-index: 6;
    max-width: 34rem;
    margin: 0 auto;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    height: var(--round);
    padding: 0 0.5rem 0 0.9rem;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .field > svg,
  .tool svg {
    width: 1.4rem;
    height: 1.4rem;
    flex-shrink: 0;
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }

  input:focus {
    outline: none;
  }

  input::-webkit-search-cancel-button {
    display: none;
  }

  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }

  .tool:hover {
    background: var(--surface-2);
  }

  .busy {
    color: var(--muted);
  }

  .results {
    margin: 0.4rem 0 0;
    padding: 0.3rem;
    list-style: none;
    border-radius: 1rem;
    background: var(--surface);
    box-shadow: var(--shadow);
    max-height: min(50vh, 22rem);
    overflow-y: auto;
  }

  .results li button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    width: 100%;
    padding: 0.55rem 0.8rem;
    border: none;
    border-radius: 0.7rem;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .results li button:hover {
    background: var(--surface-2);
  }

  .results .name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .results .detail {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .message {
    padding: 0.55rem 0.8rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
