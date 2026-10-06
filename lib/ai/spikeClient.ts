import Constants from "expo-constants";
import { fetch } from "expo/fetch";
import { getDeviceId } from "../identity/deviceId";
import { hasSpikeContextConsent } from "../services/spikeConsent";
import type { ContextPacket } from "./spikeContext";

/**
 * Spike client v2 - posts the chat window to the ai-ask-spike edge function and
 * returns the reply, streamed when the stream allows it. The regulation-critical
 * core (system prompt + refusals + the output filter) lives in the function.
 *
 * Data boundary: the typed chat window always goes. The only other thing that
 * may ever ride along is the 14-day ContextPacket (lib/ai/spikeContext.ts), and
 * only while the user's separate summary consent is on, which this module
 * re-reads at the moment the request is built. Health records, single readings
 * and identity never go - see docs/spike-ai.md.
 *
 * The function URL is read from app config (expo `extra.spikeFnUrl`), a HUMAN
 * deploy step. When unset, `isConfigured` is false and the UI stays disabled
 * rather than failing mid-send.
 */
export interface SpikeMessage {
  role: "user" | "assistant";
  content: string;
}

export type SpikeTier = "free" | "pro";

/** Buttons the function may attach to a reply. Unknown ids are dropped, so a
 *  newer server never shows a button this build cannot open. */
export const SPIKE_ACTION_IDS = [
  "open_reminders",
  "start_meal_timer",
  "open_injection_map",
  "connect_health",
  "open_insights",
  "open_widget_guide",
  "open_journal",
] as const;
export type SpikeActionId = (typeof SPIKE_ACTION_IDS)[number];

/** Where each action goes. Literal paths, so the typed router checks them. */
export const SPIKE_ACTION_ROUTES = {
  open_reminders: "/settings/reminders",
  start_meal_timer: "/meal-response",
  open_injection_map: "/(tabs)/injection",
  connect_health: "/settings/data",
  open_insights: "/insights",
  open_widget_guide: "/widget-guide",
  open_journal: "/journal",
} as const satisfies Record<SpikeActionId, string>;

export interface SpikeSource {
  id: string;
  title: string;
  url: string;
}

export interface SpikeReply {
  /** Empty only when `filtered` and the function sent no safe text. */
  reply: string;
  actions: SpikeActionId[];
  sources: SpikeSource[];
  filtered: boolean;
  /** The model hit its token ceiling: the reply ends mid-thought and carries no buttons or sources. */
  truncated: boolean;
  streamed: boolean;
}

export const SPIKE_ERROR_CODES = [
  "daily_limit",
  "rate_limit",
  "capacity",
  "consent_required",
  "bad_request",
  "upstream",
  "not_configured",
  "empty_reply",
  "aborted",
] as const;
export type SpikeErrorCode = (typeof SPIKE_ERROR_CODES)[number];

function isSpikeCode(value: string): value is SpikeErrorCode {
  return (SPIKE_ERROR_CODES as readonly string[]).includes(value);
}

/** The code is the message: a plain Error survives every transpile target,
 *  where `instanceof` on an Error subclass does not. */
function spikeError(code: SpikeErrorCode): Error {
  return new Error(code);
}

/** The code of anything askSpike threw; a failure it did not name is upstream. */
export function spikeErrorCode(e: unknown): SpikeErrorCode {
  const message = e instanceof Error ? e.message : "";
  return isSpikeCode(message) ? message : "upstream";
}

const FN_URL: string | undefined =
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.spikeFnUrl as
    | string
    | undefined;

export const isConfigured = typeof FN_URL === "string" && FN_URL.length > 0;

const MAX_MESSAGES = 16;
const MAX_CHARS = 1500;
const MAX_ACTIONS = 3;
const MAX_SOURCES = 4;
/** A stream that goes quiet this long is treated as dead. */
const STREAM_IDLE_MS = 25_000;
/** Whole-request ceiling for the single-reply path. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The trailing chat window the function accepts: 16 turns, 1500 characters each,
 *  opening on a user turn (cutting the last 16 out of a longer chat can land on a
 *  reply; that one is left out rather than sent as the start of the conversation). */
export function windowMessages(messages: readonly SpikeMessage[]): SpikeMessage[] {
  const window = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_CHARS) }))
    .filter((m) => m.content.length > 0)
    .slice(-MAX_MESSAGES);
  while (window.length > 0 && window[0].role === "assistant") window.shift();
  return window;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function sanitizeActions(raw: unknown): SpikeActionId[] {
  if (!Array.isArray(raw)) return [];
  const out: SpikeActionId[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const known = (SPIKE_ACTION_IDS as readonly string[]).includes(item);
    if (known && !out.includes(item as SpikeActionId)) out.push(item as SpikeActionId);
  }
  return out.slice(0, MAX_ACTIONS);
}

/** https only, no credentials in the address: the link is opened outside the app. */
const SOURCE_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/\S*)?$/;

/** The app's own reference screen is a source too. The function names it by a
 *  zerospike:// address that is never opened as a link: this exact id and address
 *  pair is let through and goes to the screen below instead. */
