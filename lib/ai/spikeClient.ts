import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { uuid } from "../uuid";

/**
 * Spike client - posts the chat window to the ai-ask-spike edge function and
 * returns the reply. The regulation-critical core (system prompt + refusals)
 * lives in the function; this client's ONE job on the data-boundary is to send
 * only what the user typed. It must NEVER attach health records (glucose, meals,
 * insulin) or identity - see docs/spike-ai.md.
 *
 * The function URL is read from app config (expo `extra.spikeFnUrl`), a HUMAN
 * deploy step. When unset, `isConfigured` is false and the UI stays disabled
 * rather than failing mid-send.
 */
export interface SpikeMessage {
  role: "user" | "assistant";
  content: string;
}

const FN_URL: string | undefined =
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.spikeFnUrl as
    | string
    | undefined;

export const isConfigured = typeof FN_URL === "string" && FN_URL.length > 0;

const DEVICE_ID_KEY = "zerospike.deviceId";

/**
 * Persistent anonymous install id (R10 FAZ 2), created once and reused for the
 * life of the install. Sent as `x-device-id` ONLY so the edge function can
 * apply a per-device daily message cap even if its URL leaks, it is not tied
 * to identity or health data, and this is the only thing it is used for.
 * Spoofable by design (a fresh install gets a fresh id, and the header can be
 * forged); the goal is a cost ceiling, not access control.
 */
async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = uuid();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return "unknown";
  }
}

/** POST the trailing chat window; resolve with the assistant reply text.
 *  `tier` drives the function's daily cap (free/pro) - purely a cost signal,
 *  never trusted for anything else. Throws "daily_limit" specifically when the
 *  server-side per-device cap is hit, so the UI can show the same exhausted
 *  card it shows for the local allowance. */
export async function askSpike(
  messages: SpikeMessage[],
  lang: string,
  tier: "free" | "pro"
): Promise<string> {
  if (!isConfigured || !FN_URL) throw new Error("not_configured");
  // Data boundary: send ONLY roles + typed content. Never enrich with records.
  const safe = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) }))
    .slice(-16);

  const deviceId = await getDeviceId();
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-id": deviceId,
      "x-tier": tier,
    },
    body: JSON.stringify({ messages: safe, lang: lang.slice(0, 5) }),
  });
  if (res.status === 429) {
    let code = "rate_limited";
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) code = data.error;
    } catch {
      // no JSON body - fall back to the generic rate_limited code
    }
    throw new Error(code === "daily_limit" ? "daily_limit" : "rate_limited");
  }
  if (!res.ok) throw new Error("upstream");
  const data = (await res.json()) as { reply?: string; error?: string };
  const reply = data?.reply?.trim();
  if (!reply) throw new Error("empty_reply");
  return reply;
}
