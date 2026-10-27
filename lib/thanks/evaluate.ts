import {
  detectThanks,
  parseThanksState,
  pendingFresh,
  renewalGapElapsed,
  serializeThanksState,
  type ThanksEntitlement,
  type ThanksOutcome,
  type ThanksState,
} from "./detect";

export interface ThanksDeps {
  /** The entitlement from the SDK cache; null when the store cannot be read. */
  readEntitlement: () => Promise<ThanksEntitlement | null>;
  readRaw: () => Promise<string | null>;
  writeRaw: (raw: string) => Promise<void>;
  now: () => number;
}

export type ThanksKind = "converted" | "renewed";

// Two evaluations (launch and a quick foreground) must not both read the same
// snapshot and both decide a moment.
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run.catch(() => fallback);
}

/**
 * One observation. Updates the snapshot, records a newly decided moment as
 * PENDING (never as seen), drops pending moments that went stale, and returns
 * the moment that is waiting to be shown, if any. The seen stamps are written
 * only by confirmThanksShown, once the sheet or toast really is on screen, so a
 * moment that could not be presented survives a restart. Any read or write
 * failure returns "none".
 */
export function evaluateThanks(deps: ThanksDeps): Promise<ThanksOutcome> {
  return serial(() => evaluateNow(deps), "none" as ThanksOutcome);
}

async function evaluateNow(deps: ThanksDeps): Promise<ThanksOutcome> {
  const state = parseThanksState(await deps.readRaw());
  const current = await deps.readEntitlement();
  const now = deps.now();

  let next: ThanksState = state;
  if (current) {
    const { outcome, next: snapshot } = detectThanks({ prev: state.snapshot, current, now, shown: state });
    next = { ...state, snapshot };
    if (outcome === "converted" && !pendingFresh(next.pendingConvertedAt, now)) {
      next = { ...next, pendingConvertedAt: now };
    }
    if (outcome === "renewed" && !pendingFresh(next.pendingRenewalAt, now)) {
      next = { ...next, pendingRenewalAt: now };
    }
    // Nobody to thank: Pro is gone, or it is a Family Sharing entitlement.
    if (!current.active || current.familyShared) {
      next = { ...next, pendingConvertedAt: null, pendingRenewalAt: null };
    }
  }
  // Housekeeping that needs no store answer: stale, already-shown or too-soon moments go.
  next = {
    ...next,
    pendingConvertedAt:
      next.convertedSeenAt === null && pendingFresh(next.pendingConvertedAt, now) ? next.pendingConvertedAt : null,
    pendingRenewalAt:
      renewalGapElapsed(next.renewalToastAt, now) && pendingFresh(next.pendingRenewalAt, now)
        ? next.pendingRenewalAt
        : null,
  };

  const raw = serializeThanksState(next);
  if (current || raw !== serializeThanksState(state)) await deps.writeRaw(raw);

  if (next.pendingConvertedAt !== null) return "converted";
  if (next.pendingRenewalAt !== null) return "renewed";
  return "none";
}

/**
 * The moment is on screen: stamp it as seen and clear its pending mark. Called
 * from the sheet's onShown (or the toast call), never before. False when the
 * write failed (the moment then stays pending and may show again).
 */
export function confirmThanksShown(deps: ThanksDeps, kind: ThanksKind): Promise<boolean> {
  return serial(async () => {
    const state = parseThanksState(await deps.readRaw());
    const now = deps.now();
    const next: ThanksState =
      kind === "converted"
        ? { ...state, convertedSeenAt: now, pendingConvertedAt: null }
        : { ...state, renewalToastAt: now, pendingRenewalAt: null };
    await deps.writeRaw(serializeThanksState(next));
    return true;
  }, false);
}
