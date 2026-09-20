import { describe, expect, it } from 'vitest';
import { AimFilter, type OrientationSample } from './aimFilter';
import { iosCompassToAlpha, orientationToAim } from './orientation';

/** Écart angulaire absolu par l'arc le plus court (°). */
function arcAbs(aDeg: number, bDeg: number): number {
  return Math.abs(((((bDeg - aDeg) % 360) + 540) % 360) - 180);
}

/** Suite d'événements espacés de 16 ms (≈ 60 Hz), à partir de t = 0. */
function feed(
  filter: AimFilter,
  samples: Array<Omit<OrientationSample, 'timeMs'>>,
  startMs = 0,
): ReturnType<AimFilter['update']> {
  let out = { headingDeg: 0, pitchDeg: 0 };
  samples.forEach((s, i) => {
    out = filter.update({ ...s, timeMs: startMs + i * 16 });
  });
  return out;
}

const repeat = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i));

describe('AimFilter — sans boussole (Android absolu)', () => {
  it('événement constant : restitue exactement la visée', () => {
    const out = feed(
      new AimFilter(),
      repeat(5, () => ({ alphaDeg: 270, betaDeg: 90, gammaDeg: 0, compassDeg: null })),
    );
    expect(out.headingDeg).toBeCloseTo(90, 6);
    expect(out.pitchDeg).toBeCloseTo(0, 6);
  });

  it('petit pas de cap : converge en douceur, sans détour par le grand arc', () => {
    const filter = new AimFilter();
    feed(
      filter,
      repeat(10, () => ({ alphaDeg: 1, betaDeg: 90, gammaDeg: 0, compassDeg: null })),
    );
    // Cap 359° → cible 2° : la première mise à jour reste sur l'arc court.
    const step = filter.update({
      alphaDeg: 358,
      betaDeg: 90,
      gammaDeg: 0,
      compassDeg: null,
      timeMs: 200,
    });
    expect(arcAbs(359, step.headingDeg)).toBeLessThan(3);
    expect(arcAbs(step.headingDeg, 2)).toBeLessThan(3);
    const settled = feed(
      filter,
      repeat(60, () => ({ alphaDeg: 358, betaDeg: 90, gammaDeg: 0, compassDeg: null })),
      216,
    );
    expect(settled.headingDeg).toBeCloseTo(2, 1);
  });

  it('grand écart (> 45°) : saute immédiatement, pas de traînée', () => {
    const filter = new AimFilter();
    feed(
      filter,
      repeat(5, () => ({ alphaDeg: 0, betaDeg: 90, gammaDeg: 0, compassDeg: null })),
    );
    const out = filter.update({
      alphaDeg: 240,
      betaDeg: 90,
      gammaDeg: 0,
      compassDeg: null,
      timeMs: 100,
    });
    expect(out.headingDeg).toBeCloseTo(120, 6);
  });
});

