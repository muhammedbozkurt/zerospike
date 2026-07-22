import { STATUS_COLOR } from "../../lib/glucose";
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
export const CHART = {
  /** Median curve and single-series lines. Midnight Monitor cyan. */
  line: "#2ee6ff",
  lineDeep: "#12c6e0",
  /** Inter-quartile ribbon. */
  band: "#2ee6ff",
  /** The 70-180 target band. */
  target: STATUS_COLOR.normal, // mint

  low: STATUS_COLOR.low, // rose
  inRange: STATUS_COLOR.normal, // mint
  high: STATUS_COLOR.elevated, // amber

  grid: "rgba(255,255,255,0.08)",
  axis: "#89a3b0",
  bar: "#2ee6ff",
  barMuted: THEME.border, // hairline track for an empty bar
} as const;

/** Chart heights, in points. Tuned so three charts do not bury the tiles. */
export const CHART_HEIGHT = {
  dailyProfile: 190,
  trend: 160,
  hourly: 170,
} as const;
