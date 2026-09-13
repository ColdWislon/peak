import { describe, expect, it } from 'vitest';
import { degToRad, radToDeg } from '../geo';
import type { ElevationSampler } from '../visibility';
import {
  computeDemProfile,
  computeDemSkyline,
  detectImageSkyline,
  isMatchReliable,
  matchSkyline,
  pixelToAngles,
  ridgeScreenPolylines,
  skylineScreenPoints,
  type DetectedSkyline,
  type SkylineMatch,
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

  it('coupe la marche grâce au plafond du relief sans changer le résultat', () => {
    // Anneau de crêtes à 2000 m entre 9 et 11 km, tout autour, plaine ailleurs.
    const ring: ElevationSampler = (east, north) => {
      const r = Math.hypot(east, north);
      return r >= 9_000 && r <= 11_000 ? 2000 : 0;
    };
    let calls = 0;
    const counted: ElevationSampler = (e, n) => {
      calls++;
      return ring(e, n);
    };
    const full = computeDemSkyline(counted, 10, { stepDeg: 2 });
    const fullCalls = calls;
    calls = 0;
    const cut = computeDemSkyline(counted, 10, { stepDeg: 2, maxElevationM: 2000 });
    expect(Array.from(cut)).toEqual(Array.from(full));
    // La crête à 12,5° arrête chaque rayon dès que 2000 m ne peuvent plus la
    // dépasser (~9 km) : la marche est bien plus courte que 90 km.
    expect(calls).toBeLessThan(fullCalls * 0.5);
  });

  it("plafond sous l'œil (observateur au point culminant) : même résultat", () => {
    // Depuis 3000 m, tout le relief (≤ 2000 m) est sous l'horizontale ; la
    // borne culmine à distance finie et ne doit rien couper à tort.
    const full = computeDemSkyline(wall, 3000, { stepDeg: 5 });
    const cut = computeDemSkyline(wall, 3000, { stepDeg: 5, maxElevationM: 2000 });
    expect(Array.from(cut)).toEqual(Array.from(full));
  });

  it("résout une crête étroite proche qu'un pas fixe de 150 m rabotait", () => {
    // Arête de 40 m d'épaisseur à 2 km, 300 m au-dessus de la plaine : elle
    // domine l'horizon de ~8°. Un pas de 150 m saute par-dessus (échantillons à
    // 1950 et 2100 m) ; le pas fin du premier plan la voit.
    const ridge: ElevationSampler = (_e, north) => (north >= 2000 && north <= 2040 ? 300 : 0);
    const expected = radToDeg(Math.atan2(300 - 10, 2010));
    const fine = computeDemSkyline(ridge, 10, { stepDeg: 90 });
    const coarse = computeDemSkyline(ridge, 10, { stepDeg: 90, stepM: 150 });
    expect(Math.abs(radToDeg(fine[0]!) - expected)).toBeLessThan(0.1);
    expect(radToDeg(coarse[0]!)).toBeLessThan(expected - 5);
  });
});

