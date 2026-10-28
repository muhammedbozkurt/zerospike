/**
 * What a delete has to settle OUTSIDE the database.
 *
 * Deleting a journal entry is not only a row disappearing: a record can have
 * armed something that lives elsewhere - and that something has no foreign key
 * to fall over when the row goes. Device QA found the first case of it: logging
 * a meal starts the post-meal countdown (schedulePostMealReminder), the user
 * deleted the meal, and the dashboard went on counting down to a check on a
 * meal that no longer existed, offering to "log a meal" for it.
 *
 * The countdown's whole persisted state - two AsyncStorage timestamps, its
 * owner, the pending notification or AlarmKit alarm, the Live Activity - names
 * no meal at all (see lib/services/notifications.ts), so nothing about deleting
 * a meal row could have reached it. This module is the one place that closes
 * that gap, and every delete path goes through it:
 *
 *   - components/useJournalRows.tsx  the journal row swipe, its long-press
 *     menu, and the edit sheets' own delete (dashboard AND full journal)
 *   - app/calculator.tsx  the meal editor's own delete, and the "undo" on a
 *     meal that was just saved (which removes the very record that armed the
 *     countdown a moment earlier)
 *
 * The RULE lives in lib/postMealTimer.ts (decidePostMealAfterMealDelete), pure
 * and tested without a database; this half only reads the facts it needs and
 * performs what it decides. The pairing is deliberate and mirrors
 * lib/db/undo.ts: capture, act, and be able to put it back.
 *
 * Undo is symmetric by design. A delete that ends a countdown hands back the
 * window it ended, and undoAfterDelete re-arms that exact window - same anchor,
 * same span - so "Undo" restores the entry AND the countdown rather than half
 * of what the delete took. Anything that cannot be honoured (the window ran out
 * while the toast was up, a new countdown was armed in the meantime) is left
 * alone rather than forced.
 */
import { getDb } from "./db";
import { setTemplateUsage } from "./db/mealTemplates";
import { deletedMealsFromSnapshot, type DeletedMeal, type DeletionSnapshot } from "./db/undoSql";
import { templateUsageAfterDelete, type TemplateUsage } from "./mealTemplates";
import {
  decidePostMealAfterMealDelete,
  postMealWindowRestorable,
  type PostMealTimerWindow,
} from "./postMealTimer";
import {
  cancelPostMealTimer,
  getPostMealTimerState,
  restorePostMealWindow,
} from "./services/notifications";

/** Re-exported because it is the shape applyAfterDelete takes: a caller that
 *  deleted a meal WITHOUT building a snapshot first (app/calculator.tsx's
 *  save-undo) constructs it by hand. */
export type { DeletedMeal };

/**
 * How wide a slice of meal_logs is read back around the countdown's anchor.
 *
 * Only meals within POST_MEAL_OWN_MEAL_MS of the anchor can change the answer,
 * so this is a deliberately generous band around that: wide enough that no
 * relevant row can fall outside it (a timezone-shaped surprise in a stored
 * logged_at included), narrow enough that it stays a handful of rows rather
 * than the profile's whole history. The exact comparison is done in JS, on
 * parsed moments, not by the SQL bounds.
 */
const NEAR_ANCHOR_BAND_MS = 24 * 60 * 60 * 1000;

/**
 * What a delete took down besides its rows, so an undo can put it back.
 * Everything here is OPTIONAL by nature: the ordinary delete settles nothing
 * and hands back an empty aftermath.
 */
export interface DeletionAftermath {
  /** The post-meal countdown this delete ended, or null when none was ended.
   *  Carries the window itself (anchor, end, owner) because that is all it
   *  takes to arm the same countdown again. */
  postMealTimer: PostMealTimerWindow | null;
  /** Template usage counters as they stood BEFORE this delete adjusted them,
   *  one entry per template involved. Stored as the prior ABSOLUTE pair rather
   *  than as a delta for the same reason the one-tap save undos do it that way
   *  (see setTemplateUsage): touchTemplate only ever moves last_used_at
   *  forward, so nothing can compute its way back to it. */
  templateUsage: PriorTemplateUsage[];
}

/** One template's counters as they were before a delete touched them. */
export interface PriorTemplateUsage extends TemplateUsage {
  id: string;
}

/** The "nothing to settle" answer. A fresh object each time: callers push
 *  nothing into it, but a shared frozen-by-convention constant with an array
 *  in it is an accident waiting to happen. */
function noAftermath(): DeletionAftermath {
  return { postMealTimer: null, templateUsage: [] };
}

/** True when a delete settled nothing at all, so an undo has nothing to put
 *  back. */
