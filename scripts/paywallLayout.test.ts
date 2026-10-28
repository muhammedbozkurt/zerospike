/**
 * Paywall first-screen arithmetic (lib/paywallLayout.ts), the CTA label rule and
 * the purchase button state machine (lib/paywallPurchase.ts), plus the wording
 * checks that stand in for a device: chip labels wrap inside their column and
 * the pinned CTA label fits one line, in all nine languages.
 *
 * Computed evidence, not a device measurement: real wrapping is only confirmed
 * on a phone.
 *
 * Run: npx tsx scripts/paywallLayout.test.ts
 */
import { PAYWALL_LAYOUT, computePaywallLayout, paywallPreviewVisible, type PaywallLayoutInput } from "../lib/paywallLayout";
import {
  paywallCtaKind,
  purchaseOutcomeEvent,
  purchaseOutcomePlan,
  purchaseUiAcceptsPress,
  purchaseUiBusy,
  purchaseUiReduce,
  shouldOpenWelcomeAfterPurchase,
  showTrialTimeline,
  type PurchaseUiEvent,
  type PurchaseUiState,
} from "../lib/paywallPurchase";
import { estimateTextWidth } from "../lib/fitText";
import ar from "../lib/i18n/locales/ar";
import de from "../lib/i18n/locales/de";
import en from "../lib/i18n/locales/en";
import es from "../lib/i18n/locales/es";
import fr from "../lib/i18n/locales/fr";
import it from "../lib/i18n/locales/it";
import ja from "../lib/i18n/locales/ja";
import pt from "../lib/i18n/locales/pt";
import tr from "../lib/i18n/locales/tr";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

/** Worst case wrapping the screen can produce: German-length headline and descriptions. */
function worst(over: Partial<PaywallLayoutInput>): PaywallLayoutInput {
  return {
    width: 375,
    height: 812,
    insetTop: 47,
    insetBottom: 34,
    fontScale: 1,
    headlineLines: 2,
    promiseLines: 2,
    annualDescLines: 2,
    annualFootLines: 1,
    lifetimeFootLines: 2,
    ctaLines: 2,
    disclosureLines: 3,
    chipCount: 6,
    chipLines: 2,
    ...over,
  };
}

console.log("zerospike paywall layout / purchase test");

section("A. 375x812: three plans and the pinned CTA are on the first screen");
{
  const l = computePaywallLayout(worst({}));
  ok("plans end above the pinned band", l.plansAndCtaFit, JSON.stringify(l));
  ok("with the trial disclosure line in the band (worst wrapping)", l.plansBottom <= l.viewportBottom);
  const noTrial = computePaywallLayout(worst({ disclosureLines: 0 }));
  ok("without a trial the band is shorter, still fits", noTrial.plansAndCtaFit && noTrial.bandHeight < l.bandHeight);
  ok("the sample preview is drawn", l.previewVisible);
  ok("and sits below the plans, not above", l.previewTop >= l.plansBottom);
}

section("B. 430x932 (large phone)");
{
  const l = computePaywallLayout(worst({ width: 430, height: 932, insetTop: 59, insetBottom: 34 }));
  ok("plans and CTA fit", l.plansAndCtaFit);
  ok("preview drawn, below the plans", l.previewVisible && l.previewTop >= l.plansBottom);
}

section("C. 375x667 (SE class): preview hidden, plans and CTA still on the first screen");
{
  const l = computePaywallLayout(worst({ height: 667, insetTop: 20, insetBottom: 0 }));
  ok("sample preview is hidden", !l.previewVisible);
  ok("three plans end above the pinned band", l.plansAndCtaFit, `plansBottom ${l.plansBottom} > viewportBottom ${l.viewportBottom}`);
  const noTrial = computePaywallLayout(worst({ height: 667, insetTop: 20, insetBottom: 0, disclosureLines: 0 }));
  ok("same without a trial", noTrial.plansAndCtaFit);
  eq("window height rule", [paywallPreviewVisible(667), paywallPreviewVisible(699), paywallPreviewVisible(700), paywallPreviewVisible(812)], [false, false, true, true]);
}

