import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getHistory, deleteGame } from '../utils/storage';
import Results from './Results';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const BONHOMME = require('../../assets/BonhommeFaraway-removebg-preview.png');

const MINI_LABEL_W = 32;
const MINI_HEADER_H = 44;
const MINI_TOTAL_H = 50;

function formatDate(iso) {
  const d = new Date(iso);
  const day = d.getDate();
  const months = [
    'janvier','février','mars','avril','mai','juin',
    'juillet','août','septembre','octobre','novembre','décembre',
  ];
  const month = months[d.getMonth()];
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} — ${h}:${m}`;
}

function GameCard({ game, onPress, onDelete }) {
  const { width: screenW } = useWindowDimensions();
  const players = game.players;
  const n = players.length;
  const cardW = screenW - SPACING.md * 2;
  const colW = Math.max(40, Math.floor((cardW - MINI_LABEL_W) / n));
  const nameFontSize = colW >= 70 ? 12 : colW >= 54 ? 10 : 9;
  const scoreFontSize = colW >= 60 ? 16 : colW >= 48 ? 13 : 11;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>

      {/* Date + suppression */}
      <View style={styles.cardMeta}>
        <Text style={styles.cardDate}>{formatDate(game.date)}</Text>
        <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.cardDelete}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Mini fiche de score */}
      <View style={styles.miniGrid}>

        {/* Ligne noms */}
        <View style={styles.miniRow}>
          <View style={[styles.miniLabelCell, styles.miniHeaderLabelCell, { width: MINI_LABEL_W, height: MINI_HEADER_H }]}>
            <Image source={BONHOMME} style={styles.miniBonhomme} resizeMode="contain" />
          </View>
          {players.map((p, i) => {
            const isWinner = p.rank === 1;
            return (
              <View
                key={i}
                style={[
                  styles.miniHeaderCell,
                  { width: colW, height: MINI_HEADER_H },
                  isWinner && styles.miniWinnerHeaderCell,
                ]}
              >
                <Text
                  style={[styles.miniName, isWinner && styles.miniNameWinner, { fontSize: nameFontSize }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {p.name || '—'}
                </Text>
                <Text style={[styles.miniRankText, isWinner && styles.miniCrownText]}>
                  {isWinner ? '👑' : `#${p.rank}`}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Ligne totaux */}
        <View style={[styles.miniRow, styles.miniTotalRow]}>
          <View style={[styles.miniLabelCell, styles.miniTotalLabelCell, { width: MINI_LABEL_W, height: MINI_TOTAL_H }]}>
            <Text style={styles.miniTotalLabel}>T</Text>
          </View>
          {players.map((p, i) => {
            const isWinner = p.rank === 1;
            const boxSize = Math.min(36, colW - 8);
            return (
              <View key={i} style={[styles.miniTotalCell, { width: colW, height: MINI_TOTAL_H }]}>
                <View style={[styles.miniTotalBox, isWinner && styles.miniTotalBoxWinner, { width: boxSize, height: boxSize }]}>
                  <Text style={[styles.miniTotalScore, { fontSize: scoreFontSize }]}>
                    {p.total}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

      </View>
    </TouchableOpacity>
  );
}

export default function History({ isActive }) {
  const insets = useSafeAreaInsets();
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);

  const loadGames = useCallback(async () => {
    const h = await getHistory();
    setGames(h);
  }, []);

  useEffect(() => {
    if (isActive) loadGames();
  }, [isActive, loadGames]);

  const handleDelete = (game) => {
    Alert.alert('Supprimer cette partie ?', formatDate(game.date), [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await deleteGame(game.id);
          loadGames();
        },
      },
    ]);
  };

  const renderItem = ({ item }) => (
    <GameCard
      game={item}
      onPress={() => setSelectedGame(item)}
      onDelete={() => handleDelete(item)}
    />
  );

  const selectedPlayers = selectedGame?.players.map((p) => ({
    name: p.name,
    regions: p.regions ?? [],
    sanctuaries: p.sanctuaries ?? [],
  }));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Historique</Text>

      {games.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📜</Text>
          <Text style={styles.emptyText}>Aucune partie enregistrée</Text>
          <Text style={styles.emptySubtext}>
            Les parties terminées apparaîtront ici.
          </Text>
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(g) => g.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + SPACING.md },
          ]}
        />
      )}

      <Modal
        visible={selectedGame !== null}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setSelectedGame(null)}
      >
        {selectedPlayers && (
          <Results
            players={selectedPlayers}
            onNewGame={() => setSelectedGame(null)}
            backLabel="← Retour"
          />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  title: {
    fontSize: FONTS.title, fontWeight: '700', color: COLORS.text,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.lg, paddingBottom: SPACING.md,
  },
  list: { paddingHorizontal: SPACING.md, gap: SPACING.sm },

  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardMeta: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.sm, paddingVertical: 0,
  },
  cardDate: { fontSize: 11, color: COLORS.textLight + 'AA', fontWeight: '500' },
  cardDelete: { fontSize: FONTS.small, color: COLORS.textLight, padding: SPACING.xs },

  // ── Mini fiche de score ──
  miniGrid: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    overflow: 'hidden',
  },
  miniRow: { flexDirection: 'row', backgroundColor: COLORS.cardBg },
  miniLabelCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    backgroundColor: '#E8E4DE',
  },
  miniHeaderLabelCell: { backgroundColor: '#D8D0C8' },
  miniTotalLabelCell: { backgroundColor: 'rgba(0,0,0,0.12)' },
  miniBonhomme: { width: 24, height: 24 },
  miniHeaderCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 2,
    gap: 2,
    backgroundColor: '#E8E4DE',
  },
  miniWinnerHeaderCell: {
    backgroundColor: COLORS.primary + '22',
    borderBottomColor: COLORS.border,
  },
  miniName: { fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  miniNameWinner: { color: COLORS.primary },
  miniRankText: { fontSize: 9, color: COLORS.textLight, fontWeight: '600' },
  miniCrownText: { fontSize: 10, color: COLORS.primary },
  miniTotalRow: { backgroundColor: COLORS.primary },
  miniTotalCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.15)',
  },
  miniTotalLabel: { fontSize: FONTS.subtitle, fontWeight: '900', color: COLORS.white },
  miniTotalBox: {
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniTotalBoxWinner: {
    borderColor: COLORS.white,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  miniTotalScore: { fontWeight: '800', color: COLORS.white },

  empty: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: SPACING.sm, paddingHorizontal: SPACING.xl,
  },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.sm },
  emptyText: {
    fontSize: FONTS.subtitle, fontWeight: '600', color: COLORS.text, textAlign: 'center',
  },
  emptySubtext: { fontSize: FONTS.body, color: COLORS.textLight, textAlign: 'center' },
});
