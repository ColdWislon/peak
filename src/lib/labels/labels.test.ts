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
  it('écarte les doublons au même endroit et garde le meilleur score', () => {
    const labels = placeLabels(
      [
        candidate({ id: 1, score: 3000, elevation: 3000 }),
        candidate({ id: 2, score: 1000, elevation: 1000, azimuthDeg: 0.2 }),
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
    // Score = importance : altitude + bonus de proéminence.
    expect(candidates[0]!.score).toBeCloseTo(4808 + 4696 * 2, 6);
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
