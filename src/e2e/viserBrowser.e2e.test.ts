import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captionLayout } from '../lib/debug/snapshot';
import { decodePng } from './png';
import {
  referenceSkyline,
  WORLD_PEAK,
  worldOverpassJson,
  worldTilePng,
  WORLD_VIEWPOINT,
} from './world';

/**
 * Bout en bout « navigateur » (opt-in : CIMES_E2E=1) : le build de production
 * tourne dans Chromium (Playwright) avec tuiles d'altitude et Overpass simulés
 * depuis le monde synthétique, une caméra factice qui filme la silhouette de
 * référence exacte, et des capteurs d'orientation synthétiques. On mesure sur
 * CAPTURES D'ÉCRAN que la ligne d'horizon calculée (trait sombre) épouse
 * l'horizon visible de la vidéo, que l'étiquette du sommet s'ancre sur la
 * crête, puis qu'un biais capteurs injecté est rattrapé par « Recaler sur
 * l'horizon ».
 */

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}/peak/`;
const VIEW_W = 390;
const VIEW_H = 844;

/** Pose vraie de la caméra factice ; les capteurs peuvent mentir (scénario 2). */
const TRUTH = { heading: 90, pitch: 0 };
const CAMERA = { w: 960, h: 1280, shortFovDeg: 55 };

describe.skipIf(!process.env.CIMES_E2E)('bout en bout : Viser dans Chromium', () => {
  let preview: ChildProcess | undefined;
  let browser: import('playwright').Browser | undefined;
  let context: import('playwright').BrowserContext;
  let page: import('playwright').Page;

  beforeAll(async () => {
    const vite = join(process.cwd(), 'node_modules', '.bin', 'vite');
    const build = spawnSync(vite, ['build'], { cwd: process.cwd(), timeout: 240_000 });
    if (build.status !== 0) {
      throw new Error(`vite build a échoué :\n${build.stderr?.toString().slice(-2000)}`);
    }

    preview = spawn(vite, ['preview', '--port', String(PORT), '--strictPort'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    await waitForServer(BASE, 30_000);

    const { chromium } = await import('playwright');
    // Révision Playwright si provisionnée, sinon le Chromium de l'environnement
    // (lien `chromium` du dossier des navigateurs, ou CIMES_E2E_CHROMIUM).
    try {
      browser = await chromium.launch();
    } catch (error) {
      const executablePath = process.env.CIMES_E2E_CHROMIUM ?? findChromium();
      if (!executablePath) throw error;
      browser = await chromium.launch({ executablePath });
    }
    context = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H } });

    // Les routes Playwright se résolvent de la dernière à la première : le
    // filet « tout interdire » s'enregistre AVANT les routes spécifiques.
    // Toute requête hors préview/tuiles/Overpass est interdite : test hermétique.
    await context.route('**', (route) => {
      const url = route.request().url();
      if (url.startsWith(BASE) || url.startsWith('data:')) return route.fallback();
      return route.abort();
    });
    // Tuiles d'altitude : générées du monde synthétique, jamais le réseau.
    await context.route('**/elevation-tiles-prod/terrarium/**', (route) => {
      const m = route
        .request()
        .url()
        .match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
      if (!m) return route.abort();
      const png = worldTilePng(Number(m[1]), Number(m[2]), Number(m[3]));
      return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    });
    // Overpass : un seul sommet, posé sur la crête du cap 95°.
    await context.route('**/api/interpreter', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: worldOverpassJson() }),
    );

    // Référence exacte (grand cercle, rayon effectif) injectée dans la page.
    const ref = referenceSkyline(58, 122, 0.05);
    await context.addInitScript(initFakeSensors, { ref, truth: TRUTH, camera: CAMERA });

    page = await context.newPage();
    page.on('pageerror', (error) => console.error('[page]', error.message));
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    preview?.kill();
  });

  it('l’horizon tracé épouse l’horizon visible, l’étiquette s’ancre sur la crête', async () => {
    await page.goto(
      `${BASE}?lat=${WORLD_VIEWPOINT.lat.toFixed(5)}&lon=${WORLD_VIEWPOINT.lon.toFixed(5)}&mode=viser`,
    );
    await page.getByRole('button', { name: 'Activer caméra et capteurs' }).click();
    await page.waitForSelector('.horizon polyline', { timeout: 90_000 });
    await page.waitForSelector('button.label', { timeout: 30_000 });
    await page.waitForTimeout(1_000); // lissage capteurs + première image caméra

    const shot = decodePng(await page.screenshot());
    const label = await labelAnchor();
    const gaps = alignmentGaps(shot, exclusions(label));
    if (process.env.CIMES_E2E_DEBUG) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${process.env.CIMES_E2E_DEBUG}/s1.png`, await page.screenshot());
      writeFileSync(
        `${process.env.CIMES_E2E_DEBUG}/s1.json`,
        JSON.stringify({ label, gaps, boundaryAtLabel: columnBoundary(shot, Math.round(label.x)) }),
      );
    }

    // Boussole : sans recalage, un seul ruban et un seul cap annoncé.
    expect(await page.locator('.band.raw .tick').count()).toBe(0);
    const readout = (await page.locator('.readout').textContent()) ?? '';
    expect(readout).toContain('90° · E');
    expect(readout).not.toContain('brut');

    // La capsule couchée occupe ~150 des 390 colonnes : il en reste une centaine.
    expect(gaps.usable).toBeGreaterThan(80);
    expect(gaps.median).toBeLessThanOrEqual(3.5);
    expect(gaps.p90).toBeLessThanOrEqual(6);

    // L'ancre de l'étiquette (pointe du sommet) est posée sur l'horizon visible.
    const boundary = columnBoundary(shot, Math.round(label.x));
    expect(boundary).not.toBeNull();
    expect(Math.abs(label.y - boundary!)).toBeLessThanOrEqual(7);
    expect(label.name).toBe(WORLD_PEAK.name);
  }, 180_000);

  it('un biais capteurs (+6° cap, −3° assiette) est rattrapé par le recalage', async () => {
    // Les capteurs se mettent à mentir : l'horizon tracé doit décrocher…
    await page.evaluate(() => {
      const e2e = (
        window as unknown as { __cimesE2E: { sensor: { heading: number; pitch: number } } }
      ).__cimesE2E;
      e2e.sensor = { heading: 96, pitch: -3 };
    });
    await page.waitForTimeout(1_200);
    const before = alignmentGaps(
      decodePng(await page.screenshot()),
      exclusions(await labelAnchor()),
    );
    expect(before.median).toBeGreaterThan(10);

    // …puis le bouton « Recaler sur l'horizon » rattrape le biais.
    await page.getByRole('button', { name: 'Recaler sur l’horizon' }).click();
    const message = await page.waitForSelector('.calib-message', { timeout: 20_000 });
    const text = (await message.textContent()) ?? '';
    expect(text).toContain('Horizon calé');
    const announced = Number(/\((-?\d+)°/.exec(text)?.[1]);
    expect(announced).toBeGreaterThanOrEqual(-7);
    expect(announced).toBeLessThanOrEqual(-5);

    await page.waitForTimeout(600);
    if (process.env.CIMES_E2E_DEBUG) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${process.env.CIMES_E2E_DEBUG}/s2.png`, await page.screenshot());
    }
    // Boussole : le second ruban montre le cap brut (96°) sous le cap recalé
    // (90°), et le chiffre du recalage est annoncé sous les deux.
    expect(await page.locator('.band.raw .tick').count()).toBeGreaterThan(0);
    const readoutAfter = (await page.locator('.readout').textContent()) ?? '';
    expect(readoutAfter).toContain('90° · E');
    expect(readoutAfter).toContain('brut 96°');
    expect(readoutAfter).toContain('−6,0°');

    const after = alignmentGaps(
      decodePng(await page.screenshot()),
      exclusions(await labelAnchor()),
    );
    expect(after.usable).toBeGreaterThan(80);
    expect(after.median).toBeLessThanOrEqual(4.5);
  }, 120_000);

  it('la capture de débogage montre la vidéo ET les repères, en registre', async () => {
    // Pas de partage natif dans Chromium headless : on intercepte le repli
    // téléchargement pour récupérer le blob produit, sans quitter la page.
    await page.evaluate(() => {
      const w = window as unknown as { __capture?: Blob | null };
      w.__capture = null;
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (object: Blob | MediaSource): string => {
        if (object instanceof Blob) w.__capture = object;
        return original(object);
      };
      HTMLAnchorElement.prototype.click = function noDownload(): void {};
    });

    // La capture se lance depuis le tiroir de menu ≡ (réglages → débogage).
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Capturer la vue caméra' }).click();
    const note = await page.waitForSelector('.capture-message', { timeout: 20_000 });
    expect((await note.textContent()) ?? '').toContain('joignez');

    // Le blob est ré-encodé en PNG dans la page : le décodeur Node et l'analyse
    // d'alignement des scénarios précédents s'y appliquent tels quels.
    const encoded = await page.evaluate(async () => {
      const blob = (window as unknown as { __capture: Blob | null }).__capture;
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      return { type: blob.type, bytes: blob.size, png: canvas.toDataURL('image/png') };
    });
    expect(encoded).not.toBeNull();
    expect(encoded!.type).toBe('image/jpeg');
    expect(encoded!.bytes).toBeGreaterThan(5_000);

    const png = Buffer.from(encoded!.png.split(',')[1]!, 'base64');
    if (process.env.CIMES_E2E_DEBUG) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${process.env.CIMES_E2E_DEBUG}/capture.png`, png);
    }
    const shot = decodePng(png);
    const viser = await page.$eval('.viser', (el) => {
      const rect = el.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), top: rect.top };
    });
    // L'image est rendue à la résolution de la DÉCOUPE SOURCE (plus fine que
    // les points CSS de la vue), légende ajoutée SOUS la photo (rien de masqué).
    const band = captionLayout(shot.width, 5).height;
    const photoH = shot.height - band;
    const scale = shot.width / viser.w;
    expect(scale).toBeGreaterThan(1.2);
    expect(photoH / shot.width).toBeCloseTo(viser.h / viser.w, 2);

    // La ligne d'horizon gravée épouse l'horizon de l'image : la mise à
    // l'échelle repère-vue → repère-image est juste (c'est tout l'enjeu de la
    // capture). L'analyse s'arrête à la photo : le bandeau sombre de légende
    // serait pris pour la ligne.
    const anchor = await labelAnchor();
    const gaps = alignmentGaps(
      shot,
      exclusions(anchor).map((r) => ({ left: r.left * scale, right: r.right * scale })),
      photoH,
    );
    expect(gaps.usable).toBeGreaterThan(150);
    // Seuil du scénario 1 (4,5 px de vue) converti en pixels d'image.
    expect(gaps.median).toBeLessThanOrEqual(4.5 * scale);

    // Bandeau de légende gravé sous la photo (fond sombre sur toute la largeur) :
    // dernière ligne, sous la dernière ligne de texte.
    const bandRow = shot.height - 3;
    let dark = 0;
    for (let x = 0; x < shot.width; x++) {
      const o = (bandRow * shot.width + x) * 4;
      if (shot.rgba[o]! < 130 && shot.rgba[o + 1]! < 130 && shot.rgba[o + 2]! < 130) dark++;
    }
    expect(dark).toBeGreaterThan(shot.width * 0.9);
  }, 120_000);

  it('boussole iOS, visée au-dessus de l’horizon : le cap n’est plus retourné', async () => {
    // Rapport terrain « la boussole était complètement fausse » : téléphone
    // dressé un peu vers le ciel (β = 98° > 90°), le haut de l'appareil bascule
    // derrière — son azimut se retourne de 180°. Pris au pied de la lettre, le
    // nord se gravait à l'envers pour toute la séance.
    const ios = await context.newPage();
    ios.on('pageerror', (error) => console.error('[page iOS]', error.message));
    await ios.addInitScript(() => {
      const e2e = (
        window as unknown as {
          __cimesE2E: { sensor: { pitch: number }; mode: string };
        }
      ).__cimesE2E;
      e2e.mode = 'ios';
      e2e.sensor.pitch = 8;
    });
    try {
      await ios.goto(
        `${BASE}?lat=${WORLD_VIEWPOINT.lat.toFixed(5)}&lon=${WORLD_VIEWPOINT.lon.toFixed(5)}&mode=viser`,
      );
      await ios.getByRole('button', { name: 'Activer caméra et capteurs' }).click();
      await ios.waitForSelector('.readout', { timeout: 60_000 });
      await ios.waitForTimeout(2_000); // convergence du nord appris
      // Cap vrai 90° (est) : l'ancienne lecture retournée donnait 270° (ouest).
      expect((await ios.locator('.readout').textContent()) ?? '').toContain('90° · E');
      // Le nord vient de la boussole : pas d'avis « ce navigateur ne donne pas
      // le nord » (réservé aux flux sans référence absolue).
      expect(await ios.locator('.hint.wrap').count()).toBe(0);
    } finally {
      await ios.close();
    }
  }, 120_000);

  it('orientation sans nord : l’app le dit au lieu d’afficher un cap inventé', async () => {
    // Navigateur qui n'émet ni flux absolu ni `webkitCompassHeading` : l'origine
    // du cap est arbitraire (ici 12° à côté). Le ruban ne peut pas être juste —
    // l'app doit l'annoncer, et le recalage manuel doit faire taire l'avis.
    const blind = await context.newPage();
    blind.on('pageerror', (error) => console.error('[page relatif]', error.message));
    await blind.addInitScript(() => {
      (window as unknown as { __cimesE2E: { mode: string } }).__cimesE2E.mode = 'relatif';
    });
    try {
      await blind.goto(
        `${BASE}?lat=${WORLD_VIEWPOINT.lat.toFixed(5)}&lon=${WORLD_VIEWPOINT.lon.toFixed(5)}&mode=viser`,
      );
      await blind.getByRole('button', { name: 'Activer caméra et capteurs' }).click();
      await blind.waitForSelector('.hint.wrap', { timeout: 60_000 });
      expect((await blind.locator('.hint.wrap').textContent()) ?? '').toContain(
        'ne donne pas le nord',
      );
      // Cap arbitraire : 102° au lieu de 90° — d'où l'avis.
      expect((await blind.locator('.readout').textContent()) ?? '').toContain('102°');
      if (process.env.CIMES_E2E_DEBUG) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(`${process.env.CIMES_E2E_DEBUG}/s4.png`, await blind.screenshot());
      }

      // Recalage sur l'horizon : l'avis s'efface, le cap retombe sur l'est.
      await blind.waitForSelector('button.calibrate', { timeout: 90_000 });
      await blind.getByRole('button', { name: 'Recaler sur l’horizon' }).click();
      await blind.waitForSelector('.calib-message', { timeout: 30_000 });
      await blind.waitForTimeout(600);
      expect(await blind.locator('.hint.wrap').count()).toBe(0);
      expect((await blind.locator('.readout').textContent()) ?? '').toContain('90° · E');
    } finally {
      await blind.close();
    }
  }, 120_000);

  /** Ancre de l'étiquette de sommet en coordonnées de FENÊTRE (celles des
   *  captures) : l'élément `.peak` est un point de taille nulle posé sur la
   *  pointe du sommet, au pied du trait de rappel. Le rectangle de la capsule
   *  couchée sert à exclure ses colonnes de l'analyse d'alignement. */
  async function labelAnchor(): Promise<LabelAnchor> {
    return page.$eval('.peak', (el) => {
      const rect = el.getBoundingClientRect();
      const pill = el.querySelector('button.label')!.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        name: (el.querySelector('.name') as HTMLElement).textContent ?? '',
        left: pill.left,
        right: pill.right,
      };
    });
  }
});

