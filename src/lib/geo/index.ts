/**
 * Géodésie pure — aucun DOM, aucun Three.js (voir « Architecture des modules » dans PLAN.md).
 *
 * Modèle : Terre sphérique. Pour un panorama dont l'horizon est à ~100 km, l'écart
 * avec un ellipsoïde WGS84 est négligeable devant la résolution du DEM (~30 m).
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Rayon moyen de la Terre (m). */
export const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Coefficient de réfraction atmosphérique standard utilisé en topographie :
 * la lumière courbe légèrement vers le sol, ce qui « aplatit » la Terre apparente.
 */
export const REFRACTION_COEFFICIENT = 0.14;

/**
 * Rayon terrestre effectif (m) pour tout ce qui est visuel (chute de courbure du
 * maillage, ligne de vue) : rayon réel corrigé de la réfraction standard.
 */
export const EFFECTIVE_EARTH_RADIUS_M = EARTH_RADIUS_M / (1 - REFRACTION_COEFFICIENT);

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Ramène un cap quelconque dans [0, 360). */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Distance orthodromique (m) entre deux points, formule de haversine. */
export function haversineDistance(a: LatLon, b: LatLon): number {
  const phi1 = degToRad(a.lat);
  const phi2 = degToRad(b.lat);
  const dPhi = degToRad(b.lat - a.lat);
  const dLambda = degToRad(b.lon - a.lon);

  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap initial (°, [0, 360)) pour aller de `a` vers `b`. 0 = nord, 90 = est. */
export function initialBearing(a: LatLon, b: LatLon): number {
  const phi1 = degToRad(a.lat);
  const phi2 = degToRad(b.lat);
  const dLambda = degToRad(b.lon - a.lon);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeBearing(radToDeg(Math.atan2(y, x)));
}

/** Point atteint depuis `origin` en suivant `bearingDeg` sur `distanceM` mètres. */
export function destinationPoint(origin: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = degToRad(bearingDeg);
  const phi1 = degToRad(origin.lat);
  const lambda1 = degToRad(origin.lon);

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return { lat: radToDeg(phi2), lon: normalizeLon(radToDeg(lambda2)) };
}

/** Ramène une longitude dans [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Projection locale équirectangulaire : coordonnées est/nord (m) de `point`
 * dans le repère tangent centré sur `origin`. Précise largement sous les 100 km
 * qui nous concernent (cosinus pris à la latitude moyenne).
 */
export function localEastNorth(origin: LatLon, point: LatLon): { east: number; north: number } {
  const midLat = degToRad((origin.lat + point.lat) / 2);
  const east = EARTH_RADIUS_M * degToRad(point.lon - origin.lon) * Math.cos(midLat);
  const north = EARTH_RADIUS_M * degToRad(point.lat - origin.lat);
  return { east, north };
}

/**
 * Inverse de `localEastNorth` : le point situé à (east, north) mètres du repère
 * tangent centré sur `origin`. Exactement réciproque (même latitude moyenne).
 */
export function localToLatLon(origin: LatLon, east: number, north: number): LatLon {
  const lat = origin.lat + radToDeg(north / EARTH_RADIUS_M);
  const midLat = degToRad((origin.lat + lat) / 2);
  const lon = origin.lon + radToDeg(east / (EARTH_RADIUS_M * Math.cos(midLat)));
  return { lat, lon: normalizeLon(lon) };
}

/**
 * Chute apparente (m) due à la courbure terrestre corrigée de la réfraction,
 * à `distanceM` mètres de l'observateur. C'est de combien un objet « descend »
 * sous le plan tangent local.
 */
export function curvatureDrop(distanceM: number): number {
  return (distanceM * distanceM) / (2 * EFFECTIVE_EARTH_RADIUS_M);
}

/**
 * Angle d'élévation apparent (rad) d'un point situé à `distanceM` mètres et
 * `heightDiffM` mètres au-dessus de l'œil, courbure/réfraction comprises.
 * Négatif si le point apparaît sous l'horizontale.
 */
export function apparentElevationAngle(distanceM: number, heightDiffM: number): number {
  return Math.atan2(heightDiffM - curvatureDrop(distanceM), distanceM);
}
