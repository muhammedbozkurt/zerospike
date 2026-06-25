/**
 * Standalone, dependency-free correctness harness for zerospike's
 * SAFETY-CRITICAL pure math. No jest — compile + run with node:
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

import {
  classifyGlucose,
  glucoseToDisplay,
  glucoseFromDisplay,
  mmolToMgdl,
  MGDL_PER_MMOL,
} from "../lib/glucose";
import { estimateInsulin } from "../lib/insulin";
import { activeInsulin, DEFAULT_DIA_HOURS } from "../lib/iob";
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
    console.log(`  ✗ ${name}${detail ? "  — " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const P = {
  carb_ratio_breakfast: 10,
  carb_ratio_lunch: 12,
  carb_ratio_dinner: 12,
  insulin_sensitivity_factor: 40,
  target_fasting_max: 100,
  target_postmeal_max: 140,
};

// Mapper mirrors lib/services/health.ts: round(pickMgdl(...)) — proves the
// dangerous <30 mmol heuristic is gone.
const importMgdl = (f: { mgdl?: number | null; mmol?: number | null }) => {
  const v = pickMgdl(f);
  return v == null ? 0 : Math.round(v);
};

// ── A. iOS import — value is already mg/dL; sub-30 lows MUST survive ──────────
section("A. iOS import (mg/dL pass-through, no 18x inflation)");
for (const [v, want] of [[22, 22], [25, 25], [18, 18], [28, 28], [29, 29], [30, 30], [95, 95], [396, 396]] as const) {
  eq(`iOS ${v} mg/dL stays ${want}`, importMgdl({ mgdl: v }), want);
}

// ── B. Android import — explicit field, mmol via 18.0182, no guessing ─────────
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

// ── E. estimateInsulin — dose math, warnings, conservative correction ─────────
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
  // Correction targets the post-meal max (140) — the INTENTIONALLY kept
  // conservative behavior (documented in sources.methodNote).
  const e = est(0, 100, { currentGlucose: 180 });
  eq("correction 180 -> 1.0 (target 140)", e.correctionDose, 1.0);
  const e2 = est(0, 100, { currentGlucose: 150 });
  eq("correction 150 -> 0.25 (conservative)", e2.correctionDose, 0.25);
}
{
  const e = est(0, 100, { currentGlucose: 400 }, { ...P, insulin_sensitivity_factor: 500 });
  eq("high ISF 500 corr 0.52", e.correctionDose, 0.52);
  eq("high ISF 500 total 0.5", e.totalDose, 0.5);
  ok("high ISF flags isf_out_of_range", e.warnings.includes("isf_out_of_range"));
}
{
  const e = est(0, 100, { currentGlucose: 400 }); // ISF 40 normal
  eq("normal ISF corr 6.5", e.correctionDose, 6.5);
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
  // SAFETY: a TRUE low (25) yields NO correction — proves the P0 import fix
  // prevents the old fake (450-140)/40 = 7.75 U.
  const e = est(0, 100, { currentGlucose: 25 });
  eq("true-low 25 -> correction 0", e.correctionDose, 0);
  eq("true-low 25 -> total 0", e.totalDose, 0);
}

// ── F. CGM dedup — value-aware + 60s timestamp snap (mirrors logs.ts) ─────────
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

// ── H. Insulin on Board (active insulin, linear DIA decay) ────────────────────
section("H. IOB / active insulin");
const NOW = new Date("2026-06-25T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const bolus = (units: number, h: number) => ({
  insulin_type: "bolus" as const,
  dose_units: units,
  logged_at: hoursAgo(h),
});
eq("no injections -> 0", activeInsulin([], NOW), 0);
eq("4u bolus 2h ago (DIA 4) -> 2.0", activeInsulin([bolus(4, 2)], NOW), 2.0);
eq("6u bolus now -> 6.0", activeInsulin([bolus(6, 0)], NOW), 6.0);
eq("4u bolus exactly DIA ago -> 0", activeInsulin([bolus(4, 4)], NOW), 0);
eq("4u bolus past DIA -> 0", activeInsulin([bolus(4, 5)], NOW), 0);
eq("basal excluded", activeInsulin([{ insulin_type: "basal", dose_units: 10, logged_at: hoursAgo(1) }], NOW), 0);
eq("future injection ignored", activeInsulin([bolus(5, -1)], NOW), 0);
eq("stacked boluses 4u@2h + 2u@1h -> 3.5", activeInsulin([bolus(4, 2), bolus(2, 1)], NOW), 3.5);
eq("DEFAULT_DIA_HOURS is 4", DEFAULT_DIA_HOURS, 4);

section("H2. IOB-aware correction (only ever lowers the dose)");
{
  // correction (220-140)/40 = 2.0; IOB 1.5 -> 0.5; meal carbs 0
  const e = est(0, 100, { currentGlucose: 220, currentIOB: 1.5 });
  eq("IOB trims correction 2.0->0.5", e.correctionDose, 0.5);
  eq("iobReduction 1.5", e.iobReduction, 1.5);
  eq("total 0.5", e.totalDose, 0.5);
}
{
  // IOB exceeds correction -> clamped to 0
  const e = est(0, 100, { currentGlucose: 180, currentIOB: 3 });
  eq("IOB clamps correction to 0", e.correctionDose, 0);
  eq("iobReduction = full correction 1.0", e.iobReduction, 1.0);
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
eq("no readings -> none", derivePatterns([]).length, 0);
eq("below min readings -> none", derivePatterns([sl(150), sl(150), sl(150)]).length, 0);
eq("uniform readings -> none", derivePatterns([sl(100), sl(100), sl(105), sl(95)]).length, 0);
{
  const data = [sl(180, ["stress"]), sl(180, ["stress"]), sl(180, ["stress"]), sl(180, ["stress"]), sl(100), sl(100)];
  const p = derivePatterns(data).find((x) => x.kind === "tag_higher");
  ok("tag_higher detected", !!p);
  if (p && p.kind === "tag_higher") {
    eq("tag is stress", p.tag, "stress");
    eq("tag avg 180", p.avg, 180);
    eq("baseline 153", p.baseline, 153);
    eq("tagged n 4", p.n, 4);
  }
}
{
  const p = derivePatterns([sl(60), sl(60), sl(240), sl(240)]).find((x) => x.kind === "high_variability");
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
    logged_at: NOW.toISOString(),
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

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
