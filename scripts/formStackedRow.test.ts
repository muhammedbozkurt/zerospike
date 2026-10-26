/** J8: at large text an InputRow stacks; the field then spans the card and
 *  starts at the label's edge instead of hanging right under it, and the icon
 *  stays with the label's first line.
 *  Run: npx -y tsx scripts/formStackedRow.test.ts */
import { readFileSync } from "node:fs";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}
const form = readFileSync(new URL("../components/form.tsx", import.meta.url), "utf8");

ok("stacked field is not capped at 150", /stacked\s*\?\s*"[^"]*flex-1[^"]*"\s*:\s*"[^"]*max-w-\[150px\]/.test(form));
ok("stacked field aligns to the start", form.includes('textAlign: stacked === I18nManager.isRTL ? "right" : "left"'));
ok("stacked label row aligns to the top", /stacked \? "flex-row items-start"/.test(form));

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("formStackedRow ok");
