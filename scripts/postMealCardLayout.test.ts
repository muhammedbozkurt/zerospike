/**
 * lib/postMealCardLayout.ts correctness harness. No jest, same standalone
 * style as scripts/postMealTimer.test.ts.
 *
 * The property under test: neither a chip row nor the full-width CTA
 * overflows on a small screen at large Dynamic Type - device QA's "the card
 * is cramped, the button doesn't read as a button, and it overflows on small
 * screens" (2.3.1's card redesign), made verifiable against real screen
 * widths and the two languages known to run longest (English as the baseline,
 * German as CLAUDE.md's "check the longest translation" language) instead of
 * eyeballed on one simulator.
 *
 * 2.3.2 moved the duration chips (and the "Custom" pill) off the dashboard
 * card and into components/PostMealDurationSheet.tsx. A later revision (P13)
 * removed that duration-chip row from the sheet too - the sheet now takes the
 * countdown length as one plain field, defaulted to POST_MEAL_WINDOW_MIN, so
 * there is no longer a wrapping chip row for it to overflow. The only chip
 * row left anywhere in this flow is the sheet's OTHER section - "when did you
 * start eating" (components/PostMealDurationSheet.tsx's LateChips) - and
 * sections A-C now measure that one instead, still against the sheet's own
 * inner width (SheetShell's horizontal padding, 18pt each side). Note LateChips
 * itself lays out as five EQUAL flex-basis chips in one non-wrapping row
 * (never wraps, shrinks its own text instead) rather than the wrapping,
 * fixed-width chips chipRowLayout models; this is the same conservative
 * wrap-based ESTIMATE the rest of this file already uses elsewhere; a widest-
 * chip failure here still means the label does not read at that width. The
 * card itself keeps only the full-width CTA (still measured with the card's
 * own gutters, section F) and a top-right pill that is now an ACTION label
 * ("pick a length") rather than a value (section G).
 *
 * Run: npx tsx scripts/postMealCardLayout.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { chipRowLayout, ctaFits } from "../lib/postMealCardLayout";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike post-meal card layout test");

// Screen widths named in the spec.
const DEVICES: Record<string, number> = {
  "iPhone SE (375)": 375,
  "iPhone mini (375)": 375,
  "iPhone standard (393)": 393,
  "iPhone Plus (430)": 430,
  "iPhone Pro Max (440)": 440,
};
/** The card's own inner width: screen - 2*16 (page gutter) - 2*14 (card
 *  padding). Still used by the CTA (section F) and the duration pill it sits
 *  beside (section G) - both stayed on the card. */
function cardInnerWidth(screenWidth: number): number {
  return screenWidth - 2 * 16 - 2 * 14;
}
/** components/PostMealDurationSheet.tsx's own inner width: SheetShell's
 *  content area is the raw screen minus its 18pt horizontal padding on each
 *  side (components/SheetShell.tsx), with no separate card padding on top -
 *  the sheet's content sits directly inside that padding. */
function modalInnerWidth(screenWidth: number): number {
  return screenWidth - 2 * 18;
}
/** app/onboarding.tsx's own step column: lib/useLayout.ts's `columnPad(24)`
 *  on a phone (isWide false, so its centering gap is 0), applied straight to
 *  the ScrollView the "widget" step's FadeSlideIn sits in with no further
 *  card padding on top of it - unlike the post-meal card/sheet above, the
 *  P18 mini-widget tile row is not nested inside a bordered card. */
function onboardingStepWidth(screenWidth: number): number {
  return screenWidth - 2 * 24;
}

// LateChips' five labels (components/PostMealDurationSheet.tsx: LATE_PRESETS
// = [5, 10, 15, 20, 30], via dashboard.postMealLateChip): English (the
// shortest of the nine languages, so it is the floor) and German (CLAUDE.md:
// new UI text is checked against the longest translation, usually German).
const EN_LATE_LABELS = ["5 min", "10 min", "15 min", "20 min", "30 min"];
const DE_LATE_LABELS = ["5 Min", "10 Min", "15 Min", "20 Min", "30 Min"];

