/**
 * Editing an existing record asks the recent-bolus question only when the edit
 * ADDS insulin (a bolus row is created, or its dose goes up) and never against
 * the row being edited; a new entry always asks.
 *
 *   npx tsx scripts/editNoGuard.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkEntryGuards } from "../lib/entryGuard";
import {
  injectionEditNeedsBolusGuard,
  mealEditNeedsBolusGuard,
  mealEditPlan,
  type BolusRowSnapshot,
} from "../lib/mealEditPatch";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

const MEAL_AT = "2026-10-01T12:00:00.000Z";
const own: BolusRowSnapshot = { id: "inj-own", dose_units: 1, logged_at: MEAL_AT, insulin_type: "bolus" };
const plan = (dose: number, bolus: BolusRowSnapshot | null, prefilledDose: number) =>
  mealEditPlan({
    showsDose: true,
    dose,
    prefilledDose,
    mealStored: { insulin_dose_units: prefilledDose, logged_at: MEAL_AT },
    bolus,
    loggedAtIso: MEAL_AT,
    loggedAtChanged: false,
  });

// Meal edit (calculator)
ok("meal edit creating a new bolus row guards", mealEditNeedsBolusGuard(plan(3, null, 0).bolus, 3, 0));
ok("meal edit raising the dose guards", mealEditNeedsBolusGuard(plan(2, own, 1).bolus, 2, 1));
ok("meal edit with the same dose (region/note/time only) does not guard", !mealEditNeedsBolusGuard(plan(1, own, 1).bolus, 1, 1));
ok("meal edit lowering the dose does not guard", !mealEditNeedsBolusGuard(plan(1, { ...own, dose_units: 2 }, 2).bolus, 1, 2));
ok("meal edit removing the dose does not guard", !mealEditNeedsBolusGuard(plan(0, own, 1).bolus, 0, 1));
ok("meal edit with no bolus and no dose does not guard", !mealEditNeedsBolusGuard(plan(0, null, 0).bolus, 0, 0));

// Injection edit sheet
const bolusRow = { type: "bolus" as const, dose: 1 };
ok("sheet: region-only change (same dose) does not guard", !injectionEditNeedsBolusGuard(bolusRow, { type: "bolus", dose: 1 }));
ok("sheet: lower dose does not guard", !injectionEditNeedsBolusGuard(bolusRow, { type: "bolus", dose: 0.5 }));
ok("sheet: higher dose guards", injectionEditNeedsBolusGuard(bolusRow, { type: "bolus", dose: 2 }));
ok("sheet: basal turned into bolus guards", injectionEditNeedsBolusGuard({ type: "basal", dose: 10 }, { type: "bolus", dose: 10 }));
ok("sheet: basal edit never asks the bolus question", !injectionEditNeedsBolusGuard({ type: "basal", dose: 10 }, { type: "basal", dose: 12 }));

// The own row is never compared against itself; a different nearby bolus still is.
const nowMs = Date.parse(MEAL_AT);
const recent = {
  injections: [{ id: "inj-own", logged_at: MEAL_AT, insulin_type: "bolus" as const, dose_units: 1 }],
};
const base = { now: nowMs, entryAtIso: MEAL_AT, entryKind: "injection" as const, insulinType: "bolus" as const, recent };
ok("own row excluded via excludeId", checkEntryGuards({ ...base, excludeId: "inj-own" }).length === 0);
ok("new entry (no excludeId) still sees the nearby bolus", checkEntryGuards(base).some((n) => n.kind === "recent_bolus"));

// Wiring
const sheet = read("components/InjectionEditSheet.tsx");
ok("sheet gates the double-bolus confirm on the edit rule", /injectionEditNeedsBolusGuard\([\s\S]*?\)\s*&&\s*!\(await confirmDoubleBolus\(\)\)/.test(sheet));

const calc = read("app/calculator.tsx");
const guardCalls = [...calc.matchAll(/guardEntry\(\{/g)].length;
ok("calculator has the new-entry meal + bolus guards and the edit bolus guard", guardCalls === 3);
ok("calculator edit guard is gated by the edit rule and excludes the own row", /mealEditNeedsBolusGuard\(step[\s\S]*?excludeId: existingInjectionForEdit\?\.id \?\? null/.test(calc));
const gate = calc.indexOf("if (!isEdit) {");
ok("calculator new-entry guards sit inside the !isEdit branch", gate > 0 && calc.indexOf("entryKind: \"meal\"", gate) > gate);

const injection = read("app/(tabs)/injection.tsx");
ok("new injection form still guards", /guardEntry\(\{\s*entryKind: "injection"/.test(injection));

if (failed > 0) {
  console.log(`editNoGuard: ${failed} FAIL`);
  process.exit(1);
}
console.log("editNoGuard: OK");
