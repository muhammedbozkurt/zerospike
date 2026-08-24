/**
 * Post-meal reminder countdown formatting. Pure and i18n-free: it only decides
 * the display number and which unit to show, so the caller picks the localized
 * phrase. Minutes are rounded up (the label reads "1 min" through the final
 * minute); once under a minute remains it switches to a whole-second readout.
 */
export interface PostMealCountdown {
  /** true when under a minute remains (show seconds), else minutes. */
  seconds: boolean;
  /** whole minutes when `seconds` is false, whole seconds when true. */
  value: number;
}

export function formatPostMealRemaining(remainingMs: number): PostMealCountdown {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (totalSeconds <= 60) return { seconds: true, value: totalSeconds };
  return { seconds: false, value: Math.ceil(totalSeconds / 60) };
}

/** A running post-meal timer: the moment it was armed and the moment it is due. */
export interface PostMealTimerWindow {
  /** epoch ms the timer was armed. */
  startedAt: number;
  /** epoch ms it is due. */
  endsAt: number;
  /** Profile the timer was armed for. Absent on a timer persisted before this
   *  field existed (or a device-wide demo seed) - such a timer is treated as
   *  belonging to whichever profile is active (legacy compatibility). */
  profileId?: string;
}

/**
 * Shortest interval the reminder can actually be scheduled for: expo-notifications
 * takes a TIME_INTERVAL in whole seconds and the scheduler floors this timer at
 * 60 s, so anything under it cannot be placed at its real moment.
 */
export const POST_MEAL_MIN_SCHEDULE_MS = 60_000;

/**
 * The one rule for "is this running countdown THIS profile's business".
 *
 * A caregiver who starts a countdown on one profile and switches to another
 * must not see it presented as the new profile's own - not on the dashboard
 * card, not in the reminders screen's upcoming list, not on the post-meal deep
 * link. The timer itself is left alone either way, so it reappears the moment
 * its owner is active again.
 *
 * A timer with NO recorded owner predates the lock (or came from a seed) and
 * belongs to whoever is looking, exactly as it did before.
 */
export function postMealWindowForProfile(
  timer: PostMealTimerWindow | null,
  activeProfileId: string | null | undefined
): PostMealTimerWindow | null {
  if (timer == null) return null;
  if (timer.profileId == null) return timer;
  return timer.profileId === activeProfileId ? timer : null;
}

/** The range a one-off post-meal countdown may be started with (2.3.0's K2-C).
 *  Wider than the saved preference's own 60/90/120/150 list on purpose: the
 *  one-off picker exists precisely for the meal that does not fit it. */
export const POST_MEAL_MIN_MINUTES = 5;
export const POST_MEAL_MAX_MINUTES = 360;

/**
 * The single validation point for a hand-picked countdown length. Anything the
 * duration sheet or a caller hands in becomes a whole number of minutes inside
 * the supported range; a non-number falls back to the low end rather than
 * arming a NaN countdown that would never fire.
 */
export function clampPostMealMinutes(n: number): number {
  if (!Number.isFinite(n)) return POST_MEAL_MIN_MINUTES;
  const rounded = Math.round(n);
  if (rounded < POST_MEAL_MIN_MINUTES) return POST_MEAL_MIN_MINUTES;
  if (rounded > POST_MEAL_MAX_MINUTES) return POST_MEAL_MAX_MINUTES;
  return rounded;
}

/**
 * Where a running timer started, for a timer persisted before the start moment
 * was recorded: it can only be recovered from the end and the window it was
 * armed with.
 */
export function derivePostMealStart(endsAt: number, windowMin: number): number {
  return endsAt - Math.round(windowMin * 60_000);
}

export type PostMealRetime =
  /** The new window lands on the same moment: nothing to re-arm. */
  | { kind: "unchanged"; startedAt: number; endsAt: number }
  /** Move the timer to `endsAt`; `remainingMs` is what is left from `now`. */
  | { kind: "retimed"; startedAt: number; endsAt: number; remainingMs: number }
  /** The new window is already behind us: the timer is over, nothing to fire. */
  | { kind: "elapsed"; startedAt: number; endsAt: number };

/**
 * Re-times a RUNNING post-meal timer for a new window length, keeping the time
 * already elapsed. The window is measured from the meal, not from the settings
 * change: a 120 min timer with 10 min behind it becomes 80 min remaining at 90,
 * and 130 min remaining at 150.
 *
 * When the new window is shorter than what has already passed the timer is over
 * ("elapsed"): the caller takes the pending reminder and the Live Activity down
 * cleanly and fires NOTHING - a nudge landing the instant a preference is
 * changed is noise, not a reminder about a meal.
 *
 * Pure: no storage, no clock of its own.
 */
