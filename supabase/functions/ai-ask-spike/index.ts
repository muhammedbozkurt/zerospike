// Supabase Edge Function: Spike AI (ai-ask-spike)
//
// zerospike's assistant: Claude on Amazon Bedrock (bedrock.ts). Runs on Deno
// (Supabase Edge Runtime), NOT part of the app's TypeScript build (supabase/
// is excluded in tsconfig.json). Deploy, secrets and the eval are HUMAN steps,
// see README.md next to this file.
//
// REGULATION: the hard rules live in prompt.ts (system prompt) and filter.ts
// (output gate). Spike is a logbook assistant + general diabetes education +
// app help: no dose, diagnosis, treatment or medication change, ever.
//
// DATA BOUNDARY: the typed chat window, plus, only when the request carries
// x-consent-context: "1", the client's logbook summary (ContextPacket v1). The
// summary is whitelisted and clamped in prompt.ts and goes into this request's
// prompt only: it is never logged and never written to a table.
//
// COST: the model call is the only thing here that costs money, and the URL is
// public (no JWT), so the ceilings are enforced in Postgres before the call, in
// one atomic step (spike_reserve, migration 20261006141500_spike_hardening):
// a slot per message for the device and the UTC day, a request count per
// caller address and hour, and a global daily total of calls. A database that
// cannot be reached answers 503: it never lets a request through unmetered.
//
// Contract (shared with the app client):
//   POST, headers x-device-id (required), x-consent-context: "1" (required
//   when context is sent). Body { locale, tier, stream, messages, context }.
//   stream=false -> { reply, actions, sources, filtered, truncated, usage }
//   stream=true  -> text/event-stream of "data: {json}\n\n":
//     {type:"delta",text}... then {type:"done",reply,actions,sources,filtered,truncated,usage}
//     `reply` is the final text (code fence and meta line stripped) on every
//     done: the client shows it instead of the streamed deltas. A blocked
//     reply ends with a done carrying filtered:true and the safe text in
//     `reply`. No error event precedes it: the app client treats any error
//     event as a failed stream and retries without streaming, paying for a
//     second call. truncated:true means the model hit the token ceiling, so
//     the reply ends mid-thought and carries no actions or sources. A reply
//     with no visible text (only the meta line, only a code fence, or the
//     ceiling hit before any text) was billed like any other: it ends the same
//     way as a blocked one, with the neutral text, filter_rule "empty" and the
//     slot kept spent, so a retry that costs a second call never happens.
//     Other failures (no reply at all) send {type:"error",code:"upstream"}.
//   Errors { error }: 429 daily_limit | rate_limit | capacity, 403 consent_required,
//   400 bad_request, 502 upstream, 503 unavailable (500 not_configured, 405 method_not_allowed).
//   No CORS headers: the app is not a browser. OPTIONS answers 204 with no body.

import { resolveCallerIp } from "../_shared/http.ts";
import { bedrockClient, buildParams, logUpstream, spikeModel, usageOf, type BedrockClient, type ChatMessage, type TokenUsage } from "./bedrock.ts";
import { MAX_CONTEXT_BYTES, SYSTEM_PROMPT, dynamicSystem, normalizeLocale, sanitizeContext, type ActionId, type ContextPacket, type Locale } from "./prompt.ts";
import { StreamGuard, blockedOutcome, finalizeReply, type ReplyOutcome } from "./filter.ts";
import type { SourceRef } from "./sources.ts";

const MAX_MESSAGES = 16; // trailing chat window the client may send
const MAX_CHARS = 1500; // per message, defensive cap
const MAX_BODY_BYTES = 256 * 1024; // declared Content-Length
const MAX_UNDECLARED_BODY_BYTES = 64 * 1024; // chunked body with no Content-Length: read no more than this
const DEVICE_ID = /^[A-Za-z0-9._:-]{1,100}$/;

