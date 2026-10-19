import Constants from "expo-constants";
import { fetch } from "expo/fetch";
import { getDeviceId } from "../identity/deviceId";
import { isScreenshotMode } from "../screenshotMode";
import { hasSpikeConsent } from "../services/spikeConsent";
import { composeMealInput, parseGramsInput, type ComposeItem } from "../mealCompose";
import type { SpikeTier } from "./spikeClient";

/**
 * Meal-text carb estimate: one POST to the ai-ask-spike function (mode
 * carb_estimate), one JSON answer, no stream. The meal text is the only thing
 * that leaves the device; it is never stored, logged or put in a crash context.
 * The result is a suggestion the user edits and adds by hand: nothing here
 * writes to the journal.
 */
export const CARB_TEXT_MAX = 300;
export const CARB_MAX_ITEMS = 12;
export const CARB_GRAMS_MAX = 500;
const NAME_MAX = 60;
const UNIT_MAX = 20;
const QUANTITY_MAX = 10000;
const REQUEST_TIMEOUT_MS = 45_000;

export interface CarbItem {
  name: string;
  quantity: number;
  unit: string;
  grams_carb: number;
}

export interface CarbEstimate {
  items: CarbItem[];
  total_grams_carb: number;
  /** The function declined (a dose or insulin request) or found no food. */
  filtered: boolean;
  /** The server spent the device's allowance (a model call ran). Only an explicit true counts. */
  charged: boolean;
}

/** Takes the slot unless a request is already running; the caller releases it in finally. */
export function enterGuard(ref: { current: boolean }): boolean {
  if (ref.current) return false;
  ref.current = true;
  return true;
}

/** Local allowance ticks only for an explicit server charge; a missing flag never burns it. */
export function shouldCountEstimate(result: Pick<CarbEstimate, "charged">): boolean {
  return result.charged === true;
}

export const CARB_ERROR_CODES = [
  "limit",
  "busy",
  "failed",
  "input",
  "consent_required",
  "not_configured",
  "aborted",
] as const;
export type CarbErrorCode = (typeof CARB_ERROR_CODES)[number];

/** The code is the message, like the Spike client: a plain Error survives every transpile target. */
function carbError(code: CarbErrorCode, charged = false): Error {
  const e = new Error(code) as Error & { charged?: boolean };
  if (charged) e.charged = true;
  return e;
}

/** True only when the server's error body said it spent the device's allowance (502 estimate_failed). */
export function carbErrorCharged(e: unknown): boolean {
  return e instanceof Error && (e as Error & { charged?: boolean }).charged === true;
}

export function carbErrorCode(e: unknown): CarbErrorCode {
  const message = e instanceof Error ? e.message : "";
  return (CARB_ERROR_CODES as readonly string[]).includes(message)
    ? (message as CarbErrorCode)
    : "failed";
}

/** The function's error id -> the app's error kind (each kind has one message). */
export function mapServerError(status: number, id: unknown): CarbErrorCode {
  const code = typeof id === "string" ? id : "";
  if (code === "daily_limit_carb") return "limit";
  if (code === "rate_limit" || code === "capacity") return "busy";
  if (code === "bad_request") return "input";
  if (code === "consent_required") return "consent_required";
  if (status === 429) return "busy";
  return "failed";
}

/** Null when the text cannot be sent: empty after trimming, or over the limit. */
export function prepareMealText(raw: string): string | null {
  const text = String(raw).replace(/\s+/g, " ").trim();
  if (text.length === 0 || [...text].length > CARB_TEXT_MAX) return null;
  return text;
}

export interface CarbRequestBody {
  mode: "carb_estimate";
  locale: string;
  tier: SpikeTier;
  text: string;
}

