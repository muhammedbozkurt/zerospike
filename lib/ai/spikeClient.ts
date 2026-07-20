import Constants from "expo-constants";

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

/** POST the trailing chat window; resolve with the assistant reply text. */
export async function askSpike(
  messages: SpikeMessage[],
  lang: string
): Promise<string> {
  if (!isConfigured || !FN_URL) throw new Error("not_configured");
  // Data boundary: send ONLY roles + typed content. Never enrich with records.
  const safe = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) }))
    .slice(-16);

  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: safe, lang: lang.slice(0, 5) }),
  });
  if (!res.ok) throw new Error("upstream");
  const data = (await res.json()) as { reply?: string; error?: string };
  const reply = data?.reply?.trim();
  if (!reply) throw new Error("empty_reply");
  return reply;
}
