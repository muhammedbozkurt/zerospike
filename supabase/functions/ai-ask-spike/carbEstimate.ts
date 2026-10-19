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
  body: CarbEstimateBody | { error: CarbErrorCode; charged?: boolean };
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
// carries one is not a meal estimate. Unambiguous roots (insulin, bolus, drug and brand
// names) match as substrings of a word, so "PastaInsulin" and "Mahlzeiteninsulin" are
// caught; ambiguous stems match as word prefixes ("a dozen eggs", "community" pass).
// Food counting words (unidad, unité, unità, piece) are NOT medical on their own:
// "2 unidades de pan" is a meal. They count only after a how-many question or as an
// IU-style abbreviation. A dose word is medical unless it is a portion count ("1 doz
// eggs", "dosi per 2 persone"). Each text is also read with separators removed
// ("in-su-lin", "i n s u l i n", "I.U.").

const ROOTS = [
  "insulin", "inzulin", "bolus", "basal", "bazal", "korrektur", "correction", "correccion", "correzione", "correcao", "metformin",
  "hipoglis", "hipoglucem", "hypoglyc", "hypoglyk", "hyperglyc", "hyperglyk", "hiperglis", "hiperglucem", "ipoglicem", "iperglicem",
  "novorapid", "novolog", "novomix", "humalog", "humulin", "insuman", "lantus", "levemir", "tresiba", "toujeo", "basaglar",
  "semglee", "fiasp", "apidra", "lyumjev", "admelog", "actrapid", "insulatard", "mixtard", "protaphane", "ryzodeg", "xultophy", "soliqua",
  "glargin", "aspart", "lispro", "glulisin", "degludec", "detemir", "ozempic", "rybelsus", "victoza", "saxenda", "wegovy", "mounjaro",
  "trulicity", "semaglutid", "liraglutid", "tirzepatid", "dulaglutid", "jardiance", "januvia", "forxiga", "farxiga", "diamicron",
  "galvus", "glucophage", "glifage", "glimepirid", "gliclazid", "glibenclamid", "empagliflozin", "dapagliflozin", "canagliflozin",
  "sitagliptin", "vildagliptin", "sglt",
  "inyecc", "inyect", "inject", "iniett", "iniez", "injec", "injiz", "piqure", "enjek",
];
const PREFIXES = [
  "medicat", "medicin", "treatment", "tratamien", "trattamen", "traitement", "tratament", "behandl", "diagnos", "teshis", "ilac", "tedavi",
  "dosag", "dosier", "posolog", "piquer",
];
const WORDS = new Set(["nph", "isf", "icr", "amaryl", "spritze", "spritzen", "spritzt", "spritzte", "igne", "iob", "einh", "einheit", "einheiten"]);
const CONTEXT = [
  /(?:rapid|fast|short|long)[\s-]*acting/, /carb\w*\s*ratio/, /sliding\s*scale/, /(?<![a-z0-9])i\s*:\s*c(?![a-z0-9])/, /(?<![a-z0-9])(?:ke|be|bie)[\s-]*faktor/,
  /ne\s+kadar\s+(?:yapay|vuray|vurmal|yapmal)|unite\s+yapay|yapay\w*\s+unite|vuray/,
  /(?:rapid[ao]|lent[ao]|ultrarapid[ao])\s*\d+\s*(?:dosis|dose|doses|dosi|doz|unidades?|units?)/,
  /(?:unidades?|units?|unites?|unita|dosis|doses?|doz|dosi)\s+(?:de\s+|di\s+|of\s+|d['’])?(?:rapid|lent|ultrarapid)\w*/,
  /[\d\u0660-\u0669]\s*وحد[ةت]|كم\s*وحد|وحدتين/,
  /ka[cç]\s*birim\w*\s+(?:yap|vur|al)/, /hypo\w*\s*risk/,
  /(?:units?|u|ie|iu|ui|ue|einheiten|unites?|unidades?)\s*(?:per|pro|par|por|\/)\s*\d+(?:[.,]\d+)?\s*(?:g|gr|gram\w*|gramm\w*)(?![a-z0-9])/,
];
const DOSE_WORD = /(?<![a-z0-9])(?:dose|doses|dosi|dosis|dosing|doz|dozu|dozunu|dozum|dozlar|dozda|dozunuz)(?![a-z0-9])/g;
const DOSE_COUNTABLE = new Set(["dose", "dosi", "dosis", "doz"]);
const DOSE_PORTION_AFTER = /^\s*(?:(?:per|for|pour|para|por|fur|fuer|de|di|icin)\s+)?\d+\s*(?:persone|persona|personas|people|persons|personen|personnes|pessoas|kisi|servings?|portions?|porzioni|porciones|porcoes)/;
const IU_AFTER_NUMBER = /(?<![a-z0-9])\d+(?:[.,]\d+)?\s*(?:(?:iu|ie|ui|ue)(?![a-z0-9])|u(?![a-z0-9])(?!\s+\d))|(?<![a-z0-9])\d+\s*e(?:\.|\s*$)/;
const IU_WORD = /(?<![a-z0-9])iu(?![a-z0-9])/;
const UNIT_WORD = String.raw`(?:units?|unites?|unitas?|unidades?|unidad|einheit\w*|iu|ie|ui|ue|u)`;
const HOW_MANY_UNITS = new RegExp(
  String.raw`(?:how\s+(?:many|much)|kac|wie\s*viele?|combien|cuant[oa]s?|quant[eio]s?|quantas?|quantos?)\s+(?:(?:[a-z]+['’\s]+|d['’]|de\s+|di\s+)?)${UNIT_WORD}(?![a-z0-9])`,
);
const OTHER_SCRIPT = [
  "نسولين", "جرع", "وحدات", "علاج", "دواء", "حقن", "نوفورابيد", "لانتوس", "توجيو", "تريسيبا", "ليفيمير", "هيومالوج", "ميتفورمين", "اوزمبيك", "أوزمبيك", "نقص السكر", "ارتفاع السكر",
  "インスリン", "インシュリン", "単位", "用量", "カーボ比", "投与", "服薬", "薬剤", "治療", "診断", "ユニット", "打つ", "注射", "ボーラス", "低血糖", "高血糖", "メトホルミン",
  "ノボラ", "ヒューマログ", "ヒューマリン", "ノボリン", "ランタス", "トレシーバ", "レベミル", "ルムジェブ", "アピドラ", "リベルサス", "オゼンピック", "ビクトーザ", "ジャディアンス", "グリクラジド",
];

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i");
}

function readings(f: string): string[] {
  const glued = f.replace(/(?<=[a-z0-9])[.\-_·](?=[a-z0-9])/g, "");
  const lettersJoined = (t: string) => t.replace(/(?<![a-z0-9])[a-z](?:\s+[a-z])+(?![a-z0-9])/g, (m) => m.replace(/\s+/g, ""));
  return [f, glued, lettersJoined(f), lettersJoined(glued)];
}

// Look-alike digits and symbols read as the letter they stand in for; l, 1, | and i collapse to one letter
// on both sides, so "InsuIin" (capital i for l), "1nsulin" and "ins0lin" (0 for u) meet the roots.
const LEET_ROOTS = ROOTS.map((r) => r.replace(/l/g, "i"));
const LEET_PREFIXES = PREFIXES.map((r) => r.replace(/l/g, "i"));
function leetReadings(text: string): string[] {
  if (!/[0$1|il]/.test(text)) return [];
  return ["o", "u"].map((zero) => text.replace(/0/g, zero).replace(/\$/g, "s").replace(/[l1|]/g, "i"));
}

/** "uma dose de cachaça": a drink measure, not a dose. Only after an article and before a plain noun. */
const PT_DOSE_BEFORE = /(?:^|[^a-z0-9])(?:uma|um|duas|outra)\s+$/;
const PT_DOSE_AFTER = /^\s+de\s+[a-z]/;

function pairJoined(text: string): boolean {
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i + 1 < words.length; i++) {
    if (Math.min(words[i].length, words[i + 1].length) > 3) continue;
    const joined = words[i] + words[i + 1];
    if (ROOTS.some((r) => r.length >= 6 && joined.includes(r) && !words[i].includes(r) && !words[i + 1].includes(r))) return true;
  }
  return false;
}

