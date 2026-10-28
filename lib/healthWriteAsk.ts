/**
 * The one-time "also save manual readings to Health?" question, kept free of
 * React so its bookkeeping is testable. The "asked" flag is written only once
 * the user has ANSWERED (Yes, Later or a dismissal). A dialog that was torn
 * down without an answer (its host unmounted, another dialog replaced it) is
 * not an answer, so the question stays available for the next reading.
 */
export type HealthAskOutcome = "yes" | "later" | "abandoned";

export async function runHealthWriteAsk(deps: {
  /** Shows the dialog; `onAbandon` must be wired to ConfirmOptions.onAbandon. */
  show: (onAbandon: () => void) => Promise<boolean>;
  markAsked: () => Promise<void>;
}): Promise<HealthAskOutcome> {
  let abandoned = false;
  const yes = await deps.show(() => {
    abandoned = true;
  });
  if (abandoned) return "abandoned";
  await deps.markAsked();
  return yes ? "yes" : "later";
}
