import { describe, expect, it } from 'vitest';
import type { Peak } from '../peaks';
import type { PeakSight } from '../visibility/protocol';
import {
  formatDistance,
  formatElevation,
  placeLabels,
  projectToScreen,
  toCandidates,
  type LabelCandidate,
  type ViewGeometry,
} from './index';

const view: ViewGeometry = {
  headingDeg: 0,
  pitchDeg: 0,
  fovDeg: 60,
  width: 1000,
  height: 1000,
};

function candidate(partial: Partial<LabelCandidate>): LabelCandidate {
  return {
    id: 1,
    name: 'Sommet',
    elevation: 2000,
    distanceM: 10_000,
    azimuthDeg: 0,
    elevAngleRad: 0,
    score: 2000,
    ...partial,
  };
}

describe('projectToScreen', () => {
  it("centre un sommet droit devant à l'horizon", () => {
    const p = projectToScreen(0, 0, view);
    expect(p.behind).toBe(false);
    expect(p.x).toBeCloseTo(500, 6);
    expect(p.y).toBeCloseTo(500, 6);
  });

  it('pousse au bord droit un sommet à la demi-largeur du champ', () => {
    // Viewport carré : fov horizontal = fov vertical = 60°, bord droit à +30°.
    const p = projectToScreen(30, 0, view);
    expect(p.x).toBeCloseTo(1000, 6);
    expect(p.y).toBeCloseTo(500, 6);
  });

  it('marque derrière ce qui est dans le dos', () => {
    expect(projectToScreen(180, 0, view).behind).toBe(true);
  });

  it("suit l'assiette : lever les yeux fait descendre le sommet à l'écran", () => {
    const level = projectToScreen(0, 0, view);
    const lookingUp = projectToScreen(0, 0, { ...view, pitchDeg: 10 });
    expect(lookingUp.y).toBeGreaterThan(level.y);
  });

  it('suit le cap : un sommet plein est sort du cadre quand on regarde au nord', () => {
    const p = projectToScreen(90, 0, view);
    expect(p.behind || p.x > view.width).toBe(true);
  });
});

describe('placeLabels', () => {
  it('surélève le second quand deux étiquettes tombent au même endroit, sans le jeter', () => {
    const labels = placeLabels(
      [
        candidate({ id: 1, score: 3000, elevation: 3000 }),
        candidate({ id: 2, score: 1000, elevation: 1000, azimuthDeg: 0.2 }),
      ],
      view,
    );
    expect(labels.map((l) => l.id)).toEqual([1, 2]);
    expect(labels[0]!.lift).toBe(0);
    expect(labels[1]!.lift).toBeGreaterThan(30);
  });

  it("le plus important garde sa place même s'il arrive plus bas à l'écran", () => {
    // Petit sommet proche, plus haut dans le cadre ; géant lointain juste
    // dessous. Les candidats arrivent triés par score (toCandidates) : le
    // géant est posé à sa place, le petit est surélevé au-dessus de lui.
    const labels = placeLabels(
      [
        candidate({ id: 1, name: 'Mont Blanc', score: 14_200, elevAngleRad: 0.05 }),
        candidate({ id: 2, name: 'Bosse', score: 1_500, elevAngleRad: 0.08, azimuthDeg: 0.5 }),
      ],
      view,
    );
    expect(labels.map((l) => l.id)).toEqual([1, 2]);
    expect(labels[0]!.lift).toBe(0);
    expect(labels[1]!.lift).toBeGreaterThan(0);
    // La boîte surélevée du petit est bien AU-DESSUS de celle du géant.
    const top = (l: (typeof labels)[number]) => l.y - l.lift;
    expect(top(labels[1]!)).toBeLessThan(top(labels[0]!) - 30);
  });

  it('empile jusqu’à trois niveaux, puis renonce', () => {
    const labels = placeLabels(
      [1, 2, 3, 4].map((id) => candidate({ id, score: 5000 - id, azimuthDeg: id * 0.1 })),
      view,
    );
    expect(labels.map((l) => l.id)).toEqual([1, 2, 3]);
    const lifts = labels.map((l) => l.lift);
    expect(lifts[0]).toBe(0);
    expect(lifts[1]).toBeGreaterThan(lifts[0]!);
    expect(lifts[2]).toBeGreaterThan(lifts[1]!);
  });

  it('renonce plutôt que de sortir par le haut de l’écran', () => {
    // Sommets près du bord haut (élévation ~26° pour un champ de 60°).
    const labels = placeLabels(
      [
        candidate({ id: 1, score: 3000, elevAngleRad: 0.46 }),
        candidate({ id: 2, score: 1000, elevAngleRad: 0.46, azimuthDeg: 0.2 }),
      ],
      view,
    );
    expect(labels.map((l) => l.id)).toEqual([1]);
  });

  it('garde des sommets éloignés à l’écran', () => {
    const labels = placeLabels(
      [candidate({ id: 1 }), candidate({ id: 2, azimuthDeg: 20, name: 'Autre' })],
      view,
    );
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => l.lift === 0)).toBe(true);
  });

  it('ignore ce qui est hors cadre ou derrière', () => {
    const labels = placeLabels(
      [candidate({ id: 1, azimuthDeg: 170 }), candidate({ id: 2, azimuthDeg: 90 })],
      view,
    );
    expect(labels).toHaveLength(0);
  });
});

