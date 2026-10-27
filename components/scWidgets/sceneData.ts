import { formatGlucose } from "../../lib/glucose";
import type { LiveData } from "../../lib/services/liveData";

/**
 * The store-screenshot scene's fixed clock and fixed numbers.
 *
 * Everything a reader can compare across the nine languages and five profiles
 * has to be the SAME in all 45 captures, and last round it was not: the 7-day
 * average drifted (118 / 120 / 123 / 125 / 133 between profiles) because the
 * seed's own rolling window kept re-averaging, the lock-screen clock printed
 * the real wall time (01:34 on one capture, 10:14 on another) against a status
 * bar frozen at 9:41, the elapsed line read "0 dk once" or "15 sa 52 dk once"
 * depending on how long the emulator had been up, and the Android timer tile
 * printed whatever end time the shoot happened to land on.
 *
 * So the whole scene is anchored to ONE instant - today at 9:41, the time
 * simctl/adb already froze the status bar at - and every relative number is
 * derived from it:
 *
 *   last reading   112 mg/dL, logged 12 minutes before the anchor
 *   7-day average  125 mg/dL, fixed (the dashboard's 7-day average)
 *   post-meal      72 of 120 minutes left -> "1:12:00"
 *   next reminder  49 minutes after the anchor
 *
 * Only VALUES are overridden. Every label still comes from the snapshot
 * computeLiveData built (`labels.timerTitle` is the same "Tokluk ölçümü" (tr) the
 * real PostMealActivity.swift prints via context.attributes.title, and the
 * Android twin buildTimerWidget in lib/services/androidWidget.ts), so this scene can
 * never show a string the shipped widgets do not.
 */
export const SCENE_LAST_MGDL = 112;
export const SCENE_AVG_MGDL = 125;
export const SCENE_ELAPSED_MIN = 12;
export const SCENE_TIMER_REMAINING_MIN = 72;
/** The whole armed window (start..end): 48 of 120 min elapsed -> the island's
 *  progress bar reads 40%. */
export const SCENE_TIMER_WINDOW_MIN = 120;

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/**
 * The anchor instant: today at 9:41 local.
 *
 * `mustBeFuture` is for Android only. The iOS scenes are all handed this same
 * value as their `now`, so nothing there ever consults the real clock. The
 * Android widgets are built by lib/services/androidWidget.ts, which compares
 * `postMealEndsAt` against Date.now() itself (postMealEndsTimeLabel) and falls
 * back to the IDLE tile once the anchor has passed - so on Android the anchor
 * rolls to tomorrow's 9:41 whenever today's is not comfortably ahead. Nothing
 * on an Android capture prints a date, so the roll is invisible; on iOS the
 * iPad status bar DOES print one, which is exactly why iOS keeps today.
 */
export function sceneAnchor(mustBeFuture: boolean): number {
  const d = new Date();
  d.setHours(9, 41, 0, 0);
  let t = d.getTime();
  if (mustBeFuture && t <= Date.now() + (SCENE_TIMER_REMAINING_MIN + 20) * MIN) t += DAY;
  return t;
}

/** The optional sensor variant of the scene (?cgm=1, Android widgets only; the
 *  store's 04-widgets frame stays manual). */
export const SCENE_CGM_AGE_MIN = 4;

/**
 * The same scene in a sensor mode: 112 mg/dL, 4 minutes old. The Android
 * builders measure the age against the real clock (they run on a home screen),
 * so `base` is the real now there and the anchor everywhere else.
 */
export function sceneCgmSnapshot(snapshot: LiveData, anchor: number, base: number): LiveData {
  const scene = sceneSnapshot(snapshot, anchor);
  return {
    ...scene,
    mode: "cgm",
    cgm: {
      mgdl: SCENE_LAST_MGDL,
      at: base - SCENE_CGM_AGE_MIN * MIN,
      trend: null,
      ageMin: SCENE_CGM_AGE_MIN,
      display: formatGlucose(SCENE_LAST_MGDL, scene.unit),
    },
  };
}

/** Pins the snapshot's numbers to the anchor. Labels, unit, band, and the
 *  insulin/oral flags are passed through untouched. */
export function sceneSnapshot(snapshot: LiveData, anchor: number): LiveData {
  const unit = snapshot.unit;
  // The store frame is always the manual look, whatever mode the device is in.
  const { cgm: _sensor, ...manual } = snapshot;
  return {
    ...manual,
    mode: "manual",
    updatedAt: anchor,
    lastGlucoseMgdl: SCENE_LAST_MGDL,
    lastGlucoseDisplay: formatGlucose(SCENE_LAST_MGDL, unit),
    lastGlucoseAt: anchor - SCENE_ELAPSED_MIN * MIN,
    avgGlucoseMgdl: SCENE_AVG_MGDL,
    avgGlucoseDisplay: formatGlucose(SCENE_AVG_MGDL, unit),
    postMealEndsAt: anchor + SCENE_TIMER_REMAINING_MIN * MIN,
    postMealStartedAt: anchor + (SCENE_TIMER_REMAINING_MIN - SCENE_TIMER_WINDOW_MIN) * MIN,
    // `nextReminderAt` is deliberately NOT pinned. The seeded reminders only
    // reach computeLiveData once the capture device has granted notification
    // permission, which a fresh simulator has not, so the snapshot carries
    // none - and a reminder invented here would have no name to print either
    // (`nextReminderLabel` comes from the user's own row). The lock-screen
    // families and the glance widget therefore draw their no-reminder state,
    // which is a real state of the real widgets rather than a made-up row.
  };
}
