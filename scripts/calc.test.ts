/**
 * Standalone, dependency-free correctness harness for zerospike's
 * SAFETY-CRITICAL pure math. No jest, compile + run with node:
 *
 *   npx tsc scripts/calc.test.ts lib/glucose.ts lib/insulin.ts lib/iob.ts \
 *     lib/services/healthMath.ts lib/db/types.ts \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution node --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/calc.test.js
 *
 * Covers the Phase 0 audit matrix: iOS/Android glucose import (no mmol
 * heuristic), mmol<->mg/dL round-trip, classifyGlucose boundaries incl. the
 * distinct hypo "low" state, estimateInsulin dose math + plausibility warnings,
 * the (intentionally conservative, unchanged) correction behavior, and the
 * value-aware + timestamp-snapped CGM dedup.
 */

// Minimal ambient decls so we need no @types/node / dom lib.
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
declare function require(id: string): any;

import {
  classifyGlucose,
  glucoseToDisplay,
  glucoseFromDisplay,
  mmolToMgdl,
  MGDL_PER_MMOL,
} from "../lib/glucose";
import {
  checkDose,
  estimateInsulin,
  PLAUSIBLE_CARB_RATIO,
} from "../lib/insulin";
import {
  GLUCOSE_INPUT_CEILING,
  glucoseAboveCeiling,
  parseDecimalText,
  sanitizeDecimalText,
  sanitizeIntegerText,
  sanitizeNumberText,
} from "../lib/numberInput";
import { activeInsulin } from "../lib/iob";
import { DEFAULT_BOLUS_PROFILE } from "../lib/insulinCatalog";
import { derivePatterns } from "../lib/insights";
import { percentile, computeAgp } from "../lib/agp";
import { snapIso, pickMgdl } from "../lib/services/healthMath";
import type { SugarLog, LogTag } from "../lib/db/types";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

/* Some of the fixes below live in a screen or in SQL, where there is no pure
 * function to call. Those are pinned by reading the source, so the exact
 * regression (an unfiltered DELETE, a comma-stripping filter, an estimate
 * overwriting a typed dose) fails this harness instead of shipping. */
const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};
const nodePath = require("path") as {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};

const ROOT = (() => {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(nodePath.join(dir, "package.json")) &&
      fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"))
    ) {
      return dir;
    }
    dir = nodePath.dirname(dir);
  }
  throw new Error("could not locate the repo root from " + __dirname);
})();

function src(rel: string): string {
  return fs.readFileSync(nodePath.join(ROOT, rel), "utf8");
}

// Schema v8: targets are RANGES and the low threshold is the user's own.
const P = {
  carb_ratio_breakfast: 10,
  carb_ratio_lunch: 12,
  carb_ratio_dinner: 12,
  insulin_sensitivity_factor: 40,
  target_fasting_min: 80,
  target_fasting_max: 100,
  target_postmeal_min: 80,
  target_postmeal_max: 140,
  hypo_threshold_mgdl: 70,
};

// Mapper mirrors lib/services/health.ts: round(pickMgdl(...)), proves the
// dangerous <30 mmol heuristic is gone.
const importMgdl = (f: { mgdl?: number | null; mmol?: number | null }) => {
  const v = pickMgdl(f);
  return v == null ? 0 : Math.round(v);
};

// ── A. iOS import, value is already mg/dL; sub-30 lows MUST survive ──────────
section("A. iOS import (mg/dL pass-through, no 18x inflation)");
for (const [v, want] of [[22, 22], [25, 25], [18, 18], [28, 28], [29, 29], [30, 30], [95, 95], [396, 396]] as const) {
  eq(`iOS ${v} mg/dL stays ${want}`, importMgdl({ mgdl: v }), want);
}

// ── B. Android import, explicit field, mmol via 18.0182, no guessing ─────────
section("B. Android import (explicit field selection)");
eq("mg/dL field wins over mmol", importMgdl({ mgdl: 25, mmol: 1.4 }), 25);
eq("mg/dL 28 stays 28", importMgdl({ mgdl: 28 }), 28);
eq("mmol 1.4 -> 25", importMgdl({ mmol: 1.4 }), 25);
eq("mmol 12 -> 216", importMgdl({ mmol: 12 }), 216);
eq("mmol 27.5 -> 496", importMgdl({ mmol: 27.5 }), 496);
eq("mmol 5.8 -> 105", importMgdl({ mmol: 5.8 }), 105);
eq("mmol 33.3 (DKA) -> 600", importMgdl({ mmol: 33.3 }), 600);