section("D. the layout is not trivially true: it fails when the content really overflows");
{
  const big = computePaywallLayout(worst({ height: 667, insetTop: 20, insetBottom: 0, fontScale: 1.6 }));
  ok("a 1.6x text scale on the SE overflows (the scroll then carries the plans)", !big.plansAndCtaFit);
  const tall = computePaywallLayout(worst({ headlineLines: 6, promiseLines: 6, height: 667, insetTop: 20, insetBottom: 0 }));
  ok("an absurd headline overflows", !tall.plansAndCtaFit);
  ok("constants are the ones the screen uses", PAYWALL_LAYOUT.planGap === 8 && PAYWALL_LAYOUT.ctaPadVertical === 26);
}

section("D2. a two-line CTA label (long priced text) still leaves three plans and the CTA on the first screen");
{
  const l2 = computePaywallLayout(worst({ ctaLines: 2 }));
  const l1 = computePaywallLayout(worst({ ctaLines: 1 }));
  ok("a second label line makes the band taller", l2.bandHeight > l1.bandHeight);
  ok("375x812 with a two-line CTA and the trial line", l2.plansAndCtaFit);
  const se = computePaywallLayout(worst({ height: 667, insetTop: 20, insetBottom: 0, ctaLines: 2 }));
  ok("375x667 with a two-line CTA and the trial line", se.plansAndCtaFit, `slack ${se.viewportBottom - se.plansBottom}`);
  const se115 = computePaywallLayout(worst({ height: 667, insetTop: 20, insetBottom: 0, ctaLines: 2, fontScale: 1.15 }));
  console.log(`  info: SE slack at text scale 1.0 ${se.viewportBottom - se.plansBottom}, at 1.15 ${se115.viewportBottom - se115.plansBottom}`);
  ok("375x667 at text scale 1.15 (plans may scroll, the CTA never leaves the band)", se115.bandHeight < 667 / 2);
}

section("E. CTA kind follows the selected plan");
{
  const k = (plan: "monthly" | "annual" | "lifetime", annualTrial: boolean, hasPrice = true, failed = false) =>
    paywallCtaKind({ plan, annualTrial, hasPrice, failed });
  eq("annual with trial", k("annual", true), "trial");
  eq("annual without trial", k("annual", false), "annual");
  eq("monthly (trial available on annual only)", k("monthly", true), "monthly");
  eq("lifetime", k("lifetime", true), "lifetime");
  eq("annual trial label does not need the price", k("annual", true, false), "trial");
  eq("monthly without a store price falls back to the plain label", k("monthly", true, false), "generic");
  eq("lifetime without a store price falls back", k("lifetime", false, false), "generic");
  eq("after a failed purchase: try again, whatever the plan", [k("monthly", true, true, true), k("annual", true, true, true), k("lifetime", false, true, true)], ["retry", "retry", "retry"]);
  eq("timeline: annual with trial only", [showTrialTimeline("annual", true), showTrialTimeline("annual", false), showTrialTimeline("monthly", true), showTrialTimeline("lifetime", true)], [true, false, false, false]);
}

