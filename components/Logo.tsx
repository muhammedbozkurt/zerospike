import React from "react";
import Svg, { Path } from "react-native-svg";

/**
 * The zerospike mark — a "Z" (two slate bars) whose diagonal is a cyan
 * glucose/ECG spike. Pure vector so it scales crisply anywhere in-app.
 */
export function Logo({
  size = 64,
  brand = "#22d3ee",
  bar = "#e4e4e7",
}: {
  size?: number;
  brand?: string;
  bar?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Path
        d="M312 372 H712"
        stroke={bar}
        strokeWidth={38}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M312 652 H712"
        stroke={bar}
        strokeWidth={38}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M712 372 L560 560 L512 468 L464 560 L312 652"
        stroke={brand}
        strokeWidth={34}
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit={4}
        fill="none"
      />
    </Svg>
  );
}
