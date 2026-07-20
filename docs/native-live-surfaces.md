# Live surfaces: notifications, Live Activity, widget, Apple Watch

R5 native-surface architecture and the HUMAN steps to finish it. The JS/shared-data
layer is built and gate-green; the native targets below are prebuild-only work that
cannot be compiled or verified in this environment.

## One data source

Every glanceable surface shows the same two things: **the next reminder's target
time** and **the last glucose reading (value + when)**. That snapshot is computed in
one place - `lib/services/liveData.ts` - and written to shared storage. No surface
recomputes or reinterprets; each just renders the JSON. Nothing here is medical
advice: it reflects only what the user already logged.

### Shared contract

- App Group / shared-prefs id: `group.com.greeneyeapp.zerospike` (`LIVE_DATA_APP_GROUP`)
- Key: `zerospike.liveData` (`LIVE_DATA_KEY`)
- Value: JSON of `LiveData`:

```jsonc
{
  "updatedAt": 1753000000000,      // epoch ms of this snapshot
  "unit": "mgdl",                  // "mgdl" | "mmol"
  "lastGlucoseMgdl": 124,          // number | null (always stored mg/dL)
  "lastGlucoseAt": 1752990000000,  // epoch ms | null
  "nextReminderAt": 1753003600000, // epoch ms | null
  "nextReminderKind": "postMeal"   // "postMeal" | "basal" | "glucose" | null
}
```

RN writes it (`syncLiveData`), native reads it. Countdowns are rendered natively from
`nextReminderAt` (`Text(timerInterval:)` on iOS, `RelativeDateTimeFormatter` /
chronometer on Android/Watch) so they tick without waking JS. Glucose colors come from
the single language in `lib/theme/tokens.ts` (`GLUCOSE_COLORS`): low `#ef4444`, normal
`#10b981`, elevated `#f59e0b`, high `#f97316` - mirror these hex values in the native
asset catalogs so every surface matches the app.

### The native write seam (do this first)

`syncLiveData` currently persists to AsyncStorage. AsyncStorage is NOT visible to app
extensions, so the native surfaces need the same JSON in the App Group. Wire it once
`@bacons/apple-targets` is installed:

```ts
// inside syncLiveData, after AsyncStorage.setItem:
import { ExtensionStorage } from "@bacons/apple-targets";
const storage = new ExtensionStorage(LIVE_DATA_APP_GROUP);
storage.set(LIVE_DATA_KEY, json);
ExtensionStorage.reloadWidget();               // refresh widget timelines
```

Android: write the same JSON to the widget's `SharedPreferences` (or a
`react-native-android-widget` data call) and trigger a widget update.

## Notifications (7a) - status

Done in JS and gate-green:
- iOS **Time-Sensitive** interruption level on the four actionable reminders
  (post-meal, night basal, glucose, low-reading follow-up) - breaks Focus/silent,
  surfaces prominently. Weekly summary and the trial nudge stay standard.
- Android reminders already use a **HIGH-importance** channel.
- **Critical Alerts are intentionally NOT used** (no
  `com.apple.developer.usernotifications.critical` entitlement) - that carries
  medical-device risk. Reminder text stays neutral ("measurement time"), never
  "danger/alarm/intervene".

HUMAN step (7a): add the Time-Sensitive entitlement so iOS actually breaks Focus
(without it, iOS silently downgrades to `active`, so the JS is already safe):
`ios.entitlements["com.apple.developer.usernotifications.time-sensitive"] = true`
in `app.json`, then prebuild.

Deferred (specced, not yet built): the opt-in **"Persistent reminders"** toggle
(a separate louder Android channel + ongoing notification). Adds one
`NotificationPrefs.persistentReminders` flag, a Settings switch (+5 i18n keys), and a
dedicated Android channel. No iOS-side change beyond Time-Sensitive.

## 7b - iOS Live Activity + Dynamic Island

- `ActivityKit` activity started when a post-meal timer begins; ended when it fires or
  is cleared. Attributes carry `nextReminderAt` + last glucose; the countdown uses
  `Text(timerInterval:)` so it ticks natively.
- Lock screen: remaining time + last glucose. Dynamic Island compact: time left;
  expanded: time left + last glucose. Visual only, no interpretation.
- Target created by `@bacons/apple-targets` (`widget`/`activity` target type).

## 8 - Home widget

- iOS WidgetKit **small**: time left to the next reminder (live) + last glucose. Tap →
  app. Timeline reloaded on `syncLiveData` via `ExtensionStorage.reloadWidget()`.
- Android `react-native-android-widget`: target hour + last glucose.

## 9 - Apple Watch

- SwiftUI watch target: wrist glucose quick-log, active-timer countdown, recent
  readings. Complication: next-reminder countdown + last glucose. Data via App Group /
  `WatchConnectivity`. Watch strings via system localization (`.strings`).

## HUMAN steps (native, cannot be done or verified here)

1. `npm i @bacons/apple-targets react-native-android-widget` (+ `patch-package` if needed).
2. Add the `@bacons/apple-targets` config plugin to `app.json` and create the target
   folders (Live Activity/widget extension, Watch app) with their Swift sources +
   `expo-target.config.js`. Wire the App Group write seam in `syncLiveData` (above).
3. **Apple Developer portal**: App Group `group.com.greeneyeapp.zerospike`; enable the
   Live Activity capability; register the Watch app id + provisioning; Time-Sensitive
   entitlement; (Push only if remote Live Activity updates are added later).
4. `app.json`: App Group entitlement on the main app + each target;
   `NSSupportsLiveActivities = true`; Time-Sensitive entitlement.
5. **EAS credentials**: sync the new entitlements/provisioning profiles for the app +
   Watch + extension.
6. `npx expo prebuild --clean` then build on device (Simulator can't fully exercise
   Live Activity / complications).
7. Localize widget/LA/watch strings via native `.strings` (iOS) and Android resources.
8. Do NOT bump `app.json` version/build here - the release hub owns version bumps.
