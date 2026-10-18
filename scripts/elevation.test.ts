/** Run: npx tsx scripts/elevation.test.ts */
import assert from "node:assert/strict";

import { contrast } from "../lib/theme/contrast";
import { elevationFor } from "../lib/theme/elevation";
import { DARK, LIGHT } from "../lib/theme/tokens";

const cases: Array<[string, () => void]> = [
  ["android light card: flat with border", () => {
    const e = elevationFor("card", "light", "android", LIGHT.border) as { elevation: number; borderWidth: number };
    assert.equal(e.elevation, 0);
    assert.ok(e.borderWidth > 0);
  }],
  ["android light sheet and popover: flat", () => {
    assert.equal((elevationFor("sheet", "light", "android", LIGHT.border) as { elevation: number }).elevation, 0);
    const p = elevationFor("popover", "light", "android", LIGHT.border) as { elevation: number; borderWidth: number };
    assert.equal(p.elevation, 0);
    assert.ok(p.borderWidth > 0);
  }],
  ["android dark keeps old elevation", () => {
    assert.deepEqual(elevationFor("card", "dark", "android", DARK.border).elevation, 3);
    assert.deepEqual(elevationFor("sheet", "dark", "android", DARK.border).elevation, 12);
    assert.deepEqual(elevationFor("popover", "dark", "android", DARK.border).elevation, 16);
  }],
  ["ios shadows unchanged", () => {
    const l = elevationFor("card", "light", "ios", LIGHT.border);
    assert.deepEqual(l, {
      shadowColor: "#0F2230", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
    });
    const d = elevationFor("sheet", "dark", "ios", DARK.border);
    assert.deepEqual(d, {
      shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: -8 }, elevation: 12,
    });
  }],
  ["light borderStrong/bg contrast >= 1.5", () => {
    assert.ok(contrast(LIGHT.borderStrong, LIGHT.bg, LIGHT.bg) >= 1.5);
  }],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
if (failed) process.exit(1);
console.log("all passed");
