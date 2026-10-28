/**
 * The post-meal countdown is PER PROFILE (G253 C-7..C-10), run against the REAL
 * lib/services/notifications.ts, lib/afterDelete.ts and lib/mealTimeEditTimer.ts
 * with the native, storage and database layers faked.
 *
 * Covers: one profile cannot cancel, overwrite or skip another's countdown; the
 * single-slot -> per-profile move; the undo of a 2-hour reading putting the
 * countdown back; a meal-save undo ending only the countdown that save started;
 * a meal-time edit carrying its own countdown; denied notification permission,
 * a time zone change and both DST jumps leaving the countdown intact.
 * Run: npx tsx scripts/postMealProfileScope.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; env: Record<string, string | undefined> };

import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.TZ = "America/New_York";

const kv = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
  setItem: async (k: string, v: string) => {
    kv.set(k, v);
  },
  removeItem: async (k: string) => {
    kv.delete(k);
  },
  multiSet: async (pairs: [string, string][]) => {
    for (const [k, v] of pairs) kv.set(k, v);
  },
  getAllKeys: async () => [...kv.keys()],
  multiRemove: async (keys: string[]) => {
    for (const k of keys) kv.delete(k);
  },
};

const scheduled = new Map<string, { route?: string; seconds?: number }>();
const rig = {
  permission: "granted" as "granted" | "denied",
  mealRows: [] as { logged_at: string }[],
  activityEnds: 0,
};
const notifications = {
  setNotificationHandler: () => {},
  setNotificationCategoryAsync: async () => {},
  setNotificationChannelAsync: async () => {},
  deleteNotificationChannelAsync: async () => {},
  getNotificationChannelAsync: async () => null,
  getPermissionsAsync: async () => ({ status: rig.permission, canAskAgain: rig.permission !== "denied" }),
  requestPermissionsAsync: async () => ({ status: rig.permission, canAskAgain: rig.permission !== "denied" }),
  scheduleNotificationAsync: async (req: {
    identifier: string;
    content: { data?: { route?: string } };
    trigger?: { seconds?: number };
  }) => {
    scheduled.set(req.identifier, { route: req.content.data?.route, seconds: req.trigger?.seconds });
    return req.identifier;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    scheduled.delete(id);
  },
  getAllScheduledNotificationsAsync: async () =>
    [...scheduled.keys()].map((identifier) => ({ identifier })),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2, MAX: 5 },
  SchedulableTriggerInputTypes: {
    DAILY: "daily",
    DATE: "date",
    TIME_INTERVAL: "timeInterval",
    WEEKLY: "weekly",
  },
};

const profiles: Record<string, { id: string; insulin_mode: string; oral_meds_enabled: number; glucose_unit: string }> = {
  p1: { id: "p1", insulin_mode: "both", oral_meds_enabled: 1, glucose_unit: "mgdl" },
  p2: { id: "p2", insulin_mode: "both", oral_meds_enabled: 1, glucose_unit: "mgdl" },
};
const alarmkit = {
  cancelAlarm: async () => {},
  getAlarmAuthorizationStatus: () => "unavailable",
  isAlarmKitAvailable: () => false,
  listScheduledAlarmIds: () => [] as string[],
  requestAlarmAuthorization: async () => "denied",
  scheduleDailyAlarm: async () => false,
  scheduleOneShotAlarm: async () => false,
};

const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@react-native-async-storage/async-storage") {
    return { __esModule: true, default: AsyncStorage };
  }
  if (request === "expo-notifications") return notifications;
  if (request === "expo-device") return { platformApiLevel: 34 };
  if (request === "react-native") return { Platform: { OS: "ios" } };
  if (request.endsWith("/i18n")) return { __esModule: true, default: { t: (k: string) => k, language: "en" } };
  if (request.endsWith("/analytics")) return { logCrash: () => {}, logEvent: () => {} };
  if (request.endsWith("/db/profiles")) {
    return {
      getProfile: async (id: string) => profiles[id] ?? null,
      listProfiles: async () => Object.values(profiles),
    };
  }
  if (request.endsWith("/db/reminders")) {
    return {
      applyLegacyRemindersBridge: async () => false,
      dedupeBasalReminderRows: async () => {},
      listReminders: async () => [],
    };
  }
  if (request.endsWith("zerospike-live-activity")) {
    return {
      endPostMealActivity: () => {},
      startPostMealActivity: () => {
        rig.activityEnds++;
      },
    };
  }
  if (request.endsWith("zerospike-alarmkit")) return alarmkit;
  if (request === "./db" || request.endsWith("/lib/db") || request === "./db/index") {
    return {
      getDb: async () => ({ getAllAsync: async () => rig.mealRows, getFirstAsync: async () => null }),
    };
  }
  if (request.endsWith("/db/mealTemplates")) return { setTemplateUsage: async () => {} };
  return realLoad.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const POSTMEAL = "zerospike-postmeal-reminder";
const MIN = 60_000;
const realNow = Date.now.bind(Date);
let fakeNow: number | null = null;
Date.now = () => (fakeNow ?? realNow());
const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

async function resetWorld(active: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 40));
  (notifModule as { resetPostMealMigrationForTest?: () => void } | null)?.resetPostMealMigrationForTest?.();
  kv.clear();
  scheduled.clear();
  rig.permission = "granted";
  rig.mealRows = [];
  fakeNow = null;
  kv.set("zerospike.activeProfile", active);
}
const switchTo = (id: string) => kv.set("zerospike.activeProfile", id);
const pending = () => [...scheduled.keys()].filter((k) => k.startsWith(POSTMEAL)).sort();

let notifModule: typeof import("../lib/services/notifications") | null = null;

async function main(): Promise<void> {
  const notif = await import("../lib/services/notifications");
  notifModule = notif;
  const pm = await import("../lib/postMealTimer");
  const after = await import("../lib/afterDelete");
  const edit = await import("../lib/mealTimeEditTimer");

  console.log("A. C-7: another profile cannot cancel, overwrite or skip a countdown");
  await resetWorld("p1");
  eq("A starts its own", (await notif.startPostMealTimer(0)).kind, "started");
  const aTimer = await notif.getPostMealTimerState("p1");
  eq("A's countdown is stored under A", aTimer?.profileId, "p1");
  switchTo("p2");
  eq("B sees no countdown of its own", await notif.getPostMealTimerState(), null);
  eq("so the 'I started eating' guard has nothing to ask about", await notif.getPostMealTimerEnd(), null);
  await notif.cancelPostMealTimer();
  eq("B's 2-hour reading (cancel) leaves A's countdown", (await notif.getPostMealTimerState("p1"))?.endsAt, aTimer?.endsAt);
  eq("and A's notification", pending(), [`${POSTMEAL}:p1`]);
  eq("B logs a meal: its own countdown starts, A's is not 'active'", await notif.schedulePostMealReminder(null), "started");
  eq("both notifications are pending", pending(), [`${POSTMEAL}:p1`, `${POSTMEAL}:p2`]);
  eq("A's countdown is untouched by B's", (await notif.getPostMealTimerState("p1"))?.startedAt, aTimer?.startedAt);
  fakeNow = realNow() + 5 * MIN;
  eq("B 'I started eating' replaces only B's", (await notif.startPostMealTimer(0)).kind, "started");
  eq("A still has its original start", (await notif.getPostMealTimerState("p1"))?.startedAt, aTimer?.startedAt);
  switchTo("p1");
  eq("A back in use sees its countdown", (await notif.getPostMealTimerState())?.endsAt, aTimer?.endsAt);
  fakeNow = null;

  console.log("B. the single-slot move");
  await resetWorld("p2");
  const end = realNow() + 50 * MIN;
  kv.set("zerospike.postMealTimerEnd", String(end));
  kv.set("zerospike.postMealTimerStart", String(end - 120 * MIN));
  kv.set("zerospike.postMealTimerProfile", "p1");
  scheduled.set(POSTMEAL, {});
  eq("the active profile (B) does not inherit A's", await notif.getPostMealTimerState(), null);
  const moved = await notif.getPostMealTimerState("p1");
  eq("the owner got it with its own start and end", [moved?.startedAt, moved?.endsAt], [end - 120 * MIN, end]);
  eq("the old keys are gone", ["End", "Start", "Profile"].map((k) => kv.has(`zerospike.postMealTimer${k}`)), [false, false, false]);
  eq("the old shared notification id is gone", scheduled.has(POSTMEAL), false);
  await new Promise((r) => setTimeout(r, 40));
  eq("delivery re-armed under the owner's id", pending(), [`${POSTMEAL}:p1`]);

  await resetWorld("p2");
  const end2 = realNow() + 50 * MIN;
  kv.set("zerospike.postMealTimerEnd", String(end2));
  eq("an ownerless old timer goes to the active profile", (await notif.getPostMealTimerState("p2"))?.endsAt, end2);
  eq("not to the other one", await notif.getPostMealTimerState("p1"), null);
  await resetWorld("p1");
  kv.set("zerospike.postMealTimerEnd", "not-a-number");
  kv.set("zerospike.postMealTimerProfile", "p1");
  await notif.getPostMealTimerState();
  eq("an unusable old record is dropped", [...kv.keys()].filter((k) => k.startsWith("zerospike.postMealTimer")), []);
  eq("planner: no owner and no active profile defers", pm.planPostMealMigration({ legacyEnd: String(end), legacyStart: null, legacyOwner: null, activeProfileId: null }).kind, "defer");
  eq("planner: nothing stored", pm.planPostMealMigration({ legacyEnd: null, legacyStart: null, legacyOwner: null, activeProfileId: "p1" }).kind, "none");
  eq("planner: start derived from the end", (pm.planPostMealMigration({ legacyEnd: "7200000", legacyStart: null, legacyOwner: "p1", activeProfileId: null }) as { startedAt: number }).startedAt, 0);

  console.log("C. C-8: undoing a 2-hour reading puts the countdown back");
  await resetWorld("p1");
  await notif.startPostMealTimer(0);
  const prior = (await notif.getPostMealTimerState())!;
  await notif.cancelPostMealTimer();
  eq("the reading ended it", await notif.getPostMealTimerState(), null);
  eq("restorable", pm.postMealWindowRestorable(prior, Date.now()), true);
  eq("Undo restores it", await notif.restorePostMealWindow(prior), "restored");
  const back = await notif.getPostMealTimerState();
  eq("same anchor and same end", [back?.startedAt, back?.endsAt], [prior.startedAt, prior.endsAt]);
  eq("with its notification", pending(), [`${POSTMEAL}:p1`]);
  await notif.cancelPostMealTimer();
  await notif.startPostMealTimer(0);
  eq("a newer countdown is never overwritten", await notif.restorePostMealWindow(prior), "occupied");

  console.log("D. C-9: a save's Undo ends only the countdown that save started");
  await resetWorld("p1");
  await notif.startPostMealTimer(0);
  const timer = (await notif.getPostMealTimerState())!;
  const mealAt = timer.startedAt + 3 * MIN;
  rig.mealRows = [];
  const meal = [{ id: "m1", profileId: "p1", loggedAtMs: mealAt, templateId: null }];
  eq("the save did not start it (active)", await notif.schedulePostMealReminder(mealAt), "active");
  await after.applyAfterDelete(meal, { settleTimer: false });
  eq("so Undo keeps the hand-started countdown", (await notif.getPostMealTimerState())?.endsAt, timer.endsAt);
  await after.applyAfterDelete(meal);
  eq("the default delete rule is unchanged (own meal ends it)", await notif.getPostMealTimerState(), null);
  await resetWorld("p1");
  eq("a save that DID start it", await notif.schedulePostMealReminder(null), "started");
  const own = (await notif.getPostMealTimerState())!;
  await after.applyAfterDelete(
    [{ id: "m2", profileId: "p1", loggedAtMs: own.startedAt, templateId: null }],
    { settleTimer: true }
  );
  eq("is ended by its own Undo", await notif.getPostMealTimerState(), null);

  console.log("E. C-10: editing a meal's time moves its own countdown");
  await resetWorld("p1");
  eq("meal save starts it", await notif.schedulePostMealReminder(null), "started");
  const t0 = (await notif.getPostMealTimerState())!;
  const newMeal = t0.startedAt - 60 * MIN;
  rig.mealRows = [{ logged_at: new Date(newMeal).toISOString() }];
  eq("edit to 60 min earlier", await edit.settlePostMealTimerAfterMealTimeEdit({ profileId: "p1", oldLoggedAtMs: t0.startedAt, newLoggedAtMs: newMeal }), "retimed");
  const t1 = (await notif.getPostMealTimerState())!;
  eq("anchor follows the meal, window keeps its span", [t1.startedAt, t1.endsAt - t1.startedAt], [newMeal, 120 * MIN]);
  eq("so the card no longer asks to log a meal", pm.postMealCardActions({ meals: [{ id: "m1", loggedAtMs: newMeal }], startedAt: t1.startedAt }).logMeal, false);
  eq("and a later delete ends it", pm.decidePostMealAfterMealDelete({ startedAt: t1.startedAt, deletedMealsMs: [newMeal], remainingMealsMs: [] }), "end");
  eq("a small edit keeps the anchor", pm.decidePostMealAfterMealTimeEdit({ startedAt: t1.startedAt, oldMealMs: newMeal, newMealMs: newMeal + 3 * MIN, otherMealsMs: [] }).kind, "keep");
  eq("a meal that was never its own keeps it", pm.decidePostMealAfterMealTimeEdit({ startedAt: t1.startedAt, oldMealMs: newMeal - 5 * 60 * MIN, newMealMs: newMeal - 6 * 60 * MIN, otherMealsMs: [] }).kind, "keep");
  eq("another own meal keeps it", pm.decidePostMealAfterMealTimeEdit({ startedAt: t1.startedAt, oldMealMs: newMeal, newMealMs: newMeal - 90 * MIN, otherMealsMs: [newMeal + MIN] }).kind, "keep");
  rig.mealRows = [{ logged_at: new Date(newMeal - 3 * 60 * MIN).toISOString() }];
  eq("edited out of the window: closed out", await edit.settlePostMealTimerAfterMealTimeEdit({ profileId: "p1", oldLoggedAtMs: newMeal, newLoggedAtMs: newMeal - 3 * 60 * MIN }), "elapsed");
  eq("nothing left running", await notif.getPostMealTimerState(), null);

  console.log("F. notification permission denied");
  await resetWorld("p1");
  await notif.startPostMealTimer(0);
  switchTo("p2");
  await notif.startPostMealTimer(0);
  rig.permission = "denied";
  await notif.applyNotificationPrefs();
  eq("both countdowns are taken down together (nothing can reach the user)", [await notif.getPostMealTimerState("p1"), await notif.getPostMealTimerState("p2")], [null, null]);
  eq("no notification left", pending(), []);
  eq("starting one is refused cleanly, not thrown", (await notif.startPostMealTimer(0)).kind, "off");
  eq("and a meal log arms nothing", await notif.schedulePostMealReminder(null), "off");

  console.log("G. time zone change and DST");
  for (const [label, at] of [
    ["fall back (01:40 EDT)", Date.UTC(2026, 10, 1, 5, 40)],
    ["spring forward (01:50 EST)", Date.UTC(2026, 2, 8, 6, 50)],
  ] as const) {
    await resetWorld("p1");
    fakeNow = at;
    await notif.startPostMealTimer(0);
    const s = (await notif.getPostMealTimerState())!;
    eq(`${label}: window is 120 real minutes`, s.endsAt - s.startedAt, 120 * MIN);
    eq(`${label}: OS trigger is 7200 s`, scheduled.get(`${POSTMEAL}:p1`)?.seconds, 7200);
    process.env.TZ = "Asia/Tokyo";
    const tokyo = (await notif.getPostMealTimerState())!;
    eq(`${label}: a zone change leaves the stored moments alone`, [tokyo.startedAt, tokyo.endsAt], [s.startedAt, s.endsAt]);
    fakeNow = at + 61 * MIN;
    eq(`${label}: still running an hour in`, (await notif.getPostMealTimerState()) != null, true);
    fakeNow = at + 121 * MIN;
    eq(`${label}: over after 120 real minutes`, await notif.getPostMealTimerState(), null);
    process.env.TZ = "America/New_York";
  }
  fakeNow = null;

  console.log("H. wiring locks");
  const idx = read("app/(tabs)/index.tsx");
  const ctx = read("lib/store/AppContext.tsx");
  eq("2-hour Undo restores the countdown", idx.includes("restorePostMealWindow(endedTimer)"), true);
  eq("2-hour Undo withdraws the re-measure reminder", idx.includes("await cancelLowFollowup()"), true);
  eq("live surfaces refresh from the never-frozen root", /syncLiveData\(liveProfileId, liveUnit\)/.test(ctx), true);
  eq("the frozen dashboard is no longer the only trigger", /\[profileId, glucoseUnit, dataVersion\]/.test(idx), false);
  for (const f of ["app/calculator.tsx", "app/(tabs)/food.tsx", "app/meal-template.tsx"]) {
    eq(`${f} passes the save's own result to Undo`, read(f).includes("settleTimer: timerStartedBySave"), true);
  }
  eq("calculator moves the countdown with a meal-time edit", read("app/calculator.tsx").includes("settlePostMealTimerAfterMealTimeEdit"), true);
  eq("carb-only edit does too", read("components/CarbOnlyMealEdit.tsx").includes("settlePostMealTimerAfterMealTimeEdit"), true);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