function scanFolded(f: string): boolean {
  if (OTHER_SCRIPT.some((t) => f.includes(t))) return true;
  for (const text of readings(f)) {
    for (const word of text.replace(/aspartam/g, "").split(/[^a-z0-9]+/)) {
      if (!word) continue;
      if (WORDS.has(word) || ROOTS.some((r) => word.includes(r)) || PREFIXES.some((st) => word.startsWith(st))) return true;
    }
    for (const leet of leetReadings(text)) {
      for (const word of leet.replace(/aspartam/g, "").split(/[^a-z0-9]+/)) {
        if (word && (LEET_ROOTS.some((r) => word.includes(r)) || LEET_PREFIXES.some((st) => word.startsWith(st)))) return true;
      }
    }
    if (pairJoined(text)) return true;
    if (IU_AFTER_NUMBER.test(text) || IU_WORD.test(text) || HOW_MANY_UNITS.test(text) || CONTEXT.some((re) => re.test(text))) return true;
    for (const m of text.matchAll(DOSE_WORD)) {
      const before = text.slice(0, m.index);
      const after = text.slice(m.index + m[0].length);
      if (DOSE_COUNTABLE.has(m[0]) && /\d\s*$/.test(before)) continue;
      if (DOSE_PORTION_AFTER.test(after)) continue;
      if (m[0] === "dose" && PT_DOSE_BEFORE.test(before) && PT_DOSE_AFTER.test(after)) continue;
      return true;
    }
  }
  return false;
}

