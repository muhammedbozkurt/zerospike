/** J1: RangeInput must not centre itself a second time; every host screen
 *  already pads its content column.
 *  Run: npx -y tsx scripts/rangeInputColumn.test.ts */
import { readFileSync } from "node:fs";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

ok("RangeInput has no columnPad", !/columnPad/.test(src("components/RangeInput.tsx")));
ok("profile-setup pads its column", /\.\.\.columnPad\(16\)/.test(src("app/profile-setup.tsx")));
ok("onboarding pads its column", /columnPad\(24\)/.test(src("app/onboarding.tsx")));
ok("settings page pads its column", /paddingLeft: SPACE\.lg \+ gap/.test(src("components/settingsUi.tsx")));

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("rangeInputColumn ok");
