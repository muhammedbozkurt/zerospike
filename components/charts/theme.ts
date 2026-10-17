import { THEME } from "../../lib/theme/tokens";

/**
 * One palette for every chart on the Insights screen.
 *
 * The time-in-range colours come straight from the single glucose color
 * language (lib/theme/tokens.ts, via lib/glucose.ts STATUS_COLOR): low=red,
 * in-range=emerald, high=amber. The shades separate by lightness too, so they
 * survive a greyscale print and the common forms of colour blindness. No chart
 * relies on colour alone: every series carries a text label.
 */
export const CHART = { // theme-ok: live getters, read at render time
  /** Median curve and single-series lines. */
  get line() {
    return THEME.chart.line;
  },
  get lineDeep() {
    return THEME.accentFill;
  },
  /** Inter-quartile ribbon (drawn with a fill opacity). */
  get band() {
    return THEME.chart.line;
  },
  /** The 70-180 target band. */
  get target() {
    return THEME.glucose.normal;
  },

  get low() {
    return THEME.glucose.low;
  },
  get inRange() {
    return THEME.glucose.normal;
  },
  get high() {
    return THEME.glucose.elevated;
  },

  get grid() {
    return THEME.border;
  },
  get axis() {
    return THEME.textMuted;
  },
  get bar() {
    return THEME.chart.line;
  },
  /** Hairline track for an empty bar. */
  get barMuted() {
    return THEME.border;
  },
};

/** Text on a glucose-colored fill: near-black on the bright dark-theme fills,
 *  white on the deeper light-theme fills. */
export function onGlucoseFill(): string {
  return THEME.scheme === "light" ? THEME.surface : THEME.bg.base;
}

/** Chart heights, in points. Tuned so three charts do not bury the tiles. */
export const CHART_HEIGHT = {
  dailyProfile: 190,
  trend: 160,
  hourly: 170,
} as const;
