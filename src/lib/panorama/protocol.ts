import type { LatLon } from '../geo';
import type { GeoHeightFieldData } from '../terrain/heightField';
import type { PolarMeshOptions } from './mesh';

/**
 * Messages du worker de maillage terrain. Les tampons des champs d'altitude
 * font l'aller-retour par transfert (jamais copiés) : main → worker pour
 * échantillonner, worker → main pour être repassés ensuite à la visibilité.
 */

export interface TerrainMeshRequest {
  /** Identifiant de corrélation (les réponses obsolètes sont ignorées). */
  requestId: number;
  viewpoint: LatLon;
  innerRadiusM: number;
  inner: GeoHeightFieldData;
  outer: GeoHeightFieldData;
  options: PolarMeshOptions;
}

export interface TerrainMeshResponse {
  requestId: number;
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Altitude du sol sous l'œil (m). */
  groundElevation: number;
  inner: GeoHeightFieldData;
  outer: GeoHeightFieldData;
}
