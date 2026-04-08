/**
 * tableauScanner.js
 *
 * Flow :
 *  1. Groq (image) → lit les 8 numéros de région
 *  2. Calcul local → nombre de sanctuaires depuis les durées d'exploration
 *  3. pHash → crop tiers supérieur → découpe en N parts → match contre sanctuary_hashes.json
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { getGroqApiKey } from './storage';
import { computePHash, hammingDistance } from './phash';
import regionCards    from '../data/region_cards.json';
import sanctuaryHashes from '../data/sanctuary_hashes.json';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const REGION_COUNT = 8;

// Seuil de distance de Hamming en dessous duquel on considère la confiance haute
const HIGH_CONFIDENCE_THRESHOLD = 10;
const LOW_CONFIDENCE_THRESHOLD  = 20;

// ─── Utilitaires ───────────────────────────────────────────────────────────

async function resizeToBase64(uri) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1920 } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.92, base64: true }
  );
  return { base64: result.base64, uri: result.uri, width: result.width, height: result.height };
}

function parseModelJSON(text) {
  const cleaned = text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^#[^\n]*/gm, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Réponse invalide du modèle Groq');
  const sanitized = match[0]
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/:(\s*,)/g, ': null$1')
    .replace(/:\s*(\d+)\s*-\s*\d+/g, ': $1');
  return JSON.parse(sanitized);
}

function imgUrl(base64) {
  return `data:image/jpeg;base64,${base64}`;
}

// ─── Appel Groq : régions ──────────────────────────────────────────────────

async function callGroqRegions(base64, apiKey) {
  const prompt = `This is a photo of a Faraway board game player's tableau.

Board layout (3 rows):
- TOP ROW: Sanctuary cards (ignore them)
- MIDDLE ROW: Region cards at positions 1, 2, 3, 4 (left to right)
- BOTTOM ROW: Region cards at positions 5, 6, 7, 8 (left to right)

Each region card has a unique number (1–68) printed prominently in large text.
Read the number on each of the 8 region cards. Use null if unreadable.

Return ONLY valid JSON:
{
  "regions": [
    {"position": 1, "id": 42},
    {"position": 2, "id": 15},
    {"position": 3, "id": 7},
    {"position": 4, "id": 31},
    {"position": 5, "id": 55},
    {"position": 6, "id": 12},
    {"position": 7, "id": 3},
    {"position": 8, "id": 19}
  ]
}`;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imgUrl(base64) } },
      ]}],
      temperature: 0,
      max_tokens: 256,
    }),
  });

  if (!response.ok) throw new Error(`Groq ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Calcul du nombre de sanctuaires ──────────────────────────────────────

function countSanctuaries(regionIds) {
  let total = 0;
  for (let i = 1; i < regionIds.length; i++) {
    const card     = regionCards[regionIds[i]];
    const prevCard = regionCards[regionIds[i - 1]];
    if (!card || !prevCard) continue;
    if (card.duration > prevCard.duration) total++;
  }
  return total;
}

// ─── pHash : crop d'une carte sanctuaire individuelle ─────────────────────

async function cropSanctuaryCard(resizedUri, imgW, imgH, cardIndex) {
  const cardW  = Math.floor(imgW / 7);          // chaque carte = 1/7 de la largeur totale
  const cardH  = Math.floor(imgH / 3);          // rangée du haut = 1/3 de la hauteur
  const originX = Math.floor(cardIndex * cardW);

  const result = await ImageManipulator.manipulateAsync(
    resizedUri,
    [{ crop: {
      originX: Math.min(originX, imgW - cardW),
      originY: 0,
      width:   cardW,
      height:  cardH,
    }}],
    { format: ImageManipulator.SaveFormat.PNG, base64: false }
  );
  return result.uri;
}

// ─── Matching pHash ────────────────────────────────────────────────────────

function matchSanctuaryByHash(hash, usedIds = new Set()) {
  let bestId     = null;
  let bestDist   = Infinity;
  let secondDist = Infinity;

  for (const [idStr, refHashes] of Object.entries(sanctuaryHashes)) {
    const id = parseInt(idStr);
    if (usedIds.has(id)) continue;
    // Distance minimale parmi tous les hashes de référence de cette carte
    const hashes = Array.isArray(refHashes) ? refHashes : [refHashes];
    const dist = Math.min(...hashes.map(rh => hammingDistance(hash, rh)));
    if (dist < bestDist) {
      secondDist = bestDist;
      bestDist   = dist;
      bestId     = id;
    } else if (dist < secondDist) {
      secondDist = dist;
    }
  }

  const confidence =
    bestDist <= HIGH_CONFIDENCE_THRESHOLD && bestDist < secondDist - 3 ? 'high' :
    bestDist <= LOW_CONFIDENCE_THRESHOLD                                 ? 'low'  : 'none';

  return {
    id:         confidence !== 'none' ? bestId : null,
    confidence,
    distance:   bestDist,
  };
}

// ─── Fonction principale ───────────────────────────────────────────────────

export async function scanTableau(photoUri) {
  const apiKey = await getGroqApiKey();
  if (!apiKey) throw new Error('Clé Groq manquante');

  const resized = await resizeToBase64(photoUri);

  // 1. Groq lit les régions
  const regionsRaw = await callGroqRegions(resized.base64, apiKey);
  const board      = parseModelJSON(regionsRaw);

  const results   = [];
  const regionIds = [];

  for (const r of board.regions ?? []) {
    const id = r.id ?? null;
    regionIds[r.position - 1] = id;
    results.push({
      index:      r.position - 1,
      type:       'region',
      id,
      confidence: id != null ? 'high' : 'none',
      row:        r.position <= 4 ? 0 : 1,
      col:        (r.position - 1) % 4,
    });
  }

  // 2. Nombre de sanctuaires
  const sanctuaryCount = Math.min(countSanctuaries(regionIds), 8);

  // 3. pHash : crop de chaque carte sanctuaire et matching
  if (sanctuaryCount > 0) {
    const usedIds = new Set();

    for (let i = 0; i < sanctuaryCount; i++) {
      const cardUri = await cropSanctuaryCard(resized.uri, resized.width, resized.height, i, sanctuaryCount);
      const hash    = await computePHash(cardUri);
      const match   = matchSanctuaryByHash(hash, usedIds);

      if (match.id !== null) usedIds.add(match.id);
      results.push({
        index: REGION_COUNT + i,
        type:  'sanctuary',
        ...match,
      });
    }
  }

  return results;
}
