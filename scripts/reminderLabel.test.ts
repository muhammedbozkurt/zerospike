/**
 * lib/reminderLabel.ts correctness harness. No jest, same standalone style as
 * scripts/alarmSelect.test.ts.
 *
 * The regression this exists for: a reminder opened to change its TIME and
 * saved back must come out with the same NAME. 2.3.0's ready-made layout names
 * its measurement rows ("Morning glucose check"), but the edit sheet read the
 * label for two types and wrote it for the same two - so every save through
 * that screen quietly set a measurement row's name to null.
 *
 * Run: npx tsx scripts/reminderLabel.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { reminderLabelFields, resolveReminderLabel } from "../lib/reminderLabel";
import type { ReminderType } from "../lib/db/types";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const ALL_TYPES: ReminderType[] = ["glucose", "med", "basal", "custom"];

/** Open the sheet on a row, change nothing but the time, save. */
function roundTrip(type: ReminderType, label: string | null): string | null {
  return resolveReminderLabel(type, reminderLabelFields(type, label));
}

console.log("zerospike reminder label test");

section("A. a save that only moved the time keeps the name");
{
  // The exact regression: every named type has to survive its own round trip.
  eq("a preset measurement row", roundTrip("glucose", "Sabah ölçümü"), "Sabah ölçümü");
  eq("a named medication row", roundTrip("med", "Metformin"), "Metformin");
  eq("a custom row", roundTrip("custom", "Akşam yürüyüşü"), "Akşam yürüyüşü");
  // ...and an unnamed one stays unnamed rather than gaining something.
  for (const type of ALL_TYPES) {
    eq(`${type}: no name stays no name`, roundTrip(type, null), null);
  }
  // Basal is the one type with no per-row name at all: its copy is i18n on
  // every surface, so it round-trips to null even if a label somehow exists.
  eq("basal never carries one", roundTrip("basal", "whatever"), null);
}

section("B. renaming a measurement row actually renames it");
{
  const fields = reminderLabelFields("glucose", "Sabah ölçümü");
  eq(
    "typed over",
    resolveReminderLabel("glucose", { ...fields, glucose: "Kahvaltı öncesi" }),
    "Kahvaltı öncesi"
  );
  // Clearing the field is a deliberate "just call it Glucose check".
  eq("cleared", resolveReminderLabel("glucose", { ...fields, glucose: "" }), null);
  eq("blanked with spaces", resolveReminderLabel("glucose", { ...fields, glucose: "   " }), null);
  eq("trimmed", resolveReminderLabel("glucose", { ...fields, glucose: "  Öğle  " }), "Öğle");
}

section("C. one type's field never leaks into another");
{
  // The fields are loaded per type, so a row opened as `glucose` has nothing in
  // the custom or med boxes - and switching the type in the sheet must not pick
  // up a name the user never typed for that type.
  const fields = reminderLabelFields("glucose", "Sabah ölçümü");
  eq("its own box holds it", fields.glucose, "Sabah ölçümü");
  eq("the custom box is empty", fields.custom, "");
  eq("the med box is empty", fields.med, "");
  eq("saved as custom: nothing to carry", resolveReminderLabel("custom", fields), null);
  eq("saved as med: nothing to carry", resolveReminderLabel("med", fields), null);
}

section("D. load and save agree on the SAME list of types");
{
  // The bug was an asymmetry between the two, so this checks the property
  // directly: whatever a type can hold, it can also give back.
  for (const type of ALL_TYPES) {
    const name = "Test " + type;
    const holds = reminderLabelFields(type, name);
    const anyFieldHolds = holds.custom || holds.med || holds.glucose;
    const savedBack = resolveReminderLabel(type, holds);
    ok(
      `${type}: holds it and gives it back, or neither`,
      anyFieldHolds ? savedBack === name : savedBack === null,
      `holds=${JSON.stringify(holds)} back=${JSON.stringify(savedBack)}`
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