describe('toCandidates', () => {
  const peaks: Peak[] = [
    {
      id: 1,
      name: 'Monte Bianco',
      nameFr: 'Mont Blanc',
      lat: 0,
      lon: 0,
      elevation: 4808,
      prominence: 4696,
      wikidata: null,
    },
    {
      id: 2,
      name: 'Caché',
      nameFr: null,
      lat: 0,
      lon: 0,
      elevation: 2000,
      prominence: null,
      wikidata: null,
    },
  ];
  const sights: PeakSight[] = [
    { id: 1, visible: true, distanceM: 20_000, elevation: 4808, east: 0, north: 20_000 },
    { id: 2, visible: false, distanceM: 10_000, elevation: 2000, east: 10_000, north: 0 },
    { id: 99, visible: true, distanceM: 5_000, elevation: 1000, east: 0, north: 5_000 },
  ];

  it('ne garde que les sommets visibles et connus, triés par score', () => {
    const candidates = toCandidates(sights, peaks, 1000);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe('Mont Blanc');
    expect(candidates[0]!.azimuthDeg).toBeCloseTo(0, 6);
    expect(candidates[0]!.elevAngleRad).toBeGreaterThan(0);
    // Score = importance ABSOLUE (altitude + 2 × proéminence) : la priorité
    // de placement, pas le choix des sommets.
    expect(candidates[0]!.score).toBe(4808 + 2 * 4696);
  });

  it('un petit sommet proche passe APRÈS un géant lointain', () => {
    const withHill: Peak[] = [
      ...peaks,
      {
        id: 3,
        name: 'Bosse',
        nameFr: null,
        lat: 0,
        lon: 0,
        elevation: 1500,
        prominence: 100,
        wikidata: null,
      },
    ];
    const seen: PeakSight[] = [
      ...sights,
      { id: 3, visible: true, distanceM: 2_000, elevation: 1500, east: 0, north: 2_000 },
    ];
    const candidates = toCandidates(seen, withHill, 1000);
    // La bosse est bien plus haute dans le cadre que le Mont Blanc…
    expect(candidates.find((c) => c.id === 3)!.elevAngleRad).toBeGreaterThan(
      candidates.find((c) => c.id === 1)!.elevAngleRad,
    );
    // …mais c'est le Mont Blanc qui a la priorité de placement.
    expect(candidates.map((c) => c.id)).toEqual([1, 3]);
  });

  it('respecte la préférence de nom local', () => {
    const candidates = toCandidates(sights, peaks, 1000, 'local');
    expect(candidates[0]!.name).toBe('Monte Bianco');
  });
});

describe('formats français', () => {
  it('formate altitude et distance', () => {
    expect(formatElevation(4808.72).replace(/\s/g, ' ')).toBe('4 809 m');
    expect(formatDistance(850)).toBe('850 m');
    // NB : séparateur de milliers fr-FR variable selon ICU, normalisé ci-dessus.
    expect(formatDistance(8_360)).toBe('8,4 km');
    expect(formatDistance(64_800)).toBe('65 km');
  });

  it('formate en unités impériales', () => {
    expect(formatElevation(4808, 'imperial').replace(/\s/g, ' ')).toBe('15 774 ft');
    expect(formatDistance(100, 'imperial')).toBe('328 ft');
    expect(formatDistance(12_360, 'imperial')).toBe('7,7 mi');
    expect(formatDistance(64_800, 'imperial')).toBe('40 mi');
  });
});
