/**
 * tableauScanner.js
 *
 * Flow :
 *  1. Groq (image) → lit les 8 numéros de région
 *  2. Calcul local → nombre de sanctuaires depuis les durées d'exploration
 *  3. Groq (photo complète + image de référence des symboles) → décrit les N sanctuaires
 *     en utilisant les cartes région comme ancres visuelles et les symboles comme référence
 *  4. Matching local → compare la description contre sanctuary_cards.json
 */

import { Asset } from 'expo-asset';
import * as ImageManipulator from 'expo-image-manipulator';
import { getGroqApiKey } from './storage';
import regionCards    from '../data/region_cards.json';
import sanctuaryCards from '../data/sanctuary_cards.json';

// Cache de l'image de référence des symboles (chargée une seule fois)
let symbolsRefBase64 = null;

async function loadSymbolsReference() {
  if (symbolsRefBase64) return symbolsRefBase64;
  const asset = Asset.fromModule(require('../../assets/symbols_reference.png'));
  await asset.downloadAsync();
  const result = await ImageManipulator.manipulateAsync(
    asset.localUri,
    [],
    { format: ImageManipulator.SaveFormat.PNG, base64: true }
  );
  symbolsRefBase64 = result.base64;
  return symbolsRefBase64;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const REGION_COUNT = 8;

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
  // Retire les blocs markdown ```json ... ``` et les commentaires # en début de ligne
  const cleaned = text
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^#[^\n]*/gm, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Réponse invalide du modèle Groq');
  const sanitized = match[0]
    .replace(/,(\s*[}\]])/g, '$1')          // virgules trailing avant } ou ]
    .replace(/:(\s*,)/g, ': null$1')        // valeur manquante "key":,
    .replace(/:\s*(\d+)\s*-\s*\d+/g, ': $1'); // plage "key": 1-2 → "key": 1
  return JSON.parse(sanitized);
}

function imgUrl(base64) {
  return `data:image/jpeg;base64,${base64}`;
}

// ─── Appel 1 : régions ─────────────────────────────────────────────────────

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

    if (card.clues > 0)               parts.push(`${card.clues} clue(s) — golden parchment`);
    if (card.timeOfDay === 'night')    parts.push('night — dark ring with blue dot');

    lines.push(parts.join(' | '));
  }
  return lines.join('\n');
}

// ─── Appel 2 : sanctuaires ─────────────────────────────────────────────────