export function retimePostMealWindow(input: {
  startedAt: number;
  currentEndsAt: number;
  nextWindowMin: number;
  now: number;
}): PostMealRetime {
  const { startedAt, currentEndsAt, nextWindowMin, now } = input;
  const endsAt = startedAt + Math.round(nextWindowMin * 60_000);
  if (endsAt === currentEndsAt) return { kind: "unchanged", startedAt, endsAt };
  const remainingMs = endsAt - now;
  // Under the scheduler floor counts as over: it cannot be placed at its real
  // moment, and rounding it up to 60 s would fire after the countdown reads 0.
  if (remainingMs < POST_MEAL_MIN_SCHEDULE_MS) {
    return { kind: "elapsed", startedAt, endsAt };
  }
  return { kind: "retimed", startedAt, endsAt, remainingMs };
}

/**
 * How much of the timer's own window has passed, in 0..1, for the progress bar.
 * Read from the timer itself rather than from the current preference, so the bar
 * still describes the running timer when the two differ.
 */
export function postMealElapsedFraction(
  window: PostMealTimerWindow,
  now: number
): number {
  const total = window.endsAt - window.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - window.startedAt) / total));
}

/**
 * How far behind "now" a meal record can be and still count as "just ate" for
 * the AUTO-START decision below. The gap between a tap and the row actually
 * landing (a slow device, a retry) is seconds, never minutes - anything past
 * this really was logged for an earlier meal on purpose.
 */
export const POST_MEAL_AUTO_START_TOLERANCE_MS = 5 * 60_000;

/**
 * What logging a MEAL should do to the post-meal timer, decided in exactly one
 * place so every call site (calculator save, template confirm, the QuickAdd
 * meal form, a one-tap relog) asks the same question instead of each guessing
 * at it with its own if:
 *
 * - "active": a timer is already running. It is left exactly where it is - the
 *   meal that triggered this decision may be a second helping eaten mid-
 *   countdown, and restarting the clock for every bite would mean the "2 hours
 *   after eating" reminder never actually lands 2 hours after the FIRST bite.
 *   (See restartPostMealWindowAt for the deliberate, user-initiated way to move
 *   the anchor instead.)
 * - "backdated": idle, but the record is not close to now (logging last night's
 *   dinner today). Arming a countdown that fires relative to right now, for a
 *   meal that already happened, would be a nudge about nothing.
 * - "start": idle and the record is close to now - arm it, same as always.
 */
export type PostMealAutoStartDecision = "active" | "backdated" | "start";

export function decidePostMealAutoStart(input: {
  /** A timer is already running; its own window does not matter here. */
  timerActive: boolean;
  /** epoch ms the meal was actually logged at. */
  loggedAtMs: number;
  /** epoch ms "now" (when the auto-start check runs). */
  now: number;
}): PostMealAutoStartDecision {
  if (input.timerActive) return "active";
  if (input.now - input.loggedAtMs > POST_MEAL_AUTO_START_TOLERANCE_MS) return "backdated";
  return "start";
}

/** Re-arming a timer from a given moment (see restartPostMealWindowAt) instead
 *  of from "now": either it lands with time left, or that much window has
 *  already passed and there is nothing left to count down. */
export type PostMealRestart =
  | { kind: "restarted"; startedAt: number; endsAt: number; remainingMs: number }
  | { kind: "elapsed"; startedAt: number; endsAt: number };

/**
 * Arms a fresh window starting at `startedAt` rather than at "now": the
 * dashboard's "restart for this meal" action anchors the countdown to the meal
 * that was just logged, not to the moment the user tapped the action.
 *
 * Shares the scheduler-floor handling with retimePostMealWindow (under
 * POST_MEAL_MIN_SCHEDULE_MS counts as over, not rounded up to a minute) but
 * starts clean from `startedAt` instead of re-measuring an already-running
 * timer's own start.
 */
export function restartPostMealWindowAt(input: {
  startedAt: number;
  windowMin: number;
  now: number;
}): PostMealRestart {
  const { startedAt, windowMin, now } = input;
  const endsAt = startedAt + Math.round(windowMin * 60_000);
  const remainingMs = endsAt - now;
  if (remainingMs < POST_MEAL_MIN_SCHEDULE_MS) {
    return { kind: "elapsed", startedAt, endsAt };
  }
  return { kind: "restarted", startedAt, endsAt, remainingMs };
}
