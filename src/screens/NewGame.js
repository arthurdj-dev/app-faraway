import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Modal,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScanModal from '../components/ScanModal';
import Results from './Results';
import { COLORS, SPACING, FONTS } from '../constants/theme';

let nextId = 3;
const makePlayer = (id, name = '') => ({ id, name, scanned: false, cards: null });
const resetNextId = () => { nextId = 3; };

export default function NewGame() {
  const insets = useSafeAreaInsets();
  const [players, setPlayers] = useState([makePlayer(1), makePlayer(2)]);
  const [scanningPlayer, setScanningPlayer] = useState(null);
  const [showResults, setShowResults] = useState(false);

  const allScanned = players.length >= 1 && players.every((p) => p.scanned);

  const addPlayer = () => setPlayers((prev) => [...prev, makePlayer(nextId++)]);

  const removePlayer = (id) => {
    if (players.length <= 1) return;
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  };

  const updateName = (id, name) =>
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));

  const openScan = (player) => setScanningPlayer(player);

  const handleScanComplete = ({ regions, sanctuaries }) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.id === scanningPlayer.id
          ? { ...p, scanned: true, cards: { regions, sanctuaries } }
          : p
      )
    );
    setScanningPlayer(null);
  };

  const handleResults = () => setShowResults(true);

  const handleNewGame = () => {
    setShowResults(false);
    resetNextId();
    setPlayers([makePlayer(1), makePlayer(2)]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.title}>Nouvelle partie</Text>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {players.map((player, index) => (
          <View key={player.id} style={styles.playerRow}>
            {players.length > 1 && (
              <TouchableOpacity
                onPress={() => removePlayer(player.id)}
                style={styles.removeBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle" size={22} color={COLORS.textLight} />
              </TouchableOpacity>
            )}
            <TextInput
              style={styles.input}
              placeholder={`Nom du joueur ${index + 1}`}
              placeholderTextColor={COLORS.textLight}
              value={player.name}
              onChangeText={(text) => updateName(player.id, text)}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.scanBtn, player.scanned && styles.scanBtnDone]}
              onPress={() => !player.scanned && openScan(player)}
              activeOpacity={player.scanned ? 1 : 0.7}
            >
              {player.scanned ? (
                <Ionicons name="checkmark" size={22} color={COLORS.white} />
              ) : (
                <Ionicons name="scan" size={22} color={COLORS.white} />
              )}
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} onPress={addPlayer} activeOpacity={0.7}>
          <Ionicons name="add" size={18} color={COLORS.primary} />
          <Text style={styles.addBtnText}>Ajouter un joueur</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <TouchableOpacity
          style={[styles.resultsBtn, !allScanned && styles.resultsBtnDisabled]}
          onPress={allScanned ? handleResults : null}
          disabled={!allScanned}
          activeOpacity={0.7}
        >
          <Text style={[styles.resultsBtnText, !allScanned && styles.resultsBtnTextDisabled]}>
            Résultats
          </Text>
        </TouchableOpacity>
      </View>

      <ScanModal
        visible={scanningPlayer !== null}
        playerName={scanningPlayer?.name || `Joueur ${players.indexOf(scanningPlayer) + 1}`}
        onClose={() => setScanningPlayer(null)}
        onComplete={handleScanComplete}
      />

      <Modal visible={showResults} animationType="slide" statusBarTranslucent>
        <Results
          players={players.map((p, i) => ({
            name: p.name || `Joueur ${i + 1}`,
            regions:    p.cards?.regions    ?? [],
            sanctuaries: p.cards?.sanctuaries ?? [],
          }))}
          onNewGame={handleNewGame}
        />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  title: {
    fontSize: FONTS.title,
    fontWeight: '700',
    color: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md, gap: SPACING.sm },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  removeBtn: { padding: SPACING.xs },
  input: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: Platform.OS === 'ios' ? SPACING.sm + 4 : SPACING.sm + 2,
    fontSize: FONTS.body,
    color: COLORS.text,
  },
  scanBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnDone: { backgroundColor: COLORS.success },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: SPACING.sm + 2,
    marginTop: SPACING.xs,
  },
  addBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: FONTS.body },
  footer: {
    padding: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  resultsBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  resultsBtnDisabled: { backgroundColor: COLORS.disabled },
  resultsBtnText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.subtitle },
  resultsBtnTextDisabled: { color: COLORS.disabledText },
});
