declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { doseHintVisible, injectionDoseOk } from "../lib/injectionDose";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

ok("first open, empty dose: no hint", !doseHintVisible(injectionDoseOk(0), false));
ok("touched, empty dose: hint", doseHintVisible(injectionDoseOk(0), true));
ok("touched, valid dose: no hint", !doseHintVisible(injectionDoseOk(2), true));
ok("save still blocked for empty dose", !injectionDoseOk(0));

for (const f of ["app/basal-confirm.tsx", "components/InjectionEditSheet.tsx"]) {
  const src = readFileSync(join(__dirname, "..", f), "utf8");
  ok(`${f} gates hint on interaction`, src.includes("doseHintVisible(") && src.includes("setDoseInteracted(true)"));
}

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
