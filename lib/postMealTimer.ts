import { parseDecimalText } from "./numberInput";

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
 * The post-meal window, in minutes: ALWAYS the default the dashboard card
 * shows and the "I started eating" button arms.
 *
 * 2.3.1 briefly saved a per-profile choice (lib/postMealWindowStore.ts, since
 * removed): a length chosen once and never looked at again became a silent
 * setting the user had forgotten about, and a countdown that starts from a
 * different number every day makes it harder to notice when something is
 * actually off. 2.3.2 dropped the persistence - the duration sheet still lets
 * a user change the length for the ONE timer they are about to start (a
 * shorter snack, a longer meal), but that choice is never written down, so the
 * card is back to this same number the next time. Nothing here is a
 * recommended or medically-derived interval - it is a countdown length the
 * user can set for themselves, one timer at a time.
 */
export const POST_MEAL_WINDOW_MIN = 120;

/** The bounds a countdown length is normalized to: never under five minutes
 *  (noise), never over a full day. No UI field lets a user type one any more
 *  (P14 removed the duration sheet's own length field) - these survive as
 *  clampPostMealWindowMinutes's own range, its one remaining caller being
 *  startPostMealLate's internal windowMin normalization. */
export const POST_MEAL_CUSTOM_MIN_MINUTES = 5;
export const POST_MEAL_CUSTOM_MAX_MINUTES = 1440;

/**
 * Sanitizes a window length (in minutes) to that range. A non-number falls
 * back to the ordinary default rather than to the low end: a corrupted value
 * should read as "back to normal", not silently shorten every future
 * countdown to five minutes.
 */
export function clampPostMealWindowMinutes(n: number): number {
  if (!Number.isFinite(n)) return POST_MEAL_WINDOW_MIN;
  const rounded = Math.round(n);
  if (rounded < POST_MEAL_CUSTOM_MIN_MINUTES) return POST_MEAL_CUSTOM_MIN_MINUTES;
  if (rounded > POST_MEAL_CUSTOM_MAX_MINUTES) return POST_MEAL_CUSTOM_MAX_MINUTES;
  return rounded;
}

/** The range a countdown may actually be armed for: never less than five
 *  minutes (a shorter one is noise), never more than the window itself. */
export const POST_MEAL_MIN_MINUTES = 5;
/** The default cap, equal to the default window. clampPostMealMinutes takes
 *  the REAL cap (the selected window) as its own second argument now; this is
 *  kept only for callers that still want the old fixed number. */
export const POST_MEAL_MAX_MINUTES = POST_MEAL_WINDOW_MIN;

/**
 * How far back "I started eating" may be moved.
 *
 * Deliberately PAST the window: a user who ate three hours ago has to be able
 * to say so and be told the check has already passed, rather than being capped
 * at some number that silently arms a countdown for a meal that is long over.
 * Anything from the selected window upwards reports "elapsed" (see
 * startPostMealLate); this is only the point where the input stops moving.
 */
export const POST_MEAL_LATE_MAX_MIN = 240;

/**
 * The single validation point for a countdown length. Anything a caller hands
 * in becomes a whole number of minutes inside the supported range; a non-number
 * falls back to the low end rather than arming a NaN countdown that would never
 * fire. `windowMin` is the SELECTED window (2.3.1); it defaults to
 * POST_MEAL_WINDOW_MIN so every existing one-argument call keeps its old cap.
 */
export function clampPostMealMinutes(n: number, windowMin: number = POST_MEAL_WINDOW_MIN): number {
  const max = clampPostMealWindowMinutes(windowMin);
  if (!Number.isFinite(n)) return POST_MEAL_MIN_MINUTES;
  const rounded = Math.round(n);
  if (rounded < POST_MEAL_MIN_MINUTES) return POST_MEAL_MIN_MINUTES;
  if (rounded > max) return max;
  return rounded;
}

