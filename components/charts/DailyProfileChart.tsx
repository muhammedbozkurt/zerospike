import React, { useMemo } from "react";
import Svg, { Circle, Line, Polygon, Polyline, Rect, Text as SvgText } from "react-native-svg";

import type { Agp } from "../../lib/agp";
import { buildAgpGeometry, pointsAttr, type ChartBox } from "../../lib/agpChart";
import { formatGlucose } from "../../lib/glucose";
import type { GlucoseUnit } from "../../lib/db/types";
import { CHART } from "./theme";

/**
 * The Ambulatory Glucose Profile: every reading in the window pooled by hour of
 * day, drawn as a median curve inside its 25-75 % band, over the target band.
 *
 * Coordinates come from lib/agpChart.ts, which the PDF report also uses, so the
 * chart here and the chart the user prints are the same chart.
 */
export function DailyProfileChart({
  agp,
  unit,
  width,
  height,
}: {
  agp: Agp;
  unit: GlucoseUnit;
  width: number;
  height: number;
}) {
  const box: ChartBox = useMemo(
    () => ({ width, height, padL: 34, padR: 6, padT: 8, padB: 20 }),
    [width, height]
  );
  const g = useMemo(() => buildAgpGeometry(agp, box), [agp, box]);
  if (!g) return null;

  const hasCurve = g.iqrPolygon.length > 0;

  return (
    <Svg width={width} height={height}>
      <Rect
        x={g.targetBand.x}
        y={g.targetBand.y}
        width={g.targetBand.width}
        height={g.targetBand.height}
        fill={CHART.target}
        fillOpacity={0.12}
      />

      {g.yTicks.map(({ value, y }) => (
        <React.Fragment key={value}>
          <Line
            x1={g.plotLeft}
            y1={y}
            x2={g.plotRight}
            y2={y}
            stroke={CHART.grid}
            strokeWidth={1}
          />
          <SvgText
            x={g.plotLeft - 5}
            y={y + 3}
            fontSize={9}
            fill={CHART.axis}
            textAnchor="end"
          >
            {formatGlucose(value, unit)}
          </SvgText>
        </React.Fragment>
      ))}

      {hasCurve ? (
        <Polygon points={pointsAttr(g.iqrPolygon)} fill={CHART.band} fillOpacity={0.2} />
      ) : null}
      {hasCurve ? (
        <Polyline
          points={pointsAttr(g.medianLine)}
          fill="none"
          stroke={CHART.line}
          strokeWidth={2}
        />
      ) : null}

      {g.medianLine.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2} fill={CHART.lineDeep} />
      ))}

      {g.xTicks.map(({ hour, x }) => (
        <SvgText
          key={hour}
          x={x}
          y={height - 6}
          fontSize={9}
          fill={CHART.axis}
          // The end labels would hang off the plot if they were centred.
          textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}
        >
          {`${hour}:00`}
        </SvgText>
      ))}
    </Svg>
  );
}
