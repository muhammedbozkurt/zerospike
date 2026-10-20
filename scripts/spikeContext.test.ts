/**
 * Spike AI client v2 harness: the 14-day context packet (what it holds, what it
 * must never hold), the second consent, and the request/stream protocol.
 * Standalone and dependency-free, compile + run with node:
 *
 *   npx tsc scripts/spikeContext.test.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --strict --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution node --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/spikeContext.test.js
 *
 * The packet builder is pure and runs on fixed rows (manual + Health mixed).
 * spikeClient/spikeConsent import Expo modules, so this harness registers
 * in-memory stand-ins for expo-constants, expo/fetch, AsyncStorage and
 * expo-crypto before it loads them, then drives askSpike against a fake fetch.
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare const require: {
  (id: string): any;
  resolve(id: string): string;
  cache: Record<string, unknown>;
};

import type { Injection, InjectionSite, LogTag, MealLog, PeriodTag, SugarLog, UserProfile } from "../lib/db/types";
import type { ContextPacket, SpikeContextSource } from "../lib/ai/spikeContext";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
/** Order-insensitive structural equality (object keys sorted). */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );
}
function same(name: string, actual: unknown, expected: unknown): void {
  ok(name, stable(actual) === stable(expected), `got ${stable(actual)}, want ${stable(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Module stand-ins (before anything imports them) ────────────────────────
const nodeModule = require("module");
const FN_URL = "https://example.test/functions/v1/ai-ask-spike";
const store = new Map<string, string>();
let removeFails = false;
let storageThrows = false;
const storageApi = {
  getItem: async (k: string): Promise<string | null> => {
    if (storageThrows) throw new Error("storage down");
    return store.has(k) ? (store.get(k) as string) : null;
  },
  setItem: async (k: string, v: string): Promise<void> => {
    if (storageThrows) throw new Error("storage down");
    store.set(k, v);
  },
  removeItem: async (k: string): Promise<void> => {
    if (storageThrows || removeFails) throw new Error("storage down");
    store.delete(k);
  },
};

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
const calls: FetchCall[] = [];
type Responder = (call: FetchCall) => Response | Promise<Response>;
let responder: Responder = () => {
  throw new Error("no responder set");
};
const fetchStub = async (
  url: string,
  init: { headers: Record<string, string>; body: string; signal?: AbortSignal }
): Promise<Response> => {
  const call: FetchCall = {
    url,
    headers: init.headers,
    body: JSON.parse(init.body) as Record<string, unknown>,
    signal: init.signal,
  };
  calls.push(call);
  if (init.signal?.aborted) {
    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    throw abort;
  }
  return responder(call);
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

const ctx = require("../lib/ai/spikeContext") as typeof import("../lib/ai/spikeContext");
const client = require("../lib/ai/spikeClient") as typeof import("../lib/ai/spikeClient");
const consent = require("../lib/services/spikeConsent") as typeof import("../lib/services/spikeConsent");

const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};
const nodePath = require("path") as { join: (...parts: string[]) => string; dirname: (p: string) => string };
// The compiled copy may sit anywhere (.tmp inside the repo, or a scratch dir
// outside it), so the repo is found by walking up, then from the working dir.
const root = ((): string => {
  const isRepo = (dir: string): boolean =>
    fs.existsSync(nodePath.join(dir, "package.json")) && fs.existsSync(nodePath.join(dir, "lib", "ai", "spikeClient.ts"));
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (isRepo(dir)) return dir;
    dir = nodePath.dirname(dir);
  }
  if (isRepo(process.cwd())) return process.cwd();
  throw new Error("could not locate the repo root from " + __dirname);
})();
const read = (rel: string): string => fs.readFileSync(nodePath.join(root, rel), "utf8");

// ── Fixed rows ──────────────────────────────────────────────────────────────
// Local noon, mid-July: no clock change falls inside any window used here, so
// local-day counts do not depend on the machine's timezone.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();
function at(daysAgo: number, hour = 9, minute = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
const localMidnight = (daysAgo: number): number => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
};

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "p1",
    name: "Ada Lovelace",
    insulin_sensitivity_factor: 41.9,
    carb_ratio_breakfast: 9.1,
    carb_ratio_lunch: 11.1,
    carb_ratio_dinner: 12.1,
    target_fasting_min: 70,
    target_fasting_max: 100,
    target_postmeal_min: 80,
    target_postmeal_max: 180,
    hypo_threshold_mgdl: 70,
    daily_carb_target_g: 200,
    daily_carb_target_min_g: 160,
    glucose_unit: "mgdl",
    diabetes_type: "type1",
    insulin_mode: "both",
    ratios_confirmed: 1,
    basal_daily_units: 23.7,
    basal_insulin_id: "lantus-x",
    bolus_insulin_id: "novolog-x",
    basal_insulin_other: null,
    bolus_insulin_other: null,
    oral_meds_enabled: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function sugar(daysAgo: number, hour: number, mgdl: number, period: PeriodTag, over: Partial<SugarLog> = {}): SugarLog {
  return {
    id: `sugar-row-${daysAgo}-${hour}-${mgdl}`,
    profile_id: "p1",
    glucose_level_mgdl: mgdl,
    period_tag: period,
    source: "manual",
    logged_at: at(daysAgo, hour),
    tags: [],
    healthkit_uuid: null,
    ...over,
  };
}
function meal(daysAgo: number, hour: number, tags: LogTag[] = [], over: Partial<MealLog> = {}): MealLog {
  return {
    id: `meal-row-${daysAgo}-${hour}`,
    profile_id: "p1",
    sugar_log_id: null,
    food_id: null,
    custom_food_name: "Grandma's cake",
    portion_g: 120,
    calculated_carbs_g: 55,
    insulin_dose_units: 4.7,
    photo_uri_local: "file:///private/photo.jpg",
    personal_note: "felt dizzy",
    logged_at: at(daysAgo, hour),
    tags,
    meal_template_id: null,
    ...over,
  };
}
function shot(daysAgo: number, hour: number, site: InjectionSite | null, over: Partial<Injection> = {}): Injection {
  return {
    id: `inj-row-${daysAgo}-${hour}`,
    profile_id: "p1",
    site,
    site_point: 2,
    dose_units: 17.3,
    insulin_type: "bolus",
    bolus_kind: "meal",
    insulin_product_id: "novolog-x",
    insulin_product_other: null,
    meal_log_id: null,
    note: "secret note",
    source: "manual",
    logged_at: at(daysAgo, hour),
    tags: [],
    ...over,
  };
}

// Manual readings inside the 14 local days (today = day 0 ... day 13):
//   100 fasting, 190 post, 65 fasting, 150 bedtime, 120 pre, 130 manual-tag,
//   85 fasting, 140 unset, 110 fasting      -> 9 readings, mean 121.1
const MANUAL_SUGAR: SugarLog[] = [
  sugar(0, 8, 100, "fasting"),
  sugar(0, 11, 190, "post_meal_2h"),
  sugar(1, 7, 65, "fasting"),
  sugar(1, 20, 150, "bedtime"),
  sugar(2, 12, 120, "pre_meal"),
  sugar(2, 18, 130, "manual"),
  sugar(4, 9, 85, "fasting"),
  sugar(6, 21, 140, "unset"),
  sugar(13, 10, 110, "fasting"),
];
// Outside the window: the evening before the first day.
const OLD_SUGAR = sugar(14, 23, 300, "manual");
// Health imports. Day 3 has NOTHING but Health rows; one row even carries a
// guessed "fasting" tag, the way an old import did.
const HEALTH_SUGAR: SugarLog[] = [
  sugar(0, 6, 40, "unset", { source: "health", healthkit_uuid: "hk-1" }),
  sugar(1, 10, 300, "unset", { source: "health", healthkit_uuid: "hk-2" }),
  sugar(3, 15, 200, "unset", { source: "health", healthkit_uuid: "hk-3" }),
  sugar(5, 7, 33, "fasting", { source: "health", healthkit_uuid: "hk-4" }),
  sugar(6, 22, 99, "bedtime", { source: "health", healthkit_uuid: "hk-5" }),
];
const ALL_SUGAR: SugarLog[] = [...HEALTH_SUGAR, OLD_SUGAR, ...MANUAL_SUGAR];

const MEALS: MealLog[] = [
  meal(0, 8, ["sport"]),
  meal(1, 13, ["sport", "stress"]),
  meal(5, 19, []),
  meal(15, 12, ["alcohol"]), // outside the window
];
const INJECTIONS: Injection[] = [
  shot(0, 8, "abdomen_left"),
  shot(1, 8, "abdomen_left_upper"), // retired quadrant folds into abdomen_left
  shot(1, 13, null, { source: "calculator" }), // mealtime bolus, no region
  shot(2, 22, "arm_left", { source: "reminder", insulin_type: "basal", bolus_kind: null }),
  shot(4, 8, "thigh_left", { source: "health" }), // not a thing the schema produces; must still be excluded
  shot(20, 8, "arm_right"), // outside the window
];

const P = profile();
const build = (over: Partial<Parameters<typeof ctx.buildContextPacket>[0]> = {}): ContextPacket =>
  ctx.buildContextPacket({
    profile: P,
    sugar: ALL_SUGAR,
    meals: MEALS,
    injections: INJECTIONS,
    now: NOW,
    ...over,
  });

// ── A. The packet for the fixed rows ───────────────────────────────────────
section("A. packet content on manual + Health mixed rows");
const packet = build();
same("exact packet", packet, {
  v: 1,
  days: 14,
  unit: "mgdl",
  profile: { diabetes: "type1", treatment: "insulin", target: { low: 70, high: 180 } },
  glucose: {
    readings: 9,
    avg: 121,
    inRangePct: 78,
    lowCount: 1,
    highCount: 1,
    perDay: 0.6,
    byPeriod: {
      fasting: { n: 4, avg: 90 },
      preMeal: { n: 1, avg: null },
      postMeal: { n: 1, avg: null },
      bedtime: { n: 1, avg: null },
    },
  },
  meals: { count: 3, tags: { sport: 2, stress: 1 } },
  injections: { count: 4, sites: { abdomen_left: 2, arm_left: 1 } },
  logging: { daysWithLogs: 7, emptyPeriods: [], streakDays: 3 },
});
eq("it validates", ctx.validateContextPacket(packet).length, 0);
ok("it type-guards", ctx.isValidContextPacket(packet));

section("B. Health rows never reach the packet");
const withoutHealth = build({ sugar: [OLD_SUGAR, ...MANUAL_SUGAR] });
same("adding the Health rows changes nothing", packet, withoutHealth);
const healthOnly = build({ sugar: HEALTH_SUGAR, meals: [], injections: [] });
eq("Health-only: no readings", healthOnly.glucose.readings, 0);
eq("Health-only: no average", healthOnly.glucose.avg, null);
eq("Health-only: no in-range figure", healthOnly.glucose.inRangePct, null);
eq("Health-only: no log days (a Health day is not a logged day)", healthOnly.logging.daysWithLogs, 0);
eq("Health-only: no streak", healthOnly.logging.streakDays, 0);
same("Health-only: every period is empty", healthOnly.logging.emptyPeriods, ["fasting", "preMeal", "postMeal", "bedtime"]);
eq("Health-only: fasting n ignores the guessed tag", healthOnly.glucose.byPeriod.fasting.n, 0);
eq("Health-only packet still validates", ctx.validateContextPacket(healthOnly).length, 0);
ok("the fixture does carry out-of-band Health rows (so the check has teeth)",
  HEALTH_SUGAR.some((r) => r.glucose_level_mgdl < 70) && HEALTH_SUGAR.some((r) => r.glucose_level_mgdl > 250));
const noteHealthLow = build({ sugar: [...MANUAL_SUGAR, ...HEALTH_SUGAR] }).glucose.lowCount;
eq("low count is manual-only (a Health 40 and 33 are not counted)", noteHealthLow, 1);
const unknownSource = build({ sugar: [sugar(0, 9, 55, "fasting", { source: "cgm" })], meals: [], injections: [] });
eq("an unknown source is excluded like Health (allowlist, not blocklist)", unknownSource.glucose.readings, 0);
const hiddenInj = build({ sugar: [], meals: [], injections: [shot(0, 8, "thigh_left", { source: "health" })] });
eq("a Health-source injection is excluded", hiddenInj.injections.count, 0);
const calcInj = build({ sugar: [], meals: [], injections: [shot(0, 8, null, { source: "calculator" })] });
eq("the calculator's own bolus row counts as an injection", calcInj.injections.count, 1);

section("C. nothing identifying, nothing raw, no timestamps");
const json = JSON.stringify(packet);
for (const leak of ["Grandma", "felt dizzy", "secret note", "photo.jpg", "Ada", "Lovelace", "17.3", "23.7", "4.7", "41.9", "lantus", "novolog", "hk-", "-row-"]) {
  ok(`no "${leak}" in the packet`, !json.includes(leak));
}
ok("no ISO date", !/\d{4}-\d{2}-\d{2}/.test(json));
ok("no clock time", !/\d{1,2}:\d{2}/.test(json));
ok("no uuid-like id", !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(json));
const forbiddenKeys = new Set(["id", "name", "note", "dose", "dose_units", "units", "logged_at", "time", "timestamp", "date", "source", "healthkit_uuid", "personal_note", "custom_food_name", "photo_uri_local", "readingsList", "values"]);
const keysSeen: string[] = [];
(function walk(v: unknown): void {
  if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      keysSeen.push(k);
      walk(x);
    }
  }
})(packet);
ok("no forbidden key anywhere", keysSeen.every((k) => !forbiddenKeys.has(k)), keysSeen.filter((k) => forbiddenKeys.has(k)).join(","));
ok("every array in the packet holds period names only", (packet.logging.emptyPeriods as string[]).every((p) => ctx.PERIOD_KEYS.includes(p as never)));

section("D. window: 14 local calendar days, today included");
const edge = (iso: string): SugarLog[] => [{ ...sugar(0, 9, 100, "fasting"), logged_at: iso }, { ...sugar(0, 9, 110, "fasting"), logged_at: iso }];
const startMs = localMidnight(13);
eq("first instant of day 13 is inside", build({ sugar: edge(new Date(startMs).toISOString()), meals: [], injections: [] }).glucose.readings, 2);
eq("one millisecond earlier is outside", build({ sugar: edge(new Date(startMs - 1).toISOString()), meals: [], injections: [] }).glucose.readings, 0);
eq("a row after `now` is outside", build({ sugar: edge(new Date(NOW + 3_600_000).toISOString()), meals: [], injections: [] }).glucose.readings, 0);
eq("an unparsable date is dropped", build({ sugar: edge("not a date"), meals: [], injections: [] }).glucose.readings, 0);
const oneDay = build({ days: 1 });
eq("days=1 keeps today only", oneDay.glucose.readings, 2);
eq("days=1 reports days:1", oneDay.days, 1);
eq("days above 14 are clamped to 14", build({ days: 30 }).days, 14);
eq("days below 1 are clamped to 1", build({ days: 0 }).days, 1);
eq("daysWithLogs never exceeds the window", build({ days: 3 }).logging.daysWithLogs <= 3, true);

section("E. unit, target, profile mapping");
const mmol = build({ profile: profile({ glucose_unit: "mmol" }) });
eq("mmol: unit", mmol.unit, "mmol");
eq("mmol: avg is converted (121.1 mg/dL)", mmol.glucose.avg, 6.7);
eq("mmol: target low", mmol.profile.target.low, 3.9);
eq("mmol: target high", mmol.profile.target.high, 10);
eq("mmol: period avg", mmol.glucose.byPeriod.fasting.avg, 5);
eq("mmol: counts and percentages do not change with the unit", stable([mmol.glucose.readings, mmol.glucose.inRangePct, mmol.glucose.lowCount, mmol.glucose.highCount]), stable([9, 78, 1, 1]));
eq("mmol packet validates", ctx.validateContextPacket(mmol).length, 0);
eq("an unknown unit string falls back to mgdl", build({ profile: profile({ glucose_unit: "x" as never }) }).unit, "mgdl");
const wide = build({ profile: profile({ target_fasting_min: 60, target_postmeal_max: 300 }) });
same("target follows the profile's own range", wide.profile.target, { low: 60, high: 300 });
eq("a wider band changes in-range", wide.glucose.inRangePct, 100);
eq("a wider band changes the high count", wide.glucose.highCount, 0);
eq("a reversed band falls back to the default band", build({ profile: profile({ target_fasting_min: 200, target_postmeal_max: 100 }) }).profile.target.high, 180);
const diabetesCases: [string, string][] = [["type1", "type1"], ["type2", "type2"], ["gestational", "gestational"], ["prediabetes", "prediabetes"], ["none", "none"], ["unknown", "unknown"], ["???", "unknown"]];
for (const [given, want] of diabetesCases) {
  eq(`diabetes_type ${given} -> ${want}`, build({ profile: profile({ diabetes_type: given as never }) }).profile.diabetes, want);
}
eq("insulin mode both -> insulin", build({ profile: profile({ insulin_mode: "both" }) }).profile.treatment, "insulin");
eq("insulin mode basal -> insulin", build({ profile: profile({ insulin_mode: "basal" }) }).profile.treatment, "insulin");
eq("insulin mode bolus -> insulin", build({ profile: profile({ insulin_mode: "bolus" }) }).profile.treatment, "insulin");
eq("no insulin + oral meds -> pills", build({ profile: profile({ insulin_mode: "none", oral_meds_enabled: 1 }) }).profile.treatment, "pills");
eq("no insulin, no oral meds -> none", build({ profile: profile({ insulin_mode: "none", oral_meds_enabled: 0 }) }).profile.treatment, "none");
eq("insulin wins over oral meds", build({ profile: profile({ insulin_mode: "both", oral_meds_enabled: 1 }) }).profile.treatment, "insulin");

section("F. averages are withheld for a single reading");
const single = build({ sugar: [sugar(0, 9, 143, "fasting")], meals: [], injections: [] });
eq("one reading: no overall average", single.glucose.avg, null);
eq("one reading: no period average", single.glucose.byPeriod.fasting.avg, null);
eq("one reading: the count is still reported", single.glucose.readings, 1);
ok("one reading: the value 143 appears nowhere", !JSON.stringify(single).includes("143"));
const pair = build({ sugar: [sugar(0, 9, 100, "fasting"), sugar(0, 10, 140, "fasting")], meals: [], injections: [] });
eq("two readings: average is reported", pair.glucose.avg, 120);
eq("two readings: period average is reported", pair.glucose.byPeriod.fasting.avg, 120);
eq("single-reading packet validates", ctx.validateContextPacket(single).length, 0);

section("F2. one reading left outside the period averages: the overall average goes with it");
// 100 and 120 fasting plus 247 at bedtime: readings x overall average minus the fasting sum would give 247 back.
const rows3 = [sugar(0, 7, 100, "fasting"), sugar(0, 8, 120, "fasting"), sugar(1, 21, 247, "bedtime")];
const leak = build({ sugar: rows3, meals: [], injections: [] });
eq("two + one: the overall average is withheld", leak.glucose.avg, null);
eq("two + one: the fasting average is still shown", leak.glucose.byPeriod.fasting.avg, 110);
eq("two + one: the counts are still reported", stable([leak.glucose.readings, leak.glucose.byPeriod.bedtime.n]), stable([3, 1]));
ok("two + one: the value 247 appears nowhere", !JSON.stringify(leak).includes("247"));
eq("two + one: the packet validates", ctx.validateContextPacket(leak).length, 0);
const leakMmol = build({ profile: profile({ glucose_unit: "mmol" }), sugar: rows3, meals: [], injections: [] });
eq("two + one in mmol: withheld as well", leakMmol.glucose.avg, null);
const noPeriod = build({ sugar: [sugar(0, 7, 100, "fasting"), sugar(0, 8, 120, "fasting"), sugar(0, 12, 190, "manual")], meals: [], injections: [] });
eq("a reading with no period is left over too", noPeriod.glucose.avg, null);
const fourOne = build({ sugar: [sugar(0, 7, 100, "fasting"), sugar(0, 8, 120, "fasting"), sugar(0, 9, 140, "fasting"), sugar(1, 21, 200, "bedtime")], meals: [], injections: [] });
eq("three + one: withheld", fourOne.glucose.avg, null);
const twoLeft = build({ sugar: [...rows3, sugar(0, 12, 130, "pre_meal")], meals: [], injections: [] });
eq("two left over: shown, it is a mean of two readings", twoLeft.glucose.avg, 149);
eq("two left over: the packet validates", ctx.validateContextPacket(twoLeft).length, 0);
const singles = build({ sugar: [sugar(0, 7, 100, "fasting"), sugar(1, 21, 140, "bedtime")], meals: [], injections: [] });
eq("two single-reading periods: shown (nothing but a mean of two)", singles.glucose.avg, 120);
eq("two single-reading periods: the packet validates", ctx.validateContextPacket(singles).length, 0);
const nothingLeft = build({ sugar: [sugar(0, 7, 100, "fasting"), sugar(0, 8, 120, "fasting"), sugar(0, 9, 140, "fasting")], meals: [], injections: [] });
eq("every reading inside a shown period: shown", nothingLeft.glucose.avg, 120);

section("G. logging pattern");
const fastingOnly = build({ sugar: [sugar(0, 8, 100, "fasting"), sugar(1, 8, 110, "fasting")], meals: [], injections: [] });
same("empty periods are the ones with no reading", fastingOnly.logging.emptyPeriods, ["preMeal", "postMeal", "bedtime"]);
eq("two consecutive days: streak 2", fastingOnly.logging.streakDays, 2);
const yesterdayOnly = build({ sugar: [sugar(1, 8, 100, "fasting")], meals: [], injections: [] });
eq("today empty, yesterday logged: the streak survives (1)", yesterdayOnly.logging.streakDays, 1);
const twoDaysAgo = build({ sugar: [sugar(2, 8, 100, "fasting")], meals: [], injections: [] });
eq("a gap of a whole day ends the streak (0)", twoDaysAgo.logging.streakDays, 0);
eq("but the day still counts as a logged day", twoDaysAgo.logging.daysWithLogs, 1);
const mealOnlyDay = build({ sugar: [], meals: [meal(0, 9)], injections: [] });
eq("a meal alone makes a logged day", mealOnlyDay.logging.daysWithLogs, 1);
eq("a meal alone starts a streak", mealOnlyDay.logging.streakDays, 1);
const empty = build({ sugar: [], meals: [], injections: [] });
same("no rows at all: all four periods empty", empty.logging.emptyPeriods, ["fasting", "preMeal", "postMeal", "bedtime"]);
eq("no rows: perDay 0", empty.glucose.perDay, 0);
eq("an empty packet validates", ctx.validateContextPacket(empty).length, 0);
const fullStreak: SugarLog[] = [];
for (let d = 0; d < 14; d++) fullStreak.push(sugar(d, 8, 100 + d, "fasting"));
const everyDay = build({ sugar: fullStreak, meals: [], injections: [] });
eq("14 logged days: daysWithLogs 14", everyDay.logging.daysWithLogs, 14);
eq("14 logged days: streak 14", everyDay.logging.streakDays, 14);

section("H. tags and sites are the fixed enums");
const tagged = build({
  sugar: [],
  meals: [meal(0, 8, ["sport", "illness"]), meal(1, 8, ["sport"]), meal(2, 8, ["travel", "alcohol", "other", "stress"])],
  injections: [],
});
same("meal tags count per tag", tagged.meals.tags, { sport: 2, illness: 1, stress: 1, travel: 1, alcohol: 1, other: 1 });
const junkTags = build({ sugar: [], meals: [meal(0, 8, ["sport", "free text" as never, "<b>" as never])], injections: [] });
same("unknown tag strings never appear", junkTags.meals.tags, { sport: 1 });
const sites = build({
  sugar: [],
  meals: [],
  injections: [
    shot(0, 8, "abdomen_left_upper"),
    shot(0, 9, "abdomen_left_lower"),
    shot(1, 8, "abdomen_right_upper"),
    shot(1, 9, "thigh_right"),
    shot(2, 8, "buttock_left"),
    shot(2, 9, "arm_right"),
    shot(2, 10, "junk" as never),
  ],
});
same("retired quadrants fold into their side; junk is dropped", sites.injections.sites, { abdomen_left: 2, abdomen_right: 1, thigh_right: 1, buttock_left: 1, arm_right: 1 });
eq("an injection with no region counts but places nowhere", build({ sugar: [], meals: [], injections: [shot(0, 8, null)] }).injections.count, 1);

section("I. the validator rejects what must never be sent");
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(packet));
const rejects = (name: string, mutate: (p: Record<string, any>) => void, needle: string): void => {
  const p = clone();
  mutate(p);
  const problems = ctx.validateContextPacket(p);
  ok(name, problems.length > 0 && problems.some((m) => m.includes(needle)), problems.join(" | "));
};
rejects("an extra top-level key", (p) => (p.note = "hi"), "unexpected key");
rejects("an extra key under glucose (a raw list)", (p) => (p.glucose.values = [100, 120]), "unexpected key");
rejects("a timestamp field", (p) => (p.logging.lastLoggedAt = "2026-07-15T08:00:00Z"), "unexpected key");
rejects("a free-text tag", (p) => (p.meals.tags["felt dizzy"] = 1), "not a known key");
rejects("a free-text site", (p) => (p.injections.sites["left arm"] = 1), "not a known key");
rejects("a diabetes value outside the enum", (p) => (p.profile.diabetes = "Ada"), "not a known type");
rejects("a treatment outside the enum", (p) => (p.profile.treatment = "metformin 500"), "not a known value");
rejects("a unit outside the enum", (p) => (p.unit = "mg/dL"), "mgdl or mmol");
rejects("days above 14", (p) => (p.days = 30), "out of range");
rejects("version other than 1", (p) => (p.v = 2), "must be 1");
rejects("a negative count", (p) => (p.glucose.readings = -1), "not a count");
rejects("a fractional count", (p) => (p.meals.count = 2.5), "not a count");
rejects("an average with no readings", (p) => { p.glucose.readings = 0; }, "glucose");
rejects("an average over fewer than 2 readings", (p) => { p.glucose.readings = 1; p.glucose.byPeriod.fasting.n = 1; p.glucose.byPeriod.preMeal.n = 0; p.glucose.byPeriod.postMeal.n = 0; p.glucose.byPeriod.bedtime.n = 0; }, "avg");
rejects("a period average with n=1", (p) => (p.glucose.byPeriod.preMeal.avg = 120), "avg set exactly");
const oneLeftOver = (p: Record<string, any>): void => {
  p.glucose.readings = 3;
  p.glucose.avg = 156;
  p.glucose.inRangePct = 67;
  p.glucose.lowCount = 0;
  p.glucose.highCount = 1;
  p.glucose.byPeriod = { fasting: { n: 2, avg: 110 }, preMeal: { n: 0, avg: null }, postMeal: { n: 0, avg: null }, bedtime: { n: 1, avg: null } };
  p.logging.emptyPeriods = ["preMeal", "postMeal"];
};
rejects("an overall average that gives back the one reading left outside the period averages", oneLeftOver, "glucose.avg");
{
  const p = clone();
  oneLeftOver(p);
  p.glucose.avg = null;
  eq("the same packet with the overall average withheld validates", ctx.validateContextPacket(p).length, 0);
  p.glucose.avg = 156;
  p.glucose.byPeriod.preMeal = { n: 1, avg: null };
  p.logging.emptyPeriods = ["postMeal"];
  p.glucose.readings = 4;
  eq("with two readings left outside, the average is allowed", ctx.validateContextPacket(p).length, 0);
}
rejects("site counts above the injections", (p) => (p.injections.sites.thigh_left = 99), "more than");
rejects("an empty-periods list that disagrees", (p) => (p.logging.emptyPeriods = ["bedtime"]), "does not match");
rejects("an unknown period name", (p) => (p.logging.emptyPeriods = ["night"]), "does not match");
rejects("a streak longer than the logged days", (p) => (p.logging.streakDays = 9), "more than");
rejects("more logged days than the window", (p) => (p.logging.daysWithLogs = 15), "more than");
rejects("a missing section", (p) => delete p.injections, "missing");
rejects("an oversize packet", (p) => (p.logging.emptyPeriods = new Array(400).fill("fasting")), "2 KB");
rejects("low + high above the readings", (p) => (p.glucose.lowCount = 9), "exceed");
rejects("an inverted target", (p) => (p.profile.target = { low: 180, high: 70 }), "low must be below high");
eq("null is not a packet", ctx.validateContextPacket(null).length > 0, true);
eq("an array is not a packet", ctx.validateContextPacket([]).length > 0, true);

section("J. size: under 2 KB, with room to spare");
const bytes = (v: unknown): number => JSON.stringify(v).length;
ok(`the fixture packet is small (${bytes(packet)} bytes)`, bytes(packet) < 1100);
const busyRows: SugarLog[] = [];
const periods: PeriodTag[] = ["fasting", "pre_meal", "post_meal_2h", "bedtime", "manual"];
for (let d = 0; d < 14; d++) for (let h = 0; h < 25; h++) busyRows.push(sugar(d, h % 24, 60 + ((d * 25 + h) % 200), periods[h % 5], { id: `busy-${d}-${h}` }));
const busyMeals: MealLog[] = [];
for (let d = 0; d < 14; d++) for (let k = 0; k < 8; k++) busyMeals.push(meal(d, 6 + k, ["sport", "illness", "stress", "travel", "alcohol", "other"], { id: `busy-meal-${d}-${k}` }));
const busyShots: Injection[] = [];
const allSites: InjectionSite[] = ["abdomen_left", "abdomen_right", "thigh_left", "thigh_right", "arm_left", "arm_right", "buttock_left", "buttock_right"];
for (let d = 0; d < 14; d++) allSites.forEach((s, i) => busyShots.push(shot(d, 6 + i, s, { id: `busy-shot-${d}-${i}` })));
const busy = build({ profile: profile({ glucose_unit: "mmol" }), sugar: busyRows, meals: busyMeals, injections: busyShots });
eq("the busiest realistic packet validates", ctx.validateContextPacket(busy).length, 0);
ok(`the busiest realistic packet is under 2 KB (${bytes(busy)} bytes)`, bytes(busy) < ctx.SPIKE_CONTEXT_MAX_BYTES);
const widest = {
  v: 1,
  days: 14,
  unit: "mmol",
  profile: { diabetes: "gestational", treatment: "insulin", target: { low: 100.9, high: 300.9 } },
  glucose: {
    readings: 99999,
    avg: 999.9,
    inRangePct: 100,
    lowCount: 99999,
    highCount: 99999,
    perDay: 7142.8,
    byPeriod: {
      fasting: { n: 99999, avg: 999.9 },
      preMeal: { n: 99999, avg: 999.9 },
      postMeal: { n: 99999, avg: 999.9 },
      bedtime: { n: 99999, avg: 999.9 },
    },
  },
  meals: { count: 99999, tags: { sport: 99999, illness: 99999, stress: 99999, travel: 99999, alcohol: 99999, other: 99999 } },
  injections: {
    count: 99999,
    sites: { abdomen_left: 99999, abdomen_right: 99999, thigh_left: 99999, thigh_right: 99999, arm_left: 99999, arm_right: 99999, buttock_left: 99999, buttock_right: 99999, abdomen_left_upper: 99999, abdomen_right_upper: 99999, abdomen_left_lower: 99999, abdomen_right_lower: 99999 },
  },
  logging: { daysWithLogs: 14, emptyPeriods: ["fasting", "preMeal", "postMeal", "bedtime"], streakDays: 14 },
};
ok(`the widest conceivable packet is under 2 KB (${bytes(widest)} bytes)`, bytes(widest) < ctx.SPIKE_CONTEXT_MAX_BYTES);

// ── K. summarizeForSpike against an injected source ────────────────────────
async function summarizeTests(): Promise<void> {
  section("K. summarizeForSpike: what it reads, and when it gives up");
  interface Seen {
    kind: string;
    id: string;
    limit: number;
    start: number;
    end: number;
  }
  const seen: Seen[] = [];
  let resolved = 0;
  const source = (over: Partial<SpikeContextSource> = {}): SpikeContextSource => ({
    listSugarLogs: async (id, limit, range) => {
      seen.push({ kind: "sugar", id, limit, start: range.start, end: range.end });
      return ALL_SUGAR;
    },
    listMealLogs: async (id, limit, range) => {
      seen.push({ kind: "meals", id, limit, start: range.start, end: range.end });
      return MEALS;
    },
    getInjections: async (id, limit, range) => {
      seen.push({ kind: "injections", id, limit, start: range.start, end: range.end });
      return INJECTIONS;
    },
    resolveProfile: async () => {
      resolved++;
      return P;
    },
    ...over,
  });

  const viaSource = await ctx.summarizeForSpike(14, { profile: P, source: source(), now: NOW });
  same("same packet as the pure builder", viaSource, packet);
  eq("three reads", seen.length, 3);
  ok("every read is for the profile on screen", seen.every((s) => s.id === "p1"));
  ok("every read is bounded to the window start", seen.every((s) => s.start === localMidnight(13) && s.end === NOW));
  eq("readings are fetched with a CGM-sized cap", seen.find((s) => s.kind === "sugar")?.limit, 10000);
  eq("meals are fetched with the log cap", seen.find((s) => s.kind === "meals")?.limit, 2000);
  eq("the profile is not looked up when one is passed", resolved, 0);

  seen.length = 0;
  const viaResolve = await ctx.summarizeForSpike(14, { source: source(), now: NOW });
  same("without a profile the stored active one is resolved", viaResolve, packet);
  eq("resolveProfile ran once", resolved, 1);

  seen.length = 0;
  const week = await ctx.summarizeForSpike(7, { profile: P, source: source(), now: NOW });
  eq("a 7-day request yields days:7", week?.days, 7);
  ok("and reads from the start of day 6", seen.every((s) => s.start === localMidnight(6)));
  const over = await ctx.summarizeForSpike(90, { profile: P, source: source(), now: NOW });
  eq("a 90-day request is capped at 14", over?.days, 14);

  eq("a failing read gives null", await ctx.summarizeForSpike(14, { profile: P, now: NOW, source: source({ listSugarLogs: async () => { throw new Error("db"); } }) }), null);
  eq("no profile gives null", await ctx.summarizeForSpike(14, { now: NOW, source: source({ resolveProfile: async () => null }) }), null);
  const poisoned = await ctx.summarizeForSpike(14, {
    profile: P,
    now: NOW,
    source: source({ listSugarLogs: async () => [sugar(0, 8, Number.NaN, "fasting"), sugar(0, 9, 100, "fasting")] }),
  });
  eq("a packet that does not validate is dropped, not trimmed", poisoned, null);
}

// ── L. The consent store ───────────────────────────────────────────────────
async function consentTests(): Promise<void> {
  section("L. second consent: off by default, fail-closed, withdrawn with the first");
  store.clear();
  eq("fresh install: summary consent is off", await consent.hasSpikeContextConsent(), false);
  eq("fresh install: nothing is written for it", store.has("zerospike.spikeContextConsent"), false);
  ok("the storage key is the agreed one", read("lib/services/spikeConsent.ts").includes('"zerospike.spikeContextConsent"'));
  eq("granting it stores it", await consent.setSpikeContextConsent(true), true);
  eq("without the chat consent it still reads off", await consent.hasSpikeContextConsent(), false);
  await consent.grantSpikeConsent();
  eq("with both it reads on", await consent.hasSpikeContextConsent(), true);
  eq("turning it off reports success", await consent.setSpikeContextConsent(false), true);
  eq("and it reads off", await consent.hasSpikeContextConsent(), false);
  eq("the chat consent is untouched by that", await consent.hasSpikeConsent(), true);
  await consent.setSpikeContextConsent(true);
  removeFails = true;
  eq("turning it off when removeItem fails reports success", await consent.setSpikeContextConsent(false), true);
  eq("by writing an explicit false", store.get("zerospike.spikeContextConsent"), "false");
  eq("so it reads off and cannot come back on", await consent.hasSpikeContextConsent(), false);
  removeFails = false;
  await consent.setSpikeContextConsent(true);
  storageThrows = true;
  eq("turning it off when storage is gone reports failure", await consent.setSpikeContextConsent(false), false);
  eq("granting when storage is gone reports failure", await consent.setSpikeContextConsent(true), false);
  storageThrows = false;
  eq("a failed grant left the old value alone", store.get("zerospike.spikeContextConsent"), "true");
  store.set("zerospike.spikeContextConsent", "false");
  eq("a stored 'false' reads off", await consent.hasSpikeContextConsent(), false);
  await consent.setSpikeContextConsent(true);
  store.set("zerospike.spikeHistory", JSON.stringify([{ role: "user", content: "hi" }]));
  await consent.withdrawSpikeConsent();
  eq("withdrawing clears the chat consent", await consent.hasSpikeConsent(), false);
  eq("withdrawing clears the summary consent key", store.has("zerospike.spikeContextConsent"), false);
  eq("withdrawing clears the stored chat", store.has("zerospike.spikeHistory"), false);
  await consent.grantSpikeConsent();
  eq("consenting again later starts with the summary off", await consent.hasSpikeContextConsent(), false);
  storageThrows = true;
  eq("a storage failure reads as no consent", await consent.hasSpikeContextConsent(), false);
  eq("and as no chat consent", await consent.hasSpikeConsent(), false);
  storageThrows = false;
}

// ── M. Protocol helpers ────────────────────────────────────────────────────
function protocolHelpers(): void {
  section("M. server-sent events: framing");
  const a = client.takeSseEvents('data: {"type":"delta","text":"Hi"}\n\ndata: {"type":"delta","te');
  same("one whole event, one partial kept", a, { events: ['{"type":"delta","text":"Hi"}'], rest: 'data: {"type":"delta","te' });
  const b = client.takeSseEvents("data: one\n\ndata: two\n\n");
  same("two events, empty tail", b, { events: ["one", "two"], rest: "" });
  const c1 = client.takeSseEvents("data: A\r");
  eq("a lone CR waits for its LF", c1.events.length, 0);
  same("CRLF split across chunks is repaired", client.takeSseEvents(c1.rest + "\n\r\n").events, ["A"]);
  same("CRLF framing", client.takeSseEvents("data: x\r\n\r\ndata: y\r\n\r\n").events, ["x", "y"]);
  same("comments and keep-alives are dropped", client.takeSseEvents(": keep-alive\n\ndata: x\n\n").events, ["x"]);
  same("multi-line data is joined with a newline", client.takeSseEvents("data: a\ndata: b\n\n").events, ["a\nb"]);
  same("no space after the colon", client.takeSseEvents("data:x\n\n").events, ["x"]);
  same("event: and id: lines are ignored", client.takeSseEvents("event: message\nid: 4\ndata: x\n\n").events, ["x"]);
  same("an empty buffer", client.takeSseEvents(""), { events: [], rest: "" });

  section("N. server-sent actions and sources are checked before use");
  same("unknown actions are dropped, known ones kept in order", client.sanitizeActions(["open_insights", "format_disk", "open_journal"]), ["open_insights", "open_journal"]);
  same("duplicates collapse", client.sanitizeActions(["open_journal", "open_journal"]), ["open_journal"]);
  eq("at most three", client.sanitizeActions(["open_reminders", "start_meal_timer", "open_injection_map", "connect_health"]).length, 3);
  same("non-arrays and non-strings give nothing", [client.sanitizeActions(null), client.sanitizeActions("open_journal"), client.sanitizeActions([1, {}, null])], [[], [], []]);
  const good = { id: "ada", title: "  ADA Standards of Care  ", url: "https://diabetes.org/care?x=1" };
  same("a good source is kept, title trimmed", client.sanitizeSources([good]), [{ id: "ada", title: "ADA Standards of Care", url: good.url }]);
  const badUrls = ["http://insecure.example/a", "javascript:alert(1)", "tel:+100", "zerospike://x", "https://user:pw@evil.example/", "https://evil.example@good.example/", "https:///nohost", "", "https://a b.example/", "https://x.example/" + "a".repeat(600)];
  for (const url of badUrls) eq(`rejects ${url.slice(0, 40)}`, client.sanitizeSources([{ ...good, url }]).length, 0);
  eq("rejects an empty title", client.sanitizeSources([{ ...good, title: "   " }]).length, 0);
  eq("rejects a missing id", client.sanitizeSources([{ title: "t", url: good.url }]).length, 0);
  eq("at most four", client.sanitizeSources([1, 2, 3, 4, 5, 6].map((n) => ({ id: `s${n}`, title: `t${n}`, url: good.url }))).length, 4);
  eq("long titles are cut", client.sanitizeSources([{ ...good, title: "x".repeat(500) }])[0].title.length, 120);
  const appSrc = { id: "app_sources", title: "Medical information & sources", url: "zerospike://sources" };
  same("the app's own sources screen is kept, not dropped by the https filter", client.sanitizeSources([appSrc]), [appSrc]);
  eq("it maps to the sources route", client.spikeSourceRoute(appSrc), "/sources");
  eq("a link source has no in-app route", client.spikeSourceRoute({ id: "ada", title: "ADA", url: good.url }), null);
  eq("the app address is let through only for its own id", client.sanitizeSources([{ ...appSrc, id: "ada" }]).length, 0);
  eq("and only that exact address", client.sanitizeSources([{ ...appSrc, url: "zerospike://sources/x" }]).length, 0);
  eq("a prototype key is no id", client.sanitizeSources([{ ...appSrc, id: "constructor" }]).length, 0);
  eq("another source cannot borrow the route", client.spikeSourceRoute({ id: "ada", title: "ADA", url: "zerospike://sources" }), null);
  same("a link and the app screen together", client.sanitizeSources([good, appSrc]).map((s) => s.id), ["ada", "app_sources"]);

  section("O. the chat window");
  const many: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < 20; i++) many.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  const win = client.windowMessages(many);
  eq("only the last 16", win.length, 16);
  eq("starting at the right one", win[0].content, "m4");
  eq("content is cut at 1500", client.windowMessages([{ role: "user", content: "x".repeat(2000) }])[0].content.length, 1500);
  eq("empty content is dropped", client.windowMessages([{ role: "user", content: "" }]).length, 0);
  eq("a foreign role is dropped", client.windowMessages([{ role: "system" as never, content: "x" }]).length, 0);
  const odd: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < 17; i++) odd.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  const oddWin = client.windowMessages(odd);
  eq("a window cut onto a reply leaves that reply out", oddWin[0].content, "m2");
  eq("and keeps the rest", oddWin.length, 15);
  eq("a window always opens on the user", oddWin[0].role, "user");
  eq("replies alone make no window", client.windowMessages([{ role: "assistant", content: "x" }]).length, 0);

  section("P. action routes exist in app/");
  for (const id of client.SPIKE_ACTION_IDS) {
    const route = client.SPIKE_ACTION_ROUTES[id] as string;
    const file = `app${route}.tsx`;
    ok(`${id} -> ${route} (${file})`, fs.existsSync(nodePath.join(root, file)));
  }
  eq("every action has a route", Object.keys(client.SPIKE_ACTION_ROUTES).length, client.SPIKE_ACTION_IDS.length);
  const sourceRoute = client.spikeSourceRoute({ id: "app_sources", title: "t", url: "zerospike://sources" });
  ok(`the app source route ${sourceRoute} exists in app/`, sourceRoute !== null && fs.existsSync(nodePath.join(root, `app${sourceRoute}.tsx`)));
}

// ── Q. askSpike against a fake fetch ───────────────────────────────────────
const enc = new TextEncoder();
function sse(chunks: (string | Uint8Array)[], init: { status?: number; type?: string } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });
  return new Response(stream, { status: init.status ?? 200, headers: { "content-type": init.type ?? "text/event-stream" } });
}
function jsonRes(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
const ev = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const MSGS = [{ role: "user" as const, content: "How was my week?" }];

async function ask(over: Partial<Parameters<typeof client.askSpike>[0]> = {}) {
  return client.askSpike({ messages: MSGS, locale: "tr", tier: "free", context: null, ...over });
}
async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "(did not throw)";
  } catch (e) {
    return client.spikeErrorCode(e);
  }
}

async function clientTests(): Promise<void> {
  section("Q. askSpike: streaming");
  store.clear();
  calls.length = 0;
  const bytesOfDelta = enc.encode(ev({ type: "delta", text: "Doğru" }));
  const cut = bytesOfDelta.indexOf(0xc4) + 1; // splits the two bytes of "ğ"
  const doneEvent = ev({ type: "done", actions: ["open_insights", "bogus"], sources: [{ id: "a", title: "ADA", url: "https://diabetes.org/" }], filtered: false, usage: { in: 1 } });
  responder = () => sse([ev({ type: "delta", text: "Merhaba " }), bytesOfDelta.slice(0, cut), bytesOfDelta.slice(cut), ": ping\n\n", doneEvent.slice(0, 20), doneEvent.slice(20)]);
  const seenDeltas: string[] = [];
  let dispatched = null as boolean | null;
  const r1 = await ask({ onDelta: (t) => seenDeltas.push(t), onDispatch: (i) => (dispatched = i.hasContext) });
  eq("streamed reply text", r1.reply, "Merhaba Doğru");
  eq("streamed flag", r1.streamed, true);
  eq("not filtered", r1.filtered, false);
  same("known actions only", r1.actions, ["open_insights"]);
  same("sources", r1.sources, [{ id: "a", title: "ADA", url: "https://diabetes.org/" }]);
  same("deltas arrive as the text so far", seenDeltas, ["Merhaba ", "Merhaba Doğru"]);
  eq("one request", calls.length, 1);
  eq("it goes to the configured url", calls[0].url, FN_URL);
  eq("stream:true", calls[0].body.stream, true);
  eq("locale", calls[0].body.locale, "tr");
  eq("tier", calls[0].body.tier, "free");
  eq("context is an explicit null", calls[0].body.context, null);
  same("body keys are exactly the contract", Object.keys(calls[0].body).sort(), ["context", "locale", "messages", "stream", "tier"]);
  same("messages are role + content only", calls[0].body.messages, [{ role: "user", content: "How was my week?" }]);
  eq("x-device-id is the stored install id", calls[0].headers["x-device-id"], store.get("zerospike.deviceId"));
  ok("the install id is a uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(calls[0].headers["x-device-id"]));
  eq("no consent header without a packet", calls[0].headers["x-consent-context"], undefined);
  eq("json content type", calls[0].headers["Content-Type"], "application/json");
  eq("onDispatch reports no context", dispatched, false);
  ok("no x-tier header any more", !("x-tier" in calls[0].headers));

  section("R. askSpike: the summary packet and its consent");
  calls.length = 0;
  responder = () => sse([ev({ type: "delta", text: "ok" }), ev({ type: "done", actions: [], sources: [], filtered: false })]);
  await ask({ context: packet });
  eq("consent off: the packet is dropped before the request", calls[0].body.context, null);
  eq("consent off: no consent header", calls[0].headers["x-consent-context"], undefined);
  await consent.setSpikeContextConsent(true);
  calls.length = 0;
  await ask({ context: packet });
  eq("summary consent without the chat consent: still dropped", calls[0].body.context, null);
  await consent.grantSpikeConsent();
  calls.length = 0;
  let dispatched2 = null as boolean | null;
  await ask({ context: packet, onDispatch: (i) => (dispatched2 = i.hasContext) });
  same("both consents: the packet goes", calls[0].body.context, packet);
  eq("and the header says so", calls[0].headers["x-consent-context"], "1");
  eq("onDispatch reports a packet", dispatched2, true);
  calls.length = 0;
  await ask({ context: null });
  eq("both consents but no packet: null, no header", `${calls[0].body.context}|${calls[0].headers["x-consent-context"]}`, "null|undefined");
  await consent.setSpikeContextConsent(false);
  calls.length = 0;
  await ask({ context: packet });
  eq("turned off again: dropped again", calls[0].body.context, null);
  await consent.setSpikeContextConsent(true);

  section("S. askSpike: filtered replies");
  calls.length = 0;
  responder = () => sse([ev({ type: "delta", text: "take 12 units now" }), ev({ type: "done", actions: ["open_journal"], sources: [], filtered: true, reply: "Please ask your care team." })]);
  const f1 = await ask();
  eq("the safe text replaces what streamed in", f1.reply, "Please ask your care team.");
  eq("filtered flag", f1.filtered, true);
  same("actions still come through", f1.actions, ["open_journal"]);
  responder = () => sse([ev({ type: "delta", text: "something unsafe" }), ev({ type: "done", actions: [], sources: [], filtered: true })]);
  const f2 = await ask();
  eq("filtered with no safe text: empty, the screen substitutes its own", f2.reply, "");
  eq("filtered flag holds", f2.filtered, true);
  responder = () => jsonRes({ reply: "Not for me to say.", actions: [], sources: [], filtered: true, usage: {} });
  const f3 = await ask({ stream: false });
  eq("single reply filtered", f3.reply, "Not for me to say.");

  section("S2. the function's own final text, and the token ceiling");
  responder = () => sse([ev({ type: "delta", text: "Add a bedtime reminder.\n```json" }), ev({ type: "done", reply: "Add a bedtime reminder.", actions: [], sources: [], filtered: false, truncated: false })]);
  const g1 = await ask();
  eq("done.reply wins over a streamed copy that ends in a stray fence", g1.reply, "Add a bedtime reminder.");
  eq("and it is still a streamed reply", g1.streamed, true);
  responder = () => sse([ev({ type: "delta", text: "Streamed words" }), ev({ type: "done", actions: [], sources: [], filtered: false })]);
  eq("a done with no reply (an older function) falls back to the streamed words", (await ask()).reply, "Streamed words");
  responder = () => sse([ev({ type: "delta", text: "Streamed words" }), ev({ type: "done", reply: "   ", actions: [], sources: [], filtered: false })]);
  eq("a blank done.reply is no reply either", (await ask()).reply, "Streamed words");
  responder = () => sse([ev({ type: "delta", text: "Cut off mid" }), ev({ type: "done", reply: "Cut off mid", actions: ["open_journal"], sources: [], filtered: false, truncated: true })]);
  const g3 = await ask();
  eq("a reply cut at the token ceiling is flagged", g3.truncated, true);
  responder = () => sse([ev({ type: "delta", text: "ok" }), ev({ type: "done", actions: [], sources: [], filtered: false })]);
  eq("the flag is off by default", (await ask()).truncated, false);
  responder = () => jsonRes({ reply: "Cut", actions: [], sources: [], filtered: false, truncated: true });
  eq("single-reply mode carries it too", (await ask({ stream: false })).truncated, true);
  responder = () => jsonRes({ reply: "Whole", actions: [], sources: [], filtered: false });
  eq("and defaults to false there", (await ask({ stream: false })).truncated, false);

  section("T. askSpike: single reply and fallbacks");
  calls.length = 0;
  responder = () => jsonRes({ reply: "  Plain reply  ", actions: ["open_widget_guide"], sources: [], filtered: false, usage: {} });
  const s1 = await ask({ stream: false });
  eq("stream:false asks once", calls.length, 1);
  eq("with stream:false in the body", calls[0].body.stream, false);
  eq("reply is trimmed", s1.reply, "Plain reply");
  eq("not streamed", s1.streamed, false);
  same("actions", s1.actions, ["open_widget_guide"]);

  calls.length = 0;
  responder = () => jsonRes({ reply: "One shot", actions: [], sources: [], filtered: false });
  const s2 = await ask();
  eq("a function that ignores stream:true and answers JSON: one request", calls.length, 1);
  eq("its reply is used", s2.reply, "One shot");
  eq("and is not marked streamed", s2.streamed, false);

  calls.length = 0;
  const deltas3: string[] = [];
  responder = (call) =>
    call.body.stream === true
      ? sse([ev({ type: "delta", text: "half a thought" }), ev({ type: "error", code: "upstream" })])
      : jsonRes({ reply: "Whole answer", actions: [], sources: [], filtered: false });
  const s3 = await ask({ onDelta: (t) => deltas3.push(t) });
  eq("an error event falls back to a single reply", s3.reply, "Whole answer");
  eq("two requests, stream then single", calls.map((c) => c.body.stream).join(), "true,false");
  eq("the partial text was dropped before the retry", deltas3[deltas3.length - 1], "");
  eq("the fallback is not marked streamed", s3.streamed, false);

  calls.length = 0;
  responder = (call) => (call.body.stream === true ? new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } }) : jsonRes({ reply: "From fallback", actions: [], sources: [], filtered: false }));
  eq("a body that cannot be read falls back", (await ask()).reply, "From fallback");
  eq("with exactly two requests", calls.length, 2);

  calls.length = 0;
  responder = (call) => (call.body.stream === true ? sse([ev({ type: "delta", text: "no done event" })]) : jsonRes({ reply: "Recovered", actions: [], sources: [], filtered: false }));
  eq("a stream that ends without done falls back", (await ask()).reply, "Recovered");

  calls.length = 0;
  responder = (call) => (call.body.stream === true ? jsonRes({ error: "upstream" }, 502) : jsonRes({ reply: "Second try", actions: [], sources: [], filtered: false }));
  eq("a 502 on the stream falls back to a single reply", (await ask()).reply, "Second try");
  eq("two requests", calls.length, 2);

  calls.length = 0;
  responder = (call) => {
    if (call.body.stream === true) throw new Error("Network request failed");
    return jsonRes({ reply: "After a dropped connection", actions: [], sources: [], filtered: false });
  };
  eq("a network failure on the stream falls back", (await ask()).reply, "After a dropped connection");

  calls.length = 0;
  responder = (call) => (call.body.stream === true ? sse([ev({ type: "done", actions: [], sources: [], filtered: false })]) : jsonRes({ reply: "Filled in", actions: [], sources: [], filtered: false }));
  eq("an empty streamed reply falls back too", (await ask()).reply, "Filled in");

  calls.length = 0;
  responder = () => jsonRes({ reply: "", actions: [], sources: [], filtered: false });
  eq("an empty single reply is an error", await failure(() => ask({ stream: false })), "empty_reply");

  calls.length = 0;
  const lenient = ev({ type: "delta", text: "ok" }) + "data: [DONE]\n\n" + "data: not json\n\n" + ev({ type: "mystery", x: 1 }) + ev({ type: "done", actions: [], sources: [], filtered: false });
  responder = () => sse([lenient]);
  eq("garbage events between good ones are ignored", (await ask()).reply, "ok");
  eq("without a second request", calls.length, 1);

  calls.length = 0;
  responder = () => sse([ev({ type: "delta", text: "tail" }), `data: ${JSON.stringify({ type: "done", actions: [], sources: [], filtered: false })}`]);
  eq("a final event without its blank line still counts", (await ask()).reply, "tail");

  section("U. askSpike: errors that must not retry");
  const noRetry: [string, number, unknown, string][] = [
    ["429 daily_limit", 429, { error: "daily_limit" }, "daily_limit"],
    ["429 rate_limit", 429, { error: "rate_limit" }, "rate_limit"],
    ["429 with no body", 429, null, "rate_limit"],
    ["403 consent_required", 403, { error: "consent_required" }, "consent_required"],
    ["400 bad_request", 400, { error: "bad_request" }, "bad_request"],
  ];
  for (const [label, status, body, code] of noRetry) {
    calls.length = 0;
    responder = () => (body === null ? new Response("nope", { status }) : jsonRes(body, status));
    eq(`${label} -> ${code}`, await failure(() => ask()), code);
    eq(`${label}: one request only`, calls.length, 1);
  }
  calls.length = 0;
  responder = () => jsonRes({ error: "daily_limit" }, 429);
  eq("single-reply mode maps the same codes", await failure(() => ask({ stream: false })), "daily_limit");
  calls.length = 0;
  responder = () => sse([ev({ type: "error", code: "rate_limit" })]);
  eq("an error EVENT with a limit code is final", await failure(() => ask()), "rate_limit");
  eq("and does not retry", calls.length, 1);
  calls.length = 0;
  responder = () => jsonRes({ error: "upstream" }, 502);
  eq("502 on both paths ends as upstream", await failure(() => ask()), "upstream");
  eq("after exactly two requests", calls.length, 2);
  responder = () => jsonRes({ oops: true }, 500);
  eq("a 500 is upstream", await failure(() => ask({ stream: false })), "upstream");

  section("V. askSpike: leaving the screen");
  calls.length = 0;
  const controller = new AbortController();
  controller.abort();
  responder = () => jsonRes({ reply: "never", actions: [], sources: [], filtered: false });
  eq("an already-aborted signal ends as aborted", await failure(() => ask({ signal: controller.signal })), "aborted");
  eq("and never falls back", calls.length, 1);
  ok("the request was given a signal", calls[0].signal !== undefined);

  section("W. askSpike: not configured");
  stubs["expo-constants"] = { __esModule: true, default: { expoConfig: { extra: {} } } };
  delete require.cache[require.resolve("../lib/ai/spikeClient")];
  const bare = require("../lib/ai/spikeClient") as typeof import("../lib/ai/spikeClient");
  eq("isConfigured is false without a url", bare.isConfigured, false);
  calls.length = 0;
  eq("askSpike refuses", await failure(() => bare.askSpike({ messages: MSGS, locale: "en", tier: "pro", context: null })), "not_configured");
  eq("without touching the network", calls.length, 0);
  eq("an unknown failure reads as upstream", client.spikeErrorCode(new TypeError("Network request failed")), "upstream");
  eq("a non-error reads as upstream", client.spikeErrorCode("boom"), "upstream");
}

