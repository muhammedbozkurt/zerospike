/**
 * lib/revealPlan.ts correctness harness (2.3.0's G13). No jest, same standalone
 * style as scripts/alarmSelect.test.ts.
 *
 * The property under test: onboarding's closing card can only ever describe
 * what was REALLY set up. A user who skipped the reminder layout has no
 * measurement line, a user who accepted it sees their own rows with their own
 * names, and no line claims an alarm on a device that cannot ring one.
 *
 * Run: npx tsx scripts/revealPlan.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { buildRevealPlan, type RevealPlanRow } from "../lib/revealPlan";
import { alarmModeOf } from "../lib/alarmSelect";

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

function row(over: Partial<RevealPlanRow> = {}): RevealPlanRow {
  return {
    id: "r1",
    type: "glucose",
    label: null,
    time: "08:00",
    enabled: 1,
    alarm_enabled: 1,
    ...over,
  };
}

/** The layout a type 2 answer produces, named the way onboarding names it. */
const PRESET_ROWS: RevealPlanRow[] = [
  row({ id: "g1", time: "08:00", label: "Sabah ölçümü" }),
  row({ id: "g2", time: "13:00", label: "Öğle ölçümü" }),
  row({ id: "g3", time: "21:00", label: "Akşam ölçümü" }),
];

const AUTHORIZED = { alarmKitAvailable: true, alarmAuthorized: true };
const BASE = { postMeal: true, lowFollowup: true, ...AUTHORIZED };

const kinds = (items: { kind: string }[]) => items.map((i) => i.kind).join(",");

console.log("zerospike reveal plan test");

section("A. the layout the user accepted, one line per row");
{
  const items = buildRevealPlan({ rows: PRESET_ROWS, ...BASE });
  eq("three measurement lines plus the two behaviours", items.length, 5);
  eq("in order", kinds(items), "glucose,glucose,glucose,postMeal,lowFollowup");
  eq("each keeps its own name", items[0]?.label, "Sabah ölçümü");
  eq("and its own time", items[1]?.time, "13:00");
  eq("keys are the row ids", items[2]?.id, "g3");
  // The rows are listed by time, whatever order they came back in.
  const shuffled = buildRevealPlan({ rows: [...PRESET_ROWS].reverse(), ...BASE });
  eq(
    "sorted by time",
    shuffled.filter((i) => i.kind === "glucose").map((i) => i.time).join(","),
    "08:00,13:00,21:00"
  );
}

section("B. 'Not now': no measurement line at all");
{
  const items = buildRevealPlan({ rows: [], ...BASE });
  eq("only the two behaviours", kinds(items), "postMeal,lowFollowup");
  eq("nothing claims a reminder", items.every((i) => i.time === null), true);
}

section("C. only what was really set up");
{
  const rows = [
    row({ id: "on", time: "08:00" }),
    row({ id: "off", time: "09:00", enabled: 0 }),
    row({ id: "basal", type: "basal", time: "22:00" }),
    row({ id: "med", type: "med", time: "12:00", label: "Metformin" }),
  ];
  const items = buildRevealPlan({ rows, ...BASE });
  eq("the disabled row is not listed", items.some((i) => i.id === "off"), false);
  // syncBasalReminderRow keeps a basal row and merely disables it for someone
  // who says they take no insulin: that user must not be told about a night
  // reminder they will never get.
  const noInsulin = buildRevealPlan({
    rows: rows.map((r) => (r.type === "basal" ? { ...r, enabled: 0 } : r)),
    ...BASE,
  });
  eq("a disabled basal row is not listed", noInsulin.some((i) => i.kind === "basal"), false);
  eq("reminders come before the behaviours", kinds(items), "glucose,med,basal,postMeal,lowFollowup");
  eq("a named medication row keeps its name", items[1]?.label, "Metformin");
}

section("D. an unnamed row reports no name rather than inventing one");
{
  const items = buildRevealPlan({ rows: [row({ label: null })], ...BASE });
  eq("null label", items[0]?.label, null);
  eq("blank label reads as none", buildRevealPlan({ rows: [row({ label: "   " })], ...BASE })[0]?.label, null);
}

section("E. the delivery mark never over-promises");
{
  for (const alarmKitAvailable of [true, false]) {
    for (const alarmAuthorized of [true, false]) {
      const items = buildRevealPlan({
        rows: [row({ alarm_enabled: 1 })],
        postMeal: false,
        lowFollowup: false,
        alarmKitAvailable,
        alarmAuthorized,
      });
      eq(
        `available=${alarmKitAvailable} authorized=${alarmAuthorized}`,
        items[0]?.mode,
        alarmModeOf({ alarmEnabled: true, alarmKitAvailable, alarmAuthorized })
      );
    }
  }
  // iOS < 26, or the permission refused: the card shows the notification mark
  // even though the row is stored as an alarm.
  const older = buildRevealPlan({
    rows: PRESET_ROWS,
    postMeal: false,
    lowFollowup: false,
    alarmKitAvailable: false,
    alarmAuthorized: false,
  });
  eq("nothing claims an alarm", older.every((i) => i.mode === "notification"), true);
  // A row stored as a notification says so on any device.
  eq(
    "a notification row is a notification",
    buildRevealPlan({ rows: [row({ alarm_enabled: 0 })], postMeal: false, lowFollowup: false, ...AUTHORIZED })[0]
      ?.mode,
    "notification"
  );
}

section("F. the two behaviours follow their own preferences");
{
  eq(
    "post-meal off is not listed",
    buildRevealPlan({ rows: [], postMeal: false, lowFollowup: true, ...AUTHORIZED }).length,
    1
  );
  eq(
    "both off leaves an empty card",
    buildRevealPlan({ rows: [], postMeal: false, lowFollowup: false, ...AUTHORIZED }).length,
    0
  );
  const withWindow = buildRevealPlan({ rows: [], postMealMinutes: 120, ...BASE });
  eq("the window rides along when given", withWindow[0]?.minutes, 120);
  eq("and is absent otherwise", buildRevealPlan({ rows: [], ...BASE })[0]?.minutes, undefined);
  // Neither behaviour is a reminder row, so neither carries a delivery mark.
  eq("no mode on the behaviours", withWindow.every((i) => i.mode === null), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
