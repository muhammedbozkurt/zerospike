/**
 * lib/alarmNext.ts + lib/alarmReschedule.ts correctness harness (AlarmKit
 * persistence). No jest, same standalone style as scripts/alarmSelect.test.ts.
 *
 * Properties under test: the next occurrence is computed in local wall-clock
 * time (DST-stable, strictly in the future); a repeat pass over an unchanged
 * plan makes no native call; a changed reminder replaces its alarm and a
 * removed one is cancelled; alarms and Live Activities the app has no record
 * of are swept while recorded ones are untouched; a finished countdown takes
 * its alarm and card down once the alarm can no longer be ringing; and nothing
 * is ever called where AlarmKit does not exist (iOS < 26, Android).
 *
 * Run: npx tsx scripts/alarmReschedule.test.ts
 */
process.env.TZ = "America/New_York";

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; env: Record<string, string | undefined> };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { nextAlarmDate, parseAlarmTime } from "../lib/alarmNext";
import {
  ALARM_RING_GUARD_MS,
  finishPostMealCountdown,
  openAlarmSession,
  postMealAlarmStillOwned,
  shouldCancelPostMealAlarmAfterEnd,
  sweepOrphanActivities,
  type AlarmPlan,
  type AlarmPorts,
  type PlannedAlarm,
} from "../lib/alarmReschedule";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike alarm persistence test");

const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

section("A. nextAlarmDate");
{
  const now = local(2026, 6, 10, 9, 0); // a Wednesday
  const later = nextAlarmDate({ time: "21:30" }, now);
  eq("later today stays today", later?.getTime(), local(2026, 6, 10, 21, 30).getTime());
  const earlier = nextAlarmDate({ time: "08:00" }, now);
  eq("already past rolls to tomorrow", earlier?.getTime(), local(2026, 6, 11, 8, 0).getTime());
  const exact = nextAlarmDate({ time: "09:00" }, now);
  eq("exactly now is not the future", exact?.getTime(), local(2026, 6, 11, 9, 0).getTime());
  const oneMinute = nextAlarmDate({ time: "09:01" }, now);
  eq("one minute ahead is today", oneMinute?.getTime(), local(2026, 6, 10, 9, 1).getTime());
  eq("accepts a number as now", nextAlarmDate({ time: "21:30" }, now.getTime())?.getTime(), later?.getTime());

  const monday = nextAlarmDate({ time: "07:00", days: [1] }, now); // Wed -> next Mon 15th
  eq("weekday filter: next Monday", monday?.getTime(), local(2026, 6, 15, 7, 0).getTime());
  eq("weekday filter lands on the weekday", monday?.getDay(), 1);
  const sameWeekday = nextAlarmDate({ time: "07:00", days: [3] }, now); // Wed 07:00 past
  eq("same weekday but past rolls a full week", sameWeekday?.getTime(), local(2026, 6, 17, 7, 0).getTime());
  eq("no active day -> null", nextAlarmDate({ time: "07:00", days: [] }, now), null);
  eq("only invalid days -> null", nextAlarmDate({ time: "07:00", days: [9, -1] }, now), null);
  eq("disabled -> null", nextAlarmDate({ time: "07:00", enabled: 0 }, now), null);
  eq("enabled=1 is active", nextAlarmDate({ time: "07:00", enabled: 1 }, now) !== null, true);
  eq("garbage time -> null", nextAlarmDate({ time: "25:00" }, now), null);
  eq("garbage text -> null", nextAlarmDate({ time: "soon" }, now), null);
  eq("parseAlarmTime", JSON.stringify(parseAlarmTime("7:05")), JSON.stringify({ hour: 7, minute: 5 }));
  eq("year rollover", nextAlarmDate({ time: "06:00" }, local(2026, 12, 31, 23, 0))?.getTime(), local(2027, 1, 1, 6, 0).getTime());
}

