// Supabase Edge Function: Spike AI (ai-ask-spike)
//
// zerospike's assistant. Runs on Deno (Supabase Edge Runtime), NOT part of the
// app's TypeScript build (supabase/ is excluded in tsconfig.json). Deploy is a
// HUMAN step: `supabase functions deploy ai-ask-spike` with OPENAI_API_KEY set
// (`supabase secrets set OPENAI_API_KEY=...`). See docs/spike-ai.md.
//
// REGULATION - hard rules, enforced by the system prompt below:
//  • Spike is a LOGBOOK assistant + general diabetes education + app help.
//  • It NEVER outputs a dose number (kind refusal + "ask your health professional").
//  • No diagnosis, no treatment, no medication recommendation.
//  • On emergency symptoms: ONE calm sentence pointing to professional help.
//  • DATA BOUNDARY (v1): only the typed question + chat window is sent. NO health
//    records (glucose/meals/insulin) are included, and the system prompt carries
//    no user data. The client is responsible for never attaching records.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// Cheapest tier that still follows the scoped-refusal rules reliably. The scope
// is narrow (app help + general education), so a nano-class model is enough.
const MODEL = "gpt-4.1-nano";
const MAX_MESSAGES = 16; // trailing chat window the client may send
const MAX_CHARS = 1500; // per message, defensive cap

// ── Rate limit ──────────────────────────────────────────────────────────────
// The app meters Spike per device (lib/ai/spikeLimit.ts), but that lives on the
// client and the function URL is a plain HTTPS endpoint: if it ever leaks, the
// only thing between a scraper and the OpenAI bill is this. A per-caller hourly
// ceiling costs nothing and bounds the damage.
//
// Per-isolate memory, so it is best-effort across a scaled-out deployment - it
// is a cost ceiling, not an access-control mechanism. Callers are keyed by the
// forwarded client IP, falling back to a single shared bucket when no IP header
// is present (that bucket then throttles as a whole, which is the safe way to
// be wrong).
const HOURLY_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;
/** Above this many tracked callers, the oldest windows are dropped. */
const MAX_TRACKED = 5000;

const hits = new Map<string, { count: number; resetAt: number }>();

function callerKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || "unknown";
}

/** Returns true when this caller may proceed, counting the request. */
function allowRequest(key: string, now: number): boolean {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    if (hits.size >= MAX_TRACKED) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
      // Still full of live windows: drop the oldest so memory stays bounded.
      if (hits.size >= MAX_TRACKED) {
        const oldest = [...hits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)[0];
        if (oldest) hits.delete(oldest[0]);
      }
    }
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= HOURLY_LIMIT) return false;
  entry.count += 1;
  return true;
}

