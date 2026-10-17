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
 *
 * The wash itself is CONSTANT: three full-bleed rects and two gradient defs, the
 * same on every screen and in every state. It used to be rebuilt as part of its
 * host's element tree, so every dashboard/food/insights render walked and
 * reconciled nine SVG nodes that could not possibly have changed. Both layers
 * below therefore render a single module-level element - React sees the identical
 * element object on a re-render and skips the subtree outright.
 */
const Wash = React.memo(function Wash() {
  if (THEME.scheme === "light") {
    return <LightWash id="bgLight" />;
  }
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <LinearGradient id="bgLinear" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={THEME.bg.g2} />
          {/* The ramp used to crush to g1 at the very bottom, which read as a
              black shadow over the last rows of tall screens (worst right above
              the tab bar). Hold a lighter floor instead; the tab bar itself
              stays g1 and separates with its own border. */}
          <Stop offset="0.7" stopColor="#0e1c26" />{/* theme-ok */}
          <Stop offset="1" stopColor={THEME.bg.base} />
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
  );
});

/** Light theme: a flat cream with one very faint accent radial at the top. */
function LightWash({ id }: { id: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="-10%" rx="120%" ry="55%">
          <Stop offset="0" stopColor={THEME.accentFill} stopOpacity={0.06} />
          <Stop offset="1" stopColor={THEME.accentFill} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={THEME.bg.base} />
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const WASH_ELEMENT = <Wash />;

export function AppBackground({
  children,
  style,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.root, { backgroundColor: THEME.bg.base }, style]}>
      {WASH_ELEMENT}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

/**
 * The wash as an absolute-fill layer, to drop in as the FIRST child of an
 * existing flex-1 container (siblings after it render above it). Lets a screen
 * adopt the Midnight Monitor wash with a one-line edit and no close-tag change.
 */
const FillWash = React.memo(function FillWash() {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: THEME.bg.base }]}
    >
      {THEME.scheme === "light" ? (
        <LightWash id="bgfLight" />
      ) : (
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="bgfLinear" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={THEME.bg.g2} />
            <Stop offset="0.7" stopColor="#0e1c26" />{/* theme-ok */}
            <Stop offset="1" stopColor={THEME.bg.base} />
          </LinearGradient>
          <RadialGradient id="bgfTeal" cx="15%" cy="-5%" rx="130%" ry="70%">
            <Stop offset="0" stopColor={THEME.bg.gg} stopOpacity={1} />
            <Stop offset="0.55" stopColor={THEME.bg.gg} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bgfCyan" cx="100%" cy="105%" rx="120%" ry="70%">
            <Stop offset="0" stopColor={THEME.accent} stopOpacity={0.12} />
            <Stop offset="0.5" stopColor={THEME.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgfLinear)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgfTeal)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgfCyan)" />
      </Svg>
      )}
    </View>
  );
});

const FILL_WASH_ELEMENT = <FillWash />;

export function AppBackgroundFill() {
  return FILL_WASH_ELEMENT;
}
