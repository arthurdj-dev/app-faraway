# Suppression de la dépendance Groq — Plan

## Contexte

Aujourd'hui, [src/utils/tableauScanner.js](src/utils/tableauScanner.js) appelle Groq (Llama 4 Scout via leur API) pour deux choses uniquement :

1. **Lire les 8 numéros de cartes Région** (IDs 0–76) sur la photo du tableau ([tableauScanner.js:103-134](src/utils/tableauScanner.js#L103-L134))
2. **Estimer la bounding box de la rangée des sanctuaires** (`sanctuary_zone`) pour pré-cropper avant l'appel ORB

Tout le reste (matching des sanctuaires) tourne déjà sur **notre backend FastAPI ORB** sur Cloud Run, sans aucune API tierce. Les sanctuaires fonctionnent très bien en pur ORB + RANSAC + NMS, donc rien ne s'oppose techniquement à étendre la même mécanique aux régions.

**Objectif** : supprimer totalement Groq pour que l'utilisateur n'ait plus jamais à entrer une clé API. L'app reste identique côté UX, sauf qu'on dégage [GroqKeyModal](src/components/GroqKeyModal.js) et le bouton clé dans [NewGame.js:98-104](src/screens/NewGame.js#L98-L104).

**Approche retenue** : appliquer la même pipeline ORB que pour les sanctuaires aux 77 cartes Région. Le backend devient l'unique source de vérité, l'app n'a plus qu'à uploader la photo.

**Tradeoff principal** : il faut produire 77 images de référence des cartes Région (one-shot, manuel ou semi-auto) et les pré-calculer en descripteurs ORB. C'est l'unique blocage non-trivial du plan.

---

## Phase 1 — Constituer les images de référence des 77 régions

Mirroir de ce qui existe pour les sanctuaires dans [assets/sanctuary-references/](assets/sanctuary-references/).

- Cible : `assets/region-references/region-{00..76}/card.jpg` (1 image par carte, ~600px côté long, fond neutre, sans reflet)
- Sources possibles :
  - photographier manuellement les 77 cartes (≈ 1h, lumière diffuse, sans flash)
  - ou crop des PDF/print files officiels de Catch Up Games si disponibles
- Critère qualité : la zone du numéro doit être nette + assez de texture/illustration pour qu'ORB ait des features (pas juste le numéro isolé)

**Risque** : si une carte a très peu de texture (illustration trop minimaliste), ORB sera faible. À surveiller en Phase 5.

## Phase 2 — Script de pré-calcul des descripteurs régions

Cloner [scripts/precompute_sanctuary_descriptors.py](scripts/precompute_sanctuary_descriptors.py) → `scripts/precompute_region_descriptors.py` :

- Lit `assets/region-references/region-*/card.jpg`
- ORB avec `nfeatures=1500` (idem sanctuaires)
- Dump → `backend/region_descriptors.pkl`

Aucun changement de logique, juste un nouveau dossier source et un nouveau pickle de sortie.

## Phase 3 — Backend : endpoint `/match-regions`

Dans [backend/main.py](backend/main.py), ajouter un endpoint qui réutilise les helpers existants (`decode_image`, `match_pair`, `quad_iou`, `validate_quad`) — déjà tous génériques.

```
POST /match-regions
body: { image_base64, expected_count?: 8 }
response: { detections: [{id, inliers, quad, candidates}], elapsed_ms }
```

Différences avec `/match-sanctuaries` :
- Charger `region_descriptors.pkl` au démarrage en plus de `sanctuary_descriptors.pkl` (variable `REGION_REFS`)
- Pas de `zone` dans la requête : on scanne toute l'image (les régions occupent les 2/3 du bas)
- `expected_count` par défaut = 8 (toujours 8 régions au décompte)
- Tolérer un `MAX_QUAD_AREA_FRAC` plus généreux car les régions sont plus grosses qu'un sanctuaire

Refacto léger souhaitable (mais pas critique) : factoriser le corps de `match_sanctuaries` ([main.py:187-277](backend/main.py#L187-L277)) en `_match_against(refs, img, expected_count, zone=None)` et appeler depuis les deux endpoints.

**Risque** : matchs croisés entre régions et sanctuaires si on les confond. Peu probable car les visuels sont très différenciés, mais à valider. Le seuil `MIN_INLIERS_STRICT=100` actuel devrait suffire.

## Phase 4 — Refonte de `tableauScanner.js`

Réécriture complète. Nouveau flow :

1. `resizeToBase64(photoUri)` (inchangé)
2. `POST /match-regions` → récupère jusqu'à 8 quads + IDs
3. **Assignation des positions 1–8** côté JS :
   - Calculer le centroïde Y de chaque quad → clusteriser en 2 rangées (k-means k=2 ou simple seuil sur la médiane Y)
   - Trier chaque rangée par X croissant
   - Position 1–4 = rangée du haut, 5–8 = rangée du bas
4. Calculer `expectedCount` sanctuaires via `countSanctuaries(regionIds)` (logique existante [tableauScanner.js:143-152](src/utils/tableauScanner.js#L143-L152) — à conserver)
5. **Dériver `sanctuary_zone`** géométriquement à partir des quads de régions :
   - `y_top` = min des Y des quads régions de la rangée du haut
   - `zone = { x: 0, y: 0, w: 1, h: y_top + petite_marge }` (en fractions)
6. `POST /match-sanctuaries` (inchangé) avec cette zone
7. Renvoyer le même format `results[]` qu'avant pour que [ScanModal.js](src/components/ScanModal.js) ne change pas

À supprimer :
- Tout `callGroq*`, `parseModelJSON`, `extractJsonBlock` ([tableauScanner.js:33-134](src/utils/tableauScanner.js#L33-L134))
- L'import `getGroqApiKey` et le check `if (!apiKey) throw …`
- Les constantes `GROQ_API_URL`, `GROQ_MODEL`

## Phase 5 — Validation end-to-end

Avant de toucher à l'UI :
- Tester `/match-regions` en local (`py -m uvicorn main:app --reload`) avec les 2 photos d'exemple dans [assets/](assets/) (`exemple-photo-plateau-*.jpg`)
- Vérifier que les 8 régions sont identifiées correctement et que le clustering 2-rangées + tri X donne les bonnes positions
- Vérifier que la `sanctuary_zone` dérivée géométriquement contient bien tous les sanctuaires (sinon élargir la marge)
- Comparer scores finaux avec les scans Groq précédents sur les mêmes photos

Si une carte est mal identifiée à cette étape : c'est l'image de référence qui est en cause → re-shoot ou ajuster `nfeatures` du pré-calcul.

## Phase 6 — Nettoyage UI et stockage

Une fois Phase 5 validée :

- [src/components/GroqKeyModal.js](src/components/GroqKeyModal.js) : **supprimer** le fichier
- [src/screens/NewGame.js](src/screens/NewGame.js) : retirer le state `showGroqKey`, le bouton clé ([NewGame.js:98-104](src/screens/NewGame.js#L98-L104)), l'import `GroqKeyModal` et son rendu ([NewGame.js:171](src/screens/NewGame.js#L171)). Le `titleRow` redevient un simple `<Text>` titre.
- [src/utils/storage.js](src/utils/storage.js) : retirer `GROQ_KEY`, `getGroqApiKey`, `setGroqApiKey`, `clearGroqApiKey` ([storage.js:3,8-18](src/utils/storage.js#L3-L18))
- [CLAUDE.md](CLAUDE.md) : mettre à jour la section "Architecture de reconnaissance" — remplacer "hybride Groq + ORB" par "100% ORB backend"

## Phase 7 — Déploiement

- Rebuild de l'image Docker avec le nouveau pickle régions et le nouveau endpoint
- Re-deploy sur Cloud Run (europe-west9)
- Valider en prod avec une partie réelle avant de pusher l'APK release via [.github/workflows/build-android.yml](.github/workflows/build-android.yml)

---

## Optimisation optionnelle (après Phase 7)

Combiner les deux appels backend en un seul `POST /scan-tableau` qui retourne `{ regions, sanctuaries }` en une roundtrip. Économie : 1 upload base64 (~1 MB) et la latence d'un aller-retour. Petit refacto, pas critique.

---

## Fichiers critiques touchés

- [src/utils/tableauScanner.js](src/utils/tableauScanner.js) — réécriture complète
- [backend/main.py](backend/main.py) — ajout endpoint + chargement pickle régions
- `scripts/precompute_region_descriptors.py` — **nouveau** (clone du sanctuary)
- `assets/region-references/region-{00..76}/card.jpg` — **nouveaux assets** (77 fichiers)
- `backend/region_descriptors.pkl` — **nouveau** (généré, à committer comme le sanctuary)
- [src/screens/NewGame.js](src/screens/NewGame.js) — retirer bouton clé
- [src/components/GroqKeyModal.js](src/components/GroqKeyModal.js) — **supprimer**
- [src/utils/storage.js](src/utils/storage.js) — retirer fonctions Groq
- [CLAUDE.md](CLAUDE.md) — mettre à jour section reconnaissance

## Vérification end-to-end

1. `py scripts/precompute_region_descriptors.py` → `region_descriptors.pkl` généré sans erreur
2. `py -m uvicorn backend.main:app --reload --port 8000` démarre sans crash et log "Loaded 77 régions" + "Loaded 53 sanctuaires"
3. `py backend/test_local.py` (ou un nouveau test dédié) avec une photo réelle → réponse `/match-regions` contenant 8 détections cohérentes
4. App en dev (`npm start`) avec `BACKEND_URL` pointé sur localhost → scan complet d'un tableau réel, vérification visuelle dans [ScanModal](src/components/ScanModal.js) que les 8 régions + N sanctuaires sont corrects
5. Pas de prompt de clé API au premier lancement après install fraîche
