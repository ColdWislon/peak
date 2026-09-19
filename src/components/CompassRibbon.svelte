<script lang="ts">
  import { cardinalFor, fr } from '../lib/i18n/fr';
  import type { CompassBands } from '../lib/viser/compass';

  /**
   * Boussole du mode Viser : deux rubans superposés — celui du cap RECALÉ
   * (le seul d'accord avec les étiquettes et l'horizon) et, dès qu'un recalage
   * est en place, celui du cap BRUT des capteurs. L'écart entre les deux se
   * lit d'un coup d'œil : c'est l'erreur de la boussole du téléphone.
   * Les graduations viennent de lib/viser/compass — ici on affiche.
   */
  let { bands }: { bands: CompassBands } = $props();

  /** Cap arrondi, en degrés entiers. */
  function degrees(headingDeg: number): string {
    return `${Math.round(headingDeg) % 360}°`;
  }

  /** Recalage signé, à la française : « +18,1° », « −4,0° ». */
  function offsetText(offsetDeg: number): string {
    const sign = offsetDeg >= 0 ? '+' : '−';
    return `${sign}${Math.abs(offsetDeg).toFixed(1).replace('.', ',')}°`;
  }
</script>

<div class="compass">
  <div class="band" aria-hidden="true">
    {#each bands.aimed as tick (tick.azimuthDeg)}
      <div
        class="tick"
        class:major={tick.major}
        class:cardinal={tick.cardinal}
        class:north={tick.azimuthDeg === 0}
        style="left: {tick.x}px"
      >
        {#if tick.cardinal}<span class="letter">{cardinalFor(tick.azimuthDeg)}</span>{/if}
      </div>
    {/each}
    <div class="caret"></div>
  </div>

  <!-- Toujours présent, même vide : la hauteur du bloc ne saute pas quand le
       ruban brut apparaît (le statut des sommets est posé juste en dessous). -->
  <div class="band raw" aria-hidden="true">
    {#each bands.raw as tick (tick.azimuthDeg)}
      <div
        class="tick"
        class:major={tick.major}
        class:cardinal={tick.cardinal}
        style="left: {tick.x}px"
      >
        {#if tick.cardinal}<span class="letter">{cardinalFor(tick.azimuthDeg)}</span>{/if}
      </div>
    {/each}
    {#if bands.raw.length > 0}<div class="caret"></div>{/if}
  </div>

  <div class="readout pill" aria-live="off">
    <span class="aimed">{degrees(bands.headingDeg)} · {cardinalFor(bands.headingDeg)}</span>
    {#if bands.raw.length > 0}
      <span class="raw-value">{fr.viser.compassRaw} {degrees(bands.rawHeadingDeg)}</span>
      <span class="offset">{offsetText(bands.offsetDeg)}</span>
    {/if}
  </div>
</div>

<style>
  .compass {
    position: absolute;
    /* Rangée juste sous les boutons ronds du chrome. */
    top: calc(var(--chrome-top) + var(--round) + var(--chrome-gap));
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    pointer-events: none;
  }

  .band {
    position: relative;
    width: 100%;
    height: 2.2rem;
    /* Fondu des bords : le ruban « sort du cadre » au lieu d'être coupé net. */
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
  }

  /* Ruban brut : plus court, plus discret — c'est le repère de comparaison. */
  .band.raw {
    height: 1.4rem;
  }

  .tick {
    position: absolute;
    bottom: 0.15rem;
    width: 1px;
    height: 0.4rem;
    transform: translateX(-50%);
    background: var(--text);
    box-shadow: 0 0 3px rgb(255 255 255 / 85%);
  }

  .tick.major {
    height: 0.65rem;
  }

  .tick.cardinal {
    width: 2px;
    height: 0.8rem;
  }

  .letter {
    position: absolute;
    bottom: calc(100% + 0.15rem);
    left: 50%;
    transform: translateX(-50%);
    color: var(--text);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-shadow: 0 0 4px rgb(255 255 255 / 90%);
  }

  .tick.north {
    background: var(--accent-ink);
  }

  .tick.north .letter {
    color: var(--accent-ink);
  }

  /* Graduations brutes : grisées, et leurs lettres sous le trait pour ne pas
     venir se mêler à celles du ruban recalé. */
  .band.raw .tick {
    bottom: auto;
    top: 0;
    background: var(--muted);
    opacity: 0.85;
  }

  .band.raw .letter {
    bottom: auto;
    top: calc(100% + 0.1rem);
    color: var(--muted);
    font-size: 0.62rem;
    font-weight: 600;
  }

  /* Repère central : le cap visé, sur chacun des deux rubans. */
  .caret {
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 2px;
    height: 1.05rem;
    transform: translateX(-50%);
    background: var(--danger);
    box-shadow: 0 0 4px rgb(255 255 255 / 85%);
  }

  .band.raw .caret {
    bottom: auto;
    top: 0;
    height: 0.75rem;
    opacity: 0.55;
  }

  .readout {
    gap: 0.45rem;
    font-variant-numeric: tabular-nums;
  }

  .aimed {
    font-weight: 600;
  }

  .raw-value {
    color: var(--muted);
  }

  .offset {
    color: var(--accent-ink);
  }
</style>