// ── C. mmol <-> mg/dL round-trip drift bound (<= 1 mg/dL across 40..400) ──────
section("C. round-trip drift <= 1 mg/dL (40..400)");
let maxDrift = 0;
for (let v = 40; v <= 400; v++) {
  const back = glucoseFromDisplay(glucoseToDisplay(v, "mmol"), "mmol");
  maxDrift = Math.max(maxDrift, Math.abs(back - v));
}
ok(`max round-trip drift ${maxDrift} <= 1`, maxDrift <= 1, `maxDrift=${maxDrift}`);
eq("100 mg/dL round-trips to 99", glucoseFromDisplay(glucoseToDisplay(100, "mmol"), "mmol"), 99);

// ── D. classifyGlucose boundaries incl. distinct hypo "low" ───────────────────
section("D. classifyGlucose (hypo is a distinct 'low')");
const C = (v: number, tag: "fasting" | "post_meal_2h") => classifyGlucose(v, tag, P);
eq("40 fasting -> low", C(40, "fasting"), "low");
eq("55 fasting -> low", C(55, "fasting"), "low");
eq("62 fasting -> low", C(62, "fasting"), "low");
eq("69 fasting -> low", C(69, "fasting"), "low");
eq("22 fasting -> low (the P0 true-low value)", C(22, "fasting"), "low");
eq("70 fasting -> normal", C(70, "fasting"), "normal");
eq("100 fasting -> normal", C(100, "fasting"), "normal");
eq("120 fasting -> elevated", C(120, "fasting"), "elevated");
eq("125 fasting -> elevated", C(125, "fasting"), "elevated");
eq("126 fasting -> high", C(126, "fasting"), "high");
eq("140 post_meal -> normal", C(140, "post_meal_2h"), "normal");
eq("175 post_meal -> elevated", C(175, "post_meal_2h"), "elevated");
eq("176 post_meal -> high", C(176, "post_meal_2h"), "high");
eq("240 post_meal -> high", C(240, "post_meal_2h"), "high");
// A value between the hypo threshold and the band's low end is NOT a low: the
// low end of a target band is a preference, the threshold is the clinical event.
eq("75 fasting -> normal (above hypo, under the band)", C(75, "fasting"), "normal");
// The fixed clinical ceiling outranks any personal range.
eq("250 post_meal -> veryHigh", C(250, "post_meal_2h"), "veryHigh");
eq("400 fasting -> veryHigh", C(400, "fasting"), "veryHigh");
eq("249 post_meal -> high (just under the ceiling)", C(249, "post_meal_2h"), "high");

// ── D2. checkDose, the hand-entered dose plausibility gate ──────────────────
section("D2. checkDose (confirm, never refuse)");
eq("6 units -> ok", checkDose(6), "ok");
eq("24.9 units -> ok", checkDose(24.9), "ok");
eq("25 units -> high", checkDose(25), "high");
eq("60 units -> high", checkDose(60), "high");
eq("100 units -> implausible", checkDose(100), "implausible");
eq("600 units (stray digit) -> implausible", checkDose(600), "implausible");

// ── E. estimateInsulin, dose math, warnings, conservative correction ─────────
section("E. estimateInsulin (math + guardrails)");
const est = (carb100: number, portion: number, opts: any = {}, prof: any = P) =>
  estimateInsulin({ carb_100g: carb100 }, portion, prof, { slot: "breakfast", ...opts });

