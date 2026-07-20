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
  low: "#ff5468", // rose      - hypoglycemia (< 70 mg/dL). R5: low stays red.
  normal: "#22e39a", // mint      - in range (target)
  elevated: "#ffb43c", // amber     - above target
  high: "#ff7a3c", // orange    - well above target
};

/** Soft translucent fills of the glucose colors, for pills/banners/backgrounds. */
export const GLUCOSE_TINT: Record<GlucoseStatus, string> = {
  low: "rgba(255,84,104,0.16)",
  normal: "rgba(34,227,154,0.16)",
  elevated: "rgba(255,180,60,0.16)",
  high: "rgba(255,122,60,0.16)",
};

/* ── Core palette ──────────────────────────────────────────────────────────*/
export const COLORS = {
  /** Brand accent - cyan/ice, deliberately distinct from the diagnostic green.
   *  Aligned to the Midnight Monitor accent (#2ee6ff). */
  brand: "#2ee6ff",
  brandDark: "#12c6e0",
  brandTint: "rgba(46,230,255,0.12)",

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

/* ── Midnight Monitor rich theme ───────────────────────────────────────────
 *
 * The approved visual spec (docs/design/redesign-mockup.html, direction
 * "B - Midnight Monitor"). One layered dark surface, a cyan accent, and the
 * glucose color language re-stated so the raw-value places (SVG rings, gradient
 * charts, glow shadows, the app background) all read from ONE source.
 *
 * These are additive to COLORS/GLUCOSE_COLORS above (which stay the tailwind-
 * mirrored source). Screens use THEME for the raw values NativeWind cannot
 * express: multi-stop gradients, colored glow, glass fills. */
export const THEME = {
  /** Layered background: two radial washes over a vertical linear. Drawn as an
   *  absolute-fill SVG by <AppBackground> so every screen shares the same wash. */
  bg: {
    g1: "#080e14", // darkest (bottom of the linear)
    g2: "#0f2029", // top of the linear
    gg: "#123141", // the top-left radial glow
    glowCyan: "rgba(46,230,255,0.12)", // bottom-right cyan radial
  },
  ink: "#eaf6fa", // primary text on the wash
  muted: "#89a3b0", // secondary text
  accent: "#2ee6ff", // cyan - brand + highlight
  accentSoft: "#7ff4ff", // light stop for the cyan CTA gradient
  accentDeep: "#12c6e0", // deep stop for chips / native tiles
  violet: "#7c5cff", // conic avatar mid-stop
  /** Glass card surface. */
  glass: "rgba(255,255,255,0.05)",
  glassHi: "rgba(255,255,255,0.015)", // second stop of the 160deg card gradient
  glassInset: "rgba(255,255,255,0.06)", // top inset highlight line
  border: "rgba(255,255,255,0.10)",
  track: "rgba(255,255,255,0.08)", // ring / progress track
} as const;

/**
 * The glucose color language on the rich surfaces, keyed by the four mockup
 * states. Mirrors GLUCOSE_COLORS (low/normal/elevated/high) but named the way
 * the mockup labels them (low / target / high / very-high). Color is never the
 * sole signal - a value + label always sits beside it.
 */
export const GLUCOSE_RICH = {
  low: "#ff5468", // hypo (R5: low stays red)
  target: "#22e39a", // in range
  high: "#ffb43c", // above target
  veryHigh: "#ff7a3c", // well above target
} as const;

/** Colored glow shadow (iOS shadow* / Android elevation) matched to a hue. Hero
 *  cards and rings use this so the surface "lights up" in its own color. */
export function glow(color: string, radius = 24, opacity = 0.5) {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  } as const;
}
