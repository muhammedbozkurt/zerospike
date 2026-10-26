/**
 * CGM-A2: lib/cgm/detect.ts. Which Health source apps are sensors, from the
 * readings alone. Pure, runs under plain tsx.
 *
 * Run: npx tsx scripts/cgmDetect.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  CGM_CADENCE_MIN_SAMPLES,
  detectCgmSource,
  hasSensorCadence,
  maxReadingsIn24h,
  medianGapMs,
  nameHintsCgm,
  type DetectSample,
} from "../lib/cgm/detect";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const MIN = 60_000;
const T0 = Date.parse("2026-03-01T00:00:00.000Z");
const run = (count: number, gapMin: number, extra: Partial<DetectSample> = {}): DetectSample[] =>
  Array.from({ length: count }, (_, i) => ({ atMs: T0 + i * gapMin * MIN, ...extra }));

console.log("zerospike cgm detect test");

section("A. cadence: 36 readings in 24 h, median gap <= 6 min");
{
  eq("36 readings 5 min apart is a sensor", detectCgmSource(run(36, 5)).isCgm, true);
  eq("the reason is the cadence", detectCgmSource(run(36, 5)).reason, "cadence");
  eq("35 readings is not enough", detectCgmSource(run(35, 5)).isCgm, false);
  eq("a 1 minute stream is a sensor", detectCgmSource(run(300, 1)).isCgm, true);
  eq("36 readings 6 min apart still qualify", detectCgmSource(run(36, 6)).isCgm, true);
  eq("36 readings 7 min apart do not", detectCgmSource(run(36, 7)).isCgm, false);
  eq("a day of hourly readings is not a sensor", detectCgmSource(run(24, 60)).isCgm, false);
  eq("a few finger-stick readings are not", detectCgmSource(run(4, 180)).isCgm, false);
  eq("no samples at all", detectCgmSource([]).isCgm, false);
  eq("the threshold constant", CGM_CADENCE_MIN_SAMPLES, 36);
}

section("B. bursts: a 3 hour batch write is measured on its own timestamps");
{
  const day: DetectSample[] = [];
  for (let batch = 0; batch < 8; batch++) {
    for (let i = 0; i < 36; i++) day.push({ atMs: T0 + batch * 180 * MIN + i * 5 * MIN });
  }
  eq("eight 3 hour batches of 5 minute readings", detectCgmSource(day).isCgm, true);
  const sparse = [...run(20, 5), ...run(20, 5).map((s) => ({ atMs: s.atMs + 20 * 3600_000 }))];
  eq("two short bursts hours apart: 40 readings but median gap is 5 min", detectCgmSource(sparse).isCgm, true);
  const spread = run(40, 40);
  eq("40 readings spread 40 min apart over a day are not", detectCgmSource(spread).isCgm, false);
}

section("C. a window anywhere in the range counts, not only the latest day");
{
  const old = run(60, 5);
  const recent = [{ atMs: T0 + 40 * 86_400_000 }, { atMs: T0 + 40 * 86_400_000 + 3 * 3600_000 }];
  eq("a sensor month with a quiet last day", detectCgmSource([...old, ...recent]).isCgm, true);
  eq("hasSensorCadence agrees on sorted input", hasSensorCadence(old.map((s) => s.atMs)), true);
}

section("D. hand-typed readings are never a sensor");
{
  eq("HKWasUserEntered rejects a perfect cadence", detectCgmSource(run(100, 5, { userEntered: true })).isCgm, false);
  eq("Health Connect MANUAL_ENTRY rejects it too", detectCgmSource(run(100, 5, { recordingMethod: 3 })).isCgm, false);
  eq("the reason is manual", detectCgmSource(run(100, 5, { userEntered: true })).reason, "manual");
  const mixed = [...run(100, 5), ...run(50, 1, { userEntered: true }).map((s) => ({ ...s, atMs: s.atMs + 40 * 86_400_000 }))];
  eq("typed readings in the same source do not hide the sensor ones", detectCgmSource(mixed).isCgm, true);
  const typedOnly36 = run(36, 5, { userEntered: true });
  eq("36 typed readings do not make a cadence", detectCgmSource(typedOnly36).isCgm, false);
  eq("recordingMethod 2 (automatic) is not a rejection", detectCgmSource(run(36, 5, { recordingMethod: 2 })).isCgm, true);
}

section("E. specimen and name are boosters, not proof");
{
  eq("interstitial fluid with 12 readings", detectCgmSource(run(12, 5, { specimenSource: 1 })).isCgm, true);
  eq("the reason is a hint", detectCgmSource(run(12, 5, { specimenSource: 1 })).reason, "hint");
  eq("interstitial fluid with 11 readings is not enough", detectCgmSource(run(11, 5, { specimenSource: 1 })).isCgm, false);
  eq("interstitial fluid alone is not enough", detectCgmSource(run(3, 60, { specimenSource: 1 })).isCgm, false);
  eq("capillary blood is finger-stick: no cadence counted", detectCgmSource(run(100, 5, { specimenSource: 2 })).isCgm, false);
  eq("whole blood too", detectCgmSource(run(100, 5, { specimenSource: 6 })).isCgm, false);
  eq(
    "a sensor-named app with 12 readings",
    detectCgmSource(run(12, 5), { sourceApp: "com.dexcom.G7" }).isCgm,
    true
  );
  eq(
    "a sensor-named app with 3 readings is not (a hint needs data)",
    detectCgmSource(run(3, 60), { sourceApp: "com.dexcom.G7" }).isCgm,
    false
  );
  eq(
    "device text counts as a name",
    detectCgmSource(run(14, 5), { sourceApp: "com.example.x", deviceText: "FreeStyle Libre 3" }).isCgm,
    true
  );
  eq("an unrelated name adds nothing", detectCgmSource(run(14, 5), { sourceApp: "com.example.meter" }).isCgm, false);
  eq("the name matcher is case-insensitive", nameHintsCgm("Tk.GlucoData"), true);
  eq("and tolerates nulls", nameHintsCgm(null, undefined, ""), false);
}

section("F. overrides and a source that is already known");
{
  eq("override cgm wins over a manual stream", detectCgmSource(run(5, 60, { userEntered: true }), { override: "cgm" }).isCgm, true);
  eq("override not_cgm wins over a perfect cadence", detectCgmSource(run(100, 5), { override: "not_cgm" }).isCgm, false);
  eq("auto leaves the rules alone", detectCgmSource(run(100, 5), { override: "auto" }).isCgm, true);
  eq("a known sensor stays one after a sensor change", detectCgmSource(run(3, 5), { knownCgm: true }).isCgm, true);
  eq("known does not rescue typed readings", detectCgmSource(run(3, 5, { userEntered: true }), { knownCgm: true }).isCgm, false);
  eq("known does not rescue finger-stick specimens", detectCgmSource(run(3, 5, { specimenSource: 2 }), { knownCgm: true }).isCgm, false);
}

section("G. helpers");
{
  eq("median gap of an even stream", medianGapMs([0, 5 * MIN, 10 * MIN, 15 * MIN]), 5 * MIN);
  eq("median gap with two gaps averages them", medianGapMs([0, 4 * MIN, 10 * MIN]), 5 * MIN);
  eq("median gap of one point is infinite", medianGapMs([0]), Infinity);
  eq("max readings in a 24 h window", maxReadingsIn24h([0, MIN, 25 * 3600_000, 25 * 3600_000 + MIN]), 2);
  const t = Date.now();
  detectCgmSource(run(130_000, 1));
  ok("a 130k-reading stream is classified quickly", Date.now() - t < 1500, `${Date.now() - t} ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
