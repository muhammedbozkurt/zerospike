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

/**
 * The post-meal window, in minutes. FIXED (2.3.0's G15): the user does not
 * choose it and no screen offers a picker.
 *
 * It used to be a 60/90/120/150 preference. That setting answered a question
 * nobody was asking - the two hours are a property of the check itself, not a
 * taste - while the thing people really needed had no answer at all: "I forgot
 * to tap when I started eating". So the length became one constant and the
 * adjustable part became WHEN the meal began (see startPostMealLate).
 */
export const POST_MEAL_WINDOW_MIN = 120;

/** The range a countdown may actually be armed for: never less than five
 *  minutes (a shorter one is noise), never more than the window itself. */
export const POST_MEAL_MIN_MINUTES = 5;
export const POST_MEAL_MAX_MINUTES = POST_MEAL_WINDOW_MIN;

/**
 * How far back "I started eating" may be moved.
 *
 * Deliberately PAST the window: a user who ate three hours ago has to be able
 * to say so and be told the check has already passed, rather than being capped
 * at some number that silently arms a countdown for a meal that is long over.
 * Anything from POST_MEAL_WINDOW_MIN upwards reports "elapsed" (see
 * startPostMealLate); this is only the point where the input stops moving.
 */
export const POST_MEAL_LATE_MAX_MIN = 240;

/**
 * The single validation point for a countdown length. Anything a caller hands
 * in becomes a whole number of minutes inside the supported range; a non-number
 * falls back to the low end rather than arming a NaN countdown that would never
 * fire.
 */
export function clampPostMealMinutes(n: number): number {
  if (!Number.isFinite(n)) return POST_MEAL_MIN_MINUTES;
  const rounded = Math.round(n);
  if (rounded < POST_MEAL_MIN_MINUTES) return POST_MEAL_MIN_MINUTES;
  if (rounded > POST_MEAL_MAX_MINUTES) return POST_MEAL_MAX_MINUTES;
  return rounded;
}

/** The same gate for "how long ago did you start eating": whole minutes, never
 *  negative (the meal cannot be in the future), never past the far end of the
 *  input's own range. A value inside the range can still be too late to arm -
 *  that is startPostMealLate's answer, not this one's. */
export function clampPostMealLateMinutes(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  if (rounded < 0) return 0;
  if (rounded > POST_MEAL_LATE_MAX_MIN) return POST_MEAL_LATE_MAX_MIN;
  return rounded;
}

/** What a late "I started eating N minutes ago" can produce. */
export type PostMealLateStart =
  /** Arm the countdown: `startedAt` is BACKDATED to the real meal moment, so
   *  the end lands two hours after the meal and not two hours after the tap. */
  | { kind: "start"; startedAt: number; endsAt: number; remainingMs: number }
  /** The window is already over: nothing is armed, and the screen says so. */
  | { kind: "elapsed" };

/**
 * "I started eating N minutes ago" (2.3.0's G15).
 *
 * The window belongs to the MEAL: `startedAt` moves back by `minutesAgo` and
 * the end stays exactly POST_MEAL_WINDOW_MIN after it, so a user who taps 30
 * minutes late is reminded 90 minutes from now - at the physiologically right
 * moment - instead of 120. The backdated start is also what the dashboard
 * progress bar and the Live Activity read, so all three agree.
 *
 * Reports "elapsed" once less than the scheduler floor is left
 * (POST_MEAL_MIN_SCHEDULE_MS), the same threshold every other re-timing in this
 * file uses: a countdown that cannot be placed at its real moment must not be
 * placed at a fake one. A meal POST_MEAL_WINDOW_MIN or more in the past always
 * lands there, which is what the sheet turns into "record the reading instead".
 */
export function startPostMealLate(input: {
  minutesAgo: number;
  now: number;
}): PostMealLateStart {
  const minutesAgo = clampPostMealLateMinutes(input.minutesAgo);
  const startedAt = input.now - minutesAgo * 60_000;
  const endsAt = startedAt + POST_MEAL_WINDOW_MIN * 60_000;
  const remainingMs = endsAt - input.now;
  if (remainingMs < POST_MEAL_MIN_SCHEDULE_MS) return { kind: "elapsed" };
  return { kind: "start", startedAt, endsAt, remainingMs };
}

/**
 * Where a running timer started, for a timer persisted before the start moment
 * was recorded: it can only be recovered from the end and the window it was
 * armed with.
 */
export function derivePostMealStart(endsAt: number, windowMin: number): number {
  return endsAt - Math.round(windowMin * 60_000);
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
 * landing (a slow device, a retry) is seconds, never minutes; anything past
 * this is a meal being written up after the fact, and starting a countdown
 * from now for a meal that already happened would put the check in the wrong
 * place. Such a record arms nothing, and the user can still start one himself
 * (the dashboard's own "I started eating a while ago").
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
 *  already passed and there is nothing to arm. */
export type PostMealRestart =
  | { kind: "restarted"; startedAt: number; endsAt: number; remainingMs: number }
  | { kind: "elapsed"; startedAt: number; endsAt: number };

/**
 * Arms a fresh window starting at `startedAt` rather than at "now": the
 * dashboard's "restart for this meal" action anchors the countdown to the meal
 * that was just logged, not to the moment the user tapped the action.
 *
 * Shares the scheduler floor with startPostMealLate (under
 * POST_MEAL_MIN_SCHEDULE_MS counts as over, not rounded up to a minute) but
 * starts clean from `startedAt` instead of measuring back from now.
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

/**
 * Which of the two actions the RUNNING countdown card offers, and the meal a
 * restart would anchor to.
 *
 * They are mutually exclusive, which is the fix device QA asked for: the card
 * used to keep "Log a meal" up permanently and add "Restart for this meal"
 * beside it, so after logging a meal the user faced two actions that both
 * looked like the thing to do next, one of which ("log a meal") they had
 * demonstrably just done. Once a meal belonging to this window exists, the only
 * open question is whether the countdown should move to it.
 *
 * Adding a SECOND meal mid-window is still possible, through the dashboard's
 * own "+" add-record flow. It does not need a place on this card.
 *
 * `startedAt` is the timer's own anchor, not "now": a meal logged BEFORE the
 * countdown started belongs to an earlier window (or to nothing), and offering
 * to re-anchor onto it would move the countdown backwards. That case keeps the
 * plain "log a meal" action, exactly as if no meal existed at all.
 *
 * Order-independent by design: the newest qualifying meal wins, whatever order
 * the caller's feed is in.
 */
export interface PostMealCardActions {
  /** Show the "log a meal" shortcut. */
  logMeal: boolean;
  /** Show "restart for this meal". Never true at the same time as `logMeal`. */
  restart: boolean;
  /** The meal a restart would anchor to, or null when there is none. */
  restartMealId: string | null;
}

export function postMealCardActions(input: {
  meals: readonly { id: string; loggedAtMs: number }[];
  startedAt: number;
}): PostMealCardActions {
  let candidate: { id: string; loggedAtMs: number } | null = null;
  for (const meal of input.meals) {
    if (!Number.isFinite(meal.loggedAtMs)) continue;
    if (meal.loggedAtMs <= input.startedAt) continue;
    if (candidate == null || meal.loggedAtMs > candidate.loggedAtMs) candidate = meal;
  }
  return candidate
    ? { logMeal: false, restart: true, restartMealId: candidate.id }
    : { logMeal: true, restart: false, restartMealId: null };
}
