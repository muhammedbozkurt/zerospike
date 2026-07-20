import React from "react";
import { StyleSheet, View } from "react-native";
import type { ViewStyle, StyleProp } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { THEME } from "../../lib/theme/tokens";

/**
 * The Midnight Monitor wash. One layered dark surface shared by every screen:
 * a vertical linear (g2 -> g1) with a top-left teal radial and a bottom-right
 * cyan radial floated over it. This is the mockup's `.scr` background rebuilt in
 * SVG (no expo-linear-gradient needed) so the whole app sits on the same depth.
 *
 * Not a flat single color - that flatness is exactly what the earlier round was
 * rejected for. Wrap a screen's content in it; children render above the wash.
 */
export function AppBackground({
  children,
  style,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.root, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="bgLinear" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={THEME.bg.g2} />
            <Stop offset="1" stopColor={THEME.bg.g1} />
          </LinearGradient>
          <RadialGradient id="bgTeal" cx="15%" cy="-5%" rx="130%" ry="70%">
            <Stop offset="0" stopColor={THEME.bg.gg} stopOpacity={1} />
            <Stop offset="0.55" stopColor={THEME.bg.gg} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bgCyan" cx="100%" cy="105%" rx="120%" ry="70%">
            <Stop offset="0" stopColor={THEME.accent} stopOpacity={0.12} />
            <Stop offset="0.5" stopColor={THEME.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgLinear)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgTeal)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgCyan)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.bg.g1 },
});
