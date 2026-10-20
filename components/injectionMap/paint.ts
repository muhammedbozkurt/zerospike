/**
 * Colour helpers of the injection map that need no React Native, so the
 * geometry render in scripts/injectionMapRender.ts paints with the same code.
 */
import { PALETTES } from "../../lib/theme/tokens";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, k: number): number => parseInt(h.slice(1 + k * 2, 3 + k * 2), 16);
  const out = [0, 1, 2].map((k) => Math.round(lerp(ch(a, k), ch(b, k), t)).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

function luminance(hex: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const c = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Whichever of the two theme inks reads better on this plate. */
export function inkFor(fill: string): string {
  const l = luminance(fill);
  const light = PALETTES.dark.text;
  const dark = PALETTES.light.text;
  const cr = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return cr(l, luminance(light)) >= cr(l, luminance(dark)) ? light : dark;
}
