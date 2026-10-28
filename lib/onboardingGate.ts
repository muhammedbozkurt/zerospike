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

/**
 * Where the Pro welcome's exit and step buttons go. A person who bought Pro from
 * inside the quiz (Nightscout needs it) has not finished onboarding: leaving
 * the welcome for the tab stack would only be thrown back to the first quiz
 * step by the route gate, so it returns to /onboarding, which is still in the
 * stack at the step it was left on. Use it for the close button's fallback and
 * for every dismissTo/replace the welcome's step buttons make:
 *
 *   router.canGoBack() ? router.back() : router.replace(welcomeExitTarget(done))
 *   router.dismissTo({ pathname: welcomeExitTarget(done), ... })
 */
export function welcomeExitTarget(onboardingDone: boolean): "/(tabs)" | "/onboarding" {
  return onboardingDone ? "/(tabs)" : "/onboarding";
}

export type OnboardingBackAction = "ignore" | "swallow" | "toWelcome" | "previousStep";

/**
 * What the Android hardware back does inside onboarding. Only the focused
 * onboarding handles it: with the Pro welcome or the paywall on top, the press
 * belongs to that screen. The reveal swallows it so a press cannot leave
 * onboarding unfinished; the welcome phase keeps the system default.
 */
export function onboardingBackAction(i: {
  focused: boolean;
  phase: string;
  stepIdx: number;
}): OnboardingBackAction {
  if (!i.focused) return "ignore";
  if (i.phase === "reveal") return "swallow";
  if (i.phase !== "quiz") return "ignore";
  return i.stepIdx === 0 ? "toWelcome" : "previousStep";
}