async function callGroqSanctuaries(fullBase64, symbolsBase64, sanctuaryCount, regionIds, apiKey) {
  const anchors = buildRegionAnchors(regionIds);
  const prompt = `You are analyzing a Faraway board game player's tableau. You have TWO images.

IMAGE 1 — full photo of the tableau (3 rows):
- TOP ROW: ${sanctuaryCount} sanctuary card(s) to analyze
- 2nd ROW from top: 4 region cards (positions 1–4, left to right)
- BOTTOM ROW: 4 region cards (positions 5–8, left to right)

IMAGE 2 — symbol reference sheet showing the 5 possible symbols (left to right):
STONE | CHIMERA | THISTLE | CLUE | NIGHT
Use IMAGE 2 to know exactly what each symbol looks like before analyzing IMAGE 1.

═══ STEP 1 — CALIBRATE ═══

A) Study IMAGE 2 to memorize what each symbol looks like.

B) The 8 region cards in IMAGE 1 have been identified. Find each one by its row and position, and use it as a visual anchor for biome colors and symbols in THIS specific photo:

${anchors}

═══ STEP 2 — ANALYZE the sanctuary cards (TOP ROW of IMAGE 1) ═══

There are EXACTLY ${sanctuaryCount} sanctuary card(s) in the TOP ROW, side by side left to right.
Each sanctuary card occupies roughly 1/7 of IMAGE 1's width and about 1/3 of IMAGE 1's height.
ALL your output describes what you see in the TOP ROW of IMAGE 1.

CRITICAL: Return EXACTLY ${sanctuaryCount} entries — no more, no less.
List them in STRICT left-to-right order as they appear in the image. The first entry = leftmost card, last entry = rightmost card.
Each card is physically distinct and unique — the same card CANNOT appear twice. If two cards look similar, look more carefully at their differences.

═══ SANCTUARY CARD LAYOUT ═══

Each sanctuary card is divided into two horizontal halves:

┌─────────────────────────────┐
│  TOP HALF — picture background│
│  Left area   │  Right area  │
│  (clue/night)│ (resources)  │
├─────────────────────────────┤
│  BOTTOM HALF — colored bg   │
│     Quest (optional)        │
└─────────────────────────────┘

BIOME — read the background COLOR of the BOTTOM HALF of the card:
→ green background = "vert"
→ yellow background = "jaune"
→ red/dark red background = "rouge"
→ blue background = "bleu"
→ dark grey or black background = null (no biome)
Do NOT look at any border or frame — look only at the background fill of the bottom half.

═══ TOP HALF — BONUS SYMBOLS ═══

The top half is split into two distinct areas. Position is CRITICAL for identification:

RIGHT AREA (right half of the top section) — ONLY resources appear here:
• STONE (Uddu): small cyan/light-blue teardrop or angular drop shape with a dark blue circle inside, white outline → "stones"
• CHIMERA (Okiko): dark red inverted-heart-shaped head with two horn-like points at the top, white outline → "chimeras"
• THISTLE (Érodoré): rounded dark green crown-like shape with green spiky points at the top and horizontal golden/yellow stripes at the bottom, white outline → "thistles"
If you see one of these in the RIGHT area, it is a resource. Count each (0, 1 or 2).

LEFT AREA (left half of the top section) — ONLY clue or night appears here, NEVER a resource:
• CLUE (indice): small golden-yellow rectangular parchment/map with a dark brown border and golden markings inside, slightly irregular crumpled shape → "clues" (0 or 1)
• NIGHT: a perfect circle with a dark navy/black ring and white interior, small blue dot on the right side of the ring → "night" (0 or 1)
If you see a symbol in the LEFT area, it can ONLY be a clue or a night — never a stone, chimera or thistle.
If you see a symbol in the RIGHT area, it can ONLY be a resource — never a clue or a night.

RULE: if you see a cyan teardrop → it is ALWAYS a stone in the right area. If you see a golden parchment → it is ALWAYS a clue in the left area. These two cannot be confused by position alone.

═══ BOTTOM HALF — QUEST ═══

Many sanctuary cards have NO quest — the bottom half shows only the colored background with no symbol or number.
ONLY report a quest if you clearly see a symbol followed by "=" and a number in a square.
If you are not sure, set "quest" to null — do NOT invent a quest.

If a quest IS present, it always follows the pattern: [symbol] = [number in a square]

A — Read the number in the square to the RIGHT of "=". This is "quest_points". Read it carefully.
B — Identify the symbol to the LEFT of "=" to determine the quest type:

• FIXED: no symbol before "=", just a standalone number — ALWAYS 5 pts → type "fixed", points 5
• PER STONE: cyan teardrop with dark blue circle = number → type "per_resource", resource "stones"
• PER CHIMERA: dark red inverted-heart head with horns = number → type "per_resource", resource "chimeras"
• PER THISTLE: dark green crown with golden stripes = number → type "per_resource", resource "thistles"
• PER RESOURCE GROUP: all 3 resource symbols (teardrop + heart + crown) side by side — ALWAYS equals 3 → type "per_resource_group", points 3
• PER BIOME (1 color): one colored square = number → type "per_biome", list color in "biomes" (grey/dark = "noColor")
• PER BIOME (2 colors): two colored squares with "/" between — ALWAYS equals 1 → type "per_biome", points 1, list both colors
• PER BIOME GROUP: 2×2 grid of 4 colored squares — ALWAYS equals 4 → type "per_biome_group", points 4
• PER NIGHT: dark ring with blue dot = number → type "per_night"
• PER CLUE: golden crumpled parchment = number → type "per_clue"

NOTE: the quest symbol uses the same visual icons as the bonus section — refer to the descriptions above.

KEY RULES — use these to resolve ambiguity:
- If you see the number 3 with all 3 resource symbols → ALWAYS per_resource_group, points 3
- If you see the number 4 with a 2×2 grid of 4 colored squares → ALWAYS per_biome_group, points 4
- If you see the number 5 alone with no symbol → ALWAYS fixed, points 5
- If you see the number 1 with two colored squares → ALWAYS per_biome with 2 biomes, points 1

QUEST POINTS — always fill this field:
→ "quest_points": the number you see in a square in the bottom half, regardless of whether you understand the quest type. If you see no number at all, set to null.
This is the most important field for identification — always report it if visible.

QUEST SYMBOL — always fill this field when a quest is present:
→ "quest_symbol_desc": describe in plain words what you see to the LEFT of the "=" (e.g. "dark circle ring", "golden crumpled parchment", "cyan teardrop", "dark red heart", "dark green crown", "three small symbols", "colored square", "four colored squares grid"). Be specific — this helps distinguish similar cards.

If no quest symbol+number is visible, set "quest" to null and "quest_symbol_desc" to null.
If a quest is visible, never set "quest" to null.

═══ OUTPUT FORMAT ═══

Return ONLY valid JSON:
{
  "sanctuaries": [
    {
      "position": 1,
      "biome": "rouge",
      "quest_points": null,
      "quest_symbol_desc": null,
      "bonus": {
        "stones": 0,
        "chimeras": 0,
        "thistles": 1,
        "clues": 0,
        "night": 0
      },
      "quest": null
    },
    {
      "position": 2,
      "biome": null,
      "quest_points": 3,
      "quest_symbol_desc": "three small symbols side by side",
      "bonus": {
        "stones": 0,
        "chimeras": 0,
        "thistles": 0,
        "clues": 1,
        "night": 0
      },
      "quest": {
        "type": "per_resource_group",
        "points": 3,
        "resource": null,
        "biomes": null
      }
    }
  ]
}`;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imgUrl(fullBase64) } },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${symbolsBase64}` } },
      ]}],
      temperature: 0,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) throw new Error(`Groq ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Matching sanctuaire ───────────────────────────────────────────────────

