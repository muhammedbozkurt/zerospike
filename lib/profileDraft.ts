/**
 * Cancelling a brand-new profile, decided in one place and kept pure so
 * scripts/profileDraft.test.ts can exercise every ordering under plain Node -
 * the same reason lib/alarmSelect.ts and lib/postMealTimer.ts are pure.
 *
 * The screen this backs (app/profile-setup.tsx) is opened by the profile
 * switcher AFTER the new row is created and made active: everything it edits
 * (targets, the basal row, the ready-made measurement layout) is profile-scoped
 * and needs the new profile to already be the current one. That is what makes
 * "the user closed it without saving" a decision rather than a no-op, and what
 * makes the timing of that decision the whole problem: it can arrive from the
 * X, from an unmount, or from a swipe-dismiss, at any point - including while
 * a save or a plan setup is still writing rows.
 */

/** What the screen should do with the draft profile right now. */
export type DraftDecision =
  /** Not a draft at all (the screen was opened for an existing profile), or
   *  the question has already been answered once. Nothing to do. */
  | "none"
  /** Delete the draft row and go back to the profile that was active before.
   *  Cancelling a creation means what it says. */
  | "discard"
  /** Keep the draft: it is either saved, or it holds rows the user genuinely
   *  set up (the measurement layout), which throwing away would be the same
   *  silent loss in the other direction. */
  | "keep"
  /** A write is in flight. Decide NOTHING now - deleting a profile out from
   *  under an in-progress save or plan setup is exactly how rows end up
   *  half-written, or written against whichever profile became active in the
   *  meantime. The caller re-asks when the write finishes, by which point
   *  `saved` / `planInstalled` answer it properly. */
  | "defer";

export interface DraftDiscardInput {
  /** The screen was opened straight after "Create" (params.created === "1"). */
  isDraft: boolean;
  /** The targets form was saved: the profile is the user's own from then on. */
  saved: boolean;
  /** "Set up this plan" wrote at least one row for this profile. */
  planInstalled: boolean;
  /** This decision has already been acted on once. */
  alreadyDiscarded: boolean;
  /** A save or a plan setup is running right now. */
  inFlight: boolean;
}

/**
 * Order matters and is deliberate: `alreadyDiscarded` first (a second dismiss
 * must never delete twice), then the two "the user configured something" facts,
 * and only then the in-flight check. A save that has already completed answers
 * the question on its own, so it must not be deferred behind a write that is
 * still winding down.
 */
export function decideDraftDiscard(input: DraftDiscardInput): DraftDecision {
  if (!input.isDraft) return "none";
  if (input.alreadyDiscarded) return "none";
  if (input.saved || input.planInstalled) return "keep";
  if (input.inFlight) return "defer";
  return "discard";
}

/**
 * Which profile to return to when a draft is discarded.
 *
 * The id the switcher handed over is a HINT, not a guarantee: the profile it
 * names can have been deleted from Settings > Data (or by another surface)
 * while this screen was open, and switching to a row that no longer exists
 * leaves AppContext pointing at nothing. So it is only used once it is still
 * in the list; otherwise the first surviving profile that is not the draft
 * takes over, and null means there is nothing to fall back to at all (the
 * caller then leaves the active profile alone).
 */
export function resolveFallbackProfileId(
  previousId: string | null,
  profiles: readonly { id: string }[],
  draftId: string
): string | null {
  if (
    previousId != null &&
    previousId !== draftId &&
    profiles.some((p) => p.id === previousId)
  ) {
    return previousId;
  }
  return profiles.find((p) => p.id !== draftId)?.id ?? null;
}