const APP_SOURCES: Readonly<Record<string, { url: string; route: "/sources" }>> = {
  app_sources: { url: "zerospike://sources", route: "/sources" },
};

const appSource = (id: string): { url: string; route: "/sources" } | null =>
  Object.prototype.hasOwnProperty.call(APP_SOURCES, id) ? APP_SOURCES[id] : null;

/** The screen a source opens inside the app, or null for a link that opens outside it. */
export function spikeSourceRoute(source: SpikeSource): "/sources" | null {
  const own = appSource(source.id);
  return own && source.url === own.url ? own.route : null;
}

export function sanitizeSources(raw: unknown): SpikeSource[] {
  if (!Array.isArray(raw)) return [];
  const out: SpikeSource[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { id, title, url } = item;
    if (typeof id !== "string" || typeof title !== "string" || typeof url !== "string") continue;
    const label = title.trim().slice(0, 120);
    if (id.length === 0 || id.length > 80 || label.length === 0) continue;
    if (url.length > 500 || !(SOURCE_URL.test(url) || appSource(id)?.url === url)) continue;
    out.push({ id, title: label, url });
  }
  return out.slice(0, MAX_SOURCES);
}

/**
 * Splits buffered stream text into complete server-sent events and the
 * unfinished tail. Each event comes back as its joined `data:` payload; events
 * with no data (comments, keep-alives) are dropped. A CRLF split across two
 * chunks is repaired because the tail is kept and re-joined with the next chunk.
 */
export function takeSseEvents(buffer: string): { events: string[]; rest: string } {
  const text = buffer.replace(/\r\n/g, "\n");
  const cut = text.lastIndexOf("\n\n");
  if (cut < 0) return { events: [], rest: text };
  const events: string[] = [];
  for (const block of text.slice(0, cut).split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data.length > 0) events.push(data);
  }
  return { events, rest: text.slice(cut + 2) };
}

interface DoneEvent {
  filtered: boolean;
  truncated: boolean;
  reply: string;
  actions: unknown;
  sources: unknown;
}

type StreamEvent =
  | { type: "delta"; text: string }
  | ({ type: "done" } & DoneEvent)
  | { type: "error"; code: string };

function parseStreamEvent(payload: string): StreamEvent | null {
  if (payload === "[DONE]") return null;
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.type === "delta" && typeof data.text === "string") {
    return { type: "delta", text: data.text };
  }
  if (data.type === "done") {
    return {
      type: "done",
      filtered: data.filtered === true,
      truncated: data.truncated === true,
      reply: typeof data.reply === "string" ? data.reply : "",
      actions: data.actions,
      sources: data.sources,
    };
  }
  if (data.type === "error") {
    return { type: "error", code: typeof data.code === "string" ? data.code : "" };
  }
  return null;
}

/** An error event names the same codes the HTTP errors do; anything else is upstream. */
function streamErrorCode(code: string): SpikeErrorCode {
  return isSpikeCode(code) && code !== "aborted" && code !== "not_configured" ? code : "upstream";
}

async function httpError(res: { status: number; json(): Promise<unknown> }): Promise<Error> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no JSON body, the status alone decides
  }
  const named = isRecord(body) && typeof body.error === "string" ? body.error : "";
  // 429 has three causes: this device's own daily messages, this address's hourly requests, and the
  // function's global daily ceiling ("capacity"), which clears at the next UTC midnight for everyone.
  if (res.status === 429) {
    return spikeError(named === "daily_limit" ? "daily_limit" : named === "capacity" ? "capacity" : "rate_limit");
  }
  if (res.status === 403) return spikeError("consent_required");
  if (res.status === 400) return spikeError("bad_request");
  return spikeError("upstream");
}

function finishReply(streamedText: string, done: DoneEvent, streamed: boolean): SpikeReply {
  const final = done.reply.trim();
  // The function's own `reply` is the final text, with any code fence and the meta
  // line already taken off, so it wins over the words that streamed in (those can
  // still end in a stray fence). A function that sends none falls back to the
  // streamed text. A filtered reply is replaced wholesale: whatever streamed in is
  // not shown.
  const reply = done.filtered ? final : final || streamedText.trim();
  if (!done.filtered && reply.length === 0) throw spikeError("empty_reply");
  return {
    reply,
    actions: sanitizeActions(done.actions),
    sources: sanitizeSources(done.sources),
    filtered: done.filtered,
    truncated: done.truncated,
    streamed,
  };
}

/** The single-reply body: also what a function that ignores `stream` sends back. */
function replyFromJson(data: unknown): SpikeReply {
  if (!isRecord(data)) throw spikeError("upstream");
  return finishReply(
    "",
    {
      filtered: data.filtered === true,
      truncated: data.truncated === true,
      reply: typeof data.reply === "string" ? data.reply : "",
      actions: data.actions,
      sources: data.sources,
    },
    false
  );
}

interface Guard {
  signal: AbortSignal;
  touch(): void;
  dispose(): void;
}

