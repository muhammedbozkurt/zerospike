import React, { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import type { TargetBand } from "../../lib/agpChart";
import { layoutCurve, type CurveModel } from "../../lib/cgm/curve";
import type { GlucoseUnit } from "../../lib/db/types";
import { formatTime } from "../../lib/format";
import { THEME } from "../../lib/theme/tokens";
import { CHART } from "./theme";

const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 20;

interface Props {
  model: CurveModel;
  unit: GlucoseUnit;
  band: TargetBand;
  height?: number;
  /** One sentence for screen readers: count, lowest, highest, last value. */
  summary: string;
}

/**
 * The sensor curve: one line through the bucket medians, broken wherever the
 * readings are more than 15 minutes apart, over the user's own target band.
 * Hand-entered readings are separate marks on the same axis. Descriptive only:
 * no threshold line, no value colouring, no forecast.
 */
function CgmCurveBase({ model, unit, band, height = 150, summary }: Props) {
  const [width, setWidth] = useState(0);
  const geometry = useMemo(
    () =>
      width > 0
        ? layoutCurve(
            model,
            { width, height, padL: PAD_L, padR: PAD_R, padT: PAD_T, padB: PAD_B },
            band,
            unit
          )
        : null,
    [model, width, height, band, unit]
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ height, width: "100%" }}
    >
      {geometry ? (
        <Svg width={width} height={height}>
          {geometry.band ? (
            <Rect
              x={geometry.plot.l}
              y={geometry.band.y}
              width={geometry.plot.r - geometry.plot.l}
              height={geometry.band.h}
              fill={CHART.target}
              fillOpacity={0.12}
            />
          ) : null}

          {geometry.yTicks.map((tick) => (
            <React.Fragment key={tick.mgdl}>
              <Line
                x1={geometry.plot.l}
                y1={tick.y}
                x2={geometry.plot.r}
                y2={tick.y}
                stroke={CHART.grid}
                strokeWidth={1}
              />
              <SvgText
                x={geometry.plot.l - 5}
                y={tick.y + 3}
                fontSize={9}
                fill={CHART.axis}
                textAnchor="end"
              >
                {tick.label}
              </SvgText>
            </React.Fragment>
          ))}

          {geometry.xTicks.map((tick) => (
            <SvgText
              key={tick.ms}
              x={tick.x}
              y={height - 5}
              fontSize={9}
              fill={CHART.axis}
              textAnchor="middle"
            >
              {formatTime(new Date(tick.ms).toISOString())}
            </SvgText>
          ))}

          {geometry.paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              fill="none"
              stroke={CHART.line}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {geometry.dots.map((p, i) => (
            <Circle key={`d${i}`} cx={p.x} cy={p.y} r={2} fill={CHART.line} />
          ))}
          {geometry.last ? (
            <Circle cx={geometry.last.x} cy={geometry.last.y} r={3.5} fill={CHART.lineDeep} />
          ) : null}
          {geometry.manual.map((p, i) => (
            <Circle
              key={`m${i}`}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={THEME.surfaceRaised}
              stroke={CHART.lineDeep}
              strokeWidth={2}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

export const CgmCurve = React.memo(CgmCurveBase);
