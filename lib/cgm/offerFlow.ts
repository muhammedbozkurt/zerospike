/**
 * The one-time "switch to CGM mode?" question. The decision of WHEN to ask is
 * shouldOfferCgmSwitch (lib/cgm/state.ts); this is what happens on the answer:
 * the answer is recorded (so it is never asked again) and the matching events
 * go out. Dependency-injected so scripts/cgmHomeOffer.test.ts runs it in Node.
 */
import { markCgmOfferShown, type CgmOfferAction } from "./state";

export interface OfferDeps {
  mark?: (profileId: string, action: CgmOfferAction) => Promise<void>;
  log?: (name: "cgm_mode_set" | "cgm_offer", params: Record<string, string>) => void;
}

/** Throws when the answer could not be stored, so the caller keeps the card up
 *  instead of reporting a switch that did not stick. */
export async function answerCgmOffer(
  profileId: string,
  action: CgmOfferAction,
  deps: OfferDeps = {}
): Promise<void> {
  const mark = deps.mark ?? markCgmOfferShown;
  await mark(profileId, action);
  const log = deps.log;
  if (!log) return;
  if (action === "accepted") log("cgm_mode_set", { mode: "cgm" });
  log("cgm_offer", { action });
}