section("F. purchase button state machine");
{
  const run = (start: PurchaseUiState, events: PurchaseUiEvent[]): PurchaseUiState =>
    events.reduce((s, e) => purchaseUiReduce(s, e), start);
  eq("press -> purchasing", run("idle", ["press"]), "purchasing");
  ok("purchasing is busy (button disabled, spinner)", purchaseUiBusy("purchasing"));
  ok("idle and failed accept a press", purchaseUiAcceptsPress("idle") && purchaseUiAcceptsPress("failed"));
  ok("purchasing, restoring and done refuse a press", !purchaseUiAcceptsPress("purchasing") && !purchaseUiAcceptsPress("restoring") && !purchaseUiAcceptsPress("done"));
  eq("double tap: the second press changes nothing", run("idle", ["press", "press"]), "purchasing");
  eq("cancelled -> back to idle, silently", run("idle", ["press", "cancelled"]), "idle");
  ok("idle after a cancel is not busy", !purchaseUiBusy("idle"));
  eq("store error -> failed", run("idle", ["press", "failed"]), "failed");
  ok("failed is not busy: the retry button is live", !purchaseUiBusy("failed"));
  eq("retry from failed -> purchasing again", run("idle", ["press", "failed", "press"]), "purchasing");
  eq("settled does not clear a failure (the retry label stays)", run("idle", ["press", "failed", "settled"]), "failed");
  eq("changing the plan clears the retry label", run("idle", ["press", "failed", "planChanged"]), "idle");
  eq("planChanged mid purchase does nothing", run("idle", ["press", "planChanged"]), "purchasing");
  eq("success -> done (stays busy while the welcome opens)", run("idle", ["press", "success"]), "done");
  ok("done is busy", purchaseUiBusy("done"));
  eq("done settles to idle", run("idle", ["press", "success", "settled"]), "idle");
  eq("a stray failed after success cannot undo it", run("idle", ["press", "success", "failed"]), "done");
  eq("restore only from idle or failed", [run("idle", ["restoreStart"]), run("failed", ["restoreStart"]), run("purchasing", ["restoreStart"]), run("done", ["restoreStart"])], ["restoring", "restoring", "purchasing", "done"]);
  eq("restore settles to idle", run("idle", ["restoreStart", "settled"]), "idle");
  eq("press while restoring is refused", run("idle", ["restoreStart", "press"]), "restoring");
  eq("a user close is blocked exactly while busy", ["idle", "purchasing", "restoring", "failed", "done"].map((s) => purchaseUiBusy(s as PurchaseUiState)), [false, true, true, false, true]);
}

section("G. outcomes: cancel is silent and runs the downsell gate, error toasts, success opens the welcome");
{
  eq("success", purchaseOutcomeEvent({ ok: true }), "success");
  eq("cancel", purchaseOutcomeEvent({ ok: false, cancelled: true }), "cancelled");
  eq("error", purchaseOutcomeEvent({ ok: false }), "failed");
  eq("success plan", purchaseOutcomePlan({ ok: true }), { toast: true, runDownsellGate: false, openWelcome: true, awaitApproval: false });
  eq("cancel plan: no message, gate runs, no welcome", purchaseOutcomePlan({ ok: false, cancelled: true }), { toast: false, runDownsellGate: true, openWelcome: false, awaitApproval: false });
  eq("error plan: message, no gate", purchaseOutcomePlan({ ok: false }), { toast: true, runDownsellGate: false, openWelcome: false, awaitApproval: false });
  ok("new purchase or trial always opens the welcome", shouldOpenWelcomeAfterPurchase({ recovered: false, stepsLeft: false }));
  ok("recovered purchase with nothing left does not", !shouldOpenWelcomeAfterPurchase({ recovered: true, stepsLeft: false }));
  ok("recovered purchase with a step left does", shouldOpenWelcomeAfterPurchase({ recovered: true, stepsLeft: true }));
}

type Pw = {
  ctaMonthly: string;
  ctaAnnual: string;
  ctaLifetime: string;
  ctaTrial: string;
  chipSpike: string;
  chipCgm: string;
  promise: string;
  featureShortHealth: string;
  featureShortFamily: string;
  featureShortPdf: string;
  benefitTrends: string;
};
const LOCALES: Record<string, { paywall: Pw }> = {
  en: en as never, tr: tr as never, de: de as never, fr: fr as never, es: es as never,
  it: it as never, pt: pt as never, ar: ar as never, ja: ja as never,
};

