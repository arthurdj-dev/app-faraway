import AsyncStorage from '@react-native-async-storage/async-storage';

const GROQ_KEY        = 'groq_api_key';
const SCAN_SKIP_GUIDE = 'scan_skip_guide';
const HISTORY_KEY     = 'game_history';

export async function getGroqApiKey() {
  return await AsyncStorage.getItem(GROQ_KEY);
}

export async function setGroqApiKey(key) {
  await AsyncStorage.setItem(GROQ_KEY, key.trim());
}

export async function clearGroqApiKey() {
  await AsyncStorage.removeItem(GROQ_KEY);
}

export async function getScanSkipGuide() {
  return (await AsyncStorage.getItem(SCAN_SKIP_GUIDE)) === 'true';
}

export async function setScanSkipGuide(value) {
  await AsyncStorage.setItem(SCAN_SKIP_GUIDE, value ? 'true' : 'false');
}

// ─── Historique des parties ───────────────────────────────────────────────

export async function getHistory() {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
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
