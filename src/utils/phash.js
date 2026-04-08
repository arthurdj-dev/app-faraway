/**
 * phash.js — Perceptual hash (pHash) en JS pur pour React Native
 *
 * Algorithme :
 *  1. Resize l'image à 32×32 en PNG via expo-image-manipulator
 *  2. Décode le PNG base64 avec pako (inflate)
 *  3. Applique les filtres PNG pour reconstruire les pixels
 *  4. Convertit en niveaux de gris
 *  5. Calcule la DCT 2D sur les 32×32 pixels
 *  6. Prend le coin supérieur gauche 8×8 (64 valeurs, sans le DC)
 *  7. Hash : 1 si valeur > moyenne, 0 sinon → chaîne de 64 bits
 */

import * as ImageManipulator from 'expo-image-manipulator';
import pako from 'pako';

const DCT_SIZE  = 32; // taille de resize avant DCT
const HASH_BITS = 8;  // top-left HASH_BITS×HASH_BITS de la DCT → 64 bits

// ─── Décodage PNG ──────────────────────────────────────────────────────────

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3]) >>> 0;
}

function parsePNG(bytes) {
  // Signature PNG : 8 octets
  let offset = 8;
  let width = 0, height = 0, colorType = 0, bpp = 4;
  const idatChunks = [];

  while (offset < bytes.length - 8) {
    const length = readUint32BE(bytes, offset); offset += 4;
    const type = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
    offset += 4;

    if (type === 'IHDR') {
      width     = readUint32BE(bytes, offset);
      height    = readUint32BE(bytes, offset + 4);
      colorType = bytes[offset + 9];
      // bytes per pixel selon colorType
      if      (colorType === 0) bpp = 1; // grayscale
      else if (colorType === 2) bpp = 3; // RGB
      else if (colorType === 4) bpp = 2; // grayscale+alpha
      else if (colorType === 6) bpp = 4; // RGBA
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.slice(offset, offset + length));
    } else if (type === 'IEND') {
      break;
    }

    offset += length + 4; // data + CRC
  }

  // Concatène les chunks IDAT et inflate
  const combined = new Uint8Array(idatChunks.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  for (const chunk of idatChunks) { combined.set(chunk, pos); pos += chunk.length; }
  const inflated = pako.inflate(combined);

  // Applique les filtres PNG octet par octet et reconstruit les pixels
  const raw = new Uint8Array(width * height * bpp);
  const stride = width * bpp; // octets par ligne dans le résultat

  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * (stride + 1)];
    const srcRow     = y * (stride + 1) + 1;
    const dstRow     = y * stride;
    const prevRow    = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = inflated[srcRow + x];
      const a = x >= bpp        ? raw[dstRow  + x - bpp] : 0; // gauche
      const b = y > 0           ? raw[prevRow + x]        : 0; // haut
      const c = x >= bpp && y > 0 ? raw[prevRow + x - bpp] : 0; // haut-gauche

      let val;
      switch (filterType) {
        case 0:  val = rawByte; break;
        case 1:  val = (rawByte + a) & 0xFF; break;
        case 2:  val = (rawByte + b) & 0xFF; break;
        case 3:  val = (rawByte + Math.floor((a + b) / 2)) & 0xFF; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          val = (rawByte + pr) & 0xFF;
          break;
        }
        default: val = rawByte;
      }
      raw[dstRow + x] = val;
    }
  }

  // Convertit en niveaux de gris (Float32, 0–255)
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const base = i * bpp;
    if (bpp === 1 || bpp === 2) {
      gray[i] = raw[base];
    } else {
      // RGB ou RGBA : luminance Rec.601
      gray[i] = 0.299 * raw[base] + 0.587 * raw[base+1] + 0.114 * raw[base+2];
    }
  }

  return { gray, width, height };
}

// ─── DCT 2D ────────────────────────────────────────────────────────────────

function dct2D(pixels, size) {
  const result = new Float32Array(HASH_BITS * HASH_BITS);

  for (let u = 0; u < HASH_BITS; u++) {
    for (let v = 0; v < HASH_BITS; v++) {
      let sum = 0;
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          sum += pixels[y * size + x]
            * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size))
            * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      result[v * HASH_BITS + u] = (2 / size) * cu * cv * sum;
    }
  }
  return result;
}

// ─── API publique ──────────────────────────────────────────────────────────

/**
 * Calcule le pHash d'une image à partir de son URI local.
 * @param {string} uri — URI local de l'image (file://)
 * @returns {Promise<string>} — chaîne binaire de 64 caractères ('0'/'1')
 */
export async function computePHash(uri) {
  // 1. Resize à 32×32 en PNG (lossless → pixels exacts)
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: DCT_SIZE, height: DCT_SIZE } }],
    { format: ImageManipulator.SaveFormat.PNG, base64: true }
  );

  // 2. Décode le PNG
  const bytes = base64ToBytes(result.base64);
  const { gray } = parsePNG(bytes);

  // 3. DCT sur les 32×32 niveaux de gris
  const dctVals = dct2D(gray, DCT_SIZE);

  // 4. Moyenne des 64 valeurs (on exclut la composante DC [0,0])
  let sum = 0;
  for (let i = 1; i < dctVals.length; i++) sum += dctVals[i];
  const mean = sum / (dctVals.length - 1);

  // 5. Hash : 1 si > moyenne, 0 sinon (on skip le DC)
  let hash = '';
  for (let i = 0; i < dctVals.length; i++) {
    hash += i === 0 ? '0' : dctVals[i] >= mean ? '1' : '0';
  }
  return hash;
}

/**
 * Distance de Hamming entre deux hashes (nombre de bits différents).
 * @param {string} h1
 * @param {string} h2
 * @returns {number} — 0 (identiques) à 64 (opposés)
 */
export function hammingDistance(h1, h2) {
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) dist++;
  }
  return dist;
}
