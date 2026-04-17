/**
 * Écran Résultats — feuille de score style Faraway
 *
 * Lignes : carte 1 → 8 (points par région), sanctuaires, total
 * Colonnes : une par joueur (adaptatif)
 * Gagnant mis en évidence (colonne surlignée + couronne)
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateAllScores } from '../utils/scoring';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const { width: SCREEN_W } = Dimensions.get('window');

const ROW_LABEL_W = 36;
const ROW_H       = 44;
const HEADER_H    = 56;
const TOTAL_H     = 56;

export default function Results({ players, onNewGame, backLabel }) {
  const insets = useSafeAreaInsets();

  const scored = useMemo(() => calculateAllScores(players), [players]);
  const n      = scored.length;

  // Largeur de chaque colonne joueur
  const colW = Math.max(64, Math.floor((SCREEN_W - ROW_LABEL_W) / n));

  // Points par région pour chaque joueur (index 0 = région jouée en 1ère)
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

  const winner = scored[0]; // déjà trié

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Titre ── */}
      <Text style={styles.title}>Résultats</Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SPACING.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Grille ── */}
        <View style={styles.grid}>

          {/* En-tête : noms des joueurs */}
          <View style={styles.row}>
            <View style={[styles.labelCell, { height: HEADER_H }]} />
            {scored.map((p) => {
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
                  {isWinner && <Text style={styles.crown}>👑</Text>}
                  <Text
                    style={[styles.headerName, isWinner && styles.winnerName]}
                    numberOfLines={1}
                  >
                    {p.name || '—'}
                  </Text>
                  {p.rank > 1 && (
                    <Text style={styles.rankText}>#{p.rank}</Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Lignes Régions 1–8 */}
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={[styles.row, i % 2 === 0 && styles.rowAlt]}>
              <View style={[styles.labelCell, { height: ROW_H }]}>
                <Text style={styles.labelText}>{i + 1}</Text>
              </View>
              {scored.map((p) => {
                const pts = regionPoints(p, i);
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

          {/* Ligne séparatrice */}
          <View style={styles.divider} />

          {/* Ligne Sanctuaires */}
          <View style={styles.row}>
            <View style={[styles.labelCell, { height: ROW_H }]}>
              <Text style={styles.labelIcon}>⛩</Text>
            </View>
            {scored.map((p) => {
              const pts = sanctuaryPoints(p);
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

          {/* Ligne Total */}
          <View style={[styles.row, styles.totalRow]}>
            <View style={[styles.labelCell, { height: TOTAL_H }]}>
              <Text style={styles.totalLabel}>T</Text>
            </View>
            {scored.map((p) => {
              const isWinner = p.rank === 1;
              return (
                <View
                  key={p.name}
                  style={[
                    styles.totalCell,
                    { width: colW, height: TOTAL_H },
                    isWinner && styles.winnerTotalCell,
                  ]}
                >
                  <Text style={[styles.totalScore, isWinner && styles.winnerTotalScore]}>
                    {p.total}
                  </Text>
                </View>
              );
            })}
          </View>

        </View>

        {/* ── Podium texte ── */}
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

      {/* ── Bouton Nouvelle partie ── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.sm }]}>
        <TouchableOpacity style={styles.newGameBtn} onPress={onNewGame} activeOpacity={0.8}>
          <Text style={styles.newGameBtnText}>{backLabel || 'Nouvelle partie'}</Text>
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

  // ── Grille ──
  grid: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  row: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardBg,
  },
  rowAlt: {
    backgroundColor: '#F0EDE8',
  },

  labelCell: {
    width: ROW_LABEL_W,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    backgroundColor: '#E8E4DE',
  },
  labelText: {
    fontSize: FONTS.subtitle,
    fontWeight: '700',
    color: COLORS.text,
  },
  labelIcon: {
    fontSize: 18,
  },

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
    borderBottomColor: COLORS.primary,
  },
  crown: { fontSize: 14 },
  headerName: {
    fontSize: FONTS.small,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  winnerName: {
    color: COLORS.primary,
  },
  rankText: {
    fontSize: 10,
    color: COLORS.textLight,
    fontWeight: '600',
  },

  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  winnerCol: {
    backgroundColor: COLORS.primary + '10',
  },
  cellText: {
    fontSize: FONTS.body,
    color: COLORS.textLight,
  },
  cellTextActive: {
    color: COLORS.text,
    fontWeight: '600',
  },

  divider: {
    height: 2,
    backgroundColor: COLORS.border,
  },

  totalRow: {
    backgroundColor: COLORS.primary,
  },
  totalCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.2)',
  },
  winnerTotalCell: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  totalLabel: {
    fontSize: FONTS.title,
    fontWeight: '900',
    color: COLORS.white,
  },
  totalScore: {
    fontSize: FONTS.title,
    fontWeight: '700',
    color: COLORS.white,
  },
  winnerTotalScore: {
    fontSize: 28,
    fontWeight: '900',
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
  podiumTie: {
    fontSize: FONTS.small,
    color: COLORS.textLight,
  },

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
