/** J3: the in-tree sheets hide the tab bar from VoiceOver while they are up.
 *  Run: npx -y tsx scripts/a11yModalTabs.test.ts */
import { readFileSync } from "node:fs";
import { a11yModalCount, registerA11yModal } from "../lib/a11yModal";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const a = registerA11yModal();
const b = registerA11yModal();
ok("two sheets counted", a11yModalCount() === 2);
a();
a();
ok("double release is idempotent", a11yModalCount() === 1);
b();
ok("all released", a11yModalCount() === 0);

for (const f of [
  "components/QuickAddSheet.tsx",
  "components/MealComposeSheet.tsx",
  "components/CarbEstimateSheet.tsx",
]) {
  ok(`${f} registers`, src(f).includes("useA11yModalPresence("));
}
const layout = src("app/(tabs)/_layout.tsx");
ok("tab layout reads the store", layout.includes("useA11yModalOpen"));
ok("tab layout hides on iOS", layout.includes("accessibilityElementsHidden"));
ok("tab layout hides on Android", layout.includes('"no-hide-descendants"'));

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("a11yModalTabs ok");