/* ------------------------------------------------------------------------- */
/* Analyse des captures : frontière ciel→terrain de la vidéo vs ligne rouge. */
/* ------------------------------------------------------------------------- */

interface Gaps {
  usable: number;
  median: number;
  p90: number;
}

interface LabelAnchor {
  x: number;
  y: number;
  name: string;
  /** Rectangle englobant (fenêtre) de la capsule couchée. */
  left: number;
  right: number;
}

/** Plage de colonnes à exclure de l'analyse d'alignement. */
interface ColumnRange {
  left: number;
  right: number;
}

/** Colonnes occupées par l'étiquette : capsule couchée, point et trait de rappel. */
function exclusions(label: LabelAnchor): ColumnRange[] {
  return [
    { left: label.left - 4, right: label.right + 4 },
    { left: label.x - 12, right: label.x + 12 },
  ];
}

function classify(rgba: Uint8ClampedArray, width: number, x: number, y: number) {
  const o = (y * width + x) * 4;
  const r = rgba[o]!;
  const g = rgba[o + 1]!;
  const b = rgba[o + 2]!;
  // Ligne d'horizon calculée : trait presque noir (#111418) — plus sombre que
  // le terrain synthétique (58, 52, 48) et que le texte des capsules.
  const line = r < 34 && g < 34 && b < 38;
  return {
    line,
    // Terrain : sombre ET sans dominante bleue (un pixel de ligne anticrénelé
    // sur le ciel s'assombrit mais garde son bleu).
    ground: !line && r < 115 && g < 115 && b < 115 && b < r + 25,
  };
}

