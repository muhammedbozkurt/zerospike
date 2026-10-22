import AsyncStorage from "@react-native-async-storage/async-storage";
import { vars } from "nativewind";
import React, {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, StyleSheet, useColorScheme, View } from "react-native";
import { Appearance } from "react-native";
import * as SystemUI from "expo-system-ui";

import { isScreenshotMode } from "../screenshotMode";
import { publishWidgetThemePref } from "../services/widgetTheme";
import {
  loadThemePref,
  resolveScheme,
  saveThemePref,
  type ThemePref,
} from "./themePref";
import {
  acquireRemountLock,
  heldScheme,
  isRemountLocked,
  subscribeRemountLock,
} from "./remountLock";
import { nativeSchemeOverride } from "./themePref";
import { useHighContrast } from "./useHighContrast";
import {
  PALETTES,
  THEME,
  activePalette,
  setActiveScheme,
  setHighContrast,
  type Palette,
  type Scheme,
  type Theme,
} from "./tokens";

interface ThemeContextValue {
  scheme: Scheme;
  /** System Increase Contrast / high contrast text is on: tokens are the stronger variant. */
  highContrast: boolean;
  pref: ThemePref;
  setPref: (next: ThemePref) => Promise<void>;
  /** The live token object: same reference as the static THEME export. */
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const FADE_IN_MS = 120;
const FADE_OUT_MS = 160;

function channels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** CSS variables behind the tailwind colors (tailwind.config.js). Opaque colors
 *  are space-separated channels so `/opacity` modifiers work; the translucent
 *  glass/hair tokens are whole colors. */
function cssVars(p: Palette) {
  return vars({
    "--c-brand": channels(p.accentFill),
    "--c-brandDark": channels(p.accentPressed),
    "--c-onAccent": channels(p.accentOnFill),
    "--c-dangerFill": channels(p.dangerFill),
    "--c-onDanger": channels(p.onDanger),
    "--c-ink": channels(p.text),
    "--c-mut": channels(p.textMuted),
    "--c-low": channels(p.glucose.low),
    "--c-normal": channels(p.glucose.normal),
    "--c-elevated": channels(p.glucose.elevated),
    "--c-high": channels(p.glucose.high),
    "--c-veryHigh": channels(p.glucose.veryHigh),
    "--c-glass": p.surface,
    "--c-hair": p.border,
    "--c-sheet": p.surfaceRaised,
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref | null>(null);
  const system = useColorScheme();
  const [coverColor, setCoverColor] = useState<string | null>(null);
  const coverOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    const forced: ThemePref | null = isScreenshotMode()
      ? process.env.EXPO_PUBLIC_SHOTS_THEME === "dark"
        ? "dark"
        : "light"
      : null;
    void loadThemePref(AsyncStorage, forced).then((p) => {
      if (alive) setPrefState(p);
      if (!forced) void publishWidgetThemePref(p, { onlyIfChanged: true });
    });
    return () => {
      alive = false;
    };
  }, []);

  const [, bumpLock] = useState(0);
  useEffect(() => subscribeRemountLock(() => bumpLock((n) => n + 1)), []);
  const appliedRef = useRef<Scheme | null>(null);
  const scheme: Scheme = heldScheme(
    resolveScheme(pref ?? "dark", system),
    appliedRef.current,
    isRemountLocked(),
  );
  appliedRef.current = scheme;
  // Set during render, before any child reads a token: the first paint of the
  // routed tree must already see the right palette.
  setActiveScheme(scheme);
  const highContrast = useHighContrast();
  setHighContrast(highContrast);

  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const systemRef = useRef(system);
  systemRef.current = system;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(PALETTES[scheme].bg).catch(() => {});
  }, [scheme]);

  // The keyboard, native pickers and Alert follow the OS appearance, not the
  // app's: pin it to the saved choice, hand it back to the OS for "system".
  useEffect(() => {
    if (pref !== null) Appearance.setColorScheme(nativeSchemeOverride(pref));
  }, [pref]);

  const setPref = useCallback(
    async (next: ThemePref) => {
      await saveThemePref(AsyncStorage, next);
      void publishWidgetThemePref(next);
      // Release the pin first: while a scheme is forced, useColorScheme reports
      // the forced value, not the OS one.
      Appearance.setColorScheme(nativeSchemeOverride(next));
      const target = resolveScheme(
        next,
        next === "system" ? Appearance.getColorScheme() : systemRef.current,
      );
      if (target === schemeRef.current) {
        setPrefState(next);
        return;
      }
      // The routed tree remounts on a scheme change; a short cover in the new
      // background color hides the swap.
      setCoverColor(PALETTES[target].bg);
      coverOpacity.setValue(0);
      await new Promise<void>((resolve) =>
        Animated.timing(coverOpacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          useNativeDriver: true,
        }).start(() => resolve()),
      );
      setPrefState(next);
      requestAnimationFrame(() => {
        Animated.timing(coverOpacity, {
          toValue: 0,
          duration: FADE_OUT_MS,
          useNativeDriver: true,
        }).start(() => setCoverColor(null));
      });
    },
    [coverOpacity],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ scheme, highContrast, pref: pref ?? "dark", setPref, theme: THEME }),
    [scheme, highContrast, pref, setPref],
  );

  if (pref === null) return null;

  return (
    <ThemeContext.Provider value={value}>
      <View style={[styles.root, cssVars(activePalette())]}>
        {children}
        {coverColor ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: coverColor, opacity: coverOpacity, zIndex: 100 },
            ]}
          />
        ) : null}
      </View>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** Holds an OS-driven scheme change while the calling screen is mounted, so a
 *  remount cannot wipe its state (plan choice, purchase in flight). */
export function useThemeRemountLock(): void {
  useEffect(() => acquireRemountLock(), []);
}

/** Remounts its subtree when the resolved scheme changes, so every module that
 *  read a token at render re-reads it. Place it BELOW AppProvider so app state
 *  survives. */
export function ThemeRemount({ children }: { children: React.ReactNode }) {
  const { scheme, highContrast } = useTheme();
  return <Fragment key={highContrast ? `${scheme}-hc` : scheme}>{children}</Fragment>;
}
