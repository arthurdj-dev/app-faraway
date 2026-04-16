import AsyncStorage from '@react-native-async-storage/async-storage';

const GROQ_KEY        = 'groq_api_key';
const SCAN_SKIP_GUIDE = 'scan_skip_guide';

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
