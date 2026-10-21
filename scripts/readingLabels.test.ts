/**
 * One classification for the journal row, the entry sheet and the Today card.
 * Run: npx tsx scripts/readingLabels.test.ts
 */
import assert from "node:assert/strict";

import { TARGET_DEFAULTS_MGDL } from "../lib/diabetesDefaults";
import {
  classifyGlucose,
  glucoseFromDisplay,
  glucoseToDisplay,
  statusLabelKey,
  summarizeReadings,
  type TargetProfile,
} from "../lib/glucose";
import { todayRangeShare } from "../lib/homeEmpty";

const d = TARGET_DEFAULTS_MGDL.none;
// Fasting target typed as 4.4-5.5 mmol/L, stored in mg/dL like the app does.
const profile: TargetProfile = {
  target_fasting_min: glucoseFromDisplay(4.4, "mmol"),
  target_fasting_max: glucoseFromDisplay(5.5, "mmol"),
  target_postmeal_min: d.postmeal.min,
  target_postmeal_max: d.postmeal.max,
  hypo_threshold_mgdl: 70,
};

// Row, sheet and Today all call this with the entry's own period.
const rowOrSheet = (mmol: number, tag: Parameters<typeof classifyGlucose>[1]) =>
  classifyGlucose(glucoseFromDisplay(mmol, "mmol"), tag, profile);

// 1) The QA case: 7.4 mmol/L (133 mg/dL).
assert.equal(glucoseFromDisplay(7.4, "mmol"), 133);
assert.equal(rowOrSheet(7.4, "fasting"), "high");
assert.equal(rowOrSheet(7.4, "manual"), "normal");
assert.equal(rowOrSheet(7.4, "post_meal_2h"), "normal");

// Today card on the same single fasting reading: same chip and 0% share.
const fastingToday = summarizeReadings([{ mgdl: 133, tag: "fasting" }], profile);
assert.equal(fastingToday.avgMgdl, 133);
assert.equal(fastingToday.avgStatus, classifyGlucose(133, "fasting", profile));
assert.equal(fastingToday.avgStatus, "high");
assert.equal(fastingToday.inRange, 0);
assert.equal(todayRangeShare(fastingToday.total, fastingToday.inRange), 0);
assert.equal(statusLabelKey(fastingToday.avgStatus!), "insights.high");

// Same reading with no period (general context): row and card both "in range".
const manualToday = summarizeReadings([{ mgdl: 133, tag: "manual" }], profile);
assert.equal(manualToday.avgStatus, "normal");
assert.equal(todayRangeShare(manualToday.total, manualToday.inRange), 100);
assert.equal(statusLabelKey(manualToday.avgStatus!), "insights.inRange");

// 2) Boundaries (mmol typed -> mg/dL stored), fasting and general.
const fastingCases: [number, string][] = [
  [3.8, "low"], // 68 mg/dL, under the 70 threshold
  [3.9, "normal"], // 70, not low
  [5.5, "normal"], // 99, the fasting ceiling
  [5.6, "elevated"], // 101
  [7.8, "high"], // 141, over 125% of the ceiling
  [10.0, "high"], // 180
  [13.9, "veryHigh"], // 250
];
for (const [mmol, want] of fastingCases) {
  assert.equal(rowOrSheet(mmol, "fasting"), want, `fasting ${mmol}`);
}
const generalCases: [number, string][] = [
  [3.8, "low"],
  [3.9, "normal"],
  [5.5, "normal"],
  [7.7, "normal"], // 139, inside the post-meal ceiling of 140
  [7.8, "elevated"], // 141
  [10.0, "high"], // 180, over 125% of 140
];
for (const [mmol, want] of generalCases) {
  assert.equal(rowOrSheet(mmol, "manual"), want, `general ${mmol}`);
}

// 3) mg/dL and mmol/L give the same class: a mmol entry is classified from
// its mg/dL conversion, and the display value round-trips to the same class.
for (const tag of ["fasting", "post_meal_2h", "manual", "bedtime"] as const) {
  for (let mgdl = 40; mgdl <= 320; mgdl++) {
    const viaMgdl = classifyGlucose(mgdl, tag, profile);
    const shown = glucoseToDisplay(mgdl, "mmol");
    const typedBack = glucoseFromDisplay(shown, "mmol");
    // Typing the displayed mmol figure may land +-1 mg/dL from the original;
    // the class may only differ if that neighbour straddles a boundary.
    const viaMmol = classifyGlucose(typedBack, tag, profile);
    const neighbours = [typedBack - 1, typedBack, typedBack + 1].map((v) =>
      classifyGlucose(v, tag, profile)
    );
    assert.ok(
      viaMmol === viaMgdl || neighbours.includes(viaMgdl),
      `${tag} ${mgdl} mg/dL (${shown} mmol) ${viaMgdl} vs ${viaMmol}`
    );
  }
}

// 4) Today summary: each reading judged by its own period; mixed periods
// average against the general range.
const mixed = summarizeReadings(
  [
    { mgdl: 133, tag: "fasting" }, // high
    { mgdl: 133, tag: "post_meal_2h" }, // normal
    { mgdl: 90, tag: "fasting" }, // normal
  ],
  profile
);
assert.equal(mixed.total, 3);
assert.equal(mixed.inRange, 2);
assert.equal(mixed.avgMgdl, 119);
assert.equal(mixed.avgStatus, classifyGlucose(119, "manual", profile));
assert.equal(todayRangeShare(mixed.total, mixed.inRange), 67);

const empty = summarizeReadings([], profile);
assert.equal(empty.avgStatus, null);
assert.equal(todayRangeShare(empty.total, empty.inRange), null);

// 5) One vocabulary.
assert.equal(statusLabelKey("normal"), "insights.inRange");
assert.equal(statusLabelKey("low"), "insights.low");
assert.equal(statusLabelKey("elevated"), "insights.high");
assert.equal(statusLabelKey("high"), "insights.high");
assert.equal(statusLabelKey("veryHigh"), "insights.veryHigh");

console.log("readingLabels: ok");
