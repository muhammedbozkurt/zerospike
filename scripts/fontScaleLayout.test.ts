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
} from "../lib/layoutForFontScale";

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

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
