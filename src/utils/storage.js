import AsyncStorage from '@react-native-async-storage/async-storage';

const SCAN_SKIP_GUIDE   = 'scan_skip_guide';
const HISTORY_KEY       = 'game_history';
const LAST_PLAYERS_KEY  = 'last_player_names';

export async function getScanSkipGuide() {
  return (await AsyncStorage.getItem(SCAN_SKIP_GUIDE)) === 'true';
}

export async function setScanSkipGuide(value) {
  await AsyncStorage.setItem(SCAN_SKIP_GUIDE, value ? 'true' : 'false');
}

// ─── Derniers joueurs ────────────────────────────────────────────────────

export async function getLastPlayerNames() {
  const raw = await AsyncStorage.getItem(LAST_PLAYERS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function saveLastPlayerNames(names) {
  await AsyncStorage.setItem(LAST_PLAYERS_KEY, JSON.stringify(names));
}

// ─── Historique des parties ───────────────────────────────────────────────

export async function getHistory() {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveGame(game) {
  const history = await getHistory();
  history.unshift({ id: Date.now().toString(), ...game });
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export async function deleteGame(id) {
  const history = await getHistory();
  await AsyncStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(history.filter((g) => g.id !== id)),
  );
}

export async function clearHistory() {
  await AsyncStorage.removeItem(HISTORY_KEY);
}