{
  const e = est(2.0, 120); // low-carb
  eq("low-carb carbs", e.carbs, 2.4);
  eq("low-carb mealDose", e.mealDose, 0.24);
  eq("low-carb total rounds to 0", e.totalDose, 0);
  eq("low-carb no warnings", e.warnings.length, 0);
}
{
  const e = est(8, 100, {}, { ...P, carb_ratio_breakfast: 40 }); // low-carb high-ratio
  eq("high-ratio total 0", e.totalDose, 0);
}
{
  const e = est(22.5, 100); // .25 pen-rounding bias
  eq(".25 mealDose", e.mealDose, 2.25);
  eq(".25 total -> 2.5", e.totalDose, 2.5);
}
{
  // Correction targets the MIDDLE of the post-meal range, never its ceiling
  // (lib/insulin.ts, stated in words on the calculator screen).
  // Range midpoint is (80 + 140) / 2 = 110, so (180 - 110) / 40 = 1.75.
  const e = est(0, 100, { currentGlucose: 180 });
  eq("correction 180 -> 1.75 (target = range midpoint 110)", e.correctionDose, 1.75);
  const e2 = est(0, 100, { currentGlucose: 150 });
  eq("correction 150 -> 1.0", e2.correctionDose, 1.0);
}
{
  const e = est(0, 100, { currentGlucose: 400 }, { ...P, insulin_sensitivity_factor: 500 });
  eq("high ISF 500 corr 0.58", e.correctionDose, 0.58);
  eq("high ISF 500 total 0.5", e.totalDose, 0.5);
  ok("high ISF flags isf_out_of_range", e.warnings.includes("isf_out_of_range"));
}
{
  const e = est(0, 100, { currentGlucose: 400 }); // ISF 40 normal
  eq("normal ISF corr 7.25", e.correctionDose, 7.25);
  ok("normal ISF no isf warning", !e.warnings.includes("isf_out_of_range"));
}
{
  // carb ratio typo: 1 instead of 10 -> 60 U; high_dose guard must fire.
  const e = est(50, 120, {}, { ...P, carb_ratio_breakfast: 1 });
  eq("ratio-typo total 60", e.totalDose, 60);
  ok("ratio-typo fires high_dose", e.warnings.includes("high_dose"));
}
{
  // implausibly small ratio -> floored defensively AND flagged.
  const e = est(50, 100, {}, { ...P, carb_ratio_breakfast: 0.05 });
  ok("tiny ratio flags carb_ratio_out_of_range", e.warnings.includes("carb_ratio_out_of_range"));
}
{
  // SAFETY: a TRUE low (25) yields NO correction, proves the P0 import fix
  // prevents the old fake (450-140)/40 = 7.75 U.
  const e = est(0, 100, { currentGlucose: 25 });
  eq("true-low 25 -> correction 0", e.correctionDose, 0);
  eq("true-low 25 -> total 0", e.totalDose, 0);
}

// ── F. CGM dedup, value-aware + 60s timestamp snap (mirrors logs.ts) ─────────
section("F. dedup (snap + value-aware)");
const key = (ts: string, source: string, mgdl: number) => `${snapIso(ts)}|${source}|${mgdl}`;
const T0 = "2026-06-25T08:00:00.000Z";
const T0ms = "2026-06-25T08:00:00.123Z";
const T5 = "2026-06-25T08:05:00.000Z";
ok("distinct values same ts kept (95 vs 42)", key(T0, "health", 95) !== key(T0, "health", 42));
ok("identical sample dedups", key(T0, "health", 180) === key(T0, "health", 180));
ok("sub-second drift collapses", key(T0ms, "health", 180) === key(T0, "health", 180));
ok("drift + different value stays distinct", key(T0ms, "health", 180) !== key(T0, "health", 95));
ok("cross-source kept", key(T0, "manual", 110) !== key(T0, "health", 108));
ok("5-min apart stays distinct", key(T5, "health", 180) !== key(T0, "health", 180));

// ── G. single canonical mmol constant (no rounded 18) ─────────────────────────
section("G. canonical constant 18.0182");
eq("MGDL_PER_MMOL is 18.0182", MGDL_PER_MMOL, 18.0182);
eq("19.4 mmol -> 350 (not 349)", Math.round(mmolToMgdl(19.4)), 350);
let constOk = true;
for (let m = 1; m <= 30; m++) constOk = constOk && mmolToMgdl(m) === m * MGDL_PER_MMOL;
ok("mmolToMgdl uses MGDL_PER_MMOL for 1..30", constOk);

