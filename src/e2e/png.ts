import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Codec PNG minimal pour les tests de bout en bout (Node uniquement) :
 * encode des tuiles terrarium synthétiques et décode tuiles réelles ou
 * captures d'écran. Grille 8 bits, types de couleur RVB(A) et niveaux de
 * gris, sans entrelacement — suffisant pour les PNG rencontrés ici.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(...buffers: Buffer[]): number {
  let c = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBuffer, data));
  return Buffer.concat([header, typeBuffer, data, crc]);
}

/** Encode une image RVB 8 bits (r, g, b par pixel, ligne à ligne) en PNG. */
export function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Buffer {
  if (rgb.length !== width * height * 3) {
    throw new RangeError(`Tampon RVB de ${rgb.length} octets pour ${width}×${height}`);
  }
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtre « None »
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // type de couleur : RVB
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 octets par pixel (alpha 255 si absent de la source). */
  rgba: Uint8ClampedArray;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Décode un PNG 8 bits non entrelacé (gris, gris+α, RVB ou RVBA) en RGBA. */
export function decodePng(file: Buffer | Uint8Array): DecodedPng {
  const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Signature PNG absente');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  for (let offset = 8; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new Error('PNG entrelacé non pris en charge');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`Profondeur ${bitDepth} non prise en charge`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Type de couleur ${colorType} non pris en charge`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`Flux décompressé de ${raw.length} octets, ${(stride + 1) * height} attendus`);
  }

  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels]! : 0;
      const b = y > 0 ? pixels[prev + x]! : 0;
      const c = y > 0 && x >= channels ? pixels[prev + x - channels]! : 0;
      let value = line[x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`Filtre PNG ${filter} inconnu`);
      pixels[out + x] = value & 0xff;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const src = i * channels;
    const dst = i * 4;
    if (colorType === 0 || colorType === 4) {
      rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = pixels[src]!;
      rgba[dst + 3] = colorType === 4 ? pixels[src + 1]! : 255;
    } else {
      rgba[dst] = pixels[src]!;
      rgba[dst + 1] = pixels[src + 1]!;
      rgba[dst + 2] = pixels[src + 2]!;
      rgba[dst + 3] = colorType === 6 ? pixels[src + 3]! : 255;
    }
  }
  return { width, height, rgba };
}
