import type { LatLon } from '../geo';
import type { GeoHeightFieldData } from '../terrain/heightField';

/** Messages échangés avec le worker de visibilité. */

export interface PeakSite {
  id: number;
  lat: number;
  lon: number;
  /** Altitude du tag OSM, si connue (sinon le DEM fera foi). */
  elevation: number | null;
}

export interface VisibilityRequest {
  viewpoint: LatLon;
  /** Altitude de l'œil (m). */
  eyeElevation: number;
  /** Rayon en deçà duquel le champ proche est utilisé (m). */
  innerRadiusM: number;
  inner: GeoHeightFieldData;
  outer: GeoHeightFieldData;
  peaks: PeakSite[];
}

/** Résultat par sommet : visibilité et géométrie locale prête pour l'affichage. */
export interface PeakSight {
  id: number;
  visible: boolean;
  /** Distance à l'œil (m). */
  distanceM: number;
  /** Altitude retenue (tag OSM, sinon DEM) (m). */
  elevation: number;
  /** Coordonnées locales (m) dans le repère du panorama. */
  east: number;
  north: number;
}
