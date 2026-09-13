<script lang="ts">
  import { buildDebugReport } from '../lib/debug/report';
  import { captureDebugSnapshot, deliverSnapshot, hasSnapshotSource } from '../lib/debug/snapshot';
  import { fr } from '../lib/i18n/fr';
  import type { NamePreference } from '../lib/peaks';
  import { isIosDevice, isStandalone } from '../lib/pwa/install';
  import type { RenderQuality, Units } from '../lib/settings';
  import { saveSettings, settings } from '../lib/settings/store.svelte';
  import type { ViewMode } from '../lib/viewpoint/url';

  let {
    open,
    mode,
    onmode,
    onclose,
  }: {
    open: boolean;
    mode: ViewMode;
    onmode: (next: ViewMode) => void;
    onclose: () => void;
  } = $props();

  let reportMessage = $state<string | null>(null);
  let reportFallback = $state<string | null>(null);
  let capturing = $state(false);
  let captureMessage = $state<string | null>(null);

  // La vue caméra n'existe que pendant la visée : réévalué à chaque ouverture
  // du tiroir (le mode courant ne dit pas si la caméra tourne).
  const canCapture = $derived(open && hasSnapshotSource());

  // Aide à l'installation PWA : seulement sur iOS et hors app déjà installée.
  const showInstall =
    isIosDevice(navigator.userAgent, navigator.maxTouchPoints) &&
    !isStandalone(
      window.matchMedia('(display-mode: standalone)').matches,
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );

  const modes: Array<{ value: ViewMode; label: string }> = [
    { value: 'viser', label: fr.modes.viser },
    { value: 'panorama', label: fr.modes.panorama },
    { value: 'carte', label: fr.modes.map },
  ];

  async function copyReport(): Promise<void> {
    const report = buildDebugReport({ reglages: { ...settings } });
    reportFallback = null;
    try {
      await navigator.clipboard.writeText(report);
      reportMessage = fr.settings.reportCopied;
    } catch {
      // Presse-papiers refusé (permissions, iframe…) : texte sélectionnable.
      reportFallback = report;
      reportMessage = fr.settings.reportFailed;
    }
    setTimeout(() => (reportMessage = null), 6000);
  }

  /** Oublie l'optique mesurée : un étalonnage douteux poisonnait chaque session
   *  (il est persisté), sans aucun moyen de le reprendre depuis l'interface. */
  function forgetFov(): void {
    settings.cameraShortFovDeg = null;
    saveSettings();
    captureMessage = fr.settings.fovForgotten;
    setTimeout(() => (captureMessage = null), 6000);
  }

  /** Capture de la vue caméra : image + repères, à joindre à la conversation. */
  async function captureView(): Promise<void> {
    if (capturing) return;
    capturing = true;
    captureMessage = null;
    try {
      const delivery = await deliverSnapshot(await captureDebugSnapshot());
      captureMessage =
        delivery === 'partage'
          ? fr.viser.captureShared
          : delivery === 'telechargement'
            ? fr.viser.captureSaved
            : fr.viser.captureCancelled;
    } catch {
      captureMessage = fr.viser.captureFailed;
    }
    capturing = false;
    setTimeout(() => (captureMessage = null), 6000);
  }

  const qualities: Array<{ value: RenderQuality; label: string }> = [
    { value: 'auto', label: fr.settings.qualityAuto },
    { value: 'elevee', label: fr.settings.qualityHigh },
    { value: 'eco', label: fr.settings.qualityEco },
  ];

  const unitsChoices: Array<{ value: Units; label: string }> = [
    { value: 'metric', label: fr.settings.unitsMetric },
    { value: 'imperial', label: fr.settings.unitsImperial },
  ];

  const nameChoices: Array<{ value: NamePreference; label: string }> = [
    { value: 'fr', label: fr.settings.namesFr },
    { value: 'local', label: fr.settings.namesLocal },
  ];

  function setQuality(value: RenderQuality): void {
    settings.quality = value;
    saveSettings();
  }

  function setUnits(value: Units): void {
    settings.units = value;
    saveSettings();
  }

  function setNames(value: NamePreference): void {
    settings.names = value;
    saveSettings();
  }
</script>

