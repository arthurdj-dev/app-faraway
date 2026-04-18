import React, { useMemo } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateAllScores } from '../utils/scoring';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const BONHOMME   = require('../../assets/BonhommeFaraway-removebg-preview.png');
const SANCTUAIRE = require('../../assets/Sanctuaire-removebg-preview.png');

const ROW_LABEL_W = 40;
const ROW_H       = 40;
const HEADER_H    = 52;
const TOTAL_H     = 64;

export default function Results({ players, onNewGame, backLabel }) {
  const insets  = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const scored = useMemo(() => calculateAllScores(players), [players]);
  const n      = scored.length;

  // Display in original player order (score order kept only for podium/winner)
  const displayScored = useMemo(() => {
    const map = new Map(scored.map((p) => [p.name, p]));
    return players.map((p) => map.get(p.name) ?? p);
  }, [players, scored]);

  const colW           = Math.max(44, Math.floor((screenW - SPACING.md * 2 - ROW_LABEL_W) / n));
  const totalBoxSize  = Math.min(46, colW - 6);
  const totalFontSize = colW >= 64 ? 18 : colW >= 52 ? 16 : 14;
  const nameFontSize   = colW >= 70 ? 13 : colW >= 56 ? 11 : 9;

  function regionPoints(playerResult, playIndex) {
    const entry = playerResult.breakdown.find(
      (b) => b.source === 'region' && b.playIndex === playIndex
    );
    return entry?.subtotal ?? 0;
  }

  function sanctuaryPoints(playerResult) {
    return playerResult.breakdown
      .filter((b) => b.source === 'sanctuary')
      .reduce((s, b) => s + b.subtotal, 0);
  }

  const winner = scored[0];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      <Text style={styles.title}>Résultats</Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SPACING.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>

          {/* ── En-tête ── */}
          <View style={styles.row}>
            <View style={[styles.labelCell, styles.headerLabelCell, { height: HEADER_H }]}>
              <Image source={BONHOMME} style={styles.bonhommeImg} resizeMode="contain" />
            </View>
            {displayScored.map((p) => {
              const isWinner = p.rank === 1;
              return (
                <View
                  key={p.name}
                  style={[
                    styles.headerCell,
                    { width: colW, height: HEADER_H },
                    isWinner && styles.winnerHeaderCell,
                  ]}
                >
                  <Text
                    style={[styles.headerName, isWinner && styles.winnerName, { fontSize: nameFontSize }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {p.name || '—'}
                  </Text>
                  <Text style={[styles.rankText, isWinner && styles.crownText]}>
                    {isWinner ? '👑' : `#${p.rank}`}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* ── Régions 1–8 ── */}
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={[styles.row, i % 2 === 0 && styles.rowAlt]}>
              <View style={[styles.labelCell, { height: ROW_H }]}>
                <Text style={styles.labelText}>{i + 1}</Text>
              </View>
              {displayScored.map((p) => {
                const pts      = regionPoints(p, i);
                const isWinner = p.rank === 1;
                return (
                  <View
                    key={p.name}
                    style={[
                      styles.cell,
                      { width: colW, height: ROW_H },
                      isWinner && styles.winnerCol,
                    ]}
                  >
                    <Text style={[styles.cellText, pts > 0 && styles.cellTextActive]}>
                      {pts > 0 ? pts : '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}

          <View style={styles.divider} />

          {/* ── Sanctuaires ── */}
          <View style={styles.row}>
            <View style={[styles.labelCell, { height: ROW_H }]}>
              <Image source={SANCTUAIRE} style={styles.sanctuaireImg} resizeMode="contain" />
            </View>
            {displayScored.map((p) => {
              const pts      = sanctuaryPoints(p);
              const isWinner = p.rank === 1;
              return (
                <View
                  key={p.name}
                  style={[
                    styles.cell,
                    { width: colW, height: ROW_H },
                    isWinner && styles.winnerCol,
                  ]}
                >
                  <Text style={[styles.cellText, pts > 0 && styles.cellTextActive]}>
                    {pts > 0 ? pts : '—'}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* ── Total ── */}
          <View style={[styles.row, styles.totalRow]}>
            <View style={[styles.labelCell, styles.totalLabelCell, { height: TOTAL_H }]}>
              <Text style={styles.totalLabel}>T</Text>
            </View>
            {displayScored.map((p) => {
              const isWinner = p.rank === 1;
              return (
                <View key={p.name} style={[styles.totalCell, { width: colW, height: TOTAL_H }]}>
                  <View style={[styles.totalBox, isWinner && styles.totalBoxWinner, { width: totalBoxSize, height: totalBoxSize }]}>
                    <Text style={[styles.totalScore, { fontSize: totalFontSize }]}>
                      {p.total}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

        </View>

        {/* ── Podium ── */}
        <View style={styles.podium}>
          <Text style={styles.podiumTitle}>
            🏆 {winner.name || 'Joueur 1'} gagne avec {winner.total} points !
          </Text>
          {winner.tiebreaker !== undefined && scored[1]?.total === winner.total && (
            <Text style={styles.podiumTie}>
              Départage : durée d'exploration {winner.tiebreaker}
            </Text>
          )}
        </View>

      </ScrollView>

      {/* ── Footer ── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.sm }]}>
        <TouchableOpacity style={styles.newGameBtn} onPress={onNewGame} activeOpacity={0.8}>
          <Text style={styles.newGameBtnText}>{backLabel || 'Terminer'}</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  title: {
    fontSize: FONTS.title,
    fontWeight: '700',
    color: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },

  grid: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  row: { flexDirection: 'row', backgroundColor: COLORS.cardBg },
  rowAlt: { backgroundColor: '#F0EDE8' },

  // ── Colonne label gauche ──
  labelCell: {
    width: ROW_LABEL_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    backgroundColor: '#E8E4DE',
  },
  headerLabelCell: {
    backgroundColor: '#D8D0C8',
  },
  totalLabelCell: {
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  labelText: {
    fontSize: FONTS.subtitle,
    fontWeight: '700',
    color: COLORS.text,
  },
  bonhommeImg: {
    width: 28,
    height: 28,
  },
  sanctuaireImg: {
    width: 26,
    height: 26,
    tintColor: COLORS.text,
  },

  // ── En-tête joueurs ──
  headerCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
    paddingHorizontal: SPACING.xs,
    gap: 2,
    backgroundColor: '#E8E4DE',
  },
  winnerHeaderCell: {
    backgroundColor: COLORS.primary + '22',
    borderBottomColor: COLORS.border,
  },
  headerName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  winnerName: { color: COLORS.primary },
  rankText: { fontSize: 10, color: COLORS.textLight, fontWeight: '600' },
  crownText: { fontSize: 12, color: COLORS.primary },

  // ── Cellules données ──
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  winnerCol: { backgroundColor: COLORS.primary + '10' },
  cellText: { fontSize: FONTS.body, color: COLORS.textLight },
  cellTextActive: { color: COLORS.text, fontWeight: '600' },

  divider: { height: 2, backgroundColor: COLORS.border },

  // ── Ligne total ──
  totalRow: { backgroundColor: COLORS.primary },
  totalCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.15)',
  },
  totalBox: {
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalBoxWinner: {
    borderColor: COLORS.white,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  totalLabel: {
    fontSize: FONTS.title,
    fontWeight: '900',
    color: COLORS.white,
  },
  totalScore: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.white,
  },
  // ── Podium ──
  podium: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  podiumTitle: {
    fontSize: FONTS.subtitle,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  podiumTie: { fontSize: FONTS.small, color: COLORS.textLight },

  // ── Footer ──
  footer: {
    padding: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  newGameBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  newGameBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: FONTS.subtitle,
  },
});
