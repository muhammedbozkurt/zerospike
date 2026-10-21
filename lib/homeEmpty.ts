/**
 * Pure decisions behind the home screen's empty state and the ring's meaning.
 * Kept out of app/(tabs)/index.tsx so they are testable without a renderer.
 */

export interface HomeCounts {
  /** The first feed read has landed (before it, an empty feed means nothing). */
  loaded: boolean;
  /** Every kind of record the profile has: glucose, meals, injections, meds. */
  entries: number;
}

export type BosDurum = "loading" | "welcome" | "normal";

/**
 * "welcome": nothing logged at all, so the compact welcome card replaces the
 * big empty ring. "loading": the feed has not been read yet, show skeletons.
 * "normal": at least one record exists and the usual layout (ring, week, flow)
 * takes over.
 */
export function bosDurumKarari(counts: HomeCounts): BosDurum {
  if (!counts.loaded) return "loading";
  return counts.entries > 0 ? "normal" : "welcome";
}

/**
 * The tablet two-column home is for an existing user only; the welcome state
 * (and the skeleton before it resolves) keeps the single centred column on
 * every screen size.
 */
export function usesTwoColumn(durum: BosDurum, wide: boolean): boolean {
  return wide && durum !== "welcome";
}

/**
 * Estimated block heights (pt, default text size) of the welcome state's first
 * screen, from the paddings and row heights in components/WelcomeCard.tsx.
 * Estimates only: a larger OS text size simply scrolls.
 */
export const WELCOME_HEIGHTS = {
  /** Title row ("Today" + header icons) with its bottom margin. */
  titleRow: 60,
  /** Welcome card: padding 32 + illustration/text row 66 + gap 12 + CTA 52, + 12 margin. */
  welcomeCard: 174,
  /** Steps card: padding 32 + 3 rows x 44 + 2 gaps x 4, + 12 margin. */
  stepsCard: 184,
  /** Preview row, full: header 26 + box (padding 24 + ring row 52 + boxes 28 + flow 32 + gaps 24) + 12 margin. */
  previewFull: 198,
  /** Preview row, compact: header 26 + box (padding 24 + ring row 52) + 12 margin. */
  previewCompact: 114,
  /** Bottom tab bar above the home indicator inset. */
  tabBar: 49,
} as const;

export type WelcomePreviewMode = "full" | "compact" | "hidden";

export interface WelcomeFitInput {
  screenHeight: number;
  topInset: number;
  bottomInset: number;
}

/** Height left under the cards on the first screen (can be negative). */
export function welcomeRoomForPreview(i: WelcomeFitInput): number {
  const visible = i.screenHeight - i.topInset - i.bottomInset - WELCOME_HEIGHTS.tabBar;
  return visible - WELCOME_HEIGHTS.titleRow - WELCOME_HEIGHTS.welcomeCard - WELCOME_HEIGHTS.stepsCard;
}

/**
 * The faded preview row is the first thing to give way: full when it fits on
 * the first screen, a shorter outline when only that fits, hidden when even
 * that would push below the fold (the cards above stay; scrolling is fine).
 */
export function welcomePreviewMode(i: WelcomeFitInput): WelcomePreviewMode {
  const room = welcomeRoomForPreview(i);
  if (room >= WELCOME_HEIGHTS.previewFull) return "full";
  if (room >= WELCOME_HEIGHTS.previewCompact) return "compact";
  return "hidden";
}

/**
 * The ring's fill: the share of today's readings inside the target band, as a
 * 0..100 integer. null when there is no reading today (the ring stays empty
 * and the explanation line is not drawn).
 */
export function todayRangeShare(readings: number, inRange: number): number | null {
  if (!Number.isFinite(readings) || readings <= 0) return null;
  const safe = Math.min(Math.max(inRange, 0), readings);
  return Math.round((safe / readings) * 100);
}