{#if open}
  <!-- Tiroir de menu (bouton ≡) : modes d'affichage, réglages, débogage, crédits. -->
  <button class="backdrop" aria-label={fr.peakCard.close} onclick={onclose}></button>
  <div class="drawer" role="dialog" aria-label={fr.modes.menu}>
    <header>
      <h2>{fr.appName}</h2>
      <button class="close" onclick={onclose} aria-label={fr.peakCard.close}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <nav aria-label={fr.modes.display}>
      {#each modes as choice (choice.value)}
        <button
          class="mode"
          class:active={mode === choice.value}
          aria-current={mode === choice.value ? 'page' : undefined}
          onclick={() => onmode(choice.value)}
        >
          {choice.label}
        </button>
      {/each}
    </nav>

    <h3>{fr.settings.title}</h3>

    <fieldset>
      <legend>{fr.settings.quality}</legend>
      {#each qualities as choice (choice.value)}
        <label>
          <input
            type="radio"
            name="qualite"
            value={choice.value}
            checked={settings.quality === choice.value}
            onchange={() => setQuality(choice.value)}
          />
          {choice.label}
        </label>
      {/each}
    </fieldset>

    <fieldset>
      <legend>{fr.settings.units}</legend>
      {#each unitsChoices as choice (choice.value)}
        <label>
          <input
            type="radio"
            name="unites"
            value={choice.value}
            checked={settings.units === choice.value}
            onchange={() => setUnits(choice.value)}
          />
          {choice.label}
        </label>
      {/each}
    </fieldset>

    <fieldset>
      <legend>{fr.settings.names}</legend>
      {#each nameChoices as choice (choice.value)}
        <label>
          <input
            type="radio"
            name="noms"
            value={choice.value}
            checked={settings.names === choice.value}
            onchange={() => setNames(choice.value)}
          />
          {choice.label}
        </label>
      {/each}
    </fieldset>

    {#if showInstall}
      <fieldset>
        <legend>{fr.settings.install}</legend>
        <p class="install-hint">{fr.settings.installIosHint}</p>
      </fieldset>
    {/if}

    <fieldset>
      <legend>{fr.settings.debug}</legend>
      <button class="report" onclick={() => void copyReport()}>
        {fr.settings.copyReport}
      </button>
      {#if reportMessage}<p class="report-note" role="status">{reportMessage}</p>{/if}
      {#if reportFallback}
        <textarea class="report-text" readonly rows="6">{reportFallback}</textarea>
      {/if}

      <!-- Le rapport dit ce que l'app croit viser ; la capture montre ce que
           la caméra voit. Rien ne part sans le geste de l'utilisateur. -->
      <button
        class="report capture"
        onclick={() => void captureView()}
        disabled={!canCapture || capturing}
      >
        📸 {fr.settings.captureView}
      </button>
      <p class="report-note">
        {canCapture ? fr.settings.captureHint : fr.settings.captureUnavailable}
      </p>
      {#if captureMessage}
        <p class="report-note capture-message" role="status">{captureMessage}</p>
      {/if}

      <button
        class="report capture"
        onclick={forgetFov}
        disabled={settings.cameraShortFovDeg === null}
      >
        {fr.settings.forgetFov}
      </button>
      <p class="report-note">
        {settings.cameraShortFovDeg === null
          ? fr.settings.fovNone
          : fr.settings.fovStored(settings.cameraShortFovDeg)}
      </p>
    </fieldset>

    <!-- Attributions ODbL/OSM et tuiles : affichées dans l'app (décision n° 14
         du PLAN.md) — ici plutôt qu'en pied de page permanent. -->
    <fieldset>
      <legend>{fr.attributions.intro}</legend>
      <p class="credits">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          {fr.attributions.osm}
        </a><br />
        <a
          href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
          target="_blank"
          rel="noreferrer"
        >
          {fr.attributions.terrain}
        </a><br />
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
          {fr.attributions.basemap}
        </a>
      </p>
    </fieldset>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 7;
    padding: 0;
    border: none;
    background: rgb(0 0 0 / 28%);
    cursor: pointer;
  }

  .drawer {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 8;
    width: min(20rem, 86vw);
    overflow-y: auto;
    padding: calc(0.7rem + var(--safe-top)) 1rem calc(1rem + var(--safe-bottom))
      calc(1rem + var(--safe-left));
    background: var(--surface);
    color: var(--text);
    box-shadow: 4px 0 28px rgb(0 0 0 / 22%);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
  }

  h2 {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--accent-ink);
    letter-spacing: 0.04em;
  }

  .close {
    display: inline-flex;
    width: 2.2rem;
    height: 2.2rem;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }

  .close svg {
    width: 1.3rem;
    height: 1.3rem;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2.2;
    stroke-linecap: round;
  }

  .close:hover {
    background: var(--surface-2);
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 1rem;
  }

  .mode {
    padding: 0.6rem 0.9rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--surface-2);
    color: var(--accent-ink);
    font: inherit;
    font-size: 1rem;
    text-align: left;
    cursor: pointer;
  }

  .mode.active {
    background: var(--accent);
    color: #fff;
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  fieldset {
    margin: 0 0 0.6rem;
    padding: 0.4rem 0.7rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
  }

  fieldset:last-child {
    margin-bottom: 0;
  }

  legend {
    padding: 0 0.3rem;
    color: var(--muted);
    font-size: 0.78rem;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.2rem 0;
    font-size: 0.92rem;
    cursor: pointer;
  }

  input[type='radio'] {
    accent-color: var(--accent);
  }

  .install-hint {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.45;
  }

  .report {
    padding: 0.45rem 0.85rem;
    border: none;
    border-radius: 0.7rem;
    background: var(--surface-2);
    color: var(--accent-ink);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }

  .report:hover:enabled {
    background: color-mix(in srgb, var(--surface-2) 70%, var(--accent) 30%);
  }

  .report:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .report.capture {
    margin-top: 0.45rem;
  }

  .report-note {
    margin: 0.4rem 0 0;
    color: var(--muted);
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .report-text {
    width: 100%;
    margin-top: 0.4rem;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-2);
    color: var(--text);
    font-family: monospace;
    font-size: 0.65rem;
    resize: vertical;
  }

  .credits {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.6;
  }

  .credits a {
    color: var(--muted);
  }

  .credits a:hover {
    color: var(--accent-ink);
  }
</style>
