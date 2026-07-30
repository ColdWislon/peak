import { elevationToColor } from '../lib/panorama/colors';
import { buildPolarTerrainMesh } from '../lib/panorama/mesh';
import type { TerrainMeshRequest, TerrainMeshResponse } from '../lib/panorama/protocol';
import { makeBlendedSampler } from '../lib/panorama/sampler';
import { deserializeGeoHeightField, serializeGeoHeightField } from '../lib/terrain/heightField';

/**
 * Worker de maillage : construit la géométrie polaire du terrain hors du fil
 * principal (l'échantillonnage de ~115 000 sommets prendrait sinon ~100 ms
 * d'interface figée). Les tampons repartent par transfert.
 */

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TerrainMeshRequest>) => void) | null;
  postMessage: (message: TerrainMeshResponse, transfer: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const { requestId, viewpoint, innerRadiusM, inner, outer, options } = event.data;

  const innerField = deserializeGeoHeightField(inner);
  const outerField = deserializeGeoHeightField(outer);
  const sample = makeBlendedSampler(viewpoint, innerField, outerField, innerRadiusM);

  const mesh = buildPolarTerrainMesh(sample, elevationToColor, options);

  const response: TerrainMeshResponse = {
    requestId,
    positions: mesh.positions,
    colors: mesh.colors,
    indices: mesh.indices,
    groundElevation: sample(0, 0),
    inner: serializeGeoHeightField(innerField),
    outer: serializeGeoHeightField(outerField),
  };

  scope.postMessage(response, [
    response.positions.buffer,
    response.colors.buffer,
    response.indices.buffer,
    response.inner.data.buffer,
    response.outer.data.buffer,
  ]);
};
