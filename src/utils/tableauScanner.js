/**
 * tableauScanner.js
 *
 * Flow :
 *  1. Gemini (image) → lit les 8 numéros de région
 *  2. Calcul local → nombre de sanctuaires depuis les durées d'exploration
 *  3. Gemini (image + ancres visuelles des régions) → décrit les N sanctuaires
 *  4. Matching local → compare la description contre sanctuary_cards.json
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { getGeminiApiKey } from './storage';
import regionCards    from '../data/region_cards.json';
import sanctuaryCards from '../data/sanctuary_cards.json';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL   = 'gemini-2.0-flash';
const REGION_COUNT   = 8;

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
  if (!match) throw new Error('Réponse invalide du modèle');
  const sanitized = match[0]
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/:(\s*,)/g, ': null$1')
    .replace(/:\s*(\d+)\s*-\s*\d+/g, ': $1');
  return JSON.parse(sanitized);
}

function imgUrl(base64) {
  return `data:image/jpeg;base64,${base64}`;
}

async function callGemini(messages, apiKey, maxTokens = 512) {
  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Appel 1 : régions ─────────────────────────────────────────────────────

async function callGeminiRegions(base64, apiKey) {
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

  return callGemini([{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imgUrl(base64) } },
  ]}], apiKey, 256);
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

// ─── Ancres visuelles depuis les régions identifiées ──────────────────────

function buildRegionAnchors(regionIds) {
  const rowLabel = ['2nd row from top', '2nd row from top', '2nd row from top', '2nd row from top', 'bottom row', 'bottom row', 'bottom row', 'bottom row'];
  const colLabel = ['1st from left', '2nd from left', '3rd from left', '4th from left', '1st from left', '2nd from left', '3rd from left', '4th from left'];
  const biomeDesc = {
    vert:    'GREEN bottom half',
    jaune:   'YELLOW bottom half',
    rouge:   'RED or dark red bottom half',
    bleu:    'BLUE bottom half',
    noColor: 'DARK GREY or BLACK bottom half',
  };

  const lines = [];
  for (let i = 0; i < regionIds.length; i++) {
    const id   = regionIds[i];
    const card = regionCards[id];
    if (!card) continue;

    const parts = [`[${rowLabel[i]}, ${colLabel[i]}] region #${id}:`];
    const biome = card.biome || 'noColor';
    parts.push(biomeDesc[biome] ?? biome);

    const res = [];
    if (card.resources?.stones   > 0) res.push(`${card.resources.stones} stone(s) — cyan teardrop`);
    if (card.resources?.chimeras > 0) res.push(`${card.resources.chimeras} chimera(s) — dark red heart`);
    if (card.resources?.thistles > 0) res.push(`${card.resources.thistles} thistle(s) — dark green crown`);
    if (res.length) parts.push(res.join(', '));
    if (card.clues > 0)            parts.push(`${card.clues} clue(s) — golden parchment`);
    if (card.timeOfDay === 'night') parts.push('night — dark ring with blue dot');

    lines.push(parts.join(' | '));
  }
  return lines.join('\n');
}

// ─── Appel 2 : sanctuaires ─────────────────────────────────────────────────

async function callGeminiSanctuaries(base64, sanctuaryCount, regionIds, apiKey) {
  const anchors = buildRegionAnchors(regionIds);
  const prompt = `You are analyzing a Faraway board game player's tableau.

The image shows 3 rows:
- TOP ROW: ${sanctuaryCount} sanctuary card(s) to analyze
- 2nd ROW from top: 4 region cards (positions 1–4, left to right)
- BOTTOM ROW: 4 region cards (positions 5–8, left to right)

═══ STEP 1 — CALIBRATE using the region cards ═══

The 8 region cards have been identified. Find each one by its row and position to understand what each biome color and symbol looks like in THIS specific photo:

${anchors}

═══ STEP 2 — ANALYZE the sanctuary cards (TOP ROW) ═══

There are EXACTLY ${sanctuaryCount} sanctuary card(s) in the TOP ROW, side by side left to right.
Each card is roughly 1/7 of the image width and 1/3 of the image height.

CRITICAL: Return EXACTLY ${sanctuaryCount} entries in STRICT left-to-right order. Each card is unique — it CANNOT appear twice.

═══ SANCTUARY CARD LAYOUT ═══

Each card has two halves:
┌─────────────────────────────┐
│  TOP HALF — illustration    │
│  Left area   │  Right area  │
│  (clue/night)│ (resources)  │
├─────────────────────────────┤
│  BOTTOM HALF — colored bg   │
│     Quest (optional)        │
└─────────────────────────────┘

BIOME — background color of the BOTTOM HALF only:
→ green = "vert" | yellow = "jaune" | red/dark red = "rouge" | blue = "bleu" | dark grey/black = null

TOP HALF — LEFT AREA (clue or night only, NEVER a resource):
• CLUE: golden-yellow crumpled parchment → "clues": 1
• NIGHT: dark ring with white interior and blue dot → "night": 1

TOP HALF — RIGHT AREA (resources only, NEVER clue or night):
• STONE: cyan teardrop with dark blue circle → "stones"
• CHIMERA: dark red inverted-heart with two horns → "chimeras"
• THISTLE: dark green crown with golden stripes → "thistles"

BOTTOM HALF — QUEST:
Many cards have NO quest. ONLY report a quest if you clearly see [symbol] = [number in square].
A — Read the number in the square (quest_points). If no number visible → null.
B — Identify the symbol to the left of "=":
• Cyan teardrop = per_resource stones | Dark red heart = per_resource chimeras
• Dark green crown = per_resource thistles | All 3 symbols = per_resource_group (always 3pts)
• Colored square(s) = per_biome | 2×2 grid of 4 colors = per_biome_group (always 4pts)
• Dark ring = per_night | Golden parchment = per_clue | Number alone = fixed (always 5pts)

KEY RULES:
- 3 resource symbols together → ALWAYS per_resource_group, points 3
- 4 colored squares in 2×2 grid → ALWAYS per_biome_group, points 4
- Number 5 alone → ALWAYS fixed, points 5
- 2 colored squares → ALWAYS per_biome, points 1

quest_points: always fill — the number you see in a square, or null if none.
quest_symbol_desc: describe in plain words what you see LEFT of "=", or null.

═══ OUTPUT FORMAT ═══

Return ONLY valid JSON:
{
  "sanctuaries": [
    {
      "position": 1,
      "biome": "rouge",
      "quest_points": null,
      "quest_symbol_desc": null,
      "bonus": { "stones": 0, "chimeras": 0, "thistles": 1, "clues": 0, "night": 0 },
      "quest": null
    },
    {
      "position": 2,
      "biome": null,
      "quest_points": 3,
      "quest_symbol_desc": "three small symbols side by side",
      "bonus": { "stones": 0, "chimeras": 0, "thistles": 0, "clues": 1, "night": 0 },
      "quest": { "type": "per_resource_group", "points": 3, "resource": null, "biomes": null }
    }
  ]
}`;

  return callGemini([{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imgUrl(base64) } },
  ]}], apiKey, 2048);
}

// ─── Matching sanctuaire ───────────────────────────────────────────────────

function matchSanctuary(desc, usedIds = new Set()) {
  const descPoints = desc.quest_points ?? null;

  const candidates = Object.entries(sanctuaryCards)
    .filter(([idStr]) => {
      if (usedIds.has(parseInt(idStr))) return false;
      if (descPoints !== null) {
        const cardPoints = sanctuaryCards[idStr].quests?.[0]?.reward?.points ?? null;
        if (cardPoints !== descPoints) return false;
      }
      return true;
    })
    .map(([idStr, card]) => {
      const id  = parseInt(idStr);
      const res = card.bonus?.resources ?? {};
      let score = 0;

      // Biome
      if (card.biome === (desc.biome ?? null)) score += 8; else score -= 8;

      // Bonus symbols
      score -= Math.abs((res.stones   ?? 0) - (desc.bonus?.stones   ?? 0)) * 3;
      score -= Math.abs((res.chimeras ?? 0) - (desc.bonus?.chimeras ?? 0)) * 3;
      score -= Math.abs((res.thistles ?? 0) - (desc.bonus?.thistles ?? 0)) * 3;
      score -= Math.abs((card.bonus?.clues ?? 0) - (desc.bonus?.clues ?? 0)) * 3;
      score -= Math.abs((card.bonus?.night ?? 0) - (desc.bonus?.night ?? 0)) * 3;

      // Quest points
      const cardPoints = card.quests?.[0]?.reward?.points ?? null;
      if (descPoints !== null && cardPoints === descPoints) score += 10;

      // Quest présence
      const cardQuests = card.quests ?? [];
      const descQuest  = desc.quest;

      if (!descQuest && cardQuests.length === 0) {
        score += 8;
      } else if (!descQuest && cardQuests.length > 0) {
        score -= 6;
      } else if (descQuest && cardQuests.length === 0) {
        score -= 6;
      } else if (descQuest && cardQuests.length > 0) {
        const q = cardQuests[0];
        const samePoints = cardPoints === descPoints;
        if (q.reward?.type === descQuest.type) score += samePoints ? 8 : 4;
        else score -= samePoints ? 6 : 2;
        if (descQuest.resource && q.reward?.resource === descQuest.resource) score += 2;
        if (descQuest.biomes && q.reward?.biomes) {
          score += descQuest.biomes.filter(b => q.reward.biomes.includes(b)).length * 2;
        }
        // Night vs clue disambiguation
        const sym = (desc.quest_symbol_desc ?? '').toLowerCase();
        if (sym) {
          const isNight = sym.includes('ring') || sym.includes('circle') || sym.includes('night');
          const isClue  = sym.includes('parchment') || sym.includes('scroll') || sym.includes('clue');
          if (isNight && q.reward?.type === 'per_night') score += 4;
          if (isNight && q.reward?.type === 'per_clue')  score -= 4;
          if (isClue  && q.reward?.type === 'per_clue')  score += 4;
          if (isClue  && q.reward?.type === 'per_night') score -= 4;
        }
      }

      return { id, score };
    });

  candidates.sort((a, b) => b.score - a.score);
  const best   = candidates[0];
  const second = candidates[1];

  const confidence =
    best.score >= 5 && best.score > (second?.score ?? -Infinity) + 2 ? 'high' :
    best.score >= 0 ? 'low' : 'none';

  return {
    id: confidence !== 'none' ? best.id : null,
    confidence,
    candidates: candidates.slice(0, 3),
  };
}

// ─── Fonction principale ───────────────────────────────────────────────────

export async function scanTableau(photoUri) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Clé Gemini manquante');

  const resized = await resizeToBase64(photoUri);

  // 1. Gemini lit les régions
  const regionsRaw = await callGeminiRegions(resized.base64, apiKey);
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

  // 3. Gemini décrit les sanctuaires avec ancres visuelles des régions
  if (sanctuaryCount > 0) {
    const sanctRaw  = await callGeminiSanctuaries(resized.base64, sanctuaryCount, regionIds, apiKey);
    const sanctData = parseModelJSON(sanctRaw);
    const usedIds   = new Set();

    for (let i = 0; i < (sanctData.sanctuaries ?? []).length; i++) {
      const match = matchSanctuary(sanctData.sanctuaries[i], usedIds);
      if (match.id !== null) usedIds.add(match.id);
      results.push({ index: REGION_COUNT + i, type: 'sanctuary', ...match });
    }
  }

  return results;
}
