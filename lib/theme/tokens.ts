import type { GlucoseStatus } from "../glucose";

/**
 * zerospike design tokens - the single source of truth for color, spacing,
 * radius, elevation and type across every surface (app screens, the doctor PDF
 * report, the iOS/Android home widget, and the Apple Watch app). NativeWind /
 * Tailwind handles most className styling; these constants are for the places
 * that need raw values: charts, SVG, the print HTML, and animated components.
 *
 * Keep tailwind.config.js in sync with GLUCOSE_COLORS and THEME below (it
 * mirrors those names). There is no separate neutral scale: the Midnight
 * Monitor surfaces in THEME are the only ones, so a screen cannot accidentally
 * reach for an off-palette grey.
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
/** SINGLE source for the "very high" hue (>= the fixed 250 mg/dL ceiling). Kept a
 *  deep ORANGE so it can never read as the low rose in the TIR legend / report,
 *  even at legend-dot size. Every veryHigh below derives from this one value (D1).
 *  E1: pulled to #ff8a00 so it separates from the yellow "high"/elevated band. */
export const VERY_HIGH = "#ff8a00";

/* E1 four-way separation (legend-dot size, dark ground): low rose, target mint,
 * elevated YELLOW, veryHigh ORANGE - each pair visibly distinct. The `high`
 * (well-above) status sits between as an amber so the full 5-step ramp above
 * green stays monotonic (yellow -> amber -> orange). */
export const GLUCOSE_COLORS: Record<GlucoseStatus, string> = {
  low: "#ff5468", // rose        - below the user's own low threshold
  normal: "#22e39a", // mint        - in the target range
  elevated: "#ffd23f", // yellow      - above the range
  high: "#ffa02a", // amber       - well above the range
  veryHigh: VERY_HIGH, // deep orange  - distinct from yellow elevated / rose low
};

/** Below the level-2 hypo threshold (~54 mg/dL): a darker red than `low`, for
 *  surfaces (the five-band TIR bar, the doctor report) where very-low is its own
 *  slice. Not a GlucoseStatus - a semantic accent for that one band. */
export const GLUCOSE_VERY_LOW = "#b3243b";

/** Soft translucent fills of the glucose colors, for pills/banners/backgrounds. */
export const GLUCOSE_TINT: Record<GlucoseStatus, string> = {
  low: "rgba(255,84,104,0.16)",
  normal: "rgba(34,227,154,0.16)",
  elevated: "rgba(255,210,63,0.16)",
  high: "rgba(255,160,42,0.16)",
  veryHigh: "rgba(255,138,0,0.16)",
};

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
  /** OPAQUE elevated surface for center-popover modals (never see-through over the
   *  dim overlay). Bottom sheets use bg.g1; floating popovers use this slightly
   *  lighter tone so they read as elevated, not as a hole. */
  sheet: "#16232e",
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
  low: "#ff5468", // below the user's low threshold (R5: low stays red)
  target: "#22e39a", // in the target range
  high: "#ffd23f", // above the range (E1: yellow, distinct from orange veryHigh)
  wellAbove: "#ffa02a", // further above the range (amber, mid-ramp)
  veryHigh: VERY_HIGH, // at/above the fixed clinical 250 mg/dL ceiling (D1: one source)
} as const;

/** GlucoseStatus -> the rich palette. One mapping for every rich surface. */
export const RICH_BY_STATUS: Record<GlucoseStatus, string> = {
  low: GLUCOSE_RICH.low,
  normal: GLUCOSE_RICH.target,
  elevated: GLUCOSE_RICH.high,
  high: GLUCOSE_RICH.wellAbove,
  veryHigh: GLUCOSE_RICH.veryHigh,
};

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
