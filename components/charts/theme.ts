import { STATUS_COLOR } from "../../lib/glucose";

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
  /** Median curve and single-series lines. */
  line: "#22d3ee",
  lineDeep: "#0891b2",
  /** Inter-quartile ribbon. */
  band: "#22d3ee",
  /** The 70-180 target band. */
  target: "#10b981",

  low: STATUS_COLOR.low, // #3b82f6, cold blue
  inRange: STATUS_COLOR.normal, // #10b981, emerald
  high: STATUS_COLOR.elevated, // #f59e0b, amber

  grid: "#27272a", // zinc-800
  axis: "#71717a", // zinc-500
  bar: "#22d3ee",
  barMuted: "#3f3f46", // zinc-700
} as const;

/** Chart heights, in points. Tuned so three charts do not bury the tiles. */
export const CHART_HEIGHT = {
  dailyProfile: 190,
  trend: 160,
  hourly: 170,
} as const;
