/**
 * scoring.js — Moteur de décompte des points Faraway
 *
 * Règle fondamentale : les cartes Région sont révélées de droite à gauche
 * (ordre inverse de jeu). Chaque carte est évaluée avec le contexte cumulatif
 * de toutes les cartes déjà révélées (elle-même + celles à sa droite)
 * + tous les Sanctuaires (toujours visibles).
 *
 * Les quêtes des Sanctuaires sont calculées en dernier, avec le contexte
 * complet (toutes les régions + tous les sanctuaires).
 */

import regionCardsData    from '../data/region_cards.json';
import sanctuaryCardsData from '../data/sanctuary_cards.json';

// ─── Contexte de scoring ───────────────────────────────────────────────────

/**
 * Construit le contexte agrégé (ressources, indices, nuits, biomes)
 * depuis un ensemble de cartes Région visibles + tous les Sanctuaires.
 *
 * @param {number[]} visibleRegionIds  - IDs des régions actuellement face visible
 * @param {number[]} sanctuaryIds      - IDs de tous les sanctuaires du joueur
 */
function buildContext(visibleRegionIds, sanctuaryIds) {
  const ctx = {
    stones:   0,
    chimeras: 0,
    thistles: 0,
    clues:    0,
    nights:   0,           // nb de cartes nuit (régions + sanctuaires bonus.night)
    biomes:   { vert: 0, jaune: 0, rouge: 0, bleu: 0 },
    regionCount: visibleRegionIds.length,
  };

  // ── Régions visibles ──
  for (const id of visibleRegionIds) {
    const card = regionCardsData[id];
    if (!card) continue;

    ctx.stones   += card.resources.stones;
    ctx.chimeras += card.resources.chimeras;
    ctx.thistles += card.resources.thistles;
    ctx.clues    += card.clues;
    if (card.timeOfDay === 'night') ctx.nights++;
    if (card.biome && ctx.biomes[card.biome] !== undefined) {
      ctx.biomes[card.biome]++;
    }
  }

  // ── Sanctuaires ──
  for (const id of sanctuaryIds) {
    const card = sanctuaryCardsData[id];
    if (!card) continue;

    ctx.stones   += card.bonus.resources.stones;
    ctx.chimeras += card.bonus.resources.chimeras;
    ctx.thistles += card.bonus.resources.thistles;
    ctx.clues    += card.bonus.clues;
    if (card.bonus.night) ctx.nights += card.bonus.night;
    // Un sanctuaire avec un biome compte comme une carte de ce biome
    if (card.biome && ctx.biomes[card.biome] !== undefined) {
      ctx.biomes[card.biome]++;
    }
  }

  return ctx;
}

// ─── Vérification de condition ─────────────────────────────────────────────

/**
 * Vérifie si la condition d'une quête est remplie dans le contexte donné.
 * condition null = toujours remplie.
 */
function conditionMet(condition, ctx) {
  if (!condition) return true;

  const { stones = 0, chimeras = 0, thistles = 0 } = condition;
  return (
    ctx.stones   >= stones &&
    ctx.chimeras >= chimeras &&
    ctx.thistles >= thistles
  );
}

// ─── Calcul de la récompense ───────────────────────────────────────────────

/**
 * Calcule les points apportés par une récompense dans le contexte donné.
 */
function calcReward(reward, ctx) {
  switch (reward.type) {

    case 'fixed':
      return reward.points;

    case 'per_resource':
      return reward.points * ctx[reward.resource];

    case 'per_resource_group': {
      // Nombre de groupes complets possibles
      const { stones = 0, chimeras = 0, thistles = 0 } = reward.resources;
      const groups = Math.min(
        stones   > 0 ? Math.floor(ctx.stones   / stones)   : Infinity,
        chimeras > 0 ? Math.floor(ctx.chimeras / chimeras) : Infinity,
        thistles > 0 ? Math.floor(ctx.thistles / thistles) : Infinity,
      );
      return reward.points * (groups === Infinity ? 0 : groups);
    }

    case 'per_night':
      return reward.points * ctx.nights;

    case 'per_clue':
      return reward.points * ctx.clues;

    case 'per_biome': {
      // OR : total des cartes dont le biome est dans la liste
      const total = reward.biomes.reduce((sum, b) => sum + (ctx.biomes[b] ?? 0), 0);
      return reward.points * total;
    }

    case 'per_biome_group': {
      // Nombre de groupes complets (1 carte de chaque couleur listée)
      const groups = Math.min(...reward.biomes.map((b) => ctx.biomes[b] ?? 0));
      return reward.points * groups;
    }

    default:
      return 0;
  }
}