// ── H. Insulin on Board (active insulin) ──────────────────────────────────────
// The decay curve itself is covered in scripts/iob.test.ts; what matters here is
// only which rows the estimator is allowed to count.
section("H. IOB / active insulin");
const NOW = new Date("2026-06-25T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const DIA = DEFAULT_BOLUS_PROFILE.durationHours;
const bolus = (units: number, h: number) => ({
  insulin_type: "bolus" as const,
  dose_units: units,
  logged_at: hoursAgo(h),
});
eq("no injections -> 0", activeInsulin([], { now: NOW }), 0);
eq("6u bolus now -> 6.0", activeInsulin([bolus(6, 0)], { now: NOW }), 6.0);
eq("4u bolus exactly DIA ago -> 0", activeInsulin([bolus(4, DIA)], { now: NOW }), 0);
eq("4u bolus past DIA -> 0", activeInsulin([bolus(4, DIA + 1)], { now: NOW }), 0);
eq(
  "basal excluded",
  activeInsulin([{ insulin_type: "basal", dose_units: 10, logged_at: hoursAgo(1) }], { now: NOW }),
  0
);
eq("future injection ignored", activeInsulin([bolus(5, -1)], { now: NOW }), 0);
{
  const mid = activeInsulin([bolus(4, 2)], { now: NOW });
  ok("4u bolus 2h ago decays into (0, 4)", mid > 0 && mid < 4);
  const stacked = activeInsulin([bolus(4, 2), bolus(2, 1)], { now: NOW });
  ok("stacked boluses exceed either alone", stacked > mid);
}

section("H2. IOB-aware correction (only ever lowers the dose)");
{
  // correction (220-110)/40 = 2.75; IOB 1.5 -> 1.25; meal carbs 0
  const e = est(0, 100, { currentGlucose: 220, currentIOB: 1.5 });
  eq("IOB trims correction 2.75->1.25", e.correctionDose, 1.25);
  eq("iobReduction 1.5", e.iobReduction, 1.5);
  eq("total 1.5", e.totalDose, 1.5);
}
{
  // IOB exceeds correction -> clamped to 0
  const e = est(0, 100, { currentGlucose: 180, currentIOB: 3 });
  eq("IOB clamps correction to 0", e.correctionDose, 0);
  eq("iobReduction = full correction 1.75", e.iobReduction, 1.75);
}
{
  // no correction to trim (glucose below target) -> IOB does nothing
  const e = est(0, 100, { currentGlucose: 100, currentIOB: 2 });
  eq("no correction -> iobReduction 0", e.iobReduction, 0);
}
{
  // IOB NEVER touches the meal dose (60g/10 = 6.0), no correction
  const e = est(60, 100, { currentGlucose: 100, currentIOB: 5 });
  eq("meal dose untouched by IOB", e.totalDose, 6);
  eq("iobReduction 0 on meal-only", e.iobReduction, 0);
}

// ── I. actionable insight patterns (descriptive, min-sample gated) ────────────
section("I. insight patterns");
let slN = 0;
const sl = (mgdl: number, tags: LogTag[] = []): SugarLog => {
  slN++;
  return {
    id: `s${slN}`,
    profile_id: "p",
    glucose_level_mgdl: mgdl,
    period_tag: "manual",
    source: "manual",
    logged_at: new Date(NOW.getTime() - slN * 60_000).toISOString(),
    tags,
  };
};
// Fixture timestamps hang off the fixed NOW above; derivePatterns windows off
// the real clock when no range is given, so these tests must pin an explicit
// range or they start failing once real time drifts past NOW + windowDays.
const PATTERN_RANGE = { start: NOW.getTime() - 86_400_000, end: NOW.getTime() };
eq("no readings -> none", derivePatterns([], undefined, PATTERN_RANGE).length, 0);
eq("below min readings -> none", derivePatterns([sl(150), sl(150), sl(150)], undefined, PATTERN_RANGE).length, 0);
eq("uniform readings -> none", derivePatterns([sl(100), sl(100), sl(105), sl(95)], undefined, PATTERN_RANGE).length, 0);
{
  const data = [sl(180, ["stress"]), sl(180, ["stress"]), sl(180, ["stress"]), sl(180, ["stress"]), sl(100), sl(100)];
  const p = derivePatterns(data, undefined, PATTERN_RANGE).find((x) => x.kind === "tag_higher");
  ok("tag_higher detected", !!p);
  if (p && p.kind === "tag_higher") {
    eq("tag is stress", p.tag, "stress");
    eq("tag avg 180", p.avg, 180);
    eq("baseline 153", p.baseline, 153);
    eq("tagged n 4", p.n, 4);
  }
}
{
  const p = derivePatterns([sl(60), sl(60), sl(240), sl(240)], undefined, PATTERN_RANGE).find((x) => x.kind === "high_variability");
  ok("high_variability detected", !!p);
  if (p && p.kind === "high_variability") eq("cv 69", p.cv, 69);
}

// ── J. AGP percentiles ────────────────────────────────────────────────────────
section("J. AGP percentiles");
eq("p50 of 5 -> middle", percentile([10, 20, 30, 40, 50], 50), 30);
eq("p50 of 4 -> interp", percentile([10, 20, 30, 40], 50), 25);
eq("p0 -> first", percentile([10, 20, 30], 0), 10);
eq("p100 -> last", percentile([10, 20, 30], 100), 30);
eq("single value", percentile([42], 50), 42);
eq("empty -> 0", percentile([], 50), 0);
{
  // 5 readings at one instant -> one hour bucket, asserted percentiles
  const at = (mgdl: number): SugarLog => ({
    id: `a${mgdl}`,
    profile_id: "p",
    glucose_level_mgdl: mgdl,
    period_tag: "manual",
    source: "manual",
    logged_at: new Date().toISOString(),
    tags: [],
  });
  const agp = computeAgp([at(60), at(100), at(140), at(180), at(220)]);
  eq("AGP total readings", agp.totalReadings, 5);
  eq("AGP one hour bucket", agp.bands.length, 1);
  if (agp.bands[0]) {
    eq("band n", agp.bands[0].n, 5);
    eq("band p50", agp.bands[0].p50, 140);
    eq("band p25", agp.bands[0].p25, 100);
    eq("band p75", agp.bands[0].p75, 180);
    eq("band p05", agp.bands[0].p05, 68);
    eq("band p95", agp.bands[0].p95, 212);
  }
}

// ── K. numeric input normalization (ONE normalizer, comma is a decimal) ───────
section("K. numeric input (decimal separator)");
eq('sanitize keeps the typed comma "5,5"', sanitizeDecimalText("5,5"), "5,5");
eq('parse "5,5" -> 5.5', parseDecimalText("5,5"), 5.5);
eq('parse "5.5" -> 5.5', parseDecimalText("5.5"), 5.5);
eq('second separator ignored "5,5,5"', sanitizeDecimalText("5,5,5"), "5,55");
eq('parse "5,5,5" -> 5.55', parseDecimalText("5,5,5"), 5.55);
eq('second dot ignored "1.2.3"', sanitizeDecimalText("1.2.3"), "1.23");
eq('parse "12,5,5" -> 12.55', parseDecimalText("12,5,5"), 12.55);
eq("letters dropped", sanitizeDecimalText("a1b,2c"), "1,2");
eq("integer field drops separators", sanitizeIntegerText("1,2.3"), "123");
eq("sanitizeNumberText(decimals) keeps comma", sanitizeNumberText("5,5", true), "5,5");
eq("sanitizeNumberText(integer) digits only", sanitizeNumberText("5,5", false), "55");
eq("empty text is NOT a value", parseDecimalText(""), null);
eq("separator only is NOT a value", parseDecimalText(","), null);
eq("non-numeric is NOT a value", parseDecimalText("abc"), null);
eq('"0" parses to 0, never null', parseDecimalText("0"), 0);
eq('"0,0" parses to 0', parseDecimalText("0,0"), 0);
eq('trailing separator "5," -> 5', parseDecimalText("5,"), 5);
eq('leading separator ",5" -> 0.5', parseDecimalText(",5"), 0.5);

// The P0 regression itself: "5,5" typed on a comma-decimal keyboard must stay
// 5.5 mmol/L (99 mg/dL) and produce NO correction. The old filter stripped the
// comma into 55 mmol/L -> 991 mg/dL -> a ~22 unit fictional correction that sat
// just under the 25 unit high-dose guard, so it saved with zero notices.
section("K2. the comma regression end to end");
{
  const typed = parseDecimalText("5,5");
  ok('"5,5" is a value', typed != null);
  eq('"5,5" mmol -> 99 mg/dL', glucoseFromDisplay(typed ?? 0, "mmol"), 99);
  const e = est(0, 100, { currentGlucose: glucoseFromDisplay(typed ?? 0, "mmol") });
  eq('"5,5" mmol yields no correction', e.correctionDose, 0);
  eq('"5,5" mmol yields total 0', e.totalDose, 0);
  // What the stripped value used to become, kept as the counter-case.
  const stripped = est(0, 100, { currentGlucose: glucoseFromDisplay(55, "mmol") });
  ok("55 mmol would have produced a large phantom dose", stripped.totalDose >= 20);
  ok(
    "55 mmol is described as above the meter range",
    glucoseAboveCeiling(55, "mmol")
  );
}
eq("mmol ceiling is 33.3", GLUCOSE_INPUT_CEILING.mmol, 33.3);
eq("mg/dL ceiling is 600", GLUCOSE_INPUT_CEILING.mgdl, 600);
eq("33.3 mmol is not above the ceiling", glucoseAboveCeiling(33.3, "mmol"), false);
eq("33.4 mmol is above the ceiling", glucoseAboveCeiling(33.4, "mmol"), true);
eq("600 mg/dL is not above the ceiling", glucoseAboveCeiling(600, "mgdl"), false);
eq("601 mg/dL is above the ceiling", glucoseAboveCeiling(601, "mgdl"), true);
eq("no value is never above the ceiling", glucoseAboveCeiling(null, "mgdl"), false);

// ── L. what the dose field stores (empty vs 0) ────────────────────────────────
section("L. manual dose: empty is not 0, and 0 is not the estimate");
// Mirrors app/calculator.tsx logMeal: a typed number wins (including 0), an
// EMPTY field asks before anything is written.
const storedDose = (text: string): number | "ask" => {
  const typed = parseDecimalText(text);
  return typed == null ? "ask" : typed;
};
eq("typed 0 stores 0", storedDose("0"), 0);
eq("typed 0,0 stores 0", storedDose("0,0"), 0);
eq("typed 3,5 stores 3.5", storedDose("3,5"), 3.5);
eq("empty field asks instead of storing", storedDose(""), "ask");
ok("typed 0 is never swapped for the estimate", storedDose("0") !== 7);
// The old expression, kept to prove why it was wrong.
ok(
  "old `parseFloat(text) || estimate` turned a declared 0 into a phantom dose",
  (parseFloat("0") || 7) === 7
);

// ── M. ISF <= 0 : correction dropped OUT LOUD, never in silence ───────────────
section("M. ISF guard");
{
  const e = est(0, 100, { currentGlucose: 300 }, { ...P, insulin_sensitivity_factor: 0 });
  eq("ISF 0 -> no correction", e.correctionDose, 0);
  eq("ISF 0 -> reason reported", e.correctionSkipped, "isf_invalid");
  ok("ISF 0 flags isf_out_of_range", e.warnings.includes("isf_out_of_range"));
}
{
  const e = est(0, 100, { currentGlucose: 300 }, { ...P, insulin_sensitivity_factor: -40 });
  eq("negative ISF -> no correction", e.correctionDose, 0);
  eq("negative ISF -> reason reported", e.correctionSkipped, "isf_invalid");
  ok("negative ISF flags isf_out_of_range", e.warnings.includes("isf_out_of_range"));
}
{
  const e = est(60, 100, {}, { ...P, insulin_sensitivity_factor: 0 });
  eq("no reading -> nothing to skip", e.correctionSkipped, null);
  ok("ISF 0 still flagged without a reading", e.warnings.includes("isf_out_of_range"));
  eq("meal dose unaffected by the ISF flag", e.totalDose, 6);
}
{
  const e = est(0, 100, { currentGlucose: 180 });
  eq("valid ISF -> no skip reason", e.correctionSkipped, null);
}
{
  const e = est(0, 100, { currentGlucose: 3 }, { ...P, insulin_sensitivity_factor: 2 });
  ok("ISF 2 (under the band) is flagged", e.warnings.includes("isf_out_of_range"));
}

// ── N. carb-ratio band actually catches the "1 instead of 10" typo ────────────
section("N. carb ratio plausibility band");
ok(`min ${PLAUSIBLE_CARB_RATIO.min} >= 3`, PLAUSIBLE_CARB_RATIO.min >= 3);
{
  const e = est(50, 120, {}, { ...P, carb_ratio_breakfast: 1 });
  ok("ratio 1 flags carb_ratio_out_of_range", e.warnings.includes("carb_ratio_out_of_range"));
  ok("ratio 1 still flags high_dose", e.warnings.includes("high_dose"));
}
{
  const e = est(50, 120, {}, { ...P, carb_ratio_breakfast: 2.9 });
  ok("ratio 2.9 flagged", e.warnings.includes("carb_ratio_out_of_range"));
}
{
  const e = est(20, 100, {}, { ...P, carb_ratio_breakfast: 3 });
  ok("ratio 3 accepted", !e.warnings.includes("carb_ratio_out_of_range"));
}
{
  const e = est(20, 100, {}, { ...P, carb_ratio_breakfast: 10 });
  ok("ratio 10 accepted", !e.warnings.includes("carb_ratio_out_of_range"));
}
{
  const e = est(20, 100, {}, { ...P, carb_ratio_breakfast: 51 });
  ok("ratio 51 flagged", e.warnings.includes("carb_ratio_out_of_range"));
}

// ── O. source guards for the fixes that live outside pure math ────────────────
// Data loss, profile hand-over, input filters and the save-time IOB read are all
// screen/DB level. They have no pure function to call, so they are pinned here:
// each check fails the moment the exact regression is reintroduced.
section("O. source guards (data scope, profile hand-over, input filters)");
{
  const dbIndex = src("lib/db/index.ts");
  ok(
    "clearAllLogs takes a profileId",
    /export async function clearAllLogs\(\s*profileId: string/.test(dbIndex)
  );
  for (const table of ["injection_logs", "meal_logs", "sugar_logs"]) {
    ok(
      `clearAllLogs scopes ${table} to one profile`,
      new RegExp(`DELETE FROM ${table} WHERE profile_id = \\?`).test(dbIndex)
    );
  }
  ok(
    "no unfiltered log DELETE survives",
    !/DELETE FROM (injection_logs|meal_logs|sugar_logs);/.test(dbIndex)
  );

  const dataScreen = src("app/settings/data.tsx");
  ok(
    "the clear action passes the active profile",
    /clearAllLogs\(activeProfile\.id\)/.test(dataScreen)
  );
  ok(
    "the confirm dialog names the profile",
    /clearLogsConfirm", \{ name: activeProfile\.name \}/.test(dataScreen)
  );
  ok(
    "deleting a profile hands over to a remaining one",
    /listProfiles\(\)/.test(dataScreen) && /setActiveProfileId\(next\.id\)/.test(dataScreen)
  );
  ok(
    "with no profile left it routes to profile setup",
    /router\.replace\("\/profile-setup"\)/.test(dataScreen)
  );

  const ctx = src("lib/store/AppContext.tsx");
  ok(
    "the context never keeps a deleted active profile",
    /const next = list\[0\] \?\? \(await getDefaultProfile\(\)\)/.test(ctx)
  );

  const calc = src("app/calculator.tsx");
  ok(
    "the estimate no longer overwrites a typed dose",
    !/\|\| estimate\.totalDose/.test(calc)
  );
  ok(
    "IOB is re-read at save time",
    /const freshIob = await readFreshIob\(\)/.test(calc)
  );
  ok(
    "a low reading gets a descriptive note",
    /calculator\.lowReadingNote/.test(calc)
  );
  ok(
    "a dropped correction states its reason",
    /calculator\.correctionOffIsf/.test(calc)
  );
  ok(
    "an empty dose field is asked about before the write",
    /calculator\.emptyDoseTitle/.test(calc) && /calculator\.emptyDoseBody/.test(calc)
  );
  ok(
    "a refreshed estimate is shown, not stored silently",
    /calculator\.iobRefreshedBody/.test(calc)
  );

  for (const rel of ["components/Stepper.tsx", "components/RangeInput.tsx"]) {
    const s = src(rel);
    ok(
      `${rel} uses the shared normalizer`,
      /sanitizeNumberText\(/.test(s) && /parseDecimalText\(/.test(s)
    );
    ok(
      `${rel} has no local decimal filter`,
      !/replace\(\/\[\^0-9/.test(s)
    );
  }

  for (const rel of ["app/calculator.tsx", "components/GlucoseInputSheet.tsx"]) {
    const s = src(rel);
    ok(
      `${rel} routes input through the shared normalizer`,
      /sanitizeNumberText\(/.test(s) && /parseDecimalText\(/.test(s)
    );
    ok(
      `${rel} no longer strips the comma from a decimal field`,
      !/\[\^0-9\.\]/.test(s)
    );
  }
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
