import { describe, expect, it } from 'vitest';
import { degToRad, radToDeg } from '../geo';
import type { ElevationSampler } from '../visibility';
import {
  computeDemSkyline,
  detectImageSkyline,
  matchSkyline,
  pixelToAngles,
  skylineScreenPoints,
  type DetectedSkyline,
} from './skyline';

describe('computeDemSkyline', () => {
  const wall: ElevationSampler = (_east, north) =>
    north >= 9_000 && north <= 11_000 && Math.abs(_east) < 3_000 ? 2000 : 0;

  it('voit la muraille au nord et la plaine au sud', () => {
    const skyline = computeDemSkyline(wall, 10, { stepDeg: 1 });
    expect(skyline).toHaveLength(360);
    expect(radToDeg(skyline[0]!)).toBeGreaterThan(10); // mur à ~12,5°
    expect(radToDeg(skyline[180]!)).toBeLessThan(0.5); // plaine sous l'œil
  });
});

describe('detectImageSkyline', () => {
  function syntheticImage(width: number, height: number, horizon: (x: number) => number) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const sky = y < horizon(x);
        rgba[o] = sky ? 150 : 70;
        rgba[o + 1] = sky ? 180 : 60;
        rgba[o + 2] = sky ? 240 : 50;
        rgba[o + 3] = 255;
      }
    }
    return rgba;
  }

  it('retrouve une ligne d’horizon sinueuse à ±1,5 px', () => {
    const w = 60;
    const h = 40;
    const horizon = (x: number) => 12 + Math.round(8 * Math.sin(x / 10));
    const detected = detectImageSkyline(syntheticImage(w, h, horizon), w, h);
    for (let x = 0; x < w; x++) {
      expect(Math.abs(detected.rows[x]! - horizon(x))).toBeLessThanOrEqual(1.5);
      expect(detected.confidence[x]!).toBeGreaterThan(0.5);
    }
  });

  it('rend une confiance basse sur une image uniforme', () => {
    const w = 30;
    const h = 20;
    const flat = new Uint8ClampedArray(w * h * 4).fill(128);
    const detected = detectImageSkyline(flat, w, h);
    for (let x = 0; x < w; x++) expect(detected.confidence[x]!).toBeLessThan(0.1);
  });
});

describe('skylineScreenPoints', () => {
  const view = { headingDeg: 0, pitchDeg: 0, fovDeg: 60, width: 1000, height: 1000 };

  it('projette un horizon plat au centre vertical, points ordonnés', () => {
    const flat = new Float32Array(720);
    const points = skylineScreenPoints(flat, 0.5, view);
    expect(points.length).toBeGreaterThan(50);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.x).toBeGreaterThan(points[i - 1]!.x);
    }
    const center = points.reduce((best, p) =>
      Math.abs(p.x - 500) < Math.abs(best.x - 500) ? p : best,
    );
    expect(Math.abs(center.y - 500)).toBeLessThan(2);
  });

  it('monte à l’écran là où le relief est haut', () => {
    const dem = new Float32Array(720);
    for (let i = 0; i < 720; i++) {
      const az = i * 0.5;
      if (az < 20 || az > 340) dem[i] = degToRad(10); // bosse autour du nord
    }
    const points = skylineScreenPoints(dem, 0.5, view);
    const center = points.reduce((best, p) =>
      Math.abs(p.x - 500) < Math.abs(best.x - 500) ? p : best,
    );
    expect(center.y).toBeLessThan(400);
  });
});

describe('matchSkyline', () => {
  // Profil théorique analytique, asymétrique pour verrouiller le cap.
  // Relief marqué (crêtes et brèches) : lève l'ambiguïté cap/assiette comme
  // le fait un vrai horizon de montagne.
  const DEM_STEP = 0.5;
  const dem = new Float32Array(720);
  for (let i = 0; i < 720; i++) {
    const az = i * DEM_STEP;
    dem[i] = degToRad(4 + 3 * Math.sin(degToRad(az)) + 2.5 * Math.sin(degToRad(4 * az + 40)));
  }
  const demDeg = (az: number) => {
    const pos = (((az % 360) + 360) % 360) / DEM_STEP;
    const i = Math.floor(pos) % 720;
    const t = pos - Math.floor(pos);
    return radToDeg(dem[i]! * (1 - t) + dem[(i + 1) % 720]! * t);
  };

  /** Horizon « photographié » depuis la vraie pose (cap 137°, assiette 3°). */
  function renderDetected(width: number, height: number, fov: number): DetectedSkyline {
    const rows = new Float32Array(width);
    const confidence = new Float32Array(width).fill(1);
    for (let x = 0; x < width; x++) {
      let bestY = 0;
      let bestErr = Infinity;
      for (let y = 0; y < height; y++) {
        const { azRelDeg, elevDeg } = pixelToAngles(x, y, width, height, 3, fov);
        const err = Math.abs(elevDeg - demDeg(137 + azRelDeg));
        if (err < bestErr) {
          bestErr = err;
          bestY = y;
        }
      }
      rows[x] = bestY;
    }
    return { rows, confidence, width, height };
  }

  it('retrouve la correction de cap et d’assiette depuis une pose fausse', () => {
    const detected = renderDetected(120, 90, 55);
    // Capteurs : cap 130° (7° trop à l'ouest), assiette 4° (1° de trop).
    const match = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
    });
    expect(match).not.toBeNull();
    expect(Math.abs(match!.headingOffsetDeg - 7)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(match!.pitchOffsetDeg - -1)).toBeLessThanOrEqual(0.75);
    expect(match!.maeDeg).toBeLessThan(0.6);
  });

  it('estime aussi le FOV réel de la caméra depuis une hypothèse fausse', () => {
    // Image « prise » avec une optique à 68° de FOV vertical…
    const detected = renderDetected(120, 90, 68);
    // …mais l'app suppose 55°. La recherche à trois dimensions doit tout retrouver.
    const match = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
      fovSearch: {},
    });
    expect(match).not.toBeNull();
    expect(Math.abs(match!.fovDeg - 68)).toBeLessThanOrEqual(2);
    expect(Math.abs(match!.headingOffsetDeg - 7)).toBeLessThanOrEqual(1);
    expect(Math.abs(match!.pitchOffsetDeg - -1)).toBeLessThanOrEqual(1);
    expect(match!.maeDeg).toBeLessThan(0.8);
  });

  it('garde le FOV courant sans estimation demandée', () => {
    const detected = renderDetected(120, 90, 55);
    const match = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
    });
    expect(match!.fovDeg).toBe(55);
  });

  it('refuse une détection trop peu confiante', () => {
    const detected = renderDetected(60, 45, 55);
    detected.confidence.fill(0);
    expect(matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem)).toBeNull();
  });
});