/** One abort signal that fires on the caller's signal or after `idleMs` without a touch(). */
function makeGuard(external: AbortSignal | undefined, idleMs: number): Guard {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = (): void => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleMs);
  };
  const onExternal = (): void => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternal);
  }
  arm();
  return {
    signal: controller.signal,
    touch: arm,
    dispose: () => {
      if (timer != null) clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    },
  };
}

function settle(e: unknown, external: AbortSignal | undefined): Error {
  if (external?.aborted) return spikeError("aborted");
  return spikeError(spikeErrorCode(e));
}

interface RequestBody {
  locale: string;
  tier: SpikeTier;
  messages: SpikeMessage[];
  context: ContextPacket | null;
}

async function requestStream(
  url: string,
  headers: Record<string, string>,
  body: RequestBody,
  onDelta: ((textSoFar: string) => void) | undefined,
  external: AbortSignal | undefined
): Promise<SpikeReply> {
  const guard = makeGuard(external, STREAM_IDLE_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal: guard.signal,
    });
    if (!res.ok) throw await httpError(res);
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      return replyFromJson(await res.json());
    }
    const source = res.body;
    if (!source || typeof TextDecoder === "undefined") throw spikeError("upstream");

    const reader = source.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let done: DoneEvent | null = null;

    const handle = (payload: string): DoneEvent | null => {
      const event = parseStreamEvent(payload);
      if (!event) return null;
      if (event.type === "delta") {
        text += event.text;
        onDelta?.(text);
        return null;
      }
      if (event.type === "error") throw spikeError(streamErrorCode(event.code));
      return event;
    };

    try {
      while (!done) {
        const chunk = await reader.read();
        guard.touch();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const taken = takeSseEvents(buffer);
        buffer = taken.rest;
        for (const payload of taken.events) {
          done = handle(payload);
          if (done) break;
        }
      }
      if (!done) {
        // A server that closes without the final blank line still delivered its last event.
        buffer += decoder.decode();
        for (const payload of takeSseEvents(`${buffer}\n\n`).events) {
          done = handle(payload);
          if (done) break;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    if (!done) throw spikeError("upstream");
    return finishReply(text, done, true);
  } catch (e) {
    throw settle(e, external);
  } finally {
    guard.dispose();
  }
}

async function requestOnce(
  url: string,
  headers: Record<string, string>,
  body: RequestBody,
  external: AbortSignal | undefined
): Promise<SpikeReply> {
  const guard = makeGuard(external, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: false }),
      signal: guard.signal,
    });
    if (!res.ok) throw await httpError(res);
    return replyFromJson(await res.json());
  } catch (e) {
    throw settle(e, external);
  } finally {
    guard.dispose();
  }
}

export interface AskSpikeParams {
  messages: readonly SpikeMessage[];
  locale: string;
  /** Drives the function's daily cap (free/pro): a cost signal, nothing else. */
  tier: SpikeTier;
  /** The summary packet, or null. Sent only if the summary consent still holds. */
  context: ContextPacket | null;
  /** Default true. */
  stream?: boolean;
  /** The reply text so far, whole each time. Called with "" when a failed
   *  stream is dropped before the single-reply retry. */
  onDelta?: (textSoFar: string) => void;
  /** Called once, just before the request leaves, with what it will carry. */
  onDispatch?: (info: { hasContext: boolean }) => void;
  signal?: AbortSignal;
}

/**
 * Sends the chat window and resolves with the reply. Streams when it can; when
 * the stream cannot be read, or fails for a reason a second try could fix, it
 * asks again once for a single reply. Failures that a retry would only repeat
 * (daily_limit, rate_limit, capacity, consent_required, bad_request) are thrown at once.
 * Every throw is an Error whose message is a SpikeErrorCode (spikeErrorCode()).
 */
export async function askSpike(params: AskSpikeParams): Promise<SpikeReply> {
  if (!isConfigured || !FN_URL) throw spikeError("not_configured");
  const url = FN_URL;

  // The consent is read again here, as the request is built, so a switch turned
  // off while the packet was being computed still keeps it off the wire.
  const context =
    params.context != null && (await hasSpikeContextConsent()) ? params.context : null;
  const deviceId = await getDeviceId();
  const body: RequestBody = {
    locale: String(params.locale || "en").slice(0, 5),
    tier: params.tier,
    messages: windowMessages(params.messages),
    context,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-device-id": deviceId,
  };
  if (context != null) headers["x-consent-context"] = "1";

  params.onDispatch?.({ hasContext: context != null });

  if (params.stream !== false) {
    try {
      return await requestStream(url, headers, body, params.onDelta, params.signal);
    } catch (e) {
      const code = spikeErrorCode(e);
      const final =
        code === "aborted" ||
        code === "daily_limit" ||
        code === "rate_limit" ||
        code === "capacity" ||
        code === "consent_required" ||
        code === "bad_request";
      if (final) throw e;
      params.onDelta?.("");
    }
  }
  return requestOnce(url, headers, body, params.signal);
}
