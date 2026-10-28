/**
 * G253-FIX-C2: form and display fixes from the record-flow audit (AUDIT-C), run
 * against the real lib modules; screens that cannot render here are pinned by
 * reading their source.
 *   C-3  an mmol edit that leaves the glucose alone never moves it (100 stays 100)
 *   C-4  wiring: the reading a meal created moves with its time, a shared or
 *        pre-existing one does not
 *   C-5  the calculator's active insulin leaves the edited meal's own bolus out
 *        and is measured at the record's time
 *   C-6  the dashboard clock ticks once a minute, only in the foreground
 *   C-11 / C-12  the Injection form follows the profile and its insulin mode
 *   C-13 a new glucose entry opens without a period label
 *   C-18 a missing food, meal or template says so and closes
 *   C-21 region rule comment
 * Run: npx tsx scripts/recordFlowForms.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { V28_CREATE } from "../lib/db/v28Sql";
import { shouldMoveLinkedReading } from "../lib/mealEditPatch";
import { glucoseFromDisplay, glucoseToDisplay } from "../lib/glucose";
import { activeInsulinBreakdown } from "../lib/iob";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
const src = (...p: string[]) => {
  try {
    return readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
  } catch {
    return "";
  }
};
/** A module the fix adds: when it is missing the checks that need it fail instead of crashing the run. */
async function load<T>(path: string): Promise<T | null> {
  try {
    return (await import(path)) as T;
  } catch {
    ok(`module ${path} exists`, false);
    return null;
  }
}

const d = new DatabaseSync(":memory:");
d.exec("PRAGMA foreign_keys = ON;");
d.exec(`
  CREATE TABLE user_profiles (id TEXT PRIMARY KEY);
  CREATE TABLE foods (id TEXT PRIMARY KEY NOT NULL, name_tr TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '');
  CREATE TABLE sugar_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER NOT NULL,
    period_tag TEXT NOT NULL DEFAULT 'manual', source TEXT NOT NULL DEFAULT 'manual',
    logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT,
    source_app TEXT, external_id TEXT, is_cgm INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE);
  CREATE TABLE meal_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT, food_id TEXT,
    custom_food_name TEXT, portion_g REAL NOT NULL DEFAULT 0, calculated_carbs_g REAL NOT NULL DEFAULT 0,
    insulin_dose_units REAL NOT NULL DEFAULT 0, photo_uri_local TEXT, personal_note TEXT,
    logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', meal_template_id TEXT, health_uuid TEXT, created_sugar_log_id TEXT,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
    FOREIGN KEY (sugar_log_id) REFERENCES sugar_logs (id) ON DELETE SET NULL);
  INSERT INTO user_profiles VALUES ('P');
`);
for (const stmt of V28_CREATE) d.exec(stmt);

const bind = (p?: unknown[]) => (p ?? []) as any[];
const db = {
  execAsync: async (sql: string) => void d.exec(sql),
  runAsync: async (sql: string, p?: unknown[]) => ({ changes: Number(d.prepare(sql).run(...bind(p)).changes) }),
  getFirstAsync: async (sql: string, p?: unknown[]) => (d.prepare(sql).get(...bind(p)) as any) ?? null,
  getAllAsync: async (sql: string, p?: unknown[]) => d.prepare(sql).all(...bind(p)) as any[],
  isInTransactionSync: () => d.isTransaction,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    d.exec("BEGIN");
    try {
      await fn();
      d.exec("COMMIT");
    } catch (e) {
      if (d.isTransaction) d.exec("ROLLBACK");
      throw e;
    }
  },
};
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "./index" || request.endsWith("/db/index")) return { getDb: async () => db };
  if (/^(react-native|expo-(?!crypto$))/.test(request)) return new Proxy({}, { get: (_t, k) => (k === "__esModule" ? false : () => ({})) });
  if (request === "expo-crypto") return { getRandomBytes: (n: number) => randomBytes(n) };
  return realLoad.call(this, request, ...rest);
};
const one = (sql: string, ...p: any[]) => d.prepare(sql).get(...p) as any;
const count = (sql: string, ...p: any[]) => one(sql, ...p).c as number;

