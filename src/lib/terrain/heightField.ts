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

  /** Altitude maximale de la grille (m) — borne utile pour couper les marches de rayon. */
  max(): number {
    let best = -Infinity;
    const data = this.data;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      if (v > best) best = v;
    }
    return best;
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

  /**
   * Position (continue) dans l'espace pixel du bloc : (0, 0) est le coin
   * nord-ouest, (width, height) le coin sud-est. Publique pour que les
   * échantillonneurs projettent UNE fois puis testent et lisent en espace pixel
   * (`containsPixel`, `elevationAtPixel`) — la projection WebMercator est la
   * part chère de chaque échantillon.
   */
  localPixel(p: LatLon): { px: number; py: number } {
    const px = (lonToTileX(p.lon, this.zoom) - this.originTileX) * TILE_SIZE;
    const py = (latToTileY(p.lat, this.zoom) - this.originTileY) * TILE_SIZE;
    return { px, py };
  }

  /** Vrai si la position pixel tombe dans l'emprise du bloc. */
  containsPixel(px: number, py: number): boolean {
    return px >= 0 && py >= 0 && px <= this.field.width && py <= this.field.height;
  }

  /**
   * Altitude (m) à la position pixel, interpolation bilinéaire entre centres de
   * pixels (le décalage de 0,5 convertit l'espace pixel en espace indice).
   */
  elevationAtPixel(px: number, py: number): number {
    return this.field.sampleBilinear(px - 0.5, py - 0.5);
  }

  /** Vrai si le point tombe dans l'emprise du bloc. */
  contains(p: LatLon): boolean {
    const { px, py } = this.localPixel(p);
    return this.containsPixel(px, py);
  }

  /** Altitude (m) au point demandé (voir `elevationAtPixel`). */
  elevationAt(p: LatLon): number {
    const { px, py } = this.localPixel(p);
    return this.elevationAtPixel(px, py);
  }
}

/** Forme sérialisable d'un GeoHeightField (transfert vers un Web Worker). */
export interface GeoHeightFieldData {
  zoom: number;
  originTileX: number;
  originTileY: number;
  width: number;
  height: number;
  data: Float32Array;
}

export function serializeGeoHeightField(field: GeoHeightField): GeoHeightFieldData {
  return {
    zoom: field.zoom,
    originTileX: field.originTileX,
    originTileY: field.originTileY,
    width: field.field.width,
    height: field.field.height,
    data: field.field.data,
  };
}

export function deserializeGeoHeightField(data: GeoHeightFieldData): GeoHeightField {
  return new GeoHeightField(
    data.zoom,
    data.originTileX,
    data.originTileY,
    new HeightField(data.width, data.height, data.data),
  );
}
