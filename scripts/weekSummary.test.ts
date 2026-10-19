/**
 * lib/weekSummary.ts: the first-day rule of the dashboard week strip.
 * Run: npx tsx scripts/weekSummary.test.ts
 */
import assert from "node:assert/strict";

import { showWeekBoxes, weekSummaryView } from "../lib/weekSummary";

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

check("no measurement ever: boxes hidden, first-day hint shown", () => {
  const i = { hasAnyReading: false, weekReadings: 0, weekInjections: 0 };
  assert.equal(showWeekBoxes(i), false);
  assert.equal(weekSummaryView(i), "firstHint");
});

check("no measurement ever, but injections logged: still hidden with the hint", () => {
  const i = { hasAnyReading: false, weekReadings: 0, weekInjections: 3 };
  assert.equal(showWeekBoxes(i), false);
  assert.equal(weekSummaryView(i), "firstHint");
});

check("readings this week: boxes shown (existing behavior)", () => {
  const i = { hasAnyReading: true, weekReadings: 4, weekInjections: 0 };
  assert.equal(showWeekBoxes(i), true);
  assert.equal(weekSummaryView(i), "boxes");
});

check("measured before, only injections this week: boxes shown (existing behavior)", () => {
  const i = { hasAnyReading: true, weekReadings: 0, weekInjections: 2 };
  assert.equal(showWeekBoxes(i), true);
});

check("measured before, nothing this week: nothing drawn, no first-day hint", () => {
  const i = { hasAnyReading: true, weekReadings: 0, weekInjections: 0 };
  assert.equal(showWeekBoxes(i), false);
  assert.equal(weekSummaryView(i), "hidden");
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