// ── Limits ──────────────────────────────────────────────────────────────────
// Keep the two daily numbers in sync with FREE_DAILY_MESSAGES / PRO_DAILY_MESSAGES
// in lib/ai/spikeLimit.ts: it is the same product limit, shown by the app and
// enforced here. `tier` comes from the client and cannot be checked, so anyone
// can ask for the pro number; what actually bounds a caller is the device cap at
// the pro number, the per-address hourly cap and the global daily cap together.
const FREE_DAILY_CAP = 3;
const PRO_DAILY_CAP = 50;
const DEFAULT_GLOBAL_DAILY_CAP = 3000; // model calls per UTC day, all callers (env SPIKE_GLOBAL_DAILY_CAP)
const DEFAULT_IP_HOURLY_CAP = 60; // requests per caller address per hour (env SPIKE_IP_HOURLY_CAP)
const DB_TIMEOUT_MS = 5000;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** UTC calendar day key, e.g. "2026-07-27". */
function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

interface Creds {
  url: string;
  key: string;
}

function supabaseServiceCreds(): Creds | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? { url, key } : null;
}

/** Calls a Postgres function through PostgREST as the service role. Throws on any
 *  failure (network, timeout, non-2xx): every caller decides what that means. */
async function rpc(creds: Creds, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${creds.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: creds.key, Authorization: `Bearer ${creds.key}` },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
  return text ? JSON.parse(text) : null;
}

// ── Caller address ──────────────────────────────────────────────────────────
// The address itself comes from resolveCallerIp (_shared/http.ts), which also
// honours the legacy forwarders' real-IP header when the shared secret matches.
// cf-connecting-ip is set by Cloudflare in front of the platform. X-Forwarded-For
// starts with whatever the client chose to write, and only its last entry was
// added by a proxy we trust, so that is the one used when there is no Cloudflare
// header. An IPv6 address is reduced to its /64: one subscriber holds the whole
// prefix, and counting single addresses would let them rotate for free.

