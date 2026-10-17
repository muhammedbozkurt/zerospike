import React from "react";
import Svg, { Path } from "react-native-svg";
import { THEME } from "../lib/theme/tokens";

export function Logo({
  size = 64,
  brand = THEME.text,
}: {
  size?: number;
  brand?: string;
  bar?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M26 31H74C58 31 42 69 26 69H74"
        stroke={brand}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
