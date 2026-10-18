import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The optional name printed on the PDF report's "Profile:" line. Kept per
 * profile in AsyncStorage (device-only: it never reaches analytics, Supabase or
 * the AI context) and apart from user_profiles.name, so no migration is needed
 * and a blank value simply means the line is not printed.
 */
export const REPORT_NAME_KEY_BASE = "zerospike.reportName";
export const REPORT_NAME_MAX = 60;

const keyFor = (profileId: string) => `${REPORT_NAME_KEY_BASE}.${profileId}`;

export async function getReportName(profileId: string): Promise<string> {
  try {
    return ((await AsyncStorage.getItem(keyFor(profileId))) ?? "").trim();
  } catch {
    return "";
  }
}

export async function setReportName(profileId: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, REPORT_NAME_MAX);
  try {
    if (clean) await AsyncStorage.setItem(keyFor(profileId), clean);
    else await AsyncStorage.removeItem(keyFor(profileId));
  } catch {
    // Storage failure only loses a cosmetic header line.
  }
}
