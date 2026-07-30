import { describe, expect, it } from 'vitest';
import { isVisible, type ElevationSampler } from './index';

const flat: ElevationSampler = () => 0;
const eye = { eyeElevation: 10 };

/** Muraille de 2000 m entre 9 et 11 km au nord, plaine ailleurs. */
const wall: ElevationSampler = (_east, north) => (north >= 9_000 && north <= 11_000 ? 2000 : 0);

describe('isVisible', () => {
  it('voit un sommet dominant une plaine', () => {
    expect(isVisible(flat, 0, 40_000, 1500, eye)).toBe(true);
  });

  it('est toujours vrai à très courte distance', () => {
    expect(isVisible(wall, 0, 400, -100, eye)).toBe(true);
  });

  it('cache un point bas derrière une muraille', () => {
    expect(isVisible(wall, 0, 30_000, 500, eye)).toBe(false);
  });

  it('voit un sommet qui domine la muraille', () => {
    // Le pire occulteur est le bord proche du mur (2000 m à 9 km) : depuis 10 m,
    // la cible à 30 km doit dépasser ~6590 m pour passer au-dessus. On prend 7000.
    expect(isVisible(wall, 0, 30_000, 7000, eye)).toBe(true);
  });

  it("ne teste que l'azimut de la cible", () => {
    // Plein est : la muraille (au nord) ne gêne pas.
    expect(isVisible(wall, 30_000, 0, 500, eye)).toBe(true);
  });

  it('tolère un masquage plus fin que le bruit du DEM', () => {
    // Cible 1500 m à 30 km depuis 10 m : au bord proche de la crête (14 km),
    // la ligne de visée passe vers ~692 m ; une crête à 710 m masque donc sans
    // marge, mais la tolérance de 30 m absorbe ce dépassement (< 722 m).
    const ridge: ElevationSampler = (_e, north) => (north >= 14_000 && north <= 16_000 ? 710 : 0);
    expect(isVisible(ridge, 0, 30_000, 1500, eye)).toBe(true);
    expect(isVisible(ridge, 0, 30_000, 1500, { ...eye, toleranceM: 0 })).toBe(false);
  });

  it('applique la courbure : la plaine cache un point bas très lointain', () => {
    // À 80 km, un point à 10 m d'altitude est sous l'horizon de ~400 m :
    // le sol plat interposé, lui, dépasse l'angle de la cible.
    expect(isVisible(flat, 0, 80_000, -500, eye)).toBe(false);
  });
});
