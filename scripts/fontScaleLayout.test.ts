/**
 * lib/layoutForFontScale.ts: large-text (Dynamic Type / Android font scale)
 * layout decisions at scale 1.0, 2.0 and 3.1, plus the contract that the app
 * cap meets Apple's Larger Text minimum (200%).
 * Run: npx tsx scripts/fontScaleLayout.test.ts
 * Computed evidence only: no device measurement (DOGRULANMADI on screen).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FONT_CAP,
  MAX_FONT_SCALE,
  SINGLE_COLUMN_AT_SCALE,
  STACK_AT_SCALE,
  effectiveFontScale,
  gridColumnsFor,
  isLargeText,
  linesFor,
  pairDirectionFor,
  relaxTextProps,
  rowDirectionFor,
  scaledMinHeight,
  scaledSize,
  overlaySheetMaxHeight,
  calcHeaderTitleStyle,
  ctaLineExtra,
  scrollHintAllowed,
  longestWord,
  wordFitMultiplier,
} from "../lib/layoutForFontScale";
import { estimateTextWidth } from "../lib/fitText";

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

check("MAX_FONT_SCALE meets Apple's 200% Larger Text minimum", () => {
  assert.ok(MAX_FONT_SCALE >= 2.0, `MAX_FONT_SCALE=${MAX_FONT_SCALE}`);
});

check("fontScale.ts re-exports the same cap and the wrapper applies it", () => {
  const src = read("lib/theme/fontScale.ts");
  assert.match(src, /export \{ MAX_FONT_SCALE \}/);
  assert.match(src, /maxFontSizeMultiplier \?\? MAX_FONT_SCALE/);
  assert.doesNotMatch(src, /MAX_FONT_SCALE\s*=\s*1\.3/);
});

check("critical geometric elements get a lower cap than the body", () => {
  for (const [k, v] of Object.entries(FONT_CAP)) {
    assert.ok(v < MAX_FONT_SCALE, `${k}=${v}`);
    assert.ok(v >= 1.2, `${k}=${v} would not scale at all`);
  }
  assert.ok(FONT_CAP.badge <= FONT_CAP.ringNumber);
});

check("effectiveFontScale clamps to [1, cap] and survives junk", () => {
  assert.equal(effectiveFontScale(1), 1);
  assert.equal(effectiveFontScale(0.85), 1);
  assert.equal(effectiveFontScale(2.0), 2.0);
  assert.equal(effectiveFontScale(3.1), MAX_FONT_SCALE);
  assert.equal(effectiveFontScale(3.1, FONT_CAP.ringNumber), FONT_CAP.ringNumber);
  assert.equal(effectiveFontScale(Number.NaN), 1);
});

check("default size (1.0) changes nothing", () => {
  assert.equal(rowDirectionFor(1), "row");
  assert.equal(pairDirectionFor(1), "row");
  assert.equal(pairDirectionFor(1, true), "row-reverse");
  assert.equal(gridColumnsFor(1, 4), 4);
  assert.equal(scaledMinHeight(44, 1), 44);
  assert.equal(scaledMinHeight(36, 1), 36);
  assert.equal(scaledSize(30, 1), 30);
  assert.equal(linesFor(1, 1), 1);
  assert.equal(linesFor(1, 2), 2);
  assert.equal(isLargeText(1), false);
});

check("current 1.3 cap range keeps the row layout", () => {
  assert.equal(rowDirectionFor(1.3), "row");
  assert.equal(gridColumnsFor(1.3, 3), 3);
  assert.equal(linesFor(1.3, 1), 1);
});

check("scale 2.0 stacks pairs, single-columns grids, grows min heights", () => {
  assert.equal(rowDirectionFor(2.0), "column");
  assert.equal(pairDirectionFor(2.0, true), "column");
  assert.equal(gridColumnsFor(2.0, 4), 1);
  assert.equal(scaledMinHeight(44, 2.0), 88);
  assert.equal(scaledMinHeight(30, 2.0), 60);
  assert.equal(linesFor(2.0, 1), undefined);
  assert.equal(isLargeText(2.0), true);
});

check("scale 3.1 is clamped to the cap, not beyond", () => {
  assert.equal(rowDirectionFor(3.1), "column");
  assert.equal(scaledMinHeight(44, 3.1), Math.round(44 * MAX_FONT_SCALE));
  assert.equal(scaledMinHeight(44, 3.1, FONT_CAP.badge), Math.round(44 * FONT_CAP.badge));
});

check("stack threshold sits between the old cap (1.3) and the new one", () => {
  assert.ok(STACK_AT_SCALE >= 1.3 && STACK_AT_SCALE < MAX_FONT_SCALE);
  assert.ok(SINGLE_COLUMN_AT_SCALE >= 1.3 && SINGLE_COLUMN_AT_SCALE < MAX_FONT_SCALE);
  assert.equal(rowDirectionFor(STACK_AT_SCALE), "row");
  assert.equal(rowDirectionFor(STACK_AT_SCALE + 0.01), "column");
});

check("relaxTextProps: default size returns the same object", () => {
  const p = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7 };
  assert.equal(relaxTextProps(p, 1), p);
  assert.equal(relaxTextProps(p, 1.3), p);
});

check("relaxTextProps: large text drops line limits and shrink-to-fit", () => {
  const p = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7, other: "x" };
  const r = relaxTextProps(p, 2.0);
  assert.equal(r.numberOfLines, undefined);
  assert.equal(r.adjustsFontSizeToFit, undefined);
  assert.equal(r.minimumFontScale, undefined);
  assert.equal(r.other, "x");
  assert.equal(p.numberOfLines, 1, "input must not be mutated");
});

check("relaxTextProps: an explicit maxFontSizeMultiplier (fixed geometry) keeps its limits", () => {
  const p = { numberOfLines: 1, adjustsFontSizeToFit: true, maxFontSizeMultiplier: FONT_CAP.badge };
  assert.equal(relaxTextProps(p, 3.1), p);
});

check("relaxTextProps: nothing to relax returns the same object", () => {
  const p = { maxFontSizeMultiplier: undefined };
  assert.equal(relaxTextProps(p, 2.0), p);
});

check("no component pins the old 1.3 cap by hand any more", () => {
  const paywall = read("app/paywall.tsx");
  assert.doesNotMatch(paywall, /maxFontSizeMultiplier=\{1\.3\}/);
  const cta = read("components/rich/GradientCTA.tsx");
  assert.doesNotMatch(cta, /maxFontSizeMultiplier=\{allowTwoLines \? 1\.3/);
});

check("tab bar labels opt out of font scaling (Large Content Viewer pattern)", () => {
  assert.match(read("app/(tabs)/_layout.tsx"), /tabBarAllowFontScaling:\s*false/);
});

// ---- 241-ALFIX: large-text fixes (B1-B6). Scale 1.0 outputs must not move. ----

check("B2 overlaySheetMaxHeight: scale-1.0 phone (host as tall as the window) equals the legacy cap", () => {
  for (const [w, kb, top] of [[956, 0, 59], [844, 0, 47], [932, 336, 59], [667, 0, 20]] as const) {
    const legacy = Math.min(w * 0.92, w - kb - top - 8);
    assert.equal(overlaySheetMaxHeight({ windowHeight: w, hostHeight: w, keyboardH: kb, insetTop: top }), legacy);
    assert.equal(overlaySheetMaxHeight({ windowHeight: w, hostHeight: 0, keyboardH: kb, insetTop: top }), legacy);
  }
});

check("B2 overlaySheetMaxHeight: AX5 host (873 of 956, inset 59) keeps the top under the status bar", () => {
  const max = overlaySheetMaxHeight({ windowHeight: 956, hostHeight: 873, keyboardH: 0, insetTop: 59 });
  assert.ok(max <= 873 - 59, `max=${max}`);
  assert.ok(873 - max >= 59, "top edge must be at or below the status bar");
  assert.ok(max > 0);
});

check("B2 overlaySheetMaxHeight: never negative, keyboard counted once", () => {
  assert.equal(overlaySheetMaxHeight({ windowHeight: 300, hostHeight: 300, keyboardH: 400, insetTop: 59 }), 0);
  const a = overlaySheetMaxHeight({ windowHeight: 956, hostHeight: 873, keyboardH: 300, insetTop: 59 });
  assert.equal(a, 873 - 300 - 59 - 8);
});

check("B3 calcHeaderTitleStyle: empty at default and moderate scale, shrinks+centres when large", () => {
  assert.deepEqual(calcHeaderTitleStyle(1), {});
  assert.deepEqual(calcHeaderTitleStyle(1.5), {});
  const big = calcHeaderTitleStyle(2);
  assert.equal(big.flexShrink, 1);
  assert.equal(big.textAlign, "center");
});

check("B5 ctaLineExtra: 0 at 1.0 (scroll padding unchanged), grows with the label", () => {
  assert.equal(ctaLineExtra(1), 0);
  assert.equal(ctaLineExtra(0.8), 0);
  assert.equal(ctaLineExtra(2), 24);
  assert.equal(ctaLineExtra(3.1), 24, "capped at MAX_FONT_SCALE");
});

check("B5 scrollHintAllowed: shown at default sizes, dropped when large text would put it on text", () => {
  assert.equal(scrollHintAllowed(1), true);
  assert.equal(scrollHintAllowed(1.5), true);
  assert.equal(scrollHintAllowed(2), false);
});

check("B5 ring caption cap stays below the number cap and keeps the >=1.2 floor", () => {
  assert.ok(FONT_CAP.ringCaption >= 1.2 && FONT_CAP.ringCaption < FONT_CAP.ringNumber);
  assert.match(read("components/rich/GlucoseRing.tsx"), /maxFontSizeMultiplier=\{FONT_CAP\.ringCaption\}/);
  assert.match(read("components/rich/TIRDonut.tsx"), /maxFontSizeMultiplier=\{FONT_CAP\.ringCaption\}/);
});

check("B1 GlucoseInputSheet: the card shrinks inside the maxHeight wrapper so the body scrolls and pinned Save stays above the keyboard", () => {
  const src = read("components/GlucoseInputSheet.tsx");
  assert.match(src, /overflow: "hidden",\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*flexShrink: 1,/);
  assert.match(src, /const pinSave = fontScale > STACK_AT_SCALE;/);
  assert.match(src, /\{pinSave \? null : \(\s*<GradientCTA/);
  assert.match(src, /<ScrollView\s+style=\{\{ flexShrink: 1 \}\}/);
});

check("B2 CarbEstimateSheet: host-measured cap, title wraps at large text and is capped", () => {
  const src = read("components/CarbEstimateSheet.tsx");
  assert.match(src, /overlaySheetMaxHeight\(\{ windowHeight, hostHeight, keyboardH, insetTop: insets\.top \}\)/);
  assert.match(src, /setHostHeight\(e\.nativeEvent\.layout\.height\)/);
  assert.match(src, /numberOfLines=\{linesFor\(fontScale, 2\)\}/);
});

check("B3 calculator: both header titles take the large-text style", () => {
  const src = read("app/calculator.tsx");
  assert.equal((src.match(/headerStyle\]\} numberOfLines=\{1\}/g) ?? []).length, 2);
});

check("B6 live text-size change: every Text is keyed by the live scale (fresh host node, measured at the new size)", () => {
  const src = read("lib/theme/fontScale.ts");
  assert.match(src, /key: name === "Text" \? fontScale : undefined/);
  const today = read("app/(tabs)/index.tsx");
  assert.doesNotMatch(today, /DashboardScreenInner/);
});

check("B9 longestWord picks the widest-by-length token", () => {
  assert.equal(longestWord("Doktorunuzun okuyabileceği rapor"), "okuyabileceği");
  assert.equal(longestWord("   "), "");
  assert.equal(longestWord(""), "");
});

check("B9 wordFitMultiplier: undefined at 1.0 (pixel identical), capped only when a word would break", () => {
  assert.equal(wordFitMultiplier("Doktorunuzun okuyabileceği rapor", 34, 384, 1), undefined);
  assert.equal(wordFitMultiplier("Doktorunuzun okuyabileceği rapor", 34, 384, 0.9), undefined);
  const m = wordFitMultiplier("Doktorunuzun okuyabileceği rapor", 34, 384, 3.1);
  assert.ok(m !== undefined && m >= 1 && m < MAX_FONT_SCALE, `got ${m}`);
  assert.ok(estimateTextWidth("okuyabileceği", 34 * (m as number)) <= 384);
  assert.equal(wordFitMultiplier("Log", 34, 384, 2), undefined);
  assert.equal(wordFitMultiplier("Hello", 34, 0, 2), undefined);
  assert.equal(wordFitMultiplier("Wortlängenüberschreitungsbeispiel", 34, 100, 2), 1);
});

check("B9 Welcome and QuizStep headings take the word-fit cap; the sample card is hidden at large text", () => {
  const w = read("components/onboarding/Welcome.tsx");
  assert.match(w, /maxFontSizeMultiplier=\{wordFitMultiplier\(title/);
  assert.match(w, /large \? null/);
  const q = read("components/onboarding/QuizStep.tsx");
  assert.match(q, /maxFontSizeMultiplier=\{titleCap\}/);
});

check("B5 Today list clears the taller floating CTA", () => {
  const src = read("app/(tabs)/index.tsx");
  assert.match(src, /CTA_CLEARANCE \+ ctaExtra/);
  assert.match(src, /CTA_FOOTPRINT \+ ctaExtra \+ insets\.bottom/);
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