function ipBucket(raw: string): string {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!ip.includes(":")) return ip;
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  const sides = ip.split("::");
  if (sides.length > 2) return ip;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(":") : [];
  const groups = sides.length === 2 ? [...left, ...new Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

let hmacKey: Promise<CryptoKey> | null = null;

/** The address is stored only as a keyed hash (the service-role key is the secret),
 *  and only for the hour it is counted in: see spike_ip_usage. */
async function ipHash(creds: Creds, ip: string): Promise<string> {
  hmacKey ??= crypto.subtle.importKey("raw", new TextEncoder().encode(creds.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey, new TextEncoder().encode(ipBucket(ip)));
  return Array.from(new Uint8Array(sig).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Slots ───────────────────────────────────────────────────────────────────

type Slot = "ok" | "ip" | "device" | "global" | "error";

/**
 * One atomic step before the model call: counts the request for the caller
 * address, takes one of the device's messages for the day and one of the global
 * calls for the day, each only while it is under its cap (a refusal takes
 * nothing). Because the slot is taken first, requests that arrive together cannot
 * all pass a check that nobody has spent yet. "error" is a database that did not
 * answer: the caller turns it into a 503, never into a pass.
 */
async function reserveSlot(creds: Creds, a: { deviceId: string; ipHash: string; day: string; deviceCap: number; countDevice: boolean }): Promise<Slot> {
  try {
    const out = await rpc(creds, "spike_reserve", {
      p_device_id: a.deviceId,
      p_day: a.day,
      p_ip_hash: a.ipHash,
      p_device_cap: a.deviceCap,
      p_ip_cap: positiveIntEnv("SPIKE_IP_HOURLY_CAP", DEFAULT_IP_HOURLY_CAP),
      p_global_cap: positiveIntEnv("SPIKE_GLOBAL_DAILY_CAP", DEFAULT_GLOBAL_DAILY_CAP),
      p_count_device: a.countDevice,
    });
    return out === "ok" || out === "ip" || out === "device" || out === "global" ? out : "error";
  } catch {
    return "error";
  }
}

/** Gives the device and global slots back (the address count stays: it meters requests). */
async function releaseSlot(creds: Creds, deviceId: string, day: string, countDevice: boolean): Promise<void> {
  try {
    await rpc(creds, "spike_release", { p_device_id: deviceId, p_day: day, p_count_device: countDevice });
  } catch {
    // a missed release only under-counts: it never blocks anyone
  }
}

// The app retries a failed stream once with stream=false. When that stream had
// already taken its slot, the retry is the same message, not a new one: the same
// device sending the same chat window within 60 s gets one retry that does not
// take another device message (it still counts for the address and the global
// total, because it is a model call). Per-isolate memory, best-effort.
const RECOUNT_WINDOW_MS = 60_000;
const MAX_TRACKED = 5000;
const counted = new Map<string, { at: number; replayed: boolean }>();

async function replayKey(deviceId: string, messages: ChatMessage[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(messages)));
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${deviceId}:${hex}`;
}

/** True once for a message whose slot was taken in the last 60 s. */
function takeReplay(key: string, now: number): boolean {
  // Insertion order is time order (markCounted re-inserts), so pruning can stop at the first live entry.
  for (const [k, entry] of counted) {
    if (now - entry.at <= RECOUNT_WINDOW_MS && counted.size < MAX_TRACKED) break;
    counted.delete(k);
  }
  const entry = counted.get(key);
  if (!entry || now - entry.at > RECOUNT_WINDOW_MS || entry.replayed) return false;
  entry.replayed = true;
  return true;
}

function markCounted(key: string, now: number): void {
  counted.delete(key);
  counted.set(key, { at: now, replayed: false });
}

function forgetCounted(key: string): void {
  counted.delete(key);
}

/** One spike_calls row per model call: tokens and timing for cost tracking,
 *  never message text or the logbook summary. Best-effort. */
async function recordCall(creds: Creds, row: {
  device_id: string;
  day: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number;
  filtered: boolean;
  filter_rule: string | null;
  stream: boolean;
}): Promise<void> {
  try {
    const res = await fetch(`${creds.url}/rest/v1/spike_calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    await res.body?.cancel();
  } catch {
    // monitoring only
  }
}

// ── Request parsing ─────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** Reads the body with a hard byte ceiling: the declared length when there is one,
 *  64 KB when the request is chunked, so a body with no Content-Length cannot be
 *  buffered without bound. */
async function readBody(req: Request): Promise<Obj | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null;
  const limit = declared === null ? MAX_UNDECLARED_BODY_BYTES : MAX_BODY_BYTES;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isObj(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Keeps only the trailing window, sanitizes roles and hard-caps length. This
 * is also the data boundary for the chat: whatever survives here is all the
 * model sees of the conversation. Returns null unless it ends on a user turn
 * (no assistant prefill), has no two assistant turns in a row, and opens on a
 * user turn. A window the client cut out of a longer chat (a full 16) can open
 * on an assistant turn: that one turn is dropped, as older app builds send it;
 * a shorter window starts where the conversation does, so there it is an error.
 */
function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const messages: ChatMessage[] = raw
    .filter((m): m is ChatMessage => isObj(m) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS).trim() }))
    .filter((m) => m.content.length > 0)
    .slice(-MAX_MESSAGES);
  if (messages.length === 0) return null;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "assistant" && messages[i - 1].role === "assistant") return null;
  }
  if (messages[0].role === "assistant") {
    if (messages.length < MAX_MESSAGES) return null;
    messages.shift();
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

// ── Model call ──────────────────────────────────────────────────────────────

interface Call {
  client: BedrockClient;
  model: string;
  params: ReturnType<typeof buildParams>;
  locale: Locale;
  deviceId: string;
  replayKey: string;
  creds: Creds;
  /** UTC day the slot was taken for: the same key the release and the call row use. */
  day: string;
  /** Whether this request holds one of the device's daily messages (a free retry does not). */
  countsDevice: boolean;
}

interface UsageBody {
  model: string;
  input_tokens: number;
  output_tokens: number;
}

type SseEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reply: string; actions: ActionId[]; sources: SourceRef[]; filtered: boolean; truncated: boolean; usage: UsageBody }
  | { type: "error"; code: "upstream" };