async function main() {
  const logs = await import("../lib/db/logs");

  // ---- C-3: an untouched glucose value is never converted back from its rounding ----
  console.log("C-3 mmol edit keeps the stored value");
  let drift = 0;
  const fieldToMgdl = (await load<typeof import("../lib/glucose")>("../lib/glucose"))?.glucoseFieldToMgdl;
  ok("glucoseFieldToMgdl exists", typeof fieldToMgdl === "function");
  if (fieldToMgdl) {
    for (let v = 40; v <= 400; v++) {
      if (fieldToMgdl(glucoseToDisplay(v, "mmol"), "mmol", v) !== v) drift++;
    }
    ok("40..400 mg/dL: an untouched mmol field saves the stored value", drift === 0, `${drift}/361 drift`);
    ok("a value the user typed is converted as before", fieldToMgdl(5.6, "mmol", 100) === glucoseFromDisplay(5.6, "mmol"));
    ok("a new entry (no stored value) converts", fieldToMgdl(5.5, "mmol", null) === glucoseFromDisplay(5.5, "mmol"));
    ok("mg/dL is unchanged", fieldToMgdl(100, "mgdl", 100) === 100 && fieldToMgdl(101, "mgdl", 100) === 101);
  }
  ok("round trip alone does drift (the bug this guards)", glucoseFromDisplay(glucoseToDisplay(100, "mmol"), "mmol") !== 100);

  const corr = await load<typeof import("../lib/glucoseCorrectionPatch")>("../lib/glucoseCorrectionPatch");
  if (corr) {
    const prev = { glucose_level_mgdl: 100, period_tag: "unset" as const, logged_at: "2026-10-28T08:00:00.000Z", tags: [] };
    const sameInstant = new Date("2026-10-28T08:00:00.000Z");
    const p1 = corr.glucoseCorrectionPatch(prev, 100, "fasting", [], sameInstant);
    ok("a period-only edit patches the period alone", JSON.stringify(p1) === JSON.stringify({ period_tag: "fasting" }), JSON.stringify(p1));
    ok("a time-spelling-only difference is no change", corr.glucoseCorrectionPatch({ ...prev, logged_at: "2026-10-28T08:00:00Z" }, 100, "unset", [], sameInstant).logged_at === undefined);
    ok("changed value and time are patched", JSON.stringify(corr.glucoseCorrectionPatch(prev, 105, "unset", [], new Date("2026-10-28T09:00:00.000Z"))) === JSON.stringify({ glucose_level_mgdl: 105, logged_at: "2026-10-28T09:00:00.000Z" }));
    ok("nothing changed: empty patch", Object.keys(corr.glucoseCorrectionPatch(prev, 100, "unset", [], sameInstant)).length === 0);
    // the DB effect: a Health row edited for its period only keeps its value and leaves no tombstone
    d.exec("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, period_tag) VALUES ('hx','P',100,'health','2026-10-28T08:00:00.000Z','unset')");
    const patch = corr.glucoseCorrectionPatch(prev, glucoseFieldToMgdlOrRound(100), "fasting", [], sameInstant);
    await logs.updateSugarLog("hx", patch);
    ok("Health row keeps 100 mg/dL after a period-only edit", one("SELECT glucose_level_mgdl v FROM sugar_logs WHERE id='hx'").v === 100);
    ok("and leaves no tombstone", count("SELECT COUNT(*) c FROM health_import_tombstones") === 0);
  }
  function glucoseFieldToMgdlOrRound(stored: number): number {
    return fieldToMgdl ? fieldToMgdl(glucoseToDisplay(stored, "mmol"), "mmol", stored) : glucoseFromDisplay(glucoseToDisplay(stored, "mmol"), "mmol");
  }

  const mep = await load<typeof import("../lib/mealEditPatch")>("../lib/mealEditPatch");
  if (mep?.linkedReadingPatch) {
    ok("calculator edit: unchanged value and time write nothing", Object.keys(mep.linkedReadingPatch({ storedMgdl: 100, valueMgdl: 100, moveToIso: null })).length === 0);
    ok("calculator edit: only a changed value is patched", JSON.stringify(mep.linkedReadingPatch({ storedMgdl: 100, valueMgdl: 104, moveToIso: null })) === JSON.stringify({ glucose_level_mgdl: 104 }));
    ok("calculator edit: a moved reading carries its time", mep.linkedReadingPatch({ storedMgdl: 100, valueMgdl: 100, moveToIso: "X" }).logged_at === "X");
  } else ok("linkedReadingPatch exists", false);
  const calc = src("app", "calculator.tsx");
  ok("calculator reads the glucose field through the stored value", /glucoseFieldToMgdl\(glucoseTyped, unit, isEdit \? storedReadingMgdl : null\)/.test(calc));
  ok("calculator edit writes the reading through linkedReadingPatch", /linkedReadingEditPatch\(\{/.test(calc) && /storedMgdl: storedReadingMgdl/.test(calc));
  ok("the sheet saves through glucoseFieldToMgdl", /glucoseFieldToMgdl\(typed, unit, edit\?\.glucose_level_mgdl\)/.test(src("components", "GlucoseInputSheet.tsx")));
  ok("applyGlucoseCorrection writes the patch only", /glucoseCorrectionPatch\(previous, value, period, tags, loggedAt\)/.test(src("lib", "services", "glucoseEdit.ts")));

  // ---- C-4: the wiring decides with the stored creation relation ----
  console.log("C-4 reading follows the meal time only when it is the meal's own");
  async function editTime(mealId: string, readingId: string, newTime: string) {
    const stored = await logs.getMealLog(mealId);
    const patch =
      mep?.linkedReadingEditPatch?.({
        loggedAtChanged: true,
        linkedSugarLogId: readingId,
        createdSugarLogId: stored?.created_sugar_log_id ?? null,
        otherMealsOnReading: await logs.countOtherMealsOnSugarLog(readingId, mealId),
        storedMgdl: 140,
        valueMgdl: 140,
        loggedIso: newTime,
      }) ?? {};
    if (Object.keys(patch).length) await logs.updateSugarLog(readingId, patch);
    return one("SELECT logged_at t FROM sugar_logs WHERE id = ?", readingId).t as string;
  }
  const t18 = "2026-10-27T18:00:00.000Z";
  const t20 = "2026-10-27T20:30:00.000Z";
  const rOwn = await logs.addSugarLog({ profile_id: "P", glucose_level_mgdl: 140, period_tag: "pre_meal", logged_at: t18 });
  const mOwn = await logs.addMealLog({ profile_id: "P", sugar_log_id: rOwn.id, created_sugar_log_id: rOwn.id, portion_g: 50, calculated_carbs_g: 10, insulin_dose_units: 0, logged_at: t18 });
  ok("a reading created together with the meal moves", (await editTime(mOwn.id, rOwn.id, t20)) === t20);
  const rShared = await logs.addSugarLog({ profile_id: "P", glucose_level_mgdl: 140, period_tag: "pre_meal", logged_at: t18 });
  const mA = await logs.addMealLog({ profile_id: "P", sugar_log_id: rShared.id, created_sugar_log_id: rShared.id, portion_g: 50, calculated_carbs_g: 10, insulin_dose_units: 0, logged_at: t18 });
  await logs.addMealLog({ profile_id: "P", sugar_log_id: rShared.id, portion_g: 50, calculated_carbs_g: 10, insulin_dose_units: 0, logged_at: "2026-10-27T18:10:00.000Z" });
  ok("a reading shared with a second meal stays", (await editTime(mA.id, rShared.id, t20)) === t18);
  const rPre = await logs.addSugarLog({ profile_id: "P", glucose_level_mgdl: 140, period_tag: "pre_meal", logged_at: t18 });
  const mPre = await logs.addMealLog({ profile_id: "P", sugar_log_id: rPre.id, portion_g: 50, calculated_carbs_g: 10, insulin_dose_units: 0, logged_at: t18 });
  ok("a reading that existed before the meal stays", (await editTime(mPre.id, rPre.id, t20)) === t18);
  ok("save passes the created reading id to addMealLog", /created_sugar_log_id: createdSugarLogId,/.test(calc));
  ok("edit records the reading it creates", /sugar_log_id: newSugarLogId,\s*\.\.\.\(createdNewReading \? \{ created_sugar_log_id: newSugarLogId \} : \{\}\)/.test(calc));
  ok("edit feeds the decision function the stored relation and the other-meal count", /linkedReadingEditPatch\(\{[\s\S]{0,200}createdSugarLogId: storedMeal\?\.created_sugar_log_id[\s\S]{0,160}countOtherMealsOnSugarLog\(linkedSugarLogId, mealLogId\)/.test(calc));
  ok("the old unconditional move is gone", !/loggedAtChanged \? \{ logged_at: loggedIso \}/.test(calc));

  // ---- C-5: calculator active insulin ----
  console.log("C-5 calculator active insulin");
  const ci = await load<typeof import("../lib/calcIob")>("../lib/calcIob");
  const { estimateInsulin } = await import("../lib/insulin");
  if (ci) {
    const row = (id: string, dose: number, at: string, type: "bolus" | "basal" = "bolus") => ({ id, insulin_type: type, dose_units: dose, logged_at: at });
    const own = row("B1", 6, "2026-10-27T12:00:00.000Z");
    const now = new Date("2026-10-27T12:10:00.000Z");
    ok("control: without exclusion the meal's own bolus counts", activeInsulinBreakdown([own], { now }).bolus > 5);
    ok("editing leaves out the edited bolus row", ci.calculatorIob([own], { excludeInjectionId: "B1", now }).bolus === 0);
    ok("another row of the same meal still counts", ci.calculatorIob([own, row("B2", 2, "2026-10-27T12:05:00.000Z")], { excludeInjectionId: "B1", now }).bolus > 1.5);
    ok("a row turned into basal is not excluded (still counted as basal)", ci.calculatorIob([row("B1", 20, "2026-10-27T12:00:00.000Z", "basal")], { excludeInjectionId: null, now }).basal > 15);
    ok("a new record keeps every bolus", ci.calculatorIob([own], { now }).bolus > 5);

    // OPUS-26 scenario: 3 u at 12:00, at 12:10 the record is back-dated to 11:50.
    const three = row("X", 3, "2026-10-27T12:00:00.000Z");
    const at1150 = new Date("2026-10-27T11:50:00.000Z");
    const old = activeInsulinBreakdown([three], { now: at1150 }).bolus;
    const fixed = ci.calculatorIob([three], { at: at1150, now }).bolus;
    ok("back-dated before a just-logged bolus: it is not dropped", old === 0 && fixed > 2.9, `old ${old} fixed ${fixed}`);
    const profile = { carb_ratio_breakfast: 10, carb_ratio_lunch: 10, carb_ratio_dinner: 10, insulin_sensitivity_factor: 50, target_postmeal_min: 100, target_postmeal_max: 140 } as any;
    const total = (iob: number) => estimateInsulin({ carb_100g: 50 } as any, 100, profile, { slot: "lunch", currentGlucose: 220, currentIOB: iob }).totalDose;
    console.log(`  OPUS-26: IOB old ${old} -> new ${fixed} u; dose figure old ${total(old)} -> new ${total(fixed)} u`);
    ok("the dose figure does not rise because of the back-date", total(fixed) < total(old));
    // a dose logged before the record time is still measured at the record time
    const early = row("E", 4, "2026-10-27T08:00:00.000Z");
    const at9 = new Date("2026-10-27T09:00:00.000Z");
    const nowLate = new Date("2026-10-27T12:00:00.000Z");
    ok("a dose before the record time is measured at the record time", ci.calculatorIob([early], { at: at9, now: nowLate }).bolus === activeInsulinBreakdown([early], { now: at9 }).bolus);
    const later = row("L", 4, "2026-10-27T10:00:00.000Z");
    ok("a dose logged after the record time is measured now", ci.calculatorIob([later], { at: at9, now: nowLate }).bolus === activeInsulinBreakdown([later], { now: nowLate }).bolus);
    ok("both together add up", Math.abs(ci.calculatorIob([early, later], { at: at9, now: nowLate }).bolus - (ci.calculatorIob([early], { at: at9, now: nowLate }).bolus + ci.calculatorIob([later], { at: at9, now: nowLate }).bolus)) < 0.011);
    ok("a future record time is treated as now", ci.calculatorIob([three], { at: new Date("2026-10-27T13:00:00.000Z"), now }).bolus === activeInsulinBreakdown([three], { now }).bolus);
  }
  ok("readFreshIob excludes only the edited bolus row and passes the record time", /excludeInjectionId: editedBolus\?\.id \?\? null,\s*at: loggedAt,/.test(calc));
  ok("the IOB effect follows the record time", /\[activeProfile, dataVersion, loggedAt\?\.getTime\(\)\]/.test(calc));

  // ---- Health mirror follows a period change that changes the meal relation ----
  const cp = await load<typeof import("../lib/glucoseCorrectionPatch")>("../lib/glucoseCorrectionPatch");
  if (cp) {
    const prev = { glucose_level_mgdl: 100, period_tag: "fasting" as const, logged_at: "2026-10-28T08:00:00.000Z", tags: [] };
    const same = new Date("2026-10-28T08:00:00.000Z");
    const needs = (period: any) => cp.correctionNeedsMirror(prev, cp.glucoseCorrectionPatch(prev, 100, period, [], same));
    ok("fasting -> post_meal_2h rewrites the mirror (meal relation changed)", needs("post_meal_2h") === true);
    ok("fasting -> pre_meal rewrites the mirror", needs("pre_meal") === true);
    ok("fasting -> bedtime rewrites the mirror (relation dropped)", needs("bedtime") === true);
    ok("bedtime -> manual: no relation either way, no rewrite", cp.correctionNeedsMirror({ ...prev, period_tag: "bedtime" }, cp.glucoseCorrectionPatch({ ...prev, period_tag: "bedtime" }, 100, "manual", [], same)) === false);
    ok("a tags-only edit does not rewrite the mirror", cp.correctionNeedsMirror(prev, cp.glucoseCorrectionPatch(prev, 100, "fasting", ["x" as any], same)) === false);
    ok("a value edit rewrites the mirror", cp.correctionNeedsMirror(prev, cp.glucoseCorrectionPatch(prev, 101, "fasting", [], same)) === true);
  }
  ok("applyGlucoseCorrection gates the mirror on correctionNeedsMirror", /if \(!correctionNeedsMirror\(previous, patch\)\) return;/.test(src("lib", "services", "glucoseEdit.ts")));

  // ---- C-6: dashboard clock ----
  console.log("C-6 dashboard minute clock");
  const mc = await load<typeof import("../lib/minuteClock")>("../lib/minuteClock");
  if (mc) {
    let ticks = 0;
    const live = new Set<number>();
    let nextId = 1;
    const timers = {
      setInterval: (_cb: () => void, ms: number) => {
        ok("interval is one minute", ms === 60_000);
        const id = nextId++;
        live.add(id);
        return id;
      },
      clearInterval: (id: unknown) => void live.delete(id as number),
    };
    let handler: ((s: string) => void) | null = null;
    const appState = {
      currentState: "active",
      addEventListener: (_t: "change", cb: (s: string) => void) => {
        handler = cb;
        return { remove: () => void (handler = null) };
      },
    };
    const stop = mc.startMinuteTick(() => ticks++, appState, timers);
    ok("runs while the app is active", live.size === 1);
    handler!("background");
    ok("no timer in the background", live.size === 0);
    handler!("active");
    ok("a return to the foreground ticks at once and restarts", ticks === 1 && live.size === 1);
    stop();
    ok("stopping (screen blur) clears the timer and the listener", live.size === 0 && handler === null);
    const bgState = { ...appState, currentState: "background" };
    const stop2 = mc.startMinuteTick(() => ticks++, bgState, timers);
    ok("started in the background: no timer yet", live.size === 0);
    stop2();
  }
  const home = src("app", "(tabs)", "index.tsx");
  ok("dashboard stats follow the clock", /const clock = useMinuteClock\(\);/.test(home) && /\[entries, activeProfile, cgmDates, clock\]\);/.test(home));
  ok("the hook runs only while focused", /useFocusEffect\(/.test(src("lib", "useMinuteClock.ts")) && /startMinuteTick\(/.test(src("lib", "useMinuteClock.ts")));

  // ---- C-11 / C-12: Injection form ----
  console.log("C-11 / C-12 injection form defaults");
  const fd = await load<typeof import("../lib/injectionFormDefaults")>("../lib/injectionFormDefaults");
  if (fd) {
    const f = fd.injectionFormDefaults;
    const basalOnly = { insulin_mode: "basal" as const, basal_daily_units: 20 };
    ok("basal-only profile opens on basal with its daily dose, even after a bolus", JSON.stringify(f(basalOnly, "bolus")) === JSON.stringify({ type: "basal", dose: 20 }));
    ok("basal-only profile with no daily dose opens on basal at 0", f({ insulin_mode: "basal", basal_daily_units: null }).dose === 0);
    ok("bolus-only profile opens on bolus, dose empty", JSON.stringify(f({ insulin_mode: "bolus", basal_daily_units: 20 }, "basal")) === JSON.stringify({ type: "bolus", dose: 0 }));
    ok("both: the last entry decides", f({ insulin_mode: "both", basal_daily_units: 18 }, "basal").type === "basal" && f({ insulin_mode: "both", basal_daily_units: 18 }, "bolus").type === "bolus");
    ok("both with no history: bolus", f({ insulin_mode: "both", basal_daily_units: 18 }).type === "bolus");
    ok("no profile: bolus", f(null).type === "bolus");
  }
  const inj = src("app", "(tabs)", "injection.tsx");
  ok("the form starts from the profile's defaults", /useState\(formInit\.dose\)/.test(inj) && /useState<InsulinType>\(formInit\.type\)/.test(inj));
  ok("history seeds the type through the mode rule", /injectionFormDefaults\(activeProfile, hist\[0\]\?\.insulin_type \?\? null\)\.type/.test(inj));
  ok("a profile switch resets the form", /formProfileRef[\s\S]{0,400}typeSeeded\.current = false;[\s\S]{0,300}setSelected\(null\);[\s\S]{0,120}setBolusKind\(null\);[\s\S]{0,80}setNote\(""\);[\s\S]{0,200}\[activeProfile\?\.id\]/.test(inj));
  ok("the profile reset runs before the history load effect", inj.indexOf("formProfileRef = useRef") < inj.indexOf("loadHistory();"));
  ok("C-21 region rule is stated once at the form's save", /Region rule: this tab is region-first \(required\)/.test(inj));

  // ---- C-13: glucose entry label ----
  console.log("C-13 new glucose entry has no label");
  const pt = await import("../lib/periodTag");
  ok("DEFAULT_NEW_READING_PERIOD is unset", (pt as any).DEFAULT_NEW_READING_PERIOD === "unset");
  ok("a plain quick add opens unlabeled", /const DEFAULT_LOG_PERIOD: PeriodTag = DEFAULT_NEW_READING_PERIOD;/.test(home) && /useState<PeriodTag>\(DEFAULT_LOG_PERIOD\)/.test(home));
  ok("the sheet's own default is unlabeled", /initialPeriod = DEFAULT_NEW_READING_PERIOD,/.test(src("components", "GlucoseInputSheet.tsx")));
  ok("the post-meal reminder keeps its label", /setInitialPeriod\("post_meal_2h"\)/.test(home) && /openLogger\("post_meal_2h"\)/.test(home));
  ok("no fasting default is left on the dashboard", !/PeriodTag = "fasting"/.test(home) && !/useState<PeriodTag>\("fasting"\)/.test(home));

  // ---- C-18: missing record ----
  console.log("C-18 missing record");
  const rl = await load<typeof import("../lib/calcRecordLoad")>("../lib/calcRecordLoad");
  if (rl) {
    const log: string[] = [];
    await rl.resolveRecord(async () => ({ id: 1 }), () => log.push("found"), () => log.push("missing"));
    await rl.resolveRecord(async () => null, () => log.push("found"), () => log.push("missing"));
    await rl.resolveRecord(async () => { throw new Error("x"); }, () => log.push("found"), () => log.push("missing"), () => log.push("err"));
    ok("found / null / throw", log.join(",") === "found,missing,err,missing", log.join(","));
  }
  ok("food, template and meal loads all report a missing record", (calc.match(/onRecordMissing/g) ?? []).length >= 4);
  ok("the missing record toasts the new key and closes", /toast\(t\("calculator\.recordNotFound"\), "info"\);\s*dismiss\(\);/.test(calc));
  for (const lang of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
    ok(`calculator.recordNotFound in ${lang}`, /\n    recordNotFound: "[^"]+",\n/.test(src("lib", "i18n", "locales", `${lang}.ts`)));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.log(e);
  process.exit(1);
});
