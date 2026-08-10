/**
 * Standalone, dependency-free correctness harness for the IOB (active
 * insulin) exponential activity curve, WP2. No jest, compile + run with node:
 *
 *   npx tsc scripts/iob.test.ts lib/iob.ts lib/insulinCatalog.ts \
 *     lib/db/types.ts \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution node --skipLibCheck --esModuleInterop \
 *     --ignoreConfig --ignoreDeprecations 6.0 \
 *   && node .tmp/scripts/iob.test.js
 *
 * Covers: the curve's boundary values (t=0, t=duration), monotonic decay, the
 * peakless/tp>=td/2 linear fallback, bolus-vs-basal separation, and future /
 * expired doses contributing nothing.
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  remainingFraction,
  activeInsulin,
  activeInsulinBreakdown,
  type InsulinActionProfile,
} from "../lib/iob";
import {
  DEFAULT_BOLUS_PROFILE,
  DEFAULT_BASAL_PROFILE,
} from "../lib/insulinCatalog";

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
function close(name: string, actual: number, expected: number, eps = 1e-6): void {
  ok(name, Math.abs(actual - expected) <= eps, `got ${actual}, want ~${expected}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const NOW = new Date("2026-06-25T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const bolus = (units: number, h: number) => ({
  insulin_type: "bolus" as const,
  dose_units: units,
  logged_at: hoursAgo(h),
});
const basal = (units: number, h: number) => ({
  insulin_type: "basal" as const,
  dose_units: units,
  logged_at: hoursAgo(h),
});

// ── A. boundary values of the peaked curve (DEFAULT_BOLUS_PROFILE) ───────────
section("A. remainingFraction: boundary values");
const bp = DEFAULT_BOLUS_PROFILE;
close("t=0 is (near) fully active", remainingFraction(0, bp), 1, 1e-9);
eq("t=duration is fully decayed", remainingFraction(bp.durationHours, bp), 0);
eq("just past duration is 0", remainingFraction(bp.durationHours + 0.1, bp), 0);
eq("t<0 (future dose) is 0", remainingFraction(-0.5, bp), 0);

// ── B. monotonic decay across the whole duration, 0.1h steps ─────────────────
section("B. remainingFraction: monotonic decay");
{
  let prev = remainingFraction(0, bp);
  let monotone = true;
  for (let t = 0.1; t <= bp.durationHours; t += 0.1) {
    const r = remainingFraction(t, bp);
    if (r > prev + 1e-9) monotone = false;
    prev = r;
  }
  ok("bolus curve never increases as t grows", monotone);
}

// ── C. peakless profile (peakHours null) falls back to linear ────────────────
section("C. peakless profile is linear");
const peaklessProfile: InsulinActionProfile = { peakHours: null, durationHours: 24 };
eq("peakless is fully active at t=0", remainingFraction(0, peaklessProfile), 1);
close("peakless t=5 matches 1 - t/duration", remainingFraction(5, peaklessProfile), 1 - 5 / 24, 1e-9);
close("peakless t=12 matches 1 - t/duration", remainingFraction(12, peaklessProfile), 0.5, 1e-9);
eq("peakless t=duration is 0", remainingFraction(24, peaklessProfile), 0);
eq("DEFAULT_BASAL_PROFILE is peakless", DEFAULT_BASAL_PROFILE.peakHours, null);
close(
  "DEFAULT_BASAL_PROFILE decays linearly too",
  remainingFraction(6, DEFAULT_BASAL_PROFILE),
  1 - 6 / DEFAULT_BASAL_PROFILE.durationHours,
  1e-9
);

// ── D. a peaked-but-flat profile (tp >= td/2) also falls back to linear ──────
section("D. tp >= td/2 falls back to linear");
const flatProfile: InsulinActionProfile = { peakHours: 5, durationHours: 8 }; // tp=5 >= td/2=4
close("flat profile t=3 matches linear", remainingFraction(3, flatProfile), 1 - 3 / 8, 1e-9);
close("flat profile t=6 matches linear", remainingFraction(6, flatProfile), 1 - 6 / 8, 1e-9);
{
  const edgeProfile: InsulinActionProfile = { peakHours: 4, durationHours: 8 }; // tp == td/2 exactly
  close("tp == td/2 (boundary) also uses linear", remainingFraction(2, edgeProfile), 1 - 2 / 8, 1e-9);
}

// ── E. activeInsulin: bolus-only, basal excluded ──────────────────────────────
section("E. activeInsulin (bolus only, basal excluded)");
eq("no injections -> 0", activeInsulin([], { now: NOW }), 0);
eq("basal-only injection contributes 0 to activeInsulin", activeInsulin([basal(10, 1)], { now: NOW }), 0);
{
  const frac2h = remainingFraction(2, DEFAULT_BOLUS_PROFILE);
  const expected = Math.round(4 * frac2h * 100) / 100;
  eq("4u bolus 2h ago matches the curve", activeInsulin([bolus(4, 2)], { now: NOW }), expected);
}
{
  // stacked boluses: 4u@2h + 2u@1h with the default (generic rapid) profile
  const frac2h = remainingFraction(2, DEFAULT_BOLUS_PROFILE);
  const frac1h = remainingFraction(1, DEFAULT_BOLUS_PROFILE);
  const expected = Math.round((4 * frac2h + 2 * frac1h) * 100) / 100;
  eq(
    "stacked boluses sum",
    activeInsulin([bolus(4, 2), bolus(2, 1)], { now: NOW }),
    expected
  );
}
eq("a bolus exactly at duration is 0", activeInsulin([bolus(4, DEFAULT_BOLUS_PROFILE.durationHours)], { now: NOW }), 0);
eq("a bolus past duration is 0", activeInsulin([bolus(4, DEFAULT_BOLUS_PROFILE.durationHours + 1)], { now: NOW }), 0);
eq("a future-dated bolus is 0", activeInsulin([bolus(5, -1)], { now: NOW }), 0);
eq("a zero-unit dose is ignored", activeInsulin([bolus(0, 1)], { now: NOW }), 0);

// ── F. activeInsulinBreakdown: bolus and basal tracked separately ────────────
section("F. activeInsulinBreakdown (bolus + basal separated)");
{
  const injections = [bolus(4, 2), basal(10, 5)];
  const breakdown = activeInsulinBreakdown(injections, { now: NOW });
  const expectedBolus = Math.round(4 * remainingFraction(2, DEFAULT_BOLUS_PROFILE) * 100) / 100;
  const expectedBasal = Math.round(10 * remainingFraction(5, DEFAULT_BASAL_PROFILE) * 100) / 100;
  eq("breakdown.bolus matches activeInsulin", breakdown.bolus, expectedBolus);
  eq("breakdown.basal excluded from activeInsulin but present here", breakdown.basal, expectedBasal);
  eq("activeInsulin() equals breakdown.bolus", activeInsulin(injections, { now: NOW }), breakdown.bolus);
}
{
  // future and expired doses of BOTH kinds contribute 0 to the breakdown too
  const injections = [
    bolus(5, -2), // future
    basal(5, -2), // future
    bolus(5, DEFAULT_BOLUS_PROFILE.durationHours + 5), // long expired
    basal(5, DEFAULT_BASAL_PROFILE.durationHours + 5), // long expired
  ];
  const breakdown = activeInsulinBreakdown(injections, { now: NOW });
  eq("future/expired bolus -> 0", breakdown.bolus, 0);
  eq("future/expired basal -> 0", breakdown.basal, 0);
}

// ── G. a custom, user-selected product profile changes the estimate ──────────
section("G. custom bolusProfile/basalProfile options are honoured");
{
  const fastProfile: InsulinActionProfile = { peakHours: 0.75, durationHours: 4 }; // Fiasp-like
  const withDefault = activeInsulin([bolus(4, 2)], { now: NOW });
  const withFast = activeInsulin([bolus(4, 2)], { now: NOW, bolusProfile: fastProfile });
  ok(
    "a faster product decays more by the same elapsed time",
    withFast < withDefault,
    `fast=${withFast} default=${withDefault}`
  );
}

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
