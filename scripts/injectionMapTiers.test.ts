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

eq("tier 3 outline is heavier", tierStroke(3) > tierStroke(2), true);
eq("tiers 0-2 share one outline", tierStroke(0) === tierStroke(1) && tierStroke(1) === tierStroke(2), true);

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
if (fail > 0) process.exit(1);
