/**
 * Static insulin-injection technique guide.
 *
 * GENERAL EDUCATION ONLY. This content contains no doses, products, brands or
 * personal instructions; every step defers to the user's healthcare provider.
 * Mirrors the Sources screen pattern (a const array + i18n keys rendered in a
 * modal). Any screen showing these steps MUST display `injectionGuide.disclaimer`
 * at the top.
 *
 * Each step's text lives in i18n under `injectionGuide.steps.<key>.title` and
 * `.body`. `icon` is an Ionicons name (typed as string, matching the codebase
 * convention in lib/db/categories.ts).
 */
export interface InjectionStep {
  icon: string; // Ionicons name
  titleKey: string;
  bodyKey: string;
}

export const INJECTION_STEPS: InjectionStep[] = [
  {
    icon: "water-outline",
    titleKey: "injectionGuide.steps.wash_hands.title",
    bodyKey: "injectionGuide.steps.wash_hands.body",
  },
  {
    icon: "body-outline",
    titleKey: "injectionGuide.steps.choose_site.title",
    bodyKey: "injectionGuide.steps.choose_site.body",
  },
  {
    icon: "build-outline",
    titleKey: "injectionGuide.steps.prepare_pen.title",
    bodyKey: "injectionGuide.steps.prepare_pen.body",
  },
  {
    icon: "hand-left-outline",
    titleKey: "injectionGuide.steps.pinch_skin.title",
    bodyKey: "injectionGuide.steps.pinch_skin.body",
  },
  {
    icon: "arrow-down-outline",
    titleKey: "injectionGuide.steps.insert_needle.title",
    bodyKey: "injectionGuide.steps.insert_needle.body",
  },
  {
    icon: "medical-outline",
    titleKey: "injectionGuide.steps.inject.title",
    bodyKey: "injectionGuide.steps.inject.body",
  },
  {
    icon: "time-outline",
    titleKey: "injectionGuide.steps.wait.title",
    bodyKey: "injectionGuide.steps.wait.body",
  },
  {
    icon: "trash-outline",
    titleKey: "injectionGuide.steps.dispose.title",
    bodyKey: "injectionGuide.steps.dispose.body",
  },
];

/** i18n keys for the guide screen chrome (title + mandatory disclaimer). */
export const INJECTION_GUIDE_TITLE_KEY = "injectionGuide.screenTitle";
export const INJECTION_GUIDE_DISCLAIMER_KEY = "injectionGuide.disclaimer";