section("A2. daylight saving keeps the wall-clock time");
{
  // America/New_York springs forward on 2026-03-08 and falls back on 2026-11-01.
  const beforeSpring = nextAlarmDate({ time: "08:00" }, local(2026, 3, 7, 12, 0));
  eq("spring: next 08:00 is the 8th", beforeSpring?.getDate(), 8);
  eq("spring: still 08:00 wall clock", beforeSpring?.getHours(), 8);
  const dayBefore = local(2026, 3, 7, 8, 0).getTime();
  eq("spring: the day is 23h long", (beforeSpring?.getTime() ?? 0) - dayBefore, 23 * 3600 * 1000);

  const gap = nextAlarmDate({ time: "02:30" }, local(2026, 3, 8, 0, 30));
  eq("spring gap: same calendar day", gap?.getDate(), 8);
  ok("spring gap: strictly in the future", (gap?.getTime() ?? 0) > local(2026, 3, 8, 0, 30).getTime());

  const beforeFall = nextAlarmDate({ time: "08:00" }, local(2026, 10, 31, 12, 0));
  eq("fall: next 08:00 is Nov 1st", beforeFall?.getDate(), 1);
  eq("fall: still 08:00 wall clock", beforeFall?.getHours(), 8);
  eq(
    "fall: the day is 25h long",
    (beforeFall?.getTime() ?? 0) - local(2026, 10, 31, 8, 0).getTime(),
    25 * 3600 * 1000
  );
}

// A fake AlarmKit with the native contract: one alarm per id, schedule()
// replaces whatever the id held (cancel-then-schedule).
interface Fake {
  ports: AlarmPorts;
  system: Map<string, PlannedAlarm>;
  unmapped: Set<string>;
  calls: { schedule: PlannedAlarm[]; cancel: string[]; cancelUnowned: string[][]; savePlan: number; list: number };
  plan: { current: AlarmPlan };
  clock: { now: number };
  flags: { present: boolean; authorized: boolean; scheduleOk: boolean; nativeUnowned: boolean };
}

function fake(startNow: number): Fake {
  const system = new Map<string, PlannedAlarm>();
  const unmapped = new Set<string>();
  const calls: Fake["calls"] = { schedule: [], cancel: [], cancelUnowned: [], savePlan: 0, list: 0 };
  const plan = { current: {} as AlarmPlan };
  const clock = { now: startNow };
  const flags = { present: true, authorized: true, scheduleOk: true, nativeUnowned: true };
  const ports: AlarmPorts = {
    present: () => flags.present,
    authorized: () => flags.present && flags.authorized,
    listIds: () => {
      calls.list++;
      return flags.present ? [...system.keys()] : [];
    },
    schedule: async (a) => {
      calls.schedule.push(a);
      if (!flags.scheduleOk) return false;
      system.set(a.id, a);
      return true;
    },
    cancel: async (id) => {
      calls.cancel.push(id);
      system.delete(id);
    },
    cancelUnowned: async (keep) => {
      calls.cancelUnowned.push(keep);
      if (!flags.nativeUnowned) return null;
      let n = 0;
      for (const id of [...system.keys()]) {
        if (!keep.includes(id)) {
          system.delete(id);
          n++;
        }
      }
      n += unmapped.size;
      unmapped.clear();
      return n;
    },
    loadPlan: async () => JSON.parse(JSON.stringify(plan.current)) as AlarmPlan,
    savePlan: async (p) => {
      calls.savePlan++;
      plan.current = JSON.parse(JSON.stringify(p)) as AlarmPlan;
    },
    now: () => clock.now,
  };
  return { ports, system, unmapped, calls, plan, clock, flags };
}

const T0 = local(2026, 6, 10, 9, 0).getTime();
const alarm = (over: Partial<PlannedAlarm> = {}): PlannedAlarm => ({
  id: "zerospike-alarm-r1",
  atMs: local(2026, 6, 10, 21, 30).getTime(),
  label: "Measurement",
  stopLabel: "Stop",
  openLabel: "Open",
  route: "glucose",
  ...over,
});