function matchSanctuary(desc, usedIds = new Set()) {
  const descPoints = desc.quest_points ?? null;

  const candidates = Object.entries(sanctuaryCards)
    .filter(([idStr]) => {
      if (usedIds.has(parseInt(idStr))) return false;
      // Éliminatoire : si Groq a vu un chiffre, on exclut toutes les cartes avec un chiffre différent
      if (descPoints !== null) {
        const card = sanctuaryCards[idStr];
        const cardPoints = card.quests?.[0]?.reward?.points ?? null;
        if (cardPoints !== descPoints) return false;
      }
      return true;
    })
    .map(([idStr, card]) => {
    const id  = parseInt(idStr);
    const res = card.bonus?.resources ?? {};
    let score = 0;

    // Biome — quasi-éliminatoire, grande zone colorée facile à lire
    if (card.biome === (desc.biome ?? null)) score += 8;
    else score -= 8;

    // Bonus symbols — poids 3 car la position gauche/droite est maintenant fiable sur le crop
    score -= Math.abs((res.stones   ?? 0) - (desc.bonus?.stones   ?? 0)) * 3;
    score -= Math.abs((res.chimeras ?? 0) - (desc.bonus?.chimeras ?? 0)) * 3;
    score -= Math.abs((res.thistles ?? 0) - (desc.bonus?.thistles ?? 0)) * 3;
    score -= Math.abs((card.bonus?.clues ?? 0) - (desc.bonus?.clues ?? 0)) * 3;
    score -= Math.abs((card.bonus?.night ?? 0) - (desc.bonus?.night ?? 0)) * 3;

    // Quest points — déjà filtré en amont, on booste juste la correspondance
    const cardPoints = card.quests?.[0]?.reward?.points ?? null;
    if (descPoints !== null && cardPoints === descPoints) score += 10;

    // Quest (type + détails)
    const cardQuests = card.quests ?? [];
    const descQuest  = desc.quest;

    if (!descQuest && cardQuests.length === 0) {
      score += 8; // fort accord : ni Groq ni la DB ne voient de quête
    } else if (!descQuest && cardQuests.length > 0) {
      score -= 6;
    } else if (descQuest && cardQuests.length === 0) {
      score -= 6;
    } else if (descQuest && cardQuests.length > 0) {
      const q = cardQuests[0];
      // Type — poids augmenté quand les points correspondent (seul discriminant restant)
      const samePoints = cardPoints === descPoints;
      if (q.reward?.type === descQuest.type) score += samePoints ? 8 : 4;
      else score -= samePoints ? 6 : 2;
      // Resource
      if (descQuest.resource && q.reward?.resource === descQuest.resource) score += 2;
      // Biomes
      if (descQuest.biomes && q.reward?.biomes) {
        const overlap = descQuest.biomes.filter(b => q.reward.biomes.includes(b)).length;
        score += overlap * 2;
      }
      // Description libre du symbole — keywords pour night vs clue
      const symDesc = (desc.quest_symbol_desc ?? '').toLowerCase();
      if (symDesc) {
        const isNightDesc = symDesc.includes('ring') || symDesc.includes('circle') || symDesc.includes('night') || symDesc.includes('moon');
        const isClueDesc  = symDesc.includes('parchment') || symDesc.includes('scroll') || symDesc.includes('map') || symDesc.includes('clue');
        if (isNightDesc && q.reward?.type === 'per_night') score += 4;
        if (isNightDesc && q.reward?.type === 'per_clue')  score -= 4;
        if (isClueDesc  && q.reward?.type === 'per_clue')  score += 4;
        if (isClueDesc  && q.reward?.type === 'per_night') score -= 4;
      }
    }

    return { id, score };
  });

  candidates.sort((a, b) => b.score - a.score);
  const best   = candidates[0];
  const second = candidates[1];

  const confidence =
    best.score >= 5 && best.score > second.score + 2 ? 'high' :
    best.score >= 0                                   ? 'low'  : 'none';

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

  const resized = await resizeToBase64(photoUri);

  // 1. Groq lit les régions (photo complète)
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

  // 3. Groq décrit les sanctuaires — photo complète + image de référence des symboles
  if (sanctuaryCount > 0) {
    const symbolsBase64 = await loadSymbolsReference();
    const sanctRaw = await callGroqSanctuaries(resized.base64, symbolsBase64, sanctuaryCount, regionIds, apiKey);
    const sanctData = parseModelJSON(sanctRaw);

    const sanctuaries = sanctData.sanctuaries ?? [];
    const usedIds = new Set();

    for (let i = 0; i < sanctuaries.length; i++) {
      const match = matchSanctuary(sanctuaries[i], usedIds);
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
