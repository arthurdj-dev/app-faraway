import * as ImageManipulator from 'expo-image-manipulator';
import { Buffer } from 'buffer';
import jpeg from 'jpeg-js';

const HASH_H = 8;
const HASH_W = 9;

export async function computeHash(imageUri) {
  // Réduire à 9×8 pixels et récupérer le base64 directement
  const resized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: HASH_W, height: HASH_H } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.95, base64: true }
  );

  // Décoder le JPEG depuis le base64
  const buffer = Buffer.from(resized.base64, 'base64');
  const { data, width, height } = jpeg.decode(buffer, { useTArray: true });

  // dHash : pixel gauche > pixel droit → '1', sinon '0'
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

export function hammingDistance(h1, h2) {
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) dist++;
  }
  return dist;
}