section("A. late-start chip row fits every device, both languages, at normal Dynamic Type (1.0)");
{
  for (const [device, screenWidth] of Object.entries(DEVICES)) {
    const containerWidth = modalInnerWidth(screenWidth);
    for (const [lang, labels] of [["EN", EN_LATE_LABELS], ["DE", DE_LATE_LABELS]] as const) {
      const r = chipRowLayout({ containerWidth, fontScale: 1.0, labels });
      ok(`${device} ${lang} @1.0: every chip fits (no clipping)`, r.fits, `overflowPx=${r.overflowPx}`);
      eq(`${device} ${lang} @1.0: overflowPx is 0`, r.overflowPx, 0);
      ok(`${device} ${lang} @1.0: wraps to 1 or 2 rows, never 3+`, r.rows >= 1 && r.rows <= 2, `rows=${r.rows}`);
    }
  }
}

section("B. late-start chip row fits every device, both languages, at max Dynamic Type (1.3)");
{
  for (const [device, screenWidth] of Object.entries(DEVICES)) {
    const containerWidth = modalInnerWidth(screenWidth);
    for (const [lang, labels] of [["EN", EN_LATE_LABELS], ["DE", DE_LATE_LABELS]] as const) {
      const r = chipRowLayout({ containerWidth, fontScale: 1.3, labels });
      ok(`${device} ${lang} @1.3: every chip fits (no clipping)`, r.fits, `overflowPx=${r.overflowPx}`);
      eq(`${device} ${lang} @1.3: overflowPx is 0`, r.overflowPx, 0);
      ok(`${device} ${lang} @1.3: wraps to 1 or 2 rows, never 3+`, r.rows >= 1 && r.rows <= 2, `rows=${r.rows}`);
    }
  }
}

section("C. the smallest screen at max scale, in full - the case device QA reported");
{
  const containerWidth = modalInnerWidth(375);
  const de = chipRowLayout({ containerWidth, fontScale: 1.3, labels: DE_LATE_LABELS });
  eq("iPhone SE, German, 1.3x: fits", de.fits, true);
  eq("iPhone SE, German, 1.3x: overflowPx", de.overflowPx, 0);
  ok("iPhone SE, German, 1.3x: at least the presets share a row", de.perRow >= 1);
  ok(
    "iPhone SE, German, 1.3x: every chip clears the 44pt touch floor",
    de.chipWidths.every((w) => w >= 44)
  );
}

section("D. degenerate inputs never throw / never invent a fit");
{
  const empty = chipRowLayout({ containerWidth: 315, fontScale: 1.0, labels: [] });
  eq("no labels: no rows", empty.rows, 0);
  eq("no labels: trivially fits", empty.fits, true);

  const zero = chipRowLayout({ containerWidth: 0, fontScale: 1.0, labels: ["60 min"] });
  eq("zero-width container: does not fit", zero.fits, false);
  ok("zero-width container: overflow is the chip's own width", zero.overflowPx > 0);

  // A single chip too wide for the container on its own: no amount of
  // wrapping helps, so it must be reported as not fitting rather than
  // silently placed alone on its own row and called fine.
  const tooNarrow = chipRowLayout({ containerWidth: 40, fontScale: 1.3, labels: DE_LATE_LABELS });
  eq("a container narrower than the widest chip: does not fit", tooNarrow.fits, false);
  ok("overflowPx is positive", tooNarrow.overflowPx > 0);
}

section("E. the touch-target floor holds even for a one-character label");
{
  const r = chipRowLayout({ containerWidth: 315, fontScale: 1.0, labels: ["+"] });
  eq("a tiny label still gets the 44pt floor", r.chipWidths[0], 44);
}

section("F. ctaFits - the full-width primary button's own label");
{
  // The exact pair named in the spec: dashboard.startedEating, English and
  // German (lib/i18n/locales/en.ts / de.ts).
  const EN = "I started eating";
  const DE = "Ich habe angefangen zu essen";
  const seContainer = cardInnerWidth(375);

  eq("English fits on the smallest screen at normal scale", ctaFits(seContainer, EN, 1.0), true);
  eq("English fits on the smallest screen at max scale (1.3x)", ctaFits(seContainer, EN, 1.3), true);
  eq("German fits on the smallest screen at normal scale", ctaFits(seContainer, DE, 1.0), true);
  // RISK (reported, not routed around): the German label does NOT fit this
  // estimate on the smallest screen at max Dynamic Type. CLAUDE.md forbids
  // adjustsFontSizeToFit (it clips silently on Android) and the card spec
  // requires numberOfLines={1} on this button, so neither escape hatch is
  // available here - see the final report for the recommendation (the fix is
  // a card-design decision: e.g. allow the CTA a second line at this one
  // extreme, or drop the button's own font size a step under high Dynamic
  // Type). Pinned as `false` deliberately: forcing this to `true` would hide
  // the real gap instead of surfacing it.
  eq(
    "German does NOT fit the smallest screen at max scale (1.3x) - flagged as a risk",
    ctaFits(seContainer, DE, 1.3),
    false
  );

  // A generous container clears even the longest label at max scale.
  ok("a wide-enough container fits German at 1.3x", ctaFits(600, DE, 1.3));
}

