import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  StyleSheet, ScrollView, Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGroqApiKey, setGroqApiKey, clearGroqApiKey } from '../utils/storage';
import { COLORS, FONTS, SPACING } from '../constants/theme';

export default function GroqKeyModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    if (visible) {
      getGroqApiKey().then((k) => {
        if (k) { setKey(k); setHasKey(true); setSaved(true); }
        else   { setKey(''); setHasKey(false); setSaved(false); }
      });
    }
  }, [visible]);

  const handleSave = async () => {
    if (!key.trim()) return;
    await setGroqApiKey(key.trim());
    setHasKey(true);
    setSaved(true);
    Alert.alert('Clé enregistrée', 'Ta clé Groq est sauvegardée. Tu peux maintenant scanner tes cartes.');
  };

  const handleClear = async () => {
    await clearGroqApiKey();
    setKey('');
    setHasKey(false);
    setSaved(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>

          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>Clé API Groq</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

            {/* Statut */}
            <View style={[s.statusBadge, hasKey ? s.statusOk : s.statusMissing]}>
              <Text style={s.statusText}>
                {hasKey ? '✓ Clé configurée — scan activé' : '⚠ Aucune clé — scan désactivé'}
              </Text>
            </View>

            {/* Guide */}
            <View style={s.guideBox}>
              <Text style={s.guideTitle}>Comment obtenir une clé gratuite ?</Text>

              <View style={s.step}>
                <Text style={s.stepNum}>1</Text>
                <Text style={s.stepText}>
                  Va sur <Text style={s.link}>console.groq.com</Text> et crée un compte gratuit (Google ou email).
                </Text>
              </View>

              <View style={s.step}>
                <Text style={s.stepNum}>2</Text>
                <Text style={s.stepText}>
                  Dans le menu, clique sur <Text style={s.bold}>API Keys</Text> puis <Text style={s.bold}>Create API Key</Text>.
                </Text>
              </View>

              <View style={s.step}>
                <Text style={s.stepNum}>3</Text>
                <Text style={s.stepText}>
                  Copie la clé générée (commence par <Text style={s.mono}>gsk_</Text>) et colle-la ci-dessous.
                </Text>
              </View>

              <View style={s.infoBadge}>
                <Text style={s.infoText}>
                  🎉 C'est 100% gratuit — Groq offre un accès généreux à ses modèles IA sans carte bancaire.
                </Text>
              </View>
            </View>

            {/* Input clé */}
            <Text style={s.label}>Ta clé API</Text>
            <TextInput
              style={s.input}
              value={key}
              onChangeText={(t) => { setKey(t); setSaved(false); }}
              placeholder="gsk_..."
              placeholderTextColor={COLORS.textLight}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
            />

            {/* Boutons */}
            <TouchableOpacity
              style={[s.saveBtn, (!key.trim() || saved) && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!key.trim() || saved}
            >
              <Text style={s.saveBtnText}>{saved ? '✓ Enregistrée' : 'Enregistrer'}</Text>
            </TouchableOpacity>

            {hasKey && (
              <TouchableOpacity style={s.clearBtn} onPress={handleClear}>
                <Text style={s.clearBtnText}>Supprimer la clé</Text>
              </TouchableOpacity>
            )}

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: FONTS.subtitle, fontWeight: '700', color: COLORS.text },
  closeBtn: { fontSize: FONTS.subtitle, color: COLORS.textLight, padding: SPACING.xs },

  content: { padding: SPACING.md, gap: SPACING.md },

  statusBadge: {
    borderRadius: 10, padding: SPACING.sm, alignItems: 'center',
  },
  statusOk:      { backgroundColor: COLORS.success + '20', borderWidth: 1, borderColor: COLORS.success },
  statusMissing: { backgroundColor: COLORS.primary + '15', borderWidth: 1, borderColor: COLORS.primary },
  statusText:    { fontWeight: '700', fontSize: FONTS.body, color: COLORS.text },

  guideBox: {
    backgroundColor: COLORS.cardBg, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.md,
  },
  guideTitle: { fontSize: FONTS.body, fontWeight: '700', color: COLORS.text },

  step: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.primary, color: COLORS.white,
    textAlign: 'center', lineHeight: 24, fontWeight: '700', fontSize: FONTS.small,
    flexShrink: 0,
  },
  stepText: { flex: 1, fontSize: FONTS.body, color: COLORS.text, lineHeight: 22 },
  link:     { color: COLORS.primary, fontWeight: '600' },
  bold:     { fontWeight: '700' },
  mono:     { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: FONTS.small },

  infoBadge: {
    backgroundColor: COLORS.gold + '20', borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.gold, padding: SPACING.sm,
  },
  infoText: { fontSize: FONTS.small, color: COLORS.text, lineHeight: 20 },

  label: { fontSize: FONTS.small, fontWeight: '700', color: COLORS.textLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: SPACING.md,
    paddingVertical: Platform.OS === 'ios' ? SPACING.sm + 4 : SPACING.sm + 2,
    fontSize: FONTS.body, color: COLORS.text, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  saveBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingVertical: SPACING.md, alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: COLORS.disabled },
  saveBtnText: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.body },

  clearBtn: { alignItems: 'center', paddingVertical: SPACING.sm },
  clearBtnText: { color: COLORS.textLight, fontSize: FONTS.body },
});
