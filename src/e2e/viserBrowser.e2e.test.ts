import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * CAPTURES D'ÉCRAN que l'horizon rouge épouse l'horizon visible de la vidéo,
 * que l'étiquette du sommet s'ancre sur la crête, puis qu'un biais capteurs
 * injecté est rattrapé par « Recaler sur l'horizon ».
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
    const context = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H } });

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

  it('l’horizon rouge épouse l’horizon visible, l’étiquette s’ancre sur la crête', async () => {
    await page.goto(
      `${BASE}?lat=${WORLD_VIEWPOINT.lat.toFixed(5)}&lon=${WORLD_VIEWPOINT.lon.toFixed(5)}&mode=viser`,
    );
    await page.getByRole('button', { name: 'Activer caméra et capteurs' }).click();
    await page.waitForSelector('.horizon polyline', { timeout: 90_000 });
    await page.waitForSelector('button.label', { timeout: 30_000 });
    await page.waitForTimeout(1_000); // lissage capteurs + première image caméra

    const shot = decodePng(await page.screenshot());
    const label = await labelAnchor();
    const gaps = alignmentGaps(shot, [label.x]);
    if (process.env.CIMES_E2E_DEBUG) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${process.env.CIMES_E2E_DEBUG}/s1.png`, await page.screenshot());
      writeFileSync(
        `${process.env.CIMES_E2E_DEBUG}/s1.json`,
        JSON.stringify({ label, gaps, boundaryAtLabel: columnBoundary(shot, Math.round(label.x)) }),
      );
    }

    expect(gaps.usable).toBeGreaterThan(120);
    expect(gaps.median).toBeLessThanOrEqual(3.5);
    expect(gaps.p90).toBeLessThanOrEqual(6);

    // L'ancre de l'étiquette (pointe du sommet) est posée sur l'horizon visible.
    const boundary = columnBoundary(shot, Math.round(label.x));
    expect(boundary).not.toBeNull();
    expect(Math.abs(label.y - boundary!)).toBeLessThanOrEqual(7);
    expect(label.name).toBe(WORLD_PEAK.name);
  }, 180_000);

  it('un biais capteurs (+6° cap, −3° assiette) est rattrapé par le recalage', async () => {
    // Les capteurs se mettent à mentir : l'horizon rouge doit décrocher…
    await page.evaluate(() => {
      const e2e = (
        window as unknown as { __cimesE2E: { sensor: { heading: number; pitch: number } } }
      ).__cimesE2E;
      e2e.sensor = { heading: 96, pitch: -3 };
    });
    await page.waitForTimeout(1_200);
    const before = alignmentGaps(decodePng(await page.screenshot()), [(await labelAnchor()).x]);
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
    const after = alignmentGaps(decodePng(await page.screenshot()), [(await labelAnchor()).x]);
    expect(after.usable).toBeGreaterThan(120);
    expect(after.median).toBeLessThanOrEqual(4.5);
  }, 120_000);

  /** Ancre de l'étiquette de sommet en coordonnées de FENÊTRE (celles des
   *  captures) : pied du trait de rappel, soit bas de la boîte + 14 px — les
   *  `style.left/top` de l'app sont dans le repère du conteneur Viser, décalé
   *  de la hauteur de l'en-tête. */
  async function labelAnchor(): Promise<{ x: number; y: number; name: string }> {
    return page.$eval('button.label', (el) => {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.bottom + 14,
        name: (el.querySelector('.name') as HTMLElement).textContent ?? '',
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

function classify(rgba: Uint8ClampedArray, width: number, x: number, y: number) {
  const o = (y * width + x) * 4;
  const r = rgba[o]!;
  const g = rgba[o + 1]!;
  const b = rgba[o + 2]!;
  return {
    red: r > 170 && g < 110 && b < 110,
    // Terrain : sombre ET sans dominante bleue (l'ombre portée de la ligne
    // assombrit le ciel mais lui laisse son bleu).
    ground: r < 115 && g < 115 && b < 115 && b < r + 25,
  };
}

/** Première ligne « terrain » de la colonne (frontière ciel→terrain vidéo). */
function columnBoundary(shot: ReturnType<typeof decodePng>, x: number): number | null {
  for (let y = 130; y < shot.height - 140; y++) {
    const c = classify(shot.rgba, shot.width, x, y);
    if (!c.ground) continue;
    // Trois lignes de terrain d'affilée : évite les faux positifs isolés.
    const c1 = classify(shot.rgba, shot.width, x, y + 1);
    const c2 = classify(shot.rgba, shot.width, x, y + 2);
    if (c1.ground && c2.ground) return y;
  }
  return null;
}

/** Ligne rouge de la colonne (centre des pixels rouges), ou null. */
function columnLine(shot: ReturnType<typeof decodePng>, x: number): number | null {
  let sum = 0;
  let count = 0;
  for (let y = 130; y < shot.height - 140; y++) {
    if (classify(shot.rgba, shot.width, x, y).red) {
      sum += y;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Écarts |ligne rouge − frontière vidéo| par colonne, hors zones d'étiquette. */
function alignmentGaps(shot: ReturnType<typeof decodePng>, excludeX: number[]): Gaps {
  const gaps: number[] = [];
  for (let x = 24; x < shot.width - 24; x++) {
    if (excludeX.some((ex) => Math.abs(x - ex) < 85)) continue;
    const boundary = columnBoundary(shot, x);
    const line = columnLine(shot, x);
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
  const state = { sensor: { ...truth }, truth: { ...truth } };
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

  // Capteurs : flux « deviceorientationabsolute » Android-like. Téléphone
  // portrait face à la scène : α = −cap, β = 90° + assiette, γ = 0.
  setInterval(() => {
    const alpha = ((-state.sensor.heading % 360) + 360) % 360;
    const event = new DeviceOrientationEvent('deviceorientationabsolute', {
      alpha,
      beta: 90 + state.sensor.pitch,
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
