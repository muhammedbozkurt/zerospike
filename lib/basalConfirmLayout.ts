/**
 * app/basal-confirm.tsx is one route with two shapes: a short bottom card for
 * the yes/no and error-ish steps, and the full screen for the steps that edit
 * (time, dose, site) or draw the body map. Pure so a plain tsx test can pin it.
 */

export type BasalLoadKind = "loading" | "error" | "chooseProfile" | "duplicate" | "ready";
export type BasalStep = "ask" | "site";
export type BasalPresentation = "card" | "full";

export function basalPresentation(input: {
  loadKind: BasalLoadKind;
  step: BasalStep;
  picking: boolean;
}): BasalPresentation {
  if (input.picking) return "full";
  if (input.loadKind === "ready") return input.step === "site" ? "full" : "card";
  // A quick action that opens straight on "site" shows the form skeleton
  // full-screen while it loads, so the screen does not jump card -> full.
  if (input.loadKind === "loading") return input.step === "site" ? "full" : "card";
  return "card";
}
