/**
 * Perceptual hashing (dHash) pour la reconnaissance de cartes Sanctuaire.
 *
 * dHash : compare les pixels adjacents horizontalement sur une image réduite.
 * Résultat : chaîne de 64 bits ('0'/'1') unique à chaque image.
 * Comparaison : distance de Hamming entre deux hashes (0 = identique, 64 = opposé).
 * Seuil "bonne correspondance" : distance ≤ 10 sur 64 bits.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import jpeg from 'jpeg-js';

// dHash : 8 lignes × 9 colonnes → 64 bits de comparaison horizontale
const HASH_H = 8;
const HASH_W = 9;

/**
 * Calcule le dHash d'une image à partir de son URI local.
 * @param {string} imageUri - URI local de l'image (expo-camera, expo-image-picker, etc.)
 * @returns {Promise<string>} - hash de 64 caractères ('0' ou '1')
 */
export async function computeHash(imageUri) {
  // 1. Réduire à 9×8 pixels
  const resized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: HASH_W, height: HASH_H } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.95 }
  );

  // 2. Lire le fichier en base64
  const base64 = await FileSystem.readAsStringAsync(resized.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // 3. Décoder le JPEG
  const buffer = Buffer.from(base64, 'base64');
  const { data, width, height } = jpeg.decode(buffer, { useTArray: true });

  // 4. Calculer le dHash : pixel gauche > pixel droit → '1', sinon '0'
  let hash = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i1 = (y * width + x) * 4;
      const i2 = i1 + 4;
      const gray1 = 0.299 * data[i1] + 0.587 * data[i1 + 1] + 0.114 * data[i1 + 2];
      const gray2 = 0.299 * data[i2] + 0.587 * data[i2 + 1] + 0.114 * data[i2 + 2];
      hash += gray1 > gray2 ? '1' : '0';
    }
  }

  return hash;
}

/**
 * Distance de Hamming entre deux hashes (nombre de bits différents).
 * @param {string} h1
 * @param {string} h2
 * @returns {number} - entre 0 (identique) et 64 (opposé)
 */
export function hammingDistance(h1, h2) {
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) dist++;
  }
  return dist;
}
