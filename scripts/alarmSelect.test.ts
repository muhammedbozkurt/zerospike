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

import {
  alarmModeOf,
  reminderDelivery,
  shouldOpenAlarmTour,
  shouldUseAlarm,
  type AlarmSelectionInput,
  type AlarmTourGateInput,
} from "../lib/alarmSelect";

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

section("E. alarmModeOf agrees with shouldUseAlarm in all 8 combinations");
{
  // The badge in app/settings/reminders.tsx draws from alarmModeOf while
  // applyReminders arms from shouldUseAlarm; a divergence between the two would
  // show a row labelled "Alarm" that in fact arrives as a notification.
  for (const alarmEnabled of [true, false]) {
    for (const alarmKitAvailable of [true, false]) {
      for (const alarmAuthorized of [true, false]) {
        const input: AlarmSelectionInput = {
          alarmEnabled,
          alarmKitAvailable,
          alarmAuthorized,
        };
        eq(
          `mode enabled=${alarmEnabled} available=${alarmKitAvailable} authorized=${alarmAuthorized}`,
          alarmModeOf(input),
          shouldUseAlarm(input) ? "alarm" : "notification"
        );
      }
    }
  }
  eq(
    "all three true is the only 'alarm'",
    alarmModeOf({ alarmEnabled: true, alarmKitAvailable: true, alarmAuthorized: true }),
    "alarm"
  );
}

section("F. the post-meal caller shares the exact same three-way AND");
{
  // 2.3.0's B: schedulePostMealAt passes NotificationPrefs.postMealAlarm as
  // `alarmEnabled` instead of a row's column - deliberately no second decision
  // function, so the countdown can never disagree with the reminders it sits
  // next to.
  const postMealAlarm = true;
  eq(
    "preference on, AlarmKit there and authorized -> timer",
    shouldUseAlarm({
      alarmEnabled: postMealAlarm,
      alarmKitAvailable: true,
      alarmAuthorized: true,
    }),
    true
  );
  eq(
    "preference turned off -> notification, whatever the device can do",
    shouldUseAlarm({
      alarmEnabled: false,
      alarmKitAvailable: true,
      alarmAuthorized: true,
    }),
    false
  );
  eq(
    "preference on but no AlarmKit -> notification",
    shouldUseAlarm({
      alarmEnabled: postMealAlarm,
      alarmKitAvailable: false,
      alarmAuthorized: false,
    }),
    false
  );
}

section("G. an unauthorized device never reads as 'alarm', however the row is stored");
{
  // 2.3.0 stores the preference platform-independently (see lib/db/reminders.ts):
  // an Android or iOS < 26 row genuinely carries alarm_enabled = 1. The badge in
  // app/settings/reminders.tsx shows that stored intent, but only this helper
  // decides whether it may be drawn as a WORKING alarm - anything short of all
  // three is the "needs permission" state, never the promise of one.
  eq(
    "stored preference on, permission never granted",
    alarmModeOf({ alarmEnabled: true, alarmKitAvailable: true, alarmAuthorized: false }),
    "notification"
  );
  eq(
    "stored preference on, no AlarmKit at all (Android / iOS < 26)",
    alarmModeOf({ alarmEnabled: true, alarmKitAvailable: false, alarmAuthorized: false }),
    "notification"
  );
}

