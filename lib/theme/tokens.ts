import type { GlucoseStatus } from "../glucose";
import { elevationFor } from "./elevation";

/**
 * zerospike design tokens: the single source of truth for color, spacing,
 * radius, elevation and type across the app screens. The PDF report, the home
 * widgets and the watch apps keep their own fixed values.
 *
 * Color exists as two palettes (light, dark). THEME, GLUCOSE_COLORS and the
 * other color exports below are LIVE objects: every property is a getter that
 * reads the active palette, so a static `import { THEME }` keeps working when
 * the theme changes. ThemeProvider switches the active palette and remounts the
 * routed tree, which re-reads them. Module-level `StyleSheet.create` or constant
 * style objects built from them would freeze the first palette, so build those
 * inside render (scripts/theme-lint.mjs reports them).
 *
 * Glucose colors: color is never the sole signal, every reading also shows its
 * numeric value and period label. `glucose` is the fill/dot variant (>= 3:1),
 * `glucoseText` the text variant (>= 4.5:1).
 */

export type Scheme = "light" | "dark";
type GKey = GlucoseStatus | "veryLow";

export interface Palette {
  scheme: Scheme;
  bg: string;
  wash: { g1: string; g2: string; gg: string; glowCyan: string; sos: { base: string; top: string }; deep: string };
  surface: string;
  surfaceRaised: string;
  surfaceInset: string;
  border: string;
  borderStrong: string;
  /** Switch off-state track: >= 3:1 against bg, surface and the white thumb on light. */
  switchTrackOff: string;
  track: string;
  /** Outline of a progress bar's track: >= 3:1 against bg, surface and the
   *  accent-tinted card, so an empty bar stays visible on light. */
  trackEdge: string;
  text: string;
  textMuted: string;
  accent: string;
  accentFill: string;
  accentOnFill: string;
  accentStrong: string;
  accentPressed: string;
  success: string;
  warning: string;
  danger: string;
  dangerFill: string;
  onDanger: string;
  violet: string;
  glucose: Record<GKey, string>;
  glucoseText: Record<GKey, string>;
  glucoseTint: Record<GlucoseStatus, string>;
  chart: { line: string; band: string; target: string; violet: string };
  glowK: number;
  /** Injection map: never used, then three used tiers, opaque on the figure. */
  heatRamp: readonly [string, string, string, string];
  heatEdge: string;
  /** Injection map, five absolute count tiers (0, 1, 2, 3, 4+). Light theme:
   *  white to deep teal, one step darker per tier. Dark theme: dim slate to
   *  bright cyan, one step more luminous per tier. Tier 0 is drawn with a frame. */
  heatScale: readonly [string, string, string, string, string];
}

/** SINGLE source for the dark "very high" hue (>= the fixed 250 mg/dL ceiling),
 *  a deep ORANGE so it never reads as the low rose even at legend-dot size.
 *  Static string: only the PDF report imports it, and it keeps its own colors. */
export const VERY_HIGH = "#ff8a00";

/** Dark very-low red (level-2 hypo band). Static string for the PDF report; the
 *  app reads the live `GLUCOSE_COLORS`-family objects below. */
export const GLUCOSE_VERY_LOW = "#d63a55";