async function main(): Promise<void> {
section("B. reschedule is idempotent");
{
  const f = fake(T0);
  let s = await openAlarmSession(f.ports);
  eq("first run arms", await s.ensure(alarm()), "armed");
  await s.commit();
  eq("one schedule call", f.calls.schedule.length, 1);
  eq("plan saved once", f.calls.savePlan, 1);

  s = await openAlarmSession(f.ports);
  eq("same state is kept", await s.ensure(alarm()), "kept");
  await s.sweep(["zerospike-alarm-r1"]);
  await s.commit();
  eq("no further schedule call", f.calls.schedule.length, 1);
  eq("no cancel call", f.calls.cancel.length, 0);
  eq("plan not rewritten when nothing changed", f.calls.savePlan, 1);
}

section("B2. a changed reminder replaces its alarm");
{
  const f = fake(T0);
  let s = await openAlarmSession(f.ports);
  await s.ensure(alarm());
  await s.commit();

  const moved = alarm({ atMs: local(2026, 6, 10, 22, 0).getTime() });
  s = await openAlarmSession(f.ports);
  eq("new time re-arms", await s.ensure(moved), "armed");
  await s.commit();
  eq("schedule called with the new time", f.calls.schedule[1].atMs, moved.atMs);
  eq("the id holds exactly one alarm (old one replaced)", f.system.size, 1);
  eq("system alarm is the new one", f.system.get(moved.id)?.atMs, moved.atMs);
  eq("plan follows", f.plan.current[moved.id].atMs, moved.atMs);

  s = await openAlarmSession(f.ports);
  eq("new label re-arms", await s.ensure({ ...moved, label: "Evening" }), "armed");
  s = await openAlarmSession(f.ports);
  eq("new route re-arms", await s.ensure({ ...moved, label: "Evening", route: "med" }), "armed");
}

section("B3. past occurrence moves to the next one");
{
  const f = fake(T0);
  let s = await openAlarmSession(f.ports);
  const today = alarm();
  await s.ensure(today);
  await s.commit();

  f.clock.now = local(2026, 6, 10, 22, 0).getTime(); // the alarm fired and was stopped
  f.system.delete(today.id);
  const tomorrow = alarm({ atMs: nextAlarmDate({ time: "21:30" }, f.clock.now)?.getTime() ?? 0 });
  eq("tomorrow is a day later", tomorrow.atMs, local(2026, 6, 11, 21, 30).getTime());
  s = await openAlarmSession(f.ports);
  eq("armed for the next occurrence", await s.ensure(tomorrow), "armed");
  eq("the system holds tomorrow's", f.system.get(tomorrow.id)?.atMs, tomorrow.atMs);

  // the system still lists a fired-but-unstopped alarm: same id, new moment
  const g = fake(T0);
  s = await openAlarmSession(g.ports);
  await s.ensure(today);
  await s.commit();
  g.clock.now = local(2026, 6, 10, 22, 0).getTime();
  s = await openAlarmSession(g.ports);
  eq("still-listed past entry is re-armed", await s.ensure(tomorrow), "armed");
}

section("B4. a background pass leaves a just-fired alarm alone");
{
  const f = fake(T0);
  let s = await openAlarmSession(f.ports);
  const today = alarm();
  await s.ensure(today);
  await s.commit();
  const tomorrow = alarm({ atMs: local(2026, 6, 11, 21, 30).getTime() });

  f.clock.now = today.atMs + 60 * 1000;
  s = await openAlarmSession(f.ports);
  eq("one minute after: deferred", await s.ensure(tomorrow, { protectRinging: true }), "deferred");
  eq("no schedule call while it may ring", f.calls.schedule.length, 1);
  eq("no cancel call while it may ring", f.calls.cancel.length, 0);
  eq("the ringing alarm is still the one armed", f.system.get(today.id)?.atMs, today.atMs);

  f.clock.now = today.atMs + ALARM_RING_GUARD_MS + 1000;
  s = await openAlarmSession(f.ports);
  eq("after the guard: armed", await s.ensure(tomorrow, { protectRinging: true }), "armed");

  const g = fake(T0);
  s = await openAlarmSession(g.ports);
  await s.ensure(today);
  await s.commit();
  g.clock.now = today.atMs + 60 * 1000;
  s = await openAlarmSession(g.ports);
  eq("a foreground pass re-arms at once", await s.ensure(tomorrow), "armed");
}

section("B5. failed arm, removed and disabled reminders");
{
  const f = fake(T0);
  f.flags.scheduleOk = false;
  let s = await openAlarmSession(f.ports);
  eq("a refused schedule reports failed", await s.ensure(alarm()), "failed");
  await s.commit();
  eq("nothing is remembered for it", Object.keys(f.plan.current).length, 0);

  f.flags.scheduleOk = true;
  s = await openAlarmSession(f.ports);
  await s.ensure(alarm());
  await s.commit();

  s = await openAlarmSession(f.ports);
  await s.cancel("zerospike-alarm-r1");
  await s.commit();
  eq("deleted reminder: alarm cancelled", f.system.size, 0);
  eq("deleted reminder: one cancel call", f.calls.cancel.length, 1);
  eq("deleted reminder: plan entry dropped", Object.keys(f.plan.current).length, 0);

  s = await openAlarmSession(f.ports);
  await s.cancel("zerospike-alarm-r1");
  eq("cancelling again is a no-op", f.calls.cancel.length, 1);
}

section("C. orphan sweep");
{
  const f = fake(T0);
  let s = await openAlarmSession(f.ports);
  await s.ensure(alarm({ id: "zerospike-alarm-r1" }));
  await s.ensure(alarm({ id: "zerospike-alarm-r2" }));
  await s.commit();
  // an alarm the app has no record of: known to the system, absent from the plan
  f.system.set("zerospike-alarm-ghost", alarm({ id: "zerospike-alarm-ghost" }));
  f.unmapped.add("uuid-without-mapping");

  s = await openAlarmSession(f.ports);
  const gone = await s.sweep(["zerospike-alarm-r1"]);
  await s.commit();
  ok("the ghost and the removed row are cancelled", gone.includes("zerospike-alarm-ghost") && gone.includes("zerospike-alarm-r2"), JSON.stringify(gone));
  eq("the recorded alarm is untouched", f.system.has("zerospike-alarm-r1"), true);
  eq("only the recorded alarm is left", f.system.size, 1);
  eq("unmapped alarms went through the native sweep", f.unmapped.size, 0);
  eq("native sweep got the keep list", JSON.stringify(f.calls.cancelUnowned[0]), JSON.stringify(["zerospike-alarm-r1"]));
  eq("plan keeps only the recorded one", JSON.stringify(Object.keys(f.plan.current)), JSON.stringify(["zerospike-alarm-r1"]));

  // an older binary without the native sweep falls back to per-id cancels
  const g = fake(T0);
  g.flags.nativeUnowned = false;
  g.system.set("zerospike-alarm-old", alarm({ id: "zerospike-alarm-old" }));
  g.system.set("zerospike-alarm-keep", alarm({ id: "zerospike-alarm-keep" }));
  s = await openAlarmSession(g.ports);
  await s.sweep(["zerospike-alarm-keep"]);
  eq("fallback cancels the unrecorded id", JSON.stringify(g.calls.cancel), JSON.stringify(["zerospike-alarm-old"]));
  eq("fallback keeps the recorded id", g.system.has("zerospike-alarm-keep"), true);

  // the post-meal alarm is kept while a countdown owns it, dropped otherwise
  const h = fake(T0);
  h.system.set("zerospike-alarm-postmeal", alarm({ id: "zerospike-alarm-postmeal" }));
  s = await openAlarmSession(h.ports);
  await s.sweep(["zerospike-alarm-postmeal"]);
  eq("owned post-meal alarm survives", h.system.has("zerospike-alarm-postmeal"), true);
  s = await openAlarmSession(h.ports);
  await s.sweep([]);
  eq("orphaned post-meal alarm is cancelled", h.system.has("zerospike-alarm-postmeal"), false);
}

section("C2. who owns the post-meal alarm");
{
  const now = 1_000_000_000_000;
  eq("running countdown owns it", postMealAlarmStillOwned(String(now + 5 * 60_000), false, now), true);
  eq("ended a minute ago still owns it (may be ringing)", postMealAlarmStillOwned(String(now - 60_000), false, now), true);
  eq("ended past the guard: orphan", postMealAlarmStillOwned(String(now - ALARM_RING_GUARD_MS - 1), false, now), false);
  eq("no stored end: orphan", postMealAlarmStillOwned(null, false, now), false);
  eq("garbage end: orphan", postMealAlarmStillOwned("abc", false, now), false);
  eq("unreadable storage never takes it down", postMealAlarmStillOwned(null, true, now), true);
}

section("D. countdown finished");
{
  const now = 1_000_000_000_000;
  const log: string[] = [];
  const ports = {
    cancelAlarm: async () => {
      log.push("alarm");
    },
    endActivity: async () => {
      log.push("activity");
    },
  };
  let r = await finishPostMealCountdown(now - ALARM_RING_GUARD_MS - 1, now, ports);
  eq("long over: alarm cancelled", r.alarmCancelled, true);
  eq("long over: alarm then card", log.join(","), "alarm,activity");

  log.length = 0;
  r = await finishPostMealCountdown(now - 1000, now, ports);
  eq("just ended: alarm left to ring", r.alarmCancelled, false);
  eq("just ended: card still comes down", log.join(","), "activity");

  log.length = 0;
  r = await finishPostMealCountdown(null, now, ports);
  eq("unknown end never cancels", r.alarmCancelled, false);
  eq("unknown end still ends the card", log.join(","), "activity");

  log.length = 0;
  await finishPostMealCountdown(now - ALARM_RING_GUARD_MS - 1, now, ports);
  await finishPostMealCountdown(now - ALARM_RING_GUARD_MS - 1, now, ports);
  eq("calling twice is safe", log.length, 4);
  eq("guard boundary cancels", shouldCancelPostMealAlarmAfterEnd(now - ALARM_RING_GUARD_MS, now), true);
}

section("E. orphan Live Activities");
{
  const ended: string[][] = [];
  const mk = (ids: string[] | null) => ({
    listIds: () => ids,
    endAllExcept: async (keep: string[]) => {
      ended.push(keep);
      return (ids ?? []).filter((i) => !keep.includes(i)).length;
    },
  });
  eq("no countdown: everything ends", await sweepOrphanActivities(false, mk(["a", "b"])), 2);
  eq("no countdown: keep list empty", JSON.stringify(ended[0]), "[]");
  eq("countdown running: first kept, duplicate ended", await sweepOrphanActivities(true, mk(["a", "b"])), 1);
  eq("countdown running: keeps the first id", JSON.stringify(ended[1]), JSON.stringify(["a"]));
  eq("countdown running with one card: nothing ended", await sweepOrphanActivities(true, mk(["a"])), 0);
  const before = ended.length;
  eq("nothing listed: no native call", await sweepOrphanActivities(false, mk([])), 0);
  eq("older binary (no listing): skipped silently", await sweepOrphanActivities(false, mk(null)), 0);
  eq("no call for empty or unknown listings", ended.length, before + 0);
}

section("F. no AlarmKit (iOS < 26, Android): nothing is called");
{
  const f = fake(T0);
  f.flags.present = false;
  const s = await openAlarmSession(f.ports);
  eq("ensure fails without calling", await s.ensure(alarm()), "failed");
  await s.cancel("zerospike-alarm-r1");
  eq("sweep does nothing", (await s.sweep([])).length, 0);
  await s.commit();
  eq("no list call", f.calls.list, 0);
  eq("no schedule call", f.calls.schedule.length, 0);
  eq("no cancel call", f.calls.cancel.length, 0);
  eq("no native sweep call", f.calls.cancelUnowned.length, 0);
  eq("no plan write", f.calls.savePlan, 0);

  // AlarmKit present but not authorized: nothing new is armed, cancels still work
  const g = fake(T0);
  let t = await openAlarmSession(g.ports);
  await t.ensure(alarm());
  await t.commit();
  g.flags.authorized = false;
  t = await openAlarmSession(g.ports);
  eq("unauthorized: arming is refused", await t.ensure(alarm({ label: "x" })), "failed");
  await t.cancel("zerospike-alarm-r1");
  eq("unauthorized: an existing alarm can still be cancelled", g.system.size, 0);
}

section("G. wiring (source)");
{
  const root = join(__dirname, "..");
  const read = (p: string): string => readFileSync(join(root, p), "utf8");
  const notif = read("lib/services/notifications.ts");
  ok("reminder alarms use the next occurrence", /nextAlarmDate\(row, Date\.now\(\)\)/.test(notif));
  ok("no repeating alarm is scheduled any more", !/scheduleDailyAlarm\(/.test(notif));
  ok("refreshReminderAlarms gates on iOS + AlarmKit", /export async function refreshReminderAlarms[\s\S]{0,300}Platform\.OS !== "ios" \|\| !isAlarmKitAvailable\(\)/.test(notif));
  ok("live activity sweep sits behind the AlarmKit gate", /if \(isAlarmKitAvailable\(\)\) await sweepOrphanLiveActivities\(\)/.test(notif));
  ok("countdown completion goes through finishPostMealCountdown", /export async function completePostMealTimer[\s\S]{0,1400}finishPostMealCountdown\(/.test(notif));
  ok("cancelling the countdown still cancels the alarm", /export async function cancelPostMealTimer[\s\S]{0,700}cancelAlarm\(POSTMEAL_ALARM_ID\)/.test(notif));
  ok("reminder passes are serialized", /applyChain/.test(notif));
  ok("foreground hook", /refreshReminderAlarms\("foreground"\)/.test(read("app/_layout.tsx")));
  ok("iOS background wake-up hook", /refreshReminderAlarms\("background"\)/.test(read("lib/services/healthBackground.ts")));
  const bg = read("lib/services/healthBackground.ts");
  ok("android task body untouched by the hook", !/defineTask[\s\S]{0,400}refreshReminderAlarms/.test(bg));
  const swift = read("modules/zerospike-alarmkit/ios/ZerospikeAlarmKitModule.swift");
  ok("native cancelUnownedAlarms exists", /AsyncFunction\("cancelUnownedAlarms"\)/.test(swift));
  const la = read("modules/zerospike-live-activity/ios/ZerospikeLiveActivityModule.swift");
  ok("native listActivityIds / endAllExcept exist", /Function\("listActivityIds"\)/.test(la) && /AsyncFunction\("endAllExcept"\)/.test(la));
}

}

main().then(
  () => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  },
  (err) => {
    console.log("test crashed", err);
    process.exit(1);
  }
);
