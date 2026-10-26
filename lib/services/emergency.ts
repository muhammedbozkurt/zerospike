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

/**
 * Reads the stored list and lets a storage failure reach the caller. An empty
 * list here always means "nothing saved", never "could not read": a writer that
 * got [] from a failed read would overwrite the real list on its next save.
 */
export async function readEmergencyContacts(): Promise<EmergencyContact[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && typeof c.name === "string" && typeof c.phone === "string")
    .map((c) => ({ name: String(c.name), phone: String(c.phone) }));
}

/** Read-only consumers (the SOS screen) degrade to an empty list on failure. */
export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  try {
    return await readEmergencyContacts();
  } catch {
    return [];
  }
}

/** Throws when the list could not be persisted, so the screen can say so. */
export async function setEmergencyContacts(
  contacts: EmergencyContact[]
): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(contacts));
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

/**
 * The comparison key for a phone number, used to tell two contacts apart.
 *
 * Contacts saved today are already E.164, but versions before region-aware
 * normalization stored whatever the user typed ("0532 111 22 33"). Qualifying a
 * stored number through the same path as a freshly picked one means a legacy
 * row still matches the address-book entry it came from, instead of being
 * offered again as a new contact.
 */
export function contactPhoneKey(phone: string, callingCode: string): string {
  return normalizePhoneWithRegion(phone, callingCode) ?? normalizePhone(phone);
}

/** A number the user ticked in the address-book picker. */
export interface ContactCandidate {
  name: string;
  number: string;
}

export interface AdditionPlan {
  /** Ready to append, in the order they were picked. */
  add: EmergencyContact[];
  /** Picked numbers that could not be qualified to E.164. */
  invalid: ContactCandidate[];
  /** Picked numbers already stored, or repeated within the same batch. */
  duplicates: number;
}

/**
 * Works out what a batch of picked numbers actually adds.
 *
 * Two numbers are the same contact when they qualify to the same E.164 string,
 * so "0532 123 45 67" and "+90 532 123 45 67" are stored once, whether the
 * clash is with an existing contact or with another number in the same batch.
 * A number that cannot be qualified is reported rather than silently dropped.
 *
 * Pure: no storage, no navigation. The caller persists `add` and reports the
 * counts.
 */
export function planContactAdditions(
  existing: EmergencyContact[],
  candidates: ContactCandidate[],
  callingCode: string
): AdditionPlan {
  const seen = new Set(existing.map((c) => contactPhoneKey(c.phone, callingCode)));
  const add: EmergencyContact[] = [];
  const invalid: ContactCandidate[] = [];
  let duplicates = 0;

  for (const candidate of candidates) {
    const e164 = normalizePhoneWithRegion(candidate.number, callingCode);
    if (!e164) {
      invalid.push(candidate);
      continue;
    }
    if (seen.has(e164)) {
      duplicates++;
      continue;
    }
    seen.add(e164);
    // A number-only address-book entry has no name; show the number instead.
    add.push({ name: candidate.name.trim() || candidate.number, phone: e164 });
  }

  return { add, invalid, duplicates };
}
