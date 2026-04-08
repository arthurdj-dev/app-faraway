/**
 * ScanModal — scan du tableau complet en une seule photo.
 *
 * Étape 1 : Instructions de disposition
 * Étape 2 : Prise de photo
 * Étape 3 : Résultats avec correction manuelle optionnelle
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as ImageManipulator from 'expo-image-manipulator';
import { scanTableau } from '../utils/tableauScanner';
import { getGroqApiKey, getScanSkipGuide, setScanSkipGuide } from '../utils/storage';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const REGION_COUNT = 8;

// ─── Numpad inline pour correction ────────────────────────────────────────

function InlineNumpad({ onConfirm, onCancel }) {
  const [val, setVal] = useState('');
  const keys = ['1','2','3','4','5','6','7','8','9','⌫','0','✓'];

  const press = (k) => {
    if (k === '⌫') { setVal((v) => v.slice(0, -1)); return; }
    if (k === '✓') { if (val) onConfirm(parseInt(val)); return; }
    if (val.length >= 3) return;
    setVal((v) => v + k);
  };

  return (
    <View style={np.container}>
      <View style={np.display}>
        <Text style={np.displayText}>{val || '—'}</Text>
      </View>
      <View style={np.grid}>
        {keys.map((k) => (
          <TouchableOpacity
            key={k}
            style={[np.key, k === '✓' && np.keyOk, k === '✓' && !val && np.keyDisabled]}
            onPress={() => press(k)}
            activeOpacity={0.7}
          >
            <Text style={[np.keyTxt, k === '✓' && np.keyOkTxt]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={onCancel} style={np.cancelBtn}>
        <Text style={np.cancelTxt}>Annuler</Text>
      </TouchableOpacity>
    </View>
  );
}

const np = StyleSheet.create({
  container: { alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
  display: {
    backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.xl,
    minWidth: 120, alignItems: 'center',
  },
  displayText: { fontSize: 28, fontWeight: '700', color: COLORS.text, letterSpacing: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 216, gap: SPACING.xs },
  key: {
    width: 64, height: 48, backgroundColor: COLORS.cardBg,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  keyOk: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  keyDisabled: { backgroundColor: COLORS.disabled, borderColor: COLORS.disabled },
  keyTxt: { fontSize: FONTS.subtitle, fontWeight: '600', color: COLORS.text },
  keyOkTxt: { color: COLORS.white },
  cancelBtn: { paddingVertical: SPACING.sm },
  cancelTxt: { color: COLORS.textLight, fontSize: FONTS.body },
});

// ─── Carte résultat ────────────────────────────────────────────────────────

function ResultCard({ item, onEdit }) {
  const isOk   = item.confidence === 'high';
  const isLow  = item.confidence === 'low';
  const isNone = item.confidence === 'none';

  const label = item.type === 'region'
    ? (item.id ? `#${item.id}` : '?')
    : (item.id ? `Sanctuaire #${item.id}` : '?');

  const bg     = isOk ? COLORS.success + '20' : isLow ? COLORS.gold + '20' : COLORS.primary + '20';
  const border = isOk ? COLORS.success        : isLow ? COLORS.gold        : COLORS.primary;

  return (
    <View style={[rc.card, { backgroundColor: bg, borderColor: border }]}>
      <View style={rc.left}>
        <Text style={rc.pos}>
          {item.type === 'region'
            ? `Carte ${item.index + 1}`
            : `Sanctuaire ${item.index - REGION_COUNT + 1}`}
        </Text>
        <Text style={rc.label}>{label}</Text>
        {isLow && item.candidates?.length > 1 && (
          <Text style={rc.alt}>Aussi possible : #{item.candidates[1]?.id}</Text>
        )}
      </View>
      <TouchableOpacity onPress={() => onEdit(item.index)} style={rc.editBtn}>
        <Text style={rc.editTxt}>{isNone || isLow ? '✏️ Corriger' : '✏️'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const rc = StyleSheet.create({
  card: {
    borderWidth: 1.5, borderRadius: 10, padding: SPACING.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  left: { flex: 1 },
  pos: { fontSize: FONTS.small, color: COLORS.textLight, fontWeight: '600', textTransform: 'uppercase' },
  label: { fontSize: FONTS.subtitle, fontWeight: '700', color: COLORS.text },
  alt: { fontSize: FONTS.small, color: COLORS.textLight },
  editBtn: { padding: SPACING.xs },
  editTxt: { fontSize: FONTS.small, color: COLORS.primary },
});

// ─── ScanModal principal ───────────────────────────────────────────────────

export default function ScanModal({ visible, playerName, onClose, onComplete }) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep] = useState('instruction'); // instruction | camera | processing | results
  const [photoUri, setPhotoUri] = useState(null);
  const [results, setResults] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [skipGuide, setSkipGuide] = useState(false);

  const reset = () => {
    setStep('instruction');
    setPhotoUri(null);
    setResults([]);
    setEditingIndex(null);
  };

  const handleClose = () => { reset(); onClose(); };

  // Charge la préférence "ne plus afficher" à l'ouverture
  useEffect(() => {
    if (visible) {
      getScanSkipGuide().then((skip) => {
        setSkipGuide(skip);
        if (skip) openCamera();
      });
    }
  }, [visible]);

  const openCamera = async () => {
    const groqKey = await getGroqApiKey();
    if (!groqKey) {
      Alert.alert(
        'Clé Groq manquante',
        'Pour scanner tes cartes, tu as besoin d\'une clé API Groq gratuite.\n\n' +
        '1. Va sur console.groq.com\n' +
        '2. Crée un compte gratuit\n' +
        '3. Clique sur "API Keys" → "Create API Key"\n' +
        '4. Appuie sur 🔑 en haut de l\'écran pour entrer ta clé\n\n' +
        'C\'est 100% gratuit, sans carte bancaire.',
        [{ text: 'OK' }]
      );
      return;
    }
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert('Permission refusée', "L'accès à la caméra est nécessaire.");
        return;
      }
    }
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
    setStep('camera');
  };

  const exitCamera = async (nextStep) => {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    setStep(nextStep);
  };

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.92 });

      // En LANDSCAPE_LEFT, le capteur Android reste en portrait natif.
      // On force toujours la rotation -90° pour obtenir le bon sens paysage.
      let finalUri = photo.uri;
      if (photo.height > photo.width) {
        const rotated = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ rotate: -90 }],
          { format: ImageManipulator.SaveFormat.JPEG, compress: 0.92 }
        );
        finalUri = rotated.uri;
      }

      setPhotoUri(finalUri);
      await exitCamera('processing');
      const res = await scanTableau(finalUri);
      setResults(res);
      setStep('results');
    } catch (e) {
      Alert.alert('Erreur lors de l\'analyse', e.message);
      await exitCamera('camera');
    }
  };

  const applyEdit = (id) => {
    setResults((prev) =>
      prev.map((r) => r.index === editingIndex ? { ...r, id, confidence: 'high' } : r)
    );
    setEditingIndex(null);
  };

  const handleConfirm = () => {
    const regions    = results.filter((r) => r.type === 'region').map((r) => ({ id: r.id }));
    const sanctuaries = results.filter((r) => r.type === 'sanctuary').map((r) => ({ id: r.id }));
    onComplete({ regions, sanctuaries });
    reset();
  };

  const allIdentified = results.length > 0 && results.every((r) => r.id !== null);

  const shutterAreaW = 80;
  const PADDING = 8;
  const availW = winW - shutterAreaW - insets.left - insets.right - PADDING * 2;
  const availH = winH - insets.top - insets.bottom - PADDING * 2;
  const cellSize = Math.min(availW / 4, availH / 3);
  const frameW = cellSize * 4;
  const frameH = cellSize * 3;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} statusBarTranslucent>
      <View style={[s.container, step !== 'camera' && { paddingTop: insets.top }]}>

        {/* Header — masqué en mode caméra */}
        {step !== 'camera' && (
          <View style={s.header}>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.closeBtn}>✕</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle}>Scan de {playerName}</Text>
            <View style={{ width: 32 }} />
          </View>
        )}

        {/* ── Étape 1 : Instructions ── */}
        {step === 'instruction' && (
          <View style={s.stepContent}>
            <Text style={s.stepTitle}>Prépare ton tableau</Text>
            <View style={s.instructionBox}>
              {/* Schéma visuel */}
              <View style={s.schema}>
                <View style={s.schemaRow}>
                  {['S1','S2','S3','…'].map((l) => (
                    <View key={l} style={[s.schemaCard, s.schemaCardSanctuary]}>
                      <Text style={s.schemaCardTxt}>{l}</Text>
                    </View>
                  ))}
                </View>
                <View style={s.schemaRow}>
                  {['1','2','3','4'].map((l) => (
                    <View key={l} style={s.schemaCard}>
                      <Text style={s.schemaCardTxt}>{l}</Text>
                    </View>
                  ))}
                </View>
                <View style={s.schemaRow}>
                  {['5','6','7','8'].map((l) => (
                    <View key={l} style={s.schemaCard}>
                      <Text style={s.schemaCardTxt}>{l}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={s.instructionRow}>
                <Text style={s.bold}>Sanctuaires</Text> en ligne tout en haut.
              </Text>
              <Text style={s.instructionRow}>
                <Text style={s.bold}>Régions 1→4</Text> au milieu, <Text style={s.bold}>5→8</Text> en bas.
              </Text>
              <Text style={s.instructionRow}>
                Photo <Text style={s.bold}>depuis au-dessus</Text>, cartes bien visibles, sans chevauchement.
              </Text>
            </View>
            <TouchableOpacity style={s.primaryBtn} onPress={openCamera}>
              <Text style={s.primaryBtnTxt}>📷 Scanner</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.skipGuideBtn}
              onPress={async () => {
                await setScanSkipGuide(true);
                setSkipGuide(true);
              }}
            >
              <Text style={s.skipGuideTxt}>Ne plus afficher ce guide</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Étape 2 : Caméra (plein écran, paysage) ── */}
        {step === 'camera' && permission?.granted && (
          <View style={s.cameraContainer}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={0} ratio="4:3" />

            {/* Cadre de visée : cellules carrées calculées dynamiquement */}
            <View style={s.cameraOverlay}>
              <View style={[s.cameraFrame, { width: frameW, height: frameH }]}>
                {/* Coins */}
                <View style={[s.corner, s.cornerTL]} />
                <View style={[s.corner, s.cornerTR]} />
                <View style={[s.corner, s.cornerBL]} />
                <View style={[s.corner, s.cornerBR]} />

                {/* Séparateur horizontal sanctuaires / régions */}
                <View style={[s.dividerH, { top: cellSize }]} />
                {/* Séparateur horizontal entre les 2 rangées de régions */}
                <View style={[s.dividerH, { top: cellSize * 2 }]} />
                {/* Séparateurs verticaux — uniquement dans la zone régions (2/3 bas) */}
                {[1, 2, 3].map((col) => (
                  <View key={col} style={[s.dividerV, { left: cellSize * col, top: cellSize }]} />
                ))}

                {/* Labels */}
                <Text style={[s.zoneLabel, { top: 4, left: 6 }]}>Sanctuaires</Text>
                <Text style={[s.zoneLabel, { top: frameH / 3 + 4, left: 6 }]}>Régions 1–4</Text>
                <Text style={[s.zoneLabel, { top: (frameH * 2) / 3 + 4, left: 6 }]}>Régions 5–8</Text>
              </View>
            </View>

            {/* Déclencheur — colonne droite */}
            <View style={[s.cameraControls, { right: insets.right, width: shutterAreaW }]}>
              <TouchableOpacity style={s.shutterBtn} onPress={takePhoto}>
                <View style={s.shutterInner} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => exitCamera('instruction')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.cancelWhite}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Traitement ── */}
        {step === 'processing' && (
          <View style={s.centered}>
            {photoUri && (
              <Image source={{ uri: photoUri }} style={s.photoPreview} resizeMode="contain" />
            )}
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={s.processingTxt}>Analyse en cours…</Text>
          </View>
        )}

        {/* ── Résultats ── */}
        {step === 'results' && (
          <View style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.resultsList}>
              {photoUri && (
                <Image source={{ uri: photoUri }} style={s.photoPreview} resizeMode="contain" />
              )}

              <Text style={s.sectionLabel}>Cartes Région (ordre de jeu →)</Text>
              {results.filter((r) => r.type === 'region').map((item) => (
                <ResultCard key={item.index} item={item} onEdit={setEditingIndex} />
              ))}

              {results.some((r) => r.type === 'sanctuary') && (
                <>
                  <Text style={[s.sectionLabel, { marginTop: SPACING.md }]}>Sanctuaires</Text>
                  {results.filter((r) => r.type === 'sanctuary').map((item) => (
                    <ResultCard key={item.index} item={item} onEdit={setEditingIndex} />
                  ))}
                </>
              )}
            </ScrollView>

            <View style={[s.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
              {!allIdentified && (
                <Text style={s.warningTxt}>
                  ⚠️ Certaines cartes n'ont pas été reconnues — appuie sur ✏️ pour les corriger.
                </Text>
              )}
              <View style={s.row}>
                <TouchableOpacity style={s.secondaryBtn} onPress={() => setStep('instruction')}>
                  <Text style={s.secondaryBtnTxt}>↺ Rescanner</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.primaryBtn, { flex: 1 }, !allIdentified && s.primaryBtnDisabled]}
                  onPress={allIdentified ? handleConfirm : null}
                  disabled={!allIdentified}
                >
                  <Text style={s.primaryBtnTxt}>✓ Valider</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ── Modal correction ── */}
        <Modal
          visible={editingIndex !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setEditingIndex(null)}
        >
          <View style={s.editOverlay}>
            <View style={s.editSheet}>
              <Text style={s.editTitle}>
                {results[editingIndex]?.type === 'region'
                  ? 'Numéro de la carte Région'
                  : 'ID du Sanctuaire'}
              </Text>
              <InlineNumpad onConfirm={applyEdit} onCancel={() => setEditingIndex(null)} />
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  closeBtn: { fontSize: FONTS.subtitle, color: COLORS.textLight, padding: SPACING.xs },
  headerTitle: { fontSize: FONTS.subtitle, fontWeight: '700', color: COLORS.text },

  stepContent: { flex: 1, padding: SPACING.md, gap: SPACING.lg, justifyContent: 'center' },
  stepTitle: { fontSize: FONTS.title, fontWeight: '700', color: COLORS.text, textAlign: 'center' },

  instructionBox: {
    backgroundColor: COLORS.cardBg, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.md,
  },
  instructionRow: { fontSize: FONTS.body, color: COLORS.text, lineHeight: 24 },
  bold: { fontWeight: '700' },

  schema: { gap: 4, alignItems: 'flex-start' },
  schemaRow: { flexDirection: 'row', gap: 4 },
  schemaCard: {
    width: 44, height: 30, borderRadius: 4,
    backgroundColor: COLORS.secondary + '25',
    borderWidth: 1, borderColor: COLORS.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  schemaCardSanctuary: {
    backgroundColor: COLORS.gold + '25',
    borderColor: COLORS.gold,
  },
  schemaCardTxt: { fontSize: 11, fontWeight: '700', color: COLORS.text },

  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingVertical: SPACING.md, alignItems: 'center',
  },
  primaryBtnDisabled: { backgroundColor: COLORS.disabled },
  primaryBtnTxt: { color: COLORS.white, fontWeight: '700', fontSize: FONTS.body },

  skipGuideBtn: { alignItems: 'center', paddingVertical: SPACING.xs },
  skipGuideTxt: { color: COLORS.textLight, fontSize: FONTS.small },

  secondaryBtn: {
    borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 10,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.md, alignItems: 'center',
  },
  secondaryBtnTxt: { color: COLORS.primary, fontWeight: '600', fontSize: FONTS.body },

  row: { flexDirection: 'row', gap: SPACING.sm },

  // Caméra
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraFrame: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  // Coins de visée
  corner: {
    position: 'absolute', width: 18, height: 18,
    borderColor: COLORS.white, borderWidth: 3,
  },
  cornerTL: { top: -1, left: -1, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: -1, right: -1, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: -1, left: -1, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: -1, right: -1, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 6 },
  // Grille indicative
  dividerH: {
    position: 'absolute', left: 0, right: 0,
    height: 1, backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dividerV: {
    position: 'absolute', bottom: 0,
    width: 1, backgroundColor: 'rgba(255,255,255,0.25)',
  },
  zoneLabel: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3,
    letterSpacing: 0.3,
  },
  // Bouton déclencheur — colonne droite fixe
  cameraControls: {
    position: 'absolute', top: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    gap: SPACING.md,
  },
  shutterBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 3, borderColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.white },
  cancelWhite: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '500' },

  // Traitement
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.lg, padding: SPACING.md },
  processingTxt: { fontSize: FONTS.subtitle, color: COLORS.text, fontWeight: '600' },

  // Résultats
  photoPreview: { width: '100%', height: 120, borderRadius: 10, marginBottom: SPACING.sm },
  resultsList: { padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xl },
  sectionLabel: {
    fontSize: FONTS.small, fontWeight: '700', color: COLORS.textLight,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  footer: {
    padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.background, gap: SPACING.sm,
  },
  warningTxt: { fontSize: FONTS.small, color: COLORS.primary, textAlign: 'center' },

  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: COLORS.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    alignItems: 'center', gap: SPACING.md,
  },
  editTitle: { fontSize: FONTS.subtitle, fontWeight: '700', color: COLORS.text, paddingTop: SPACING.lg },
});
