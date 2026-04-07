import AsyncStorage from '@react-native-async-storage/async-storage';

const GROQ_KEY = 'groq_api_key';

export async function getGroqApiKey() {
  return await AsyncStorage.getItem(GROQ_KEY);
}

export async function setGroqApiKey(key) {
  await AsyncStorage.setItem(GROQ_KEY, key.trim());
}

export async function clearGroqApiKey() {
  await AsyncStorage.removeItem(GROQ_KEY);
}
