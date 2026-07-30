import { describe, expect, it } from 'vitest';
import {
  apparentElevationAngle,
  curvatureDrop,
  destinationPoint,
  EARTH_RADIUS_M,
  haversineDistance,
  initialBearing,
  localEastNorth,
  normalizeBearing,
  normalizeLon,
} from './index';

const CHAMONIX = { lat: 45.9237, lon: 6.8694 };

describe('normalizeBearing', () => {
  it('ramène les caps dans [0, 360)', () => {
    expect(normalizeBearing(0)).toBe(0);
    expect(normalizeBearing(360)).toBe(0);
    expect(normalizeBearing(450)).toBe(90);
    expect(normalizeBearing(-90)).toBe(270);
  });
});

describe('normalizeLon', () => {
  it('ramène les longitudes dans [-180, 180)', () => {
    expect(normalizeLon(180)).toBe(-180);
    expect(normalizeLon(-180)).toBe(-180);
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(6.87)).toBeCloseTo(6.87, 10);
  });
});

describe('haversineDistance', () => {
  it('vaut exactement un quart de circonférence entre équateur et pôle', () => {
    const d = haversineDistance({ lat: 0, lon: 0 }, { lat: 90, lon: 0 });
    expect(d).toBeCloseTo((Math.PI * EARTH_RADIUS_M) / 2, 3);
  });

  it("vaut 1° d'arc le long de l'équateur", () => {
    const d = haversineDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(d).toBeCloseTo((Math.PI * EARTH_RADIUS_M) / 180, 3);
  });

  it('est nulle entre un point et lui-même', () => {
    expect(haversineDistance(CHAMONIX, CHAMONIX)).toBe(0);
  });
});

describe('initialBearing', () => {
  it("pointe au nord puis à l'est depuis l'équateur", () => {
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
  });
});

describe('destinationPoint', () => {
  it('boucle avec haversineDistance et initialBearing', () => {
    const dest = destinationPoint(CHAMONIX, 47, 12345);
    expect(haversineDistance(CHAMONIX, dest)).toBeCloseTo(12345, 3);
    expect(initialBearing(CHAMONIX, dest)).toBeCloseTo(47, 3);
  });
});

describe('localEastNorth', () => {
  it('projette un déplacement plein nord sur le seul axe nord', () => {
    const { east, north } = localEastNorth(CHAMONIX, {
      lat: CHAMONIX.lat + 0.01,
      lon: CHAMONIX.lon,
    });
    expect(east).toBeCloseTo(0, 6);
    expect(north).toBeCloseTo((EARTH_RADIUS_M * Math.PI * 0.01) / 180, 3);
  });

  it('réduit un déplacement plein est du cosinus de la latitude', () => {
    const { east, north } = localEastNorth(CHAMONIX, {
      lat: CHAMONIX.lat,
      lon: CHAMONIX.lon + 0.01,
    });
    const expected =
      ((EARTH_RADIUS_M * Math.PI * 0.01) / 180) * Math.cos((CHAMONIX.lat * Math.PI) / 180);
    expect(north).toBeCloseTo(0, 6);
    expect(east).toBeCloseTo(expected, 3);
  });

  it('reste cohérente avec haversine à 50 km (écart < 0,1 %)', () => {
    const dest = destinationPoint(CHAMONIX, 235, 50_000);
    const { east, north } = localEastNorth(CHAMONIX, dest);
    const planar = Math.hypot(east, north);
    expect(Math.abs(planar - 50_000) / 50_000).toBeLessThan(0.001);
  });
});

describe('curvatureDrop', () => {
  it('vaut ~6,75 m à 10 km (courbure + réfraction standard)', () => {
    expect(curvatureDrop(10_000)).toBeCloseTo(6.75, 2);
  });

  it('croît comme le carré de la distance', () => {
    expect(curvatureDrop(20_000) / curvatureDrop(10_000)).toBeCloseTo(4, 10);
  });
});

describe('apparentElevationAngle', () => {
  it('est nul quand la hauteur compense exactement la courbure', () => {
    const d = 30_000;
    expect(apparentElevationAngle(d, curvatureDrop(d))).toBeCloseTo(0, 12);
  });

  it('est négatif pour un point au niveau de l’œil (il passe sous l’horizon)', () => {
    expect(apparentElevationAngle(30_000, 0)).toBeLessThan(0);
  });

  it('retrouve la pente géométrique à courte distance', () => {
    expect(apparentElevationAngle(1000, 1000)).toBeCloseTo(Math.PI / 4, 3);
  });
});
