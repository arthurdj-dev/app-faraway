# app-faraway — Contexte du projet

Application Android (Expo/React Native) pour compter les points d'une partie du jeu de société **Faraway**.

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
App.js                          ← SafeAreaProvider + carousel 3 onglets
src/
  constants/theme.js            ← palette de couleurs et tailles
  components/TabBar.js          ← barre d'onglets avec indicateur
  screens/
    NewGame.js                  ← saisie des joueurs + scan + résultats
    History.js                  ← historique des parties (à construire)
    Stats.js                    ← statistiques (à construire)
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
- Composants : 68 cartes Région, 45 cartes Sanctuaire, 1 bloc de score

### Cartes Région

Chaque carte contient :
- **Biome** : identifié par une couleur et une frise (4 biomes au total — exact à cataloguer)
- **Durée d'exploration** : nombre unique de 1 à 68 (ordre chronologique)
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

## Ce qui reste à définir pour le code

- [ ] Catalogue complet des quêtes (types, conditions, valeurs de renommée) → à extraire des vraies cartes
- [ ] Les 4 biomes exacts et leurs couleurs
- [ ] **Méthode de reconnaissance retenue** : approche hybride, 100% offline, sans clé API
  - **Cartes Région** (numéro unique 1-68 + extension) : OCR via `@react-native-ml-kit/text-recognition`
    - Flow : capture → ML Kit lit le numéro → lookup `region_cards.json` → numpad de correction si ambiguïté
    - Nécessite un dev client Expo (pas Expo Go)
  - **Cartes Sanctuaire** (45 cartes, pas de numéro) : **perceptual hashing (pHash)**
    - Principe : chaque carte a une "empreinte visuelle" unique calculée depuis une photo de référence
    - Flow : capture → pHash → distance de Hamming avec les 45 références → carte la plus proche → confirmation "Ce n'est pas cette carte ?"
    - Prétraitement via `expo-image-manipulator` (resize 64×64, niveaux de gris) — pas de lib native
    - Algo pHash implémenté en JS pur (basé sur DCT), rapide sur 45 cartes
    - **Session de référence** : photographier les 45 sanctuaires (2-3 angles/lumières) → script de build génère `sanctuary_hashes.json`
    - Fallback : si confiance faible, afficher les 3 meilleures propositions à choisir manuellement
  - **Base de données locale** :
    - `region_cards.json` : `{ id, biome, duration, timeOfDay, clues, resources: { stones, chimeras, thistles }, quests: [{ fame, condition? }] }`
    - `sanctuary_cards.json` : `{ id, biome, resources: { stones, chimeras, thistles }, clues, quests: [{ fame, condition? }] }`
    - `sanctuary_hashes.json` : `{ id, hashes: [hash1, hash2, ...] }` (plusieurs angles par carte)
- [ ] Structure de la fiche de scores (écran Résultats)
- [ ] Persistance des parties pour l'historique
