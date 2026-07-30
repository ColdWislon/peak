import { localEastNorth, localToLatLon } from '../lib/geo';
import { deserializeGeoHeightField } from '../lib/terrain/heightField';
import { isVisible, type ElevationSampler } from '../lib/visibility';
import type { PeakSight, VisibilityRequest } from '../lib/visibility/protocol';

/**
 * Worker de visibilité : reconstruit les champs d'altitude transférés puis
 * teste la ligne de vue de chaque sommet. Couche mince — toute la logique
 * vit dans lib/visibility (testée) ; ici on ne fait que brancher les messages.
 */

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<VisibilityRequest>) => void) | null;
  postMessage: (message: PeakSight[]) => void;
};

scope.onmessage = (event) => {
  const { viewpoint, eyeElevation, innerRadiusM, inner, outer, peaks } = event.data;

  const innerField = deserializeGeoHeightField(inner);
  const outerField = deserializeGeoHeightField(outer);

  const sample: ElevationSampler = (east, north) => {
    const p = localToLatLon(viewpoint, east, north);
    const r = Math.hypot(east, north);
    if (r < innerRadiusM && innerField.contains(p)) return innerField.elevationAt(p);
    return outerField.contains(p) ? outerField.elevationAt(p) : 0;
  };

  const sights: PeakSight[] = peaks.map((peak) => {
    const { east, north } = localEastNorth(viewpoint, peak);
    const elevation = peak.elevation ?? sample(east, north);
    return {
      id: peak.id,
      visible: isVisible(sample, east, north, elevation, { eyeElevation }),
      distanceM: Math.hypot(east, north),
      elevation,
      east,
      north,
    };
  });

  scope.postMessage(sights);
};
