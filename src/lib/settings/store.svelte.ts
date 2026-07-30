import { parseSettings, serializeSettings, type Settings } from './index';

/**
 * Réglages réactifs partagés ($state de module Svelte 5), persistés en
 * localStorage. Muter `settings.…` puis appeler `saveSettings()`.
 */

const STORAGE_KEY = 'cimes:reglages';

function readStored(): Settings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseSettings(null);
  }
}

export const settings: Settings = $state(readStored());

export function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeSettings(settings));
  } catch {
    // Stockage indisponible (navigation privée…) : réglages de session seulement.
  }
}