// ─── Scoring d'une quête ───────────────────────────────────────────────────

function scoreQuest(quest, ctx) {
  if (!conditionMet(quest.condition, ctx)) return 0;
  return calcReward(quest.reward, ctx);
}

// ─── Fonction principale ───────────────────────────────────────────────────

/**
 * Calcule le score final d'un joueur.
 *
 * @param {{id: number}[]} regions     - 8 cartes Région dans l'ordre de jeu (index 0 = 1ère jouée)
 * @param {{id: number}[]} sanctuaries - Sanctuaires du joueur
 * @returns {{
 *   total: number,
 *   breakdown: Array<{
 *     source: 'region' | 'sanctuary',
 *     cardId: number,
 *     quests: Array<{ fame: number, conditionMet: boolean }>,
 *     subtotal: number,
 *   }>,
 *   tiebreaker: number,  // somme des durées d'exploration (plus petit = gagne)
 * }}
 */
export function calculateScore(regions, sanctuaries) {
  const regionIds    = regions.map((r) => r.id);
  const sanctuaryIds = sanctuaries.map((s) => s.id);
  const breakdown    = [];
  let total          = 0;

  // ── Révélation de droite à gauche ──
  // On commence par la carte la plus à droite (dernière jouée, index 7)
  // et on accumule les cartes visibles au fur et à mesure
  const visibleRegions = [];

  for (let i = regionIds.length - 1; i >= 0; i--) {
    const cardId = regionIds[i];
    visibleRegions.unshift(cardId); // ajoute en tête pour maintenir l'ordre

    const ctx   = buildContext(visibleRegions, sanctuaryIds);
    const card  = regionCardsData[cardId];
    if (!card) continue;

    const questResults = (card.quests || []).map((q) => {
      const met  = conditionMet(q.condition, ctx);
      const fame = met ? calcReward(q.reward, ctx) : 0;
      return { fame, conditionMet: met };
    });

    const subtotal = questResults.reduce((s, q) => s + q.fame, 0);
    total += subtotal;

    breakdown.unshift({
      source:   'region',
      cardId,
      playIndex: i,
      quests:   questResults,
      subtotal,
    });
  }

  // ── Quêtes des Sanctuaires (contexte complet) ──
  const fullCtx = buildContext(regionIds, sanctuaryIds);

  for (const cardId of sanctuaryIds) {
    const card = sanctuaryCardsData[cardId];
    if (!card) continue;

    const questResults = (card.quests || []).map((q) => {
      const met  = conditionMet(q.condition, fullCtx);
      const fame = met ? calcReward(q.reward, fullCtx) : 0;
      return { fame, conditionMet: met };
    });

    const subtotal = questResults.reduce((s, q) => s + q.fame, 0);
    total += subtotal;

    breakdown.push({
      source:   'sanctuary',
      cardId,
      quests:   questResults,
      subtotal,
    });
  }

  // ── Tiebreaker : somme des durées d'exploration ──
  const tiebreaker = regionIds.reduce((sum, id) => {
    const card = regionCardsData[id];
    return sum + (card?.duration ?? 0);
  }, 0);

  return { total, breakdown, tiebreaker };
}

/**
 * Calcule et classe les scores de tous les joueurs.
 *
 * @param {Array<{ name: string, regions: {id}[], sanctuaries: {id}[] }>} players
 * @returns {Array<{ name, total, tiebreaker, breakdown, rank }>} triés par rang
 */
export function calculateAllScores(players) {
  const results = players.map((player) => ({
    name: player.name,
    ...calculateScore(player.regions, player.sanctuaries),
  }));

  // Tri : score décroissant, tiebreaker croissant en cas d'égalité
  results.sort((a, b) =>
    b.total !== a.total
      ? b.total - a.total
      : a.tiebreaker - b.tiebreaker
  );

  // Attribution des rangs (ex-æquo possibles)
  let rank = 1;
  for (let i = 0; i < results.length; i++) {
    if (i > 0 && (results[i].total !== results[i-1].total || results[i].tiebreaker !== results[i-1].tiebreaker)) {
      rank = i + 1;
    }
    results[i].rank = rank;
  }

  return results;
}
