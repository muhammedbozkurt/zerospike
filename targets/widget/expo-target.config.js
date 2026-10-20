/**
 * The iOS widget extension: a small home-screen widget plus the post-meal Live
 * Activity. Both read the SAME LiveData JSON the app writes to the App Group
 * (see lib/services/liveData.ts), so the phone, the lock screen and the home
 * screen can never disagree about the last reading or the next reminder.
 *
 * Building this target is a HUMAN step (`npx expo prebuild` + a device build);
 * the Swift here is compiled by Xcode, not by the app's tsc gate.
 */
// The target name MUST differ from the main app target ("zerospike"); a same
// name collides in Xcode's build graph (duplicate outputs in zerospike.build).
module.exports = {
  type: "widget",
  name: "ZerospikeWidget",
  icon: "../../assets/brand/icon-1024.png",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.greeneyeapp.zerospike"],
  },
  deploymentTarget: "16.4",
  colors: {
    WidgetBackground: { light: "#f5efe6", dark: "#080e14" },
    WidgetAccent: { light: "#087089", dark: "#2ee6ff" },
    WidgetSurface: { light: "#ffffff", dark: "#16232e" },
    WidgetTextPrimary: { light: "#0f2230", dark: "#eaf6fa" },
    WidgetTextSecondary: { light: "#4a5d68", dark: "#89a3b0" },
    ActivityAccent: { light: "#087089", dark: "#22c7e0" },
    WidgetAccentFill:{ light: "#0e9bb8", dark: "#2ee6ff" },
    WidgetGlucoseLow: { light: "#c42a44", dark: "#ff5468" },
    WidgetGlucoseNormal: { light: "#0f6f4c", dark: "#22e39a" },
    WidgetGlucoseElevated: { light: "#8a5f00", dark: "#ffd23f" },
    WidgetGlucoseHigh: { light: "#a84f00", dark: "#ffa02a" },
    WidgetGlucoseVeryHigh: { light: "#b03a0a", dark: "#ff8a00" },
    WidgetViolet: { light: "#5b3fe0", dark: "#7c5cff" },
    WidgetWarning: { light: "#8f5f00", dark: "#ffa02a" },
  },
};
