import { fr } from '../i18n/fr';
import type { ViewpointSource } from '../viewpoint/url';

/**
 * Capture de la vue caméra pour le débogage (mode Viser). Le rapport JSON dit
 * ce que l'app CROIT viser ; cette capture montre ce que la caméra voit
 * VRAIMENT, avec les repères calculés (horizon du relief, étiquettes) dessinés
 * dessus et l'état de visée gravé en bas de l'image. L'utilisateur partage
 * l'image ou la télécharge, puis la joint à la conversation — c'est le seul
 * accès de Claude à la caméra, un fichier remis à la main : aucune image ne
 * quitte l'appareil sans ce geste, et aucun backend n'est en jeu.
 *
 * Le composant Viser enregistre la SOURCE (il seul sait dessiner la vue) ;
 * l'interface (bouton du mode Viser, réglages ⚙) ne connaît que ce module.
 */

/** Image capturée, prête à partager ou télécharger. */
export interface DebugSnapshot {
  blob: Blob;
  /** Nom de fichier proposé, horodaté. */
  name: string;
  width: number;
  height: number;
  /** État de la visée au déclenchement (aussi gravé dans l'image). */
  meta: Record<string, unknown>;
}

/** Rend la vue courante ; rejette si la caméra n'est pas exploitable. */
export type SnapshotSource = () => Promise<DebugSnapshot>;

/** Côté long maximal de l'image produite (px) : lisible, mais léger à joindre. */
export const SNAPSHOT_MAX_EDGE = 1280;

let source: SnapshotSource | null = null;

/** Enregistre la source de capture ; retourne la désinscription (démontage). */
export function registerSnapshotSource(next: SnapshotSource): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

/** Vrai quand une vue caméra est disponible (mode Viser démarré). */
export function hasSnapshotSource(): boolean {
  return source !== null;
}

/** Déclenche la capture ; rejette si aucune vue n'est disponible. */
export function captureDebugSnapshot(): Promise<DebugSnapshot> {
  if (!source) return Promise.reject(new Error('aucune vue caméra à capturer'));
  return source();
}

/** Réservé aux tests : oublie la source enregistrée. */
export function resetSnapshotForTests(): void {
  source = null;
}

/**
 * Taille de l'image capturée : mêmes proportions que la vue, côté long borné
 * (jamais agrandie — une vue minuscule reste minuscule).
 */
