/**
 * Meal-text carb estimate, client side (lib/ai/carbEstimateClient.ts,
 * carbEstimateLimit.ts, the consent version, the sheet's wiring):
 *
 *   npx tsx scripts/carbEstimate.test.ts
 *
 * The client imports Expo modules, so in-memory stand-ins for expo-constants,
 * expo/fetch, AsyncStorage and expo-crypto are registered before it loads.
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const require: (id: string) => any;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const nodeModule = require("module");
const FN_URL = "https://example.test/functions/v1/ai-ask-spike";
const store = new Map<string, string>();
const storageApi = {
  getItem: async (k: string): Promise<string | null> => (store.has(k) ? (store.get(k) as string) : null),
  setItem: async (k: string, v: string): Promise<void> => void store.set(k, v),
  removeItem: async (k: string): Promise<void> => void store.delete(k),
};

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
const calls: FetchCall[] = [];
let responder: () => Response | Promise<Response> = () => {
  throw new Error("no responder");
};
const fetchStub = async (url: string, init: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => {
  calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  if (init.signal?.aborted) {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    throw abort;
  }
  return responder();
};
const stubs: Record<string, unknown> = {
  "expo-constants": { __esModule: true, default: { expoConfig: { extra: { spikeFnUrl: FN_URL } } } },
  "expo/fetch": { fetch: fetchStub },
  "@react-native-async-storage/async-storage": { __esModule: true, default: storageApi },
  "expo-crypto": { getRandomBytes: (n: number) => new Uint8Array(n).fill(7) },
};
const realLoad = nodeModule._load;
nodeModule._load = function (request: string, ...rest: unknown[]) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.call(this, request, ...rest);
};

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
const client = require("../lib/ai/carbEstimateClient") as typeof import("../lib/ai/carbEstimateClient");
const limit = require("../lib/ai/carbEstimateLimit") as typeof import("../lib/ai/carbEstimateLimit");
const consent = require("../lib/services/spikeConsent") as typeof import("../lib/services/spikeConsent");
const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };
const read = (rel: string): string => fs.readFileSync(process.cwd() + "/" + rel, "utf8");

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const GOOD = {
  items: [
    { name: "Bread", quantity: 2, unit: "slice", grams_carb: 28 },
    { name: "Egg", quantity: 1, unit: "piece", grams_carb: 0.6 },
    { name: "Milk", quantity: 1, unit: "glass", grams_carb: 12 },
  ],
  total_grams_carb: 40.6,
  filtered: false,
  usage: { model: "x", input_tokens: 1, output_tokens: 1 },
};

function requestAndMapping(): void {
  section("A. request and response mapping");
  eq("text is trimmed and whitespace collapsed", client.prepareMealText("  2 slices   of\nbread "), "2 slices of bread");
  eq("empty text cannot be sent", client.prepareMealText("   "), null);
  eq("300 characters pass", client.prepareMealText("a".repeat(300)) !== null, true);
  eq("301 characters do not", client.prepareMealText("a".repeat(301)), null);
  eq("emoji count as one character each", client.prepareMealText("🍞".repeat(300)) !== null, true);
  eq("request body", client.buildRequestBody("bread", "de-DE-x", "pro"), { mode: "carb_estimate", locale: "de-DE", tier: "pro", text: "bread" });
  eq("empty locale falls back to en", client.buildRequestBody("bread", "", "free").locale, "en");

  eq("daily_limit_carb -> limit", client.mapServerError(429, "daily_limit_carb"), "limit");
  eq("rate_limit -> busy", client.mapServerError(429, "rate_limit"), "busy");
  eq("capacity -> busy", client.mapServerError(429, "capacity"), "busy");
  eq("an unnamed 429 -> busy", client.mapServerError(429, undefined), "busy");
  eq("estimate_failed -> failed", client.mapServerError(502, "estimate_failed"), "failed");
  eq("upstream -> failed", client.mapServerError(502, "upstream"), "failed");
  eq("unavailable -> failed", client.mapServerError(503, "unavailable"), "failed");
  eq("bad_request -> input", client.mapServerError(400, "bad_request"), "input");
  eq("an unknown id -> failed", client.mapServerError(500, "boom"), "failed");

  const parsed = client.parseEstimateBody(GOOD);
  eq("three items", parsed.items.length, 3);
  eq("total is the sum of the items", parsed.total_grams_carb, 40.6);
  eq("not filtered", parsed.filtered, false);
  const dirty = client.parseEstimateBody({
    items: [
      { name: "", quantity: 1, unit: "g", grams_carb: 5 },
      { name: "A", quantity: "x", unit: 3, grams_carb: 9999 },
      { name: "B", quantity: 1, unit: "g", grams_carb: -4 },
      { name: "C", quantity: 1, unit: "g", grams_carb: null },
      null,
      { name: "D", quantity: -2, unit: "g", grams_carb: 10 },
    ],
  });
  eq("only usable items survive", dirty.items.map((i) => i.name), ["A", "B", "D"]);
  eq("grams are capped at 500 and floored at 0", dirty.items.map((i) => i.grams_carb), [500, 0, 10]);
  eq("a bad quantity becomes 1, a negative one 0", dirty.items.map((i) => i.quantity), [1, 1, 0]);
  eq("a non-string unit is empty", dirty.items[0].unit, "");
  const many = client.parseEstimateBody({ items: Array.from({ length: 20 }, (_, i) => ({ name: `f${i}`, quantity: 1, unit: "g", grams_carb: 1 })) });
  eq("at most 12 items", many.items.length, 12);
  const empty = client.parseEstimateBody({ items: [], filtered: true });
  eq("filtered stays filtered with no items", [empty.filtered, empty.items.length, empty.total_grams_carb], [true, 0, 0]);
  eq("no items at all counts as filtered", client.parseEstimateBody({ items: [], filtered: false }).filtered, true);
  let threw = "";
  try {
    client.parseEstimateBody("nope");
  } catch (e) {
    threw = client.carbErrorCode(e);
  }
  eq("a non-object body is a failure", threw, "failed");
}

async function consentGate(): Promise<void> {
  section("B. consent version and the gate");
  store.clear();
  calls.length = 0;
  responder = () => json(200, GOOD);
  eq("fresh install: no consent", await consent.hasSpikeConsent(), false);
  const code = async (): Promise<string> => {
    try {
      await client.estimateCarbs({ text: "bread", locale: "en", tier: "free" });
      return "sent";
    } catch (e) {
      return client.carbErrorCode(e);
    }
  };
  eq("no consent: consent_required", await code(), "consent_required");
  eq("and no request left the device", calls.length, 0);

  store.set("zerospike.spikeConsent", "true");
  eq("a v1 consent (no version) no longer counts", await consent.hasSpikeConsent(), false);
  eq("so the text is still held back", await code(), "consent_required");
  eq("still no request", calls.length, 0);
  store.set("zerospike.spikeConsentVersion", "1");
  eq("an older version does not count either", await consent.hasSpikeConsent(), false);
  eq("the summary consent needs the current chat consent", await consent.hasSpikeContextConsent(), false);

  await consent.grantSpikeConsent();
  eq("granting stores the current version", store.get("zerospike.spikeConsentVersion"), String(consent.SPIKE_CONSENT_VERSION));
  eq("the version is 2", consent.SPIKE_CONSENT_VERSION, 2);
  eq("granted: consent stands", await consent.hasSpikeConsent(), true);
  eq("granted: the text goes", await code(), "sent");
  eq("one request", calls.length, 1);
  await consent.withdrawSpikeConsent();
  eq("withdrawing clears the version", store.has("zerospike.spikeConsentVersion"), false);
  eq("and the flag", await consent.hasSpikeConsent(), false);
}

async function requests(): Promise<void> {
  section("C. the request on the wire and the error mapping");
  store.clear();
  await consent.grantSpikeConsent();
  calls.length = 0;
  responder = () => json(200, GOOD);
  const result = await client.estimateCarbs({ text: " 2 slices of bread ", locale: "tr", tier: "free" });
  eq("POST to the function url", calls[0].url, FN_URL);
  eq("device id header", typeof calls[0].headers["x-device-id"] === "string" && calls[0].headers["x-device-id"].length > 0, true);
  eq("body", calls[0].body, { mode: "carb_estimate", locale: "tr", tier: "free", text: "2 slices of bread" });
  eq("nothing else in the body", Object.keys(calls[0].body).sort(), ["locale", "mode", "text", "tier"]);
  eq("items parsed", result.items.length, 3);

  const run = async (): Promise<string> => {
    try {
      await client.estimateCarbs({ text: "bread", locale: "en", tier: "free" });
      return "ok";
    } catch (e) {
      return client.carbErrorCode(e);
    }
  };
  responder = () => json(429, { error: "daily_limit_carb" });
  eq("429 daily_limit_carb", await run(), "limit");
  responder = () => json(429, { error: "rate_limit" });
  eq("429 rate_limit", await run(), "busy");
  responder = () => json(502, { error: "estimate_failed" });
  eq("502", await run(), "failed");
  const chargedOf = async (): Promise<boolean> => {
    try {
      await client.estimateCarbs({ text: "bread", locale: "en", tier: "free" });
      return false;
    } catch (e) {
      return client.carbErrorCharged(e);
    }
  };
  responder = () => json(502, { error: "estimate_failed", charged: true });
  eq("502 with charged:true is charged", await chargedOf(), true);
  responder = () => json(502, { error: "estimate_failed" });
  eq("502 without the flag is not charged", await chargedOf(), false);
  responder = () => json(502, { error: "estimate_failed", charged: "yes" });
  eq("a non-boolean charged is not charged", await chargedOf(), false);
  responder = () => json(429, { error: "rate_limit", charged: false });
  eq("charged:false is not charged", await chargedOf(), false);
  eq("deviceId fallback matches the server pattern", /^[A-Za-z0-9_-]{8,80}$/.test(require("../lib/identity/deviceId").DEVICE_ID_FALLBACK), true);
  responder = () => json(503, { error: "unavailable" });
  eq("503", await run(), "failed");
  responder = () => json(400, { error: "bad_request" });
  eq("400", await run(), "input");
  responder = () => new Response("<html>", { status: 500 });
  eq("a non-JSON error body", await run(), "failed");
  responder = () => {
    throw new Error("network down");
  };
  eq("a network failure", await run(), "failed");
  responder = () => json(200, { items: [], total_grams_carb: 0, filtered: true });
  const filtered = await client.estimateCarbs({ text: "how much insulin", locale: "en", tier: "free" });
  eq("a filtered answer is returned, not thrown", [filtered.filtered, filtered.items.length], [true, 0]);

  const controller = new AbortController();
  controller.abort();
  responder = () => json(200, GOOD);
  try {
    await client.estimateCarbs({ text: "bread", locale: "en", tier: "free", signal: controller.signal });
    ok("abort throws", false);
  } catch (e) {
    eq("an aborted call is 'aborted'", client.carbErrorCode(e), "aborted");
  }
  let tooLong = "";
  calls.length = 0;
  try {
    await client.estimateCarbs({ text: "a".repeat(301), locale: "en", tier: "free" });
  } catch (e) {
    tooLong = client.carbErrorCode(e);
  }
  eq("an over-long text is 'input' and never sent", [tooLong, calls.length], ["input", 0]);
}

async function quota(): Promise<void> {
  section("D. the free daily count (UTC day)");
  eq("the typed text was never written to storage by the requests above", [...store.values()].some((v) => /bread|insulin|aaaa/i.test(v)), false);
  store.clear();
  const before = new Date("2026-10-19T23:59:59.000Z");
  const after = new Date("2026-10-20T00:00:00.000Z");
  eq("limits: free 1, pro 50", [limit.carbDailyLimit(false), limit.carbDailyLimit(true)], [1, 50]);
  eq("fresh: one left for a free user", (await limit.getCarbUsage(false, before)).remaining, 1);
  const first = await limit.noteCarbEstimate(false, before);
  eq("after one estimate: none left", [first.used, first.remaining], [1, 0]);
  eq("still none left a second before UTC midnight", (await limit.getCarbUsage(false, before)).remaining, 0);
  eq("one left again at UTC midnight", (await limit.getCarbUsage(false, after)).remaining, 1);
  const pro = await limit.getCarbUsage(true, before);
  eq("a Pro user has 49 left on the same count", [pro.limit, pro.remaining], [50, 49]);
  eq("the day key is the UTC date", limit.utcDayKey(new Date("2026-01-01T00:30:00+05:00")), "2025-12-31");
  eq("a stored count of another day is zero", limit.countForDay(JSON.stringify({ day: "2026-10-18", count: 5 }), "2026-10-19"), 0);
  eq("a corrupt value is zero", limit.countForDay("{nope", "2026-10-19"), 0);
  eq("a negative count is zero", limit.countForDay(JSON.stringify({ day: "2026-10-19", count: -3 }), "2026-10-19"), 0);
  store.clear();
  const exhausted = await limit.markCarbExhausted(true, before);
  eq("the server saying 'limit' fills the Pro tally", exhausted.remaining, 0);
  await limit.noteCarbEstimate(false, before);
  const carbKey = [...store.keys()].find((k) => k.startsWith("zerospike.carbEstimate")) as string;
  eq("the stored count holds a day and a number only", Object.keys(JSON.parse(store.get(carbKey) as string)).sort(), ["count", "day"]);
  eq("the key is device scoped, not profile scoped", [...store.keys()].every((k) => k.startsWith("zerospike.carbEstimate")), true);
}

function editing(): void {
  section("E. editing, totals, and no save without a tap");
  const items = client.editableFromEstimate(client.parseEstimateBody(GOOD).items);
  eq("rows are built from the result", items.map((i) => i.name), ["Bread", "Egg", "Milk"]);
  eq("total over the rows", client.editableTotal(items), 40.6);
  const edited = items.map((i) => (i.name === "Bread" ? { ...i, gramsText: "30,5" } : i));
  eq("an edited figure (comma decimal) moves the total", client.editableTotal(edited), 43.1);
  const cleared = items.map((i) => ({ ...i, gramsText: "abc" }));
  eq("unreadable grams are zero", client.editableTotal(cleared), 0);
  eq("a figure above 500 is capped", client.editableGrams({ ...items[0], gramsText: "900" }), 500);
  const editedLines = client.editableToEstimateLines(edited);
  const cmEdited = require("../lib/mealCompose");
  const meal = cmEdited.composeMealInput(cmEdited.addEstimateLines([], editedLines));
  eq("the journal row carries the edited total", meal.calculated_carbs_g, 43.1);
  eq("the portion stays 0, no grams of food are invented", meal.portion_g, 0);
  ok("the name lists the items", meal.custom_food_name.includes("Bread") && meal.custom_food_name.includes("Milk"), meal.custom_food_name);
  eq("insulin on the row is always 0", meal.insulin_dose_units, 0);

  eq("no result on screen: add is off", client.canAddEstimate({ resultShown: false, items: [], saving: false }), false);
  eq("a result with items: add is on", client.canAddEstimate({ resultShown: true, items, saving: false }), true);
  eq("saving in progress: add is off", client.canAddEstimate({ resultShown: true, items, saving: true }), false);
  eq("a result emptied by the user: add is off", client.canAddEstimate({ resultShown: true, items: [], saving: false }), false);
  const dash = client.editableFromEstimate([{ name: "-", quantity: 0, unit: "", grams_carb: 60 }]);
  eq("a dash-only item cannot be added", client.canAddEstimate({ resultShown: true, items: dash, saving: false }), false);
  eq("a blank-name item cannot be added", client.canAddEstimate({ resultShown: true, items: [{ ...dash[0], name: "   " }], saving: false }), false);
  eq("one named item among blanks can be added", client.canAddEstimate({ resultShown: true, items: [...dash, ...items], saving: false }), true);
  eq("hint: all named, none", client.estimateAddHint(items), null);
  eq("hint: an unnamed row is said to be left out", client.estimateAddHint([...dash, ...items]), "unnamed");
  eq("hint: an unreadable amount is named", client.estimateAddHint([{ ...items[0], gramsText: "abc" }]), "unreadable");
  const cmMixed = require("../lib/mealCompose");
  const mixed = cmMixed.composeMealInput(cmMixed.addEstimateLines([], client.editableToEstimateLines([...dash, ...items])));
  ok("the saved name has no dash and no blank piece", !mixed.custom_food_name.includes("-") && mixed.custom_food_name.startsWith("Bread"), mixed.custom_food_name);
  eq("blank-name items do not count toward the shown total", client.editableTotal([...dash, ...items]), 40.6);
  eq("the shown total equals the saved total", mixed.calculated_carbs_g, client.editableTotal([...dash, ...items]));
  const lines = client.editableToEstimateLines([...dash, ...edited]);
  eq("add-to-meal lines drop the nameless item", lines.map((l: { name: string }) => l.name), ["Bread", "Egg", "Milk"]);
  eq("add-to-meal lines carry the edited figure", lines[0].grams_carb, 30.5);
  const cm = require("../lib/mealCompose");
  const composed = cm.addEstimateLines([], lines);
  const row = cm.composeMealInput(composed);
  eq("estimate lines land in the compose list with the same total", row.calculated_carbs_g, 43.1);
  eq("and write a carb-only row: no weight, no food, no dose", [row.portion_g, row.food_id, row.insulin_dose_units, row.carbOnly], [0, null, 0, true]);
  eq("charged true is read",client.parseEstimateBody({ ...GOOD, charged: true }).charged, true);
  eq("charged missing is false", client.parseEstimateBody(GOOD).charged, false);
  eq("charged non-boolean is false", client.parseEstimateBody({ ...GOOD, charged: "yes" }).charged, false);
  eq("only an explicit charge counts locally", [
    client.shouldCountEstimate({ charged: true }),
    client.shouldCountEstimate({ charged: false }),
  ], [true, false]);
  const guard = { current: false };
  eq("first tap takes the slot, a second in the same frame does not", [client.enterGuard(guard), client.enterGuard(guard)], [true, false]);
  guard.current = false;
  eq("released slot can be taken again", client.enterGuard(guard), true);
  eq("item count bucket is a plain count", [client.itemCountBucket(3), client.itemCountBucket(99), client.itemCountBucket(-1)], [3, 12, 0]);
}

function sourcePins(): void {
  section("F. wiring pins");
  const sheet = read("components/CarbEstimateSheet.tsx");
  const clientSrc = read("lib/ai/carbEstimateClient.ts");
  const limitSrc = read("lib/ai/carbEstimateLimit.ts");
  const food = read("app/(tabs)/food.tsx");

  eq("onAdd is called in exactly one place", (sheet.match(/onAdd\(/g) ?? []).length, 1);
  ok("that place is the Add to meal button, behind canAdd, handing over estimate lines", /onPress=\{\(\) => \{\s*if \(canAdd && items\) \{\s*onAdd\(editableToEstimateLines\(items\)\);/.test(sheet));
  ok("the sheet never writes the journal itself", !/createMeal|insertMeal|saveEstimate|db\//.test(sheet));
  ok("the old Add to log key is not used", !sheet.includes('t("carbEstimate.add")'));
  ok("the result keeps cards, a fixed short note and an approx mark", sheet.includes("EstimateResultCard") && sheet.includes('t("carbEstimate.noteShort")') && sheet.includes('t("carbEstimate.addToMeal")') && sheet.includes("≈"));
  ok("the short note sits above the scrolling result, not inside it", sheet.indexOf("{top}") < sheet.indexOf("<ScrollView"));
  ok("the result arriving does not call onAdd", !/estimateCarbs\([\s\S]*?onAdd\(/.test(sheet.slice(sheet.indexOf("async function submit"), sheet.indexOf("function replaceItem"))));
  ok("the fixed note is shown on the result", sheet.includes('t("carbEstimate.noteShort")'));
  ok("food.tsx has no direct estimate save any more", !/saveEstimate/.test(food));
  ok("the estimate sheet hands its lines to the compose list", /onAdd=\{\(lines\) => \{\s*setComposeItems\(\(prev\) => addEstimateLines\(prev, lines\)\);/.test(food));
  ok("a composed meal is written through composeMealInput with insulin 0", /composeMealInput\(composeItems\)[\s\S]*insulin_dose_units: 0/.test(food));
  ok("composeMealInput writes a mixed meal carb-only (portion 0, no food)", (() => {
    const compose = require("../lib/mealCompose") as typeof import("../lib/mealCompose");
    const items = compose.addEstimateLines([], [{ name: "Simit", quantity: 1, unit: "piece", grams_carb: 48 }]);
    const input = compose.composeMealInput(items);
    return input.carbOnly === true && input.portion_g === 0 && input.food_id === null && input.insulin_dose_units === 0;
  })());
  ok("a mixed meal with a catalogue food and an estimate line is carb-only too", (() => {
    const compose = require("../lib/mealCompose") as typeof import("../lib/mealCompose");
    const base = compose.addComposeItem([], { key: "f1", food_id: "f1", name: "Bread", category: "bread", carb_100g: 50, portion_g: 40 });
    const input = compose.composeMealInput(compose.addEstimateLines(base, [{ name: "Tea", quantity: 1, unit: "glass", grams_carb: 8 }]));
    return input.carbOnly === true && input.portion_g === 0 && input.calculated_carbs_g === 28;
  })());
  ok("a saved mixed meal reopens carb-only (mealEditMode), never in the calculator", (() => {
    const compose = require("../lib/mealCompose") as typeof import("../lib/mealCompose");
    const route = require("../lib/mealRoute") as typeof import("../lib/mealRoute");
    const base = compose.addComposeItem([], { key: "f1", food_id: "f1", name: "Bread", category: "bread", carb_100g: 50, portion_g: 40 });
    const input = compose.composeMealInput(compose.addEstimateLines(base, [{ name: "Tea", quantity: 1, unit: "glass", grams_carb: 8 }]));
    return route.mealEditMode({ food_id: input.food_id, portion_g: input.portion_g, calculated_carbs_g: input.calculated_carbs_g }) === "carbOnly";
  })());
  ok("the estimate button is no longer a separate pill on the food tab", !/setEstimateSource\("food_tab"\);\s*\}\}\s*accessibilityRole/.test(food));
  ok("the sheet opens the estimate from inside (onEstimate)", /onEstimate=\{carbEstimateConfigured \? \(\) => setEstimateSource\("meal_sheet"\)/.test(food));
  ok("the capture scenes need screenshot mode AND __DEV__", /isScreenshotMode\(\) && __DEV__ && scScene === "carbs"/.test(food) && /isScreenshotMode\(\) && __DEV__ && scScene === "estimate"/.test(food));
  ok("consent: agree checkbox, accept disabled until agreed, guard inside accept", /async function accept\(\) \{\s*if \(!agreed\) return;/.test(sheet) && /label=\{t\("spike\.accept"\)\} disabled=\{!agreed\}/.test(sheet) && /accessibilityRole="checkbox"/.test(sheet) && sheet.includes('t("spike.consentAgree")'));
  ok("consent: short lines and a details toggle, same keys as the Spike screen", ["consentShort1", "consentShort2", "consentShort3", "consentDetails"].every((k) => sheet.includes(`t("spike.${k}")`)));
  ok("consent: the grant call and the consent version are unchanged", sheet.includes("await grantSpikeConsent();") && read("lib/services/spikeConsent.ts").includes("SPIKE_CONSENT_VERSION = 2"));
  ok("no AsyncStorage use in the sheet", !/AsyncStorage/.test(sheet));
  ok("no logging of the text anywhere", !/console\.|logCrash/.test(sheet + clientSrc));
  ok("food.tsx crash context has no text", /logCrash\(err, \{ screen: "food", save: "compose" \}\)/.test(food));
  ok("no adjustsFontSizeToFit in the new UI", !/adjustsFontSizeToFit/.test(sheet));
  ok("no hard-coded colour in the sheet (the scrim is the shared SCRIM)", (sheet.match(/#[0-9a-fA-F]{3,8}\b|rgba\(/g) ?? []).length === 0);
  const emDash = String.fromCharCode(0x2014);
  ok("no em dash in the new files", ![sheet, clientSrc, limitSrc].some((s) => s.includes(emDash)));
  const events = require("../lib/analytics/eventSchema").EVENT_SCHEMA as Record<string, Record<string, unknown>>;
  ok("the schema holds the two carb events", !!events.carb_estimate_used && !!events.carb_estimate_blocked);
  ok("their fields carry no text or grams", ["carb_estimate_used", "carb_estimate_blocked"].every((e) => Object.keys(events[e]).every((f) => !/grams|text/i.test(f))));
  ok("the consent screen shows the carb paragraph", read("app/spike.tsx").includes('t("spike.consentCarb")'));
}

function locales(): void {
  section("G. nine languages");
  const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  const keys = ["title", "help", "placeholder", "submit", "estimating", "edit", "note", "noteShort", "addToMeal", "approx", "errorLimit", "errorBusy", "errorFailed", "errorInput", "errorNoFood", "entryButton", "proNudge", "itemName", "itemQuantity", "itemUnit", "itemCarbs"];
  const dose = /doz|dose|dosis|dosi\b|dosage|جرعة|投与/i;
  for (const lang of langs) {
    const loc = require(`../lib/i18n/locales/${lang}`).default as { carbEstimate: Record<string, string>; spike: Record<string, string> };
    ok(`${lang}: every carbEstimate key exists`, keys.every((k) => typeof loc.carbEstimate[k] === "string" && loc.carbEstimate[k].length > 0));
    ok(`${lang}: spike.consentCarb exists`, typeof loc.spike.consentCarb === "string" && loc.spike.consentCarb.length > 20);
    ok(`${lang}: the dose word appears only in the fixed note`, keys.filter((k) => k !== "note" && k !== "noteShort").every((k) => !dose.test(loc.carbEstimate[k])) && !dose.test(loc.spike.consentCarb));
    ok(`${lang}: the fixed note says it is not a dose`, dose.test(loc.carbEstimate.note) && dose.test(loc.carbEstimate.noteShort));
    ok(`${lang}: the old add-to-log key is gone`, !("add" in loc.carbEstimate));
    ok(`${lang}: no dash punctuation, no percent sign`, [...keys.map((k) => loc.carbEstimate[k]), loc.spike.consentCarb].every((v) => !/[%–—]/.test(v)));
  }
  const tr = require("../lib/i18n/locales/tr").default.carbEstimate as Record<string, string>;
  const en = require("../lib/i18n/locales/en").default.carbEstimate as Record<string, string>;
  eq("tr note is the approved text", tr.note, "Besin bilgisi tahminidir, doz değildir. Doğruluğunu siz kontrol edin.");
  ok("tr errorNoFood uses the plural 'çıkaramadık'", tr.errorNoFood.includes("çıkaramadık") && !tr.errorNoFood.includes("çıkaramadım"));
  ok("en errorNoFood starts 'We could not'", en.errorNoFood.startsWith("We could not"));
}

async function screenshotSample(): Promise<void> {
  section("screenshot sample");
  const env = (process as unknown as { env: Record<string, string | undefined> }).env;
  const saved = env.EXPO_PUBLIC_SCREENSHOT_MODE;
  delete env.EXPO_PUBLIC_SCREENSHOT_MODE;
  eq("no sample without the capture flag", client.screenshotCarbSample("tr"), null);
  calls.length = 0;
  let threw = false;
  try {
    await client.estimateCarbs({ text: "x", locale: "tr", tier: "free" });
  } catch {
    threw = true;
  }
  ok("outside screenshot mode estimateCarbs never answers from the sample", threw || calls.length > 0);
  env.EXPO_PUBLIC_SCREENSHOT_MODE = "1";
  const sample = client.screenshotCarbSample("tr");
  eq("sample total recomputed", sample?.estimate.total_grams_carb, 63.1);
  eq("tr sample is the local breakfast", sample?.estimate.items.map((i) => i.name), ["Simit", "Beyaz peynir", "Çay"]);
  const expected: Record<string, string[]> = {
    en: ["Toast", "Egg", "Milk"],
    de: ["Brötchen", "Gouda", "Filterkaffee"],
    fr: ["Baguette", "Camembert", "Café au lait"],
    es: ["Pan blanco", "Huevo", "Zumo de naranja"],
    it: ["Ciabatta", "Mozzarella", "Cappuccino"],
    pt: ["Pão francês", "Ovo cozido", "Suco de laranja"],
    ar: ["خبز بيتا", "حمص", "قهوة عربية"],
    ja: ["おにぎり", "味噌汁", "緑茶"],
  };
  for (const [l, names] of Object.entries(expected)) {
    const s = client.screenshotCarbSample(l);
    eq(`${l} sample items are the local scene`, s?.estimate.items.map((i) => i.name), names);
    ok(`${l} sample text names the foods and amounts`, !!s && s.text.length > 0 && s.estimate.items.every((i) => i.quantity > 0 && i.unit.length > 0 && i.grams_carb >= 0));
    eq(`${l} sample total is the item sum`, s?.estimate.total_grams_carb, Math.round((s?.estimate.items.reduce((a, i) => a + i.grams_carb, 0) ?? 0) * 10) / 10);
  }
  eq("flag on: no network", (await client.estimateCarbs({ text: "x", locale: "de", tier: "free" })).items.length, 3);
  eq("flag on: no request sent", calls.length, 0);
  for (const l of ["tr", "en", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
    ok(`sample ${l}`, (client.screenshotCarbSample(l)?.estimate.items.length ?? 0) === 3);
  }
  if (saved === undefined) delete env.EXPO_PUBLIC_SCREENSHOT_MODE;
  else env.EXPO_PUBLIC_SCREENSHOT_MODE = saved;
}

(async () => {
  requestAndMapping();
  await screenshotSample();
  await consentGate();
  await requests();
  await quota();
  editing();
  sourcePins();
  locales();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.log(`\nharness crashed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
