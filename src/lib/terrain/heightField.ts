import type { LatLon } from '../geo';
import { latToTileY, lonToTileX, TILE_SIZE } from './tiles';

/**
 * Grille d'altitudes échantillonnable. Les coordonnées d'échantillonnage sont
 * en « espace indice » : (0, 0) est le centre du pixel nord-ouest.
 */
export class HeightField {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly data: Float32Array,
  ) {
    if (data.length !== width * height) {
      throw new RangeError(`Tampon de ${data.length} valeurs pour une grille ${width}×${height}`);
    }
  }

  /** Altitude du pixel (ix, iy), bords étirés (clamp). */
  at(ix: number, iy: number): number {
    const x = Math.max(0, Math.min(this.width - 1, ix));
    const y = Math.max(0, Math.min(this.height - 1, iy));
    return this.data[y * this.width + x]!;
  }

  /** Altitude interpolée bilinéairement au point (fx, fy) de l'espace indice. */
  sampleBilinear(fx: number, fy: number): number {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;

    const v00 = this.at(x0, y0);
    const v10 = this.at(x0 + 1, y0);
    const v01 = this.at(x0, y0 + 1);
    const v11 = this.at(x0 + 1, y0 + 1);

    const top = v00 + (v10 - v00) * tx;
    const bottom = v01 + (v11 - v01) * tx;
    return top + (bottom - top) * ty;
  }
}

/**
 * Champ d'altitudes géoréférencé : un HeightField couvrant un bloc rectangulaire
 * de tuiles XYZ contiguës, échantillonnable directement en lat/lon.
 */
export class GeoHeightField {
  constructor(
    readonly zoom: number,
    /** Colonne de la tuile nord-ouest du bloc. */
    readonly originTileX: number,
    /** Ligne de la tuile nord-ouest du bloc. */
    readonly originTileY: number,
    readonly field: HeightField,
  ) {}

  /** Nombre de tuiles couvertes en largeur/hauteur. */
  get tilesX(): number {
    return this.field.width / TILE_SIZE;
  }

  get tilesY(): number {
    return this.field.height / TILE_SIZE;
  }

  /** Position (continue) dans l'espace pixel global du zoom, relative au bloc. */
  private toLocalPixel(p: LatLon): { px: number; py: number } {
    const px = (lonToTileX(p.lon, this.zoom) - this.originTileX) * TILE_SIZE;
    const py = (latToTileY(p.lat, this.zoom) - this.originTileY) * TILE_SIZE;
    return { px, py };
  }

  /** Vrai si le point tombe dans l'emprise du bloc. */
  contains(p: LatLon): boolean {
    const { px, py } = this.toLocalPixel(p);
    return px >= 0 && py >= 0 && px <= this.field.width && py <= this.field.height;
  }

  /**
   * Altitude (m) au point demandé, interpolation bilinéaire entre centres de
   * pixels (le décalage de 0,5 convertit l'espace pixel en espace indice).
   */
  elevationAt(p: LatLon): number {
    const { px, py } = this.toLocalPixel(p);
    return this.field.sampleBilinear(px - 0.5, py - 0.5);
  }
}