/** Première ligne « terrain » de la colonne (frontière ciel→terrain vidéo). */
function columnBoundary(
  shot: ReturnType<typeof decodePng>,
  x: number,
  bottom = shot.height,
): number | null {
  for (let y = 130; y < bottom - 140; y++) {
    const c = classify(shot.rgba, shot.width, x, y);
    if (!c.ground) continue;
    // Trois lignes de terrain d'affilée : évite les faux positifs isolés.
    const c1 = classify(shot.rgba, shot.width, x, y + 1);
    const c2 = classify(shot.rgba, shot.width, x, y + 2);
    if (c1.ground && c2.ground) return y;
  }
  return null;
}

/** Ligne d'horizon de la colonne (centre des pixels de trait), ou null. */
function columnLine(
  shot: ReturnType<typeof decodePng>,
  x: number,
  bottom = shot.height,
): number | null {
  let sum = 0;
  let count = 0;
  for (let y = 130; y < bottom - 140; y++) {
    if (classify(shot.rgba, shot.width, x, y).line) {
      sum += y;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Écarts |ligne d'horizon − frontière vidéo| par colonne, hors zones d'étiquette. */
function alignmentGaps(
  shot: ReturnType<typeof decodePng>,
  excluded: ColumnRange[],
  bottom = shot.height,
): Gaps {
  const gaps: number[] = [];
  for (let x = 24; x < shot.width - 24; x++) {
    if (excluded.some((range) => x >= range.left && x <= range.right)) continue;
    const boundary = columnBoundary(shot, x, bottom);
    const line = columnLine(shot, x, bottom);
    if (boundary === null || line === null) continue;
    gaps.push(Math.abs(line - boundary));
  }
  gaps.sort((a, b) => a - b);
  return {
    usable: gaps.length,
    median: gaps[Math.floor(gaps.length / 2)] ?? Infinity,
    p90: gaps[Math.floor(gaps.length * 0.9)] ?? Infinity,
  };
}

/* ------------------------------------------------------------------------- */
/* Script d'initialisation injecté : caméra factice + capteurs synthétiques. */
/* ------------------------------------------------------------------------- */

interface InitConfig {
  ref: { startDeg: number; stepDeg: number; elevDeg: number[] };
  truth: { heading: number; pitch: number };
  camera: { w: number; h: number; shortFovDeg: number };
}

/** Tourne DANS la page, avant l'app : getUserMedia + DeviceOrientationEvent. */
function initFakeSensors({ ref, truth, camera }: InitConfig): void {
  // `mode` : flux absolu Android (défaut) ou flux relatif + boussole iOS —
  // un script d'initialisation de page peut le changer avant le démarrage.
  const state = {
    sensor: { ...truth },
    truth: { ...truth },
    mode: 'android' as 'android' | 'ios' | 'relatif',
  };
  (window as unknown as { __cimesE2E: typeof state }).__cimesE2E = state;

  const refElev = (azimuthDeg: number): number => {
    const pos = (azimuthDeg - ref.startDeg) / ref.stepDeg;
    const i = Math.max(0, Math.min(ref.elevDeg.length - 2, Math.floor(pos)));
    const t = Math.max(0, Math.min(1, pos - i));
    return ref.elevDeg[i]! * (1 - t) + ref.elevDeg[i + 1]! * t;
  };

  // Caméra factice : un canvas repeint la silhouette de référence vue de la
  // pose VRAIE (sténopé, FOV petit côté connu), diffusé en MediaStream.
  const canvas = document.createElement('canvas');
  canvas.width = camera.w;
  canvas.height = camera.h;
  const ctx = canvas.getContext('2d')!;
  const tanH = Math.tan(((camera.shortFovDeg / 2) * Math.PI) / 180);
  const tanV = (tanH * camera.h) / camera.w;

  const paint = (): void => {
    ctx.fillStyle = 'rgb(135, 180, 235)'; // ciel
    ctx.fillRect(0, 0, camera.w, camera.h);
    ctx.fillStyle = 'rgb(58, 52, 48)'; // terrain
    for (let px = 0; px < camera.w; px++) {
      const ndcX = (2 * (px + 0.5)) / camera.w - 1;
      const azRel = Math.atan(ndcX * tanH);
      const azimuth = state.truth.heading + (azRel * 180) / Math.PI;
      const elev = (refElev(azimuth) * Math.PI) / 180;
      const ndcY = Math.tan(elev) / Math.cos(azRel) / tanV;
      const top = ((1 - ndcY) * camera.h) / 2;
      ctx.fillRect(px, top, 1, camera.h - top);
    }
  };
  paint();
  setInterval(paint, 120);

  const fakeStream = canvas.captureStream(15);
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => fakeStream,
  });

  // Capteurs. Téléphone portrait face à la scène : α = −cap, β = 90° +
  // assiette, γ = 0. Trois flux possibles :
  //  • Android : « deviceorientationabsolute », α déjà rapporté au nord ;
  //  • iOS : « deviceorientation » relatif (α d'origine arbitraire) plus
  //    `webkitCompassHeading`, l'azimut du HAUT de l'appareil — lequel se
  //    retourne de 180° dès que l'on vise AU-DESSUS de l'horizon (β > 90°) ;
  //  • relatif : orientation SANS nord (ni flux absolu, ni boussole).
  setInterval(() => {
    const beta = 90 + state.sensor.pitch;
    if (state.mode === 'relatif') {
      // Origine de cap arbitraire (12°), dans la fenêtre du recaleur d'horizon.
      const alpha = (((-state.sensor.heading - 12) % 360) + 360) % 360;
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma: 0, absolute: false }),
      );
      return;
    }
    if (state.mode === 'ios') {
      // α absolu de la pose vraie ; le flux relatif d'iOS en diffère d'une
      // origine arbitraire (37°) que seule la boussole permet de rattraper.
      const alphaAbs = ((-state.sensor.heading % 360) + 360) % 360;
      const alpha = (((alphaAbs - 37) % 360) + 360) % 360;
      const flipped = Math.cos((beta * Math.PI) / 180) < 0;
      const compass = (((flipped ? 180 - alphaAbs : -alphaAbs) % 360) + 360) % 360;
      const event = new DeviceOrientationEvent('deviceorientation', {
        alpha,
        beta,
        gamma: 0,
        absolute: false,
      });
      Object.defineProperty(event, 'webkitCompassHeading', { value: compass });
      Object.defineProperty(event, 'webkitCompassAccuracy', { value: 5 });
      window.dispatchEvent(event);
      return;
    }
    const alpha = ((-state.sensor.heading % 360) + 360) % 360;
    const event = new DeviceOrientationEvent('deviceorientationabsolute', {
      alpha,
      beta,
      gamma: 0,
      absolute: true,
    });
    window.dispatchEvent(event);
  }, 60);
}

/** Chromium utilisable : celui de Playwright s'il est provisionné, sinon
 *  celui de l'environnement (lien `chromium` du dossier des navigateurs). */
function findChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return undefined;
  const link = join(root, 'chromium');
  return existsSync(link) ? link : undefined;
}

/** Attend que le serveur de prévisualisation réponde. */
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // pas encore prêt
    }
    if (Date.now() > deadline) throw new Error(`Serveur de préview muet : ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
