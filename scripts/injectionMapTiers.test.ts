/**
 * components/injectionMap/tiers.ts harness: outline weight per tier.
 *
 * Run: npx tsx scripts/injectionMapTiers.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { tierStroke } from "../components/injectionMap/tiers";

let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${String(got)}${ok ? "" : ` (want ${String(want)})`}`);
}

eq("tier 4 outline is heavier than tier 3", tierStroke(4) > tierStroke(3), true);
eq("tier 0 carries a frame at least as firm as tiers 1-3", tierStroke(0) >= tierStroke(1), true);
eq("tiers 1-3 share one outline", tierStroke(1) === tierStroke(2) && tierStroke(2) === tierStroke(3), true);
eq("every tier has a visible outline", [0, 1, 2, 3, 4].every((t) => tierStroke(t as 0 | 1 | 2 | 3 | 4) > 0), true);

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
if (fail > 0) process.exit(1);