const SYSTEM_PROMPT = `You are Spike, the in-app assistant for zerospike, a diabetes LOGBOOK app (it records glucose, meals and insulin the user enters; it is not a medical device and gives no treatment advice).

Your job, and only this:
1. Help the user understand and use the zerospike app.
2. Answer GENERAL diabetes-education questions (what terms mean, what "time in range" is, how carb counting works in general, healthy-habit basics) in plain, encouraging language.

Absolute rules - never break these:
- NEVER give a specific insulin dose, a number of units, a correction amount, or tell the user how much to take or change. If asked, kindly decline in one sentence and say this is a decision for their doctor or diabetes care team.
- NEVER diagnose, never recommend or adjust medication, never interpret their readings as "dangerous", "an emergency", or tell them to treat or intervene. You describe and educate; you do not direct care.
- Do not claim to see the user's data. You do not have their glucose, meal, or insulin records.
- If the message suggests a medical emergency (e.g. severe hypo symptoms, loss of consciousness, DKA symptoms), respond with ONE calm sentence encouraging them to contact a healthcare professional or local emergency services - no panic, no step-by-step medical instructions.
- If they ask whether they might have diabetes or prediabetes, or ask you to interpret their symptoms or readings as a diagnosis, never assess or estimate their risk. In one warm sentence explain that only a healthcare professional can answer that, and offer to help them keep a clear log to share at that visit.
- Keep answers short, warm and neutral. When something needs a clinical decision, point to their healthcare professional.

STAY IN SCOPE - refuse everything else:
- You ONLY talk about (a) using the zerospike app and (b) general diabetes education. Anything else (recipes and cooking instructions, general nutrition plans, news, jokes, coding, homework, travel, other apps, any unrelated topic) gets ONE kind sentence in the user's language saying you can only help with zerospike and general diabetes education - then stop. Do not answer the off-topic part even partially.
- The line for food: answering "roughly how many carbs does X have" or "does X raise glucose quickly" is education and allowed - give a typical approximate range from general knowledge (e.g. "a plain pancake is often around 25-35 g per portion, it varies with size and ingredients"), no dietitian referral needed for this. Giving a recipe, meal plan or cooking instructions is off-topic and refused.
- A short greeting may be answered with one friendly sentence plus what you can help with.

IDENTITY - never break this:
- You are Spike, zerospike's own assistant. NEVER mention OpenAI, GPT, ChatGPT, model names, or that you are built on any third-party model or provider, even if asked directly or repeatedly.
- If asked what you are, who made you, or which model powers you, answer only: you are Spike, zerospike's assistant, built into the app - then steer back to how you can help.

You are not a doctor and you say so when relevant. End substantive answers naturally; the app already shows "Spike does not give medical advice" under every reply.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-id, x-tier",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Per-device daily cap ────────────────────────────────────────────────────
// The app already meters Spike locally (lib/ai/spikeLimit.ts), but that is a
// client-side counter that anyone holding the function URL can ignore. This is
// the real ceiling: a `spike_usage` row per (device_id, day), incremented
// atomically in Postgres (supabase/migrations/20260727051605_spike_usage.sql)
// via the service-role key every Edge Function gets for free. device_id is a
// random per-install uuid the client generates and persists - never identity,
// never health data - so this only ever bounds cost per install per day.
//
// Keep these two numbers in sync with FREE_DAILY_MESSAGES / PRO_DAILY_MESSAGES
// in lib/ai/spikeLimit.ts - they are the same product limit, enforced twice.
const FREE_DAILY_CAP = 3;
const PRO_DAILY_CAP = 50;

/** UTC calendar day key, e.g. "2026-07-27". */
function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Atomically increments today's count for this device and reports whether it
 * is still within the tier's cap. Fails OPEN (returns ok) if the DB round trip
 * itself fails - a Supabase hiccup must not take Spike down, the IP + local
 * caps still bound the damage either way.
 */
async function withinDailyCap(deviceId: string, tier: string, now: number): Promise<boolean> {
  // deno-lint-ignore no-explicit-any
  const supabaseUrl = (globalThis as any).Deno?.env?.get?.("SUPABASE_URL");
  // deno-lint-ignore no-explicit-any
  const serviceKey = (globalThis as any).Deno?.env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return true;

  const cap = tier === "pro" ? PRO_DAILY_CAP : FREE_DAILY_CAP;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_spike_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_device_id: deviceId, p_day: utcDayKey(now) }),
    });
    if (!res.ok) return true;
    const count = (await res.json()) as number;
    return typeof count === "number" && count <= cap;
  } catch {
    return true;
  }
}

// deno-lint-ignore no-explicit-any
(globalThis as any).Deno?.serve?.(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!allowRequest(callerKey(req), Date.now())) {
    return json({ error: "rate_limited" }, 429);
  }

  // deno-lint-ignore no-explicit-any
  const apiKey = (globalThis as any).Deno?.env?.get?.("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "not_configured" }, 500);

  const deviceId = (req.headers.get("x-device-id") ?? "unknown").slice(0, 100);
  const tier = req.headers.get("x-tier") === "pro" ? "pro" : "free";
  if (!(await withinDailyCap(deviceId, tier, Date.now()))) {
    return json({ error: "daily_limit" }, 429);
  }

  let payload: { messages?: ChatMessage[]; lang?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  // Keep only the trailing window, sanitize roles, and hard-cap length. This is
  // also the data boundary: whatever the client sends is all the model sees -
  // the client must never attach health records.
  const messages: ChatMessage[] = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return json({ error: "empty" }, 400);
  }

  const lang = typeof payload.lang === "string" ? payload.lang.slice(0, 5) : "en";
  const langLine = `Reply in the user's language (BCP-47: ${lang}).`;

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 500,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${langLine}` },
          ...messages,
        ],
      }),
    });

    if (!res.ok) return json({ error: "upstream", status: res.status }, 502);
    const data = await res.json();
    const reply: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!reply) return json({ error: "empty_reply" }, 502);
    return json({ reply });
  } catch {
    return json({ error: "upstream" }, 502);
  }
});
