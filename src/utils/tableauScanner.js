/**
 * tableauScanner.js — Reconnaissance des cartes via Groq Llama Vision
 *
 * Flow :
 *  1. Redimensionne la photo (1280px) et encode en base64
 *  2. Envoie à Groq Llama Vision avec un prompt structuré
 *  3. Parse le JSON retourné par le modèle
 *  4. Régions  → id lu directement depuis la réponse
 *  5. Sanctuaires → matching par biome + ressources contre sanctuary_cards.json
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { getGroqApiKey } from './storage';
import sanctuaryCards from '../data/sanctuary_cards.json';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const REGION_COUNT = 8;

// ─── Utilitaires ──────────────────────────────────────────────────────────

async function photoToBase64(uri) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1280 } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.85, base64: true }
  );
  return result.base64;
}

// Parse le JSON depuis la réponse brute du modèle (supporte les blocs markdown)
function parseModelJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Réponse invalide du modèle Groq');
  return JSON.parse(match[0]);
}

// ─── Appel Groq Vision ─────────────────────────────────────────────────────

async function callGroqVision(base64Image, apiKey) {
  const prompt = `This is a photo of a Faraway board game player's tableau.

Board layout (3 rows, left to right):
- TOP ROW: Sanctuary cards (variable count, 1–8 cards)
- MIDDLE ROW: Region cards at positions 1, 2, 3, 4
- BOTTOM ROW: Region cards at positions 5, 6, 7, 8

TASK 1 — REGION CARDS (middle + bottom rows):
Each region card has a unique number (1–68) printed prominently in large text.
Read the number on each card. If a card is missing or unreadable, use null.

TASK 2 — SANCTUARY CARDS (top row):
For each sanctuary card (left to right), identify:
- biome: the colored border/frame — "vert" (green), "jaune" (yellow), "rouge" (red), "bleu" (blue), or null if no colored border
- stones: count of rock/stone resource symbols
- chimeras: count of creature/animal resource symbols
- thistles: count of thistle/golden plant resource symbols
- clues: count of magnifying glass or clue symbols

Return ONLY valid JSON, no explanation, no markdown:
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
  "sanctuaries": [
    {"position": 1, "biome": "vert", "stones": 1, "chimeras": 0, "thistles": 2, "clues": 1},
    {"position": 2, "biome": null, "stones": 0, "chimeras": 1, "thistles": 0, "clues": 0}
  ]
}`;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
        ],
      }],
      temperature: 0,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Matching sanctuaire ───────────────────────────────────────────────────

function matchSanctuary(desc) {
  const candidates = Object.entries(sanctuaryCards).map(([idStr, card]) => {
    const id  = parseInt(idStr);
    const res = card.bonus?.resources ?? {};
    let score = 0;

    // Biome : discriminant fort
    if (card.biome === (desc.biome ?? null)) score += 4;

    // Ressources : on pénalise chaque écart
    score -= Math.abs((res.stones   ?? 0) - (desc.stones   ?? 0));
    score -= Math.abs((res.chimeras ?? 0) - (desc.chimeras ?? 0));
    score -= Math.abs((res.thistles ?? 0) - (desc.thistles ?? 0));
    score -= Math.abs((card.bonus?.clues ?? 0) - (desc.clues ?? 0));

    return { id, score };
  });

  candidates.sort((a, b) => b.score - a.score);
  const best   = candidates[0];
  const second = candidates[1];

  const confidence =
    best.score >= 3 && best.score > second.score ? 'high' :
    best.score >= 0                               ? 'low'  : 'none';

  return {
    id: confidence !== 'none' ? best.id : null,
    confidence,
    candidates: candidates.slice(0, 3),
  };
}

// ─── Fonction principale ───────────────────────────────────────────────────

export async function scanTableau(photoUri) {
  const apiKey = await getGroqApiKey();
  if (!apiKey) throw new Error('Clé Groq manquante');

  const base64 = await photoToBase64(photoUri);
  const raw    = await callGroqVision(base64, apiKey);
  const parsed = parseModelJSON(raw);

  const results = [];

  // Régions
  for (const r of parsed.regions ?? []) {
    results.push({
      index:      r.position - 1,
      type:       'region',
      id:         r.id ?? null,
      confidence: r.id != null ? 'high' : 'none',
      row:        r.position <= 4 ? 0 : 1,
      col:        (r.position - 1) % 4,
    });
  }

  // Sanctuaires
  for (const s of parsed.sanctuaries ?? []) {
    const match = matchSanctuary(s);
    results.push({
      index: REGION_COUNT + s.position - 1,
      type:  'sanctuary',
      ...match,
    });
  }

  return results;
}
