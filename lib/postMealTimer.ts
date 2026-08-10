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
}

/**
 * Shortest interval the reminder can actually be scheduled for: expo-notifications
 * takes a TIME_INTERVAL in whole seconds and the scheduler floors this timer at
 * 60 s, so anything under it cannot be placed at its real moment.
 */
export const POST_MEAL_MIN_SCHEDULE_MS = 60_000;

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