describe('AimFilter — boussole iOS', () => {
  it('pose inclinée : le nord vient de la boussole dès le premier événement', () => {
    // α relatif arbitraire (origine gyroscopique quelconque), boussole fiable.
    const out = new AimFilter().update({
      alphaDeg: 100,
      betaDeg: 45,
      gammaDeg: 0,
      compassDeg: 30,
      timeMs: 0,
    });
    const expected = orientationToAim(iosCompassToAlpha(30), 45, 0);
    expect(out.headingDeg).toBeCloseTo(expected.headingDeg, 6);
    expect(out.pitchDeg).toBeCloseTo(expected.pitchDeg, 6);
  });

  it('verticale : une boussole qui bat de ±40° ne fait plus trembler le cap', () => {
    const filter = new AimFilter();
    // Nord appris en pose fiable (β = 60°), boussole cohérente avec α.
    feed(
      filter,
      repeat(10, () => ({ alphaDeg: 0, betaDeg: 60, gammaDeg: 0, compassDeg: 0 })),
    );
    // Puis visée à la verticale : α stable, boussole en plein battement.
    let maxDev = 0;
    repeat(120, (i) => i).forEach((i) => {
      const out = filter.update({
        alphaDeg: 0,
        betaDeg: 90,
        gammaDeg: 0,
        compassDeg: i % 2 === 0 ? 40 : 320,
        timeMs: 160 + i * 16,
      });
      maxDev = Math.max(maxDev, arcAbs(0, out.headingDeg));
    });
    expect(maxDev).toBeLessThan(0.75);
  });

  it('verticale : la rotation au gyroscope continue de suivre', () => {
    const filter = new AimFilter();
    feed(
      filter,
      repeat(10, () => ({ alphaDeg: 0, betaDeg: 60, gammaDeg: 0, compassDeg: 0 })),
    );
    // α parcourt −30° (cap +30°) en 2 s pendant que la boussole divague.
    repeat(125, (i) => i).forEach((i) => {
      filter.update({
        alphaDeg: 360 - (30 * (i + 1)) / 125,
        betaDeg: 90,
        gammaDeg: 0,
        compassDeg: i % 2 === 0 ? 100 : 250,
        timeMs: 160 + i * 16,
      });
    });
    const out = feed(
      filter,
      repeat(40, () => ({ alphaDeg: 330, betaDeg: 90, gammaDeg: 0, compassDeg: 100 })),
      160 + 125 * 16,
    );
    expect(arcAbs(30, out.headingDeg)).toBeLessThan(0.5);
  });

  it('au-delà de la verticale (visée vers le ciel) : l’azimut retourné est redressé', () => {
    const filter = new AimFilter();
    feed(
      filter,
      repeat(10, () => ({ alphaDeg: 0, betaDeg: 60, gammaDeg: 0, compassDeg: 0 })),
    );
    // β = 120° : cos β < 0, l'azimut du haut de l'appareil se retourne de 180°
    // (la boussole cohérente avec α = 0 y vaut 180, pas 0).
    feed(
      filter,
      repeat(80, () => ({ alphaDeg: 0, betaDeg: 120, gammaDeg: 0, compassDeg: 180 })),
      160,
    );
    expect(arcAbs(0, filter.compassOffsetDeg ?? 999)).toBeLessThan(0.1);
    const out = feed(
      filter,
      repeat(30, () => ({ alphaDeg: 0, betaDeg: 90, gammaDeg: 0, compassDeg: 180 })),
      2000,
    );
    expect(arcAbs(0, out.headingDeg)).toBeLessThan(0.5);
  });

  it('première boussole prise en visée vers le ciel : nord juste, pas 180° faux', () => {
    // Pose cohérente : α = 40, β = 110 (on vise 20° au-dessus de l'horizon en
    // portrait) → le haut de l'appareil bascule derrière, son azimut vaut 140.
    // Le cap visé est 320° ; l'ignorer donnait exactement 140° (bug de terrain).
    const out = new AimFilter().update({
      alphaDeg: 40,
      betaDeg: 110,
      gammaDeg: 0,
      compassDeg: 140,
      timeMs: 0,
    });
    expect(arcAbs(320, out.headingDeg)).toBeLessThan(0.01);
  });

  it('boussole toujours mal conditionnée : la première lecture ne se grave pas', () => {
    const filter = new AimFilter();
    // Séance entière téléphone dressé (β = 90) : le premier cap est aberrant
    // (+150°), les suivants sont bons. Rien ici n'est « fiable » au sens du
    // conditionnement — il faut quand même que la moyenne redresse le nord.
    filter.update({ alphaDeg: 0, betaDeg: 90, gammaDeg: 0, compassDeg: 150, timeMs: 0 });
    expect(arcAbs(150, filter.compassOffsetDeg ?? 999)).toBeLessThan(0.1);
    const out = feed(
      filter,
      repeat(90, () => ({ alphaDeg: 0, betaDeg: 90, gammaDeg: 0, compassDeg: 0 })),
      16,
    );
    expect(arcAbs(0, filter.compassOffsetDeg ?? 999)).toBeLessThan(2);
    expect(arcAbs(0, out.headingDeg)).toBeLessThan(2);
  });

  it('accord des lectures exposé : boussole cohérente ≫ boussole qui divague', () => {
    const steady = new AimFilter();
    feed(
      steady,
      repeat(60, () => ({ alphaDeg: 0, betaDeg: 60, gammaDeg: 0, compassDeg: 0 })),
    );
    const erratic = new AimFilter();
    repeat(60, (i) => i).forEach((i) => {
      erratic.update({
        alphaDeg: 0,
        betaDeg: 60,
        gammaDeg: 0,
        compassDeg: i % 2 === 0 ? 70 : 290,
        timeMs: i * 16,
      });
    });
    expect(steady.compassCoherence).toBeGreaterThan(0.99);
    expect(erratic.compassCoherence).toBeLessThan(0.5);
  });

  it('à plat : le décalage s’affine vers la boussole (dérive gyroscopique résorbée)', () => {
    const filter = new AimFilter();
    feed(
      filter,
      repeat(2, () => ({ alphaDeg: 0, betaDeg: 30, gammaDeg: 0, compassDeg: 0 })),
    );
    // La boussole glisse à 10° (comme si le gyroscope avait dérivé de −10°).
    const out = feed(
      filter,
      repeat(600, () => ({ alphaDeg: 0, betaDeg: 30, gammaDeg: 0, compassDeg: 10 })),
      32,
    );
    expect(filter.compassOffsetDeg).toBeGreaterThan(8);
    expect(filter.compassOffsetDeg).toBeLessThanOrEqual(10);
    expect(out.headingDeg).toBeGreaterThan(8);
    expect(out.headingDeg).toBeLessThanOrEqual(10.01);
  });

  it('poids exposés pour le rapport de débogage', () => {
    const filter = new AimFilter();
    expect(filter.compassOffsetDeg).toBeNull();
    filter.update({ alphaDeg: 0, betaDeg: 60, gammaDeg: 0, compassDeg: 0, timeMs: 0 });
    expect(filter.compassOffsetDeg).not.toBeNull();
    expect(filter.compassWeight).toBeCloseTo(0.5, 6);
  });
});
