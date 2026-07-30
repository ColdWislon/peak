<script lang="ts">
  import { onMount } from 'svelte';
  import { normalizeBearing, type LatLon } from '../lib/geo';
  import { cardinalFor, fr } from '../lib/i18n/fr';
  import { placeLabels, toCandidates, type LabelCandidate, type PlacedLabel } from '../lib/labels';
  import { topPeaks, type Peak } from '../lib/peaks';
  import { peaksAround } from '../lib/peaks/cache';
  import { settings } from '../lib/settings/store.svelte';
  import { tileBlockAround } from '../lib/terrain/blocks';
  import { serializeGeoHeightField } from '../lib/terrain/heightField';
  import { loadBlockHeightField } from '../lib/terrain/loader';
  import { iosCompassToAlpha, orientationToAim } from '../lib/viser/orientation';
  import { detectImageSkyline, matchSkyline } from '../lib/viser/skyline';
  import type {
    PeakSight,
    VisibilityRequest,
    VisibilityResponse,
  } from '../lib/visibility/protocol';
  import PeakLabels from './PeakLabels.svelte';

  /** Mêmes champs d'altitude que le panorama (proche z12, lointain z10). */
  const INNER = { zoom: 12, radiusM: 24_000 };
  const OUTER = { zoom: 10, radiusM: 115_000 };
  /** Téléphone tenu à la main. */
  const EYE_HEIGHT_M = 1.7;
  /** FOV vertical supposé de la caméra arrière (typique 50–60°). */
  const FOV_DEG = 55;
  const PEAKS_RADIUS_M = 75_000;
  const PEAKS_LIMIT = 300;
  /** Pas d'azimut du profil d'horizon théorique (°). */
  const SKYLINE_STEP_DEG = 0.5;

  let { viewpoint }: { viewpoint: LatLon } = $props();

  let container: HTMLDivElement;
  let video: HTMLVideoElement;
  let phase = $state<'idle' | 'starting' | 'running' | 'error'>('idle');
  let errorMessage = $state<string | null>(null);
  let sensorless = $state(false);
  let heading = $state(0);
  let labels = $state<PlacedLabel[]>([]);
  let peaksStatus = $state<'idle' | 'searching' | 'error' | 'empty' | 'noneVisible' | 'ok'>('idle');

  let stream: MediaStream | undefined;
  let worker: Worker | undefined;
  let peaks: Peak[] = [];
  let sights: PeakSight[] = [];
  let candidates: LabelCandidate[] = [];
  let eyeElevation = 0;
  let aim = { heading: 0, pitch: 0 };
  /** Recalages : glissé manuel et/ou alignement automatique sur l'horizon. */
  let headingOffset = 0;
  let pitchOffset = 0;
  let demSkyline = $state<Float32Array | null>(null);
  let calibrating = $state(false);
  let calibMessage = $state<string | null>(null);
  let calibTimer: ReturnType<typeof setTimeout> | undefined;
  let gotSensor = false;
  let relayoutQueued = false;

  function relayout(): void {
    if (relayoutQueued || !container) return;
    relayoutQueued = true;
    requestAnimationFrame(() => {
      relayoutQueued = false;
      if (!container) return;
      const headingNow = normalizeBearing(aim.heading + headingOffset);
      heading = headingNow;
      labels = placeLabels(candidates, {
        headingDeg: headingNow,
        pitchDeg: aim.pitch + pitchOffset,
        fovDeg: FOV_DEG,
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
  }

  function onOrientation(event: DeviceOrientationEvent): void {
    const compass = (event as { webkitCompassHeading?: number }).webkitCompassHeading;
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    gotSensor = true;
    sensorless = false;
    const alpha = typeof compass === 'number' ? iosCompassToAlpha(compass) : event.alpha;
    const next = orientationToAim(alpha, event.beta, event.gamma);
    aim = { heading: next.headingDeg, pitch: next.pitchDeg };
    relayout();
  }

  async function loadData(): Promise<void> {
    peaksStatus = 'searching';
    labels = [];
    candidates = [];
    sights = [];
    worker?.terminate();
    worker = new Worker(new URL('../workers/visibility.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<VisibilityResponse>) => {
      sights = event.data.sights;
      demSkyline = event.data.skyline;
      candidates = toCandidates(sights, peaks, eyeElevation, settings.names);
      peaksStatus = candidates.length > 0 ? 'ok' : 'noneVisible';
      relayout();
    };
    worker.onerror = () => {
      peaksStatus = 'error';
    };

    const plain = { lat: viewpoint.lat, lon: viewpoint.lon };
    try {
      const [inner, outer] = await Promise.all([
        loadBlockHeightField(tileBlockAround(plain, INNER.radiusM, INNER.zoom)),
        loadBlockHeightField(tileBlockAround(plain, OUTER.radiusM, OUTER.zoom)),
      ]);
      eyeElevation = (inner.contains(plain) ? inner.elevationAt(plain) : 0) + EYE_HEIGHT_M;
      peaks = topPeaks(await peaksAround(plain, PEAKS_RADIUS_M), PEAKS_LIMIT);
      if (peaks.length === 0) {
        peaksStatus = 'empty';
        return;
      }
      const request: VisibilityRequest = {
        viewpoint: plain,
        eyeElevation,
        innerRadiusM: INNER.radiusM,
        inner: serializeGeoHeightField(inner),
        outer: serializeGeoHeightField(outer),
        peaks: peaks.map(({ id, lat, lon, elevation }) => ({ id, lat, lon, elevation })),
        skylineStepDeg: SKYLINE_STEP_DEG,
      };
      worker.postMessage(request, [request.inner.data.buffer, request.outer.data.buffer]);
    } catch {
      peaksStatus = 'error';
    }
  }

  async function start(): Promise<void> {
    phase = 'starting';
    errorMessage = null;
    try {
      // iOS exige une demande explicite depuis un geste utilisateur.
      const Ctor = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<string>;
      };
      if (typeof Ctor?.requestPermission === 'function') {
        if ((await Ctor.requestPermission()) !== 'granted') {
          throw new Error('capteurs refusés');
        }
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch {
      phase = 'error';
      errorMessage = fr.viser.cameraError;
      return;
    }
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener);
    window.addEventListener('deviceorientation', onOrientation as EventListener);
    setTimeout(() => {
      if (!gotSensor) sensorless = true;
    }, 2500);
    phase = 'running';
    void loadData();
  }

  /** Recalage automatique : aligne l'horizon détecté sur le profil du relief. */
  function autoCalibrate(): void {
    if (!demSkyline || calibrating || video.videoWidth === 0) return;
    calibrating = true;
    clearTimeout(calibTimer);
    try {
      const width = 240;
      const height = Math.max(60, Math.round((width * video.videoHeight) / video.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas indisponible');
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);

      const detected = detectImageSkyline(image.data, width, height);
      const match = matchSkyline(
        detected,
        {
          headingDeg: normalizeBearing(aim.heading + headingOffset),
          pitchDeg: aim.pitch + pitchOffset,
          fovDeg: FOV_DEG,
        },
        demSkyline,
        { demStepDeg: SKYLINE_STEP_DEG },
      );

      if (!match || match.maeDeg > 1.5) {
        calibMessage = fr.viser.horizonNotFound;
      } else {
        headingOffset += match.headingOffsetDeg;
        pitchOffset += match.pitchOffsetDeg;
        const deg = Math.round(match.headingOffsetDeg);
        calibMessage = `${fr.viser.horizonLocked} (${deg >= 0 ? '+' : ''}${deg}°)`;
        relayout();
      }
    } catch {
      calibMessage = fr.viser.horizonNotFound;
    }
    calibrating = false;
    calibTimer = setTimeout(() => (calibMessage = null), 4000);
  }

  // Glissé : recalage de la boussole, ou visée complète sans capteurs.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  function onDown(e: PointerEvent): void {
    // La capture du pointeur retargetterait le click : ne pas voler les boutons.
    if ((e.target as HTMLElement | null)?.closest('button')) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    container.setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent): void {
    if (!dragging || phase !== 'running') return;
    const degPerPx = FOV_DEG / Math.max(1, container.clientHeight);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (sensorless) {
      aim = {
        heading: normalizeBearing(aim.heading - dx * degPerPx),
        pitch: Math.max(-40, Math.min(60, aim.pitch + dy * degPerPx)),
      };
    } else {
      headingOffset -= dx * degPerPx;
    }
    relayout();
  }
  function onUp(): void {
    dragging = false;
  }

  onMount(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener);
      window.removeEventListener('deviceorientation', onOrientation as EventListener);
      worker?.terminate();
    };
  });

  // Téléportation en cours de visée : recharge les données du nouveau point.
  $effect(() => {
    void viewpoint.lat;
    void viewpoint.lon;
    if (phase === 'running') void loadData();
  });

  // Changement de préférence de nom : recompose sans recharger.
  $effect(() => {
    void settings.names;
    if (sights.length === 0) return;
    candidates = toCandidates(sights, peaks, eyeElevation, settings.names);
    relayout();
  });
</script>

<div
  class="viser"
  bind:this={container}
  role="application"
  aria-label={fr.modes.viser}
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointercancel={onUp}
>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} playsinline muted></video>

  <PeakLabels {labels} />

  {#if phase === 'running'}
    <div class="hud" aria-live="off">
      {Math.round(heading)}° · {cardinalFor(heading)}
    </div>
    <p class="hint">{sensorless ? fr.viser.dragHint : fr.viser.calibrateHint}</p>

    {#if demSkyline && !sensorless}
      <button class="calibrate" onclick={autoCalibrate} disabled={calibrating}>
        ✨ {fr.viser.calibrateAuto}
      </button>
    {/if}
    {#if calibMessage}
      <p class="calib-message" role="status">{calibMessage}</p>
    {/if}

    {#if peaksStatus !== 'ok' && peaksStatus !== 'idle'}
      <div class="peaks-status" role="status">
        {#if peaksStatus === 'searching'}
          {fr.peaks.searching}
        {:else if peaksStatus === 'error'}
          {fr.peaks.unavailable}
          <button onclick={() => void loadData()}>{fr.peaks.retry}</button>
        {:else if peaksStatus === 'empty'}
          {fr.peaks.none}
        {:else}
          {fr.peaks.noneVisible}
        {/if}
      </div>
    {/if}
  {:else}
    <div class="veil">
      <p class="intro">{fr.viser.intro}</p>
      {#if errorMessage}<p class="error">{errorMessage}</p>{/if}
      <button class="start" onclick={() => void start()} disabled={phase === 'starting'}>
        {fr.viser.start}
      </button>
    </div>
  {/if}
</div>

<style>
  .viser {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: #000;
    touch-action: none;
  }

  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .hud {
    position: absolute;
    top: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border: 1px solid var(--border);
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
    pointer-events: none;
  }

  .calibrate {
    position: absolute;
    bottom: 5.2rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.5rem 1.1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    color: var(--accent);
    font-size: 0.88rem;
    cursor: pointer;
  }

  .calibrate:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .calibrate:hover:enabled {
    border-color: var(--accent);
  }

  .calib-message {
    position: absolute;
    bottom: 8rem;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 0.82rem;
    white-space: nowrap;
    pointer-events: none;
  }

  .hint {
    position: absolute;
    bottom: 2.6rem;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.25rem 0.8rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    color: var(--muted);
    font-size: 0.72rem;
    white-space: nowrap;
    pointer-events: none;
  }

  .peaks-status {
    position: absolute;
    top: 3.1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    color: var(--muted);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .peaks-status button {
    padding: 0.15rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--accent);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .veil {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1.5rem;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    text-align: center;
  }

  .intro {
    max-width: 26rem;
    margin: 0;
    color: var(--text);
    line-height: 1.5;
  }

  .error {
    margin: 0;
    color: #ff9a8a;
    font-size: 0.88rem;
  }

  .start {
    padding: 0.6rem 1.4rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--accent);
    font-size: 1rem;
    cursor: pointer;
  }

  .start:hover {
    border-color: var(--accent);
  }
</style>
