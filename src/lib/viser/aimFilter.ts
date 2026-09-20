import { degToRad, normalizeBearing, radToDeg, signedDeltaDeg } from '../geo';
import { orientationToAim, type AimAngles } from './orientation';

/**
 * Stabilisation de la visée (filtre complémentaire du mode Viser).
 *
 * Téléphone dressé — précisément la pose du viseur — le cap boussole iOS
 * (`webkitCompassHeading`, azimut du HAUT de l'appareil) est mal conditionné :
 * le haut pointe le zénith, sa projection horizontale n'est plus que du bruit,
 * et le cap reconstruit en le substituant à α tremblait de plusieurs degrés.
 * Les angles gyroscopiques (α relatif, β, γ), eux, restent doux dans cette
 * pose ; seul leur nord est arbitraire (et dérive lentement).
 *
 * D'où le partage des rôles : le gyroscope fournit la dynamique image par
 * image, la boussole ne sert qu'à apprendre le DÉCALAGE vers le nord vrai.
 * Ce décalage n'est pas retenu d'un seul événement mais d'une MOYENNE
 * CIRCULAIRE pondérée à mémoire glissante : chaque cap boussole y entre avec
 * le poids de son conditionnement (|cos β| : 1 à plat, 0 à la verticale) et la
 * mémoire s'allonge d'autant que la pose est mauvaise (3 s à plat, jusqu'à
 * 30 s à la verticale). Une lecture aberrante ne peut donc plus se graver, et
 * une séance passée entièrement à la verticale finit quand même par trouver le
 * nord en moyennant le bruit au lieu de geler la toute première valeur — la
 * plus douteuse de toutes. Android absolu (pas de boussole séparée) : décalage
 * nul, seul le lissage de sortie s'applique. Module pur, testé.
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

/** Mémoire du décalage boussole à plat (s) : convergence en ~3 s. */
const OFFSET_TAU_S = 3;
/** Mémoire maximale (s) : pose mal conditionnée, on moyenne sur bien plus long. */
const MAX_MEMORY_S = 30;
/**
 * Poids plancher d'une boussole mal conditionnée, tant qu'aucune pose fiable
 * n'a été vue. Le viseur se tient dressé : sans ce plancher, le nord du tout
 * premier événement — le moins fiable de la séance — ne bougerait plus jamais.
 */
const BOOTSTRAP_WEIGHT = 0.05;
/** Masse de poses fiables au-delà de laquelle le nord est tenu pour acquis. */
const TRUSTED_MASS = 1;
/** Lissage de sortie (s) : gomme le tremblement sans traîner sur un vrai pan. */
const OUTPUT_TAU_S = 0.1;
/** Au-delà de cet écart (°), sauter directement (initialisation, à-coup vrai). */
const SNAP_DEG = 45;
/** Un trou d'événements ne doit pas produire un gain géant d'un seul coup. */
const MAX_DT_S = 0.25;

/**
 * Décalage (°) à ajouter au cap gyroscopique pour retomber sur le nord vrai,
 * d'après un cap boussole iOS.
 *
 * Le haut de l'appareil (+Y) pointe, dans le monde, (−sinα·cosβ, cosα·cosβ,
 * sinβ) : son azimut vaut −α tant que cos β > 0, et 180° − α au-delà — passé
 * la verticale le haut bascule derrière l'appareil et sa projection
 * horizontale se retourne. Le cap visé valant −α + f(β, γ), le décalage
 * cherché est α + H, retourné de 180° dans la seconde pose. Négliger ce
 * retournement rendait la boussole exactement fausse de 180° dès que la
 * première lecture tombait pendant une visée au-dessus de l'horizon (β > 90°
 * en portrait : la pose la plus banale en montagne).
 */
function compassOffsetTargetDeg(alphaDeg: number, betaDeg: number, compassDeg: number): number {
  const flipped = Math.cos(degToRad(betaDeg)) < 0;
  return normalizeBearing(alphaDeg + compassDeg + (flipped ? 180 : 0));
}

export class AimFilter {
  /** Somme vectorielle amortie des caps boussole (repère du décalage). */
  private sumX = 0;
  private sumY = 0;
  /** Masse de cette somme : poids cumulé, même amortissement. */
  private mass = 0;
  /** Masse des seules poses bien conditionnées (sans poids plancher). */
  private trustedMass = 0;
  private weight = 0;
  private out: AimAngles | null = null;
  private lastMs: number | null = null;

  /** Décalage boussole appris (°), null tant qu'aucune boussole n'a été vue. */
  get compassOffsetDeg(): number | null {
    if (this.mass === 0) return null;
    return signedDeltaDeg(radToDeg(Math.atan2(this.sumY, this.sumX)));
  }

  /** Dernier poids accordé à la boussole (0 = pose verticale, 1 = à plat). */
  get compassWeight(): number {
    return this.weight;
  }

  /**
   * Accord des lectures boussole retenues, de 0 (elles se contredisent — nord
   * peu sûr) à 1 (elles pointent toutes le même azimut). Diagnostic : une
   * boussole perturbée par du métal se trahit ici.
   */
  get compassCoherence(): number {
    return this.mass === 0 ? 0 : Math.hypot(this.sumX, this.sumY) / this.mass;
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
      this.learnNorth(sample.alphaDeg, sample.betaDeg, sample.compassDeg, dtS);
    }

    const heading = normalizeBearing(rel.headingDeg + (this.compassOffsetDeg ?? 0));
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

  /** Verse un cap boussole dans la moyenne circulaire du décalage au nord. */
  private learnNorth(alphaDeg: number, betaDeg: number, compassDeg: number, dtS: number): void {
    // Conditionnement : la boussole donne l'azimut d'un axe dont la composante
    // horizontale vaut |cos β| — nulle à la verticale, où la moindre erreur
    // magnétique fait tourner la valeur de dizaines de degrés.
    const weight = Math.abs(Math.cos(degToRad(betaDeg)));
    this.weight = weight;
    // Nord pas encore acquis : même mal conditionnée, la boussole vaut mieux
    // que rien — elle entre au poids plancher, son bruit se moyenne.
    const effective =
      this.trustedMass >= TRUSTED_MASS ? weight : Math.max(weight, BOOTSTRAP_WEIGHT);
    const memoryS = Math.min(MAX_MEMORY_S, OFFSET_TAU_S / Math.max(effective, 1e-6));
    const decay = Math.exp(-dtS / memoryS);
    const target = degToRad(compassOffsetTargetDeg(alphaDeg, betaDeg, compassDeg));
    this.sumX = this.sumX * decay + effective * Math.cos(target);
    this.sumY = this.sumY * decay + effective * Math.sin(target);
    this.mass = this.mass * decay + effective;
    this.trustedMass = this.trustedMass * decay + weight;
  }
}