describe('computeDemProfile (crêtes intermédiaires)', () => {
  // Muraille proche (500 m, à 5 km, ±10° autour du nord) devant une haute
  // muraille lointaine (3000 m, à 20 km, ±11°) : la proche est une crête
  // vue devant la lointaine, qui fait l'horizon.
  const twoWalls: ElevationSampler = (east, north) => {
    if (north >= 4_900 && north <= 5_100 && Math.abs(east) < 900) return 500;
    if (north >= 19_000 && north <= 21_000 && Math.abs(east) < 4_000) return 3000;
    return 0;
  };
  const nearWall: ElevationSampler = (east, north) =>
    north >= 4_900 && north <= 5_100 && Math.abs(east) < 900 ? 500 : 0;

  it("trace la crête proche devant l'horizon lointain, d'un seul trait à travers le nord", () => {
    const { skyline, ridges } = computeDemProfile(twoWalls, 10, { stepDeg: 1 });
    expect(radToDeg(skyline[0]!)).toBeGreaterThan(8); // la muraille lointaine
    expect(ridges).toHaveLength(1);
    const ridge = ridges[0]!;
    // Recousue à la couture 360°→0° : commence vers 350° et couvre ~21 pas.
    expect(ridge.startBin).toBeGreaterThanOrEqual(349);
    expect(ridge.startBin).toBeLessThanOrEqual(351);
    expect(ridge.angles.length).toBeGreaterThanOrEqual(19);
    expect(ridge.angles.length).toBeLessThanOrEqual(23);
    const expected = radToDeg(Math.atan2(500 - 10, 4_900));
    for (const angle of ridge.angles)
      expect(Math.abs(radToDeg(angle) - expected)).toBeLessThan(0.3);
  });

  it("l'horizon seul ne fait pas de crête", () => {
    const { ridges } = computeDemProfile(nearWall, 10, { stepDeg: 1 });
    expect(ridges).toHaveLength(0);
  });

  it("une ondulation sur un versant face à l'œil n'est pas une crête", () => {
    // Rampe montante de 1 à 8 km, creusée de 5 m sur 50 m à 4 km : le maximum
    // est repris 50 m plus loin — pas de saut de profondeur.
    const ramp: ElevationSampler = (_e, north) => {
      if (north < 1_000 || north > 8_000) return 0;
      return 0.2 * north - (north >= 4_000 && north <= 4_050 ? 5 : 0);
    };
    const { ridges } = computeDemProfile(ramp, 10, { stepDeg: 90 });
    expect(ridges).toHaveLength(0);
  });

  it("la plaine qui s'enfonce sous la courbure devant un massif lointain n'est pas une crête", () => {
    // Depuis 10 m au-dessus d'une plaine, le sol « disparaît » vers 13 km ; le
    // massif qui se lève derrière ne doit pas tracer un trait à −0,1°.
    const farOnly: ElevationSampler = (east, north) =>
      north >= 19_000 && north <= 21_000 && Math.abs(east) < 4_000 ? 3000 : 0;
    const { ridges } = computeDemProfile(farOnly, 10, { stepDeg: 1 });
    expect(ridges).toHaveLength(0);
  });

  it('ignore une crête trop courte en azimut', () => {
    const sliver: ElevationSampler = (east, north) => {
      if (north >= 4_900 && north <= 5_100 && Math.abs(east) < 60) return 500; // ~1,4°
      if (north >= 19_000 && north <= 21_000 && Math.abs(east) < 4_000) return 3000;
      return 0;
    };
    const { ridges } = computeDemProfile(sliver, 10, { stepDeg: 1 });
    expect(ridges).toHaveLength(0);
  });

  it('sépare deux crêtes étagées devant le même horizon', () => {
    const threeWalls: ElevationSampler = (east, north) => {
      if (north >= 2_900 && north <= 3_100 && Math.abs(east) < 600) return 200;
      if (north >= 4_900 && north <= 5_100 && Math.abs(east) < 900) return 500;
      if (north >= 19_000 && north <= 21_000 && Math.abs(east) < 4_000) return 3000;
      return 0;
    };
    const { ridges } = computeDemProfile(threeWalls, 10, { stepDeg: 1 });
    expect(ridges).toHaveLength(2);
    const angles = ridges.map((r) => radToDeg(r.angles[0]!)).sort((a, b) => a - b);
    expect(Math.abs(angles[0]! - radToDeg(Math.atan2(190, 2_900)))).toBeLessThan(0.3);
    expect(Math.abs(angles[1]! - radToDeg(Math.atan2(490, 4_900)))).toBeLessThan(0.3);
  });

  it('le profil d’horizon est inchangé par la collecte des crêtes', () => {
    const { skyline } = computeDemProfile(twoWalls, 10, { stepDeg: 2 });
    expect(Array.from(computeDemSkyline(twoWalls, 10, { stepDeg: 2 }))).toEqual(
      Array.from(skyline),
    );
  });
});

