/**
 * Détection iOS / mode standalone pour l'aide à l'installation de la PWA.
 * Module pur : les valeurs du navigateur sont passées en paramètres (testable).
 */

/** Vrai sur iPhone, iPod ou iPad — y compris iPadOS 13+ qui se présente comme macOS. */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPod|iPad/.test(userAgent)) return true;
  // iPadOS 13+ envoie un user agent macOS ; le multi-touch le trahit.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** Vrai si l'app tourne déjà installée (lancée en plein écran depuis l'écran d'accueil). */
export function isStandalone(
  displayModeStandalone: boolean,
  navigatorStandalone: boolean | undefined,
): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}

/** Vrai sur un appareil Android (téléphone ou tablette). */
export function isAndroidDevice(userAgent: string): boolean {
  return /Android/.test(userAgent);
}

/**
 * Ce que le tiroir de réglages propose pour installer l'app :
 * - `prompt` : le navigateur a offert son invite d'installation (Chrome,
 *   Edge, Samsung Internet…) — un vrai bouton la déclenche ;
 * - `android` : Android sans invite offerte (Firefox, ou invite pas encore
 *   émise) — on explique le menu ⋮ ;
 * - `ios` : Safari n'a pas d'invite du tout — on explique « Partager » ;
 * - `null` : app déjà installée, ou rien d'utile à dire (bureau).
 */
export type InstallOffer = 'prompt' | 'android' | 'ios' | null;

export function installOffer(state: {
  /** App déjà lancée depuis l'écran d'accueil (ou installée à l'instant). */
  installed: boolean;
  ios: boolean;
  android: boolean;
  /** Un `beforeinstallprompt` a été capté et n'a pas encore été consommé. */
  promptReady: boolean;
}): InstallOffer {
  if (state.installed) return null;
  if (state.promptReady) return 'prompt';
  if (state.ios) return 'ios';
  if (state.android) return 'android';
  return null;
}
