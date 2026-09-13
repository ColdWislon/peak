import type { LatLon } from '../geo';

/**
 * L'état partageable vit dans l'URL (`?lat=…&lon=…&mode=…`) : un panorama ou
 * une carte se partage en copiant l'adresse. Arrondi à 5 décimales (~1 m).
 */

export type ViewMode = 'panorama' | 'carte' | 'viser';

/**
 * Mode d'ouverture : Viser. L'app sert d'abord à identifier les sommets qu'on
 * a devant soi, téléphone en main ; le panorama et la carte restent à un
 * bouton. Les liens partagés portent donc `mode=panorama` ou `mode=carte`
 * explicitement, et une adresse nue ouvre la visée.
 */
export const DEFAULT_MODE: ViewMode = 'viser';

/** D'où vient le point de vue : décisif pour juger un horizon qui ne colle pas. */
export type ViewpointSource = 'defaut' | 'url' | 'gps' | 'recherche' | 'carte' | 'sommet';

export function parseViewpoint(search: string): LatLon | null {
  const params = new URLSearchParams(search);
  const lat = Number.parseFloat(params.get('lat') ?? '');
  const lon = Number.parseFloat(params.get('lon') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function parseMode(search: string): ViewMode {
  const mode = new URLSearchParams(search).get('mode');
  if (mode === 'carte' || mode === 'viser' || mode === 'panorama') return mode;
  return DEFAULT_MODE;
}

export function viewpointToSearch(viewpoint: LatLon, mode: ViewMode = DEFAULT_MODE): string {
  const lat = viewpoint.lat.toFixed(5);
  const lon = viewpoint.lon.toFixed(5);
  return `?lat=${lat}&lon=${lon}${mode === DEFAULT_MODE ? '' : `&mode=${mode}`}`;
}