/** Real store strings (monthly, annual, lifetime) of the markets that matter, long ones included. */
const REAL_PRICES: Record<string, [string, string, string]> = {
  en: ["$4.99", "$59.99", "$149.99"],
  tr: ["₺149,99", "₺1.499,99", "₺3.999,99"],
  de: ["4,99 €", "59,99 €", "149,99 €"],
  fr: ["4,99 €", "59,99 €", "149,99 €"],
  es: ["4,99 US$", "59,99 US$", "149,99 US$"],
  it: ["4,99 €", "59,99 €", "149,99 €"],
  pt: ["R$ 29,90", "R$ 349,90", "R$ 899,90"],
  ar: ["US$ 4.99", "US$ 59.99", "US$ 149.99"],
  ja: ["¥980", "¥9,800", "¥24,800"],
};

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** Greedy word wrap with the shared glyph estimator; CJK breaks anywhere. */
function wrap(text: string, fontSize: number, width: number): { lines: number; widestWord: number } {
  const words = text.split(" ").filter(Boolean);
  let lines = 1;
  let line = 0;
  let widest = 0;
  for (const w of words) {
    const ww = estimateTextWidth(w, fontSize);
    widest = Math.max(widest, ww);
    const withSpace = line === 0 ? ww : line + estimateTextWidth(" ", fontSize) + ww;
    if (withSpace > width && line > 0) {
      lines++;
      line = ww;
    } else {
      line = withSpace;
    }
  }
  return { lines, widestWord: widest };
}

section("H. wording in all nine languages (the priced CTA wraps, it is never shrunk or clipped)");
{
  const CHIP_TEXT_WIDTH = (375 - 40) * 0.485 - 20 - 2 - 14 - 8;
  const CTA_WIDTH = 375 - 40 - 28;
  for (const [lang, loc] of Object.entries(LOCALES)) {
    const pw = loc.paywall;
    const health = lang === "de" ? "Apple Health" : "Apple Health";
    const chips = [
      fill(pw.featureShortHealth, { health }),
      pw.chipSpike,
      pw.chipCgm,
      pw.benefitTrends,
      pw.featureShortPdf,
      pw.featureShortFamily,
    ];
    for (const chip of chips) {
      const w = wrap(chip, 12, CHIP_TEXT_WIDTH);
      ok(`${lang} chip "${chip}" wraps in at most 3 lines`, w.lines <= 3, `${w.lines} lines`);
      // Japanese breaks between characters, so there is no unbreakable word.
      ok(`${lang} chip "${chip}": no word wider than the column`, lang === "ja" || w.widestWord <= CHIP_TEXT_WIDTH, `${w.widestWord} > ${CHIP_TEXT_WIDTH}`);
    }
    const prices = REAL_PRICES[lang];
    for (const key of ["ctaMonthly", "ctaAnnual", "ctaLifetime"] as const) {
      ok(`${lang} ${key} carries {{price}}`, pw[key].includes("{{price}}"));
      const price = key === "ctaMonthly" ? prices[0] : key === "ctaAnnual" ? prices[1] : prices[2];
      const label = fill(pw[key], { price });
      // Two lines at most, at the largest size the label can grow to (the CTA
      // caps the text multiplier at 1.3); no word wider than the line.
      for (const scale of [1, 1.15, 1.3]) {
        const w = wrap(label, 15 * scale, CTA_WIDTH);
        ok(`${lang} ${key} "${label}" wraps in at most 2 lines at x${scale}`, w.lines <= 2, `${w.lines} lines`);
        ok(`${lang} ${key} x${scale}: no word wider than the line`, lang === "ja" || w.widestWord <= CTA_WIDTH, `${Math.round(w.widestWord)}`);
      }
    }
    ok(`${lang} promise is a single short sentence`, pw.promise.length <= 90 && !/[—–]/.test(pw.promise), pw.promise);
    for (const v of Object.values(pw)) {
      ok(`${lang}: no em/en dash in new copy`, !/[—–]/.test(String(v)));
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
