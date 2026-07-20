import type { GlucoseStatus } from "../glucose";

/**
 * zerospike design tokens - the single source of truth for color, spacing,
 * radius, elevation and type across every surface (app screens, the doctor PDF
 * report, the iOS/Android home widget, and the Apple Watch app). NativeWind /
 * Tailwind handles most className styling; these constants are for the places
 * that need raw values: charts, SVG, the print HTML, and animated components.
 *
 * Keep tailwind.config.js in sync with COLORS below (it mirrors these names).
 */

/* ── Glucose color language ────────────────────────────────────────────────
 *
 * ONE mapping, used identically on every surface (R5 requirement). Aligned with
 * classifyGlucose (lib/glucose.ts):
 *   low       → red    (hypo, most urgent)
 *   normal    → green  (in target)
 *   elevated  → amber  (above target)
 *   high      → orange (well above target)
 *
 * R5 note: this replaces the earlier blue-for-low palette. Color is never the
 * sole signal - every reading is shown with its numeric value and period label,
 * so the mapping stays legible for color-vision differences and greyscale print.
 * Shades are chosen to also separate by lightness. */
export const GLUCOSE_COLORS: Record<GlucoseStatus, string> = {
  low: "#ef4444", // red-500    - hypoglycemia (< 70 mg/dL)
  normal: "#10b981", // emerald-500 - in range (target)
  elevated: "#f59e0b", // amber-500  - above target
  high: "#f97316", // orange-500 - well above target
};

/** Soft translucent fills of the glucose colors, for pills/banners/backgrounds. */
export const GLUCOSE_TINT: Record<GlucoseStatus, string> = {
  low: "rgba(239,68,68,0.14)",
  normal: "rgba(16,185,129,0.14)",
  elevated: "rgba(245,158,11,0.14)",
  high: "rgba(249,115,22,0.14)",
};

/* ── Core palette ──────────────────────────────────────────────────────────*/
export const COLORS = {
  /** Brand accent - cyan/ice, deliberately distinct from the diagnostic green. */
  brand: "#22d3ee",
  brandDark: "#0891b2",
  brandTint: "rgba(34,211,238,0.12)",

  // Neutral surface scale (zinc), centralized so screens stop hard-coding hexes.
  bg: "#000000",
  surface: "#18181b", // zinc-900
  surfaceAlt: "#27272a", // zinc-800
  border: "#27272a", // zinc-800
  borderStrong: "#3f3f46", // zinc-700

  textPrimary: "#fafafa", // zinc-50
  textSecondary: "#a1a1aa", // zinc-400
  textMuted: "#71717a", // zinc-500
  textFaint: "#52525b", // zinc-600

  // Glucose language re-exported for programmatic use.
  glucose: GLUCOSE_COLORS,
} as const;

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

/* ── Elevation (subtle; the UI is dark, so shadows read as depth not glow) ──*/
export const ELEVATION = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  sheet: {
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
} as const;

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
