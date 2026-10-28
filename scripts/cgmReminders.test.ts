/**
 * Reminders in CGM mode, run against the REAL lib/services/notifications.ts
 * with the native and storage layers faked.
 *
 * While a profile gets its readings from a sensor, measurement (glucose)
 * reminders are off by default; basal, medication and custom reminders are
 * untouched; the countdown the user starts themselves still runs but arms no
 * notification (the 2-hour value comes from the sensor); an import never
 * schedules anything; going back to manual restores everything.
 * Run: npx tsx scripts/cgmReminders.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";

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

type Row = {
  id: string;
  profile_id: string;
  type: "basal" | "med" | "glucose" | "custom";
  label: string | null;
  time: string;
  enabled: number;
  alarm_enabled: number;
};
const rows: Row[] = [];
const scheduled = new Map<string, { route?: string }>();
let scheduleCalls = 0;
const rig = { failIdentifier: "", profileReadFails: false };

const notifications = {
  setNotificationHandler: () => {},
  setNotificationCategoryAsync: async () => {},
  setNotificationChannelAsync: async () => {},
  deleteNotificationChannelAsync: async () => {},
  getNotificationChannelAsync: async () => null,
  getPermissionsAsync: async () => ({ status: "granted", canAskAgain: true }),
  requestPermissionsAsync: async () => ({ status: "granted", canAskAgain: true }),
  scheduleNotificationAsync: async (req: {
    identifier: string;
    content: { data?: { route?: string } };
  }) => {
    scheduleCalls++;
    if (rig.failIdentifier && req.identifier === rig.failIdentifier) {
      throw new Error("os refused");
    }
    scheduled.set(req.identifier, { route: req.content.data?.route });
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

const profile = { id: "p1", insulin_mode: "both", oral_meds_enabled: 1 };
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
      getProfile: async () => {
        if (rig.profileReadFails) throw new Error("db locked");
        return profile;
      },
      listProfiles: async () => [profile],
    };
  }
  if (request.endsWith("/db/reminders")) {
    return {
      applyLegacyRemindersBridge: async () => false,
      dedupeBasalReminderRows: async () => {},
      listReminders: async () => rows.map((r) => ({ ...r })),
    };
  }
  if (request.endsWith("zerospike-live-activity")) {
    return { endPostMealActivity: () => {}, startPostMealActivity: () => {} };
  }
  if (request.endsWith("zerospike-alarmkit")) return alarmkit;
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

const settle = () => new Promise<void>((r) => setTimeout(r, 40));

function routesOf(): string[] {
  return [...scheduled.entries()]
    .filter(([id]) => id.startsWith("zerospike-rem-"))
    .map(([, v]) => v.route ?? "")
    .sort();
}
const POSTMEAL_ID = "zerospike-postmeal-reminder:p1";

function seedRows(): void {
  rows.length = 0;
  const base = { profile_id: "p1", label: null, alarm_enabled: 0, enabled: 1 };
  rows.push(
    { ...base, id: "g1", type: "glucose", time: "08:00" },
    { ...base, id: "g2", type: "glucose", time: "13:00" },
    { ...base, id: "b1", type: "basal", time: "22:00" },
    { ...base, id: "m1", type: "med", time: "09:00" },
    { ...base, id: "c1", type: "custom", time: "18:00", label: "Walk" }
  );
}

async function main(): Promise<void> {
  const notif = await import("../lib/services/notifications");
  const state = await import("../lib/cgm/state");
  const events = await import("../lib/cgm/importEvents");
  const mode = await import("../lib/cgm/reminderMode");
  const link = await import("../lib/cgm/postMealLink");
  const prefsMod = await import("../lib/services/notificationPrefs");

  kv.set("zerospike.activeProfile", "p1");
  seedRows();

  console.log("A. manual is the default: everything is scheduled");
  await notif.applyNotificationPrefs();
  eq("glucose, glucose, basal, med, custom", routesOf(), ["basal", "custom", "glucose", "glucose", "med"]);

  console.log("B. sensor mode: measurement reminders are off, the rest unchanged");
  await state.setCgmMode("p1", "cgm");
  await settle();
  eq("the mode change re-applied by itself", routesOf(), ["basal", "custom", "med"]);
  eq("no row was disabled or deleted", rows.map((r) => r.enabled), [1, 1, 1, 1, 1]);
  await notif.applyNotificationPrefs();
  eq("an explicit apply agrees", routesOf(), ["basal", "custom", "med"]);

  console.log("C. the user can turn one back on");
  await mode.setGlucoseOptIn("p1", "g2", true);
  await notif.applyNotificationPrefs();
  eq("only the chosen measurement reminder is armed", routesOf(), ["basal", "custom", "glucose", "med"]);
  eq("it is the chosen one", scheduled.has("zerospike-rem-g2") && !scheduled.has("zerospike-rem-g1"), true);
  await mode.setGlucoseOptIn("p1", "g2", false);
  await notif.applyNotificationPrefs();
  eq("and off again", routesOf(), ["basal", "custom", "med"]);

  console.log("D. an import schedules nothing");
  const before = scheduleCalls;
  events.emitCgmChanged({ kind: "import", profileId: "p1" });
  await settle();
  eq("no notification call at all", scheduleCalls, before);
  eq("nothing new is pending", routesOf(), ["basal", "custom", "med"]);

  console.log("E. the countdown in sensor mode");
  eq("an automatic meal reminder stays off", await notif.schedulePostMealReminder(null), "off");
  eq("nothing armed for it", scheduled.has(POSTMEAL_ID), false);
  const started = await notif.startPostMealTimer(0);
  eq("the user's own countdown starts", started.kind, "started");
  eq("with no notification armed", scheduled.has(POSTMEAL_ID), false);
  const running = await notif.getPostMealTimerState();
  eq("the countdown itself runs", running != null && running.endsAt > Date.now(), true);
  const pending = await link.listPendingLinks("p1");
  eq("the 2-hour value is waiting for the sensor", pending.length, 1);
  eq("targeted at the end of the window", pending[0]?.targetAt, running?.endsAt);

  console.log("F. an import cannot fire it either");
  const calls = scheduleCalls;
  events.emitCgmChanged({ kind: "import", profileId: "p1" });
  await settle();
  eq("still nothing scheduled", scheduleCalls, calls);

  console.log("G. back to manual restores the reminders and the delivery");
  await state.setCgmMode("p1", "manual");
  await settle();
  eq("measurement reminders are back", routesOf(), ["basal", "custom", "glucose", "glucose", "med"]);
  eq("the running countdown gets its notification again", scheduled.has(POSTMEAL_ID), true);
  eq("data was never touched", rows.length, 5);

  console.log("H. manual behavior is unchanged");
  await notif.cancelPostMealTimer();
  kv.delete(link.postMealLinkKey("p1"));
  eq("cancel clears the delivery", scheduled.has(POSTMEAL_ID), false);
  eq("an automatic meal reminder starts", await notif.schedulePostMealReminder(null), "started");
  eq("with its notification", scheduled.has(POSTMEAL_ID), true);
  eq("and no sensor link is waiting", (await link.listPendingLinks("p1")).length, 0);
  await notif.cancelPostMealTimer();

  console.log("I. entering sensor mode with a countdown already armed");
  eq("manual start", (await notif.startPostMealTimer(0)).kind, "started");
  eq("armed", scheduled.has(POSTMEAL_ID), true);
  await state.setCgmMode("p1", "nightscout");
  await settle();
  eq("its notification is taken down", scheduled.has(POSTMEAL_ID), false);
  eq("the countdown keeps running", (await notif.getPostMealTimerState()) != null, true);
  eq("the sensor link is waiting", (await link.listPendingLinks("p1")).length, 1);
  await notif.cancelPostMealTimer();
  eq("cancelling withdraws the waiting link", (await link.listPendingLinks("p1")).length, 0);
  await state.setCgmMode("p1", "manual");
  await settle();

  console.log("J. applyReminders returns its own failure count");
  const prefs = { ...(await prefsMod.getNotificationPrefs()), enabled: true };
  rig.failIdentifier = "zerospike-rem-b1";
  eq("one row the OS refused", await notif.applyReminders(prefs), 1);
  rig.failIdentifier = "";
  eq("the next pass starts from zero", await notif.applyReminders(prefs), 0);
  rig.failIdentifier = "zerospike-rem-b1";
  eq("failure again", await notif.applyReminders(prefs), 1);
  rig.failIdentifier = "";
  rig.profileReadFails = true;
  eq("an unreadable profile does not repeat the old count", await notif.applyReminders(prefs), 0);
  rig.profileReadFails = false;
  eq("the old counter is gone", (notif as Record<string, unknown>).lastReminderScheduleFailures, undefined);
  eq("applyNotificationPrefs passes the count on", await (async () => {
    rig.failIdentifier = "zerospike-rem-m1";
    const n = await notif.applyNotificationPrefs();
    rig.failIdentifier = "";
    return n;
  })(), 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
