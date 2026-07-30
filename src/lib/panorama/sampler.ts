import { localToLatLon, type LatLon } from '../geo';
import type { GeoHeightField } from '../terrain/heightField';
import type { ElevationSampler } from '../visibility';

/**
 * Échantillonneur d'altitude combinant champ proche (haute résolution) et
 * champ lointain, avec fondu linéaire sur les derniers kilomètres du champ
 * proche — sans lui, le saut de résolution dessine une couture circulaire.
 * Partagé par le worker de maillage et celui de visibilité.
 */
export function makeBlendedSampler(
  viewpoint: LatLon,
  inner: GeoHeightField,
  outer: GeoHeightField,
  innerRadiusM: number,
  blendWidthM = 4_000,
): ElevationSampler {
  const blendStart = innerRadiusM - blendWidthM;

  return (east, north) => {
    const p = localToLatLon(viewpoint, east, north);
    const r = Math.hypot(east, north);
    const outerElev = () => (outer.contains(p) ? outer.elevationAt(p) : 0);
    if (r >= innerRadiusM || !inner.contains(p)) return outerElev();
    const innerElev = inner.elevationAt(p);
    if (r < blendStart) return innerElev;
    const t = (r - blendStart) / blendWidthM;
    return innerElev * (1 - t) + outerElev() * t;
  };
}
