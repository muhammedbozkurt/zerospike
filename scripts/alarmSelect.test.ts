/**
 * lib/alarmSelect.ts correctness harness (2.2.0's A1 - AlarmKit). No jest,
 * same standalone style as scripts/postMealTimer.test.ts.
 *
 * The property under test: shouldUseAlarm is a plain three-way AND with no
 * hidden shortcuts - a row only ever becomes a real alarm when ALL THREE of
 * its own opt-in, OS/module availability, and granted authorization hold at
 * once. Every one of the 8 true/false combinations is checked explicitly so a
 * future edit that accidentally ORs instead of ANDs (or drops a case) fails
 * loudly here instead of silently double-delivering (alarm AND notification)
 * or silently dropping a reminder on a device that should have gotten an
 * alarm.
 *
 * Run: npx tsx scripts/alarmSelect.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { shouldUseAlarm, type AlarmSelectionInput } from "../lib/alarmSelect";

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

console.log("zerospike alarm selection test");

section("A. only all three true selects the alarm");
{
  const input: AlarmSelectionInput = {
    alarmEnabled: true,
    alarmKitAvailable: true,
    alarmAuthorized: true,
  };
  eq("all true -> alarm", shouldUseAlarm(input), true);
}

section("B. every single-flag-false combination falls back to the notification");
{
  const base: AlarmSelectionInput = {
    alarmEnabled: true,
    alarmKitAvailable: true,
    alarmAuthorized: true,
  };
  eq(
    "row itself opted out",
    shouldUseAlarm({ ...base, alarmEnabled: false }),
    false
  );
  eq(
    "no AlarmKit on this OS/module",
    shouldUseAlarm({ ...base, alarmKitAvailable: false }),
    false
  );
  eq(
    "not authorized (denied or never asked)",
    shouldUseAlarm({ ...base, alarmAuthorized: false }),
    false
  );
}

section("C. every combination of the 8 (exhaustive truth table)");
{
  for (const alarmEnabled of [true, false]) {
    for (const alarmKitAvailable of [true, false]) {
      for (const alarmAuthorized of [true, false]) {
        const want = alarmEnabled && alarmKitAvailable && alarmAuthorized;
        const got = shouldUseAlarm({ alarmEnabled, alarmKitAvailable, alarmAuthorized });
        eq(
          `enabled=${alarmEnabled} available=${alarmKitAvailable} authorized=${alarmAuthorized}`,
          got,
          want
        );
      }
    }
  }
}

section("D. authorized-but-unavailable can never happen upstream, but must still not select");
{
  // applyReminders folds alarmKitAvailable INTO alarmAuthorized before calling
  // this (see lib/services/notifications.ts), so this combination should never
  // actually be passed in - but shouldUseAlarm itself must still refuse it on
  // its own, defense in depth against a future caller that forgets to fold
  // the two together.
  eq(
    "authorized=true with no AlarmKit still refuses",
    shouldUseAlarm({ alarmEnabled: true, alarmKitAvailable: false, alarmAuthorized: true }),
    false
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
