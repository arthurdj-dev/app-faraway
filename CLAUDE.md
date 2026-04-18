# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# app-faraway — Contexte du projet

Application Android (Expo/React Native) pour compter les points d'une partie du jeu de société **Faraway**.

---

## Commandes

### App (Expo)

```bash
npm start              # Metro bundler (Expo Go / dev client)
npm run android        # build + lance sur Android
npm run generate-cards # régénère les vignettes depuis scripts/generateCardTemplates.js (utilise sharp)
```

Pas de linter ni de suite de tests configurée côté JS — vérifier `package.json` avant d'en inventer.

### Backend ORB (Python / FastAPI)

Répertoire : `backend/`

```bash
pip install -r requirements.txt
py -m uvicorn main:app --reload --port 8000   # local
```

- `sanctuary_descriptors.pkl` est **pré-calculé** par `scripts/precompute_sanctuary_descriptors.py` — à régénérer si les images de référence de sanctuaires changent.
- Scripts de test ad-hoc à la racine de `backend/` : `test_local.py`, `test_remote.py`, `test_remote2.py`, `test_candidates.py` — ce sont des scripts manuels (pas pytest), ils s'exécutent directement (`py backend/test_remote.py`).
- Déploiement : `Dockerfile` présent (service distant dont l'URL est codée dans `src/utils/tableauScanner.js`).

### POCs de vision

`scripts/orb_*_poc.py` — scripts d'expérimentation ORB autonomes (hors flux app). À lancer à la main pendant l'itération sur les paramètres de matching.

---

## Stack technique

- **Expo** ~54.0.33 / React Native 0.81.5
- Pas d'expo-router — navigation par carousel horizontal (`ScrollView` + `pagingEnabled`)
- `react-native-safe-area-context` — SafeAreaProvider en racine, `useSafeAreaInsets()` dans les écrans pour le padding bas des footers
- `expo-camera` — scan des cartes (logique de comptage à implémenter)
- `@expo/vector-icons` — **toujours importer directement** : `import Ionicons from '@expo/vector-icons/Ionicons'` (l'import destructuré via `@expo/vector-icons` plante sur Windows)
- `KeyboardAvoidingView` dans chaque écran contenant des inputs

## Architecture

```
App.js                          ← SafeAreaProvider + carousel 3 onglets, passe isActive à History/Stats
src/
  constants/theme.js            ← palette de couleurs et tailles
  components/
    TabBar.js                   ← barre d'onglets avec indicateur
    ScanModal.js                ← scan photo + picker visuel de correction
  screens/
    NewGame.js                  ← saisie joueurs + scan + sauvegarde auto en fin de partie
    History.js                  ← liste des parties (reload sur isActive), suppression, réouverture via Results
    Stats.js                    ← stats agrégées + BoardPreview visuel d'une partie
    Results.js                  ← décompte final, accepte backLabel (ex: "Retour" depuis l'historique)
  utils/
    tableauScanner.js           ← orchestration 100% ORB backend (régions + sanctuaires)
    storage.js                  ← AsyncStorage : scan_skip_guide, historique des parties
    sanctuaryImages.js          ← map id → require() pour les vignettes de sanctuaires
    scoring.js                  ← calculateScore / calculateAllScores
  data/
    region_cards.json           ← 77 cartes (0–76)
    sanctuary_cards.json        ← 53 cartes (1–53)
backend/
  main.py                       ← FastAPI : POST /match-sanctuaries + POST /match-regions (ORB + homographie + NMS)
  sanctuary_descriptors.pkl     ← descripteurs ORB pré-calculés (sanctuaires)
  region_descriptors.pkl        ← descripteurs ORB pré-calculés (régions) — généré par scripts/precompute_region_descriptors.py
```

## Préférences UI/UX

- Fond blanc `#FFFFFF`, orange `#E8621A` comme couleur principale (inspiré boîte du jeu)
- `SafeAreaView edges={['top']}` dans App.js ; chaque écran gère son propre `insets.bottom` dans le footer
- Carousel swipeable entre les 3 onglets (Nouvelle partie → Historique → Statistiques)
- Minimum 1 joueur (on peut jouer solo), pas de minimum à 2
- Champ nom avec placeholder `Nom du joueur X` — pas de label au-dessus
- Bouton scan = icône, bouton ✓ quand scanné, bouton Résultats grisé jusqu'à scan de tous

---

## Règles du jeu Faraway

### Vue d'ensemble

- **2 à 6 joueurs**, 8 manches
- Chaque joueur explore le continent Alula en posant 8 cartes Région de gauche à droite
- But : accumuler des ressources et accomplir des quêtes pour gagner de la **renommée** (points de victoire)
- Composants : 77 cartes Région (numérotées 0 à 76), 53 cartes Sanctuaire (numérotées 1 à 53), 1 bloc de score

### Cartes Région

Chaque carte contient :
- **Biome** : identifié par une couleur et une frise (4 biomes au total — exact à cataloguer)
- **Durée d'exploration** : nombre unique de 0 à 76 (ordre chronologique)
- **Heure** : jour ou nuit (impacte certaines quêtes)
- **Indices** : symboles qui augmentent le nombre de Sanctuaires piochés
- **Ressources** (« Merveilles ») : 0 à plusieurs symboles parmi les 3 types
- **Quêtes** (en bas de carte) : renommée conditionnelle ou inconditionnelle

### Les 3 types de ressources

| Ressource | Royaume | Rareté |
|-----------|---------|--------|
| **Pierre (Uddu)** | Minéral | La plus commune |
| **Chimère (Okiko)** | Animal | Intermédiaire |
| **Chardon doré (Érodoré)** | Végétal | La plus rare |

Les ressources des cartes Région **et** des Sanctuaires s'additionnent pour valider les conditions de quête.

### Quêtes

- Se trouvent dans la partie basse des cartes Région et de certains Sanctuaires
- Rapportent de la renommée **si** la condition est remplie au moment du décompte
- Condition typique : posséder X pierres + Y chimères + Z chardons parmi toutes les cartes visibles
- Certaines quêtes n'ont pas de condition (renommée garantie)
- Certaines quêtes requièrent des cartes d'un biome précis (couleur)
- Le jour/la nuit sur les cartes peut être une condition

> ⚠️ **À cataloguer** : la liste exhaustive des types de quêtes et leurs valeurs exactes en renommée, à établir en parcourant les vraies cartes du jeu avant d'implémenter le décompte.

### Sanctuaires

Deux sections :
- **Haut** : bonus immédiats en cours de partie (indices supplémentaires, ressources, exploration nocturne)
- **Bas** : quêtes annexes rapportant de la renommée en fin de partie

Règle spéciale : certains Sanctuaires sont liés à une couleur de biome et **comptent comme une carte Région de ce biome** pour les calculs de quête.

### Déroulement d'une manche (8 manches)

1. **Phase 1 — Explorer une région** : tous les joueurs choisissent simultanément une carte de leur main, la posent face cachée, puis révèlent.
2. **Phase 2 — Trouver des Sanctuaires** : si la durée d'exploration de la carte jouée est **supérieure** à celle de la carte précédente du joueur → le joueur pioche `1 + nombre total d'indices` cartes Sanctuaire (pas de Sanctuaire au tour 1).
3. **Phase 3 — Fin d'exploration** (ordre : durée la plus basse en premier) :
   - Prendre 1 carte Région depuis l'affichage central (revenir à 3 cartes en main)
   - Choisir 1 Sanctuaire parmi ceux piochés, le placer dans son aire de jeu
   - Défausser les autres Sanctuaires sous la pioche
   - Au tour 8 : ne pas reprendre de carte Région

### Décompte final (de droite à gauche)

1. Retourner toutes les cartes Région face cachée — laisser les Sanctuaires visibles
2. Révéler les cartes Région **une par une, de droite à gauche** (ordre inverse de pose)
3. Pour chaque carte révélée : calculer la renommée en tenant compte de **toutes les cartes Région face visible + tous les Sanctuaires**
4. Après toutes les cartes Région : compter la renommée des Sanctuaires
5. **Vainqueur** : renommée totale la plus élevée
6. **Égalité** : le joueur avec la somme de durées d'exploration la plus basse gagne

> 💡 La mécanique clé : chaque carte est évaluée **avec le contexte cumulatif** de toutes les cartes révélées avant elle (celles à sa droite). La première carte révélée (la plus à droite) est calculée seule ; la dernière (la plus à gauche) voit toutes les autres.

---

## Architecture de reconnaissance (implémentée)

- **Un seul scan** du tableau complet suffit (pas de scan individuel)
- **100% ORB backend** : aucune API tierce, aucune clé requise
- **Backend ORB** : service FastAPI distant (URL configurée dans `tableauScanner.js`)
- **Images de référence** : sanctuaires dans `assets/sanctuary-references/`, régions dans `assets/region-references/`

### Flow (`src/utils/tableauScanner.js`)

1. Resize photo → 1920px JPEG base64
2. **`POST /match-regions`** : détecte les 8 cartes Région + leurs quads (coordonnées pixel)
3. **Assignation positions 1–8** : tri par Y → plus grande lacune = frontière des 2 rangées → tri par X dans chaque rangée
4. **Dérivation sanctuary_zone** géométriquement : minY de tous les quads régions → zone = top de l'image jusqu'à ce Y (+4% de marge)
5. Calcul local du nombre de sanctuaires attendus via comparaison des durées d'exploration
6. **`POST /match-sanctuaries`** avec `image_base64`, `zone` (dérivée géométriquement) et `expected_count`
7. Détections triées par X (gauche → droite) ; chaque détection expose `candidates[]` (4 meilleures alternatives) pour le picker de correction

### Backend ORB (`backend/main.py`)

- Charge `sanctuary_descriptors.pkl` et `region_descriptors.pkl` au démarrage
- Helper `_match_against(refs, img, expected_count, zone)` partagé entre les deux endpoints
- Pour chaque carte de référence : match ORB → Lowe ratio → `findHomography` RANSAC → quad projeté → validation (convexe, aire, ratio côtés)
- **NMS** sur les quads (IoU > 0.3) pour éliminer les doublons spatiaux
- **Seuils d'inliers** : strict (100) par défaut, relâché (30) si `expected_count` fourni (tronque ensuite à top-N)
- Retourne `{detections: [{id, inliers, good_matches, quad, candidates: [{id, inliers}, ...]}], elapsed_ms}`

### Descripteurs pré-calculés

- `scripts/precompute_sanctuary_descriptors.py` → `backend/sanctuary_descriptors.pkl`
- `scripts/precompute_region_descriptors.py` → `backend/region_descriptors.pkl`
- Images de référence régions attendues dans `assets/region-references/region-{00..76}/card.jpg`

### Correction manuelle (`ScanModal.js`)

- Après scan : grille 2 rangées régions (numéros) + 1 rangée sanctuaires (vignettes via `sanctuaryImages.js`)
- Cartes avec `confidence === 'low'` bordurées or, `'none'` bordurées orange
- Tap sur une carte → picker en bottom sheet
  - Régions : `FlatList` paginé 0–76, 5 colonnes
  - Sanctuaires : 1ère ligne = détectée + 4 `candidates` du backend, 2ème ligne = parcourir les autres avec ◀▶

### Persistance (`src/utils/storage.js` + AsyncStorage)

- `scan_skip_guide`
- `game_history` : tableau `[{id, date, players: [{name, total, rank, regions, sanctuaries}]}]`
- API : `getHistory / saveGame / deleteGame / clearHistory`
- `NewGame` sauvegarde automatiquement en fin de partie (dans `handleNewGame`)
- `History` et `Stats` rechargent via prop `isActive` passée depuis `App.js` (reload au focus de l'onglet)

### Base de données locale

- `region_cards.json` : 77 cartes (id 0–76), `{ biome, duration, timeOfDay, clues, resources: { stones, chimeras, thistles }, quests }`
- `sanctuary_cards.json` : 53 cartes (id 1–53), `{ biome, bonus: { night, clues, resources }, quests }`
- Vignettes sanctuaires : `assets/sanctuaires/sanctuaire-{id}/` (cf. `sanctuaryImages.js`)

### Biomes

4 biomes : `vert`, `jaune`, `rouge`, `bleu` — plus `null` pour les cartes sans biome (fond gris/noir)
