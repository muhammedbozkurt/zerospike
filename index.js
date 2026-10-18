import { Platform } from "react-native";

// Global font-scale cap (maxFontSizeMultiplier). Must run before expo-router
// boots and before nativewind registers Text/TextInput; see the module itself.
require("./lib/theme/fontScale");

/**
 * App entry.
 *
 * The only reason this file exists instead of pointing `main` straight at
 * expo-router/entry: the Android home-screen widget is rendered by JS in a
 * headless task, and Android needs that task handler registered BEFORE the
 * router boots. Everything else is expo-router's normal entry.
 *
 * Guarded and lazily imported so a build without the native widget module (Expo
 * Go, or anything before `npx expo prebuild`) still starts normally.
 */
if (Platform.OS === "android") {
  try {
    const {
      registerWidgetTaskHandler,
    } = require("react-native-android-widget");
    const { widgetTaskHandler } = require("./lib/services/androidWidget");
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch {
    // No widget module linked yet; the app runs without a home-screen widget.
  }
}

try {
  require("./lib/services/healthBackground");
} catch {
  // Background health sync unavailable; the app starts without it.
}

require("expo-router/entry");
