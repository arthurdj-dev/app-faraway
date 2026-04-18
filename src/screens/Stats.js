import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getHistory } from '../utils/storage';
import { calculateScore } from '../utils/scoring';
import { getSanctuaryImage } from '../utils/sanctuaryImages';
import { COLORS, FONTS, SPACING } from '../constants/theme';

// ─── Compute ────────────────────────────────────────────────────────────────

function computeStats(games) {
  let bestScore  = null;
  let worstScore = null;
  let mostZeros  = null; // { name, count, date, regions, sanctuaries }
  let bestCard   = null; // { name, points, date, regions, sanctuaries }

  const playerMap = {};

  for (const game of games) {
    for (const p of game.players) {
      if (!playerMap[p.name]) {
        playerMap[p.name] = { games: 0, wins: 0, scores: [] };
      }
      const pm = playerMap[p.name];
      pm.games++;
      pm.scores.push(p.total);
      if (p.rank === 1) pm.wins++;

      const regions = p.regions ?? [];
      const sanctuaries = p.sanctuaries ?? [];

      if (!bestScore || p.total > bestScore.score) {
        bestScore = { name: p.name, score: p.total, date: game.date, regions, sanctuaries };
      }
      if (!worstScore || p.total < worstScore.score) {
        worstScore = { name: p.name, score: p.total, date: game.date, regions, sanctuaries };
      }

      if (regions.length > 0) {
        try {
          const result = calculateScore(regions, sanctuaries);
          let zeros = 0;
          let topCard = 0;
          for (const b of result.breakdown) {
            if (b.subtotal === 0) zeros++;
            if (b.subtotal > topCard) topCard = b.subtotal;
          }
          if (!mostZeros || zeros > mostZeros.count) {
            mostZeros = { name: p.name, count: zeros, date: game.date, regions, sanctuaries };
          }
          if (!bestCard || topCard > bestCard.points) {
            bestCard = { name: p.name, points: topCard, date: game.date, regions, sanctuaries };
          }
        } catch (e) {
          if (__DEV__) console.warn('[Stats] scoring error:', e);
        }
      }
    }
  }

  const players = Object.entries(playerMap).map(([name, data]) => ({
    name,
    games: data.games,
    wins: data.wins,
    best: Math.max(...data.scores),
    worst: Math.min(...data.scores),
    avg: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
    winRate: data.games > 0 ? Math.round((data.wins / data.games) * 100) : 0,
  }));

  players.sort((a, b) => b.games - a.games);

  return { bestScore, worstScore, mostZeros, bestCard, players };
}

// ─── Board Preview (plateau visuel) ─────────────────────────────────────────

