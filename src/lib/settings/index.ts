import type { NamePreference } from '../peaks';
import type { FovSample } from '../viser/optics';

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
  /**
   * Forme du cadre (grand côté / petit côté, donc ≥ 1) sur laquelle ce FOV a
   * été mesuré ; null = inconnue (mesure antérieure à ce champ). Un cadre de
   * forme différente (16:9 vs 4:3) ne voit pas le même angle sur son petit
   * côté : la mesure ne s'y applique pas. Normalisée pour que la rotation de
   * l'appareil, qui fait pivoter le flux, ne l'invalide pas.
   */
  cameraStreamAspect: number | null;
  /**
   * Mesures successives du FOV petit côté (recalages adoptés), pondérées :
   * `cameraShortFovDeg` en est la médiane pondérée (lib/viser/optics).
   */
  cameraFovSamples: FovSample[];
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  units: 'metric',
  names: 'fr',
  cameraShortFovDeg: null,
  cameraStreamAspect: null,
  cameraFovSamples: [],
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
      cameraStreamAspect:
        typeof parsed.cameraStreamAspect === 'number' &&
        Number.isFinite(parsed.cameraStreamAspect) &&
        parsed.cameraStreamAspect > 0.2 &&
        parsed.cameraStreamAspect < 5
          ? parsed.cameraStreamAspect
          : null,
      cameraFovSamples: parseFovSamples(parsed.cameraFovSamples),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Mesures de FOV stockées : chaque entrée doit être plausible, sinon écartée. */
function parseFovSamples(raw: unknown): FovSample[] {
  if (!Array.isArray(raw)) return [];
  const samples: FovSample[] = [];
  for (const entry of raw) {
    const fovDeg = (entry as { fovDeg?: unknown })?.fovDeg;
    const weight = (entry as { weight?: unknown })?.weight;
    if (
      typeof fovDeg === 'number' &&
      Number.isFinite(fovDeg) &&
      fovDeg >= 25 &&
      fovDeg <= 100 &&
      typeof weight === 'number' &&
      Number.isFinite(weight) &&
      weight > 0 &&
      weight <= 1
    ) {
      samples.push({ fovDeg, weight });
    }
  }
  return samples.slice(-8);
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(settings);
}
