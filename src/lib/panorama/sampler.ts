import { makeLocalToLatLon, type LatLon } from '../geo';
import type { GeoHeightField } from '../terrain/heightField';
import type { ElevationSampler } from '../visibility';

/**
 * Échantillonneur d'altitude combinant champ proche (haute résolution) et
 * champ lointain, avec fondu linéaire sur les derniers kilomètres du champ
 * proche — sans lui, le saut de résolution dessine une couture circulaire.
 * Partagé par le worker de maillage et celui de visibilité.
 *
 * Chemin chaud (des centaines de milliers d'appels par point de vue) : la
 * projection inverse a son origine pré-réduite, et chaque champ est projeté
 * UNE fois en espace pixel (test d'emprise et lecture y sont faits ensemble).
 */
export function makeBlendedSampler(
  viewpoint: LatLon,
  inner: GeoHeightField,
  outer: GeoHeightField,
  innerRadiusM: number,
  blendWidthM = 4_000,
): ElevationSampler {
  const blendStart = innerRadiusM - blendWidthM;
  const toLatLon = makeLocalToLatLon(viewpoint);

  const outerElev = (p: LatLon): number => {
    const { px, py } = outer.localPixel(p);
    return outer.containsPixel(px, py) ? outer.elevationAtPixel(px, py) : 0;
  };

  return (east, north) => {
    const p = toLatLon(east, north);
    const r = Math.hypot(east, north);
    if (r >= innerRadiusM) return outerElev(p);
    const { px, py } = inner.localPixel(p);
    if (!inner.containsPixel(px, py)) return outerElev(p);
    const innerElev = inner.elevationAtPixel(px, py);
    if (r < blendStart) return innerElev;
    const t = (r - blendStart) / blendWidthM;
    return innerElev * (1 - t) + outerElev(p) * t;
  };
}
