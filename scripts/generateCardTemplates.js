/**
 * Génère les fichiers JSON template pour les cartes Région et Sanctuaire.
 * Lance avec : node scripts/generateCardTemplates.js
 *
 * ─── FORMAT DES QUÊTES ────────────────────────────────────────────────────
 *
 * Chaque quête a :
 *   - condition : null  →  aucune condition à remplir
 *                { stones, chimeras, thistles }  →  avoir au moins ces ressources
 *
 *   - reward : un objet parmi les 7 types :
 *
 *   { type: "fixed", points: 5 }
 *     → 5 points directs
 *
 *   { type: "per_resource", points: 2, resource: "chimeras" }
 *     → 2 pts par chimère  (resource: "stones" | "chimeras" | "thistles")
 *
 *   { type: "per_resource_group", points: 7, resources: { stones: 1, chimeras: 1, thistles: 1 } }
 *     → 7 pts par groupe complet (ici : 1 pierre + 1 chimère + 1 chardon)
 *
 *   { type: "per_night", points: 3 }
 *     → 3 pts par carte Région jouée la nuit
 *
 *   { type: "per_clue", points: 2 }
 *     → 2 pts par indice (toutes sources confondues : régions + sanctuaires)
 *
 *   { type: "per_biome", points: 4, biomes: ["rouge"] }
 *     → 4 pts par carte rouge  (OR si plusieurs : rouge OU jaune)
 *
 *   { type: "per_biome_group", points: 10, biomes: ["jaune", "rouge", "vert", "bleu"] }
 *     → 10 pts par groupe complet contenant 1 carte de chaque couleur listée
 *
 * ─── BIOMES ───────────────────────────────────────────────────────────────
 *   "vert" | "jaune" | "rouge" | "bleu" | null  (null = sans couleur, extension)
 */

const fs = require('fs');
const path = require('path');

// ─── Exemples remplis ──────────────────────────────────────────────────────

const REGION_EXAMPLES = {
  1: {
    biome: "vert",
    duration: 5,
    timeOfDay: "day",
    clues: 1,
    resources: { stones: 1, chimeras: 0, thistles: 0 },
    quests: [
      { condition: null, reward: { type: "fixed", points: 3 } }
    ]
  },
  2: {
    biome: "jaune",
    duration: 12,
    timeOfDay: "day",
    clues: 0,
    resources: { stones: 0, chimeras: 1, thistles: 0 },
    quests: [
      {
        condition: { stones: 2, chimeras: 1, thistles: 0 },
        reward: { type: "per_resource", points: 2, resource: "chimeras" }
      }
    ]
  },
  3: {
    biome: "rouge",
    duration: 8,
    timeOfDay: "night",
    clues: 0,
    resources: { stones: 0, chimeras: 0, thistles: 1 },
    quests: [
      {
        condition: null,
        reward: { type: "per_resource_group", points: 7, resources: { stones: 1, chimeras: 1, thistles: 1 } }
      }
    ]
  },
  4: {
    biome: "bleu",
    duration: 21,
    timeOfDay: "day",
    clues: 2,
    resources: { stones: 1, chimeras: 1, thistles: 0 },
    quests: [
      { condition: null, reward: { type: "per_night", points: 3 } },
      { condition: null, reward: { type: "per_clue", points: 2 } }
    ]
  },
  5: {
    biome: "rouge",
    duration: 34,
    timeOfDay: "day",
    clues: 0,
    resources: { stones: 0, chimeras: 0, thistles: 0 },
    quests: [
      { condition: null, reward: { type: "per_biome", points: 4, biomes: ["rouge"] } }
    ]
  },
  6: {
    biome: "vert",
    duration: 47,
    timeOfDay: "night",
    clues: 1,
    resources: { stones: 0, chimeras: 1, thistles: 0 },
    quests: [
      { condition: null, reward: { type: "per_biome", points: 2, biomes: ["rouge", "jaune"] } }
    ]
  },
  7: {
    biome: null,
    duration: 62,
    timeOfDay: "day",
    clues: 0,
    resources: { stones: 1, chimeras: 0, thistles: 0 },
    quests: [
      { condition: null, reward: { type: "per_biome_group", points: 10, biomes: ["jaune", "rouge", "vert", "bleu"] } }
    ]
  },
};

const SANCTUARY_EXAMPLES = {
  1: {
    biome: null,
    bonus: { clues: 1, resources: { stones: 0, chimeras: 1, thistles: 0 } },
    quests: [
      { condition: null, reward: { type: "fixed", points: 4 } }
    ]
  },
  2: {
    biome: "vert",
    bonus: { clues: 0, resources: { stones: 2, chimeras: 0, thistles: 0 } },
    quests: [
      {
        condition: { stones: 3, chimeras: 1, thistles: 0 },
        reward: { type: "per_biome", points: 3, biomes: ["vert"] }
      }
    ]
  },
};

// ─── Templates vides ───────────────────────────────────────────────────────

function emptyRegion(id) {
  return {
    biome: "",
    duration: id,
    timeOfDay: "day",
    clues: 0,
    resources: { stones: 0, chimeras: 0, thistles: 0 },
    quests: []
  };
}

function emptySanctuary() {
  return {
    biome: null,
    bonus: { clues: 0, resources: { stones: 0, chimeras: 0, thistles: 0 } },
    quests: []
  };
}

// ─── Génération ────────────────────────────────────────────────────────────

function buildRegionCards() {
  const cards = {};
  for (let id = 0; id <= 76; id++) {
    cards[id] = REGION_EXAMPLES[id] ?? emptyRegion(id);
  }
  return cards;
}

function buildSanctuaryCards() {
  const cards = {};
  for (let id = 1; id <= 53; id++) {
    cards[id] = SANCTUARY_EXAMPLES[id] ?? emptySanctuary();
  }
  return cards;
}

// ─── Écriture ──────────────────────────────────────────────────────────────

const OUT_DIR = path.join(__dirname, '../src/data');
fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(path.join(OUT_DIR, 'region_cards.json'),    JSON.stringify(buildRegionCards(),    null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'sanctuary_cards.json'), JSON.stringify(buildSanctuaryCards(), null, 2));

console.log('✅ region_cards.json    — cartes 0 à 76');
console.log('✅ sanctuary_cards.json — cartes 1 à 53');
