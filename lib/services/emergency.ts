import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Emergency contacts for the SOS screen. Stored locally (device-level, offline
 * like everything else). The SOS screen only ever opens the native dialer / SMS
 * composer, so no auto-send is possible and nothing leaves the device without an
 * explicit user tap.
 */
export interface EmergencyContact {
  name: string;
  phone: string;
}

const KEY = "zerospike.emergencyContacts";

export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.name === "string" && typeof c.phone === "string")
      .map((c) => ({ name: String(c.name), phone: String(c.phone) }));
  } catch {
    return [];
  }
}

export async function setEmergencyContacts(
  contacts: EmergencyContact[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(contacts));
  } catch {
    // best-effort persistence
  }
}

/** Keeps only digits and a leading +, so tel:/sms:/wa.me links are well-formed. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^0-9]/g, "");
}
