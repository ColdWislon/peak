<script lang="ts">
  import { buildDebugReport } from '../lib/debug/report';
  import { fr } from '../lib/i18n/fr';
  import type { NamePreference } from '../lib/peaks';
  import type { RenderQuality, Units } from '../lib/settings';
  import { saveSettings, settings } from '../lib/settings/store.svelte';

  let open = $state(false);
  let reportMessage = $state<string | null>(null);
  let reportFallback = $state<string | null>(null);

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

<div class="settings">
  <button
    class="gear"
    class:active={open}
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-label={fr.settings.title}
    title={fr.settings.title}
  >
    ⚙
  </button>

  {#if open}
    <div class="panel" role="dialog" aria-label={fr.settings.title}>
      <h2>{fr.settings.title}</h2>

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

      <fieldset>
        <legend>{fr.settings.debug}</legend>
        <button class="report" onclick={() => void copyReport()}>
          {fr.settings.copyReport}
        </button>
        {#if reportMessage}<p class="report-note" role="status">{reportMessage}</p>{/if}
        {#if reportFallback}
          <textarea class="report-text" readonly rows="6">{reportFallback}</textarea>
        {/if}
      </fieldset>
    </div>
  {/if}
</div>

<style>
  .settings {
    position: relative;
    pointer-events: auto;
  }

  .gear {
    padding: 0.32rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    color: var(--muted);
    font-size: 0.95rem;
    cursor: pointer;
  }

  .gear:hover,
  .gear.active {
    color: var(--text);
    border-color: var(--accent);
  }

  .panel {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    width: 15rem;
    padding: 0.8rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--surface);
    box-shadow: 0 8px 28px rgb(0 0 0 / 40%);
    z-index: 6;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
  }

  fieldset {
    margin: 0 0 0.5rem;
    padding: 0.4rem 0.6rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  fieldset:last-child {
    margin-bottom: 0;
  }

  legend {
    padding: 0 0.3rem;
    color: var(--muted);
    font-size: 0.75rem;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.15rem 0;
    font-size: 0.85rem;
    cursor: pointer;
  }

  input[type='radio'] {
    accent-color: var(--accent);
  }

  .report {
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-2);
    color: var(--accent);
    font-size: 0.82rem;
    cursor: pointer;
  }

  .report:hover {
    border-color: var(--accent);
  }

  .report-note {
    margin: 0.4rem 0 0;
    color: var(--muted);
    font-size: 0.75rem;
  }

  .report-text {
    width: 100%;
    margin-top: 0.4rem;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg);
    color: var(--text);
    font-family: monospace;
    font-size: 0.65rem;
    resize: vertical;
  }
</style>
