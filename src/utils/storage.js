import AsyncStorage from '@react-native-async-storage/async-storage';

const GEMINI_KEY      = 'gemini_api_key';
const SCAN_SKIP_GUIDE = 'scan_skip_guide';

export async function getGeminiApiKey() {
  return await AsyncStorage.getItem(GEMINI_KEY);
}

export async function setGeminiApiKey(key) {
  await AsyncStorage.setItem(GEMINI_KEY, key.trim());
}

export async function clearGeminiApiKey() {
  await AsyncStorage.removeItem(GEMINI_KEY);
}

export async function getScanSkipGuide() {
  return (await AsyncStorage.getItem(SCAN_SKIP_GUIDE)) === 'true';
}

export async function setScanSkipGuide(value) {
  await AsyncStorage.setItem(SCAN_SKIP_GUIDE, value ? 'true' : 'false');
}