// ── X. Source pins ─────────────────────────────────────────────────────────
/** Body of `function name(...) { ... }`, comments blanked so prose cannot satisfy a pin. */
function bodyOf(source: string, name: string): string {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const at = clean.search(new RegExp(`function ${name}\\s*\\(`));
  if (at < 0) return "";
  let i = clean.indexOf("(", at);
  let parens = 0;
  for (; i < clean.length; i++) {
    if (clean[i] === "(") parens++;
    else if (clean[i] === ")" && --parens === 0) break;
  }
  const open = clean.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < clean.length; j++) {
    if (clean[j] === "{") depth++;
    else if (clean[j] === "}" && --depth === 0) return clean.slice(open, j + 1);
  }
  return "";
}

function sourcePins(): void {
  section("X. wiring pinned in the source");
  const screen = read("app/spike.tsx");
  const clientSrc = read("lib/ai/spikeClient.ts");

  const toggle = bodyOf(screen, "toggleContext");
  ok("the summary switch has a handler", toggle.length > 0);
  ok("switching on only opens the consent screen", /if \(next\) \{\s*(?:setContextSaveFailed\(false\);\s*)?setContextView\(true\);\s*return;\s*\}/.test(toggle));
  ok("switching off updates the screen at once", toggle.includes("setContextOn(false)"));
  ok("switching off withdraws the stored summary consent", toggle.includes("await setSpikeContextConsent(false)"));
  ok("switching off emits spike_context_consent granted:false", /logEvent\("spike_context_consent",\s*\{\s*granted:\s*false\s*\}\)/.test(toggle));
  ok("accepting the consent screen is the only place that turns it on", bodyOf(screen, "acceptContext").includes("setContextOn(true)") && (screen.match(/setContextOn\(true\)/g) ?? []).length === 1);
  ok("the Spike screen renders a Switch titled spike.ctxToggle bound to the handler",
    /<Switch\b[\s\S]*?value=\{contextOn\}[\s\S]*?onValueChange=\{\(next\) => void toggleContext\(next\)\}[\s\S]*?accessibilityLabel=\{t\("spike\.ctxToggle"\)\}/.test(screen) &&
      screen.includes('{t("spike.ctxToggle")}'));
  ok("the switch starts from the stored consent", screen.includes("setContextOn(await hasSpikeContextConsent())"));
  ok("the switch row is shown in the chat, above the thread", /isConfigured && !screenshotChat \? \(\s*<View style=\{columnPad\(12\)\}>/.test(screen));
  ok("streaming goes through expo/fetch", clientSrc.includes('import { fetch } from "expo/fetch"'));
  ok("the screen builds the packet only when the switch is on", /contextOn\s*\?\s*await summarizeForSpike/.test(screen));
  ok("the summary consent is not an RN Modal (iOS refuses one inside a modal route)", !/<Modal\b/.test(screen) && !screen.includes("SheetShell"));
  ok("the client re-checks the consent when it builds the request", clientSrc.includes("hasSpikeContextConsent()"));
  ok("the consent header is only set with a packet", /if \(context != null\) headers\["x-consent-context"\] = "1"/.test(clientSrc));
  ok("the device id comes from lib/identity (no local copy)", clientSrc.includes('from "../identity/deviceId"') && !clientSrc.includes("DEVICE_ID_KEY"));
  for (const name of ["spike_opened", "spike_message_sent", "spike_reply", "spike_feedback", "spike_action_tap", "spike_context_consent"]) {
    ok(`event ${name} is emitted`, screen.includes(`"${name}"`));
  }
  const accept = bodyOf(screen, "acceptContext");
  ok("a failed save keeps the consent screen and says so", accept.includes("setContextSaveFailed(true)") && screen.includes('t("spike.errorContextSave")'));
  ok("and the switch is not turned on before that save is known", accept.indexOf("setContextSaveFailed(true)") < accept.indexOf("setContextOn(true)"));
  ok("the failure message clears on the next try and on decline", accept.includes("setContextSaveFailed(false)") && bodyOf(screen, "declineContext").includes("setContextSaveFailed(false)"));
  const meal = bodyOf(screen, "openAction");
  ok("the post-meal button looks at the latest meal only within 3 hours", screen.includes("RECENT_MEAL_MS = 3 * 60 * 60 * 1000") && meal.includes("age <= RECENT_MEAL_MS"));
  ok("with no recent meal it opens the journal, not the dashboard", meal.includes("SPIKE_ACTION_ROUTES.open_journal") && !meal.includes('router.navigate("/")'));
  ok("a server 429 is kept by the server's UTC day", screen.includes("setServerExhaustedDay(utcDayKey(startedAt))") && screen.includes("toISOString().slice(0, 10)"));
  ok("it ends with that day and when the user turns Pro", screen.includes("msUntilNextUtcDay") && /if \(isProUser\) setServerExhaustedDay\(null\)/.test(screen));
  ok("the old always-on flag is gone", !screen.includes("setServerExhausted("));
  ok("a source with an in-app route opens that screen", bodyOf(screen, "openSource").includes("spikeSourceRoute(source)"));
  ok("a reply cut at the token ceiling ends on an ellipsis", screen.includes("result.truncated"));
  ok("the screen never builds uppercase with toUpperCase", !screen.includes("toUpperCase"));
  ok("accept() refuses to grant until the box is ticked", bodyOf(screen, "accept").replace(/\s+/g, " ").startsWith("{ if (!agreed) return;"));
  ok("the accept button is disabled until the box is ticked", /<GradientCTA\s[^>]*?label=\{t\("spike\.accept"\)\}[^>]*?disabled=\{!agreed\}/.test(screen));
  ok("the box is a checkbox bound to the agreement", /accessibilityRole="checkbox"\s*accessibilityState=\{\{ checked: agreed \}\}/.test(screen) && screen.includes('t("spike.consentAgree")'));
  ok("the short consent is the default view and the full text sits behind the details toggle", screen.includes("detailsOpen ? (") && screen.indexOf('t("spike.consentShort1")') < screen.indexOf("detailsOpen ? (") && screen.indexOf("detailsOpen ? (") < screen.indexOf('t("spike.consentSent")'));
  ok("no em dash in the new files", ![screen, clientSrc, read("lib/ai/spikeContext.ts"), read("lib/services/spikeConsent.ts")].some((s) => s.includes(String.fromCharCode(0x2014))));
}

// ── Y. Consent wording ─────────────────────────────────────────────────────
function localeSpike(lang: string): Record<string, string> {
  const src = read(`lib/i18n/locales/${lang}.ts`);
  const match = src.match(new RegExp(`const ${lang}(?::[^=]+)?\\s*=\\s*(\\{[\\s\\S]*\\});\\s*export default ${lang};`));
  if (!match) throw new Error(`cannot parse ${lang}.ts`);
  return (new Function(`return (${match[1]})`)() as { spike: Record<string, string> }).spike;
}

function consentWording(): void {
  section("Y. consent wording: what is listed is what is sent");
  const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  const screen = read("app/spike.tsx");
  const sharedKeys = Object.keys(localeSpike("en")).filter((k) => /^ctxShared\d+$/.test(k));
  eq("five items are listed as shared", sharedKeys.length, 5);
  for (const key of sharedKeys) ok(`the screen lists spike.${key}`, screen.includes(`t("spike.${key}")`));
  eq("the screen lists no more than the locale defines", (screen.match(/t\("spike\.ctxShared\d+"\)/g) ?? []).length, sharedKeys.length);

  // The packet sends the diabetes type, insulin/pills, the unit and the target range:
  // ctxShared5 is the item that names the first three, so it must exist everywhere.
  const anonymity = /anonym|anonim|anónim|anônim|مجهول|匿名/i;
  // "a random installation ID, not linked to your name or account", per language.
  const randomId: Record<string, [RegExp, RegExp]> = {
    en: [/random installation id/i, /not linked to your name or account/i],
    tr: [/rastgele bir kurulum kimliği/, /adınızla veya hesabınızla ilişkilendirilmeyen/i],
    de: [/zufällige installations-id/i, /nicht mit ihrem namen oder konto verknüpft/i],
    fr: [/identifiant d'installation aléatoire/, /non associé à votre nom ni à votre compte/],
    es: [/identificador de instalación aleatorio/, /no asociado a su nombre ni a su cuenta/],
    it: [/identificativo casuale dell'installazione/, /non collegato al suo nome né al suo account/i],
    pt: [/identificador aleatório da instalação/, /não associado ao seu nome nem à sua conta/],
    ar: [/معرّف تثبيت عشوائي/, /غير مرتبط باسمك أو بحسابك/],
    ja: [/ランダムなインストールID/, /名前やアカウントに紐づかない/],
  };
  // consentDeviceId says what the one installation id is really used for, so it names the same
  // id as "random", unlinked to name, email or account, and lists the four uses.
  const deviceIdWording: Record<string, [RegExp, RegExp]> = {
    en: [/random installation id/i, /not linked to your name, email or account/i],
    tr: [/rastgele bir kurulum kimliği/, /adınızla, e-postanızla veya hesabınızla ilişkilendirilmeyen/i],
    de: [/zufällige installations-id/i, /nicht mit ihrem namen, ihrer e-mail-adresse oder ihrem konto verknüpft/i],
    fr: [/identifiant d'installation aléatoire/, /non associé à votre nom, à votre adresse e-mail ni à votre compte/],
    es: [/identificador de instalación aleatorio/, /no asociado a su nombre, correo electrónico ni cuenta/],
    it: [/identificativo casuale dell'installazione/, /non collegato al suo nome, al suo indirizzo e-mail né al suo account/i],
    pt: [/identificador aleatório da instalação/, /não associado ao seu nome, e-mail nem conta/],
    ar: [/معرّف تثبيت عشوائي/, /غير مرتبط باسمك أو بريدك الإلكتروني أو حسابك/],
    ja: [/ランダムなインストールID/, /名前、メールアドレス、アカウントに紐づかない/],
  };
  // The old copy said the id served the daily limit ONLY; it also keys the 90 day call log,
  // the usage events and the RevenueCat record.
  const onlyClaim: Record<string, RegExp> = {
    en: /\bonly\b/i,
    tr: /yalnızca|sadece/i,
    de: /\bnur\b/i,
    fr: /uniquement|seulement/i,
    es: /\bsolo\b|solamente/i,
    it: /\bsolo\b|soltanto|esclusivamente/i,
    pt: /apenas|somente|\bsó\b/i,
    ar: /فقط/,
    ja: /だけ|のみ/,
  };
  // The call log keeps model, tokens, duration and the filter result, never what was written.
  const noContent: Record<string, RegExp> = {
    en: /never your messages/i,
    tr: /mesajlarınızın içeriği kaydedilmez/,
    de: /nie der nachrichtentext/i,
    fr: /jamais le texte de vos messages/,
    es: /nunca el texto de sus mensajes/,
    it: /mai il testo dei suoi messaggi/i,
    pt: /nunca o texto das suas mensagens/,
    ar: /ولا يتضمن نص رسائلك أبدًا/,
    ja: /メッセージの内容は含みません/,
  };
  // The usage statistics switch is called the same thing in the settings text of each language.
  const usageEvents: Record<string, RegExp> = {
    en: /usage events/i,
    tr: /kullanım olayları/,
    de: /nutzungsereignisse/i,
    fr: /événements d'utilisation/,
    es: /eventos de uso/,
    it: /eventi di utilizzo/,
    pt: /eventos de uso/,
    ar: /أحداث الاستخدام/,
    ja: /利用イベント/,
  };
  // CLAUDE.md: the store-facing frame is log, follow-up, reminder. These stems stay out of the new copy.
  const regulatory: Record<string, RegExp> = {
    en: /treat|dose|diagnos|alarm|alert/i,
    tr: /tedavi|\bdoz|tanı|alarm|uyar/i,
    de: /behandl|dosis|diagnos|alarm|warn/i,
    fr: /traitement|\bdose|diagnostic|alarme|alerte|avertir/i,
    es: /tratamiento|dosis|diagnóstic|alarma|alerta/i,
    it: /terapia|trattament|\bdose|diagnosi|allarme/i,
    pt: /tratamento|\bdose|diagnóstic|alarme|alerta/i,
    ar: /علاج|جرعة|تشخيص|تنبيه|إنذار/,
    ja: /治療|診断|アラーム|警告|用量/,
  };
  const newKeys = (k: string): boolean => /^(ctx|action|feedback|error)/.test(k) || k === "filtered" || k === "sourcesLabel" || k === "consentSummaryNote" || /^consent(Short|Agree|Details)/.test(k);
  const shortProvider: Record<string, RegExp> = {
    tr: /harici bir yapay zekâ hizmet sağlayıcı/,
    en: /external AI service provider/,
    de: /externen KI-Dienstleister/,
    fr: /prestataire de services d.IA externe/,
    es: /proveedor de servicios de IA externo/,
    it: /fornitore di servizi di IA esterno/,
    pt: /provedor de serviços de IA externo/,
    ar: /مزوّد خدمة ذكاء اصطناعي خارجي/,
    ja: /外部のAIサービス事業者/,
  };
  const shortHistory: Record<string, RegExp> = {
    tr: /önceki mesajları/,
    en: /earlier messages of this chat/,
    de: /früheren Nachrichten dieses Chats/,
    fr: /messages précédents de cette conversation/,
    es: /mensajes anteriores de este chat/,
    it: /messaggi precedenti di questa chat/,
    pt: /mensagens anteriores deste chat/,
    ar: /الرسائل السابقة في هذه المحادثة/,
    ja: /この会話の以前のメッセージ/,
  };
  for (const lang of langs) {
    const spike = localeSpike(lang);
    ok(`${lang}: ctxShared5 exists`, typeof spike.ctxShared5 === "string" && spike.ctxShared5.length > 0);
    for (const key of ["consentDeviceId", "ctxRecipient"]) {
      ok(`${lang}.${key} does not claim anonymity`, !anonymity.test(spike[key]));
    }
    ok(`${lang}.ctxRecipient says random installation id, not linked to name or account`, randomId[lang][0].test(spike.ctxRecipient) && randomId[lang][1].test(spike.ctxRecipient));
    ok(`${lang}.consentDeviceId says random installation id, not linked to name, email or account`, deviceIdWording[lang][0].test(spike.consentDeviceId) && deviceIdWording[lang][1].test(spike.consentDeviceId));
    ok(`${lang}.consentDeviceId no longer claims the id is used only for the daily limit`, !onlyClaim[lang].test(spike.consentDeviceId));
    ok(`${lang}.consentDeviceId names the 90 day call log, the usage events and RevenueCat`, spike.consentDeviceId.includes("90") && usageEvents[lang].test(spike.consentDeviceId) && spike.consentDeviceId.includes("RevenueCat"));
    ok(`${lang}.consentDeviceId says message content is not kept`, noContent[lang].test(spike.consentDeviceId));
    ok(`${lang}: errorContextSave exists`, typeof spike.errorContextSave === "string" && spike.errorContextSave.length > 0);
    const hits = Object.entries(spike).filter(([k, v]) => newKeys(k) && regulatory[lang].test(v)).map(([k]) => k);
    ok(`${lang}: no regulatory wording in the Spike v2 strings`, hits.length === 0, hits.join(","));
    ok(`${lang}: no percent sign, no dash punctuation in them`, Object.entries(spike).every(([k, v]) => !newKeys(k) || !/[%–—]/.test(v)));
    // The short summary is exactly three sentences (does / is sent / is not sent), provider names live in Details only.
    for (const key of ["consentShort1", "consentShort2", "consentShort3"]) {
      const v = spike[key] ?? "";
      const enders = v.match(/[.!?。！？؟]/g) ?? [];
      ok(`${lang}.${key} is one sentence (a single terminal mark, at the end)`, enders.length === 1 && /[.!?。！？؟]$/.test(v), v);
      ok(`${lang}.${key} names no provider`, !/AWS|Amazon|Anthropic|Claude|Bedrock/i.test(v), v);
    }
    ok(`${lang}.consentRecipient still names the provider in Details`, /Anthropic/.test(spike.consentRecipient) && /Amazon Web Services/.test(spike.consentRecipient));
    ok(`${lang}: the three short lines are three distinct sentences`, new Set([spike.consentShort1, spike.consentShort2, spike.consentShort3]).size === 3);
    ok(`${lang}.consentShort1 says an external AI service provider`, shortProvider[lang].test(spike.consentShort1), spike.consentShort1);
    ok(`${lang}.consentShort2 names the 14 day summary and the earlier messages of the chat`, spike.consentShort2.includes("14") && shortHistory[lang].test(spike.consentShort2), spike.consentShort2);
  }
  const sheetSrc = read("components/CarbEstimateSheet.tsx");
  ok("the carb sheet reads the same three short keys and names no provider itself", ["consentShort1", "consentShort2", "consentShort3"].every((k) => sheetSrc.includes(`t("spike.${k}")`)) && !/AWS|Amazon|Anthropic|Bedrock/.test(sheetSrc));
  ok("the Spike screen short view carries no provider name outside the locale keys", !/AWS|Amazon Web|Anthropic|Bedrock/.test(screen));
}

(async () => {
  protocolHelpers();
  await summarizeTests();
  await consentTests();
  await clientTests();
  sourcePins();
  consentWording();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.log(`\nharness crashed: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