function BoardPreview({ regions, sanctuaries, onClose, title }) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();

  const gap = 6;
  const padH = SPACING.md;
  const gridW = winW - padH * 2;
  const regionW = (gridW - gap * 4) / 4;
  const regionH = regionW * 1.4;

  const sanctCount = Math.max(1, sanctuaries.length);
  const sanctW = Math.min(regionW * 0.7, (gridW - gap * (sanctCount - 1)) / sanctCount);
  const sanctH = sanctW * 1.4;

  const regionsRow1 = regions.slice(0, 4);
  const regionsRow2 = regions.slice(4, 8);

  return (
    <View style={styles.boardOverlay}>
      <View style={[styles.boardSheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
        <View style={styles.boardHeader}>
          <Text style={styles.boardTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.boardClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.boardGrid, { padding: padH, gap }]}>
          {sanctuaries.length > 0 && (
            <View style={[styles.boardRow, { gap, justifyContent: 'center' }]}>
              {sanctuaries.map((s, i) => {
                const img = getSanctuaryImage(s.id);
                return (
                  <View key={i} style={[styles.sanctCell, { width: sanctW, height: sanctH }]}>
                    {img ? (
                      <Image source={img} style={styles.sanctImg} resizeMode="cover" />
                    ) : (
                      <Text style={styles.cellPlaceholder}>?</Text>
                    )}
                    <View style={styles.sanctTag}>
                      <Text style={styles.sanctTagTxt}>#{s.id}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={[styles.boardRow, { gap }]}>
            {regionsRow1.map((r, i) => (
              <View key={i} style={[styles.regionCell, { width: regionW, height: regionH }]}>
                <Text style={[styles.regionNum, { fontSize: regionW * 0.34 }]}>
                  #{r.id}
                </Text>
              </View>
            ))}
          </View>

          <View style={[styles.boardRow, { gap }]}>
            {regionsRow2.map((r, i) => (
              <View key={i} style={[styles.regionCell, { width: regionW, height: regionH }]}>
                <Text style={[styles.regionNum, { fontSize: regionW * 0.34 }]}>
                  #{r.id}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Player Detail ──────────────────────────────────────────────────────────

function PlayerDetail({ player, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.detailOverlay}>
      <View style={[styles.detailSheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailName}>{player.name}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.detailClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.detailGames}>
          {player.games} partie{player.games > 1 ? 's' : ''}
        </Text>
        <View style={styles.detailGrid}>
          <View style={styles.detailCell}>
            <Text style={styles.detailCellValue}>{player.best}</Text>
            <Text style={styles.detailCellLabel}>Meilleur</Text>
          </View>
          <View style={styles.detailCell}>
            <Text style={styles.detailCellValue}>{player.worst}</Text>
            <Text style={styles.detailCellLabel}>Pire</Text>
          </View>
          <View style={styles.detailCell}>
            <Text style={styles.detailCellValue}>{player.avg}</Text>
            <Text style={styles.detailCellLabel}>Moyen</Text>
          </View>
          <View style={styles.detailCell}>
            <Text style={styles.detailCellValue}>{player.winRate}%</Text>
            <Text style={styles.detailCellLabel}>Victoires</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function Stats({ isActive }) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [games, setGames] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [boardView, setBoardView] = useState(null);

  const loadGames = useCallback(async () => {
    const h = await getHistory();
    setGames(h);
  }, []);

  useEffect(() => {
    if (isActive) loadGames();
  }, [isActive, loadGames]);

  const stats = useMemo(() => computeStats(games), [games]);

  const gap = SPACING.sm;
  const cardW = (winW - SPACING.md * 2 - gap) / 2;

  if (games.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Statistiques</Text>
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🏆</Text>
          <Text style={styles.emptyText}>Pas encore de statistiques</Text>
          <Text style={styles.emptySubtext}>
            Jouez quelques parties pour voir vos statistiques apparaître ici.
          </Text>
        </View>
      </View>
    );
  }

  const generalCards = [
    stats.bestScore && {
      icon: '🏆', label: 'Meilleur score',
      value: `${stats.bestScore.score}`, sub: stats.bestScore.name,
      tappable: true,
      onPress: () => setBoardView({
        title: `🏆 ${stats.bestScore.name} — ${stats.bestScore.score} pts`,
        regions: stats.bestScore.regions,
        sanctuaries: stats.bestScore.sanctuaries,
      }),
    },
    stats.worstScore && {
      icon: '💀', label: 'Pire score',
      value: `${stats.worstScore.score}`, sub: stats.worstScore.name,
      tappable: true,
      onPress: () => setBoardView({
        title: `💀 ${stats.worstScore.name} — ${stats.worstScore.score} pts`,
        regions: stats.worstScore.regions,
        sanctuaries: stats.worstScore.sanctuaries,
      }),
    },
    stats.mostZeros && {
      icon: '🃏', label: 'Cartes à 0 pts',
      value: `${stats.mostZeros.count}`, sub: stats.mostZeros.name,
      tappable: true,
      onPress: () => setBoardView({
        title: `🃏 ${stats.mostZeros.name} — ${stats.mostZeros.count} carte${stats.mostZeros.count > 1 ? 's' : ''} à 0`,
        regions: stats.mostZeros.regions,
        sanctuaries: stats.mostZeros.sanctuaries,
      }),
    },
    stats.bestCard && {
      icon: '⭐', label: 'Meilleure carte',
      value: `${stats.bestCard.points}`, sub: stats.bestCard.name,
      tappable: true,
      onPress: () => setBoardView({
        title: `⭐ ${stats.bestCard.name} — ${stats.bestCard.points} pts en 1 carte`,
        regions: stats.bestCard.regions,
        sanctuaries: stats.bestCard.sanctuaries,
      }),
    },
  ].filter(Boolean);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Statistiques</Text>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + SPACING.lg }]}
      >
        {/* ── Grille 2×2 stats générales ── */}
        <View style={[styles.generalGrid, { gap }]}>
          {generalCards.map((c, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.generalCard, { width: cardW }]}
              activeOpacity={c.tappable ? 0.7 : 1}
              onPress={c.onPress}
              disabled={!c.tappable}
            >
              <Text style={styles.gcIcon}>{c.icon}</Text>
              <Text style={styles.gcValue}>{c.value}</Text>
              <Text style={styles.gcLabel}>{c.label}</Text>
              <Text style={styles.gcSub} numberOfLines={1}>{c.sub}</Text>
              {c.tappable && <Text style={styles.gcTap}>Voir le plateau →</Text>}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Joueurs ── */}
        <Text style={styles.playersTitle}>Joueurs</Text>
        <View style={[styles.playersGrid, { gap }]}>
          {stats.players.map((p) => (
            <TouchableOpacity
              key={p.name}
              style={[styles.playerCard, { width: cardW }]}
              activeOpacity={0.7}
              onPress={() => setSelectedPlayer(p)}
            >
              <Text style={styles.playerName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.playerGames}>
                {p.games} partie{p.games > 1 ? 's' : ''}
              </Text>
              <Text style={styles.playerWinRate}>{p.winRate}% victoires</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ── Modal joueur ── */}
      <Modal
        visible={selectedPlayer !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPlayer(null)}
      >
        {selectedPlayer && (
          <PlayerDetail
            player={selectedPlayer}
            onClose={() => setSelectedPlayer(null)}
          />
        )}
      </Modal>

      {/* ── Modal plateau record ── */}
      <Modal
        visible={boardView !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setBoardView(null)}
      >
        {boardView && (
          <BoardPreview
            title={boardView.title}
            regions={boardView.regions ?? []}
            sanctuaries={boardView.sanctuaries ?? []}
            onClose={() => setBoardView(null)}
          />
        )}
      </Modal>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  title: {
    fontSize: FONTS.title, fontWeight: '700', color: COLORS.text,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.lg, paddingBottom: SPACING.md,
  },
  scroll: { paddingHorizontal: SPACING.md },

  // ── General 2×2 grid ──
  generalGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
  },
  generalCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
    gap: 2,
  },
  gcIcon: { fontSize: 28, marginBottom: SPACING.xs },
  gcValue: { fontSize: 32, fontWeight: '900', color: COLORS.primary },
  gcLabel: { fontSize: FONTS.small, color: COLORS.textLight, fontWeight: '600', textAlign: 'center' },
  gcSub: { fontSize: FONTS.small, color: COLORS.text, fontWeight: '700', textAlign: 'center' },
  gcTap: { fontSize: 10, color: COLORS.primary, fontWeight: '600', marginTop: SPACING.xs },

  // ── Players grid ──
  playersTitle: {
    fontSize: FONTS.subtitle, fontWeight: '700', color: COLORS.text,
    marginTop: SPACING.lg, marginBottom: SPACING.sm,
  },
  playersGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
  },
  playerCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    alignItems: 'center',
    gap: 2,
  },
  playerName: { fontSize: FONTS.body, fontWeight: '700', color: COLORS.text },
  playerGames: { fontSize: FONTS.small, color: COLORS.textLight },
  playerWinRate: { fontSize: FONTS.small, color: COLORS.primary, fontWeight: '600' },

  // ── Player detail modal ──
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  detailSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: SPACING.md,
  },
  detailHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  detailName: { fontSize: FONTS.title, fontWeight: '700', color: COLORS.text },
  detailClose: { fontSize: FONTS.subtitle, color: COLORS.textLight, padding: SPACING.xs },
  detailGames: { fontSize: FONTS.small, color: COLORS.textLight, marginBottom: SPACING.md },
  detailGrid: { flexDirection: 'row', gap: SPACING.sm },
  detailCell: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  detailCellValue: { fontSize: FONTS.title, fontWeight: '900', color: COLORS.primary },
  detailCellLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: '600' },

  // ── Board preview modal ──
  boardOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  boardSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: SPACING.md,
  },
  boardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  boardTitle: { fontSize: FONTS.subtitle, fontWeight: '700', color: COLORS.text, flex: 1 },
  boardClose: { fontSize: FONTS.subtitle, color: COLORS.textLight, padding: SPACING.xs },
  boardGrid: {},
  boardRow: { flexDirection: 'row', alignItems: 'flex-end' },

  regionCell: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionNum: { fontWeight: '700', color: COLORS.text },

  sanctCell: {
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    overflow: 'hidden',
    backgroundColor: COLORS.cardBg,
  },
  sanctImg: { width: '100%', height: '100%' },
  sanctTag: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 1,
  },
  sanctTagTxt: { color: COLORS.white, fontSize: 10, textAlign: 'center', fontWeight: '700' },
  cellPlaceholder: { fontSize: 18, color: COLORS.textLight, fontWeight: '700' },

  // ── Empty state ──
  empty: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: SPACING.sm, paddingHorizontal: SPACING.xl,
  },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.subtitle, fontWeight: '600', color: COLORS.text, textAlign: 'center' },
  emptySubtext: { fontSize: FONTS.body, color: COLORS.textLight, textAlign: 'center' },
});