function usageBody(model: string, usage: TokenUsage): UsageBody {
  return { model, input_tokens: usage.input, output_tokens: usage.output };
}

/** The user got nothing for this slot (the model failed), so it goes back. */
async function giveBack(call: Call): Promise<void> {
  if (call.countsDevice) forgetCounted(call.replayKey);
  await releaseSlot(call.creds, call.deviceId, call.day, call.countsDevice);
}

/** Logs a model call that produced something, whether or not the user saw all of it. */
function logCall(call: Call, result: { filtered: boolean; rule: string | null }, usage: TokenUsage, latencyMs: number, stream: boolean): Promise<void> {
  return recordCall(call.creds, {
    device_id: call.deviceId,
    day: call.day,
    model: call.model,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: usage.cacheRead,
    cache_write_tokens: usage.cacheWrite,
    latency_ms: latencyMs,
    filtered: result.filtered,
    filter_rule: result.rule,
    stream,
  });
}

async function replyOnce(call: Call): Promise<Response> {
  const started = Date.now();
  let message;
  try {
    message = await call.client.messages.create(call.params);
  } catch (err) {
    logUpstream(err);
    await giveBack(call);
    return json({ error: "upstream" }, 502);
  }
  const latencyMs = Date.now() - started;
  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  // A reply with nothing visible comes back from finalizeReply as a blocked "empty" outcome: it was billed, so it
  // is answered (200, neutral text) and its slot stays spent. Handing it back as an error would let anyone
  // trigger paid calls that cost them nothing.
  const outcome = finalizeReply(text, message.stop_reason, call.locale);
  const usage = usageOf(message.usage);
  await logCall(call, outcome, usage, latencyMs, false);
  return json({
    reply: outcome.reply,
    actions: outcome.actions,
    sources: outcome.sources,
    filtered: outcome.filtered,
    truncated: outcome.truncated,
    usage: usageBody(call.model, usage),
  });
}

/**
 * Streaming: deltas flow as they arrive, gated by StreamGuard (40-character
 * hold, filter on the full text before every send, the <<meta>> line never
 * sent). The 200 status is only committed once Bedrock has accepted the
 * request, so auth, quota and model errors still come back as a JSON 502.
 * Whatever way the stream ends, the finally block settles the books: a reply
 * that reached the user (a blocked or empty one included, they were billed) is
 * logged, a model failure gives the slot back, and a client that walked away
 * mid-answer keeps its slot spent (the tokens were generated) and the call is
 * logged.
 */
