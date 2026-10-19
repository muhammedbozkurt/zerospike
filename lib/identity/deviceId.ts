import AsyncStorage from "@react-native-async-storage/async-storage";
import { uuid } from "../uuid";

// Ayni anahtar lib/ai/spikeClient.ts'ten tasindi; mevcut kurulumlarin kimligi korunur.
export const DEVICE_ID_KEY = "zerospike.deviceId";

/** Sunucu DEVICE_ID_RE en az 8 karakter ister. */
export const DEVICE_ID_FALLBACK = "unknown-device";

/** Kalici anonim kurulum kimligi: Spike gunluk siniri, analitik zarfi ve RevenueCat attribute icin tek kaynak. Kimlik veya saglik verisine bagli degildir. */
export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = uuid();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return DEVICE_ID_FALLBACK;
  }
}
