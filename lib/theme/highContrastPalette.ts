import type { Palette } from "./tokens";

/**
 * Increase Contrast variant of a palette. Pure: the brand hues, fills and the
 * glucose colors stay; only the quiet pieces get stronger, so a user who turns on
 * iOS "Increase Contrast" (darker system colors) or Android "High contrast text"
 * sees secondary text, hairlines and control outlines clearly. Imports types
 * only: tokens.ts depends on this file.
 */

function channelsOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Linear blend of two `#rrggbb` colors; t = 0 keeps `from`, t = 1 gives `to`. */
export function mixHex(from: string, to: string, t: number): string {
  const a = channelsOf(from);
  const b = channelsOf(to);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/** Same translucent color (four-part r,g,b,a form) with a different alpha. */
export function withAlphaOf(color: string, alpha: number): string {
  return color.replace(/[\d.]+\)$/, `${alpha})`);
}

export function highContrastPalette(p: Palette): Palette {
  const muted = mixHex(p.textMuted, p.text, 0.5);
  return {
    ...p,
    textMuted: muted,
    placeholder: muted,
    border: withAlphaOf(p.border, 0.4),
    // Dark lightens only a little: the white thumb of a disabled control must
    // stay >= 3:1 on this color.
    borderStrong: mixHex(p.borderStrong, p.text, p.scheme === "light" ? 0.4 : 0.15),
    trackEdge: mixHex(p.trackEdge, p.text, 0.3),
    heatEdge: mixHex(p.heatEdge, p.text, 0.3),
    // Light only: a darker off track also lifts the white thumb. On dark a
    // lighter track would eat the thumb's contrast, so it stays.
    switchTrackOff: p.scheme === "light" ? mixHex(p.switchTrackOff, p.text, 0.25) : p.switchTrackOff,
  };
}

export type HighContrastEvent = "darkerSystemColorsChanged" | "highTextContrastChanged";

/** iOS reports Increase Contrast as "darker system colors"; Android calls the
 *  closest setting "high contrast text". Any other platform has neither. */
export function highContrastEventFor(os: string): HighContrastEvent | null {
  if (os === "ios") return "darkerSystemColorsChanged";
  if (os === "android") return "highTextContrastChanged";
  return null;
}