/** The same gate for "how long ago did you start eating": whole minutes, never
 *  negative (the meal cannot be in the future), never past the far end of the
 *  input's own range. A value inside the range can still be too late to arm -
 *  that is startPostMealLate's answer, not this one's.
 *
 * `windowMin` no longer varies in production (P14 removed the duration
 * sheet's own length field, so every real caller now passes
 * POST_MEAL_WINDOW_MIN or omits it) - the parameter itself stays because
 * scripts/entryGuardWire.test.ts still exercises the two-argument
 * "carry-over" behavior directly. The far end is whichever of the two is
 * LARGER, so a shorter-than-default window still keeps the old 240-minute
 * reach - this stays an input ceiling, not the window's own length. */
export function clampPostMealLateMinutes(n: number, windowMin?: number): number {
  const max = Math.max(POST_MEAL_LATE_MAX_MIN, windowMin ?? POST_MEAL_LATE_MAX_MIN);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  if (rounded < 0) return 0;
  if (rounded > max) return max;
  return rounded;
}

/** What the late-start field's text means. An empty or unreadable field arms
 *  nothing (no value is invented for it); a number is kept as typed unless it
 *  passes the input's reach, in which case it is capped and `clamped` says so. */
export type PostMealLateInput =
  | { kind: "empty" }
  | { kind: "ok"; minutes: number; clamped: boolean };

export function parsePostMealLateInput(text: string): PostMealLateInput {
  const parsed = parseDecimalText(text);
  if (parsed == null) return { kind: "empty" };
  const minutes = clampPostMealLateMinutes(parsed);
  return { kind: "ok", minutes, clamped: minutes !== Math.round(parsed) };
}

/** The late-start field after an edit (typed, pasted or stepped). Any edit
 *  makes the value manual (`fromChip: false`); text past the reach is replaced
 *  by the maximum and `capped` says so, so the field never shows a number other
 *  than the one that will be armed. */
export function editPostMealLateDraft(text: string): {
  draft: string;
  capped: boolean;
  fromChip: false;
} {
  const r = parsePostMealLateInput(text);
  if (r.kind === "ok" && r.clamped) {
    return { draft: String(r.minutes), capped: true, fromChip: false };
  }
  return { draft: text, capped: false, fromChip: false };
}

/** A +/- press: the unclamped result goes through the same gate as typing, so
 *  stepping past the maximum reports the cap exactly as typing would. */
