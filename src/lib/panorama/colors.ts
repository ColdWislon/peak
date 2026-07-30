/**
 * Couleur du terrain par altitude (style « sombre alpin » : nature stylisée,
 * vallées vertes → roche → neige). Valeurs RVB linéaires 0..1 pour les
 * attributs de sommets Three.js.
 */

export type Rgb = [number, number, number];

const WATER: Rgb = [0.15, 0.32, 0.5];

/** Paliers (altitude en m, couleur) interpolés linéairement. */
const STOPS: Array<[number, Rgb]> = [
  [0, [0.28, 0.4, 0.22]],
  [700, [0.34, 0.45, 0.25]],
  [1400, [0.45, 0.42, 0.32]],
  [2100, [0.52, 0.49, 0.44]],
  [2650, [0.58, 0.56, 0.53]],
  [3000, [0.9, 0.93, 0.96]],
  [4900, [1, 1, 1]],
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Couleur stylisée du sol à cette altitude ; l'eau (≤ 0 m) est bleue. */
export function elevationToColor(elevation: number): Rgb {
  if (elevation <= 0) return WATER;

  const first = STOPS[0]!;
  if (elevation <= first[0]) return first[1];

  for (let i = 1; i < STOPS.length; i++) {
    const [alt, color] = STOPS[i]!;
    if (elevation <= alt) {
      const [prevAlt, prevColor] = STOPS[i - 1]!;
      const t = (elevation - prevAlt) / (alt - prevAlt);
      return [
        lerp(prevColor[0], color[0], t),
        lerp(prevColor[1], color[1], t),
        lerp(prevColor[2], color[2], t),
      ];
    }
  }
  return STOPS[STOPS.length - 1]![1];
}
