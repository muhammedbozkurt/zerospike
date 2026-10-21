/**
 * Pure first-screen arithmetic of the paywall (build 93 redesign), so "three
 * plans and the pinned CTA are visible without scrolling at 375x812" is a
 * checked property and not a hope. The screen (app/paywall.tsx) uses the same
 * constants for its paddings and font sizes; the line counts of translated text
 * come in as inputs because only the device knows how a language wraps, and the
 * test feeds the worst case (German, two-line headline).
 *
 * Order on screen, top to bottom: header, headline, short promise, three plan
 * cards (annual selected), [pinned CTA band outside the scroll], trial timeline,
 * sample preview (small), two-column benefit chips, legal text and links.
 */

export const PAYWALL_LAYOUT = {
  headerHeight: 46,
  scrollTop: 8,
  titleLineHeight: 28,
  promiseLineHeight: 18,
  gapAfterHero: 12,
  planPadV: 12,
  planNameRow: 20,
  planSmallLine: 15,
  /** Price column: 20pt price + 11pt period line. */
  planPriceColumn: 39,
  planGap: 8,
  bandPadTop: 12,
  bandPadBottom: 12,
  /** GradientCTA: 13pt padding top and bottom around the label lines. */
  ctaPadVertical: 26,
  ctaLineHeight: 18,
  /** The one pinned disclosure line under a trial CTA. */
  bandDisclosureMargin: 8,
  bandDisclosureLine: 16,
  previewHeight: 112,
  /** Below this window height the sample preview is not drawn at all. */
  previewMinWindowHeight: 700,
  chipLineHeight: 16,
  chipPadV: 6,
  chipRowGap: 8,
} as const;

export interface PaywallLayoutInput {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
  /** Text-size multiplier of the device (1 = default). */
  fontScale?: number;
  headlineLines: number;
  /** 0 when the short promise is not shown. */
  promiseLines: number;
  annualDescLines: number;
  annualFootLines: number;
  lifetimeFootLines: number;
  /** Label lines of the pinned CTA: 1, or 2 when a priced label wraps. */
  ctaLines?: number;
  /** Lines of the pinned disclosure under the CTA (0 = none, i.e. not a trial). */
  disclosureLines: number;
  chipCount: number;
  chipLines: number;
}

export interface PaywallLayout {
  bandHeight: number;
  /** Window y where the scroll area ends (top of the pinned band). */
  viewportBottom: number;
  plansTop: number;
  plansBottom: number;
  /** All three plan cards end above the pinned band. */
  plansAndCtaFit: boolean;
  previewVisible: boolean;
  /** Content y of the preview, always at or below plansBottom. */
  previewTop: number;
  chipsHeight: number;
}

const L = PAYWALL_LAYOUT;

/** The sample preview is dropped on a short window so plans and CTA keep room. */
export function paywallPreviewVisible(windowHeight: number): boolean {
  return windowHeight >= PAYWALL_LAYOUT.previewMinWindowHeight;
}

export function planCardHeights(i: Pick<PaywallLayoutInput, "annualDescLines" | "annualFootLines" | "lifetimeFootLines" | "fontScale">): {
  monthly: number;
  annual: number;
  lifetime: number;
} {
  const k = i.fontScale ?? 1;
  const card = (left: number) => Math.ceil(Math.max(left, L.planPriceColumn) * k) + L.planPadV * 2;
  return {
    monthly: card(L.planNameRow),
    annual: card(L.planNameRow + (i.annualDescLines + i.annualFootLines) * L.planSmallLine),
    lifetime: card(L.planNameRow + i.lifetimeFootLines * L.planSmallLine),
  };
}

export function computePaywallLayout(i: PaywallLayoutInput): PaywallLayout {
  const k = i.fontScale ?? 1;
  const header = L.headerHeight;
  const ctaHeight = L.ctaPadVertical + Math.ceil((i.ctaLines ?? 1) * L.ctaLineHeight * k);
  const disclosure =
    i.disclosureLines > 0
      ? L.bandDisclosureMargin + Math.ceil(i.disclosureLines * L.bandDisclosureLine * k)
      : 0;
  const bandHeight =
    L.bandPadTop + ctaHeight + disclosure + L.bandPadBottom + i.insetBottom;
  const viewportBottom = i.height - bandHeight;

  const hero =
    Math.ceil(i.headlineLines * L.titleLineHeight * k) +
    (i.promiseLines > 0 ? 6 + Math.ceil(i.promiseLines * L.promiseLineHeight * k) : 0);
  const plansTop = i.insetTop + header + L.scrollTop + hero + L.gapAfterHero;
  const h = planCardHeights(i);
  const plansBottom = plansTop + h.monthly + h.annual + h.lifetime + 3 * L.planGap;

  const previewVisible = paywallPreviewVisible(i.height);
  const previewTop = plansBottom + 12;
  const rows = Math.ceil(i.chipCount / 2);
  const chipsHeight =
    rows === 0
      ? 0
      : rows * (Math.ceil(i.chipLines * L.chipLineHeight * k) + L.chipPadV * 2) +
        (rows - 1) * L.chipRowGap;
  return {
    bandHeight,
    viewportBottom,
    plansTop,
    plansBottom,
    plansAndCtaFit: plansBottom <= viewportBottom,
    previewVisible,
    previewTop,
    chipsHeight,
  };
}
