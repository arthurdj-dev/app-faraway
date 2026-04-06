import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONTS } from '../constants/theme';

let nextId = 3;
const makePlayer = (id, name = '') => ({ id, name, scanned: false });

export default function NewGame() {
  const insets = useSafeAreaInsets();
  const [players, setPlayers] = useState([makePlayer(1), makePlayer(2)]);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [scanningPlayerId, setScanningPlayerId] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();

  const allScanned = players.length >= 1 && players.every((p) => p.scanned);

  const addPlayer = () => {
    setPlayers((prev) => [...prev, makePlayer(nextId++)]);
  };

  const removePlayer = (id) => {
    if (players.length <= 1) return;
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  };

  const updateName = (id, name) => {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const openCamera = async (playerId) => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Permission refusée',
          "L'accès à la caméra est nécessaire pour scanner le jeu."
        );
        return;
      }
    }
    setScanningPlayerId(playerId);
    setCameraVisible(true);
  };

  const confirmScan = () => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === scanningPlayerId ? { ...p, scanned: true } : p))
    );
    setCameraVisible(false);
    setScanningPlayerId(null);
  };

  const cancelScan = () => {
    setCameraVisible(false);
    setScanningPlayerId(null);
  };

  const handleResults = () => {
    // TODO: afficher la fiche des scores
    Alert.alert('Résultats', 'La fiche des scores sera affichée ici.');
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
              onPress={() => !player.scanned && openCamera(player.id)}
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

      <Modal
        visible={cameraVisible}
        animationType="slide"
        onRequestClose={cancelScan}
        statusBarTranslucent
      >
        <View style={styles.cameraContainer}>
          {permission?.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing="back">
              <View style={styles.cameraOverlay}>
                <View style={styles.cameraFrame} />
                <Text style={styles.cameraHint}>
                  Pointez la caméra vers le plateau de jeu
                </Text>
                <TouchableOpacity style={styles.confirmBtn} onPress={confirmScan} activeOpacity={0.8}>
                  <Text style={styles.confirmBtnText}>Confirmer le scan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={cancelScan} activeOpacity={0.8}>
                  <Text style={styles.cancelBtnText}>Annuler</Text>
                </TouchableOpacity>
              </View>
            </CameraView>
          ) : (
            <View style={styles.noPermission}>
              <Text style={styles.noPermissionText}>Permission caméra non accordée</Text>
              <TouchableOpacity style={styles.cancelBtn} onPress={cancelScan}>
                <Text style={styles.cancelBtnTextDark}>Fermer</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: FONTS.title,
    fontWeight: '700',
    color: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  removeBtn: {
    padding: SPACING.xs,
  },
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
  scanBtnDone: {
    backgroundColor: COLORS.success,
  },
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
  addBtnText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: FONTS.body,
  },
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
  resultsBtnDisabled: {
    backgroundColor: COLORS.disabled,
  },
  resultsBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: FONTS.subtitle,
  },
  resultsBtnTextDisabled: {
    color: COLORS.disabledText,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 60,
    paddingHorizontal: SPACING.lg,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  cameraFrame: {
    position: 'absolute',
    top: '20%',
    left: '10%',
    right: '10%',
    aspectRatio: 1.4,
    borderWidth: 2,
    borderColor: COLORS.white,
    borderRadius: 12,
  },
  cameraHint: {
    color: COLORS.white,
    fontSize: FONTS.body,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  confirmBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.sm,
    width: '100%',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: FONTS.subtitle,
  },
  cancelBtn: {
    paddingVertical: SPACING.sm,
    width: '100%',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: COLORS.white,
    fontWeight: '500',
    fontSize: FONTS.body,
  },
  cancelBtnTextDark: {
    color: COLORS.text,
    fontWeight: '500',
    fontSize: FONTS.body,
  },
  noPermission: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.lg,
    backgroundColor: COLORS.background,
  },
  noPermissionText: {
    fontSize: FONTS.body,
    color: COLORS.text,
  },
});