export function stepPostMealLateDraft(current: number | null, delta: number) {
  return editPostMealLateDraft(String(Math.max(0, (current ?? 0) + delta)));
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
 * the end stays exactly `windowMin` after it (2.3.1: the user's own selected
 * length, defaulting to POST_MEAL_WINDOW_MIN), so a user who taps 30 minutes
 * late into a 120-minute window is reminded 90 minutes from now instead of
 * 120. The backdated start is also what the dashboard progress bar and the
 * Live Activity read, so all three agree.
 *
 * Reports "elapsed" once less than the scheduler floor is left
 * (POST_MEAL_MIN_SCHEDULE_MS), the same threshold every other re-timing in this
 * file uses: a countdown that cannot be placed at its real moment must not be
 * placed at a fake one. A meal `windowMin` or more in the past always lands
 * there, which is what the sheet turns into "record the reading instead".
 */
export function startPostMealLate(input: {
  minutesAgo: number;
  now: number;
  /** The countdown length to arm. Defaults to POST_MEAL_WINDOW_MIN so every
   *  existing two-field call keeps arming the old fixed window. */
  windowMin?: number;
}): PostMealLateStart {
  const windowMin = clampPostMealWindowMinutes(input.windowMin ?? POST_MEAL_WINDOW_MIN);
  // The late-start input's own reach follows the SELECTED window (see
  // clampPostMealLateMinutes): without windowMin here, a window wider than
  // POST_MEAL_LATE_MAX_MIN (240) got silently truncated to 240, so "I started
  // 600 minutes ago" inside a 1440-minute window ended the countdown 20 hours
  // out instead of the intended 14.
  const minutesAgo = clampPostMealLateMinutes(input.minutesAgo, windowMin);
  const startedAt = input.now - minutesAgo * 60_000;
  const endsAt = startedAt + windowMin * 60_000;
  const remainingMs = endsAt - input.now;
  if (remainingMs < POST_MEAL_MIN_SCHEDULE_MS) return { kind: "elapsed" };
  return { kind: "start", startedAt, endsAt, remainingMs };
}

/** The one-line answer the late-start sheet shows under the field: the clock
 *  moment the reminder lands and the whole minutes left (rounded up, so it
 *  never reads 0 while time remains). Null once the window is over. */
export function postMealReminderPreview(
  minutesAgo: number,
  now: number
): { atMs: number; leftMin: number } | null {
  const r = startPostMealLate({ minutesAgo, now });
  if (r.kind !== "start") return null;
  return { atMs: r.endsAt, leftMin: Math.ceil(r.remainingMs / 60_000) };
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

/** The span a running window was armed for, in whole minutes. Floored at one
 *  so a corrupted or degenerate pair can never become a zero-length window. */
export function postMealWindowSpanMinutes(window: PostMealTimerWindow): number {
  return Math.max(1, Math.round((window.endsAt - window.startedAt) / 60_000));
}

/**
 * Is there still enough of this window left to put it back (P17)?
 *
 * The question an UNDO has to answer before it touches anything. Pure, and
 * asked first, for a reason that is not tidiness: the only other way to
 * re-arm a stored window (restartPostMealTimerAt) cancels unconditionally when
 * it finds the window elapsed, and that path runs several awaits after its
 * caller last looked at the world - long enough for the user to have armed a
 * fresh countdown that the cancel would then destroy. Deciding here, from two
 * numbers and the clock, means an undo with nothing to restore calls nothing
 * at all.
 *
 * Defined through restartPostMealWindowAt so it shares the scheduler floor
 * (POST_MEAL_MIN_SCHEDULE_MS) with every other re-timing in this file: a
 * countdown that cannot be placed at its real moment is over, not rounded up.
 */
export function postMealWindowRestorable(
  window: PostMealTimerWindow,
  now: number
): boolean {
  return (
    restartPostMealWindowAt({
      startedAt: window.startedAt,
      windowMin: postMealWindowSpanMinutes(window),
      now,
    }).kind === "restarted"
  );
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
  /** Show "restart for the HH:MM meal". Never true at the same time as
   *  `logMeal`; both are false while the countdown is already anchored to the
   *  meal that was logged for it. */
  restart: boolean;
  /** The meal a restart would anchor to, or null when there is none. */
  restartMealId: string | null;
}

/**
 * How far a meal may sit from the countdown's anchor and still BE that
 * countdown's own meal. Applied SYMMETRICALLY: what matters is the distance,
 * not the direction.
 *
 * The direction used to matter, and that was the bug. "I started eating a
 * while ago" sets the anchor from the moment of the TAP minus the user's own
 * estimate, so it lands NEAR the meal but on either side of it - a meal logged
 * at 13:46:12 against an anchor of 13:46:30 is eighteen seconds EARLIER than
 * the anchor. The old one-sided rule dropped such a meal from consideration
 * entirely and fell through to "log a meal", asking the user to record the
 * meal they had just recorded.
 */
export const POST_MEAL_OWN_MEAL_MS = 10 * 60_000;

/**
 * The one predicate for "this meal is the running countdown's OWN meal",
 * shared by everything that has to answer that question - the card's two
 * actions below, and what a DELETE does to the countdown
 * (decidePostMealAfterMealDelete).
 *
 * Symmetric on purpose (see POST_MEAL_OWN_MEAL_MS): the anchor lands near the
 * meal from either side, so only the distance can decide.
 */
export function isPostMealOwnMeal(loggedAtMs: number, startedAt: number): boolean {
  if (!Number.isFinite(loggedAtMs)) return false;
  return Math.abs(loggedAtMs - startedAt) < POST_MEAL_OWN_MEAL_MS;
}

/** What deleting one or more MEAL records does to a running countdown. */
export type PostMealAfterDelete =
  /** The countdown outlives the delete: it was never this meal's. */
  | "keep"
  /** The countdown's own meal is gone and nothing is left for it to be
   *  about, so the countdown ends with it. */
  | "end";

/**
 * What a DELETED meal does to the running post-meal countdown.
 *
 * The rule: a countdown armed by logging a meal exists BECAUSE of that record.
 * Erase the record and the countdown is counting down to a check on a meal the
 * user says never happened - which is what device QA found, a card still
 * reading "2 h post-meal timer, log a meal" for a meal that had just been
 * deleted. So an automatic consequence of a record dies with the record.
 *
 * It is deliberately NOT "any meal delete ends the countdown":
 *
 * - A meal that is not this countdown's own (an older entry, yesterday's
 *   dinner being written up, the second helping the user chose not to
 *   re-anchor onto) leaves it exactly where it is.
 * - A countdown the user armed HIMSELF with "I started eating", with no meal
 *   record near its anchor, is not an automatic consequence of anything and is
 *   never ended by a delete.
 * - If another meal is STILL the countdown's own meal after the delete (two
 *   helpings minutes apart, one of them removed), the countdown still has a
 *   meal to be about and keeps running.
 *
 * Re-anchoring onto some other surviving meal is deliberately not done here:
 * that silently moves the moment the user is reminded at, and the card's own
 * "restart for this meal" already exists for when they want that.
 */
export function decidePostMealAfterMealDelete(input: {
  /** The running countdown's anchor. */
  startedAt: number;
  /** logged_at (epoch ms) of every meal the delete removed. */
  deletedMealsMs: readonly number[];
  /** logged_at (epoch ms) of the meals STILL recorded. May be a band around
   *  the anchor rather than every meal there is - only meals near the anchor
   *  can change the answer. */
  remainingMealsMs: readonly number[];
}): PostMealAfterDelete {
  const wasOwn = input.deletedMealsMs.some((ms) => isPostMealOwnMeal(ms, input.startedAt));
  if (!wasOwn) return "keep";
  const stillOwned = input.remainingMealsMs.some((ms) =>
    isPostMealOwnMeal(ms, input.startedAt)
  );
  return stillOwned ? "keep" : "end";
}

export function postMealCardActions(input: {
  meals: readonly { id: string; loggedAtMs: number }[];
  startedAt: number;
}): PostMealCardActions {
  // The NEWEST meal that could belong to this window decides. A meal further
  // back than the window belongs to an EARLIER countdown (or to nothing):
  // re-anchoring onto it would move the end backwards, so it is not a
  // candidate at all and the card falls through to offering a fresh meal.
  let candidate: { id: string; loggedAtMs: number } | null = null;
  for (const meal of input.meals) {
    if (!Number.isFinite(meal.loggedAtMs)) continue;
    if (meal.loggedAtMs - input.startedAt <= -POST_MEAL_OWN_MEAL_MS) continue;
    if (candidate == null || meal.loggedAtMs > candidate.loggedAtMs) candidate = meal;
  }
  if (candidate == null) return { logMeal: true, restart: false, restartMealId: null };
  // SYMMETRIC: what matters is the distance from the anchor, not the side it
  // falls on. This is the countdown's own meal, so offering to log one would
  // ask for something that plainly exists and offering to restart would ask the
  // user to re-anchor onto the meal it is already anchored to. The card says
  // nothing and just counts down.
  if (isPostMealOwnMeal(candidate.loggedAtMs, input.startedAt)) {
    return { logMeal: false, restart: false, restartMealId: null };
  }
  // A genuinely later meal: the user ate again mid-window, and the countdown
  // can be moved onto it.
  return { logMeal: false, restart: true, restartMealId: candidate.id };
}
