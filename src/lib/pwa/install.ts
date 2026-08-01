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
