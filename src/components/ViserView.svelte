<script lang="ts">
  import { onMount } from 'svelte';
  import { logDebug, registerDebugProvider } from '../lib/debug/report';
  import {
    canvasToBlob,
    captionLayout,
    fitSnapshot,
    registerSnapshotSource,
    snapshotCaption,
    snapshotFileName,
    type CaptionLayout,
    type DebugSnapshot,
    type SnapshotAim,
    type SnapshotCalibration,
  } from '../lib/debug/snapshot';
  import { favorites } from '../lib/favorites/store.svelte';
  import {
    haversineDistance,
    normalizeBearing,
    radToDeg,
    signedDeltaDeg,
    type LatLon,
  } from '../lib/geo';
  import { fr } from '../lib/i18n/fr';
  import {
    estimateLabelLength,
    LABEL_ANGLE_DEG,
    LABEL_LEADER_MIN,
    LABEL_THICKNESS,
    placeLabels,
    projectPeaks,
    toCandidates,
    type LabelCandidate,
    type PeakDot,
    type PlacedLabel,
  } from '../lib/labels';
  import { topPeaksFrom, type Peak } from '../lib/peaks';
  import { peaksAround } from '../lib/peaks/cache';
  import { saveSettings, settings } from '../lib/settings/store.svelte';
  import { tileBlockAround } from '../lib/terrain/blocks';
  import { serializeGeoHeightField } from '../lib/terrain/heightField';
  import { loadBlockHeightField } from '../lib/terrain/loader';
  import { AimFilter } from '../lib/viser/aimFilter';
  import { compassBands, type CompassBands } from '../lib/viser/compass';
  import { shouldMoveViewpoint, type PositionFix } from '../lib/viser/follow';
  import {
    addFovSample,
    FOV_MIN_SPREAD_DEG,
    fovSampleWeight,
    smoothedFovDeg,
  } from '../lib/viser/optics';
  import {
    detectImageSkyline,
    isMatchReliable,
    matchSkyline,
    ridgeScreenPolylines,
    skylineScreenPoints,
    skylineSpreadDeg,
    type RidgeLine,
  } from '../lib/viser/skyline';
  import { coverCrop, frameShape, screenFovDeg, shortSideFovDeg } from '../lib/viser/videoView';
  import type {
    PeakSight,
    VisibilityRequest,
    VisibilityResponse,
  } from '../lib/visibility/protocol';
  import type { ViewpointSource } from '../lib/viewpoint/url';
  import CompassRibbon from './CompassRibbon.svelte';
  import PeakCard from './PeakCard.svelte';
  import PeakLabels from './PeakLabels.svelte';

  /** Mêmes champs d'altitude que le panorama (proche z12, lointain z10). */
  const INNER = { zoom: 12, radiusM: 24_000 };
  const OUTER = { zoom: 10, radiusM: 115_000 };
  /** Téléphone tenu à la main. */
  const EYE_HEIGHT_M = 1.7;
  /** FOV du petit côté du capteur par défaut, remplacé par la mesure au recalage. */
  const DEFAULT_SHORT_FOV_DEG = 55;
  /**
   * Plage plausible du FOV petit côté (smartphones), bornes de l'estimation.
   * Le plancher descend à 28° : un flux 16:9 (fréquent sur iPhone) est une
   * découpe du capteur dont le petit côté voit ~40° — l'ancien plancher de 40°
   * bloquait l'estimation SUR la borne (rapport terrain n° 2 : « capteur 40,0°
   * (étalonné) » persisté alors que la valeur n'était que bornée).
   */
  const SHORT_FOV_MIN_DEG = 28;
  const SHORT_FOV_MAX_DEG = 80;
  const PEAKS_RADIUS_M = 75_000;
  const PEAKS_LIMIT = 300;
  /** Pas d'azimut du profil d'horizon théorique (°). */
  const SKYLINE_STEP_DEG = 0.5;
  /** Zoom numérique : ×1 (optique nue) à ×4 (au-delà, bouillie de pixels). */
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  /** Relief ou sommets injoignables (réseau mobile) : on réessaie tout seul. */
  const RETRY_MS = 20_000;

  let {
    viewpoint,
    viewpointSource,
    onteleport,
    onmap,
    onposition,
  }: {
    viewpoint: LatLon;
    viewpointSource: ViewpointSource;
    /** « Téléporter » depuis la fiche : le panorama depuis ce sommet. */
    onteleport: (target: LatLon) => void;
    /** « Voir sur la carte » depuis la fiche. */
    onmap: (target: LatLon) => void;
    /** Suivi GPS : le point de vue rejoint la position réelle. */
    onposition: (target: LatLon) => void;
  } = $props();

  let container: HTMLDivElement;
  let video: HTMLVideoElement;
  let phase = $state<'idle' | 'starting' | 'running' | 'error'>('idle');
  let errorMessage = $state<string | null>(null);
  let sensorless = $state(false);
  let labels = $state<PlacedLabel[]>([]);
  /** Sommets visibles dans le cadre, étiquetés ou non : un point sur la crête. */
  let dots = $state<PeakDot[]>([]);
  /** Sommet dont la fiche est ouverte (étiquette touchée). */
  let selected = $state<PlacedLabel | null>(null);
  /**
   * Suivi figé : les capteurs sont ignorés, l'image et les repères restent en
   * place — pour lire une fiche ou comparer à l'aise. Une étiquette touchée
   * fige la visée ; « Débloquer le suivi » (ou un toucher sur l'image) la rend.
   */
  let locked = $state(false);
  /** Conseil de recalage : affiché quelques secondes après le démarrage. */
  let hintVisible = $state(false);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Suivi continu de la position : la caméra filme d'où l'on est, le point de
   * vue suit donc le GPS tant que la visée tourne — quelle que soit l'origine
   * du point de vue à l'entrée (rapport terrain n° 9 : un « Panorama ici »
   * pris sur la carte avait laissé la visée 1,5 km à côté du téléphone). Un
   * lieu choisi PENDANT la visée (recherche, carte, sommet) l'arrête — c'est
   * un choix explicite dans ce mode ; le bouton ⌖ le rend.
   */
  let following = $state(true);
  let positionMessage = $state<string | null>(null);
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  /** Horodatage du dernier déplacement suivi (cadence) et dernier relevé reçu. */
  let lastMoveMs: number | null = null;
  let lastFix: Record<string, unknown> | null = null;
  let lastFixPosition: LatLon | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Le prochain rechargement vient du suivi : garder les repères à l'écran. */
  let silentReload = false;
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
  /** Rubans de boussole : cap recalé et, s'il y a recalage, cap brut des capteurs. */
  let compass = $state<CompassBands | null>(null);
  let demSkyline = $state<Float32Array | null>(null);
  /** Polyligne SVG de l'horizon calculé (points « x,y … ») et sa taille de repère. */
  let horizonPoints = $state('');
  /** Mêmes points, en nombres : la capture de débogage les redessine au canvas. */
  let horizonScreen: Array<{ x: number; y: number }> = [];
  /** Crêtes intermédiaires (silhouettes devant l'horizon) : profil et polylignes. */
  let demRidges: RidgeLine[] = [];
  let ridgeLines = $state<string[]>([]);
  let ridgeScreen: Array<Array<{ x: number; y: number }>> = [];
  let viewSize = $state({ w: 1, h: 1 });
  let calibrating = $state(false);
  let calibMessage = $state<string | null>(null);
  let calibTimer: ReturnType<typeof setTimeout> | undefined;
  /** Capture de débogage (déclenchée depuis le menu ≡) : trace du dernier envoi. */
  let lastCapture: Record<string, unknown> | null = null;
  /** Verdict du dernier recalage tenté : gravé dans la capture de débogage. */
  let lastCalibration: SnapshotCalibration | null = null;
  /** Zoom numérique courant : la vidéo est agrandie en CSS, le FOV suit. */
  let zoom = $state(1);
  let gotSensor = false;
  let relayoutQueued = false;
  let lastRawOrientation: Record<string, unknown> | null = null;
  /** Stabilise le cap (boussole iOS illisible téléphone à la verticale). */
  let aimFilter = new AimFilter();
  /** Dernier événement absolu vu : le flux relatif d'Android est alors ignoré. */
  let lastAbsoluteMs = Number.NEGATIVE_INFINITY;

  /** Forme du cadre caméra courant (grand côté / petit côté), null sans vidéo. */
  function streamAspect(): number | null {
    return video ? frameShape(video.videoWidth, video.videoHeight) : null;
  }

  /**
   * Vrai si l'étalonnage mémorisé a été mesuré sur un flux de même FORME.
   * Un 16:9 est une découpe d'un 4:3 : son petit côté ne voit pas le même
   * angle, la valeur mémorisée serait fausse en silence. La rotation de
   * l'appareil, elle, ne change rien : la forme est normalisée.
   */
  function storedFovUsable(): boolean {
    if (settings.cameraShortFovDeg === null) return false;
    const stored = settings.cameraStreamAspect;
    const current = streamAspect();
    if (stored === null || current === null) return true; // rien à comparer
    return Math.abs(current - stored) / stored < 0.02;
  }

  /** FOV petit côté du capteur : le web ne l'expose pas — étalonné, persisté. */
  function shortFov(): number {
    return storedFovUsable() ? settings.cameraShortFovDeg! : DEFAULT_SHORT_FOV_DEG;
  }

  /**
   * FOV vertical de la VUE : la vidéo est affichée en `object-fit: cover`, donc
   * l'écran ne montre qu'une découpe du cadre caméra — encore resserrée par le
   * zoom numérique. En paysage cette découpe est une bande centrale — son FOV
   * vertical est bien plus étroit que celui du capteur ; toutes les projections
   * (étiquettes, horizon, glissés, calibrage) partagent cette valeur-là.
   */
  function currentScreenFov(): number {
    if (!video || !container || video.videoWidth === 0 || container.clientHeight === 0) {
      return shortFov();
    }
    return screenFovDeg(
      shortFov(),
      video.videoWidth,
      video.videoHeight,
      container.clientWidth,
      container.clientHeight,
      zoom,
    );
  }

  function relayout(): void {
    if (relayoutQueued || !container) return;
    relayoutQueued = true;
    requestAnimationFrame(() => {
      relayoutQueued = false;
      if (!container) return;
      const headingNow = normalizeBearing(aim.heading + headingOffset);
      const view = {
        headingDeg: headingNow,
        pitchDeg: aim.pitch + pitchOffset,
        fovDeg: currentScreenFov(),
        width: container.clientWidth,
        height: container.clientHeight,
      };
      compass = compassBands(view, headingOffset);
      labels = placeLabels(candidates, view);
      dots = projectPeaks(candidates, view);
      if (demSkyline) {
        horizonScreen = skylineScreenPoints(demSkyline, SKYLINE_STEP_DEG, view);
        horizonPoints = horizonScreen.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        ridgeScreen = ridgeScreenPolylines(demRidges, SKYLINE_STEP_DEG, view);
        ridgeLines = ridgeScreen.map((line) =>
          line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        );
        viewSize = { w: view.width, h: view.height };
      } else {
        horizonScreen = [];
        horizonPoints = '';
        ridgeScreen = [];
        ridgeLines = [];
      }
    });
  }

  function onOrientation(event: DeviceOrientationEvent): void {
    const compass = (event as { webkitCompassHeading?: number }).webkitCompassHeading;
    const accuracy = (event as { webkitCompassAccuracy?: number }).webkitCompassAccuracy;
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    // Boussole iOS non étalonnée (accuracy < 0) : traitée comme absente.
    const hasCompass =
      typeof compass === 'number' && (typeof accuracy !== 'number' || accuracy >= 0);
    // Android émet deux flux (absolu + relatif) dont les origines de cap
    // diffèrent — les mélanger ferait sauter la visée. Tant que le flux
    // absolu vit, les événements relatifs sans boussole iOS sont écartés.
    if (event.absolute) lastAbsoluteMs = event.timeStamp;
    else if (!hasCompass && event.timeStamp - lastAbsoluteMs < 1000) return;
    lastRawOrientation = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      boussoleWebkit: hasCompass ? compass : null,
      absolu: event.absolute,
    };
    if (!gotSensor) logDebug('viser:capteurs', lastRawOrientation);
    gotSensor = true;
    sensorless = false;
    if (locked) return; // suivi figé : l'image reste où elle est
    const next = aimFilter.update({
      alphaDeg: event.alpha,
      betaDeg: event.beta,
      gammaDeg: event.gamma,
      compassDeg: hasCompass ? compass : null,
      timeMs: event.timeStamp,
    });
    aim = { heading: next.headingDeg, pitch: next.pitchDeg };
    relayout();
  }

  /**
   * Charge relief et sommets du point de vue courant. En mode `silent` (suivi
   * GPS), les repères en place restent affichés jusqu'aux nouveaux résultats :
   * un pas de 30 m ne doit pas faire clignoter les étiquettes.
   */
  async function loadData(silent = false): Promise<void> {
    clearTimeout(retryTimer);
    if (!silent) {
      peaksStatus = 'searching';
      labels = [];
      candidates = [];
      sights = [];
    }
    worker?.terminate();
    worker = new Worker(new URL('../workers/visibility.ts', import.meta.url), {
      type: 'module',
    });
    // Garde anti-course : si un rechargement plus récent remplace ce worker
    // pendant les await ci-dessous, cet appel-ci abandonne (sinon les deux
    // postaient leur requête au worker le plus récent — réponses en double).
    const mine = worker;
    worker.onmessage = (event: MessageEvent<VisibilityResponse>) => {
      sights = event.data.sights;
      demSkyline = event.data.skyline;
      demRidges = event.data.ridges ?? [];
      candidates = toCandidates(sights, peaks, eyeElevation, settings.names);
      peaksStatus = candidates.length > 0 ? 'ok' : 'noneVisible';
      logDebug('viser:visibilite', {
        visibles: candidates.length,
        horizonCalcule: demSkyline !== null,
        cretes: demRidges.length,
      });
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
      if (worker !== mine) return; // supplanté pendant le chargement
      eyeElevation = (inner.contains(plain) ? inner.elevationAt(plain) : 0) + EYE_HEIGHT_M;
      peaks = topPeaksFrom(
        await peaksAround(plain, PEAKS_RADIUS_M),
        plain,
        eyeElevation,
        PEAKS_LIMIT,
      );
      if (worker !== mine) return;
      logDebug('viser:donnees', {
        pointDeVue: plain,
        oeil: Math.round(eyeElevation),
        sommets: peaks.length,
      });
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
    } catch (error) {
      logDebug('viser:erreur', { etape: 'donnees', detail: String(error) });
      peaksStatus = 'error';
      // « TypeError: Load failed » en série dans le rapport terrain n° 9 :
      // réseau mobile capricieux. Le bouton reste, mais on réessaie sans lui,
      // en gardant les repères déjà posés s'il y en a.
      retryTimer = setTimeout(() => {
        if (phase === 'running' && peaksStatus === 'error') void loadData(true);
      }, RETRY_MS);
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
        video: {
          facingMode: 'environment',
          // Sans contrainte, iOS sert du 640×480 : trop grossier pour détecter
          // une crête lointaine (rapport terrain n° 4). On demande plus fin EN
          // GARDANT le 4:3 — changer de forme changerait le FOV du petit côté
          // et invaliderait l'étalonnage (l'aspect est vérifié au démarrage).
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      logDebug('viser:start', {
        video: { w: video.videoWidth, h: video.videoHeight },
        fovPetitCote: shortFov(),
        etalonnageUtilisable: storedFovUsable(),
        aspectEtalonnage: settings.cameraStreamAspect,
      });
    } catch (error) {
      logDebug('viser:erreur', { etape: 'start', detail: String(error) });
      phase = 'error';
      errorMessage = fr.viser.cameraError;
      return;
    }
    // Session capteurs neuve : le décalage boussole appris repart de zéro.
    aimFilter = new AimFilter();
    lastAbsoluteMs = Number.NEGATIVE_INFINITY;
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener);
    window.addEventListener('deviceorientation', onOrientation as EventListener);
    setTimeout(() => {
      if (!gotSensor) sensorless = true;
    }, 2500);
    // Pas d'appel direct à loadData : l'$effect (phase + point de vue) s'en
    // charge — l'appeler ici aussi doublait chargement et worker (deux
    // « viser:donnees » dans les rapports de débogage).
    phase = 'running';
    showHint();
    relayout(); // Les repères se posent sans attendre le premier événement capteur.
  }

  function showHint(): void {
    hintVisible = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hintVisible = false), 8000);
  }

  /** Une étiquette touchée : sa fiche s'ouvre et la visée se fige. */
  function select(label: PlacedLabel): void {
    selected = label;
    if (!sensorless) locked = true;
  }

  /** « Débloquer le suivi » : ferme la fiche et rend la visée aux capteurs. */
  function unlock(): void {
    selected = null;
    locked = false;
  }

  /** Toucher sur l'image (sans glissé) : ferme la fiche, ou fige/rend la visée. */
  function onTap(): void {
    if (selected) unlock();
    else if (!sensorless) locked = !locked;
  }

  function showPositionMessage(message: string): void {
    positionMessage = message;
    clearTimeout(positionTimer);
    positionTimer = setTimeout(() => (positionMessage = null), 4000);
  }

  /** Relevé GPS : ne déplace le point de vue que pour un vrai déplacement. */
  function onFix(position: GeolocationPosition): void {
    const fix: PositionFix = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracyM: position.coords.accuracy,
      timeMs: position.timestamp,
    };
    const move = shouldMoveViewpoint({ lat: viewpoint.lat, lon: viewpoint.lon }, fix, lastMoveMs);
    lastFixPosition = { lat: fix.lat, lon: fix.lon };
    lastFix = { lat: fix.lat, lon: fix.lon, precisionM: Math.round(fix.accuracyM), suivi: move };
    if (!move) return;
    lastMoveMs = fix.timeMs;
    silentReload = true;
    logDebug('viser:position', lastFix);
    onposition({ lat: fix.lat, lon: fix.lon });
  }

  function onFixError(error: GeolocationPositionError): void {
    logDebug('viser:position', { erreur: error.message, code: error.code });
    // Refus : inutile d'insister. Délai ou signal perdu : on continue d'écouter.
    if (error.code === error.PERMISSION_DENIED) {
      following = false;
      showPositionMessage(fr.viser.positionError);
    }
  }

  /** Recalage automatique : aligne l'horizon détecté sur le profil du relief. */
  function autoCalibrate(): void {
    if (!demSkyline || calibrating || video.videoWidth === 0) return;
    calibrating = true;
    clearTimeout(calibTimer);
    try {
      const viewW = container.clientWidth;
      const viewH = container.clientHeight;
      // N'analyser que la partie du flux réellement affichée (`object-fit:
      // cover`, zoom compris) : en paysage, le plein cadre 4:3 déborde beaucoup
      // de l'écran et son premier plan invisible (rochers, reflets) accroche le
      // détecteur alors que l'utilisateur cadre un horizon propre — cf. rapport
      // terrain.
      const crop = coverCrop(video.videoWidth, video.videoHeight, viewW, viewH, zoom);
      // 320 colonnes plutôt que 240 : chaque ligne de l'image réduite vaut
      // ~2,6 px de vue au lieu de 3,5 — l'amplitude de la crête, donc le
      // FOV, se mesure d'autant mieux.
      const width = 320;
      const height = Math.max(60, Math.round((width * viewH) / Math.max(1, viewW)));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas indisponible');
      ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);

      const screenFov = currentScreenFov();
      const boundFov = (shortSide: number) =>
        screenFovDeg(shortSide, video.videoWidth, video.videoHeight, viewW, viewH, zoom);
      const detected = detectImageSkyline(image.data, width, height);
      const view = {
        headingDeg: normalizeBearing(aim.heading + headingOffset),
        pitchDeg: aim.pitch + pitchOffset,
        fovDeg: screenFov,
      };
      const estimate = matchSkyline(detected, view, demSkyline, {
        demStepDeg: SKYLINE_STEP_DEG,
        // Bornes exprimées côté vue : mêmes limites physiques du capteur,
        // vues à travers la découpe courante.
        fovSearch: { minDeg: boundFov(SHORT_FOV_MIN_DEG), maxDeg: boundFov(SHORT_FOV_MAX_DEG) },
      });
      // L'optique mesurée n'est adoptée que sur un alignement excellent, non
      // borné (surface de coût plate en FOV, optimum en butée = valeur non
      // mesurée) ET une crête assez ample : sur une ligne presque droite,
      // étirer (FOV) ou décaler (cap) laissent le même résidu — la mesure
      // flottait de 41 à 53° pour le même capteur (rapport terrain n° 10).
      const spreadDeg = skylineSpreadDeg(detected, screenFov);
      const adoptFov =
        estimate !== null &&
        estimate.maeDeg <= 0.8 &&
        !estimate.fovAtBound &&
        spreadDeg >= FOV_MIN_SPREAD_DEG &&
        isMatchReliable(estimate);
      // Optique en usage après ce recalage : la médiane pondérée de toutes les
      // mesures adoptées (lib/viser/optics), pas la dernière seule.
      let shortFovInUse = shortFov();
      if (adoptFov && estimate) {
        const measured = shortSideFovDeg(
          estimate.fovDeg,
          video.videoWidth,
          video.videoHeight,
          viewW,
          viewH,
          zoom,
        );
        const sample = {
          fovDeg: Math.min(100, Math.max(25, Math.round(measured * 2) / 2)),
          weight: fovSampleWeight(spreadDeg, estimate.maeDeg),
        };
        // Un étalonnage d'une autre FORME de flux ne se mélange pas : on
        // repart d'un historique neuf (l'aspect est mémorisé avec).
        const sameShape = storedFovUsable();
        settings.cameraFovSamples = addFovSample(
          sameShape ? settings.cameraFovSamples : [],
          sample,
        );
        settings.cameraShortFovDeg = smoothedFovDeg(settings.cameraFovSamples);
        settings.cameraStreamAspect = Number((streamAspect() ?? 0).toFixed(3));
        saveSettings();
        shortFovInUse = settings.cameraShortFovDeg ?? sample.fovDeg;
      }
      // Cap et assiette ne valent QUE pour le FOV avec lequel ils ont été
      // trouvés : appliquer ceux d'un FOV qu'on écarte, c'est corriger la visée
      // pour une autre optique que celle qui dessine l'écran — l'horizon collait
      // au bord et décrochait de 3° au centre (rapport terrain n° 4). La mise
      // en correspondance est donc refaite au FOV réellement en usage : le
      // courant si la mesure est écartée, le lissé si elle est adoptée (sauf
      // s'il coïncide avec elle).
      const fovInUse = boundFov(shortFovInUse);
      const match =
        adoptFov && estimate && Math.abs(fovInUse - estimate.fovDeg) < 0.2
          ? estimate
          : matchSkyline(detected, { ...view, fovDeg: fovInUse }, demSkyline, {
              demStepDeg: SKYLINE_STEP_DEG,
            });
      const reliable = match !== null && isMatchReliable(match);

      const conf = [...detected.confidence].sort((a, b) => a - b);
      logDebug('viser:calibrage', {
        confiance: {
          min: Number(conf[0]?.toFixed(2)),
          mediane: Number(conf[Math.floor(conf.length / 2)]?.toFixed(2)),
          max: Number(conf[conf.length - 1]?.toFixed(2)),
        },
        fovEcran: Number(screenFov.toFixed(1)),
        amplitudeCrete: Number(spreadDeg.toFixed(2)),
        zoom: Number(zoom.toFixed(2)),
        recadrage: {
          sx: Math.round(crop.sx),
          sy: Math.round(crop.sy),
          sw: Math.round(crop.sw),
          sh: Math.round(crop.sh),
        },
        optique: estimate
          ? {
              fov: Number(estimate.fovDeg.toFixed(1)),
              enButee: estimate.fovAtBound,
              mae: Number.isFinite(estimate.maeDeg) ? Number(estimate.maeDeg.toFixed(3)) : null,
              adoptee: adoptFov,
              lissee: adoptFov ? settings.cameraShortFovDeg : null,
              mesures: settings.cameraFovSamples.length,
            }
          : null,
        resultat: match
          ? {
              cap: Number(match.headingOffsetDeg.toFixed(2)),
              assiette: Number(match.pitchOffsetDeg.toFixed(2)),
              fov: Number(match.fovDeg.toFixed(1)),
              mae: Number.isFinite(match.maeDeg) ? Number(match.maeDeg.toFixed(3)) : null,
              colonnes: match.usedColumns,
              concordantes: match.inlierColumns,
            }
          : null,
        applique: reliable,
      });

      lastCalibration = {
        applied: reliable,
        maeDeg: match && Number.isFinite(match.maeDeg) ? match.maeDeg : null,
        inlierRatio:
          match && match.usedColumns > 0 ? match.inlierColumns / match.usedColumns : null,
        fovDeg: match ? match.fovDeg : null,
        fovAdopted: adoptFov,
        fovEstimateDeg: estimate ? estimate.fovDeg : null,
        fovAtBound: estimate ? estimate.fovAtBound : false,
        shortFovDeg: null, // rempli ci-dessous si l'optique est adoptée
      };

      if (!match || !reliable) {
        calibMessage = fr.viser.horizonNotFound;
      } else {
        // Arc court : sans cela, des recalages successifs s'empilent jusqu'à
        // des « +380° » incompréhensibles dans le rapport (rapport terrain n° 3).
        headingOffset = signedDeltaDeg(headingOffset + match.headingOffsetDeg);
        pitchOffset += match.pitchOffsetDeg;
        const deg = Math.round(match.headingOffsetDeg);
        if (adoptFov && settings.cameraShortFovDeg !== null) {
          if (lastCalibration) lastCalibration.shortFovDeg = settings.cameraShortFovDeg;
          const n = settings.cameraFovSamples.length;
          calibMessage =
            `${fr.viser.horizonLocked} (${deg >= 0 ? '+' : ''}${deg}°, ` +
            `FOV ${Math.round(settings.cameraShortFovDeg)}° · ${n} mesure${n > 1 ? 's' : ''})`;
        } else {
          calibMessage = `${fr.viser.horizonLocked} (${deg >= 0 ? '+' : ''}${deg}°)`;
        }
        relayout();
      }
    } catch {
      calibMessage = fr.viser.horizonNotFound;
    }
    calibrating = false;
    calibTimer = setTimeout(() => (calibMessage = null), 4000);
  }

  /* ----------------------------------------------------------------------- */
  /* Capture de débogage : donner à voir ce que la caméra voit vraiment.       */
  /* ----------------------------------------------------------------------- */

  /** Trace l'horizon calculé et les crêtes sur l'image (mêmes points que le SVG). */
  function drawHorizon(ctx: CanvasRenderingContext2D, scale: number): void {
    if (horizonScreen.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    const trace = (points: Array<{ x: number; y: number }>): void => {
      ctx.beginPath();
      points.forEach((point, i) => {
        const x = point.x * scale;
        const y = point.y * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    // Crêtes en blanc, plus fines ; horizon en trait sombre — comme à l'écran.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(1, 1.2 * scale);
    for (const line of ridgeScreen) trace(line);
    ctx.strokeStyle = '#111418';
    ctx.lineWidth = Math.max(1.5, 1.8 * scale);
    trace(horizonScreen);
    ctx.restore();
  }

  /** Étiquettes de sommets comme à l'écran : point, trait de rappel, capsule couchée. */
  function drawLabels(ctx: CanvasRenderingContext2D, scale: number): void {
    const font = Math.max(10, Math.round(16 * scale));
    const thickness = LABEL_THICKNESS * scale;
    const angle = (-LABEL_ANGLE_DEG * Math.PI) / 180;
    ctx.save();
    ctx.font = `500 ${font}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const label of labels) {
      const x = label.x * scale;
      const y = label.y * scale;
      // Même surélévation qu'à l'écran : le trait s'allonge, la capsule monte.
      const leader = (LABEL_LEADER_MIN + label.lift) * scale;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - leader);
      ctx.stroke();
      ctx.fillStyle = '#2eb8b3';
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * scale, 0, Math.PI * 2);
      ctx.fill();

      const elevation = `${Math.round(label.elevation).toLocaleString('fr-FR')} m`;
      const nameWidth = ctx.measureText(label.name).width;
      const eleWidth = ctx.measureText(elevation).width;
      const pad = 11 * scale;
      const nameSegment = nameWidth + pad * 2;
      const length = Math.max(
        nameSegment + eleWidth + pad * 2,
        estimateLabelLength(label.name, label.elevation) * scale,
      );
      ctx.save();
      ctx.translate(x, y - leader);
      ctx.rotate(angle);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(0, -thickness / 2, length, thickness, thickness / 2);
      ctx.fill();
      ctx.fillStyle = '#2eb8b3';
      ctx.beginPath();
      ctx.roundRect(nameSegment, -thickness / 2, length - nameSegment, thickness, [
        0,
        thickness / 2,
        thickness / 2,
        0,
      ]);
      ctx.fill();
      ctx.fillStyle = '#17202a';
      ctx.fillText(label.name, pad, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(elevation, nameSegment + pad, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Grave l'état de visée dans un bandeau ajouté SOUS la photo : la capture se
   * lit seule sans masquer un seul pixel de ce que voyait la caméra.
   */
  function drawCaption(
    ctx: CanvasRenderingContext2D,
    lines: string[],
    width: number,
    top: number,
    band: CaptionLayout,
  ): void {
    ctx.save();
    ctx.fillStyle = '#111';
    ctx.fillRect(0, top, width, band.height);
    ctx.fillStyle = '#fff';
    ctx.font = `${band.font}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(
        line,
        band.padding,
        top + band.padding + i * band.lineHeight,
        width - band.padding * 2,
      );
    });
    ctx.restore();
  }

  /**
   * Construit la capture : la découpe RÉELLEMENT visible du flux (`cover` +
   * zoom, comme le calibrage), surmontée de l'horizon calculé, des étiquettes
   * et de l'état de visée. C'est le seul accès de Claude à la caméra — une
   * image que l'utilisateur joint lui-même à la conversation.
   */
  async function buildSnapshot(): Promise<DebugSnapshot> {
    if (!video || !container || video.videoWidth === 0) throw new Error('caméra inactive');
    const viewW = container.clientWidth;
    const viewH = container.clientHeight;
    const crop = coverCrop(video.videoWidth, video.videoHeight, viewW, viewH, zoom);
    // Taille tirée de la DÉCOUPE SOURCE, pas des points CSS de la vue : cadrer
    // sur 390 px de large jetterait la moitié du détail que la caméra fournit
    // — précisément celui du relief lointain qu'on cherche à juger.
    const size = fitSnapshot(crop.sw, crop.sh);
    const aimInfo: SnapshotAim = {
      time: new Date(),
      viewpoint: { lat: viewpoint.lat, lon: viewpoint.lon },
      viewpointSource,
      eyeElevationM: eyeElevation,
      gpsGapM: lastFixPosition
        ? haversineDistance(lastFixPosition, { lat: viewpoint.lat, lon: viewpoint.lon })
        : null,
      headingDeg: normalizeBearing(aim.heading + headingOffset),
      pitchDeg: aim.pitch + pitchOffset,
      headingOffsetDeg: headingOffset,
      pitchOffsetDeg: pitchOffset,
      screenFovDeg: currentScreenFov(),
      shortFovDeg: shortFov(),
      fovCalibrated: storedFovUsable(),
      zoom,
      stream: { w: video.videoWidth, h: video.videoHeight },
      calibration: lastCalibration,
      sensors: !sensorless && gotSensor,
      horizon: horizonScreen.length > 1,
      peaksStatus,
      peaksLoaded: peaks.length,
      peaksVisible: candidates.length,
      labels: labels.length,
    };

    const caption = snapshotCaption(aimInfo);
    const band = captionLayout(size.width, caption.length);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height + band.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas indisponible');
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);

    // Les repères vivent dans le repère de la VUE : une seule mise à l'échelle.
    const scale = size.width / Math.max(1, viewW);
    drawHorizon(ctx, scale);
    drawLabels(ctx, scale);
    drawCaption(ctx, caption, size.width, size.height, band);

    const blob = await canvasToBlob(canvas);
    const name = snapshotFileName(new Date());
    const meta = {
      fichier: name,
      cap: Math.round(aimInfo.headingDeg),
      assiette: Number(aimInfo.pitchDeg.toFixed(1)),
      recalages: {
        cap: Number(headingOffset.toFixed(1)),
        assiette: Number(pitchOffset.toFixed(1)),
      },
      fovEcran: Number(aimInfo.screenFovDeg.toFixed(1)),
      fovPetitCote: aimInfo.shortFovDeg,
      fovEtalonne: aimInfo.fovCalibrated,
      zoom: Number(zoom.toFixed(2)),
      capteurs: aimInfo.sensors,
      horizonTrace: aimInfo.horizon,
      cretesTracees: ridgeScreen.length,
      statutSommets: peaksStatus,
      sommets: peaks.length,
      visibles: candidates.length,
      etiquettes: labels.length,
      oeil: Math.round(eyeElevation),
      image: { w: canvas.width, h: canvas.height, photo: size },
      vue: { w: viewW, h: viewH },
      video: { w: video.videoWidth, h: video.videoHeight },
      recadrage: {
        sx: Math.round(crop.sx),
        sy: Math.round(crop.sy),
        sw: Math.round(crop.sw),
        sh: Math.round(crop.sh),
      },
      pointDeVue: { lat: viewpoint.lat, lon: viewpoint.lon, source: viewpointSource },
      ecartGpsM: aimInfo.gpsGapM === null ? null : Math.round(aimInfo.gpsGapM),
      octets: blob.size,
    };
    lastCapture = meta;
    logDebug('viser:capture', meta);
    return { blob, name, width: canvas.width, height: canvas.height, meta };
  }

  // Glissé un doigt : recalage de la boussole, ou visée complète sans capteurs.
  // Pincement deux doigts : zoom numérique. Molette : idem au bureau.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  /** Vrai dès que le doigt a bougé : un relâché immobile est un toucher. */
  let moved = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { distance: number; zoom: number } | null = null;

  function pinchDistance(): number {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return 1;
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  function setZoom(next: number): void {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    // Accroche à ×1 : un pincement relâché près du minimum retrouve l'optique nue.
    zoom = clamped < 1.02 ? 1 : clamped;
    relayout();
  }

  function onDown(e: PointerEvent): void {
    // La capture du pointeur retargetterait le click : ne pas voler les
    // boutons ni la fiche (qui gère son propre glissé de fermeture).
    if ((e.target as HTMLElement | null)?.closest('button, a, .card')) return;
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      // Pointeur déjà relâché : le suivi ci-dessous fonctionne sans capture.
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      dragging = false;
      moved = true;
      pinchStart = { distance: pinchDistance(), zoom };
    } else if (pointers.size === 1) {
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  }
  function onMove(e: PointerEvent): void {
    if (phase !== 'running' || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchStart && pointers.size === 2) {
      setZoom(pinchStart.zoom * (pinchDistance() / pinchStart.distance));
      return;
    }
    if (!dragging) return;
    const degPerPx = currentScreenFov() / Math.max(1, container.clientHeight);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (!moved && Math.hypot(dx, dy) < 4) return; // tremblement d'un toucher
    moved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (sensorless) {
      aim = {
        heading: normalizeBearing(aim.heading - dx * degPerPx),
        pitch: Math.max(-40, Math.min(60, aim.pitch + dy * degPerPx)),
      };
    } else {
      // Recalage bi-axe : ↔ corrige la boussole, ↕ corrige le biais d'assiette
      // (les capteurs de gravité dérivent aussi de plusieurs degrés).
      headingOffset = signedDeltaDeg(headingOffset - dx * degPerPx);
      pitchOffset = Math.max(-20, Math.min(20, pitchOffset + dy * degPerPx));
    }
    relayout();
  }
  function onUp(e: PointerEvent): void {
    const tracked = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (tracked && !moved && pointers.size === 0 && phase === 'running') onTap();
    const rest = [...pointers.values()][0];
    if (pointers.size === 1 && rest) {
      // Le doigt restant du pincement reprend le glissé sans à-coup.
      dragging = true;
      lastX = rest.x;
      lastY = rest.y;
    } else if (pointers.size === 0) {
      dragging = false;
    }
  }

  onMount(() => {
    // Molette (bureau) : zoom continu ; non passif pour bloquer le zoom de la
    // page sur les trackpads (pincement → wheel + ctrlKey).
    const onWheel = (e: WheelEvent) => {
      if (phase !== 'running') return;
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.001));
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    const unregister = registerDebugProvider('viser', () => ({
      phase,
      sansCapteurs: sensorless,
      capteursRecus: gotSensor,
      suiviFige: locked,
      selection: selected?.name ?? null,
      suiviPosition: following,
      dernierReleve: lastFix,
      derniereOrientation: lastRawOrientation,
      visee: { cap: Math.round(aim.heading), assiette: Number(aim.pitch.toFixed(1)) },
      recalages: {
        cap: Number(headingOffset.toFixed(1)),
        assiette: Number(pitchOffset.toFixed(1)),
      },
      filtreBoussole: {
        decalage:
          aimFilter.compassOffsetDeg === null
            ? null
            : Number(aimFilter.compassOffsetDeg.toFixed(1)),
        poids: Number(aimFilter.compassWeight.toFixed(2)),
      },
      fovEcran: Number(currentScreenFov().toFixed(1)),
      fovPetitCote: shortFov(),
      etalonnageUtilisable: storedFovUsable(),
      zoom: Number(zoom.toFixed(2)),
      video: video ? { w: video.videoWidth, h: video.videoHeight } : null,
      conteneur: container ? { w: container.clientWidth, h: container.clientHeight } : null,
      statutSommets: peaksStatus,
      sommets: peaks.length,
      visibles: candidates.length,
      // Cap et élévation des sommets en vue : sans ça, « 0 étiquette dans le
      // champ » ne dit pas s'ils sont ailleurs sur le tour d'horizon ou si la
      // projection les perd (rapport terrain n° 5).
      visiblesDetail: candidates.slice(0, 20).map((c) => ({
        nom: c.name,
        cap: Math.round(c.azimuthDeg),
        elev: Number(radToDeg(c.elevAngleRad).toFixed(1)),
        km: Number((c.distanceM / 1000).toFixed(1)),
      })),
      horizonCalcule: demSkyline !== null,
      oeil: Math.round(eyeElevation),
      dernierRecalage: lastCalibration,
      derniereCapture: lastCapture,
    }));
    return () => {
      unregister();
      clearTimeout(calibTimer);
      clearTimeout(hintTimer);
      clearTimeout(positionTimer);
      clearTimeout(retryTimer);
      container.removeEventListener('wheel', onWheel);
      stream?.getTracks().forEach((track) => track.stop());
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener);
      window.removeEventListener('deviceorientation', onOrientation as EventListener);
      worker?.terminate();
    };
  });

  // La vue caméra n'est capturable que pendant la visée : les réglages ⚙
  // n'offrent le bouton de capture que tant que cette source est enregistrée.
  $effect(() => {
    if (phase !== 'running') return;
    return registerSnapshotSource(() => buildSnapshot());
  });

  // Téléportation ou pas suivi en cours de visée : recharge les données du
  // nouveau point (sans effacer les repères quand c'est le suivi qui bouge).
  $effect(() => {
    void viewpoint.lat;
    void viewpoint.lon;
    const silent = silentReload;
    silentReload = false;
    if (phase === 'running') void loadData(silent);
  });

  // Un lieu choisi PENDANT la visée (recherche, carte, sommet) prime sur le
  // GPS : le suivi s'arrête, sans quoi il ramènerait aussitôt le point de vue
  // ici. L'origine du point de vue À L'ENTRÉE ne compte pas : la caméra
  // filme d'où l'on est.
  let sourceSeen = false;
  $effect(() => {
    void viewpointSource;
    if (!sourceSeen) {
      sourceSeen = true;
      return;
    }
    if (viewpointSource !== 'gps') following = false;
  });

  // Suivi GPS : une surveillance tant que la visée tourne et que le suivi est actif.
  $effect(() => {
    if (phase !== 'running' || !following) return;
    if (!navigator.geolocation) {
      following = false;
      showPositionMessage(fr.viser.positionError);
      return;
    }
    const id = navigator.geolocation.watchPosition(onFix, onFixError, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 30_000,
    });
    return () => navigator.geolocation.clearWatch(id);
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
  <video bind:this={video} playsinline muted style:transform="scale({zoom})"></video>

  {#if phase === 'running' && zoom > 1}
    <div class="zoom-badge pill" aria-hidden="true">{zoom.toFixed(1).replace('.', ',')}×</div>
  {/if}

  {#if horizonPoints && phase === 'running'}
    <svg
      class="horizon"
      viewBox={`0 0 ${viewSize.w} ${viewSize.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {#each ridgeLines as points}
        <polyline class="ridge" {points} />
      {/each}
      <polyline points={horizonPoints} />
    </svg>
  {/if}

  <PeakLabels
    {labels}
    {dots}
    selectedId={selected?.id ?? null}
    favoriteIds={favorites.ids}
    onselect={select}
  />

  {#if phase === 'running'}
    {#if compass}
      <CompassRibbon bands={compass} />
    {/if}

    {#if locked}
      <button class="unlock" onclick={unlock}>{fr.viser.unlockTracking}</button>
    {/if}

    {#if demSkyline && !sensorless}
      <!-- Sous la colonne de boutons ronds du chrome (menu, recherche, 3D). -->
      <button
        class="btn-round calibrate"
        onclick={autoCalibrate}
        disabled={calibrating}
        aria-label={fr.viser.calibrateAuto}
        title={fr.viser.calibrateAuto}
      >
        <!-- Étincelle « auto » : distincte de la crête du bouton Panorama. -->
        <svg viewBox="0 0 24 24" aria-hidden="true" class="sparkle">
          <path d="M11 3.5l1.9 5.4 5.4 1.9-5.4 1.9L11 18.1l-1.9-5.4-5.4-1.9 5.4-1.9z" />
          <path d="M18.5 14.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
        </svg>
      </button>
    {/if}
    {#if calibMessage}
      <p class="calib-message pill" role="status">{calibMessage}</p>
    {/if}

    <button
      class="btn-round follow"
      class:active={following}
      aria-pressed={following}
      aria-label={following ? fr.viser.followPositionOn : fr.viser.followPosition}
      title={following ? fr.viser.followPositionOn : fr.viser.followPosition}
      onclick={() => (following = !following)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="6.5" />
        <circle cx="12" cy="12" r="1.6" />
        <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
      </svg>
    </button>
    {#if positionMessage}
      <p class="position-message pill" role="status">{positionMessage}</p>
    {/if}

    {#if hintVisible && !selected}
      <p class="hint">{sensorless ? fr.viser.dragHint : fr.viser.calibrateHint}</p>
    {/if}

    {#if peaksStatus !== 'ok' && peaksStatus !== 'idle'}
      <div class="peaks-status pill" role="status">
        {#if peaksStatus === 'searching'}
          {fr.peaks.searching}
        {:else if peaksStatus === 'error'}
          {fr.viser.dataError}
          <button onclick={() => void loadData()}>{fr.peaks.retry}</button>
        {:else if peaksStatus === 'empty'}
          {fr.peaks.none}
        {:else}
          {fr.peaks.noneVisible}
        {/if}
      </div>
    {/if}

    {#if selected}
      <PeakCard peak={selected} onclose={unlock} {onteleport} {onmap} />
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
    /* Le zoom numérique agrandit la découpe `cover` autour de son centre —
       même convention que coverCrop(zoom) côté projections et calibrage. */
    transform-origin: center;
  }

  .zoom-badge {
    position: absolute;
    top: 50%;
    right: var(--chrome-right);
    transform: translateY(-50%);
    padding: 0.25rem 0.7rem;
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
    pointer-events: none;
  }

  .horizon {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* Horizon calculé : trait fin sombre sur la ligne de crête (façon PeakVisor). */
  .horizon polyline {
    fill: none;
    stroke: #111418;
    stroke-width: 1.5;
    stroke-linejoin: round;
    opacity: 0.9;
  }

  /* Crêtes intermédiaires : traits blancs, plus fins. */
  .horizon .ridge {
    stroke: #fff;
    stroke-width: 1.2;
    opacity: 0.9;
  }

  /* Suivi figé : pilule rouge entre les boutons ronds de la rangée du haut. */
  .unlock {
    position: absolute;
    top: var(--chrome-top);
    left: 50%;
    z-index: 5;
    max-width: calc(100% - 2 * (var(--chrome-left) + var(--round) + 0.6rem));
    height: var(--round);
    padding: 0 1.4rem;
    transform: translateX(-50%);
    border: none;
    border-radius: 999px;
    background: var(--danger);
    color: #fff;
    font: inherit;
    font-size: 1.05rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: var(--shadow);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .unlock:hover {
    background: color-mix(in srgb, var(--danger) 85%, #000);
  }

  .calibrate {
    position: absolute;
    top: calc(var(--chrome-top) + 3 * (var(--round) + var(--chrome-gap)));
    left: var(--chrome-left);
    z-index: 5;
  }

  .calibrate .sparkle {
    fill: currentColor;
    stroke-width: 1;
  }

  .follow {
    position: absolute;
    top: calc(var(--chrome-top) + 4 * (var(--round) + var(--chrome-gap)));
    left: var(--chrome-left);
    z-index: 5;
  }

  .position-message {
    position: absolute;
    bottom: calc(7.2rem + var(--safe-bottom));
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    font-size: 0.85rem;
    pointer-events: none;
  }

  .calib-message {
    position: absolute;
    bottom: calc(4.6rem + var(--safe-bottom));
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    font-size: 0.85rem;
    pointer-events: none;
  }

  .hint {
    position: absolute;
    bottom: calc(1.4rem + var(--safe-bottom));
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 2rem);
    margin: 0;
    padding: 0.3rem 0.9rem;
    border-radius: 999px;
    background: rgb(255 255 255 / 82%);
    color: var(--muted);
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  .peaks-status {
    position: absolute;
    /* Sous les deux rubans de boussole et leur cap chiffré. */
    top: calc(var(--chrome-top) + var(--round) + var(--chrome-gap) + 6rem);
    left: 50%;
    transform: translateX(-50%);
    color: var(--muted);
    font-size: 0.82rem;
  }

  .peaks-status button {
    padding: 0.2rem 0.75rem;
    border: none;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--accent-ink);
    font: inherit;
    font-size: 0.8rem;
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
    background: color-mix(in srgb, var(--bg) 92%, transparent);
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
    color: var(--danger);
    font-size: 0.88rem;
  }

  .start {
    padding: 0.7rem 1.5rem;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 1rem;
    cursor: pointer;
    box-shadow: var(--shadow);
  }

  .start:hover:enabled {
    background: var(--accent-ink);
  }

  .start:disabled {
    opacity: 0.7;
    cursor: wait;
  }
</style>
