/**
 * ScanModal — scan du tableau complet en une seule photo.
 *
 * Étape 1 : Instructions de disposition
 * Étape 2 : Prise de photo
 * Étape 3 : Résultats en grille (sanctuaires + 2 rangées régions) avec picker visuel
 */

import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
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
import { getSanctuaryImage, SANCTUARY_COUNT } from '../utils/sanctuaryImages';
import { COLORS, FONTS, SPACING } from '../constants/theme';

const REGION_COUNT = 8;
const REGION_TOTAL = 77; // IDs 0..76

// ─── Cellules visuelles ───────────────────────────────────────────────────

function RegionCell({ item, width, height, onPress, selected }) {
  const hasId = item.id != null;
  const border = selected ? COLORS.primary : COLORS.border;
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[cellStyles.regionBox, {
        width, height, borderColor: border,
        borderWidth: selected ? 3 : 2,
      }]}
    >
      <Text style={[cellStyles.regionNum, { fontSize: Math.min(width, height) * 0.34 }]}>
        {hasId ? `#${item.id}` : '?'}
      </Text>
    </TouchableOpacity>
  );
}

function SanctuaryCell({ item, width, height, onPress, selected, onRemove }) {
  const hasId = item.id != null;
  const img = hasId ? getSanctuaryImage(item.id) : null;
  const border = selected ? COLORS.primary : COLORS.border;
  return (
    <View style={{ width, height }}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[cellStyles.sanctBox, {
          width, height, borderColor: border,
          borderWidth: selected ? 3 : 2,
        }]}
      >
        {img ? (
          <Image source={img} style={cellStyles.sanctImg} resizeMode="cover" />
        ) : (
          <View style={cellStyles.sanctPlaceholder}>
            <Text style={cellStyles.sanctPlaceholderTxt}>?</Text>
          </View>
        )}
        {hasId && (
          <View style={cellStyles.idTag}>
            <Text style={cellStyles.idTagTxt}>#{item.id}</Text>
          </View>
        )}
      </TouchableOpacity>
      {onRemove && (
        <TouchableOpacity
          onPress={onRemove}
          style={cellStyles.removeBtn}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Text style={cellStyles.removeBtnTxt}>×</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const cellStyles = StyleSheet.create({
  regionBox: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionNum: {
    fontWeight: '700',
    color: COLORS.text,
  },
  sanctBox: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: COLORS.cardBg,
  },
  sanctImg: { width: '100%', height: '100%' },
  sanctPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sanctPlaceholderTxt: { fontSize: 18, color: COLORS.textLight, fontWeight: '700' },
  idTag: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 1,
  },
  idTagTxt: {
    color: COLORS.white, fontSize: 10, textAlign: 'center', fontWeight: '700',
  },
  removeBtn: {
    position: 'absolute', top: 2, right: 2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtnTxt: {
    color: COLORS.white, fontSize: 11, fontWeight: '700',
    lineHeight: 14, textAlign: 'center',
  },
});

// ─── Picker (grille de cartes cliquables pour corriger) ──────────────────

function PickerCell({ id, type, cellW, cellH, gap, isCurrent, isUsed, onPick }) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onPick(id)}
      style={{ width: cellW, height: cellH, marginBottom: gap, marginRight: gap }}
    >
      {type === 'region' ? (
        <View style={[
          pk.regionCell,
          isCurrent && pk.cellCurrent,
          isUsed && pk.cellUsed,
        ]}>
          <Text style={[pk.regionNum, { fontSize: cellW * 0.32 }]}>#{id}</Text>
        </View>
      ) : (
        <View style={[
          pk.sanctCell,
          isCurrent && pk.cellCurrent,
          isUsed && pk.cellUsed,
        ]}>
          <Image source={getSanctuaryImage(id)} style={cellStyles.sanctImg} resizeMode="cover" />
          <View style={cellStyles.idTag}>
            <Text style={cellStyles.idTagTxt}>#{id}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

function CardPicker({ type, currentId, probableIds, usedIds, onPick, onCancel, onRemove, insets }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isSanct = type === 'sanctuary';

  const cols = 5;
  const gap = 6;
  const padH = SPACING.md;
  const cellW = (winW - padH * 2 - gap * cols) / cols;
  const cellH = cellW * 1.4;
  const PAGE_SIZE = 5;

  // ── Ligne 1 sanctuaire : detecte + 4 candidates (fixe) ──
  const topRowIds = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (id) => {
      if (id == null || seen.has(id) || id < 1 || id > SANCTUARY_COUNT) return;
      seen.add(id);
      out.push(id);
    };
    push(currentId);
    for (const id of probableIds || []) push(id);
    return out.slice(0, 5);
  }, [currentId, probableIds]);

  // ── Reste des sanctuaires (ordre numerique, sans ceux du top) ──
  const remainingIds = useMemo(() => {
    const topSet = new Set(topRowIds);
    const out = [];
    for (let i = 1; i <= SANCTUARY_COUNT; i++) {
      if (!topSet.has(i)) out.push(i);
    }
    return out;
  }, [topRowIds]);

  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(remainingIds.length / PAGE_SIZE);
  const bottomRowIds = remainingIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Region : liste complete dans un FlatList (texte leger) ──
  const regionIds = useMemo(() => {
    if (isSanct) return [];
    const seen = new Set();
    const out = [];
    const push = (id) => {
      if (id == null || seen.has(id) || id < 0 || id >= REGION_TOTAL) return;
      seen.add(id);
      out.push(id);
    };
    push(currentId);
    for (const id of usedIds) push(id);
    for (let i = 0; i < REGION_TOTAL; i++) push(i);
    return out;
  }, [isSanct, currentId, usedIds]);

  const renderRegionItem = ({ item: id }) => (
    <PickerCell
      id={id} type="region" cellW={cellW} cellH={cellH} gap={gap}
      isCurrent={id === currentId}
      isUsed={id !== currentId && usedIds.includes(id)}
      onPick={onPick}
    />
  );

  return (
    <View style={[pk.sheet, { maxHeight: winH * 0.85 }]}>
      <View style={pk.header}>
        {isSanct && onRemove ? (
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={pk.remove}>Retirer</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 52 }} />
        )}
        <Text style={pk.title}>
          {isSanct ? 'Choisir le Sanctuaire' : 'Choisir la carte Région'}
        </Text>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={pk.close}>Annuler</Text>
        </TouchableOpacity>
      </View>

      {isSanct ? (
        <View style={{ padding: padH, paddingBottom: insets.bottom + SPACING.lg }}>
          {/* Ligne 1 : detecte + alternatives */}
          <View style={pk.sanctRow}>
            {topRowIds.map((id) => (
              <PickerCell
                key={id} id={id} type="sanctuary" cellW={cellW} cellH={cellH} gap={gap}
                isCurrent={id === currentId}
                isUsed={id !== currentId && usedIds.includes(id)}
                onPick={onPick}
              />
            ))}
          </View>

          {/* Ligne 2 : parcourir les autres avec ◀ ▶ */}
          <View style={pk.sanctRow}>
            {bottomRowIds.map((id) => (
              <PickerCell
                key={id} id={id} type="sanctuary" cellW={cellW} cellH={cellH} gap={gap}
                isCurrent={id === currentId}
                isUsed={id !== currentId && usedIds.includes(id)}
                onPick={onPick}
              />
            ))}
          </View>

          <View style={pk.navRow}>
            <TouchableOpacity
              onPress={() => setPage((p) => p - 1)}
              disabled={page === 0}
              style={[pk.navBtn, page === 0 && pk.navBtnDisabled]}
            >
              <Text style={[pk.navBtnTxt, page === 0 && pk.navBtnTxtDisabled]}>◀ Préc.</Text>
            </TouchableOpacity>
            <Text style={pk.navPage}>{page + 1} / {totalPages}</Text>
            <TouchableOpacity
              onPress={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1}
              style={[pk.navBtn, page >= totalPages - 1 && pk.navBtnDisabled]}
            >
              <Text style={[pk.navBtnTxt, page >= totalPages - 1 && pk.navBtnTxtDisabled]}>Suiv. ▶</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={regionIds}
          keyExtractor={(id) => String(id)}
          numColumns={cols}
          renderItem={renderRegionItem}
          contentContainerStyle={{ padding: padH, paddingRight: padH - gap, paddingBottom: insets.bottom + SPACING.lg }}
          removeClippedSubviews
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}
    </View>
  );
}

