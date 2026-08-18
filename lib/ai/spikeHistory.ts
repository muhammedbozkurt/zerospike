import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SpikeMessage } from "./spikeClient";

/**
 * Spike chat persistence - device-local only. The transcript is what the user
 * typed plus Spike's replies; it is never uploaded anywhere and it never gains
 * health records (the data boundary in lib/ai/spikeClient.ts is unchanged).
 *
 * This is storage, not the model window: askSpike() still sends only its own
 * trailing slice, so a longer stored thread does not widen the request.
 * Withdrawing consent wipes it (lib/services/spikeConsent.ts).
 */
const HISTORY_KEY = "zerospike.spikeHistory";

/** Kept on device; older turns are dropped so the store stays small. */
export const MAX_STORED_MESSAGES = 40;

/** Mirrors the client's per-message cap, so a tampered store cannot grow one. */
const MAX_CHARS = 1500;

function sanitize(value: unknown): SpikeMessage[] {
  if (!Array.isArray(value)) return [];
  const out: SpikeMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || content.length === 0) continue;
    out.push({ role, content: content.slice(0, MAX_CHARS) });
  }
  return out.slice(-MAX_STORED_MESSAGES);
}

export async function loadHistory(): Promise<SpikeMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveHistory(messages: SpikeMessage[]): Promise<void> {
  try {
    const trimmed = messages.slice(-MAX_STORED_MESSAGES);
    if (trimmed.length === 0) {
      await AsyncStorage.removeItem(HISTORY_KEY);
      return;
    }
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // best-effort
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch {
    // best-effort
  }
}
