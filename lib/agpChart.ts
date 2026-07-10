import { AGP_MIN_READINGS, type Agp } from "./agp";

/**
 * Geometry for the Ambulatory Glucose Profile chart: turns the pooled
 * percentile bands from lib/agp.ts into plot coordinates.
 *
 * Shared on purpose. The PDF report renders these coordinates as an SVG string
 * and the Insights screen renders them with react-native-svg, so the chart the
 * user hands to their care team and the chart on their phone are drawn from the
 * same numbers.
 *
 * Pure: values in, coordinates out. Everything is mg/dL; only tick labels are
 * converted to the profile's display unit, by the caller.
 */

/** Axis range: leaves room for a hypo and a serious high without clipping. */
export const AGP_G_MIN = 40;
export const AGP_G_MAX = 320;

/** The standard time-in-range band. */
export const AGP_TARGET_LOW = 70;
export const AGP_TARGET_HIGH = 180;

/** Horizontal gridlines: both target edges, plus one high reference. */
export const AGP_Y_TICKS: readonly number[] = [70, 180, 300];

/** Vertical gridlines every six hours, midnight to midnight. */
export const AGP_X_TICKS: readonly number[] = [0, 6, 12, 18, 24];

/** An IQR ribbon needs at least two hours to have any width. */
const MIN_BANDS_FOR_CURVE = 2;

export interface ChartBox {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface AgpGeometry {
  /** Target-band rectangle, spanning the full plot width. */
  targetBand: { x: number; y: number; width: number; height: number };
  /** p75 left-to-right, then p25 right-to-left. Empty below two hours. */
  iqrPolygon: Point[];
  /** The median curve. A single point still renders as a dot. */
  medianLine: Point[];
  yTicks: { value: number; y: number }[];
  xTicks: { hour: number; x: number }[];
  plotLeft: number;
  plotRight: number;
}

/**
 * Returns null when the window is too sparse for the bands to mean anything,
 * which is the caller's cue to show a "fills in as you add readings" note
 * rather than a chart drawn from three readings.
 */
export function buildAgpGeometry(agp: Agp, box: ChartBox): AgpGeometry | null {
  if (agp.totalReadings < AGP_MIN_READINGS || agp.bands.length === 0) return null;

  const plotLeft = box.padL;
  const plotRight = box.width - box.padR;
  const plotTop = box.padT;
  const plotBottom = box.height - box.padB;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const x = (hour: number) => plotLeft + (hour / 24) * plotWidth;
  const y = (glucose: number) => {
    const clamped = Math.max(AGP_G_MIN, Math.min(AGP_G_MAX, glucose));
    return plotTop + (1 - (clamped - AGP_G_MIN) / (AGP_G_MAX - AGP_G_MIN)) * plotHeight;
  };

  const bands = agp.bands;
  const wide = bands.length >= MIN_BANDS_FOR_CURVE;

  const iqrPolygon: Point[] = wide
    ? [
        ...bands.map((b) => ({ x: x(b.hour), y: y(b.p75) })),
        ...[...bands].reverse().map((b) => ({ x: x(b.hour), y: y(b.p25) })),
      ]
    : [];

  return {
    targetBand: {
      x: plotLeft,
      y: y(AGP_TARGET_HIGH),
      width: plotWidth,
      height: y(AGP_TARGET_LOW) - y(AGP_TARGET_HIGH),
    },
    iqrPolygon,
    medianLine: bands.map((b) => ({ x: x(b.hour), y: y(b.p50) })),
    yTicks: AGP_Y_TICKS.map((value) => ({ value, y: y(value) })),
    xTicks: AGP_X_TICKS.map((hour) => ({ hour, x: x(hour) })),
    plotLeft,
    plotRight,
  };
}

/** "x,y x,y ..." as SVG polygon/polyline point lists want it. */
export function pointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}
