import React, { useMemo } from "react";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { AGP_TARGET_HIGH, AGP_TARGET_LOW } from "../../lib/agpChart";
import type { DailyAverage } from "../../lib/insights";
import { formatGlucose } from "../../lib/glucose";
import type { GlucoseUnit } from "../../lib/db/types";
import { CHART } from "./theme";

const PAD_L = 34;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 18;

/** Pads a value range so the extremes are not drawn on the frame itself. */
function axisRange(values: number[]): { min: number; max: number } {
  const lo = Math.min(AGP_TARGET_LOW, ...values);
  const hi = Math.max(AGP_TARGET_HIGH, ...values);
  const pad = Math.max(10, (hi - lo) * 0.1);
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

/**
 * One point per day with at least one reading: that day's mean glucose, over
 * the target band. Days with no reading leave a gap rather than a zero.
 *
 * Descriptive only. No trend line is fitted and nothing is called good or bad.
 */
export function TrendChart({
  days,
  windowDays,
  unit,
  width,
  height,
  startLabel,
  endLabel,
}: {
  days: DailyAverage[];
  windowDays: number;
  unit: GlucoseUnit;
  width: number;
  height: number;
  /** Localized axis ends; this component holds no copy of its own. */
  startLabel: string;
  endLabel: string;
}) {
  const geometry = useMemo(() => {
    const plotLeft = PAD_L;
    const plotRight = width - PAD_R;
    const plotTop = PAD_T;
    const plotBottom = height - PAD_B;
    const { min, max } = axisRange(days.map((d) => d.avg));

    // A single-day window would divide by zero; centre the lone point instead.
    const span = Math.max(1, windowDays - 1);
    const x = (offset: number) =>
      plotLeft + (offset / span) * (plotRight - plotLeft);
    const y = (value: number) =>
      plotBottom - ((value - min) / (max - min)) * (plotBottom - plotTop);

    return {
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      points: days.map((d) => ({ x: x(d.offset), y: y(d.avg) })),
      targetTop: y(Math.min(max, AGP_TARGET_HIGH)),
      targetBottom: y(Math.max(min, AGP_TARGET_LOW)),
      yTicks: [AGP_TARGET_LOW, AGP_TARGET_HIGH]
        .filter((v) => v >= min && v <= max)
        .map((value) => ({ value, y: y(value) })),
    };
  }, [days, windowDays, width, height]);

  const line = geometry.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <Svg width={width} height={height}>
      <Rect
        x={geometry.plotLeft}
        y={geometry.targetTop}
        width={geometry.plotRight - geometry.plotLeft}
        height={geometry.targetBottom - geometry.targetTop}
        fill={CHART.target}
        fillOpacity={0.12}
      />

      {geometry.yTicks.map(({ value, y }) => (
        <React.Fragment key={value}>
          <Line
            x1={geometry.plotLeft}
            y1={y}
            x2={geometry.plotRight}
            y2={y}
            stroke={CHART.grid}
            strokeWidth={1}
          />
          <SvgText
            x={geometry.plotLeft - 5}
            y={y + 3}
            fontSize={9}
            fill={CHART.axis}
            textAnchor="end"
          >
            {formatGlucose(value, unit)}
          </SvgText>
        </React.Fragment>
      ))}

      {geometry.points.length > 1 ? (
        <Polyline points={line} fill="none" stroke={CHART.line} strokeWidth={2} />
      ) : null}
      {geometry.points.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={CHART.lineDeep} />
      ))}

      <SvgText
        x={geometry.plotLeft}
        y={height - 5}
        fontSize={9}
        fill={CHART.axis}
        textAnchor="start"
      >
        {startLabel}
      </SvgText>
      <SvgText
        x={geometry.plotRight}
        y={height - 5}
        fontSize={9}
        fill={CHART.axis}
        textAnchor="end"
      >
        {endLabel}
      </SvgText>
    </Svg>
  );
}
