import { DARK, LIGHT, type Palette } from "./tokens";

/** WCAG 2.x contrast math and the token pair table shared by
 *  scripts/theme.test.ts and scripts/theme-contrast.mjs. */

type Rgba = [number, number, number, number];

export function parseColor(c: string): Rgba {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  throw new Error(`unparseable color: ${c}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Contrast of `fg` drawn on `bg`; translucent colors are composited over `base`. */
export function contrast(fg: string, bg: string, base: string): number {
  const baseC = parseColor(base);
  const bgC = over(parseColor(bg), baseC);
  const fgC = over(parseColor(fg), bgC);
  const l1 = luminance(fgC);
  const l2 = luminance(bgC);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export interface ContrastRow {
  scheme: string;
  name: string;
  fg: string;
  bg: string;
  min: number;
  ratio: number;
}

const G_KEYS = ["low", "normal", "elevated", "high", "veryHigh", "veryLow"] as const;

export function contrastTable(): ContrastRow[] {
  const rows: ContrastRow[] = [];
  for (const p of [LIGHT, DARK] as Palette[]) {
    const add = (name: string, fg: string, bg: string, min: number) =>
      rows.push({ scheme: p.scheme, name, fg, bg, min, ratio: contrast(fg, bg, p.bg) });
    const grounds: [string, string][] = [
      ["bg", p.bg],
      ["surface", p.surface],
      ["surfaceRaised", p.surfaceRaised],
    ];
    for (const [gn, g] of grounds) add(`text on ${gn}`, p.text, g, 4.5);
    for (const [gn, g] of grounds.slice(0, 2)) {
      add(`textMuted on ${gn}`, p.textMuted, g, 4.5);
      add(`accent on ${gn}`, p.accent, g, 4.5);
      add(`success on ${gn}`, p.success, g, 4.5);
      add(`warning on ${gn}`, p.warning, g, 4.5);
      add(`danger on ${gn}`, p.danger, g, 4.5);
      add(`borderStrong on ${gn}`, p.borderStrong, g, 3);
      add(`chart.line on ${gn}`, p.chart.line, g, 3);
      add(`chart.violet on ${gn}`, p.chart.violet, g, 3);
      add(`chart.target on ${gn}`, p.chart.target, g, 3);
      for (const k of G_KEYS) {
        add(`glucoseText.${k} on ${gn}`, p.glucoseText[k], g, 4.5);
        add(`glucose.${k} on ${gn}`, p.glucose[k], g, 3);
      }
    }
    const rgba = (c: string, a: number) => {
      const [r, g, b] = parseColor(c);
      return `rgba(${r},${g},${b},${a})`;
    };
    const flat = (fg: string, base: string) => {
      const [r, g, b] = over(parseColor(fg), parseColor(base));
      const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
      return `#${h(r)}${h(g)}${h(b)}`;
    };
    const badgeFg = p.scheme === "light" ? p.text : p.glucose.normal;
    const badgeTint = rgba(p.glucose.normal, 0.16);
    const unselectedFlat = flat(p.surface, p.bg);
    const selectedFlat = flat(rgba(p.accent, 0.12), unselectedFlat);
    for (const [label, base] of [
      ["unselected", unselectedFlat],
      ["selected", selectedFlat],
    ] as const) {
      rows.push({
        scheme: p.scheme,
        name: `paywall save badge on ${label} card`,
        fg: badgeFg,
        bg: badgeTint,
        min: 4.5,
        ratio: contrast(badgeFg, badgeTint, base),
      });
    }
    add("textMuted on track (disabled CTA)", p.textMuted, p.track, 4.5);
    add("borderStrong on bg (disabled CTA edge)", p.borderStrong, p.bg, 3);
    add("white thumb on borderStrong track", "#FFFFFF", p.borderStrong, 3);
    add("accentOnFill on accentFill", p.accentOnFill, p.accentFill, 4.5);
    add("onDanger on dangerFill", p.onDanger, p.dangerFill, 4.5);
    add("dangerFill on bg", p.dangerFill, p.bg, 3);
    // Post-meal countdown bar: the edge must stand out from every ground the
    // card can sit on, and the accent fill must stand out from the empty track.
    add("trackEdge on bg (progress bar edge)", p.trackEdge, p.bg, 3);
    add("trackEdge on surface (progress bar edge)", p.trackEdge, p.surface, 3);
    add("trackEdge on accent card (progress bar edge)", p.trackEdge, rgba(p.accent, 0.1), 3);
    add("accent fill on track (progress bar)", p.accent, p.track, 3);
  }
  return rows;
}
