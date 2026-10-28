import { mealsNearAnchor } from "./afterDelete";
import { decidePostMealAfterMealTimeEdit } from "./postMealTimer";
import { getPostMealTimerState, restartPostMealTimerAt } from "./services/notifications";

/**
 * A meal's time was edited: a countdown that is this meal's own follows it
 * (see decidePostMealAfterMealTimeEdit). Call AFTER the row is updated, with
 * the time it had before and the time it has now. Best-effort: an edit that
 * already succeeded never fails over a countdown.
 */
export async function settlePostMealTimerAfterMealTimeEdit(input: {
  profileId: string;
  oldLoggedAtMs: number;
  newLoggedAtMs: number;
}): Promise<"keep" | "retimed" | "elapsed" | "idle"> {
  try {
    if (input.oldLoggedAtMs === input.newLoggedAtMs) return "keep";
    const timer = await getPostMealTimerState(input.profileId);
    if (timer == null) return "keep";
    const decision = decidePostMealAfterMealTimeEdit({
      startedAt: timer.startedAt,
      oldMealMs: input.oldLoggedAtMs,
      newMealMs: input.newLoggedAtMs,
      otherMealsMs: await mealsNearAnchor(input.profileId, timer.startedAt),
    });
    if (decision.kind === "keep") return "keep";
    return await restartPostMealTimerAt(decision.anchorMs, input.profileId);
  } catch {
    return "keep";
  }
}
