import { isThemePref, resolveScheme, THEME_PREF_KEY, type ThemePref } from "../theme/themePref";
import type { Scheme } from "../theme/tokens";
import { WIDGET_DARK, WIDGET_LIGHT, type WidgetPalette } from "./widgetColors";

/** App Group key the iOS widget extension and Live Activity read ("light" |
 *  "dark" | "system"). Must equal WidgetThemePreference.key in
 *  targets/widget/WidgetColors.swift (scripts/widgetTheme.test.ts pins it). */
export const WIDGET_THEME_KEY = "themePreference";
const APP_GROUP = "group.com.greeneyeapp.zerospike";

/** The scheme a widget draws in. "system" defers to the OS, exactly like the
 *  app itself, so the widget and the app agree whenever the user has not
 *  pinned an appearance. */
export function effectiveWidgetScheme(
  pref: ThemePref,
  system: string | null | undefined,
): Scheme {
  return resolveScheme(pref, system);
}

/** The two trees react-native-android-widget wants ({light, dark} follow the
 *  SYSTEM ground). A pinned preference sends the same palette down both, so the
 *  system ground cannot override it; "system" keeps the natural pairing. */
export function widgetPalettes(pref: ThemePref): { light: WidgetPalette; dark: WidgetPalette } {
  if (pref === "light") return { light: WIDGET_LIGHT, dark: WIDGET_LIGHT };
  if (pref === "dark") return { light: WIDGET_DARK, dark: WIDGET_DARK };
  return { light: WIDGET_LIGHT, dark: WIDGET_DARK };
}

export interface PrefReader {
  getItem(key: string): Promise<string | null>;
}

/** Android widgets render in the app's own JS context, so they read the same
 *  AsyncStorage entry the Settings screen writes; one source, nothing to drift.
 *  A missing or unknown value follows the system. */
export async function readWidgetThemePref(store: PrefReader): Promise<ThemePref> {
  try {
    const raw = await store.getItem(THEME_PREF_KEY);
    return isThemePref(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export interface WidgetThemeSink {
  get(key: string): string | null;
  set(key: string, value: string): void;
  reload(): void;
}

export interface WidgetThemeDeps {
  platform: string;
  /** iOS: the App Group UserDefaults. Rejects/returns null when the native
   *  module is absent (Expo Go, pre-prebuild). */
  openAppGroup: () => Promise<WidgetThemeSink | null>;
  /** Android: redraw every placed widget with the new preference. */
  refreshAndroid: (pref: ThemePref) => Promise<void>;
}

async function nativeDeps(): Promise<WidgetThemeDeps> {
  const { Platform } = await import("react-native");
  return {
    platform: Platform.OS,
    ...nativeSinks,
  };
}

const nativeSinks: Omit<WidgetThemeDeps, "platform"> = {
  openAppGroup: async () => {
    const { ExtensionStorage } = await import("@bacons/apple-targets");
    const storage = new ExtensionStorage(APP_GROUP);
    return {
      get: (key) => storage.get(key),
      set: (key, value) => storage.set(key, value),
      reload: () => ExtensionStorage.reloadWidget(),
    };
  },
  refreshAndroid: async (pref) => {
    const [{ refreshAndroidWidgets }, { readLiveData }] = await Promise.all([
      import("./androidWidget"),
      import("./liveData"),
    ]);
    await refreshAndroidWidgets(await readLiveData(), pref);
  },
};

/**
 * Pushes the in-app appearance choice to the native widgets.
 * iOS: writes "themePreference" into the App Group and rebuilds the widget
 * timelines (a running Live Activity picks it up on its next render).
 * Android: redraws the placed widgets, which read the choice at render time.
 *
 * `onlyIfChanged` is for app start: iOS skips the reload when the stored value
 * already matches, Android skips entirely (syncLiveData redraws it anyway).
 * Never throws: a missing native module must not break the Settings screen.
 */
export async function publishWidgetThemePref(
  pref: ThemePref,
  opts: { onlyIfChanged?: boolean } = {},
  deps?: WidgetThemeDeps,
): Promise<void> {
  try {
    const d = deps ?? (await nativeDeps());
    if (d.platform === "ios") {
      const sink = await d.openAppGroup();
      if (!sink) return;
      if (opts.onlyIfChanged && sink.get(WIDGET_THEME_KEY) === pref) return;
      sink.set(WIDGET_THEME_KEY, pref);
      sink.reload();
      return;
    }
    if (d.platform === "android" && !opts.onlyIfChanged) {
      await d.refreshAndroid(pref);
    }
  } catch {
    // Expo Go / no widget placed: nothing to update.
  }
}
