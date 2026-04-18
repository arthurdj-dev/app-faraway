/**
 * tableauScanner.js
 *
 * Flow:
 *  1. Backend ORB /match-regions  → détecte les 8 cartes Région + leurs quads
 *  2. Dérive la sanctuary_zone géométriquement à partir des quads détectés
 *  3. Backend ORB /match-sanctuaries → matche la zone sanctuaires
 */

import * as ImageManipulator from 'expo-image-manipulator';
import regionCards from '../data/region_cards.json';

const REGION_COUNT = 8;

// URL du backend ORB déployé sur Google Cloud Run (région europe-west9).
// Pour dev local, remplacer par 'http://localhost:8000'.
const BACKEND_URL = 'https://faraway-backend-367452467200.europe-west9.run.app';
const HIGH_CONFIDENCE_INLIERS = 150;

// ─── Utilitaires image ─────────────────────────────────────────────────────

async function resizeToBase64(uri) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1920 } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.92, base64: true }
  );
  return { base64: result.base64, uri: result.uri, width: result.width, height: result.height };
}

// ─── Géométrie des quads ───────────────────────────────────────────────────

function quadCentroidY(quad) {
  if (!Array.isArray(quad) || quad.length === 0) return 0;
  return quad.reduce((sum, pt) => sum + (pt?.[1] ?? 0), 0) / quad.length;
}

function quadCentroidX(quad) {
  if (!Array.isArray(quad) || quad.length === 0) return 0;
  return quad.reduce((sum, pt) => sum + (pt?.[0] ?? 0), 0) / quad.length;
}

/**
 * Répartit les détections sur les positions 1–8 (2 rangées de 4).
 * Algorithme : tri par Y → plus grande lacune Y = frontière des rangées
 *              → tri par X au sein de chaque rangée.
 */
function assignPositions(detections) {
  if (detections.length === 0) return [];

  const sorted = [...detections].sort(
    (a, b) => quadCentroidY(a.quad) - quadCentroidY(b.quad),
  );

  // Chercher la plus grande discontinuité verticale entre cartes consécutives
  let splitIdx = Math.ceil(sorted.length / 2); // fallback : moitié
  let maxGap = -1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = quadCentroidY(sorted[i].quad) - quadCentroidY(sorted[i - 1].quad);
    if (gap > maxGap) {
      maxGap = gap;
      splitIdx = i;
    }
  }

  const top = sorted.slice(0, splitIdx).sort(
    (a, b) => quadCentroidX(a.quad) - quadCentroidX(b.quad),
  );
  const bot = sorted.slice(splitIdx).sort(
    (a, b) => quadCentroidX(a.quad) - quadCentroidX(b.quad),
  );

  const result = [];
  top.forEach((d, i) => result.push({ d, position: i + 1,              row: 0, col: i }));
  bot.forEach((d, i) => result.push({ d, position: top.length + i + 1, row: 1, col: i }));
  return result;
}

/**
 * Déduit la zone sanctuaires : tout ce qui est au-dessus du bord supérieur
 * des cartes Région, exprimé en fractions de la hauteur image.
 */
function deriveSanctuaryZone(detections, imgHeight) {
  if (!detections.length || !imgHeight) return null;

  const allYPoints = detections
    .filter((d) => Array.isArray(d.quad) && d.quad.length)
    .flatMap((d) => d.quad.map((pt) => pt[1]));

  if (!allYPoints.length) return null;

  const minY = Math.min(...allYPoints);
  if (!isFinite(minY)) return null;

  const yFrac = minY / imgHeight;
  const pad = 0.04;
  return { x: 0, y: 0, w: 1, h: Math.min(1, yFrac + pad) };
}

// ─── Calcul du nombre de sanctuaires ──────────────────────────────────────

function countSanctuaries(regionIds) {
  let total = 0;
  for (let i = 1; i < regionIds.length; i++) {
    const card     = regionCards[regionIds[i]];
    const prevCard = regionCards[regionIds[i - 1]];
    if (!card || !prevCard) continue;
    if (card.duration > prevCard.duration) total++;
  }
  return total;
}

// ─── Appels backend ────────────────────────────────────────────────────────

async function callBackendRegions(base64) {
  const resp = await fetch(`${BACKEND_URL}/match-regions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: base64, expected_count: REGION_COUNT }),
  });
  if (!resp.ok) throw new Error(`Backend regions ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function callBackendSanctuaries(base64, zone, expectedCount) {
  const body = { image_base64: base64 };
  if (zone && typeof zone.h === 'number' && zone.h > 0) {
    body.zone = zone;
  }
  if (expectedCount > 0) body.expected_count = expectedCount;
  const resp = await fetch(`${BACKEND_URL}/match-sanctuaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Backend ORB ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ─── Fonction principale ───────────────────────────────────────────────────

export async function scanTableau(photoUri) {
  const resized = await resizeToBase64(photoUri);
  const { base64, height: imgHeight } = resized;

  // 1. Régions via ORB
  const regionResp = await callBackendRegions(base64);
  if (__DEV__) console.log('[ORB regions]', JSON.stringify(regionResp, null, 2));

  const assigned = assignPositions(regionResp.detections ?? []);

  const results = [];
  const regionIds = new Array(REGION_COUNT).fill(null);

  for (const { d, position, row, col } of assigned) {
    const id = d.id ?? null;
    regionIds[position - 1] = id;
    results.push({
      index:      position - 1,
      type:       'region',
      id,
      confidence: d.inliers >= HIGH_CONFIDENCE_INLIERS ? 'high' : 'low',
      row,
      col,
    });
  }

  // Positions manquantes (cartes non détectées)
  for (let pos = 0; pos < REGION_COUNT; pos++) {
    if (!results.find((r) => r.index === pos)) {
      results.push({
        index:      pos,
        type:       'region',
        id:         null,
        confidence: 'none',
        row:        pos < 4 ? 0 : 1,
        col:        pos % 4,
      });
    }
  }

  // 2. Zone sanctuaires dérivée géométriquement
  const zone = deriveSanctuaryZone(regionResp.detections ?? [], imgHeight);

  // 3. Nombre de sanctuaires attendus
  const expectedCount = countSanctuaries(regionIds);

  // 4. Sanctuaires via ORB
  if (expectedCount > 0 || zone) {
    const backendResp = await callBackendSanctuaries(base64, zone, expectedCount);
    if (__DEV__) console.log('[ORB sanctuaries]', JSON.stringify(backendResp, null, 2));

    const detections = [...(backendResp.detections ?? [])].sort(
      (a, b) => quadCentroidX(a.quad) - quadCentroidX(b.quad),
    );
    for (let i = 0; i < detections.length; i++) {
      const d = detections[i];
      results.push({
        index:      REGION_COUNT + i,
        type:       'sanctuary',
        id:         d.id,
        confidence: d.inliers >= HIGH_CONFIDENCE_INLIERS ? 'high' : 'low',
        inliers:    d.inliers,
        candidates: Array.isArray(d.candidates) ? d.candidates.map((c) => c.id) : [],
      });
    }
  }

  return results;
}