export const DARK: Palette = {
  scheme: "dark",
  bg: "#0f1f29",
  wash: {
    g1: "#080e14",
    g2: "#0f2029",
    gg: "#123141",
    glowCyan: "rgba(46,230,255,0.12)",
    sos: { base: "#080a0d", top: "#2a1418" },
    deep: "#04161d",
  },
  surface: "rgba(255,255,255,0.05)",
  surfaceRaised: "#16232e",
  surfaceInset: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "#5f7a88",
  switchTrackOff: "#5f7a88",
  track: "rgba(255,255,255,0.08)",
  trackEdge: "#6A8794",
  text: "#eaf6fa",
  textMuted: "#89a3b0",
  accent: "#2ee6ff",
  accentFill: "#22C7E0",
  accentOnFill: "#04161d",
  accentStrong: "#7ff4ff",
  accentPressed: "#12c6e0",
  success: "#22e39a",
  warning: "#ffa02a",
  danger: "#ff5468",
  dangerFill: "#ff5468",
  onDanger: "#04161d",
  violet: "#7c5cff",
  glucose: {
    low: "#ff5468",
    normal: "#22e39a",
    elevated: "#ffd23f",
    high: "#ffa02a",
    veryHigh: VERY_HIGH,
    veryLow: GLUCOSE_VERY_LOW,
  },
  glucoseText: {
    low: "#ff5468",
    normal: "#22e39a",
    elevated: "#ffd23f",
    high: "#ffa02a",
    veryHigh: VERY_HIGH,
    veryLow: "#ff5468",
  },
  glucoseTint: {
    low: "rgba(255,84,104,0.16)",
    normal: "rgba(34,227,154,0.16)",
    elevated: "rgba(255,210,63,0.16)",
    high: "rgba(255,160,42,0.16)",
    veryHigh: "rgba(255,138,0,0.16)",
  },
  chart: { line: "#2ee6ff", band: "rgba(46,230,255,0.12)", target: "#22e39a", violet: "#7c5cff" },
  glowK: 1,
  heatRamp: ["#33454f", "#2F8A9C", "#27AFC6", "#2EE6FF"],
  heatEdge: "#5f7a88",
  heatScale: ["#33454f", "#26808F", "#2A9BB2", "#2DB9D2", "#2EE6FF"],
};

export const LIGHT: Palette = {
  scheme: "light",
  bg: "#F5EFE6",
  wash: {
    g1: "#F5EFE6",
    g2: "#F5EFE6",
    gg: "#F5EFE6",
    glowCyan: "rgba(14,155,184,0.06)",
    sos: { base: "#F5EFE6", top: "#F6E1DD" },
    deep: "#F5EFE6",
  },
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  surfaceInset: "rgba(15,34,48,0.04)",
  border: "rgba(15,34,48,0.12)",
  borderStrong: "#78898F",
  switchTrackOff: "#958770",
  track: "#E2D9CB",
  trackEdge: "#6A7D88",
  text: "#0F2230",
  textMuted: "#4A5D68",
  accent: "#087089",
  accentFill: "#0E9BB8",
  accentOnFill: "#0F2230",
  accentStrong: "#087089",
  accentPressed: "#087089",
  success: "#157A52",
  warning: "#8F5F00",
  danger: "#BE2F43",
  dangerFill: "#BE2F43",
  onDanger: "#FFFFFF",
  violet: "#5B3FE0",
  glucose: {
    low: "#D6304A",
    normal: "#12805A",
    elevated: "#A06E00",
    high: "#C25E00",
    veryHigh: "#C2410C",
    veryLow: "#8F1D33",
  },
  glucoseText: {
    low: "#C42A44",
    normal: "#0F6F4C",
    elevated: "#8A5F00",
    high: "#A84F00",
    veryHigh: "#B03A0A",
    veryLow: "#8F1D33",
  },
  glucoseTint: {
    low: "rgba(214,48,74,0.12)",
    normal: "rgba(18,128,90,0.12)",
    elevated: "rgba(160,110,0,0.14)",
    high: "rgba(194,94,0,0.12)",
    veryHigh: "rgba(194,65,12,0.12)",
  },
  chart: { line: "#087089", band: "rgba(14,155,184,0.12)", target: "#157A52", violet: "#5B3FE0" },
  glowK: 0.3,
  heatRamp: ["#FFFFFF", "#8FCADA", "#3F9DB8", "#0B6A82"],
  heatEdge: "#5E7480",
  heatScale: ["#FFFFFF", "#C2E0EA", "#86C3D5", "#3F9DB8", "#0B6A82"],
};

export const PALETTES: Record<Scheme, Palette> = { light: LIGHT, dark: DARK };

let activeScheme: Scheme = "dark";

export function setActiveScheme(next: Scheme): void {
  activeScheme = next;
}

export function getActiveScheme(): Scheme {
  return activeScheme;
}

export function activePalette(): Palette {
  return PALETTES[activeScheme];
}

/** An object whose every property re-reads the active palette on access. */
function live<T extends object>(read: (p: Palette) => T): T {
  const out = {} as T;
  for (const key of Object.keys(read(DARK)) as (keyof T)[]) {
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => read(activePalette())[key],
    });
  }
  return out;
}

const STATUS_KEYS: GlucoseStatus[] = ["low", "normal", "elevated", "high", "veryHigh"];