export function fitSnapshot(
  viewWidth: number,
  viewHeight: number,
  maxEdge: number = SNAPSHOT_MAX_EDGE,
): { width: number; height: number } {
  const w = Number.isFinite(viewWidth) ? Math.floor(viewWidth) : 0;
  const h = Number.isFinite(viewHeight) ? Math.floor(viewHeight) : 0;
  if (w < 1 || h < 1) return { width: 1, height: 1 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Nom de fichier horodaté (heure locale) : `cimes-vue-20260830-101233.jpg`. */
export function snapshotFileName(date: Date): string {
  const p = (n: number, size = 2): string => String(n).padStart(size, '0');
  const stamp =
    `${p(date.getFullYear(), 4)}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `cimes-vue-${stamp}.jpg`;
}

/** Statut du chargement des sommets, tel que l'affiche le mode Viser. */
export type PeaksStatus = 'idle' | 'searching' | 'error' | 'empty' | 'noneVisible' | 'ok';

/** Verdict du dernier recalage automatique tenté dans cette session de visée. */
export interface SnapshotCalibration {
  /** Vrai si la correction a été appliquée (alignement jugé fiable). */
  applied: boolean;
  /** null quand le matcher n'a rien rendu (trop peu de colonnes exploitables). */
  maeDeg: number | null;
  /** Part de colonnes concordantes (0..1), null sans résultat. */
  inlierRatio: number | null;
  /** FOV vertical de vue du recalage appliqué (°), null sans résultat. */
  fovDeg: number | null;
  /** Vrai si l'optique mesurée a été adoptée (sinon le FOV en cours a servi). */
  fovAdopted: boolean;
  /** Optique mesurée par le matcher (° de vue), même écartée ; null sans résultat. */
  fovEstimateDeg: number | null;
  /**
   * FOV petit côté du capteur retenu quand l'optique a été adoptée (°). C'est
   * LUI qu'il faut lire : le « FOV vue » du recalage vaut pour la géométrie de
   * l'instant (une rotation d'écran change la découpe, donc ce chiffre), alors
   * que le petit côté du capteur, lui, ne bouge pas.
   */
  shortFovDeg: number | null;
  /** Vrai si cette mesure butait sur une borne de recherche (valeur non mesurée). */
  fovAtBound: boolean;
}

/** État de visée décrit par la capture (gravé dans l'image et journalisé). */
export interface SnapshotAim {
  /** Horodatage de la capture. */
  time: Date;
  /** Point de vue utilisé pour tous les calculs (pas forcément le GPS). */
  viewpoint: { lat: number; lon: number };
  /** D'où il vient : un horizon faux commence souvent par un point de vue faux. */
  viewpointSource: ViewpointSource;
  /** Altitude de l'œil (m) tirée du relief au point de vue. */
  eyeElevationM: number;
  headingDeg: number;
  pitchDeg: number;
  headingOffsetDeg: number;
  pitchOffsetDeg: number;
  /** FOV vertical de la vue (°), découpe `cover` et zoom compris. */
  screenFovDeg: number;
  /** FOV du petit côté du capteur (°) : réglage persisté. */
  shortFovDeg: number;
  /** Vrai si ce FOV vient d'un calibrage, faux s'il reste la valeur par défaut. */
  fovCalibrated: boolean;
  zoom: number;
  /** Définition du flux caméra (px) : décide si le petit côté est du 4:3 ou du 16:9. */
  stream: { w: number; h: number };
  /** Dernier recalage automatique tenté, null si aucun depuis le démarrage. */
  calibration: SnapshotCalibration | null;
  /** Faux quand les capteurs manquent (visée au doigt). */
  sensors: boolean;
  /** Vrai quand l'horizon du relief est tracé sur l'image. */
  horizon: boolean;
  peaksStatus: PeaksStatus;
  /** Sommets chargés (Overpass), visibles (ligne de vue), et posés dans le champ. */
  peaksLoaded: number;
  peaksVisible: number;
  labels: number;
}

/** Motif ajouté à la ligne « sommets » quand le compte n'est pas nominal. */
const VIEWPOINT_SOURCE_FR: Record<ViewpointSource, string> = {
  defaut: 'défaut',
  url: 'lien',
  gps: 'GPS',
  recherche: 'recherche',
  carte: 'carte',
};

const PEAKS_STATUS_FR: Record<PeaksStatus, string | null> = {
  idle: 'non demandés',
  searching: 'chargement en cours',
  error: 'Overpass indisponible',
  empty: 'aucun sommet nommé dans le rayon',
  noneVisible: 'tous masqués par le relief',
  ok: null,
};

function num(value: number, digits = 0): string {
  return value.toFixed(digits).replace('.', ',');
}

/**
 * Légende gravée dans l'image (une ligne par entrée) : la capture reste
 * interprétable seule, même détachée du rapport JSON.
 */
export function snapshotCaption(aim: SnapshotAim): string[] {
  const sign = (value: number): string => `${value >= 0 ? '+' : '−'}${num(Math.abs(value), 1)}°`;
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${p(aim.time.getDate())}/${p(aim.time.getMonth() + 1)} ${p(
    aim.time.getHours(),
  )}:${p(aim.time.getMinutes())}`;
  return [
    `Cimes · ${stamp} · point de vue ${aim.viewpoint.lat.toFixed(4)}, ` +
      `${aim.viewpoint.lon.toFixed(4)} (${VIEWPOINT_SOURCE_FR[aim.viewpointSource]})` +
      ` · œil ${Math.round(aim.eyeElevationM)} m`,
    `cap ${num(aim.headingDeg)}° · assiette ${sign(aim.pitchDeg)}` +
      ` · recalage ${sign(aim.headingOffsetDeg)} / ${sign(aim.pitchOffsetDeg)}`,
    `FOV vue ${num(aim.screenFovDeg, 1)}° · capteur ${num(aim.shortFovDeg, 1)}°` +
      ` ${aim.fovCalibrated ? '(étalonné)' : '(défaut)'} · zoom ${num(aim.zoom, 1)}×` +
      ` · flux ${aim.stream.w}×${aim.stream.h}`,
    calibrationLine(aim.calibration),
    `${aim.sensors ? 'capteurs actifs' : 'sans capteurs'} · ` +
      `${aim.horizon ? 'horizon tracé' : 'horizon non calculé'} · ` +
      // Trois nombres distincts : sans eux, « 0 étiquette » ne dit pas si les
      // sommets manquent, sont masqués par le relief, ou sont hors du champ.
      `sommets : ${aim.peaksLoaded} chargés, ${aim.peaksVisible} en vue, ` +
      `${aim.labels} dans le champ` +
      (PEAKS_STATUS_FR[aim.peaksStatus] ? ` (${PEAKS_STATUS_FR[aim.peaksStatus]})` : ''),
  ];
}

/** Verdict du dernier recalage, en clair : dit s'il a mordu et sur quoi. */
function calibrationLine(calibration: SnapshotCalibration | null): string {
  if (!calibration) return 'dernier recalage : aucun depuis le démarrage';
  if (calibration.maeDeg === null || calibration.inlierRatio === null) {
    return 'dernier recalage : refusé, horizon non détecté dans l’image';
  }
  const tete =
    `dernier recalage : ${calibration.applied ? 'appliqué' : 'refusé'}` +
    ` · MAE ${num(calibration.maeDeg, 2)}° · ${Math.round(calibration.inlierRatio * 100)} %` +
    ' concordantes · ';
  // Optique adoptée : on annonce le capteur (invariant), pas le FOV de vue de
  // l'instant — l'écran a pu tourner depuis, et les deux chiffres divergent.
  if (calibration.fovAdopted) {
    return `${tete}optique adoptée : capteur ${num(calibration.shortFovDeg ?? 0, 1)}°`;
  }
  const optique =
    calibration.fovEstimateDeg === null
      ? 'optique inchangée'
      : `mesure ${num(calibration.fovEstimateDeg, 1)}° écartée` +
        `${calibration.fovAtBound ? ', en butée' : ''}`;
  return `${tete}FOV vue ${num(calibration.fovDeg ?? 0, 1)}° (${optique})`;
}

/** Issue de la remise du fichier à l'utilisateur. */
export type SnapshotDelivery = 'partage' | 'telechargement' | 'annule';

/** Deux façons de remettre le fichier ; injectables pour les tests. */
export interface DeliveryEnv {
  /** Feuille de partage native ; `false` = indisponible → repli téléchargement. */
  shareFile: (snapshot: DebugSnapshot) => Promise<boolean>;
  /** Repli toujours possible : enregistrement du fichier. */
  saveFile: (snapshot: DebugSnapshot) => void;
}

/**
 * Remet l'image : partage natif (feuille iOS — « Enregistrer dans Photos »,
 * Messages…) quand il existe, sinon téléchargement. Un partage ANNULÉ n'est
 * pas un échec : pas de téléchargement surprise derrière le dos de l'utilisateur.
 */
export async function deliverSnapshot(
  snapshot: DebugSnapshot,
  env: DeliveryEnv = browserDelivery(),
): Promise<SnapshotDelivery> {
  try {
    if (await env.shareFile(snapshot)) return 'partage';
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return 'annule';
    // Partage cassé (permissions, contexte non sécurisé…) : on télécharge.
  }
  env.saveFile(snapshot);
  return 'telechargement';
}

/** Implémentation navigateur de la remise (partage natif, sinon lien `download`). */
export function browserDelivery(): DeliveryEnv {
  return {
    shareFile: async (snapshot) => {
      if (typeof navigator === 'undefined' || typeof File === 'undefined') return false;
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
      const file = new File([snapshot.blob], snapshot.name, {
        type: snapshot.blob.type || 'image/jpeg',
      });
      const data: ShareData = {
        files: [file],
        title: fr.viser.captureShareTitle,
        text: fr.viser.captureShareText,
      };
      if (!nav.canShare(data)) return false;
      await nav.share(data);
      return true;
    },
    saveFile: (snapshot) => {
      const url = URL.createObjectURL(snapshot.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = snapshot.name;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Révocation différée : Safari lit l'URL après le clic.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

/** Gabarit du bandeau de légende, ajouté SOUS la photo (rien n'est masqué). */
export interface CaptionLayout {
  font: number;
  lineHeight: number;
  padding: number;
  /** Hauteur totale du bandeau (px). */
  height: number;
}

/** Typographie du bandeau : lisible sur petite image, sobre sur grande. */
export function captionLayout(width: number, lineCount: number): CaptionLayout {
  const font = Math.max(12, Math.min(26, Math.round(width / 48)));
  const padding = Math.round(font * 0.6);
  const lineHeight = Math.round(font * 1.45);
  return { font, lineHeight, padding, height: lineCount * lineHeight + padding * 2 };
}

/** Encode un canvas en blob (JPEG par défaut) ; rejette si l'encodage échoue. */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/jpeg',
  quality = 0.82,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encodage image impossible'))),
      type,
      quality,
    );
  });
}
