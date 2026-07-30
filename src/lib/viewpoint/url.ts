import type { LatLon } from '../geo';

/**
 * Le point de vue vit dans l'URL (`?lat=…&lon=…`) : un panorama se partage
 * en copiant l'adresse. Arrondi à 5 décimales (~1 m).
 */

export function parseViewpoint(search: string): LatLon | null {
  const params = new URLSearchParams(search);
  const lat = Number.parseFloat(params.get('lat') ?? '');
  const lon = Number.parseFloat(params.get('lon') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function viewpointToSearch(viewpoint: LatLon): string {
  const lat = viewpoint.lat.toFixed(5);
  const lon = viewpoint.lon.toFixed(5);
  return `?lat=${lat}&lon=${lon}`;
}
