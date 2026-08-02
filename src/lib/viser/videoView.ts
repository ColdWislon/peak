import { degToRad, radToDeg } from '../geo';

/**
 * Géométrie de la vue caméra (mode Viser) : le flux vidéo est affiché en
 * `object-fit: cover`, donc seule une découpe centrée du cadre est visible.
 * Un zoom numérique (`scale()` CSS sur la vidéo) rétrécit encore cette découpe
 * du même facteur, toujours centrée. Toutes les projections (étiquettes,
 * horizon, calibrage) raisonnent sur cette découpe visible ; le réglage
 * persisté est le FOV du petit côté du capteur, seul invariant quand l'écran
 * ou le flux tourne. Module pur, testé.
 */

/** Rectangle source (px vidéo) du flux réellement visible dans la vue. */
export interface CoverCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Découpe centrée produite par `object-fit: cover` puis le zoom numérique. */
export function coverCrop(
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  zoom = 1,
): CoverCrop {
  const z = Math.max(1, zoom);
  const scale = z * Math.max(viewW / Math.max(1, videoW), viewH / Math.max(1, videoH));
  const sw = Math.min(videoW, viewW / Math.max(1e-9, scale));
  const sh = Math.min(videoH, viewH / Math.max(1e-9, scale));
  return { sx: (videoW - sw) / 2, sy: (videoH - sh) / 2, sw, sh };
}

/**
 * FOV vertical (°) de la vue visible, depuis le FOV du petit côté du capteur.
 * En portrait la découpe garde toute la hauteur du cadre ; en paysage elle n'en
 * garde qu'une bande centrale — le FOV d'écran est alors bien plus étroit.
 * Le zoom numérique resserre la découpe, donc le FOV, en espace tangente
 * (modèle sténopé : zoomer multiplie la focale).
 */
export function screenFovDeg(
  shortSideFovDeg: number,
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  zoom = 1,
): number {
  const short = Math.max(1, Math.min(videoW, videoH));
  const tanPerPx = Math.tan(degToRad(shortSideFovDeg) / 2) / (short / 2);
  const { sh } = coverCrop(videoW, videoH, viewW, viewH, zoom);
  return radToDeg(2 * Math.atan(tanPerPx * (sh / 2)));
}

/** Inverse : FOV du petit côté du capteur depuis un FOV vertical de vue mesuré. */
export function shortSideFovDeg(
  screenFovDeg: number,
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
  zoom = 1,
): number {
  const short = Math.min(videoW, videoH);
  const { sh } = coverCrop(videoW, videoH, viewW, viewH, zoom);
  const tanPerPx = Math.tan(degToRad(screenFovDeg) / 2) / Math.max(1e-9, sh / 2);
  return radToDeg(2 * Math.atan(tanPerPx * (short / 2)));
}
