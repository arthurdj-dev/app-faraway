/**
 * Reconnaissance de cartes Sanctuaire par comparaison de hashes.
 *
 * Utilise sanctuary_hashes.json généré par scripts/generateSanctuaryHashes.js
 * et sanctuary_cards.json pour les données de chaque carte.
 */

import { computeHash, hammingDistance } from './imageHash';

// Seuil de confiance : distance ≤ 10 bits sur 64 → correspondance fiable
const HIGH_CONFIDENCE_THRESHOLD = 10;
// Distance ≤ 20 → correspondance probable (à confirmer)
const LOW_CONFIDENCE_THRESHOLD = 20;

let sanctuaryHashes = null;
let sanctuaryCards = null;

function loadData() {
  if (!sanctuaryHashes) {
    try {
      sanctuaryHashes = require('../data/sanctuary_hashes.json');
    } catch {
      sanctuaryHashes = {};
    }
  }
  if (!sanctuaryCards) {
    try {
      sanctuaryCards = require('../data/sanctuary_cards.json');
    } catch {
      sanctuaryCards = {};
    }
  }
}

/**
 * Reconnaît une carte Sanctuaire depuis l'URI d'une photo.
 *
 * @param {string} imageUri - URI local de la photo prise par la caméra
 * @returns {Promise<{
 *   bestMatch: number|null,
 *   confidence: 'high'|'low'|'none',
 *   distance: number,
 *   candidates: Array<{id: number, distance: number}>
 * }>}
 */
export async function recognizeSanctuary(imageUri) {
  loadData();

  const capturedHash = await computeHash(imageUri);

  const candidates = [];

  for (const [idStr, { hashes }] of Object.entries(sanctuaryHashes)) {
    const id = parseInt(idStr);
    // On garde la distance minimale parmi toutes les photos de référence de cette carte
    const minDist = Math.min(...hashes.map((h) => hammingDistance(capturedHash, h)));
    candidates.push({ id, distance: minDist });
  }

  candidates.sort((a, b) => a.distance - b.distance);

  if (candidates.length === 0) {
    return { bestMatch: null, confidence: 'none', distance: Infinity, candidates: [] };
  }

  const best = candidates[0];
  const confidence =
    best.distance <= HIGH_CONFIDENCE_THRESHOLD
      ? 'high'
      : best.distance <= LOW_CONFIDENCE_THRESHOLD
      ? 'low'
      : 'none';

  return {
    bestMatch: confidence !== 'none' ? best.id : null,
    confidence,
    distance: best.distance,
    candidates: candidates.slice(0, 3),
  };
}

/**
 * Récupère les données d'une carte Sanctuaire par son ID.
 * @param {number} id
 * @returns {object|null}
 */
export function getSanctuaryCard(id) {
  loadData();
  return sanctuaryCards[id] ?? null;
}
