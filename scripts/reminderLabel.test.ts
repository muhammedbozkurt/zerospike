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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALARM_TITLE_MAX_CELLS,
  alarmTitleWidth,
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
  // characters and the app does not get to widen them, so a TYPE-BASED row
  // ALWAYS shows the short type noun on the alarm - never the row's own name,
  // however short. Every in-app surface still keeps the row's real name at
  // full length, which is what section A/B above are about.
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

  // A NAMED type-based row's own name NEVER reaches the alarm title any more -
  // the previous "smart hybrid" (a name that fit a compact budget went
  // through) is gone, because it made the SAME row's alarm title change shape
  // depending on how it happened to be named. It is always the type noun now,
  // whatever the row is called and however short that name is.
  eq(
    "a long measurement name falls back",
    JSON.stringify(reminderAlarmTitle("glucose", "Morning glucose check")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleGlucose" })
  );
  eq(
    "a short medication name ALSO falls back now",
    JSON.stringify(reminderAlarmTitle("med", "Metformin 850")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleMed" })
  );
  eq(
    "even a one-character name falls back",
    JSON.stringify(reminderAlarmTitle("basal", "A")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleBasal" })
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

section("F. a TYPE-BASED alarm title never leaks the preset name, in any language");
{
  // The previous "smart hybrid" let a preset name through when it fit a
  // compact width budget, which meant tr/ar/ja (whose preset names are
  // genuinely short) rang with their own name while the other six languages
  // fell back. That per-language difference is gone: EVERY language's preset
  // names, however short, now fall back to the short type noun. This reads
  // the real preset copy out of the locale files so the property is proven
  // against production text, not a hand-picked example.
  const LANGS = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"] as const;
  const PRESET_KEYS = [
    "presetMorning",
    "presetLateMorning",
    "presetMidday",
    "presetAfternoon",
    "presetEvening",
    "presetNight",
  ];

  function presetNames(lang: string): string[] {
    const src = readFileSync(
      join(import.meta.dirname, "..", "lib", "i18n", "locales", `${lang}.ts`),
      "utf8"
    );
    const block = /\n  reminders: \{[\s\S]*?\n  \},/.exec(src)?.[0] ?? "";
    return PRESET_KEYS.map((k) => {
      const m = new RegExp(`\\n    ${k}: "((?:[^"\\\\]|\\\\.)*)",`).exec(block);
      ok(`${lang}.${k} exists`, m != null);
      return m?.[1] ?? "";
    });
  }

  for (const lang of LANGS) {
    const names = presetNames(lang);
    for (const name of names) {
      eq(
        `${lang}: "${name}" (${alarmTitleWidth(name)} cells) still falls back to the type label`,
        JSON.stringify(reminderAlarmTitle("glucose", name)),
        JSON.stringify({ kind: "key", key: "reminders.alarmTitleGlucose" })
      );
    }
  }

  // Japanese used to sit exactly on the old budget's line; it now falls back
  // like everything else, since width is no longer measured at all here.
  eq("a kanji/kana name is two cells per character", alarmTitleWidth("午前遅くの測定"), 14);
  eq("and only seven characters", "午前遅くの測定".length, 7);
  eq(
    "even the old exactly-at-budget name now falls back",
    reminderAlarmTitle("glucose", "午前遅くの測定").kind,
    "key"
  );
}

section("G. width is irrelevant for a TYPE-BASED row; only CUSTOM is ever exempt from a limit");
{
  // ALARM_TITLE_MAX_CELLS no longer gates anything in reminderAlarmTitle: a
  // type-based row falls back at every width, from a single character to far
  // past the old budget, so there is no boundary left to sit on either side of.
  eq("far under the old budget -> still the noun", reminderAlarmTitle("glucose", "a").kind, "key");
  eq(
    "exactly at the old budget -> still the noun",
    reminderAlarmTitle("glucose", "a".repeat(ALARM_TITLE_MAX_CELLS)).kind,
    "key"
  );
  eq(
    "far past the old budget -> still the noun",
    reminderAlarmTitle("med", "a".repeat(ALARM_TITLE_MAX_CELLS * 3)).kind,
    "key"
  );

  // Every type-based kind follows the same rule and always falls back to its
  // OWN noun, whatever the row is named.
  eq(
    "a long medication name falls back to the medication noun",
    JSON.stringify(reminderAlarmTitle("med", "Metformin 850 mg sabah dozu")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleMed" })
  );
  eq(
    "and so does a short one now",
    JSON.stringify(reminderAlarmTitle("med", "Metformin")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleMed" })
  );
  eq(
    "a long basal name falls back to the basal noun",
    JSON.stringify(reminderAlarmTitle("basal", "Gece bazal insulin hatirlatmasi")),
    JSON.stringify({ kind: "key", key: "reminders.alarmTitleBasal" })
  );

  // CUSTOM rows are exempt in both directions: always their own name, at any
  // length. This is the one place the app never abbreviates.
  const longCustom = "An extremely long custom reminder name the user chose themselves";
  const custom = reminderAlarmTitle("custom", longCustom);
  eq("a long custom name is still the name", custom.kind, "text");
  if (custom.kind === "text") eq("untouched", custom.text, longCustom);
  ok("and it is genuinely over the old budget", alarmTitleWidth(longCustom) > ALARM_TITLE_MAX_CELLS);
  eq(
    "a short custom name also stays the name",
    JSON.stringify(reminderAlarmTitle("custom", "Walk")),
    JSON.stringify({ kind: "text", text: "Walk" })
  );

  // Width helper sanity - unchanged, still used above to state "genuinely past
  // the old budget" against real measurements.
  eq("latin is one cell each", alarmTitleWidth("abcd"), 4);
  eq("arabic is one cell each", alarmTitleWidth("قياس"), 4);
  eq("empty is zero", alarmTitleWidth(""), 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
