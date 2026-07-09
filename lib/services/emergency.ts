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

/**
 * Region → international calling code. A pragmatic set covering the app's
 * markets and the common diaspora destinations; anything unlisted simply yields
 * no default, and the user types the "+" prefix themselves.
 */
const CALLING_CODES: Record<string, string> = {
  TR: "+90",
  DE: "+49",
  FR: "+33",
  ES: "+34",
  US: "+1",
  CA: "+1",
  GB: "+44",
  NL: "+31",
  IT: "+39",
  AT: "+43",
  CH: "+41",
  BE: "+32",
  SE: "+46",
  NO: "+47",
  DK: "+45",
  FI: "+358",
  PL: "+48",
  PT: "+351",
  IE: "+353",
  GR: "+30",
  CZ: "+420",
  RO: "+40",
  RU: "+7",
  UA: "+380",
  AZ: "+994",
  AU: "+61",
  NZ: "+64",
  JP: "+81",
  KR: "+82",
  CN: "+86",
  IN: "+91",
  BR: "+55",
  MX: "+52",
  AR: "+54",
  AE: "+971",
  SA: "+966",
  QA: "+974",
  KW: "+965",
  EG: "+20",
  ZA: "+27",
  IL: "+972",
};

/** The device region's calling code (e.g. "TR" → "+90"), or "" when unknown. */
export function defaultCallingCode(regionCode?: string | null): string {
  if (!regionCode) return "";
  return CALLING_CODES[regionCode.toUpperCase()] ?? "";
}

/**
 * Region → the number to reach an ambulance. 112 is the default (Turkey and the
 * EU) but it is not the emergency number everywhere, so a US device must offer
 * 911. The app can only ever OPEN the dialer with this number prefilled.
 */
const EMERGENCY_NUMBERS: Record<string, string> = {
  US: "911",
  CA: "911",
  MX: "911",
  GB: "999",
  AU: "000",
  NZ: "111",
  JP: "119",
  KR: "119",
  CN: "120",
  BR: "192",
  IN: "112",
};

/** The emergency number for a region, falling back to 112. */
export function emergencyNumberForRegion(regionCode?: string | null): string {
  if (!regionCode) return "112";
  return EMERGENCY_NUMBERS[regionCode.toUpperCase()] ?? "112";
}

/**
 * Normalizes a typed or contact-book number to E.164, using the device region's
 * calling code when the number is written in local form. Deliberately simple
 * (no libphonenumber): strip separators, turn a leading "00" into "+", and for a
 * bare local number prepend the default code while dropping the single national
 * trunk "0" (05xx… → +905xx…). Returns null when the result is not a plausible
 * "+" followed by 8-15 digits, so the caller can show an inline error.
 */
export function normalizePhoneWithRegion(
  raw: string,
  callingCode: string
): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!cleaned) return null;

  let e164: string;
  if (cleaned.startsWith("+")) {
    e164 = cleaned;
  } else if (cleaned.startsWith("00")) {
    e164 = `+${cleaned.slice(2)}`;
  } else {
    const code = callingCode.trim();
    // No known region and no explicit "+": we cannot qualify the number.
    if (!/^\+\d{1,4}$/.test(code)) return null;
    e164 = code + cleaned.replace(/^0/, "");
  }

  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}
