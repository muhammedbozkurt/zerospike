/**
 * components/injectionMap/tiers.ts harness: tier thresholds of the four-step
 * injection map scale, tied to the real USED_FLOOR from lib/injectionHeat.
 *
 * Run: npx tsx scripts/injectionMapTiers.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { heatTier, tierStroke } from "../components/injectionMap/tiers";
import { USED_FLOOR, regionHeatLevel } from "../lib/injectionHeat";

let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${String(got)}${ok ? "" : ` (want ${String(want)})`}`);
}

eq("0 is tier 0", heatTier(0), 0);
eq("negative is tier 0", heatTier(-0.2), 0);
eq("NaN is tier 0", heatTier(NaN), 0);
eq("USED_FLOOR is tier 1", heatTier(USED_FLOOR), 1);
eq("0.339 is tier 1", heatTier(0.339), 1);
eq("0.34 is tier 2", heatTier(0.34), 2);
eq("0.669 is tier 2", heatTier(0.669), 2);
eq("0.67 is tier 3", heatTier(0.67), 3);
eq("1 is tier 3", heatTier(1), 3);
eq("one entry in a long history is tier 1", heatTier(regionHeatLevel(1, 200)), 1);
eq("never used region is tier 0", heatTier(regionHeatLevel(0, 40)), 0);
eq("tier 3 outline is heavier", tierStroke(3) > tierStroke(2), true);
eq("tiers 0-2 share one outline", tierStroke(0) === tierStroke(1) && tierStroke(1) === tierStroke(2), true);

let prev = -1;
let mono = true;
for (let i = 0; i <= 100; i++) {
  const tier = heatTier(i / 100);
  if (tier < prev) mono = false;
  prev = tier;
}
eq("tier never decreases with level", mono, true);

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
if (fail > 0) process.exit(1);
