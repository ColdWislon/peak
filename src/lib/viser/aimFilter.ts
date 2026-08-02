import { degToRad, normalizeBearing } from '../geo';
import { iosCompassToAlpha, orientationToAim, type AimAngles } from './orientation';

/**
 * Stabilisation de la visée (filtre complémentaire du mode Viser).
 *
 * Téléphone à la verticale — précisément la pose du viseur — le cap boussole
 * iOS (`webkitCompassHeading`, azimut du HAUT de l'appareil) est mal
 * conditionné : le haut pointe le zénith, sa projection horizontale n'est plus
 * que du bruit, et le cap reconstruit en le substituant à α tremblait de
 * plusieurs degrés. Les angles gyroscopiques (α relatif, β, γ), eux, restent
 * doux dans cette pose ; seul leur nord est arbitraire (et dérive lentement).
 *
 * D'où le partage des rôles : le gyroscope fournit la dynamique image par
 * image, la boussole ne sert qu'à apprendre lentement le DÉCALAGE vers le nord
 * vrai, et seulement quand la pose la rend fiable — poids cos β : 1 à plat,
 * 0 à la verticale, nul aussi au-delà (l'azimut du haut s'y retourne de 180°).
 * Android absolu (pas de boussole séparée) : décalage nul, seul le lissage de
 * sortie s'applique. Module pur, testé.
 */

export interface OrientationSample {
  alphaDeg: number;
  betaDeg: number;
  gammaDeg: number;
  /** `webkitCompassHeading` iOS (cap horaire du haut de l'appareil), sinon null. */
  compassDeg: number | null;
  /** Horodatage de l'événement (ms, base quelconque mais croissante). */
  timeMs: number;
}

/** Écart angulaire signé par l'arc le plus court, en ° dans [−180, 180). */
function shortestArcDeg(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/** Convergence du décalage boussole à plat (s) — ralentie de 1/cos β ensuite. */
const OFFSET_TAU_S = 3;
/** Poids en deçà duquel la boussole est ignorée (pose quasi verticale). */
const OFFSET_MIN_WEIGHT = 0.05;
/** Lissage de sortie (s) : gomme le tremblement sans traîner sur un vrai pan. */
const OUTPUT_TAU_S = 0.1;
/** Au-delà de cet écart (°), sauter directement (initialisation, à-coup vrai). */
const SNAP_DEG = 45;
/** Un trou d'événements ne doit pas produire un gain géant d'un seul coup. */
const MAX_DT_S = 0.25;

export class AimFilter {
  private offsetDeg: number | null = null;
  private weight = 0;
  private out: AimAngles | null = null;
  private lastMs: number | null = null;

  /** Décalage boussole appris (°), null tant qu'aucune boussole n'a été vue. */
  get compassOffsetDeg(): number | null {
    return this.offsetDeg;
  }

  /** Dernier poids accordé à la boussole (0 = pose verticale, 1 = à plat). */
  get compassWeight(): number {
    return this.weight;
  }

  /** Intègre un événement capteur et rend la visée stabilisée. */
  update(sample: OrientationSample): AimAngles {
    const rel = orientationToAim(sample.alphaDeg, sample.betaDeg, sample.gammaDeg);
    const dtS =
      this.lastMs === null
        ? 0
        : Math.min(MAX_DT_S, Math.max(0, (sample.timeMs - this.lastMs) / 1000));
    this.lastMs = sample.timeMs;

    if (sample.compassDeg !== null) {
      const abs = orientationToAim(
        iosCompassToAlpha(sample.compassDeg),
        sample.betaDeg,
        sample.gammaDeg,
      );
      const target = shortestArcDeg(rel.headingDeg, abs.headingDeg);
      this.weight = Math.max(0, Math.cos(degToRad(sample.betaDeg)));
      if (this.offsetDeg === null) {
        // Première boussole : mieux vaut un nord approximatif tout de suite,
        // affiné dès que la pose s'y prête.
        this.offsetDeg = target;
      } else if (this.weight >= OFFSET_MIN_WEIGHT) {
        const k = 1 - Math.exp(-(dtS * this.weight) / OFFSET_TAU_S);
        this.offsetDeg = shortestArcDeg(
          0,
          this.offsetDeg + k * shortestArcDeg(this.offsetDeg, target),
        );
      }
    }

    const heading = normalizeBearing(rel.headingDeg + (this.offsetDeg ?? 0));
    const pitch = rel.pitchDeg;

    if (this.out === null) {
      this.out = { headingDeg: heading, pitchDeg: pitch };
    } else {
      const dh = shortestArcDeg(this.out.headingDeg, heading);
      const dp = pitch - this.out.pitchDeg;
      if (Math.abs(dh) > SNAP_DEG || Math.abs(dp) > SNAP_DEG) {
        this.out = { headingDeg: heading, pitchDeg: pitch };
      } else {
        const k = 1 - Math.exp(-dtS / OUTPUT_TAU_S);
        this.out = {
          headingDeg: normalizeBearing(this.out.headingDeg + k * dh),
          pitchDeg: this.out.pitchDeg + k * dp,
        };
      }
    }
    return { ...this.out };
  }
}
