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
}

export const DEFAULT_SETTINGS: Settings = { quality: 'auto', units: 'metric' };

const QUALITIES: readonly RenderQuality[] = ['auto', 'elevee', 'eco'];
const UNITS: readonly Units[] = ['metric', 'imperial'];

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
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(settings);
}
