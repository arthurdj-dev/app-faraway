/**
 * tableauScanner.js
 *
 * Disposition attendue du plateau :
 *
 *   ┌────┬────┬────┐          ← zone HAUTE  : sanctuaires en ligne
 *   │ S1 │ S2 │ S3 │            (nombre variable, même largeur que les régions)
 *   ├────┼────┼────┼────┐
 *   │ R1 │ R2 │ R3 │ R4 │    ← zone MILIEU : régions 1-4
 *   ├────┼────┼────┼────┤
 *   │ R5 │ R6 │ R7 │ R8 │    ← zone BAS    : régions 5-8
 *   └────┴────┴────┴────┘
 *
 * Logique :
 *  1. cardWidth  = imageWidth / 4   (4 cartes Région par ligne)
 *  2. zoneHeight = imageHeight / 3  (3 bandes horizontales égales)
 *  3. Régions  → OCR sur chaque bande, reconnaît le numéro
 *  4. Sanctuaires → pHash sur les bandes restantes
 *     Le nombre de sanctuaires est détecté automatiquement :
 *     on essaie jusqu'à MAX_SANCTUARIES et on garde ceux dont
 *     la distance pHash est sous le seuil LOW_CONFIDENCE.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { computeHash, hammingDistance } from './imageHash';
import sanctuaryHashes from '../data/sanctuary_hashes.json';

const REGION_CARD_COUNT  = 8;
const CARDS_PER_ROW      = 4;
const MAX_SANCTUARIES    = 8;
const HIGH_CONFIDENCE    = 10;
const LOW_CONFIDENCE     = 20;

// ─── Découpe d'une bande ───────────────────────────────────────────────────

async function cropZone(imageUri, originX, originY, width, height, imgW, imgH) {
  const ox = Math.max(0, Math.round(originX));
  const oy = Math.max(0, Math.round(originY));
  const w  = Math.min(Math.round(width),  imgW - ox);
  const h  = Math.min(Math.round(height), imgH - oy);

  const { uri } = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ crop: { originX: ox, originY: oy, width: w, height: h } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
  );
  return uri;
}

// ─── OCR : extrait le numéro de carte depuis une bande ────────────────────

async function ocrNumber(stripUri) {
  const result = await TextRecognition.recognize(stripUri);
  const candidates = [];

  for (const block of result.blocks) {
    for (const line of block.lines) {
      const raw = line.text.trim().replace(/\s/g, '');
      const num = parseInt(raw);
      if (!isNaN(num) && num >= 1 && num <= 200 && raw === String(num)) {
        candidates.push(num);
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b - a)[0];
}

// ─── pHash : identifie un sanctuaire ──────────────────────────────────────

async function recognizeSanctuary(stripUri) {
  const hash = await computeHash(stripUri);
  const candidates = [];

  for (const [idStr, { hashes }] of Object.entries(sanctuaryHashes)) {
    const id = parseInt(idStr);
    const minDist = Math.min(...hashes.map((h) => hammingDistance(hash, h)));
    candidates.push({ id, distance: minDist });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (!best) return { id: null, confidence: 'none', candidates: [] };

  const confidence =
    best.distance <= HIGH_CONFIDENCE ? 'high' :
    best.distance <= LOW_CONFIDENCE  ? 'low'  : 'none';

  return {
    id: confidence !== 'none' ? best.id : null,
    confidence,
    distance: best.distance,
    candidates: candidates.slice(0, 3),
  };
}

// ─── Fonction principale ───────────────────────────────────────────────────

export async function scanTableau(photoUri, dimensions) {
  const { width: imgW, height: imgH } = dimensions;

  const cardW    = imgW / CARDS_PER_ROW;
  const zoneH    = imgH / 3;

  const results = [];

  // ── Régions ──────────────────────────────────────────────────────────────
  for (let row = 0; row < 2; row++) {
    const originY = (row + 1) * zoneH;

    for (let col = 0; col < CARDS_PER_ROW; col++) {
      const cardIndex = row * CARDS_PER_ROW + col;
      const originX   = col * cardW;

      const stripUri = await cropZone(photoUri, originX, originY, cardW, zoneH, imgW, imgH);
      const id       = await ocrNumber(stripUri);

      results.push({
        index:      cardIndex,
        type:       'region',
        id,
        confidence: id !== null ? 'high' : 'none',
        stripUri,
        row,
        col,
      });
    }
  }

  // ── Sanctuaires ──────────────────────────────────────────────────────────
  for (let s = 0; s < MAX_SANCTUARIES; s++) {
    const originX = s * cardW;

    if (originX + cardW / 2 > imgW) break;

    const stripUri    = await cropZone(photoUri, originX, 0, cardW, zoneH, imgW, imgH);
    const recognition = await recognizeSanctuary(stripUri);

    if (recognition.confidence === 'none') break;

    results.push({
      index:  REGION_CARD_COUNT + s,
      type:   'sanctuary',
      ...recognition,
      stripUri,
    });
  }

  return results;
}
