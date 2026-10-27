/**
 * lib/cgm/trend.ts harness: seven steps from the last readings, or null.
 * Run: npx tsx scripts/cgmTrend.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { cgmTrend, type TrendReading } from "../lib/cgm/trend";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${String(got)}, want ${String(want)}`);
  }
}

const T0 = Date.parse("2026-10-27T10:00:00.000Z");
const MIN = 60000;
/** Readings every `step` minutes, the last at minute `(n - 1) * step`, changing by `perMin` mg/dL per minute. */
function run(n: number, step: number, start: number, perMin: number): TrendReading[] {
  return Array.from({ length: n }, (_, i) => ({
    at: T0 + i * step * MIN,
    mgdl: Math.round(start + perMin * i * step),
  }));
}
const endOf = (n: number, step: number) => T0 + (n - 1) * step * MIN;

console.log("seven steps");
eq("+3 per minute is up2", cgmTrend(run(5, 5, 100, 3)), "up2");
eq("+2.5 per minute is up", cgmTrend(run(5, 5, 100, 2.5)), "up");
eq("+2 per minute is up", cgmTrend(run(5, 5, 100, 2)), "up");
eq("+1.5 per minute is up45", cgmTrend(run(5, 5, 100, 1.5)), "up45");
eq("+1 per minute is up45", cgmTrend(run(5, 5, 100, 1)), "up45");
eq("+0.5 per minute is flat", cgmTrend(run(5, 5, 100, 0.5)), "flat");
eq("0 per minute is flat", cgmTrend(run(5, 5, 120, 0)), "flat");
eq("-0.5 per minute is flat", cgmTrend(run(5, 5, 120, -0.5)), "flat");
eq("-1.5 per minute is down45", cgmTrend(run(5, 5, 160, -1.5)), "down45");
eq("-2.5 per minute is down", cgmTrend(run(5, 5, 200, -2.5)), "down");
eq("-3.5 per minute is down2", cgmTrend(run(5, 5, 300, -3.5)), "down2");

console.log("step edges (exact slopes, no rounding)");
const exact = (perMin: number): TrendReading[] =>
  Array.from({ length: 5 }, (_, i) => ({ at: T0 + i * 5 * MIN, mgdl: 200 + perMin * i * 5 }));
for (const [slope, want] of [
  [0.99, "flat"], [1, "up45"], [1.99, "up45"], [2, "up"], [2.99, "up"], [3, "up2"], [5, "up2"],
] as const) {
  eq(`+${slope} per minute`, cgmTrend(exact(slope)), want);
}
for (const [slope, want] of [
  [-0.99, "flat"], [-1, "down45"], [-1.99, "down45"], [-2, "down"], [-2.99, "down"], [-3, "down2"], [-5, "down2"],
] as const) {
  eq(`${slope} per minute`, cgmTrend(exact(slope)), want);
}

console.log("not enough to say");
eq("no readings", cgmTrend([]), null);
eq("two readings", cgmTrend(run(2, 5, 100, 3)), null);
eq("three readings inside two minutes", cgmTrend(run(3, 1, 100, 3)), null);
eq("three readings spanning exactly 10 minutes are enough", cgmTrend(run(3, 5, 100, 3)), "up2");
eq("a span just under 8 minutes is not", cgmTrend(run(3, 3.5, 100, 3)), null);

console.log("window and order");
{
  // A fall 40 to 25 minutes ago, then a flat stretch: only the last 20 minutes count.
  const old = run(4, 5, 220, -4).map((r) => ({ ...r, at: (r.at as number) - 40 * MIN }));
  const recent = run(4, 5, 100, 0);
  eq("older readings outside the window are ignored", cgmTrend([...old, ...recent]), "flat");
  eq("input order does not matter", cgmTrend([...recent].reverse()), "flat");
  eq("ISO strings work", cgmTrend(run(5, 5, 100, 3).map((r) => ({ at: new Date(r.at as number).toISOString(), mgdl: r.mgdl }))), "up2");
  const withBad = [...run(5, 5, 100, 3), { at: "not a date", mgdl: 90 }, { at: T0, mgdl: Number.NaN }];
  eq("unusable readings are skipped", cgmTrend(withBad), "up2");
}

console.log("staleness");
{
  const r = run(5, 5, 100, 3);
  const end = endOf(5, 5);
  eq("fresh against now", cgmTrend(r, end + 5 * MIN), "up2");
  eq("20 minutes old is still used", cgmTrend(r, end + 20 * MIN), "up2");
  eq("older than 20 minutes gives no arrow", cgmTrend(r, end + 21 * MIN), null);
  eq("without now there is no staleness check", cgmTrend(r), "up2");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
