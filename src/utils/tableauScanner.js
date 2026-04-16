/**
 * tableauScanner.js
 *
 * Flow :
 *  1. Groq → lit les 8 numéros de région + bounding box de la rangée sanctuaires
 *  2. Backend ORB → matche la zone sanctuaires contre les 53 références
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { getGroqApiKey } from './storage';
import regionCards from '../data/region_cards.json';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'meta-llama/llama-4-scout-17b-16e-instruct';
const REGION_COUNT = 8;

// URL du backend ORB déployé sur Google Cloud Run (région europe-west9).
// Pour dev local, remplacer par 'http://localhost:8000'.
const BACKEND_URL = 'https://faraway-backend-367452467200.europe-west9.run.app';
const HIGH_CONFIDENCE_INLIERS = 150;

// ─── Utilitaires ───────────────────────────────────────────────────────────

async function resizeToBase64(uri) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1920 } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.92, base64: true }
  );
  return { base64: result.base64, uri: result.uri, width: result.width, height: result.height };
}

function extractJsonBlock(text, requiredKey) {
  let start = -1;
  while ((start = text.indexOf('{', start + 1)) !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) { const block = text.slice(start, i + 1); if (block.includes(requiredKey)) return block; break; } }
    }
  }
  return null;
}

function parseModelJSON(text, requiredKey = '"regions"') {
  const cleaned = text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^#[^\n]*/gm, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  let block = extractJsonBlock(cleaned, requiredKey);
  if (!block) block = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (!block) throw new Error('Réponse invalide du modèle');
  const sanitized = block
    .replace(/:\s*True\b/g,  ': true')
    .replace(/:\s*False\b/g, ': false')
    .replace(/:\s*None\b/g,  ': null')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/:(\s*,)/g, ': null$1')
    .replace(/:\s*(\d+)\s*-\s*\d*/g, ': $1')
    .replace(/:\s*-\s*([,\}\]])/g, ': null$1');
  try {
    return JSON.parse(sanitized);
  } catch (e) {
    throw new Error(`JSON parse: ${e.message} — début: ${sanitized.slice(0, 400)}`);
  }
}

function imgUrl(base64) {
  return `data:image/jpeg;base64,${base64}`;
}

async function callGroq(prompt, base64, apiKey, maxTokens = 512) {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imgUrl(base64) } },
      ]}],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) throw new Error(`Groq ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Appel 1 : régions + zone sanctuaires ──────────────────────────────────

async function callGroqRegions(base64, apiKey) {
  const prompt = `This is a photo of a Faraway board game player's tableau.

Board layout (3 rows from top to bottom):
- TOP ROW: Sanctuary cards (optional, 0 to 8 cards)
- MIDDLE ROW: Region cards at positions 1, 2, 3, 4 (left to right)
- BOTTOM ROW: Region cards at positions 5, 6, 7, 8 (left to right)

Each region card has a unique number (0–76) printed prominently in large text.

Tasks:
1. Read the number on each of the 8 region cards. Use null if unreadable.
2. Estimate a bounding box that tightly contains ALL the sanctuary cards (the TOP ROW). Express it as fractions of the image width and height (0.0 to 1.0). If there are no sanctuary cards visible, return null.

Example sanctuary_zone: {"x": 0.02, "y": 0.01, "w": 0.96, "h": 0.33} means the sanctuaries occupy the top third of the photo.

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
  ],
  "sanctuary_zone": {"x": 0.02, "y": 0.01, "w": 0.96, "h": 0.33}
}`;
  return callGroq(prompt, base64, apiKey, 384);
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

// ─── Appel 2 : backend ORB ─────────────────────────────────────────────────

async function callBackendSanctuaries(base64, zone) {
  const body = { image_base64: base64 };
  if (zone && typeof zone.h === 'number' && zone.h > 0) {
    body.zone = {
      x: Number(zone.x) || 0,
      y: Number(zone.y) || 0,
      w: Number(zone.w) || 1,
      h: Number(zone.h),
    };
  }
  const resp = await fetch(`${BACKEND_URL}/match-sanctuaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Backend ORB ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ─── Fonction principale ───────────────────────────────────────────────────

export async function scanTableau(photoUri) {
  const apiKey = await getGroqApiKey();
  if (!apiKey) throw new Error('Clé Groq manquante');

  const resized = await resizeToBase64(photoUri);

  // 1. Groq : régions + zone sanctuaires
  const regionsRaw = await callGroqRegions(resized.base64, apiKey);
  const board = parseModelJSON(regionsRaw, '"regions"');
  console.log('[Groq regions parsed]', JSON.stringify(board, null, 2));

  const results = [];
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

  // 2. Backend ORB : détecte les sanctuaires dans la zone
  const expectedCount = countSanctuaries(regionIds);
  const zone = board.sanctuary_zone ?? null;

  if (expectedCount > 0 || zone) {
    const backendResp = await callBackendSanctuaries(resized.base64, zone);
    console.log('[ORB backend]', JSON.stringify(backendResp, null, 2));

    const detections = backendResp.detections ?? [];
    for (let i = 0; i < detections.length; i++) {
      const d = detections[i];
      results.push({
        index:      REGION_COUNT + i,
        type:       'sanctuary',
        id:         d.id,
        confidence: d.inliers >= HIGH_CONFIDENCE_INLIERS ? 'high' : 'low',
        inliers:    d.inliers,
      });
    }
  }

  return results;
}
