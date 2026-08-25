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

import {
  reminderAlarmTitle,
  reminderLabelFields,
  resolveReminderLabel,
} from "../lib/reminderLabel";
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

section("E. the ALARM title is its own, much shorter, decision");
{
  // Device QA: a Turkish measurement alarm reached the Dynamic Island as
  // "Glikoz olcu...". AlarmKit's compact presentations clip to a handful of
  // characters and the app does not get to widen them, so the copy shortens
  // instead - and it shortens ONLY here. Every in-app surface keeps the row's
  // real name, which is what section A/B above are about.
  const ALL_TYPES: ReminderType[] = ["glucose", "med", "basal", "custom"];

  // The three type-based rows take a key from the deliberately short
  // reminders.alarmTitle* family - NOT the notification title, which is a whole
  // sentence in several languages ("Time for your post-meal check").
  eq(
    "glucose",
    JSON.stringify(reminderAlarmTitle("glucose", null)),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleGlucose" })
  );
  eq(
    "med",
    JSON.stringify(reminderAlarmTitle("med", null)),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleMed" })
  );
  eq(
    "basal",
    JSON.stringify(reminderAlarmTitle("basal", null)),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleBasal" })
  );
  for (const type of ALL_TYPES) {
    const got = reminderAlarmTitle(type, null);
    ok(
      `${type} never falls back to a notification title`,
      got.kind !== "key" || !got.key.startsWith("notifications.") || type === "custom"
    );
  }

  // A NAMED type-based row still takes the short key: the alarm surface is
  // about fitting, and the row's own name is on every screen that has room for
  // it. This is the one place the two deliberately disagree.
  eq(
    "a named measurement row still shortens",
    JSON.stringify(reminderAlarmTitle("glucose", "Morning glucose check")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleGlucose" })
  );
  eq(
    "so does a named medication row",
    JSON.stringify(reminderAlarmTitle("med", "Metformin 850")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleMed" })
  );

  // The user's own words are NEVER abbreviated by us. If the OS clips them,
  // that is the OS clipping text the user can shorten themselves.
  const custom = reminderAlarmTitle("custom", "Evening walk");
  eq("a custom row passes through", custom.kind, "text");
  if (custom.kind === "text") eq("verbatim", custom.text, "Evening walk");

  const longName = "A deliberately very long custom reminder name that will not fit";
  const long = reminderAlarmTitle("custom", longName);
  eq("even a long one is untouched", long.kind, "text");
  if (long.kind === "text") {
    eq("no truncation of the user's text", long.text, longName);
    eq("and no ellipsis added", long.text.includes("\u2026"), false);
  }

  // Trimmed, because a name of nothing but spaces is not a name.
  const padded = reminderAlarmTitle("custom", "  Walk  ");
  if (padded.kind === "text") eq("surrounding space is trimmed", padded.text, "Walk");
  eq(
    "a blank custom name falls back to the plain word for 'reminder'",
    JSON.stringify(reminderAlarmTitle("custom", "   ")),
    JSON.stringify({ kind: "key", key: "notifications.customTitle" })
  );
  eq(
    "as does a null one",
    JSON.stringify(reminderAlarmTitle("custom", null)),
    JSON.stringify({ kind: "key", key: "notifications.customTitle" })
  );

  // Every type resolves to something drawable - no undefined key, no empty
  // title, on any row the table can hold.
  for (const type of ALL_TYPES) {
    for (const label of [null, "", "   ", "Named"]) {
      const got = reminderAlarmTitle(type, label);
      ok(
        `${type} / ${JSON.stringify(label)} produces a title`,
        got.kind === "text" ? got.text.length > 0 : got.key.length > 0
      );
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
