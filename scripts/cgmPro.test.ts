/**
 * lib/cgm/pro.ts harness: the free tier sees the last 24 hours of the CGM
 * curve, Nightscout is Pro only. Pure, no mocks.
 * Run: npx tsx scripts/cgmPro.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CGM_FREE_CURVE_HOURS, cgmCurveWindowAllowed, nightscoutAllowed } from "../lib/cgm/pro";

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

eq("the free window is 24 hours", CGM_FREE_CURVE_HOURS, 24);
for (const h of [1, 3, 6, 12, 24]) eq(`free: ${h} h is allowed`, cgmCurveWindowAllowed(false, h), true);
for (const h of [25, 48, 72, 168, 336]) eq(`free: ${h} h is not allowed`, cgmCurveWindowAllowed(false, h), false);
eq("free: 24.5 h is over the line", cgmCurveWindowAllowed(false, 24.5), false);
for (const h of [1, 24, 25, 168, 336, 2160]) eq(`pro: ${h} h is allowed`, cgmCurveWindowAllowed(true, h), true);
for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  eq(`free: ${bad} h is refused`, cgmCurveWindowAllowed(false, bad), false);
  eq(`pro: ${bad} h is refused`, cgmCurveWindowAllowed(true, bad), false);
}
eq("nightscout: pro", nightscoutAllowed(true), true);
eq("nightscout: free", nightscoutAllowed(false), false);

const paywall = readFileSync(join(__dirname, "..", "app", "paywall.tsx"), "utf8");
eq("the paywall lists the CGM chip", paywall.includes('t("paywall.chipCgm")'), true);
eq("the chip sits beside the other chips (one entry in the chips list)", (paywall.match(/paywall\.chipCgm/g) ?? []).length, 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
