/**
 * G6/G7/G8/G19: the calculator's meal edit and bolus write.
 *
 *   npx sucrase-node scripts/calcMealEdit.test.ts
 */
import {
  mealEditPlan,
  prefillDose,
  writeBolusRow,
  savedToastKey,
  type BolusRowSnapshot,
} from "../lib/mealEditPatch";
import { glucoseSheetBounds } from "../lib/glucoseSheetInput";
import { GLUCOSE_ENTRY_BOUNDS } from "../lib/numericField";

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (m: string) => any;

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const MEAL_AT = "2026-10-01T12:00:00.000Z";
const BOLUS_AT = "2026-10-01T12:20:00.000Z";
const bolus: BolusRowSnapshot = { id: "inj1", dose_units: 5, logged_at: BOLUS_AT, insulin_type: "bolus" };

async function main() {
  // G7: insulin mode outside bolus must leave dose and linked bolus alone.
  const g7 = mealEditPlan({
    showsDose: false,
    dose: 0,
    prefilledDose: 0,
    mealStored: { insulin_dose_units: 4, logged_at: MEAL_AT },
    bolus,
    loggedAtIso: MEAL_AT,
    loggedAtChanged: false,
  });
  eq("G7 meal patch has no dose", "insulin_dose_units" in g7.mealPatch, false);
  eq("G7 linked bolus is not touched", g7.bolus, { kind: "none" });

  // G8: the dose in the editor comes from the bolus row, not the meal row.
  eq("G8 prefill dose from bolus", prefillDose(4, bolus), 5);
  eq("G8 prefill falls back to meal dose without a bolus row", prefillDose(4, null), 4);
  eq("G8 prefill falls back when bolus dose is null", prefillDose(4, { ...bolus, dose_units: null }), 4);

  // G8: untouched dose and time leave the bolus row's dose and time out of the patch.
  const g8 = mealEditPlan({
    showsDose: true,
    dose: 5,
    prefilledDose: 5,
    mealStored: { insulin_dose_units: 4, logged_at: MEAL_AT },
    bolus,
    loggedAtIso: MEAL_AT,
    loggedAtChanged: false,
  });
  eq("G8 bolus update carries no dose or time", g8.bolus, { kind: "update", id: "inj1", patch: {} });
  eq("G8 meal logged_at untouched", "logged_at" in g8.mealPatch, false);
  eq("G8 meal dose follows the bolus row", g8.mealPatch.insulin_dose_units, 5);

  // Touched dose and time do go in.
  const touched = mealEditPlan({
    showsDose: true,
    dose: 6,
    prefilledDose: 5,
    mealStored: { insulin_dose_units: 4, logged_at: MEAL_AT },
    bolus,
    loggedAtIso: "2026-10-01T13:00:00.000Z",
    loggedAtChanged: true,
  });
  eq("touched bolus patch", touched.bolus, {
    kind: "update",
    id: "inj1",
    patch: { dose_units: 6, logged_at: "2026-10-01T13:00:00.000Z" },
  });
  eq("touched meal patch", [touched.mealPatch.insulin_dose_units, touched.mealPatch.logged_at], [6, "2026-10-01T13:00:00.000Z"]);

  // Cleared dose removes the bolus, no bolus + dose creates one (repair of a failed write).
  const cleared = mealEditPlan({
    showsDose: true, dose: 0, prefilledDose: 5,
    mealStored: { insulin_dose_units: 5, logged_at: MEAL_AT }, bolus, loggedAtIso: MEAL_AT, loggedAtChanged: false,
  });
  eq("cleared dose deletes the bolus", cleared.bolus, { kind: "delete", id: "inj1" });
  const created = mealEditPlan({
    showsDose: true, dose: 4, prefilledDose: 4,
    mealStored: { insulin_dose_units: 4, logged_at: MEAL_AT }, bolus: null, loggedAtIso: MEAL_AT, loggedAtChanged: false,
  });
  eq("dose without a bolus row creates one", created.bolus, { kind: "create", dose: 4 });

  // G6: a failed bolus write is its own result, never swallowed.
  const bad = await writeBolusRow(async () => {
    throw new Error("disk");
  });
  eq("G6 failed write reports ok=false", bad.ok, false);
  const good = await writeBolusRow(async () => undefined);
  eq("G6 successful write reports ok=true", good.ok, true);
  eq("G6 toast: bolus failure outranks 'saved'", savedToastKey({ doseWanted: true, wroteInjection: false, hasSite: false, createdReading: false }), "bolusSaveFailed");
  eq("G6 toast: no dose, plain save", savedToastKey({ doseWanted: false, wroteInjection: false, hasSite: false, createdReading: false }), "savedRecord");
  eq("G6 toast: wrote with site", savedToastKey({ doseWanted: true, wroteInjection: true, hasSite: true, createdReading: false }), "autoInjection");
  eq("G6 toast: wrote without site", savedToastKey({ doseWanted: true, wroteInjection: true, hasSite: false, createdReading: false }), "autoInjectionNoSite");
  eq("G6 toast: reading created", savedToastKey({ doseWanted: false, wroteInjection: false, hasSite: false, createdReading: true }), "autoGlucose");

  // G19: the calculator accepts what the glucose sheet accepts.
  const fs = require("fs");
  const calc: string = fs.readFileSync("app/calculator.tsx", "utf8");
  eq("G19 calculator uses the sheet bounds", calc.includes("glucoseSheetBounds(unit)"), true);
  eq("G19 calculator no longer uses the narrow table", calc.includes("glucoseEntryBounds"), false);
  eq("G19 650 mg/dL fits", 650 <= glucoseSheetBounds("mgdl").max && 650 > GLUCOSE_ENTRY_BOUNDS.mgdl.max, true);
  eq("G19 15 mg/dL fits", 15 >= glucoseSheetBounds("mgdl").min && 15 < GLUCOSE_ENTRY_BOUNDS.mgdl.min, true);

  // Wiring: the screen runs the plan and routes the bolus write through the helper.
  eq("screen builds the edit plan", calc.includes("mealEditPlan("), true);
  eq("screen no longer deletes the bolus itself", calc.includes("await deleteInjection(existingInjection.id)"), false);
  eq("screen routes the new bolus through writeBolusRow", calc.includes("writeBolusRow("), true);

  console.log(failed === 0 ? "calcMealEdit: all passed" : `calcMealEdit: ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
