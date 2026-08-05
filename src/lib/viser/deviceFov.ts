import { degToRad, radToDeg } from '../geo';

/**
 * A priori de FOV caméra déduit de l'appareil (mode Viser). Le web n'expose
 * pas l'optique : on part d'une focale « équivalent 35 mm » par famille
 * d'appareil, et de la géométrie du flux réellement livré. Deux faits :
 *
 * 1. Le NOM du téléphone n'est accessible que sur Android/Chromium
 *    (`navigator.userAgentData` → `model`) ; Safari iOS dit seulement
 *    « iPhone » — mais les caméras principales (1×) d'Apple sont assez
 *    homogènes (~26 mm équivalent depuis 2019) pour un a priori de famille.
 * 2. L'ASPECT du flux pèse plus que la marque : un capteur 4:3 livré recadré
 *    en 16:9 perd ~12° de FOV vertical — bien plus que les ~2° d'écart entre
 *    familles. L'a priori tient compte des deux.
 *
 * Ce n'est qu'un point de départ : le calibrage sur l'horizon mesure le FOV
 * réel et, une fois persisté, l'emporte toujours. Module pur, testé.
 */

/** Demi-diagonale du format 35 mm (mm) : 43,27 / 2. */
const HALF_DIAGONAL_35MM = 21.633;

/** Familles reconnues → focale équivalente 35 mm de la caméra principale.
 *  Sources : fiches constructeurs ; valeurs volontairement rondes (a priori). */
const DEVICE_FOCALS: Array<{ pattern: RegExp; equivFocalMm: number; family: string }> = [
  // Pixel 6 à 9 : capteur principal ~82° de diagonale (≈ 25 mm).
  { pattern: /pixel [6-9]/i, equivFocalMm: 25, family: 'Pixel récent' },
  // Pixels plus anciens : ~76-77° de diagonale (≈ 27 mm).
  { pattern: /pixel \d/i, equivFocalMm: 27, family: 'Pixel' },
  // Galaxy S22/S23/S24 (SM-S90x/91x/92x…) : 23 mm équivalent.
  { pattern: /sm-s9\d\d/i, equivFocalMm: 23, family: 'Galaxy S récent' },
  // Galaxy S21 (SM-G99x) : 26 mm équivalent.
  { pattern: /sm-g99\d/i, equivFocalMm: 26, family: 'Galaxy S21' },
];

/** L'iPhone ne se déduit que du user-agent (pas de Client Hints sur Safari) :
 *  toutes les caméras principales récentes tournent autour de 26 mm. */
const IPHONE_EQUIV_FOCAL_MM = 26;

export interface DeviceFovInput {
  /** Modèle Client Hints (`userAgentData` → high entropy `model`), sinon null. */
  model: string | null;
  /** `navigator.userAgent` (repère iPhone/iPad, seul indice disponible sur iOS). */
  userAgent: string;
  /** Dimensions du flux vidéo livré (px). */
  videoW: number;
  videoH: number;
  /** FOV petit côté (°) qu'aurait un flux 4:3 sur un appareil inconnu. */
  fallbackShortFovDeg: number;
}

/** Focale équivalente 35 mm déduite de l'appareil, ou null si inconnu. */
export function deviceEquivFocalMm(
  model: string | null,
  userAgent: string,
): { equivFocalMm: number; family: string } | null {
  if (model) {
    for (const entry of DEVICE_FOCALS) {
      if (entry.pattern.test(model)) {
        return { equivFocalMm: entry.equivFocalMm, family: entry.family };
      }
    }
  }
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return { equivFocalMm: IPHONE_EQUIV_FOCAL_MM, family: 'iPhone' };
  }
  return null;
}

/**
 * FOV petit côté (°) du flux livré, pour un capteur 4:3 dont la tangente du
 * demi-FOV vertical est `tanV43`. Un flux plus allongé que 4:3 (16:9…) est un
 * recadrage vertical : même largeur, hauteur rognée ; plus carré que 4:3, un
 * recadrage horizontal : le petit côté garde tout le capteur.
 */
function shortFovFromSensor(tanV43: number, videoW: number, videoH: number): number {
  const long = Math.max(videoW, videoH);
  const short = Math.max(1, Math.min(videoW, videoH));
  const aspect = long / short;
  const tanH43 = tanV43 / 0.75;
  return radToDeg(2 * Math.atan(Math.min(tanV43, tanH43 / aspect)));
}

/** FOV petit côté (°) pour une focale équivalente 35 mm et un flux donné. */
export function shortFovFromEquivFocal(
  equivFocalMm: number,
  videoW: number,
  videoH: number,
): number {
  // Équivalence prise sur la diagonale ; capteur photo 4:3 (0,6 / 0,8 / 1).
  const tanV43 = (0.6 * HALF_DIAGONAL_35MM) / equivFocalMm;
  return shortFovFromSensor(tanV43, videoW, videoH);
}

export interface FovPrior {
  shortFovDeg: number;
  /** D'où vient l'a priori (rapport de débogage). */
  source: string;
}

/**
 * A priori de FOV petit côté pour l'appareil et le flux courants. Famille
 * reconnue : focale équivalente + aspect. Appareil inconnu : le FOV par défaut
 * (défini pour un flux 4:3) est au moins corrigé de l'aspect livré.
 */
export function priorShortFovDeg(input: DeviceFovInput): FovPrior {
  const device = deviceEquivFocalMm(input.model, input.userAgent);
  if (device) {
    return {
      shortFovDeg: shortFovFromEquivFocal(device.equivFocalMm, input.videoW, input.videoH),
      source: `${device.family} (${device.equivFocalMm} mm éq.)`,
    };
  }
  return {
    shortFovDeg: shortFovFromSensor(
      Math.tan(degToRad(input.fallbackShortFovDeg) / 2),
      input.videoW,
      input.videoH,
    ),
    source: 'défaut ajusté à l’aspect',
  };
}