export function isEmptyAftermath(a: DeletionAftermath | null | undefined): boolean {
  return a == null || (a.postMealTimer == null && a.templateUsage.length === 0);
}

/** The meals still recorded near a countdown's anchor, as epoch ms. Read AFTER
 *  the delete, so the removed row is already gone from the answer. */
export async function mealsNearAnchor(
  profileId: string | null,
  anchorMs: number
): Promise<number[]> {
  const db = await getDb();
  const from = new Date(anchorMs - NEAR_ANCHOR_BAND_MS).toISOString();
  const to = new Date(anchorMs + NEAR_ANCHOR_BAND_MS).toISOString();
  const rows = profileId
    ? await db.getAllAsync<{ logged_at: string }>(
        "SELECT logged_at FROM meal_logs WHERE profile_id = ? AND logged_at >= ? AND logged_at <= ?;",
        [profileId, from, to]
      )
    : await db.getAllAsync<{ logged_at: string }>(
        "SELECT logged_at FROM meal_logs WHERE logged_at >= ? AND logged_at <= ?;",
        [from, to]
      );
  const out: number[] = [];
  for (const row of rows) {
    const ms = Date.parse(row.logged_at);
    if (Number.isFinite(ms)) out.push(ms);
  }
  return out;
}

/**
 * Settles everything the delete of these meals leaves behind, and reports what
 * it settled so undoAfterDelete can reverse it.
 *
 * MUST be called AFTER the rows are actually deleted: the decision reads which
 * meals are still recorded, and a row that is still in the table would count
 * itself as its own survivor.
 *
 * `meals` is empty for every non-meal delete (a reading, an injection, a
 * medication), which is the fast path out - none of those arms a countdown
 * (see schedulePostMealReminder's own note on why a reading deliberately does
 * not). Best-effort throughout: a delete that already succeeded must never fail
 * because a countdown could not be tidied up.
 */
export async function applyAfterDelete(
  meals: readonly DeletedMeal[],
  opts?: {
    /** Correct the usage counters of the templates these meals were logged
     *  from. Default true.
     *
     *  The one-tap save undos (app/(tabs)/food.tsx, app/meal-template.tsx)
     *  pass false: they captured the template's exact pre-save pair before
     *  writing the meal and restore it verbatim themselves the moment after
     *  this call, so correcting the counters here would be a database write
     *  whose entire effect is overwritten microseconds later. They keep their
     *  own restore rather than this recomputation because a captured prior is
     *  the more faithful answer for "undo the save I just made": it puts back
     *  whatever was there, including a last_used_at that never came from a
     *  meal_logs row at all. */
    settleTemplates?: boolean;
    /** Let the delete end the countdown whose own meal it removed. Default true.
     *
     *  The "undo" of a just-saved meal passes false unless that very save
     *  STARTED the countdown (schedulePostMealReminder answered "started"):
     *  with a countdown the user armed by hand, or one already running, the
     *  save did not create it, so taking the record back must not end it. */
    settleTimer?: boolean;
  }
): Promise<DeletionAftermath> {
  if (meals.length === 0) return noAftermath();
  const aftermath = noAftermath();
  if (opts?.settleTimer !== false) {
    aftermath.postMealTimer = await endPostMealTimerIfOrphaned(meals);
  }
  if (opts?.settleTemplates !== false) {
    aftermath.templateUsage = await settleTemplateUsage(meals);
  }
  return aftermath;
}

/** The countdown half: ends a running countdown whose own meal these deletes
 *  removed, and reports the window it ended. */
async function endPostMealTimerIfOrphaned(
  meals: readonly DeletedMeal[]
): Promise<PostMealTimerWindow | null> {
  try {
    // Each profile has its own countdown: the one the deleted meals belong to
    // is the only one a delete can end.
    const timer = await getPostMealTimerState(
      meals.find((m) => m.profileId != null)?.profileId ?? undefined
    );
    if (timer == null) return null;
    const mine = meals.filter(
      (m) => timer.profileId == null || m.profileId == null || m.profileId === timer.profileId
    );
    if (mine.length === 0) return null;
    const profileId = timer.profileId ?? mine[0].profileId ?? null;
    const decision = decidePostMealAfterMealDelete({
      startedAt: timer.startedAt,
      deletedMealsMs: mine.map((m) => m.loggedAtMs),
      remainingMealsMs: await mealsNearAnchor(profileId, timer.startedAt),
    });
    if (decision === "keep") return null;
    // Takes down BOTH deliveries and the Live Activity as well as the stored
    // window, which is exactly why this is cancelPostMealTimer and not
    // completePostMealTimer: the window did not reach its end, it lost its
    // subject, so nothing may be left to ring.
    await cancelPostMealTimer(timer.profileId);
    return timer;
  } catch {
    // The countdown keeps running; the rows are still deleted. Nothing here is
    // worth turning a completed delete into a failure.
    return null;
  }
}

