/**
 * components/useEntryGuardConfirm.tsx wiring harness. No jest, standalone
 * style matching scripts/entryGuard.test.ts / scripts/postMealTimer.test.ts.
 *
 * entryGuardMessageKeys() is the pure "notice -> i18n key + vars" step that
 * feeds the confirm dialog; everything else in that file (the hook itself)
 * touches react, react-i18next, the Feedback host, AppContext and the db
 * layer - none of it importable by the plain-node harness this script runs
 * under (the same expo-sqlite constraint scripts/injectionsBolusKind.test.ts
 * documents at lib/db/injections.ts's own TEST-EXTRACT markers). So rather
 * than importing the component module, this test reads the exact
 * TEST-EXTRACT-START/END block out of the real, shipped
 * useEntryGuardConfirm.tsx source, strips its TypeScript types with the
 * `typescript` package (already a project dependency; no type-checking
 * involved, just syntax stripping), and evaluates the resulting JS against
 * the REAL GUARD_WINDOW_MS (lib/entryGuard.ts) and num() (lib/format.ts) -
 * both plain, RN-free modules safe to import directly. The function under
 * test is therefore the real one the app runs, not a hand-copied
 * reimplementation.
 *
 * clampPostMealLateMinutes's windowMin argument (P5a's small carry-over from
 * P2) is imported directly: lib/postMealTimer.ts has no RN imports.
 *
 * Run: npx tsx scripts/entryGuardWire.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import {
  GUARD_WINDOW_MS,
  GUARD_QUERY_LOOKBACK_PAD_MS,
  GUARD_QUERY_LOOKAHEAD_MS,
  guardQueryRange,
  type EntryGuardNotice,
} from "../lib/entryGuard";
import { num } from "../lib/format";
import { clampPostMealLateMinutes, POST_MEAL_LATE_MAX_MIN } from "../lib/postMealTimer";

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
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Pin the real entryGuardMessageKeys out of the shipped component ────────
const SRC_PATH = join(__dirname, "../components/useEntryGuardConfirm.tsx");
const source = readFileSync(SRC_PATH, "utf8");

const START = "// TEST-EXTRACT-START";
const END = "// TEST-EXTRACT-END";
const startIdx = source.indexOf(START);
const endIdx = source.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  throw new Error(
    "entryGuardWire.test.ts: TEST-EXTRACT markers not found in components/useEntryGuardConfirm.tsx - " +
      "the source moved and this test can no longer pin the real function."
  );
}
const extracted = source.slice(startIdx, endIdx);

const { outputText } = ts.transpileModule(extracted, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
});

type MessageKeyEntry = { key: string; vars: Record<string, string | number> };

// `export function` compiles to a CommonJS `exports.entryGuardMessageKeys =
// ...`, so the sandbox needs an `exports` object; GUARD_WINDOW_MS and num are
// passed in as the REAL imported values so the extracted function reads (and
// can be shown to react to) the actual module state, not a copy.
const factory = new Function(
  "exports",
  "GUARD_WINDOW_MS",
  "num",
  `${outputText}\nreturn exports;`
) as (
  exportsObj: Record<string, unknown>,
  guardWindowMs: typeof GUARD_WINDOW_MS,
  numFn: typeof num
) => { entryGuardMessageKeys: (notices: EntryGuardNotice[], formatTimeFn: (iso: string) => string) => MessageKeyEntry[] };

const { entryGuardMessageKeys } = factory({}, GUARD_WINDOW_MS, num);

console.log("zerospike entryGuard wiring test");

const fixedTime = (iso: string): string => `T(${iso})`;
const AT = "2026-08-26T10:00:00.000Z";

section("A. no notices -> empty array");
{
  eq("empty in, empty out", entryGuardMessageKeys([], fixedTime), []);
}

section("B. recent_basal -> entryGuard.recentBasal, h from GUARD_WINDOW_MS");
{
  const notices: EntryGuardNotice[] = [
    { kind: "recent_basal", atIso: AT, detail: { units: 18 } },
  ];
  const out = entryGuardMessageKeys(notices, fixedTime);
  eq("one entry", out.length, 1);
  eq("key", out[0]?.key, "entryGuard.recentBasal");
  eq("h === 6 (GUARD_WINDOW_MS.recent_basal / 1h)", out[0]?.vars.h, 6);
  eq("time went through the injected formatter", out[0]?.vars.time, fixedTime(AT));
  eq("units carried through num()", out[0]?.vars.units, num(18));
}

section("C. recent_bolus/recent_glucose/recent_meal minutes are DERIVED, not hardcoded");
{
  const before = entryGuardMessageKeys(
    [
      { kind: "recent_bolus", atIso: AT },
      { kind: "recent_glucose", atIso: AT },
      { kind: "recent_meal", atIso: AT },
    ],
    fixedTime
  );
  eq("recent_bolus m === 90 (default window)", before[0]?.vars.m, 90);
  eq("recent_glucose m === 10 (default window)", before[1]?.vars.m, 10);
  eq("recent_meal m === 30 (default window)", before[2]?.vars.m, 30);

  // Mutate the REAL GUARD_WINDOW_MS object the extracted function reads from
  // and prove the numbers move with it - a hardcoded 90/10/30 in the source
  // would leave these unchanged.
  const savedBolus = GUARD_WINDOW_MS.recent_bolus;
  const savedGlucose = GUARD_WINDOW_MS.recent_glucose;
  const savedMeal = GUARD_WINDOW_MS.recent_meal;
  try {
    GUARD_WINDOW_MS.recent_bolus = 42 * 60_000;
    GUARD_WINDOW_MS.recent_glucose = 7 * 60_000;
    GUARD_WINDOW_MS.recent_meal = 55 * 60_000;
    const after = entryGuardMessageKeys(
      [
        { kind: "recent_bolus", atIso: AT },
        { kind: "recent_glucose", atIso: AT },
        { kind: "recent_meal", atIso: AT },
      ],
      fixedTime
    );
    eq("recent_bolus m follows the mutated window", after[0]?.vars.m, 42);
    eq("recent_glucose m follows the mutated window", after[1]?.vars.m, 7);
    eq("recent_meal m follows the mutated window", after[2]?.vars.m, 55);
  } finally {
    GUARD_WINDOW_MS.recent_bolus = savedBolus;
    GUARD_WINDOW_MS.recent_glucose = savedGlucose;
    GUARD_WINDOW_MS.recent_meal = savedMeal;
  }
}

section("D. multiple notices keep their order (future_dated first)");
{
  const notices: EntryGuardNotice[] = [
    { kind: "future_dated", atIso: AT },
    { kind: "timer_running", atIso: AT },
    { kind: "recent_basal", atIso: AT, detail: { units: 10 } },
    { kind: "recent_bolus", atIso: AT, detail: { units: 4 } },
    { kind: "recent_glucose", atIso: AT, detail: { valueText: "120 mg/dL" } },
    { kind: "recent_meal", atIso: AT },
  ];
  const out = entryGuardMessageKeys(notices, fixedTime);
  eq("6 entries", out.length, 6);
  eq(
    "key order preserved",
    out.map((o) => o.key),
    [
      "entryGuard.futureDated",
      "entryGuard.timerRunning",
      "entryGuard.recentBasal",
      "entryGuard.recentBolus",
      "entryGuard.recentGlucose",
      "entryGuard.recentMeal",
    ]
  );
  eq("recent_glucose carries value through", out[4]?.vars.value, "120 mg/dL");
}

section("E. missing units leaves vars.units undefined, key still correct");
{
  const out = entryGuardMessageKeys([{ kind: "recent_basal", atIso: AT }], fixedTime);
  eq("key", out[0]?.key, "entryGuard.recentBasal");
  ok("units is undefined", out[0]?.vars.units === undefined);
  ok("units key is absent (not just undefined-valued)", !("units" in (out[0]?.vars ?? {})));

  const outBolus = entryGuardMessageKeys([{ kind: "recent_bolus", atIso: AT }], fixedTime);
  eq("key", outBolus[0]?.key, "entryGuard.recentBolus");
  ok("units is undefined", outBolus[0]?.vars.units === undefined);
}

section("F. clampPostMealLateMinutes(minutes, windowMin) - P2 carry-over");
{
  eq("a wider selected window raises the ceiling", clampPostMealLateMinutes(250, 300), 250);
  eq("a narrower selected window keeps the old 240 floor", clampPostMealLateMinutes(250, 120), 240);
  eq(
    "omitting windowMin keeps the old one-argument behaviour",
    clampPostMealLateMinutes(250),
    POST_MEAL_LATE_MAX_MIN
  );
  eq(
    "the default window (120) does not shrink the old cap",
    clampPostMealLateMinutes(300, 120),
    POST_MEAL_LATE_MAX_MIN
  );
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW_MS = new Date(2026, 7, 26, 10, 0, 0).getTime();
const isoAt = (ms: number): string => new Date(ms).toISOString();

section("R. entryAt = now - 30 h -> the query range still contains entryAt (a far backdated entry is not silently skipped)");
{
  const entryAtMs = NOW_MS - 30 * HOUR;
  const range = guardQueryRange(NOW_MS, isoAt(entryAtMs));
  const sinceMs = Date.parse(range.sinceIso);
  const untilMs = Date.parse(range.untilIso);
  ok("sinceIso <= entryAt", sinceMs <= entryAtMs, `since ${range.sinceIso} vs entryAt ${isoAt(entryAtMs)}`);
  ok("entryAt <= untilIso", entryAtMs <= untilMs, `entryAt ${isoAt(entryAtMs)} vs until ${range.untilIso}`);
}

section("S. entryAt = now + 20 min -> the range contains BOTH now and entryAt");
{
  const entryAtMs = NOW_MS + 20 * MIN;
  const range = guardQueryRange(NOW_MS, isoAt(entryAtMs));
  const sinceMs = Date.parse(range.sinceIso);
  const untilMs = Date.parse(range.untilIso);
  ok("sinceIso <= now", sinceMs <= NOW_MS);
  ok("now <= untilIso", NOW_MS <= untilMs);
  ok("sinceIso <= entryAt", sinceMs <= entryAtMs);
  ok("entryAt <= untilIso", entryAtMs <= untilMs);
}

section("T. entryAt omitted -> the range is centred on now itself");
{
  const range = guardQueryRange(NOW_MS);
  eq("sinceIso = now - lookback", range.sinceIso, isoAt(NOW_MS - (GUARD_WINDOW_MS.recent_basal + GUARD_QUERY_LOOKBACK_PAD_MS)));
  eq("untilIso = now + lookahead", range.untilIso, isoAt(NOW_MS + GUARD_QUERY_LOOKAHEAD_MS));
}

section("U. the lookback pad is DERIVED from GUARD_WINDOW_MS, not a hardcoded 8 h (mutation test)");
{
  const before = guardQueryRange(NOW_MS);
  const savedBasal = GUARD_WINDOW_MS.recent_basal;
  try {
    // Widen the real, live window this function reads from and prove the
    // range's sinceIso moves further back with it - a hardcoded lookback
    // would leave sinceIso unchanged here.
    GUARD_WINDOW_MS.recent_basal = 20 * HOUR;
    const after = guardQueryRange(NOW_MS);
    const beforeSince = Date.parse(before.sinceIso);
    const afterSince = Date.parse(after.sinceIso);
    ok("sinceIso moved earlier as the widest window grew", afterSince < beforeSince, `before ${before.sinceIso}, after ${after.sinceIso}`);
    eq(
      "sinceIso reflects the new widest window plus the fixed pad",
      after.sinceIso,
      isoAt(NOW_MS - (20 * HOUR + GUARD_QUERY_LOOKBACK_PAD_MS))
    );
  } finally {
    GUARD_WINDOW_MS.recent_basal = savedBasal;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
