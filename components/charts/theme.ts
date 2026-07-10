import { STATUS_COLOR } from "../../lib/glucose";

/**
 * One palette for every chart on the Insights screen.
 *
 * The three time-in-range colours come straight from the app's diagnostic
 * palette (lib/glucose.ts), where a hypo is deliberately a cold blue rather
 * than a red: red-vs-green is the pair most commonly confused, and a hypo read
 * as a high is the most dangerous confusion this app can cause. Blue / emerald
 * / amber also separate by lightness, so they survive a greyscale print and the
 * common forms of colour blindness. No chart relies on colour alone: every
 * series carries a text label.
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
