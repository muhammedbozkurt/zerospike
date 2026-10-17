import React, { useMemo } from "react";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { DEFAULT_TARGET_BAND, type TargetBand } from "../../lib/agpChart";
import { formatGlucose } from "../../lib/glucose";
import type { GlucoseUnit } from "../../lib/db/types";
import { CHART } from "./theme";
import { THEME } from "../../lib/theme/tokens";

const PAD_L = 34;
const PAD_R = 6;
/** Leaves room for the value label that sits above the tallest bar. */
const PAD_T = 18;
const PAD_B = 20;
const GAP = 12;

export interface HourlyBar {
  /** Already-localized slice name. */
  label: string;
  /** Mean glucose in mg/dL, or null when the slice has no readings. */
  value: number | null;
}

/**
 * Mean glucose per time-of-day slice, as bars against the target band. A slice
 * with no readings is drawn as an empty track, not as a zero.
 */
export function HourlyChart({
  bars,
  unit,
  width,
  height,
  band = DEFAULT_TARGET_BAND,
}: {
  bars: HourlyBar[];
  unit: GlucoseUnit;
  width: number;
  height: number;
  /** The profile's own target band; the shading is the user's range. */
  band?: TargetBand;
}) {
  const geometry = useMemo(() => {
    const plotLeft = PAD_L;
    const plotRight = width - PAD_R;
    const plotTop = PAD_T;
    const plotBottom = height - PAD_B;

    const values = bars.map((b) => b.value).filter((v): v is number => v != null);
    // Scale bars against the target band so their height is readable in context,
    // never against their own min/max (which would exaggerate small differences).
    const max = Math.max(band.high * 1.2, ...values) * 1.05;

    const y = (value: number) =>
      plotBottom - (Math.min(value, max) / max) * (plotBottom - plotTop);
    const slot = (plotRight - plotLeft) / bars.length;
    const barWidth = Math.max(8, slot - GAP);

    return {
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      y,
      bars: bars.map((b, i) => ({
        ...b,
        x: plotLeft + i * slot + (slot - barWidth) / 2,
        width: barWidth,
        centerX: plotLeft + i * slot + slot / 2,
      })),
      yTicks: [band.low, band.high].map((value) => ({
        value,
        y: y(value),
      })),
      targetTop: y(band.high),
      targetBottom: y(band.low),
    };
  }, [bars, width, height, band]);

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

      {geometry.bars.map((bar) => {
        if (bar.value == null) {
          // A stub bar would read as "nearly zero". A dash over an empty,
          // dashed track reads as "no reading here", which is the truth.
          return (
            <React.Fragment key={bar.label}>
              <Rect
                x={bar.x}
                y={geometry.plotTop}
                width={bar.width}
                height={geometry.plotBottom - geometry.plotTop}
                fill="none"
                stroke={CHART.barMuted}
                strokeWidth={1}
                strokeDasharray="3 3"
                rx={3}
              />
              <SvgText
                x={bar.centerX}
                y={(geometry.plotTop + geometry.plotBottom) / 2 + 4}
                fontSize={12}
                fill={CHART.axis}
                textAnchor="middle"
              >
                {"-"}
              </SvgText>
              <SvgText
                x={bar.centerX}
                y={geometry.plotBottom + 13}
                fontSize={9}
                fill={CHART.axis}
                textAnchor="middle"
              >
                {bar.label}
              </SvgText>
            </React.Fragment>
          );
        }
        const top = geometry.y(bar.value);
        return (
          <React.Fragment key={bar.label}>
            <Rect
              x={bar.x}
              y={top}
              width={bar.width}
              height={Math.max(2, geometry.plotBottom - top)}
              fill={CHART.bar}
              fillOpacity={0.85}
              rx={3}
            />
            {/* The value on the bar: the chart is readable without the axis. */}
            <SvgText
              x={bar.centerX}
              y={top - 4}
              fontSize={10}
              fontWeight="600"
              fill={THEME.text}
              textAnchor="middle"
            >
              {formatGlucose(bar.value, unit)}
            </SvgText>
            <SvgText
              x={bar.centerX}
              y={geometry.plotBottom + 13}
              fontSize={9}
              fill={CHART.axis}
              textAnchor="middle"
            >
              {bar.label}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}
