/**
 * Encodage « terrarium » des AWS Terrain Tiles : l'altitude (m) est répartie
 * sur les canaux RVB d'un PNG avec un décalage de 32768 et un pas de 1/256 m.
 */

/** Altitude (m) encodée par un pixel terrarium. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Encode une altitude (m) en RVB terrarium (précision 1/256 m).
 * Sert aux tuiles synthétiques des tests.
 */
export function encodeTerrarium(elevation: number): { r: number; g: number; b: number } {
  const q = Math.round((elevation + 32768) * 256);
  if (q < 0 || q > 0xffffff) {
    throw new RangeError(`Altitude hors plage terrarium : ${elevation}`);
  }
  return { r: (q >>> 16) & 0xff, g: (q >>> 8) & 0xff, b: q & 0xff };
}

/**
 * Décode un tampon RGBA (tel que sorti d'un canvas) en altitudes.
 * `data` contient 4 octets par pixel ; l'alpha est ignoré.
 */
export function decodeTerrariumRgba(data: Uint8ClampedArray | Uint8Array): Float32Array {
  const pixelCount = data.length / 4;
  const out = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    out[i] = decodeTerrarium(data[o]!, data[o + 1]!, data[o + 2]!);
  }
  return out;
}
