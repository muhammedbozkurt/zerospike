/**
 * Deleting the profile in use while its post-meal countdown (and lock-screen
 * card) runs must take the card down, although the active-profile read has
 * already fallen through to another profile. Also: clearing logs ends the card,
 * and switching away from a live countdown (owner still exists) ends it too.
 * Run: npx tsx scripts/postMealDeletedOwner.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; env: Record<string, string | undefined> };

import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.TZ = "America/New_York";
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

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
  activityEnds: 0, ends: 0,
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
      endPostMealActivity: () => { rig.ends++; },
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
  const { profileScopedKeys } = await import("../lib/profileScopedKeys");

  console.log("R1. delete the active profile while its countdown (and card) runs");
  await resetWorld("p1");
  eq("p1 starts", (await notif.startPostMealTimer(0)).kind, "started");
  rig.ends = 0;
  // app/settings/data.tsx onDeleteProfile order:
  const runningTimer = await notif.getPostMealTimerState("p1");
  const saved = profiles.p1;
  delete profiles.p1; // deleteProfile drops the row
  await AsyncStorage.multiRemove(profileScopedKeys("p1")); // and sweeps scoped keys
  if (runningTimer?.profileId === "p1") await notif.cancelPostMealTimer("p1");
  switchTo("p2"); // setActiveProfileId(next)
  await notif.applyNotificationPrefs();
  eq("notification of the deleted profile is gone", pending(), []);
  eq("the deleted profile's lock-screen card is taken down", rig.ends > 0, true);
  profiles.p1 = saved;

  console.log("R2. clear-logs path (active profile stays)");
  await resetWorld("p1");
  await notif.startPostMealTimer(0);
  rig.ends = 0;
  await notif.cancelPostMealTimer("p1");
  eq("clear-logs path ends the card", rig.ends > 0, true);

  console.log("R3. control: switch away from a live countdown (p1 exists) ends the card");
  await resetWorld("p1");
  await notif.startPostMealTimer(0);
  rig.ends = 0;
  switchTo("p2");
  await notif.applyNotificationPrefs();
  eq("control: card ended on switch", rig.ends > 0, true);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