section("H. the one-time tour gate (2.3.0's D)");
{
  // The upgrade tour is for someone whose EXISTING reminders changed delivery.
  // Everything else - a fresh install, a device with no AlarmKit, a user who
  // has seen it, a profile with no reminders, a store capture - must not see it.
  const upgrader: AlarmTourGateInput = {
    routeSettled: true,
    onboarded: true,
    screenshotMode: false,
    alarmKitAvailable: true,
    tourSeen: false,
    reminderCount: 3,
    notificationsEnabled: true,
    notificationPermission: true,
  };
  eq("the upgrading user opens it", shouldOpenAlarmTour(upgrader), true);
  // K3-2: an alarm reaches the user through AlarmKit, so the alarm permission
  // alone qualifies them for the tour even with notifications refused.
  eq(
    "alarm-authorized but notifications refused still opens it",
    shouldOpenAlarmTour({
      ...upgrader,
      notificationPermission: false,
      alarmAuthorized: true,
    }),
    true
  );
  eq(
    "neither mechanism reaching them keeps it closed",
    shouldOpenAlarmTour({
      ...upgrader,
      notificationPermission: false,
      alarmAuthorized: false,
    }),
    false
  );

  // The regression this gate exists for: the route gate in app/_layout.tsx
  // reports SETTLED the moment it has redirected into /onboarding, so "settled"
  // is true for someone who has not onboarded at all - an install whose
  // onboarding was killed halfway got the tour pushed on top of it on the next
  // launch. Only the persisted flag says onboarding is really done.
  eq(
    "settled but not onboarded (onboarding killed halfway) stays closed",
    shouldOpenAlarmTour({ ...upgrader, onboarded: false }),
    false
  );
  eq(
    "routing has not settled yet",
    shouldOpenAlarmTour({ ...upgrader, routeSettled: false }),
    false
  );
  eq(
    "completed onboarding marks it seen, so a fresh install stops here",
    shouldOpenAlarmTour({ ...upgrader, tourSeen: true }),
    false
  );
  eq(
    "no AlarmKit (Android / iOS < 26): nothing changed, nothing to explain",
    shouldOpenAlarmTour({ ...upgrader, alarmKitAvailable: false }),
    false
  );
  eq(
    "no reminders: the tour would announce a change to nobody",
    shouldOpenAlarmTour({ ...upgrader, reminderCount: 0 }),
    false
  );
  eq(
    "store capture is never interrupted",
    shouldOpenAlarmTour({ ...upgrader, screenshotMode: true }),
    false
  );

  // Exhaustive: every single condition is load-bearing on its own, so flipping
  // any one of them away from the opening combination must close the gate.
  const keys = [
    "routeSettled",
    "onboarded",
    "alarmKitAvailable",
    "notificationsEnabled",
    "notificationPermission",
  ] as const;
  for (const key of keys) {
    eq(`${key} alone closes it`, shouldOpenAlarmTour({ ...upgrader, [key]: false }), false);
  }
}

section("I. delivery reality: nothing reaches the user, nothing to explain (2.3.0's F8)");
{
  // The tour's whole claim is "your reminders now ring as alarms". With the
  // app's master switch off, or the OS permission missing, NOTHING reaches this
  // user at all, so the claim is simply untrue for them - and unlike a device
  // with no AlarmKit, that is a state which can flip back tomorrow.
  const upgrader: AlarmTourGateInput = {
    routeSettled: true,
    onboarded: true,
    screenshotMode: false,
    alarmKitAvailable: true,
    tourSeen: false,
    reminderCount: 3,
    notificationsEnabled: true,
    notificationPermission: true,
  };
  eq(
    "master reminder switch off",
    shouldOpenAlarmTour({ ...upgrader, notificationsEnabled: false }),
    false
  );
  eq(
    "OS notification permission not granted",
    shouldOpenAlarmTour({ ...upgrader, notificationPermission: false }),
    false
  );
  eq(
    "both off",
    shouldOpenAlarmTour({
      ...upgrader,
      notificationsEnabled: false,
      notificationPermission: false,
    }),
    false
  );

  // The four combinations of the two delivery inputs: only both-on opens, and
  // the row with rows/AlarmKit/tourSeen all still in the opening position is
  // the one app/_layout.tsx must NOT consume the seen-flag for (it re-checks on
  // the next launch, so the user who grants permission later still gets it).
  for (const notificationsEnabled of [true, false]) {
    for (const notificationPermission of [true, false]) {
      eq(
        `enabled=${notificationsEnabled} permission=${notificationPermission}`,
        shouldOpenAlarmTour({ ...upgrader, notificationsEnabled, notificationPermission }),
        notificationsEnabled && notificationPermission
      );
    }
  }

  // Screenshot mode stays independent of the two new inputs: a capture is
  // refused for its own reason, not because the simulator granted nothing.
  eq(
    "screenshot capture is still refused with delivery fully on",
    shouldOpenAlarmTour({ ...upgrader, screenshotMode: true }),
    false
  );
}