const pk = StyleSheet.create({
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: FONTS.subtitle, fontWeight: '700', color: COLORS.text },
  close: { color: COLORS.primary, fontSize: FONTS.body, fontWeight: '600' },
  remove: { color: '#E03030', fontSize: FONTS.body, fontWeight: '600' },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
  },
  regionCell: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  sanctCell: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    overflow: 'hidden',
    backgroundColor: COLORS.cardBg,
  },
  cellCurrent: { borderColor: COLORS.primary, borderWidth: 3 },
  cellUsed: { opacity: 0.35 },
  regionNum: { fontWeight: '700', color: COLORS.text },
  sanctRow: { flexDirection: 'row', flexWrap: 'wrap' },
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACING.sm,
  },
  navBtn: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md },
  navBtnDisabled: { opacity: 0.3 },
  navBtnTxt: { color: COLORS.primary, fontWeight: '600', fontSize: FONTS.body },
  navBtnTxtDisabled: { color: COLORS.textLight },
  navPage: { color: COLORS.textLight, fontSize: FONTS.small },
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
  const [torchOn, setTorchOn] = useState(false);
  const [taking, setTaking] = useState(false);

  const reset = () => {
    setStep('instruction');
    setPhotoUri(null);
    setResults([]);
    setEditingIndex(null);
  };

  const handleClose = async () => {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    reset();
    onClose();
  };

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
        '2. Crée un compte gratuit (Google ou email)\n' +
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
    setTorchOn(false);
    setStep(nextStep);
  };

  const takePhoto = async () => {
    if (!cameraRef.current || taking) return;
    setTaking(true);
    setTimeout(() => setTaking(false), 1000);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        exif: true,
        skipProcessing: true,
      });

      // La camera est lockee en LANDSCAPE_RIGHT mais selon le device, le resultat
      // peut sortir en portrait natif, landscape-left (flip 180), etc. — se fier
      // aux dimensions ne suffit pas. On se base sur l'EXIF Orientation qui reflete
      // l'orientation physique au moment du clic, et on rotate toujours vers LR.
      //   1 = portrait natif      -> -90°
      //   3 = portrait inverse    ->  90°
      //   6 = landscape-left      -> 180°
      //   8 = landscape-right     ->  0° (deja bon)
      const orient = photo.exif?.Orientation ?? 1;
      const rotate =
        orient === 3 ? 180 :
        orient === 6 ? -90 :
        orient === 8 ?  90 :
                         0;

      let finalUri = photo.uri;
      if (rotate !== 0) {
        const rotated = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ rotate }],
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
      Alert.alert('Le scan a échoué', 'Recommence la photo.', [{ text: 'OK' }]);
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
      setStep('camera');
    }
  };

  const applyEdit = (id) => {
    setResults((prev) =>
      prev.map((r) => r.index === editingIndex ? { ...r, id, confidence: 'high' } : r)
    );
    setEditingIndex(null);
  };

  const removeSanctuary = (index) => {
    setResults((prev) => prev.filter((r) => r.index !== index));
  };


  const addSanctuary = () => {
    const maxIndex = results.length > 0 ? Math.max(...results.map((r) => r.index)) : -1;
    const newItem = { index: maxIndex + 1, type: 'sanctuary', id: null, confidence: 'none', candidates: [] };
    setResults((prev) => [...prev, newItem]);
    setEditingIndex(maxIndex + 1);
  };

  const handleConfirm = () => {
    const regions     = results.filter((r) => r.type === 'region').map((r) => ({ id: r.id }));
    const sanctuaries = results.filter((r) => r.type === 'sanctuary').map((r) => ({ id: r.id }));
    onComplete({ regions, sanctuaries });
    reset();
  };

  const allIdentified = results.length > 0 && results.every((r) => r.id !== null);

  // ─── Decoupage des resultats en rangees ──────────────────────────────
  const sanctuaryItems = useMemo(
    () => results.filter((r) => r.type === 'sanctuary').sort((a, b) => a.index - b.index),
    [results]
  );
  const regionsRow1 = useMemo(
    () => results.filter((r) => r.type === 'region' && r.row === 0).sort((a, b) => a.col - b.col),
    [results]
  );
  const regionsRow2 = useMemo(
    () => results.filter((r) => r.type === 'region' && r.row === 1).sort((a, b) => a.col - b.col),
    [results]
  );

  // ─── Sizing de la grille ─────────────────────────────────────────────
  const GRID_GAP = 6;
  const gridW = winW - SPACING.md * 2;
  const regionCellW = (gridW - GRID_GAP * 3) / 4;
  const regionCellH = regionCellW * 1.4;
  const MAX_SANCT = 7;
  const PLUS_BTN_W = 28;
  const sanctCount = sanctuaryItems.length;
  const canAddSanctuary = sanctCount < MAX_SANCT;
  const plusSpace = canAddSanctuary ? PLUS_BTN_W + GRID_GAP : 0;
  const sanctCellW = sanctCount > 0
    ? Math.min(regionCellW * 0.7, (gridW - plusSpace - GRID_GAP * (sanctCount - 1)) / sanctCount)
    : regionCellW * 0.5;
  const sanctCellH = sanctCellW * 1.4;

  // ─── Donnees pour le picker d'edition ───────────────────────────────
  const editingItem = editingIndex != null ? results.find((r) => r.index === editingIndex) : null;
  const editingUsedIds = useMemo(() => {
    if (!editingItem) return [];
    return results
      .filter((r) => r.type === editingItem.type && r.index !== editingIndex && r.id != null)
      .map((r) => r.id);
  }, [results, editingItem, editingIndex]);

  // ─── Cadre camera ───────────────────────────────────────────────────
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
              <View style={s.schema}>
                <View style={s.schemaRow}>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <View key={i} style={[s.schemaCard, s.schemaCardSanctuary]} />
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
                const newVal = !skipGuide;
                await setScanSkipGuide(newVal);
                setSkipGuide(newVal);
              }}
            >
              <View style={[s.checkbox, skipGuide && s.checkboxChecked]}>
                {skipGuide && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={s.skipGuideTxt}>Ne plus afficher ce guide</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Étape 2 : Caméra ── */}
        {step === 'camera' && permission?.granted && (
          <View style={s.cameraContainer}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={0} ratio="4:3" enableTorch={torchOn} />

            <View style={s.cameraOverlay}>
              <View style={[s.cameraFrame, { width: frameW, height: frameH }]}>
                <View style={[s.corner, s.cornerTL]} />
                <View style={[s.corner, s.cornerTR]} />
                <View style={[s.corner, s.cornerBL]} />
                <View style={[s.corner, s.cornerBR]} />

                <View style={[s.dividerH, { top: cellSize }]} />
                <View style={[s.dividerH, { top: cellSize * 2 }]} />
                {[1, 2, 3].map((col) => (
                  <View key={col} style={[s.dividerV, { left: cellSize * col, top: cellSize }]} />
                ))}

                <Text style={[s.zoneLabel, { top: 4, left: 6 }]}>Sanctuaires</Text>
                <Text style={[s.zoneLabel, { top: frameH / 3 + 4, left: 6 }]}>Régions 1–4</Text>
                <Text style={[s.zoneLabel, { top: (frameH * 2) / 3 + 4, left: 6 }]}>Régions 5–8</Text>
              </View>
            </View>

            <View style={[s.cameraControls, { right: insets.right, width: shutterAreaW }]}>
              <TouchableOpacity
                onPress={() => setTorchOn((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[s.torchBtn, torchOn && s.torchBtnOn]}
              >
                <Text style={s.torchIcon}>🔦</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.shutterBtn, taking && { opacity: 0.4 }]} onPress={takePhoto} disabled={taking}>
                <View style={s.shutterInner} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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

        {/* ── Résultats (grille type plateau) ── */}
        {step === 'results' && (
          <View style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={s.resultsScroll}>
              {photoUri && (
                <Image source={{ uri: photoUri }} style={s.photoPreview} resizeMode="contain" />
              )}

              <Text style={s.sectionLabel}>Ton tableau reconstitué</Text>

              <View style={[s.board, { gap: GRID_GAP }]}>
                <View style={[s.boardRow, { gap: GRID_GAP, justifyContent: 'center' }]}>
                  {sanctuaryItems.map((item) => (
                    <SanctuaryCell
                      key={item.index}
                      item={item}
                      width={sanctCellW}
                      height={sanctCellH}
                      onPress={() => setEditingIndex(item.index)}
                    />
                  ))}
                  {canAddSanctuary && (
                    <TouchableOpacity
                      style={[s.addSanctBtn, { width: PLUS_BTN_W, height: sanctCellH }]}
                      onPress={addSanctuary}
                      activeOpacity={0.7}
                    >
                      <Text style={s.addSanctBtnTxt}>+</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={[s.boardRow, { gap: GRID_GAP }]}>
                  {regionsRow1.map((item) => (
                    <RegionCell
                      key={item.index}
                      item={item}
                      width={regionCellW}
                      height={regionCellH}
                      onPress={() => setEditingIndex(item.index)}
                    />
                  ))}
                </View>

                <View style={[s.boardRow, { gap: GRID_GAP }]}>
                  {regionsRow2.map((item) => (
                    <RegionCell
                      key={item.index}
                      item={item}
                      width={regionCellW}
                      height={regionCellH}
                      onPress={() => setEditingIndex(item.index)}
                    />
                  ))}
                </View>
              </View>

              <Text style={s.hint}>Tape sur une carte pour la modifier</Text>
            </ScrollView>

            <View style={[s.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
              {!allIdentified && (
                <Text style={s.warningTxt}>
                  ⚠️ Certaines cartes n'ont pas été reconnues — tape dessus pour les corriger.
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

        {/* ── Modal correction (picker visuel) ── */}
        <Modal
          visible={editingIndex !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setEditingIndex(null)}
        >
          <View style={s.editOverlay}>
            {editingItem && (
              <CardPicker
                type={editingItem.type}
                currentId={editingItem.id}
                probableIds={editingItem.candidates || []}
                usedIds={editingUsedIds}
                onPick={applyEdit}
                onCancel={() => {
                  if (editingItem.id === null && editingItem.type === 'sanctuary') {
                    removeSanctuary(editingIndex);
                  }
                  setEditingIndex(null);
                }}
                onRemove={editingItem.type === 'sanctuary' ? () => {
                  removeSanctuary(editingIndex);
                  setEditingIndex(null);
                } : undefined}
                insets={insets}
              />
            )}
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
    width: 36, height: 36, borderRadius: 4,
    backgroundColor: COLORS.secondary + '25',
    borderWidth: 1, borderColor: COLORS.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  schemaCardSanctuary: {
    width: 20, height: 36,
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

  skipGuideBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACING.xs, gap: SPACING.xs,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 4,
    borderWidth: 2, borderColor: COLORS.textLight,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  checkmark: { color: COLORS.white, fontSize: 13, fontWeight: '700', lineHeight: 16 },
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
  corner: {
    position: 'absolute', width: 18, height: 18,
    borderColor: COLORS.white, borderWidth: 3,
  },
  cornerTL: { top: -1, left: -1, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: -1, right: -1, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: -1, left: -1, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: -1, right: -1, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 6 },
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
  torchBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  torchBtnOn: { backgroundColor: 'rgba(255,220,80,0.55)' },
  torchIcon: { fontSize: 20 },

  // Traitement
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.lg, padding: SPACING.md },
  processingTxt: { fontSize: FONTS.subtitle, color: COLORS.text, fontWeight: '600' },

  // Résultats
  photoPreview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10, marginBottom: SPACING.sm },
  resultsScroll: { padding: SPACING.md, paddingBottom: SPACING.xl },
  sectionLabel: {
    fontSize: FONTS.small, fontWeight: '700', color: COLORS.textLight,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: SPACING.sm, marginBottom: SPACING.sm,
  },
  board: { alignItems: 'stretch' },
  boardRow: { flexDirection: 'row', alignItems: 'flex-end' },
  hint: {
    marginTop: SPACING.md, textAlign: 'center',
    fontSize: FONTS.small, color: COLORS.textLight, fontStyle: 'italic',
  },

  footer: {
    padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.background, gap: SPACING.sm,
  },
  warningTxt: { fontSize: FONTS.small, color: COLORS.primary, textAlign: 'center' },

  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },

  addSanctBtn: {
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.primary + '80',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary + '12',
  },
  addSanctBtnTxt: { color: COLORS.primary, fontSize: 20, fontWeight: '300' },
});
