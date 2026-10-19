// carb_estimate mode of ai-ask-spike: free text meal -> JSON carbohydrate estimate.
// Everything here is pure or takes its I/O through CarbDeps, so it runs under
// `deno test` with no network. index.ts wires CarbDeps to Postgres and Bedrock.
//
// Data: the meal text goes to the model for this one request. It is never logged
// and never written to a table (spike_calls gets mode, token counts and latency).
// The fixed "this is an estimate, not a dose" note belongs to the app (i18n), not here.

import {
  CARB_FREE_DAILY_CAP,
  CARB_GRAMS_MAX,
  CARB_KEY_PREFIX,
  CARB_MAX_ITEMS,
  CARB_MODE,
  CARB_NAME_MAX,
  CARB_PRO_DAILY_CAP,
  CARB_QUANTITY_MAX,
  CARB_TEXT_MAX,
  CARB_UNIT_MAX,
  type CarbEstimateBody,
  type CarbErrorCode,
  type CarbItem,
} from "../_shared/carb-estimate.ts";
import type { TokenUsage } from "./bedrock.ts";
import { checkReply, normalizeWithMap } from "./filter.ts";
import { CARB_SYSTEM_PROMPT, carbDynamicSystem, normalizeLocale } from "./prompt.ts";

export type Slot = "ok" | "ip" | "device" | "global" | "error";

export interface ModelResult {
  text: string;
  stopReason: string | null;
  usage: TokenUsage;
  latencyMs: number;
}

export interface CarbCallRow {
  mode: typeof CARB_MODE;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number;
  filtered: boolean;
  filter_rule: string | null;
}

export interface CarbDeps {
  model: string;
  nowMs: number;
  /** Takes one slot for the key (ip, device-key and global ceilings); the key is `ce:<deviceId>`. */
  reserve(key: string, deviceCap: number): Promise<Slot>;
  release(key: string): Promise<void>;
  /** Throws on any upstream failure. */
  call(system: string, dynamic: string, userText: string): Promise<ModelResult>;
  record(row: CarbCallRow): Promise<void>;
}

export interface CarbResponse {
  status: number;
  body: CarbEstimateBody | { error: CarbErrorCode };
  headers?: Record<string, string>;
}

const err = (status: number, error: CarbErrorCode, headers?: Record<string, string>): CarbResponse => ({ status, body: { error }, headers });

// ── Request ─────────────────────────────────────────────────────────────────

export interface CarbRequest {
  locale: ReturnType<typeof normalizeLocale>;
  tier: "free" | "pro";
  text: string;
}

/** Null when the body is not a well-formed carb_estimate request. */
export function parseCarbRequest(body: Record<string, unknown>): CarbRequest | null {
  if (body.mode !== CARB_MODE || typeof body.text !== "string") return null;
  // < and > cannot close or open the <meal_text> wrapper the model reads the text in.
  const text = normalizeWithMap(body.text, "").norm.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length === 0 || [...text].length > CARB_TEXT_MAX) return null;
  return { locale: normalizeLocale(body.locale), tier: body.tier === "pro" ? "pro" : "free", text };
}

// ── Medical-content gate ────────────────────────────────────────────────────
// A meal description has no use for these words, so a request or a model answer that
// carries one is not a meal estimate. Latin stems match as word prefixes, so "a dozen
// eggs" and "community" pass. Food counting words (unidad, unité, unità, piece) are NOT
// medical on their own: "2 unidades de pan" is a meal. They count only next to insulin
// or a drug (stems below), after a how-many question, or as an IU-style abbreviation.
// A dose word (dose, dosis, doz) is medical unless it is a portion count ("1 doz eggs",
// "dosi per 2 persone").