// German "Dose/Dosen" (tin) mid-sentence with a capital D. Not "Dose for ...", and not the "wie viele Dosen" / "meine Dose" question shapes.
const DE_TIN = /(?<=[\p{L}\p{N}]\s+)Dosen?(?![\p{L}\p{N}])(?!\s+(?:for|of|to|per|pro)(?![\p{L}]))/gu;
const DE_TIN_ASKED = /(?:wie\s*viele|welche|meine|meiner|deine|ihre|richtige|empfohlene|passende)\s+$/i;
function maskTins(text: string): string {
  return text.replace(DE_TIN, (m, offset: number) => (DE_TIN_ASKED.test(text.slice(0, offset)) ? m : "tin"));
}

// 食品交換表 "ご飯 3単位": exchange units of a named food, not insulin units.
const JA_EXCHANGE = /(?:ご飯|ごはん|御飯|ライス|食パン|パン|うどん|そば|めん|麺|いも|芋|牛乳|果物|みかん|りんご|バナナ)\s*[0-9]+(?:\.[0-9]+)?\s*単位/g;

export function hasMedicalTerm(raw: string): boolean {
  const text = raw.normalize("NFKC").replace(JA_EXCHANGE, " ");
  const plain = normalizeWithMap(text, "").norm.toLowerCase();
  if (plain.includes("ünite")) return true;
  for (const gap of ["", " "] as const) {
    if (OTHER_SCRIPT.some((t) => normalizeWithMap(text, gap).norm.includes(t))) return true;
    if (scanFolded(fold(maskTins(normalizeWithMap(text, gap, true).norm)))) return true;
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

// Scripts a meal label can use in the nine app languages. A letter from any other script (Cyrillic or
// Greek lookalikes the normaliser did not map, IPA) cannot be read by the gate, so the item is refused.
const FOREIGN_LETTER = /(?![\p{scx=Latin}\p{scx=Arabic}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Han}])[\p{L}\p{M}]/u;

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
    if (FOREIGN_LETTER.test(name) || FOREIGN_LETTER.test(unit)) return { ok: false, reason: "filtered", rule: "carb_script" };
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
    return { status: 502, body: { error: "estimate_failed", charged: true } };
  }
  if (!parsed.ok) {
    await deps.record(row(true, parsed.rule));
    return { status: 200, body: { items: [], total_grams_carb: 0, filtered: true, charged: true, usage } };
  }
  await deps.record(row(false, parsed.items.length === 0 ? "empty" : null));
  return { status: 200, body: { items: parsed.items, total_grams_carb: parsed.total, filtered: false, charged: true, usage } };
}
