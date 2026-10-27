import { Platform } from "react-native";
import { logCrash } from "../analytics";
import { safeRequire } from "../safeNative";
import { getHealthBackgroundBlocker } from "./health";
import type { HealthBackgroundSkip } from "./health";
import { planBackground } from "../nightscout/background";
import { nightscoutBackgroundWanted, syncSourcesInBackground } from "./sourceSync";
import { healthAppleKit } from "./healthAppleKit";
import { healthConnect } from "./healthConnect";

/**
 * Background source sync (Health, plus Nightscout when connected). The Android
 * task is defined here at MODULE scope (expo-task-manager runs it in a headless JS launch where no view mounts), so
 * the app entry must import this file for its side effect, e.g.
 * `import "../lib/services/healthBackground"` in app/_layout.tsx. iOS needs
 * registerHealthBackground() at every start too: the HKObserverQuery
 * subscription lives in JS and is re-created on each (also background) launch.
 */

export const HEALTH_BACKGROUND_TASK = "zerospike-health-sync";
/** expo-background-task minimumInterval is in minutes; Android WorkManager's floor. */
const MIN_INTERVAL_MINUTES = 15;

export type HealthBackgroundReason = HealthBackgroundSkip | "unsupported_platform" | "register_failed";

export interface HealthBackgroundState {
  active: boolean;
  /** Why it is not active; null when active. */
  reason: HealthBackgroundReason | null;
}

type TaskManagerModule = typeof import("expo-task-manager");
type BackgroundTaskModule = typeof import("expo-background-task");

function loadAndroidModules(): { TM: TaskManagerModule; BT: BackgroundTaskModule } | null {
  if (Platform.OS !== "android") return null;
  const TM = safeRequire(() => require("expo-task-manager") as TaskManagerModule, "health.taskManager");
  const BT = safeRequire(() => require("expo-background-task") as BackgroundTaskModule, "health.backgroundTask");
  return TM && BT ? { TM, BT } : null;
}

function defineAndroidTask(): void {
  const mods = loadAndroidModules();
  if (!mods) return;
  try {
    if (mods.TM.isTaskDefined(HEALTH_BACKGROUND_TASK)) return;
    mods.TM.defineTask(HEALTH_BACKGROUND_TASK, async () => {
      try {
        const out = await syncSourcesInBackground();
        return out.failed ? mods.BT.BackgroundTaskResult.Failed : mods.BT.BackgroundTaskResult.Success;
      } catch (err) {
        logCrash(err, { screen: "health", op: "backgroundTask" });
        return mods.BT.BackgroundTaskResult.Failed;
      }
    });
  } catch (err) {
    logCrash(err, { screen: "health", op: "defineBackgroundTask" });
  }
}

defineAndroidTask();

async function unregisterAndroid(): Promise<void> {
  const mods = loadAndroidModules();
  if (!mods) return;
  try {
    if (await mods.TM.isTaskRegisteredAsync(HEALTH_BACKGROUND_TASK)) {
      await mods.BT.unregisterTaskAsync(HEALTH_BACKGROUND_TASK);
    }
  } catch {
    // best-effort: an already-gone task is the goal state
  }
}

/**
 * Brings background delivery in line with the current switches: on when the
 * profile's sync and background switches are on, the user is entitled and the
 * read (plus, on Android, background read) permission is granted, or on Android
 * when a Nightscout connection is active and entitled (planBackground); off
 * otherwise. iOS never registers a task for Nightscout. Call at app start and
 * after any of those inputs changes. Never prompts and never throws.
 */
export async function registerHealthBackground(): Promise<HealthBackgroundState> {
  try {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      return { active: false, reason: "unsupported_platform" };
    }
    const blocker = await getHealthBackgroundBlocker();
    const plan = planBackground({
      platform: Platform.OS,
      healthBlocker: blocker,
      nightscoutWanted: await nightscoutBackgroundWanted(),
    });
    if (!plan.androidTask && !plan.iosObserver) {
      await stopHealthBackground();
      return { active: false, reason: blocker };
    }
    if (Platform.OS === "ios") {
      const ok = await healthAppleKit.startBackgroundObserver(() => {
        void syncSourcesInBackground();
      });
      return ok ? { active: true, reason: null } : { active: false, reason: "register_failed" };
    }
    const mods = loadAndroidModules();
    if (!mods) return { active: false, reason: "register_failed" };
    const status = await mods.BT.getStatusAsync();
    if (status === mods.BT.BackgroundTaskStatus.Restricted) {
      return { active: false, reason: "register_failed" };
    }
    if (!(await mods.TM.isTaskRegisteredAsync(HEALTH_BACKGROUND_TASK))) {
      await mods.BT.registerTaskAsync(HEALTH_BACKGROUND_TASK, {
        minimumInterval: MIN_INTERVAL_MINUTES,
      });
    }
    return { active: true, reason: null };
  } catch (err) {
    logCrash(err, { screen: "health", op: "registerHealthBackground" });
    return { active: false, reason: "register_failed" };
  }
}

export async function stopHealthBackground(): Promise<void> {
  if (Platform.OS === "ios") await healthAppleKit.stopBackgroundObserver();
  else await unregisterAndroid();
}

/** Android: asks Health Connect for READ_HEALTH_DATA_IN_BACKGROUND (a system
 *  dialog, so only from a user action), then re-registers. */
export async function requestHealthBackgroundAccess(): Promise<HealthBackgroundState> {
  if (Platform.OS === "android") await healthConnect.requestBackgroundReadPermission();
  return registerHealthBackground();
}
