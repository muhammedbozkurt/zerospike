/** Run: npx tsx scripts/switchContrast.test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { contrast } from "../lib/theme/contrast";
import { DARK, LIGHT, switchColors } from "../lib/theme/tokens";

const cases: Array<[string, () => void]> = [
  ["light off track >= 3:1 against white surface and sand bg", () => {
    assert.ok(contrast(LIGHT.switchTrackOff, LIGHT.surface, LIGHT.bg) >= 3);
    assert.ok(contrast(LIGHT.switchTrackOff, LIGHT.bg, LIGHT.bg) >= 3);
  }],
  ["light white thumb reads on the off track (>= 3:1)", () => {
    assert.ok(contrast("#FFFFFF", LIGHT.switchTrackOff, LIGHT.bg) >= 3);
  }],
  ["dark off track >= 3:1 against bg and card, thumb reads on it", () => {
    assert.ok(contrast(DARK.switchTrackOff, DARK.bg, DARK.bg) >= 3);
    assert.ok(contrast(DARK.switchTrackOff, DARK.surfaceRaised, DARK.bg) >= 3);
    assert.ok(contrast(DARK.text, DARK.switchTrackOff, DARK.bg) >= 3);
  }],
  ["off track is no longer white and differs from the on track", () => {
    assert.notEqual(LIGHT.switchTrackOff.toLowerCase(), "#ffffff");
    assert.notEqual(LIGHT.switchTrackOff, LIGHT.accentFill);
  }],
  ["switchColors paints the iOS off body (ios_backgroundColor) from the same token", () => {
    const c = switchColors();
    assert.equal(c.ios_backgroundColor, c.trackColor.false);
  }],
  ["every <Switch> spreads switchColors()", () => {
    const files = [
      "app/spike.tsx", "app/settings/app.tsx", "app/settings/notifications.tsx",
      "app/settings/data.tsx", "app/settings/reminders.tsx", "app/(tabs)/index.tsx",
      "app/onboarding.tsx", "components/ReminderEditSheet.tsx",
      "components/InsulinModeSection.tsx", "components/feedback/FeedbackSheet.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      const switches = (src.match(/<Switch\b/g) ?? []).length;
      const colored = (src.match(/switchColors\(\)/g) ?? []).length;
      assert.ok(switches > 0 && colored >= switches, `${f}: ${switches} Switch, ${colored} switchColors`);
    }
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