export function buildRequestBody(text: string, locale: string, tier: SpikeTier): CarbRequestBody {
  return {
    mode: "carb_estimate",
    locale: String(locale || "en").slice(0, 5),
    tier,
    text,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const round1 = (n: number): number => Math.round(n * 10) / 10;

function finiteIn(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : null;
}

/** Reads the 200 body defensively: a malformed item is dropped, a number out of range is clamped. */
export function parseEstimateBody(raw: unknown): CarbEstimate {
  if (!isRecord(raw)) throw carbError("failed");
  const items: CarbItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const entry of raw.items) {
      if (!isRecord(entry) || items.length >= CARB_MAX_ITEMS) continue;
      const name = typeof entry.name === "string" ? entry.name.trim().slice(0, NAME_MAX) : "";
      const grams = finiteIn(entry.grams_carb, 0, CARB_GRAMS_MAX);
      if (name.length === 0 || grams === null) continue;
      items.push({
        name,
        quantity: round1(finiteIn(entry.quantity, 0, QUANTITY_MAX) ?? 1),
        unit: typeof entry.unit === "string" ? entry.unit.trim().slice(0, UNIT_MAX) : "",
        grams_carb: round1(grams),
      });
    }
  }
  const filtered = raw.filtered === true || items.length === 0;
  const total = round1(items.reduce((sum, item) => sum + item.grams_carb, 0));
  return {
    items: filtered ? [] : items,
    total_grams_carb: filtered ? 0 : total,
    filtered,
    charged: raw.charged === true,
  };
}

const FN_URL: string | undefined =
  (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.spikeFnUrl as
    | string
    | undefined;

export const carbEstimateConfigured =
  (typeof FN_URL === "string" && FN_URL.length > 0) || isScreenshotMode();

type SampleRow = readonly [name: string, unit: string];

/** Capture-only sample meals (store frame 04b), one per app language. */
const SAMPLE_MEALS: Record<string, { text: string; rows: readonly [SampleRow, SampleRow, SampleRow] }> = {
  tr: { text: "2 dilim ekmek, 1 yumurta, bir bardak süt", rows: [["Ekmek", "dilim"], ["Yumurta", "adet"], ["Süt", "bardak"]] },
  en: { text: "2 slices of bread, 1 egg, a glass of milk", rows: [["Bread", "slices"], ["Egg", "piece"], ["Milk", "glass"]] },
  de: { text: "2 Scheiben Brot, 1 Ei, ein Glas Milch", rows: [["Brot", "Scheiben"], ["Ei", "Stück"], ["Milch", "Glas"]] },
  fr: { text: "2 tranches de pain, 1 œuf, un verre de lait", rows: [["Pain", "tranches"], ["Œuf", "pièce"], ["Lait", "verre"]] },
  es: { text: "2 rebanadas de pan, 1 huevo, un vaso de leche", rows: [["Pan", "rebanadas"], ["Huevo", "unidad"], ["Leche", "vaso"]] },
  it: { text: "2 fette di pane, 1 uovo, un bicchiere di latte", rows: [["Pane", "fette"], ["Uovo", "pezzo"], ["Latte", "bicchiere"]] },
  pt: { text: "2 fatias de pão, 1 ovo, um copo de leite", rows: [["Pão", "fatias"], ["Ovo", "unidade"], ["Leite", "copo"]] },
  ar: { text: "شريحتان من الخبز، بيضة واحدة، كوب حليب", rows: [["خبز", "شريحة"], ["بيض", "حبة"], ["حليب", "كوب"]] },
  ja: { text: "食パン2枚、卵1個、牛乳コップ1杯", rows: [["食パン", "枚"], ["卵", "個"], ["牛乳", "杯"]] },
};
const SAMPLE_GRAMS = [28, 0.6, 12];

/** Null outside screenshot mode (dev build + capture env flag): the sample never exists in a release. */
export function screenshotCarbSample(locale: string): { text: string; estimate: CarbEstimate } | null {
  if (!isScreenshotMode()) return null;
  const sample = SAMPLE_MEALS[String(locale).slice(0, 2)] ?? SAMPLE_MEALS.en;
  const items: CarbItem[] = sample.rows.map(([name, unit], i) => ({
    name,
    unit,
    quantity: i === 0 ? 2 : 1,
    grams_carb: SAMPLE_GRAMS[i],
  }));
  return {
    text: sample.text,
    estimate: parseEstimateBody({ items, filtered: false }),
  };
}

export interface EstimateCarbsParams {
  text: string;
  locale: string;
  tier: SpikeTier;
  signal?: AbortSignal;
}

/**
 * Sends the meal text and resolves with the estimate. Without the current Spike
 * consent nothing is sent. Every throw is an Error whose message is a
 * CarbErrorCode (carbErrorCode()).
 */
export async function estimateCarbs(params: EstimateCarbsParams): Promise<CarbEstimate> {
  const sample = screenshotCarbSample(params.locale);
  if (sample) return sample.estimate;
  if (!carbEstimateConfigured || !FN_URL) throw carbError("not_configured");
  if (!(await hasSpikeConsent())) throw carbError("consent_required");
  const text = prepareMealText(params.text);
  if (text === null) throw carbError("input");

  const controller = new AbortController();
  const onExternal = (): void => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) controller.abort();
    else params.signal.addEventListener("abort", onExternal);
  }
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-id": await getDeviceId() },
      body: JSON.stringify(buildRequestBody(text, params.locale, params.tier)),
      signal: controller.signal,
    });
    if (!res.ok) {
      let id: unknown;
      let charged = false;
      try {
        const body = (await res.json()) as { error?: unknown; charged?: unknown } | null;
        id = body?.error;
        charged = body?.charged === true;
      } catch {
        id = undefined;
      }
      throw carbError(mapServerError(res.status, id), charged);
    }
    return parseEstimateBody(await res.json());
  } catch (e) {
    if (params.signal?.aborted) throw carbError("aborted");
    throw carbError(carbErrorCode(e), carbErrorCharged(e));
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onExternal);
  }
}