async function streamReply(call: Call): Promise<Response> {
  const started = Date.now();
  const upstream = call.client.messages.stream(call.params);
  // Subscribe before the connection resolves so no early event is missed.
  const events = upstream[Symbol.asyncIterator]();
  try {
    await upstream.withResponse();
  } catch (err) {
    logUpstream(err);
    await giveBack(call);
    return json({ error: "upstream" }, 502);
  }

  const encoder = new TextEncoder();
  const guard = new StreamGuard();
  let open = true;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => {
        if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let outcome: ReplyOutcome | null = null;
      let usage = usageOf(undefined);
      let failed = false;
      try {
        let blockedRule: string | null = null;
        while (blockedRule === null) {
          const next = await events.next();
          if (next.done) break;
          const event = next.value;
          if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
          const step = guard.push(event.delta.text);
          if (step.blocked) blockedRule = step.blocked;
          else if (step.emit) send({ type: "delta", text: step.emit });
        }

        if (blockedRule !== null) {
          // Stop generating; the partial usage is what was billed so far.
          upstream.abort();
          usage = usageOf(upstream.currentMessage?.usage);
          outcome = blockedOutcome(call.locale, blockedRule);
        } else {
          const message = await upstream.finalMessage();
          usage = usageOf(message.usage);
          outcome = finalizeReply(guard.text, message.stop_reason, call.locale);
        }

        if (outcome.filtered) {
          send({ type: "done", reply: outcome.reply, actions: [], sources: [], filtered: true, truncated: false, usage: usageBody(call.model, usage) });
        } else {
          const rest = guard.rest(outcome.reply);
          if (rest) send({ type: "delta", text: rest });
          send({
            type: "done",
            reply: outcome.reply,
            actions: outcome.actions,
            sources: outcome.sources,
            filtered: false,
            truncated: outcome.truncated,
            usage: usageBody(call.model, usage),
          });
        }
      } catch (err) {
        failed = true;
        usage = usageOf(upstream.currentMessage?.usage);
        if (open) {
          logUpstream(err);
          send({ type: "error", code: "upstream" });
        }
      } finally {
        const gone = !open; // the client went away and cancel() aborted upstream
        const latencyMs = Date.now() - started;
        if (outcome && !failed) {
          await logCall(call, outcome, usage, latencyMs, true);
        } else if (gone) {
          await logCall(call, { filtered: false, rule: null }, usage, latencyMs, true);
        } else {
          await giveBack(call);
          if (usage.output > 0) await logCall(call, { filtered: false, rule: null }, usage, latencyMs, true);
        }
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
      upstream.abort();
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const deviceId = (req.headers.get("x-device-id") ?? "").trim();
  if (!DEVICE_ID.test(deviceId)) return json({ error: "bad_request" }, 400);

  const body = await readBody(req);
  if (!body) return json({ error: "bad_request" }, 400);
  const messages = parseMessages(body.messages);
  if (!messages) return json({ error: "bad_request" }, 400);

  // `lang` and the x-tier header are what app builds before the K6 client send.
  const locale = normalizeLocale(body.locale ?? body.lang);
  const tier = (body.tier ?? req.headers.get("x-tier")) === "pro" ? "pro" : "free";

  let packet: ContextPacket | null = null;
  if (body.context !== undefined && body.context !== null) {
    if (req.headers.get("x-consent-context") !== "1") return json({ error: "consent_required" }, 403);
    if (new TextEncoder().encode(JSON.stringify(body.context)).length > MAX_CONTEXT_BYTES) {
      return json({ error: "bad_request" }, 400);
    }
    packet = sanitizeContext(body.context);
    if (!packet) return json({ error: "bad_request" }, 400);
  }

  const creds = supabaseServiceCreds();
  if (!creds) return json({ error: "not_configured" }, 500);

  const now = Date.now();
  const day = utcDayKey(now);
  const replay = await replayKey(deviceId, messages);
  const countsDevice = !takeReplay(replay, now);
  const slot = await reserveSlot(creds, {
    deviceId,
    ipHash: await ipHash(creds, await resolveCallerIp(req)),
    day,
    deviceCap: tier === "pro" ? PRO_DAILY_CAP : FREE_DAILY_CAP,
    countDevice: countsDevice,
  });
  if (slot === "error") return json({ error: "unavailable" }, 503);
  if (slot === "device") return json({ error: "daily_limit" }, 429);
  if (slot === "global") return json({ error: "capacity" }, 429);
  if (slot === "ip") return json({ error: "rate_limit" }, 429, { "Retry-After": String(3600 - (Math.floor(now / 1000) % 3600)) });
  if (countsDevice) markCounted(replay, now);

  const client = bedrockClient();
  if (!client) {
    if (countsDevice) forgetCounted(replay);
    await releaseSlot(creds, deviceId, day, countsDevice);
    return json({ error: "not_configured" }, 500);
  }

  const model = spikeModel();
  const call: Call = {
    client,
    model,
    params: buildParams(model, SYSTEM_PROMPT, dynamicSystem(locale, packet), messages),
    locale,
    deviceId,
    replayKey: replay,
    creds,
    day,
    countsDevice,
  };
  try {
    return body.stream === true ? await streamReply(call) : await replyOnce(call);
  } catch (err) {
    logUpstream(err);
    await giveBack(call);
    return json({ error: "upstream" }, 502);
  }
});