section("G. the idle card's top-right duration pill fits beside the title (P13: action label)");
{
  // The card's title + pill sit on one row (icon, title with flex:1 so it
  // wraps rather than pushing the pill off, then the pill). The title cannot
  // itself overflow the row - it shrinks to nothing before the pill does - so
  // the only thing that can actually overflow this row is the pill's own
  // fixed-width label. Reserving the icon's 18px plus its 8px gap leaves
  // exactly what the pill has to fit inside; chipRowLayout with a single
  // label is the same estimate the sheet's own chips use.
  const iconReserve = 18 + 8;
  // P13: the pill is no longer a value ("120 min") - the countdown length is
  // never saved, so there is nothing to show - it is a fixed ACTION label
  // ("pick a length") that reads the same regardless of what length gets
  // picked. English is dashboard.postMealDurationPick's real string; German
  // is not translated yet (CLAUDE.md: locale files are a separate, gated
  // change - see the final report), so this assumes a longer stand-in
  // ("Dauer festlegen") rather than the real key so a later, differently
  // worded German translation cannot silently go untested.
  const EN_PILL = "Set the length";
  const DE_PILL = "Dauer festlegen";
  for (const [lang, label] of [["EN", EN_PILL], ["DE", DE_PILL]] as const) {
    const r = chipRowLayout({
      containerWidth: cardInnerWidth(375) - iconReserve,
      fontScale: 1.3,
      labels: [label],
    });
    ok(`SE 375 @1.3x ${lang}: the duration pill fits beside the icon + title`, r.fits, `overflowPx=${r.overflowPx}`);
    eq(`SE 375 @1.3x ${lang}: overflowPx is 0`, r.overflowPx, 0);
  }
}

section("H. P18 onboarding widget-step mock: mini-widget tile row (icon-only 44pt circles, no label)");
{
  // app/onboarding.tsx's "widget" step mock: four single-purpose tiles
  // (glucose, meal, insulin, timer) drawn as bare 44pt circles - no text
  // inside or under them (see the case block's own comment for why a label
  // was dropped: dashboard.startCountdown's German does not fit one line at
  // 9-10pt under a 44pt column even at full step width). Modeled here as
  // empty-string chips so chipRowLayout's own touch-target floor (44, the
  // same as the circle's own diameter) is what is actually being measured -
  // an icon does not grow with Dynamic Type the way the dropped label would
  // have, so this floor holds at every fontScale, which the loop below
  // checks explicitly rather than assuming.
  const GAP = 10;
  const FOUR_TILES = ["", "", "", ""]; // hasInsulin true: glucose, meal, insulin, timer
  const THREE_TILES = ["", "", ""]; // hasInsulin false: glucose, meal, timer

  for (const [device, screenWidth] of Object.entries(DEVICES)) {
    const containerWidth = onboardingStepWidth(screenWidth);
    for (const fontScale of [1.0, 1.3]) {
      for (const [variant, labels] of [
        ["insulinli (4)", FOUR_TILES],
        ["insulinsiz (3)", THREE_TILES],
      ] as const) {
        const r = chipRowLayout({ containerWidth, fontScale, labels, gap: GAP });
        ok(
          `${device} @${fontScale}x ${variant}: tile row fits (no clipping)`,
          r.fits,
          `overflowPx=${r.overflowPx}`
        );
        eq(`${device} @${fontScale}x ${variant}: overflowPx is 0`, r.overflowPx, 0);
        ok(
          `${device} @${fontScale}x ${variant}: wraps to 1 or 2 rows, never 3+`,
          r.rows >= 1 && r.rows <= 2,
          `rows=${r.rows}`
        );
        ok(
          `${device} @${fontScale}x ${variant}: every tile stays the 44pt circle diameter`,
          r.chipWidths.every((w) => w === 44),
          `chipWidths=${JSON.stringify(r.chipWidths)}`
        );
      }
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
