/**
 * Editing an existing record never runs the duplicate-entry / double-bolus
 * confirmation; only a brand-new entry does.
 *
 *   npx tsx scripts/editNoGuard.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

const sheet = read("components/InjectionEditSheet.tsx");
ok("injection edit sheet has no guard hook", !/useEntryGuardConfirm|guardEntry\(/.test(sheet));
ok("injection edit sheet has no double-bolus confirm", !/confirmDoubleBolus|findRecentCalculatorBolus/.test(sheet));

const calc = read("app/calculator.tsx");
const guardCalls = [...calc.matchAll(/guardEntry\(\{/g)].map((m) => m.index ?? 0);
ok("calculator still guards new entries (meal + bolus)", guardCalls.length === 2);
const gate = calc.indexOf("if (!isEdit) {");
ok("calculator guard calls sit inside the new-entry branch", gate > 0 && guardCalls.every((i) => i > gate));
ok("calculator guard no longer passes excludeId", !/excludeId: isEdit|excludeId: existingInjectionForEdit/.test(calc));

const injection = read("app/(tabs)/injection.tsx");
ok("new injection form still guards", /guardEntry\(\{\s*entryKind: "injection"/.test(injection));

if (failed > 0) {
  console.log(`editNoGuard: ${failed} FAIL`);
  process.exit(1);
}
console.log("editNoGuard: OK");
