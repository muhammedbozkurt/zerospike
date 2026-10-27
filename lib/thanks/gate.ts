import { isWhatsNewRoute } from "../whatsNew";

export interface ThanksGate {
  ready: boolean;
  onboarded: boolean;
  screenshotMode: boolean;
  /** Top route segment. */
  root: string | undefined;
  /** Another sheet or dialog Modal is on screen (lib/feedbackSurvey registerOverlay). */
  overlayOpen: boolean;
  /** The winback is deciding or showing. */
  winbackHold: boolean;
  /** The thank-you sheet itself is already up. */
  sheetVisible: boolean;
}

/**
 * Where a thank-you may appear: only on the tab screens of an onboarded user,
 * never over onboarding, the paywall, the winback or downsell, SOS, the
 * calculator or any other modal route, and never while a Modal is open.
 */
export function thanksMayPresent(g: ThanksGate): boolean {
  return (
    g.ready &&
    g.onboarded &&
    !g.screenshotMode &&
    !g.overlayOpen &&
    !g.winbackHold &&
    !g.sheetVisible &&
    isWhatsNewRoute(g.root)
  );
}