function statusMap(map: Record<GKey, string>): Record<GlucoseStatus, string> {
  const out = {} as Record<GlucoseStatus, string>;
  for (const k of STATUS_KEYS) out[k] = map[k];
  return out;
}

/** GlucoseStatus -> fill/dot color. */
export const GLUCOSE_COLORS: Record<GlucoseStatus, string> = live((p) => statusMap(p.glucose));

/** GlucoseStatus -> translucent fill for pills/banners/backgrounds. */
export const GLUCOSE_TINT: Record<GlucoseStatus, string> = live((p) => p.glucoseTint);

/** GlucoseStatus -> text color (>= 4.5:1 on the app surfaces). */
export const GLUCOSE_TEXT: Record<GlucoseStatus, string> = live((p) => statusMap(p.glucoseText));

/* ── Spacing - 4 / 8 pt grid ───────────────────────────────────────────────*/
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

/* ── Radii ─────────────────────────────────────────────────────────────────*/
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  full: 9999,
} as const;


/* ── Elevation: dark reads as depth, light as a soft drop shadow ───────────*/
export const ELEVATION = {
  get card() {
    return elevationForActive("card") as ElevationStyle;
  },
  get sheet() {
    return elevationForActive("sheet") as ElevationStyle;
  },
  get popover() {
    return elevationForActive("popover") as { elevation: number; borderWidth?: number; borderColor?: string };
  },
};

type ElevationStyle = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
  borderWidth?: number;
  borderTopWidth?: number;
  borderColor?: string;
};

function elevationForActive(kind: "card" | "sheet" | "popover") {
  // Lazy require: see glow(); pure-Node scripts import this module.
  const os = (require("react-native") as typeof import("react-native")).Platform.OS;
  const p = activePalette();
  return elevationFor(kind, p.scheme, os, p.border);
}

/* ── Type scale ────────────────────────────────────────────────────────────
 *
 * The custom brand font is a HUMAN drop-in (see lib/theme/fonts.ts). Until the
 * .ttf files are added, FONT_FAMILY is undefined and the platform system font
 * is used. Numbers everywhere use tabular figures (`fontVariant: tabular-nums`)
 * so animated count-ups never shift width - see components/AnimatedNumber. */
export const FONT_FAMILY: string | undefined = undefined;

export const TYPE = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: "800" as const },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700" as const },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const },
  title3: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: "600" as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const },
} as const;

/** Tabular-figure prop for any numeric Text, so digits keep a constant width. */
export const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** Minimum touch target (accessibility): 44pt per Apple HIG / WCAG. */
export const HIT_TARGET = 44;

/**
 * Text metrics for EVERY TextInput in the app.
 *
 * A NativeWind `text-*` utility carries Tailwind's paired line-height
 * (`text-base` = fontSize 16 + lineHeight 24). On a Text that is harmless, but
 * iOS turns a TextInput's lineHeight into a fixed paragraph line box and then
 * draws the glyphs inside it, so anything taller than the box is cut off - the
 * field showed the top half of "Sabah" and nothing else. Inputs are therefore
 * sized with fontSize ONLY and left to measure their own line box.
 * includeFontPadding is the Android half: it drops the extra ascender padding
 * so the same field is not visually off-centre there.
 */
export const INPUT_TEXT = {
  fontSize: 16,
  includeFontPadding: false,
} as const;

/**
 * Top padding for a route presented as an iOS sheet (`presentation: "modal"` =
 * UIModalPresentationPageSheet). The sheet already starts below the status bar,
 * but useSafeAreaInsets still reports the ROOT WINDOW inset (~59pt on a notched
 * phone) because the single SafeAreaProvider measures the root view, not the
 * presented one - so `Math.max(insets.top, 8)` added a second status bar of dead
 * space above every modal title. Android renders these routes full-screen, where
 * insets.top is real and must stay.
 */
export const MODAL_TOP_PAD = 12;


/* ── Rich theme (live) ─────────────────────────────────────────────────────
 *
 * Legacy names (ink, muted, glass, sheet, bg.g1 ...) stay as getter aliases so
 * existing screens keep working; new code uses the semantic names (text,
 * textMuted, surface, surfaceRaised, accentFill ...) via useTheme(). */
