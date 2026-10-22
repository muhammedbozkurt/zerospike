import type * as React from "react";

/* Named so nativewind's babel plugin does not rewrite `React.createElement`
 * into createInteropElement, which would drag the css-interop runtime into the
 * app entry before react-native itself loads. */
const ReactRuntime = require("react") as typeof React;

import { MAX_FONT_SCALE, relaxTextProps } from "../layoutForFontScale";

/** App-wide cap on the OS accessibility text-size multiplier. 2.0 meets Apple's
 *  Larger Text minimum (200%) and equals Android's largest system font scale.
 *  Fragile fixed-geometry elements take a lower per-call cap (FONT_CAP in
 *  lib/layoutForFontScale.ts); a call site passing its own
 *  maxFontSizeMultiplier always wins over this cap. The value lives in
 *  layoutForFontScale.ts so tests can import it without react-native. */
export { MAX_FONT_SCALE };

/* RN 0.86 + React 19: Text/TextInput are plain function components, so the old
 * `Text.defaultProps.maxFontSizeMultiplier` global is silently ignored. And
 * with Expo SDK 57 Metro compiles RN's ESM sources with experimentalImportSupport,
 * which makes deep-module exports getter-only: assigning `mod.default = wrapper`
 * throws "Cannot assign to property 'default'" at startup. The public
 * `react-native` entry is still a CJS object literal with configurable getters,
 * so the swap happens there instead. Must run from the app entry (index.js)
 * BEFORE anything captures the components - in particular before nativewind's
 * css-interop registers the Text/TextInput identities, otherwise className
 * styling would stop matching the wrapped components. RN-internal consumers
 * import Text via relative paths and stay uncapped; the app only renders text
 * through the public entry. */
const RN = require("react-native") as Record<string, unknown>;

function capFontScale(name: "Text" | "TextInput"): void {
  const Base = RN[name] as React.ComponentType<Record<string, unknown>> & {
    displayName?: string;
    __fontScaleCapped?: boolean;
  };
  if (Base.__fontScaleCapped) return;
  const useWindowDimensions = RN.useWindowDimensions as () => { fontScale: number };
  const render = (rawProps: Record<string, unknown>) => {
    // Text only: a TextInput keeps its own line/shrink props (single-line
    // fields must stay single-line at any size).
    const { fontScale } = useWindowDimensions();
    const props =
      name === "Text"
        ? (relaxTextProps(rawProps, fontScale) as Record<string, unknown>)
        : rawProps;
    // The key is the live-change fix (B6): when the OS text size changes while
    // the app runs, a Text whose props stay identical is not re-cloned, so
    // Fabric keeps its measured frame from the old size while the glyphs are
    // drawn at the new one (clipped titles, "In ra", ring "10"). A new key
    // makes the host node new, which is always measured at the current scale.
    // Constant at a steady size, so nothing remounts otherwise.
    return ReactRuntime.createElement(Base, {
      ...props,
      key: name === "Text" ? fontScale : undefined,
      maxFontSizeMultiplier: props.maxFontSizeMultiplier ?? MAX_FONT_SCALE,
    });
  };
  const Wrapped = Object.assign(render, Base, {
    displayName: Base.displayName ?? name,
    __fontScaleCapped: true,
  });
  Object.defineProperty(RN, name, {
    configurable: true,
    enumerable: true,
    get: () => Wrapped,
  });
}

capFontScale("Text");
capFontScale("TextInput");