section("J. reminderDelivery - the per-row, per-mechanism gate (2.3.0's K3-2)");
{
  // The bug: the gate was one flat "master switch AND notification permission",
  // applied before anything else. An AlarmKit alarm is delivered by AlarmKit,
  // not by the notification system, so a user who granted the ALARM permission
  // and refused notifications had every reminder silently dropped - while the
  // reminders screen went on drawing "Alarm" badges next to rows nothing was
  // arming.
  const base = {
    masterEnabled: true,
    rowEnabled: true,
    visibilityGateOpen: true,
    alarmEnabled: true,
    alarmKitAvailable: true,
    alarmAuthorized: true,
    notificationPermission: true,
  };

  eq("everything on -> alarm", reminderDelivery(base), "alarm");

  // THE regression this exists for.
  eq(
    "alarm row, alarm permission, notifications REFUSED -> still an alarm",
    reminderDelivery({ ...base, notificationPermission: false }),
    "alarm"
  );
  // And the mirror: a notification row does need the notification permission.
  eq(
    "notification row without the permission -> nothing is armed",
    reminderDelivery({ ...base, alarmEnabled: false, notificationPermission: false }),
    "none"
  );
  eq(
    "notification row with it -> a notification",
    reminderDelivery({ ...base, alarmEnabled: false }),
    "notification"
  );

  // A row that WANTS an alarm the device cannot ring falls back - but only when
  // there is a notification permission to fall back onto.
  eq(
    "alarm intent, no AlarmKit permission, notifications allowed -> notification",
    reminderDelivery({ ...base, alarmAuthorized: false }),
    "notification"
  );
  eq(
    "alarm intent, no AlarmKit permission, notifications refused -> nothing",
    reminderDelivery({ ...base, alarmAuthorized: false, notificationPermission: false }),
    "none"
  );
  eq(
    "no AlarmKit at all, notifications allowed -> notification",
    reminderDelivery({ ...base, alarmKitAvailable: false, alarmAuthorized: false }),
    "notification"
  );

  // The master switch is the user's own "no" and outranks every mechanism.
  for (const over of [
    {},
    { alarmEnabled: false },
    { notificationPermission: false },
    { alarmAuthorized: false },
  ]) {
    eq(
      `master switch off -> none (${JSON.stringify(over)})`,
      reminderDelivery({ ...base, ...over, masterEnabled: false }),
      "none"
    );
  }
  // So do the row's own switch and its profile visibility gate.
  eq("row switched off", reminderDelivery({ ...base, rowEnabled: false }), "none");
  eq("profile gate closed", reminderDelivery({ ...base, visibilityGateOpen: false }), "none");

  // Exhaustive over the four permission-ish flags, against the rule stated in
  // prose above - so a future edit cannot quietly reorder the precedence.
  for (const alarmEnabled of [true, false]) {
    for (const alarmKitAvailable of [true, false]) {
      for (const alarmAuthorized of [true, false]) {
        for (const notificationPermission of [true, false]) {
          const got = reminderDelivery({
            ...base,
            alarmEnabled,
            alarmKitAvailable,
            alarmAuthorized,
            notificationPermission,
          });
          const rings = alarmEnabled && alarmKitAvailable && alarmAuthorized;
          const want = rings ? "alarm" : notificationPermission ? "notification" : "none";
          eq(
            `enabled=${alarmEnabled} kit=${alarmKitAvailable} auth=${alarmAuthorized} notif=${notificationPermission}`,
            got,
            want
          );
        }
      }
    }
  }

  // "alarm" here must be exactly shouldUseAlarm's answer, so the scheduler and
  // every badge stay one decision rather than two that agree by accident.
  for (const alarmEnabled of [true, false]) {
    for (const alarmKitAvailable of [true, false]) {
      for (const alarmAuthorized of [true, false]) {
        const input = { alarmEnabled, alarmKitAvailable, alarmAuthorized };
        eq(
          `delivery agrees with shouldUseAlarm ${JSON.stringify(input)}`,
          reminderDelivery({ ...base, ...input }) === "alarm",
          shouldUseAlarm(input)
        );
      }
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
