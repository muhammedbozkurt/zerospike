import {
  detectThanks,
  parseThanksState,
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

// Two evaluations (launch and a quick foreground) must not both read the same
// snapshot and both decide to show.
let chain: Promise<unknown> = Promise.resolve();

/**
 * One observation: reads the entitlement, decides, and PERSISTS the decision
 * (snapshot plus the convertedSeenAt / renewalToastAt stamp) before returning
 * it. A moment is only ever returned after its stamp is on disk, so a crash
 * while it is on screen cannot bring it back. Any read or write failure returns
 * "none".
 */
export function evaluateThanks(deps: ThanksDeps): Promise<ThanksOutcome> {
  const run = chain.then(() => evaluateNow(deps));
  chain = run.catch(() => undefined);
  return run.catch(() => "none" as ThanksOutcome);
}

async function evaluateNow(deps: ThanksDeps): Promise<ThanksOutcome> {
  const current = await deps.readEntitlement();
  if (!current) return "none";
  const state = parseThanksState(await deps.readRaw());
  const now = deps.now();
  const { outcome, next } = detectThanks({
    prev: state.snapshot,
    current,
    now,
    shown: state,
  });
  const updated: ThanksState = {
    snapshot: next,
    convertedSeenAt: outcome === "converted" ? now : state.convertedSeenAt,
    renewalToastAt: outcome === "renewed" ? now : state.renewalToastAt,
  };
  await deps.writeRaw(serializeThanksState(updated));
  return outcome;
}
