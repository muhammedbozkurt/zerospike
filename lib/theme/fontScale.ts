import type * as React from "react";

/* Named so nativewind's babel plugin does not rewrite `React.createElement`
 * into createInteropElement, which would drag the css-interop runtime into the
 * app entry before react-native itself loads. */
const ReactRuntime = require("react") as typeof React;

/** App-wide cap on the OS accessibility text-size multiplier, so a very large
 *  system font setting scales the UI up moderately instead of blowing fixed
 *  rows and headers apart. A call site passing its own maxFontSizeMultiplier
 *  still wins over the cap. */
export const MAX_FONT_SCALE = 1.3;

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
  const render = (props: Record<string, unknown>) =>
    ReactRuntime.createElement(Base, {
      ...props,
      maxFontSizeMultiplier: props.maxFontSizeMultiplier ?? MAX_FONT_SCALE,
    });
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
