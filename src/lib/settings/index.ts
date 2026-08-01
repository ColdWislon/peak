import type { NamePreference } from '../peaks';

/**
 * Réglages de l'app (backlog phase 3) : types, valeurs par défaut et
 * (dé)sérialisation tolérante pour localStorage. Module pur, testé —
 * la réactivité et la persistance vivent dans store.svelte.ts.
 */

export type RenderQuality = 'auto' | 'elevee' | 'eco';
export type Units = 'metric' | 'imperial';

export interface Settings {
  /** Densité du maillage et résolution de rendu du panorama. */
  quality: RenderQuality;
  /** Unités d'altitude et de distance affichées. */
  units: Units;
  /** Nom des sommets : français quand disponible, ou nom local. */
  names: NamePreference;
  /**
   * FOV du petit côté du capteur caméra (°), mesuré par recalage horizon ;
   * null = pas étalonné. Invariant quand l'écran tourne — le FOV vertical de la
   * vue s'en déduit via la découpe `cover` (lib/viser/videoView). Remplace
   * l'ancien `cameraFovDeg` (FOV d'écran, sémantique différente : ignoré).
   */
  cameraShortFovDeg: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  units: 'metric',
  names: 'fr',
  cameraShortFovDeg: null,
};

const QUALITIES: readonly RenderQuality[] = ['auto', 'elevee', 'eco'];
const UNITS: readonly Units[] = ['metric', 'imperial'];
const NAMES: readonly NamePreference[] = ['fr', 'local'];

/** Relit des réglages stockés ; toute valeur absente ou inconnue retombe sur le défaut. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: QUALITIES.includes(parsed.quality as RenderQuality)
        ? (parsed.quality as RenderQuality)
        : DEFAULT_SETTINGS.quality,
      units: UNITS.includes(parsed.units as Units)
        ? (parsed.units as Units)
        : DEFAULT_SETTINGS.units,
      names: NAMES.includes(parsed.names as NamePreference)
        ? (parsed.names as NamePreference)
        : DEFAULT_SETTINGS.names,
      cameraShortFovDeg:
        typeof parsed.cameraShortFovDeg === 'number' &&
        Number.isFinite(parsed.cameraShortFovDeg) &&
        parsed.cameraShortFovDeg >= 30 &&
        parsed.cameraShortFovDeg <= 100
          ? parsed.cameraShortFovDeg
          : null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(settings);
}