describe('ridgeScreenPolylines', () => {
  const view = { headingDeg: 0, pitchDeg: 0, fovDeg: 60, width: 1000, height: 1000 };
  // Crête à 5° de 350° à 10° (21 pas de 1°), à cheval sur la couture.
  const ridge = { startBin: 350, angles: new Float32Array(21).fill(degToRad(5)) };

  it('projette une crête dans le champ en une polyligne au-dessus du centre', () => {
    const lines = ridgeScreenPolylines([ridge], 1, view);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.length).toBe(21);
    for (let i = 1; i < line.length; i++) expect(line[i]!.x).toBeGreaterThan(line[i - 1]!.x);
    for (const p of line) expect(p.y).toBeLessThan(500);
  });

  it('ne trace rien quand la crête est derrière', () => {
    expect(ridgeScreenPolylines([ridge], 1, { ...view, headingDeg: 180 })).toHaveLength(0);
  });

  it('coupe une crête au bord du champ', () => {
    // Cap 40° : seuls les pas proches de 10° (bord gauche du champ) restent.
    const lines = ridgeScreenPolylines([ridge], 1, { ...view, headingDeg: 40 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThan(21);
    expect(lines[0]!.length).toBeGreaterThanOrEqual(2);
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

  it('s’arrête à la crête brumeuse, pas à la cime des arbres', () => {
    // Rapport terrain n° 5 : montagne claire et brumeuse sur ciel bleu, premier
    // plan d'arbres et de toits beaucoup plus sombre. La coupure à contraste
    // maximal choisissait la cime des arbres (13° trop bas) et emmenait tout le
    // recalage avec elle.
    const w = 40;
    const h = 90;
    const crete = 24;
    const arbres = 52;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const bande = y < crete ? [135, 180, 235] : y < arbres ? [120, 140, 165] : [35, 45, 30];
        rgba[o] = bande[0]!;
        rgba[o + 1] = bande[1]!;
        rgba[o + 2] = bande[2]!;
        rgba[o + 3] = 255;
      }
    }
    const detected = detectImageSkyline(rgba, w, h);
    for (let x = 0; x < w; x++) {
      expect(Math.abs(detected.rows[x]! - crete)).toBeLessThanOrEqual(1.5);
      expect(detected.confidence[x]!).toBeGreaterThan(0.35); // exploitable par le matcher
    }
  });

  it('ne coupe pas dans un ciel qui pâlit vers l’horizon', () => {
    // Rapport terrain n° 9 : ciel dégagé, dominante bleue de 66 à 50 et
    // luminance en hausse en descendant vers l'horizon. La perte de bleu
    // mesurée depuis le haut de l'image prenait ce dégradé pour une crête
    // (coupure ligne 12 sur 111, confiance nulle, recalage refusé).
    const w = 30;
    const h = 90;
    const crete = 60;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const t = Math.min(1, y / crete);
        // Ciel : de (110,150,230) en haut à (170,200,240) à l'horizon — bleu − rouge
        // de 120 à 70 (−42 %), luminance de 145 à 187. Puis crête brumeuse.
        const bande = y < crete ? [110 + 60 * t, 150 + 50 * t, 230 + 10 * t] : [95, 105, 125];
        rgba[o] = bande[0]!;
        rgba[o + 1] = bande[1]!;
        rgba[o + 2] = bande[2]!;
        rgba[o + 3] = 255;
      }
    }
    const detected = detectImageSkyline(rgba, w, h);
    for (let x = 0; x < w; x++) {
      expect(Math.abs(detected.rows[x]! - crete)).toBeLessThanOrEqual(1.5);
      expect(detected.confidence[x]!).toBeGreaterThan(0.35);
    }
  });

  it('se replie sur le contraste maximal quand le haut n’est pas du ciel', () => {
    // Téléphone incliné vers le bas : la bande de référence est du terrain
    // texturé — descendre depuis elle n'aurait aucun sens.
    const w = 20;
    const h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        // Haut : terrain bruité clair/sombre ; bas : terrain franchement sombre.
        const haut = y < 18;
        const bruit = (x * 7 + y * 13) % 90;
        rgba[o] = haut ? 90 + bruit : 40;
        rgba[o + 1] = haut ? 95 + bruit : 42;
        rgba[o + 2] = haut ? 85 + bruit : 38;
        rgba[o + 3] = 255;
      }
    }
    const detected = detectImageSkyline(rgba, w, h);
    for (let x = 0; x < w; x++) {
      expect(detected.rows[x]!).toBeGreaterThanOrEqual(14);
      expect(detected.rows[x]!).toBeLessThanOrEqual(22);
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
  function renderDetected(
    width: number,
    height: number,
    fov: number,
    truePitchDeg = 3,
  ): DetectedSkyline {
    const rows = new Float32Array(width);
    const confidence = new Float32Array(width).fill(1);
    for (let x = 0; x < width; x++) {
      let bestY = 0;
      let bestErr = Infinity;
      for (let y = 0; y < height; y++) {
        const { azRelDeg, elevDeg } = pixelToAngles(x, y, width, height, truePitchDeg, fov);
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

  it('affine sous le pas de grille : cap et assiette à 0,1° près', () => {
    // Vraies corrections 6,7° et −1,2° : ni multiples de 0,25° ni de 0,5°. La
    // grille seule les arrondissait (jusqu'à 0,25° d'assiette perdue) ; la
    // descente exacte les retrouve.
    const detected = renderDetected(240, 180, 55);
    const match = matchSkyline(detected, { headingDeg: 130.3, pitchDeg: 4.2, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
    });
    expect(match).not.toBeNull();
    expect(Math.abs(match!.headingOffsetDeg - 6.7)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(match!.pitchOffsetDeg - -1.2)).toBeLessThanOrEqual(0.1);
    expect(match!.maeDeg).toBeLessThan(0.2);
  });

  it("reste exact pour une grosse correction d'assiette aux colonnes de bord", () => {
    // Une correction d'assiette ne translate pas les colonnes de bord d'autant
    // que le centre (facteur cos de l'azimut relatif, et l'azimut bouge aussi) :
    // le modèle additif se trompait de ~0,5° au bord pour 6° de correction.
    // L'affinage recalcule les angles exacts à l'assiette testée.
    const detected = renderDetected(240, 180, 65);
    const match = matchSkyline(detected, { headingDeg: 130, pitchDeg: 9, fovDeg: 65 }, dem, {
      demStepDeg: DEM_STEP,
    });
    expect(match).not.toBeNull();
    expect(Math.abs(match!.headingOffsetDeg - 7)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(match!.pitchOffsetDeg - -6)).toBeLessThanOrEqual(0.15);
    expect(match!.maeDeg).toBeLessThan(0.25);
    expect(match!.inlierColumns).toBe(match!.usedColumns);
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

  it('signale un FOV coincé sur une borne (valeur bornée, pas mesurée)', () => {
    // Optique large (68°) mais recherche plafonnée à 60° : l'optimum se colle
    // à la borne. Cas du rapport terrain n° 2 (flux 16:9 sous le plancher) :
    // la valeur ne doit pas être persistée comme étalonnage.
    const detected = renderDetected(120, 90, 68);
    const bride = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
      fovSearch: { minDeg: 40, maxDeg: 60 },
    });
    expect(bride!.fovDeg).toBeGreaterThanOrEqual(59);
    expect(bride!.fovAtBound).toBe(true);

    // Plage assez large : l'optimum tombe à l'intérieur, la mesure vaut.
    const large = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
      fovSearch: { minDeg: 40, maxDeg: 90 },
    });
    expect(large!.fovAtBound).toBe(false);
    expect(Math.abs(large!.fovDeg - 68)).toBeLessThanOrEqual(2);
  });

  it('les corrections d’un FOV écarté ne valent pas au FOV en usage', () => {
    // Rapport terrain n° 4 : l'optique mesurée butait sur une borne, elle a
    // donc été écartée — mais cap et assiette trouvés AVEC elle étaient quand
    // même appliqués à une vue dessinée avec un autre FOV. Le résidu ci-dessous
    // le mesure : au FOV réellement en usage, la mise en correspondance refaite
    // à ce FOV colle mieux que celle héritée du FOV écarté.
    const VIEW_FOV = 55;
    const detected = renderDetected(120, 90, 68);
    const view = { headingDeg: 130, pitchDeg: 4, fovDeg: VIEW_FOV };

    /** Erreur absolue moyenne (plafonnée) des colonnes, au FOV de la vue. */
    const residual = (match: SkylineMatch): number => {
      let sum = 0;
      for (let x = 0; x < detected.width; x++) {
        const { azRelDeg, elevDeg } = pixelToAngles(
          x,
          detected.rows[x]!,
          detected.width,
          detected.height,
          view.pitchDeg,
          VIEW_FOV,
        );
        const expected = demDeg(view.headingDeg + match.headingOffsetDeg + azRelDeg);
        sum += Math.min(3, Math.abs(expected - (elevDeg + match.pitchOffsetDeg)));
      }
      return sum / detected.width;
    };

    const brides = matchSkyline(detected, view, dem, {
      demStepDeg: DEM_STEP,
      fovSearch: { minDeg: 40, maxDeg: 60 },
    })!;
    expect(brides.fovAtBound).toBe(true);
    const auFovDeLaVue = matchSkyline(detected, view, dem, { demStepDeg: DEM_STEP })!;

    expect(residual(auFovDeLaVue)).toBeLessThan(residual(brides));
  });

  it('garde le FOV courant sans estimation demandée', () => {
    const detected = renderDetected(120, 90, 55);
    const match = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
    });
    expect(match!.fovDeg).toBe(55);
    expect(match!.fovAtBound).toBe(false);
  });

  it('sur un horizon plat : corrige l’assiette sans inventer de cap', () => {
    // Cas terrain réel signalé : plaine, biais d'assiette de −5° (capteurs 4°,
    // vraie assiette −1°). Le cap y est indéterminé : il ne doit pas bouger.
    const flatDem = new Float32Array(720).fill(degToRad(-0.5));
    const width = 120;
    const height = 90;
    const rows = new Float32Array(width);
    const confidence = new Float32Array(width).fill(1);
    for (let x = 0; x < width; x++) {
      let bestY = 0;
      let bestErr = Infinity;
      for (let y = 0; y < height; y++) {
        const { elevDeg } = pixelToAngles(x, y, width, height, -1, 55);
        const err = Math.abs(elevDeg - -0.5);
        if (err < bestErr) {
          bestErr = err;
          bestY = y;
        }
      }
      rows[x] = bestY;
    }
    const match = matchSkyline(
      { rows, confidence, width, height },
      { headingDeg: 130, pitchDeg: 4, fovDeg: 55 },
      flatDem,
      { demStepDeg: 0.5 },
    );
    expect(match).not.toBeNull();
    expect(Math.abs(match!.pitchOffsetDeg - -5)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(match!.headingOffsetDeg)).toBeLessThanOrEqual(0.5);
  });

  it('refuse une détection trop peu confiante', () => {
    const detected = renderDetected(60, 45, 55);
    detected.confidence.fill(0);
    expect(matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem)).toBeNull();
  });

  it('reste verrouillé malgré une minorité de colonnes parasites', () => {
    // Cas du rapport terrain (contre-jour marin) : un bloc de colonnes accroche
    // un bord fort bien SOUS l'horizon vrai. Le coût plafonné doit laisser la
    // majorité saine gagner au lieu de tirer assiette et FOV vers les bornes.
    const detected = renderDetected(120, 90, 55);
    for (let x = 90; x < 120; x++) {
      detected.rows[x] = Math.min(88, detected.rows[x]! + 20); // ~12° trop bas
    }
    const match = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
    });
    expect(match).not.toBeNull();
    expect(Math.abs(match!.headingOffsetDeg - 7)).toBeLessThanOrEqual(1);
    expect(Math.abs(match!.pitchOffsetDeg - -1)).toBeLessThanOrEqual(1);
    expect(match!.maeDeg).toBeLessThan(1); // MAE des colonnes concordantes
    expect(match!.inlierColumns).toBeGreaterThanOrEqual(85);
    expect(isMatchReliable(match!)).toBe(true);
  });

  it('refuse d’appliquer quand la majorité des colonnes accroche un parasite', () => {
    const detected = renderDetected(120, 90, 55);
    for (let x = 0; x < 78; x++) {
      detected.rows[x] = Math.min(88, detected.rows[x]! + 20); // 65 % parasites
    }
    const match = matchSkyline(detected, { headingDeg: 130, pitchDeg: 4, fovDeg: 55 }, dem, {
      demStepDeg: DEM_STEP,
    });
    expect(match).not.toBeNull();
    expect(isMatchReliable(match!)).toBe(false);
  });
});
