/** Run: npx tsx scripts/uiPrimitives.test.ts */
import assert from "node:assert/strict";

import { contrast } from "../lib/theme/contrast";
import { DARK, HIT_TARGET, LIGHT, TYPE } from "../lib/theme/tokens";
import {
  BUTTON_VISUAL_HEIGHT,
  CHIP_VISUAL_HEIGHT,
  TEXT_KIND_STYLE,
  buttonClassName,
  buttonHitSlop,
  buttonTextClassName,
  canonicalVariant,
  chipClassName,
  chipTextClassName,
  hitSlopFor,
  isCanonicalVariant,
  resolveVariantColors,
  toneColor,
  type ButtonSize,
  type ButtonVariant,
} from "../lib/theme/uiPrimitives";

/* Verbatim copy of the pre-P0 components/ui.tsx tables and template strings.
 * The legacy variants must keep rendering these exact classes. */
const ORIG_BG: Record<string, string> = {
  primary: "bg-brand active:bg-brandDark",
  secondary: "bg-glass active:opacity-80",
  danger: "bg-low/15 active:opacity-80 border border-low/40",
  ghost: "bg-transparent active:opacity-80",
};
const ORIG_TEXT: Record<string, string> = {
  primary: "text-onAccent",
  secondary: "text-ink",
  danger: "text-low",
  ghost: "text-mut",
};
const ORIG_PAD: Record<string, string> = { lg: "py-4 px-5", md: "py-3 px-4", sm: "py-2 px-3" };
const ORIG_SIZE_TEXT: Record<string, string> = { lg: "text-base", md: "text-base", sm: "text-sm" };

const origButton = (v: string, s: string, off: boolean, extra: string) =>
  `flex-row items-center justify-center rounded-2xl ${ORIG_PAD[s]} ${ORIG_BG[v]} ${off ? "opacity-50" : ""} ${extra}`;
const origButtonText = (v: string, s: string) => `font-semibold ${ORIG_SIZE_TEXT[s]} ${ORIG_TEXT[v]}`;
const origChip = (active: boolean) =>
  `rounded-full px-3.5 py-2 border ${active ? "bg-brand border-brand" : "bg-glass border-hair"}`;

const LEGACY: ButtonVariant[] = ["primary", "secondary", "danger", "ghost"];
const SIZES: ButtonSize[] = ["lg", "md", "sm"];

const cases: Array<[string, () => void]> = [
  ["legacy Button classes are byte-identical to pre-P0", () => {
    for (const v of LEGACY) {
      for (const s of SIZES) {
        for (const off of [false, true]) {
          for (const extra of ["", "mt-2 flex-1"]) {
            assert.equal(buttonClassName(v, s, off, extra), origButton(v, s, off, extra), `${v}/${s}/${off}`);
          }
        }
        assert.equal(buttonTextClassName(v, s), origButtonText(v, s));
      }
    }
  }],
  ["legacy names do not opt in to new behavior", () => {
    for (const v of LEGACY) assert.equal(isCanonicalVariant(v), false, v);
  }],
  ["canonical names opt in; aliases resolve", () => {
    for (const v of ["outlined", "tertiary", "destructive"] as ButtonVariant[]) assert.equal(isCanonicalVariant(v), true);
    assert.equal(canonicalVariant("ghost"), "tertiary");
    assert.equal(canonicalVariant("danger"), "destructive");
    assert.equal(canonicalVariant("secondary"), "secondary");
    assert.equal(canonicalVariant("outlined"), "outlined");
  }],
  ["tertiary and destructive paint like ghost and danger", () => {
    assert.equal(buttonClassName("tertiary", "md", false), buttonClassName("ghost", "md", false));
    assert.equal(buttonClassName("destructive", "md", false), buttonClassName("danger", "md", false));
    assert.equal(buttonTextClassName("tertiary", "sm"), buttonTextClassName("ghost", "sm"));
    assert.equal(buttonTextClassName("destructive", "sm"), buttonTextClassName("danger", "sm"));
  }],
  ["outlined is framed with the hairline border, transparent fill", () => {
    const c = buttonClassName("outlined", "md", false);
    assert.ok(c.includes("border border-hair"));
    assert.ok(c.includes("bg-transparent"));
    for (const p of [LIGHT, DARK]) {
      const r = resolveVariantColors("outlined", p);
      assert.equal(r.border, p.border);
      assert.equal(r.fill, "transparent");
    }
  }],
  ["min hit area: every size reaches 44 pt with slop", () => {
    for (const s of SIZES) {
      const slop = buttonHitSlop(s);
      const total = BUTTON_VISUAL_HEIGHT[s] + (slop ? slop.top + slop.bottom : 0);
      assert.ok(total >= HIT_TARGET, `${s} -> ${total}`);
    }
    assert.equal(buttonHitSlop("lg"), undefined);
    assert.equal(buttonHitSlop("md"), undefined);
    assert.deepEqual(buttonHitSlop("sm"), { top: 4, bottom: 4 });
  }],
  ["hitSlopFor edge cases", () => {
    assert.equal(hitSlopFor(44), 0);
    assert.equal(hitSlopFor(60), 0);
    assert.equal(hitSlopFor(43), 1);
    assert.equal(hitSlopFor(36), 4);
    assert.equal(hitSlopFor(0), 22);
    assert.equal(hitSlopFor(CHIP_VISUAL_HEIGHT) * 2 + CHIP_VISUAL_HEIGHT >= HIT_TARGET, true);
  }],
  ["Chip classes keep the Segmented look (plus centering row)", () => {
    for (const a of [true, false]) {
      assert.ok(chipClassName(a).includes(origChip(a)), String(a));
    }
    assert.equal(chipTextClassName(true), "text-sm font-medium text-onAccent");
    assert.equal(chipTextClassName(false), "text-sm font-medium text-mut");
  }],
  ["type scale: 5 kinds map to TYPE tokens", () => {
    assert.deepEqual(Object.keys(TEXT_KIND_STYLE), ["title", "subtitle", "body", "caption", "micro"]);
    assert.equal(TEXT_KIND_STYLE.title, TYPE.title2);
    assert.equal(TEXT_KIND_STYLE.subtitle, TYPE.title3);
    assert.equal(TEXT_KIND_STYLE.body, TYPE.body);
    assert.equal(TEXT_KIND_STYLE.caption, TYPE.caption);
    assert.equal(TEXT_KIND_STYLE.micro, TYPE.micro);
    for (const k of Object.values(TEXT_KIND_STYLE)) assert.ok(k.lineHeight > k.fontSize);
  }],
  ["variant text colors are readable on their own surface (>= 4.5:1), both schemes", () => {
    for (const p of [LIGHT, DARK]) {
      const bg = p.bg;
      for (const v of ["outlined", "tertiary", "destructive"] as ButtonVariant[]) {
        const c = resolveVariantColors(v, p);
        assert.ok(contrast(c.text, bg, bg) >= 4.5, `${p.scheme}/${v} ${contrast(c.text, bg, bg).toFixed(2)}`);
      }
      const prim = resolveVariantColors("primary", p);
      assert.ok(contrast(prim.text, prim.fill, bg) >= 4.5, `${p.scheme}/primary`);
    }
  }],
  ["tone colors come from the palette", () => {
    for (const p of [LIGHT, DARK]) {
      assert.equal(toneColor("text", p), p.text);
      assert.equal(toneColor("muted", p), p.textMuted);
      assert.equal(toneColor("danger", p), p.danger);
      assert.equal(toneColor("success", p), p.success);
      assert.equal(toneColor("accent", p), p.accent);
    }
  }],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
