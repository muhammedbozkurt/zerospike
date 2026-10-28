/**
 * The root route gate's onboarding rule, kept pure so it is tested apart from
 * the layout. A person who has not finished onboarding is sent to /onboarding
 * from every route except the quiz itself and the sale screens it can reach: a
 * paid Pro from inside the quiz (Nightscout needs Pro) replaces the paywall with
 * the Pro welcome, and a redirect there would swap the welcome for a second
 * onboarding screen. The welcome closes with a back, which returns to the
 * quiz exactly where it was left.
 */
export const ONBOARDING_SALE_ROUTES = ["paywall", "downsell", "winback", "pro-welcome"] as const;

export function isOnboardingSaleRoute(root: string | undefined): boolean {
  return (ONBOARDING_SALE_ROUTES as readonly string[]).includes(root ?? "");
}

export function needsOnboardingRedirect(i: {
  ready: boolean;
  onboarded: boolean;
  root: string | undefined;
}): boolean {
  return i.ready && !i.onboarded && i.root !== "onboarding" && !isOnboardingSaleRoute(i.root);
}

/** The app home (the tab stack): the only place a sale or welcome opens on its own. */
export function isHomeRoute(root: string | undefined): boolean {
  return root === "(tabs)";
}