/**
 * The template half: a meal logged from a template bumped that template's
 * counters when it was written (touchTemplate), so removing the meal has to
 * take the bump back.
 *
 * A template that no longer EXISTS is passed over in silence, which is not a
 * defensive nicety but the documented shape of this link:
 * meal_logs.meal_template_id carries no foreign key on purpose (lib/db/v13Sql.ts)
 * - it is provenance, and the recipe it names may well have been deleted since.
 */
async function settleTemplateUsage(
  meals: readonly DeletedMeal[]
): Promise<PriorTemplateUsage[]> {
  const deletedPerTemplate = new Map<string, number>();
  for (const meal of meals) {
    if (meal.templateId == null) continue;
    deletedPerTemplate.set(meal.templateId, (deletedPerTemplate.get(meal.templateId) ?? 0) + 1);
  }
  if (deletedPerTemplate.size === 0) return [];
  const prior: PriorTemplateUsage[] = [];
  try {
    const db = await getDb();
    for (const [id, deletedCount] of deletedPerTemplate) {
      const row = await db.getFirstAsync<{ use_count: number; last_used_at: string | null }>(
        "SELECT use_count, last_used_at FROM meal_templates WHERE id = ?;",
        [id]
      );
      // The recipe was deleted at some point after these meals were logged.
      // There are no counters to correct, and that is not an error.
      if (row == null) continue;
      const remaining = await db.getAllAsync<{ logged_at: string }>(
        "SELECT logged_at FROM meal_logs WHERE meal_template_id = ?;",
        [id]
      );
      const next = templateUsageAfterDelete({
        useCount: row.use_count,
        deletedCount,
        remainingLoggedAt: remaining.map((r) => r.logged_at),
      });
      prior.push({ id, useCount: row.use_count, lastUsedAt: row.last_used_at });
      await setTemplateUsage(id, next.useCount, next.lastUsedAt);
    }
  } catch {
    // Counters are a statistic, never a record: a delete that already happened
    // must not fail over them. Whatever was adjusted before the throw is still
    // reported, so an undo can put that much back.
  }
  return prior;
}

/** Convenience wrapper for the two callers that already hold the deletion
 *  snapshot: same call, with the meal rows read off it. */
export async function applyAfterDeleteFromSnapshot(
  snap: DeletionSnapshot
): Promise<DeletionAftermath> {
  return applyAfterDelete(deletedMealsFromSnapshot(snap));
}

/**
 * Puts back what applyAfterDelete took down, for an undo of that same delete.
 *
 * The countdown is re-armed at its ORIGINAL anchor with its ORIGINAL span
 * (restartPostMealTimerAt with both), not restarted from now: an undo has to
 * land the check where it would have been, not two fresh hours later.
 *
 * Two things are deliberately not forced. A countdown armed while the undo
 * toast was up is left alone - it is newer and the user's own, and clobbering
 * it would trade one wrong countdown for another. And a window that ran out in
 * the meantime simply does not come back: restartPostMealTimerAt reports
 * "elapsed" and arms nothing, which is the truth.
 */
export async function undoAfterDelete(
  aftermath: DeletionAftermath | null | undefined
): Promise<void> {
  if (aftermath == null) return;
  // Counters first, and unconditionally: they are absolute prior values, so
  // putting them back is idempotent and cannot be spoiled by whatever the
  // countdown half decides.
  for (const usage of aftermath.templateUsage) {
    try {
      await setTemplateUsage(usage.id, usage.useCount, usage.lastUsedAt);
    } catch {
      // best-effort; the meal itself is already back
    }
  }
  const window = aftermath.postMealTimer;
  if (window == null) return;
  try {
    // PURE, and before any await that could let the world move: a window with
    // nothing left in it is not put back, and - the point of doing it here -
    // nothing further is called for it at all. This is what keeps an undo away
    // from restartPostMealTimerAt, whose "elapsed" branch cancels
    // unconditionally and would take down a countdown armed in the meantime.
    if (!postMealWindowRestorable(window, Date.now())) return;
    // restorePostMealWindow has no cancel on any path and re-checks for a
    // newer countdown as the last read before it writes.
    await restorePostMealWindow(window);
  } catch {
    // best-effort: the entry itself is already back either way
  }
}