export const THEME = live((p) => ({
  scheme: p.scheme,
  bg: { ...p.wash, base: p.bg },
  text: p.text,
  textMuted: p.textMuted,
  surface: p.surface,
  surfaceRaised: p.surfaceRaised,
  surfaceInset: p.surfaceInset,
  border: p.border,
  borderStrong: p.borderStrong,
  switchTrackOff: p.switchTrackOff,
  track: p.track,
  trackEdge: p.trackEdge,
  accent: p.accent,
  accentFill: p.accentFill,
  accentOnFill: p.accentOnFill,
  accentStrong: p.accentStrong,
  success: p.success,
  warning: p.warning,
  danger: p.danger,
  dangerFill: p.dangerFill,
  onDanger: p.onDanger,
  glucose: p.glucose,
  glucoseText: p.glucoseText,
  glucoseTint: p.glucoseTint,
  chart: p.chart,
  glowK: p.glowK,
  heatRamp: p.heatRamp,
  heatEdge: p.heatEdge,
  heatScale: p.heatScale,
  ink: p.text,
  muted: p.textMuted,
  accentSoft: p.accentStrong,
  accentDeep: p.accentFill,
  violet: p.violet,
  glass: p.surface,
  sheet: p.surfaceRaised,
  glassInset: p.surfaceInset,
  caution: p.warning,
}));

export type Theme = typeof THEME;

/** The glucose color language keyed by the mockup's states. */
export const GLUCOSE_RICH = live((p) => ({
  low: p.glucose.low,
  target: p.glucose.normal,
  high: p.glucose.elevated,
  wellAbove: p.glucose.high,
  veryHigh: p.glucose.veryHigh,
}));

/** GlucoseStatus -> the rich palette. One mapping for every rich surface. */
export const RICH_BY_STATUS: Record<GlucoseStatus, string> = live((p) => statusMap(p.glucose));

/** `#rrggbb` + alpha -> `rgba()`. Local copy (not imported from GlassCard) to
 *  avoid a components -> lib -> components import cycle. */
function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Colored glow shadow (iOS shadow* / Android elevation) matched to a hue. Hero
 *  cards and rings use this so the surface "lights up" in its own color. On the
 *  light theme the iOS opacity is scaled by the palette's glowK (0.3).
 *
 * I8: Android's `elevation` ignores `shadowColor` and always paints a flat grey
 * drop shadow, which reads as a broken block behind these translucent surfaces.
 * So on Android there is no shadow/elevation at all, a color-matched flat
 * treatment stands in instead:
 *   - "border" (default): a thin color-matched ring.
 *   - "fill": the ring plus a faint color-matched wash, for surfaces with no
 *     meaningful background of their own.
 *   - "shadowless": strip the shadow and add nothing.
 * The Android alpha is fixed and does not follow glowK. */
export function glow(
  color: string,
  radius = 24,
  opacity = 0.5,
  androidMode: "border" | "fill" | "shadowless" = "border",
) {
  // Lazy require: tokens.ts is also imported by pure-Node scripts that never
  // call glow(); a top-level react-native import would fail to parse there.
  const isIOS = (require("react-native") as typeof import("react-native")).Platform.OS === "ios";
  if (isIOS) {
    return {
      shadowColor: color,
      shadowOpacity: opacity * activePalette().glowK,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    } as const;
  }
  if (androidMode === "shadowless") return {} as const;
  const ring = { borderWidth: 1, borderColor: hexAlpha(color, 0.3), elevation: 0 } as const;
  return androidMode === "fill" ? { ...ring, backgroundColor: hexAlpha(color, 0.1) } : ring;
}

/** Shared Switch colors, the only source for every <Switch>. The off track is
 *  switchTrackOff (sand on light). iOS paints the off body from
 *  ios_backgroundColor, not trackColor.false (that is only the thin outline), so
 *  without it the off switch stays system white on the light theme. */
export function switchColors(): {
  trackColor: { true: string; false: string };
  thumbColor: string;
  ios_backgroundColor: string;
} {
  const p = activePalette();
  return p.scheme === "light"
    ? {
        trackColor: { true: p.accentFill, false: p.switchTrackOff },
        thumbColor: "#FFFFFF", // theme-ok
        ios_backgroundColor: p.switchTrackOff,
      }
    : {
        trackColor: { true: p.accent, false: p.switchTrackOff },
        thumbColor: p.text,
        ios_backgroundColor: p.switchTrackOff,
      };
}
