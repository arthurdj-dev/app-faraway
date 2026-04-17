import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getHistory, deleteGame } from '../utils/storage';
import Results from './Results';
import { COLORS, FONTS, SPACING } from '../constants/theme';

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
  const winner = game.players.find((p) => p.rank === 1);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{formatDate(game.date)}</Text>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.cardDelete}>✕</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.scoreBar}>
        {game.players.map((p, i) => {
          const isWinner = p.rank === 1;
          return (
            <View key={i} style={[styles.scoreItem, isWinner && styles.scoreItemWinner]}>
              <Text
                style={[styles.scoreName, isWinner && styles.scoreNameWinner]}
                numberOfLines={1}
              >
                {isWinner ? '👑 ' : ''}{p.name}
              </Text>
              <Text style={[styles.scoreTotal, isWinner && styles.scoreTotalWinner]}>
                {p.total}
              </Text>
            </View>
          );
        })}
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
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.sm, paddingVertical: 0,
  },
  cardDate: { fontSize: 11, color: COLORS.textLight + 'AA', fontWeight: '500' },
  cardDelete: { fontSize: FONTS.small, color: COLORS.textLight, padding: SPACING.xs },

  scoreBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  scoreItem: {
    flex: 1, alignItems: 'center', paddingHorizontal: SPACING.xs,
  },
  scoreItemWinner: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 6,
    paddingVertical: 2,
  },
  scoreName: {
    fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: '600', textAlign: 'center',
  },
  scoreNameWinner: { color: COLORS.white },
  scoreTotal: {
    fontSize: FONTS.subtitle, fontWeight: '700', color: 'rgba(255,255,255,0.75)',
  },
  scoreTotalWinner: { color: COLORS.white, fontWeight: '900' },

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