/** What the sheet edits: every field a string the user can change. */
export interface EditableItem {
  key: string;
  name: string;
  quantityText: string;
  unit: string;
  gramsText: string;
}

export function editableFromEstimate(items: readonly CarbItem[]): EditableItem[] {
  return items.map((item, i) => ({
    key: `ce${i}`,
    name: item.name,
    quantityText: String(item.quantity),
    unit: item.unit,
    gramsText: String(item.grams_carb),
  }));
}

/** An unreadable or negative amount is 0 grams; the cap matches the function's. */
export function editableGrams(item: EditableItem): number {
  return Math.min(parseGramsInput(item.gramsText), CARB_GRAMS_MAX);
}

export function editableLabel(item: EditableItem): string {
  const quantity = parseGramsInput(item.quantityText);
  const amount = [quantity > 0 ? String(quantity) : "", item.unit.trim()].filter(Boolean).join(" ");
  const name = item.name.trim();
  return amount ? `${name} (${amount})` : name;
}

function composeItems(items: readonly EditableItem[]): ComposeItem[] {
  return items.map((item) => ({
    key: item.key,
    food_id: item.key,
    name: item.name.trim() || "-",
    category: "",
    carb_100g: editableGrams(item),
    portion_g: 100,
  }));
}

/** Total over the same rounded per-item figures that are written, so the sum shown is the sum saved. */
export function editableTotal(items: readonly EditableItem[]): number {
  return composeMealInput(composeItems(items)).calculated_carbs_g;
}

/**
 * The journal row for the edited items. Portion stays 0: a free-text amount
 * ("2 slices") is not grams of food, and no dose is attached (insulin 0 is the
 * caller's, never derived from this).
 */
export function estimateMealInput(items: readonly EditableItem[]): {
  custom_food_name: string;
  portion_g: number;
  calculated_carbs_g: number;
} {
  const all = composeMealInput(composeItems(items));
  const named = items.filter(hasItemName);
  const label = composeMealInput(
    composeItems(named).map((item, i) => ({ ...item, name: editableLabel(named[i]) || item.name }))
  );
  return { custom_food_name: label.custom_food_name, portion_g: 0, calculated_carbs_g: all.calculated_carbs_g };
}

/** A placeholder ("", spaces, only dashes) is not a name; a saved row without one would open as a calculator meal. */
export function hasItemName(item: EditableItem): boolean {
  return !/^[\s\-\u2010-\u2015]*$/.test(item.name);
}

/**
 * "Add to log" is a deliberate tap on a result the user is looking at: there is
 * a result on screen with at least one item, and no save is running. Nothing
 * saves on its own when the estimate arrives.
 */
export function canAddEstimate(state: {
  resultShown: boolean;
  items: readonly EditableItem[];
  saving: boolean;
}): boolean {
  return (
    state.resultShown && state.items.length > 0 && state.items.some(hasItemName) && !state.saving
  );
}

/** Analytics only: an item count bucket, never a gram value. */
export function itemCountBucket(count: number): number {
  return Math.max(0, Math.min(CARB_MAX_ITEMS, Math.floor(count)));
}