const LATIN_STEMS = [
  "insulin", "inzulin", "bolus", "basal", "metformin", "medicat", "medicin", "treatment", "diagnos", "teshis", "ilac", "tedavi",
  "hipogliseml", "hypoglyc", "hyperglyc", "dosag", "dosier", "posolog", "einheit",
  "novorapid", "novolog", "novomix", "humalog", "humulin", "insuman", "lantus", "levemir", "tresiba", "toujeo", "basaglar", "abasaglar",
  "semglee", "fiasp", "apidra", "lyumjev", "admelog", "actrapid", "ozempic", "victoza", "saxenda", "wegovy", "mounjaro", "trulicity", "glucophage",
];
const DOSE_WORD = /(?<![a-z0-9])(?:dose|doses|dosi|dosis|dosing|doz|dozu|dozunu|dozum|dozlar|dozda|dozunuz)(?![a-z0-9])/g;
const DOSE_PORTION_AFTER = /^\s*(?:(?:per|for|pour|para|por|fur|fuer|de|di|icin)\s+)?\d+\s*(?:persone|persona|personas|people|persons|personen|personnes|pessoas|kisi|servings?|portions?|porzioni|porciones|porcoes)/;
const IU_AFTER_NUMBER = /(?<![a-z0-9])\d+(?:[.,]\d+)?\s*(?:iu|ie|ui|ue|u)(?![a-z0-9])/;
const IU_WORD = /(?<![a-z0-9])iu(?![a-z0-9])/;
const HOW_MANY_UNITS =
  /(?:how\s+(?:many|much)|kac|wie\s*viele?|combien|cuantas?|cuantos|quante|quanti|quantas?|quantos?)\s+(?:[a-z]+['’\s]+)?(?:units?|unites?|unitas?|unidades?|unidad)(?![a-z])/;
const OTHER_SCRIPT = ["نسولين", "جرع", "وحدات", "علاج", "دواء", "インスリン", "インシュリン", "単位", "投与", "服薬", "薬剤", "治療", "診断", "ユニット"];

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i");
}

function scanFolded(f: string): boolean {
  if (OTHER_SCRIPT.some((t) => f.includes(t))) return true;
  for (const word of f.split(/[^a-z0-9]+/)) {
    if (word && LATIN_STEMS.some((st) => word.startsWith(st))) return true;
  }
  if (IU_AFTER_NUMBER.test(f) || IU_WORD.test(f) || HOW_MANY_UNITS.test(f)) return true;
  for (const m of f.matchAll(DOSE_WORD)) {
    if (/\d\s*$/.test(f.slice(0, m.index))) continue;
    if (DOSE_PORTION_AFTER.test(f.slice(m.index + m[0].length))) continue;
    return true;
  }
  return false;
}

export function hasMedicalTerm(text: string): boolean {
  const plain = normalizeWithMap(text, "").norm.toLowerCase();
  if (plain.includes("ünite")) return true;
  for (const gap of ["", " "] as const) {
    if (scanFolded(fold(normalizeWithMap(text, gap, true).norm))) return true;
  }
  return false;
}

const COUNT_WORDS = new Set(["unidad", "unidades", "unidade", "unite", "unites", "unita"]);
const MEDICAL_UNITS = new Set(["iu", "ie", "ui", "ue", "u", "e", "mg", "mcg", "unit", "units", "einheit", "einheiten"]);

// ── Model answer ────────────────────────────────────────────────────────────

export type ParsedEstimate =
  | { ok: true; items: CarbItem[]; total: number }
  | { ok: false; reason: "schema" }
  | { ok: false; reason: "filtered"; rule: string };

const round1 = (n: number): number => Math.round(n * 10) / 10;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown, min: number, max: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;

/** The JSON object in the model text: a code fence or a stray sentence around it is tolerated, nothing else. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function cleanLabel(x: unknown, max: number, allowEmpty: boolean): string | null {
  if (typeof x !== "string") return null;
  const s = normalizeWithMap(x, "").norm.replace(/\s+/g, " ").trim();
  if (s.length > max || (!allowEmpty && s.length === 0)) return null;
  return s;
}

/** Schema check + output gate. The total is recomputed from the items; keys outside the schema are dropped. */
export function parseEstimate(raw: string): ParsedEstimate {
  const root = extractJson(raw);
  if (!isObj(root) || !Array.isArray(root.items) || !isNum(root.total_grams_carb, 0, CARB_GRAMS_MAX * CARB_MAX_ITEMS)) return { ok: false, reason: "schema" };
  if (root.items.length > CARB_MAX_ITEMS) return { ok: false, reason: "schema" };
  const items: CarbItem[] = [];
  for (const it of root.items) {
    if (!isObj(it)) return { ok: false, reason: "schema" };
    const name = cleanLabel(it.name, CARB_NAME_MAX, false);
    const unit = cleanLabel(it.unit, CARB_UNIT_MAX, true);
    if (name === null || unit === null || !isNum(it.quantity, 0, CARB_QUANTITY_MAX) || !isNum(it.grams_carb, 0, CARB_GRAMS_MAX)) {
      return { ok: false, reason: "schema" };
    }
    const unitKey = fold(unit).replace(/[^a-z0-9]/g, "");
    const medical = [name, unit, `${name} ${it.quantity} ${unit}`].some(hasMedicalTerm) || MEDICAL_UNITS.has(unitKey);
    if (medical) return { ok: false, reason: "filtered", rule: "carb_medical" };
    const cleanUnit = COUNT_WORDS.has(unitKey) ? "" : unit;
    for (const field of [name, cleanUnit, `${name} ${it.quantity} ${cleanUnit}`]) {
      const rule = checkReply(field);
      if (rule) return { ok: false, reason: "filtered", rule };
    }
    items.push({ name, quantity: round1(it.quantity), unit: cleanUnit, grams_carb: round1(it.grams_carb) });
  }
  return { ok: true, items, total: round1(items.reduce((sum, i) => sum + i.grams_carb, 0)) };
}

// ── Handler ─────────────────────────────────────────────────────────────────

const zeroUsage = (model: string) => ({ model, input_tokens: 0, output_tokens: 0 });

/**
 * Order: parse -> refuse medical requests (no slot, no model call) -> take the slot
 * (`ce:<deviceId>`, same ip and global ceilings as chat) -> model -> schema + gate.
 * Only an upstream failure (the model was not reached) gives the slot back. Once the model
 * ran, the call was billed whatever came back (schema error, max_tokens, empty, filtered),
 * so the slot stays spent: a release would let injected prompts make calls the global cap
 * does not count. 200 answers carry `charged`: false before any model call, true after.
 */
export async function handleCarbEstimate(body: Record<string, unknown>, deviceId: string, deps: CarbDeps): Promise<CarbResponse> {
  const req = parseCarbRequest(body);
  if (!req) return err(400, "bad_request");
  if (hasMedicalTerm(req.text)) {
    return { status: 200, body: { items: [], total_grams_carb: 0, filtered: true, charged: false, usage: zeroUsage(deps.model) } };
  }

  const key = `${CARB_KEY_PREFIX}${deviceId}`;
  const slot = await deps.reserve(key, req.tier === "pro" ? CARB_PRO_DAILY_CAP : CARB_FREE_DAILY_CAP);
  if (slot === "error") return err(503, "unavailable");
  if (slot === "device") return err(429, "daily_limit_carb");
  if (slot === "global") return err(429, "capacity");
  if (slot === "ip") return err(429, "rate_limit", { "Retry-After": String(3600 - (Math.floor(deps.nowMs / 1000) % 3600)) });

  let result: ModelResult;
  try {
    result = await deps.call(CARB_SYSTEM_PROMPT, carbDynamicSystem(req.locale), `<meal_text>${req.text}</meal_text>`);
  } catch {
    await deps.release(key);
    return err(502, "upstream");
  }
  const usage = { model: deps.model, input_tokens: result.usage.input, output_tokens: result.usage.output };
  const row = (filtered: boolean, rule: string | null): CarbCallRow => ({
    mode: CARB_MODE,
    input_tokens: result.usage.input,
    output_tokens: result.usage.output,
    cache_read_tokens: result.usage.cacheRead,
    cache_write_tokens: result.usage.cacheWrite,
    latency_ms: result.latencyMs,
    filtered,
    filter_rule: rule,
  });

  if (result.stopReason === "refusal") {
    await deps.record(row(true, "refusal"));
    return { status: 200, body: { items: [], total_grams_carb: 0, filtered: true, charged: true, usage } };
  }
  const parsed = result.stopReason === "max_tokens" ? ({ ok: false, reason: "schema" } as const) : parseEstimate(result.text);
  if (!parsed.ok && parsed.reason === "schema") {
    await deps.record(row(false, "schema"));
    return err(502, "estimate_failed");
  }
  if (!parsed.ok) {
    await deps.record(row(true, parsed.rule));
    return { status: 200, body: { items: [], total_grams_carb: 0, filtered: true, charged: true, usage } };
  }
  await deps.record(row(false, parsed.items.length === 0 ? "empty" : null));
  return { status: 200, body: { items: parsed.items, total_grams_carb: parsed.total, filtered: false, charged: true, usage } };
}
