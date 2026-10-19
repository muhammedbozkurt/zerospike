/**
 * sheetFitHeight() + basalPresentation().   npx tsx scripts/sheetFit.test.ts
 */
import { sheetFitHeight } from "../lib/sheetLayout";
import { basalPresentation } from "../lib/basalConfirmLayout";

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (actual !== expected) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const base = { windowHeight: 800, keyboardHeight: 0, insetBottom: 34, contentHeight: 150 };
// short content hugs: 150 content + 60 chrome + (34 + 16) padding
eq("short content hugs", sheetFitHeight({ ...base, chromeHeight: 60 }), 260);
eq("fit false takes the allowance", sheetFitHeight({ ...base, chromeHeight: 60, fit: false }), 720);
eq("tall content is capped", sheetFitHeight({ ...base, contentHeight: 2000, chromeHeight: 60 }), 720);
eq("never negative", sheetFitHeight({ ...base, windowHeight: 0, contentHeight: 0 }), 0);
eq(
  "keyboard shrinks the cap",
  sheetFitHeight({ ...base, keyboardHeight: 400, contentHeight: 2000, chromeHeight: 60 }),
  360
);

eq("ask is a card", basalPresentation({ loadKind: "ready", step: "ask", picking: false }), "card");
eq("site is full", basalPresentation({ loadKind: "ready", step: "site", picking: false }), "full");
eq("picking is full", basalPresentation({ loadKind: "ready", step: "ask", picking: true }), "full");
eq("loading ask is a card", basalPresentation({ loadKind: "loading", step: "ask", picking: false }), "card");
eq("loading site is full", basalPresentation({ loadKind: "loading", step: "site", picking: false }), "full");
for (const k of ["error", "chooseProfile", "duplicate"] as const) {
  eq(`${k} is a card`, basalPresentation({ loadKind: k, step: "ask", picking: false }), "card");
  eq(`${k} from site is a card`, basalPresentation({ loadKind: k, step: "site", picking: false }), "card");
}

if (failed) {
  console.log(`sheetFit: ${failed} failed`);
  process.exit(1);
}
console.log("sheetFit: all passed");
