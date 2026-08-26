import AppIntents
import SwiftUI
import WidgetKit

// iOS 18 Control Center controls: the same two shortcuts the small widgets
// offer, reachable from Control Centre, the Lock Screen's own control slots and
// the Action button.
//
// EVERYTHING in this file is behind `@available(iOS 18.0, *)`. The extension's
// deployment target stays 16.4 and is NOT raised for this: ControlWidget simply
// does not exist below 18, so the bundle adds these two entries inside an
// `if #available(iOS 18.0, *)` block (see index.swift) and every earlier iOS
// builds and runs exactly as it did.
//
// Same scope as every other surface here: a control OPENS an app screen through
// the shared deep link table and does nothing else. Neither of them writes an
// entry or arms a timer - the countdown control opens the app's own start
// surface so the duration picker and the "one is already running" confirmation
// still happen where the user can see them.
//
// The titles ride in on the app's snapshot, so they are localized in all nine
// languages the app ships. That is what the value provider below is for: a
// control's label is resolved when the system builds it, and reading the App
// Group through a provider is what lets the system pick up a language change.

/// The strings a control needs, lifted out of the shared snapshot.
@available(iOS 18.0, *)
struct ZerospikeControlLabels {
  let logGlucose: String
  let startCountdown: String

  /// The brand name in both slots: what a device with no snapshot yet shows
  /// (the app has never run, or this is the gallery preview). Never an English
  /// phrase - this extension owns no translations.
  static let fallback = ZerospikeControlLabels(
    logGlucose: "zerospike",
    startCountdown: "zerospike"
  )

  static func current() -> ZerospikeControlLabels {
    guard let labels = LiveDataStore.read()?.labels else { return .fallback }
    return ZerospikeControlLabels(
      logGlucose: labels.addGlucose ?? fallback.logGlucose,
      // Null while `dashboard.startCountdown` is still untranslated: the app
      // sends null rather than a raw i18n key (lib/services/liveData.ts).
      startCountdown: labels.startCountdown ?? fallback.startCountdown
    )
  }
}

@available(iOS 18.0, *)
struct ZerospikeControlLabelProvider: ControlValueProvider {
  var previewValue: ZerospikeControlLabels { ZerospikeControlLabels.current() }

  func currentValue() async throws -> ZerospikeControlLabels {
    ZerospikeControlLabels.current()
  }
}

@available(iOS 18.0, *)
struct ZerospikeLogGlucoseControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(
      kind: "ZerospikeLogGlucoseControl",
      provider: ZerospikeControlLabelProvider()
    ) { labels in
      // OpenURLIntent brings the app forward on the given deep link; the same
      // URL constant the glucose widget and QuickAdd's glucose tile use, so the
      // three cannot drift apart.
      ControlWidgetButton(action: OpenURLIntent(DeepLinks.addGlucose)) {
        // Text(String) is verbatim, which is what a snapshot-provided string
        // needs: a literal here would be looked up in a localization catalog
        // this bundle does not have.
        Label { Text(labels.logGlucose) } icon: { Image(systemName: "drop.fill") }
      }
    }
    // Gallery-only strings, English for every user, same policy as the widgets'
    // configurationDisplayName (see index.swift).
    .displayName("Log glucose")
    .description("Open a glucose entry in the zerospike journal.")
  }
}

@available(iOS 18.0, *)
struct ZerospikeStartTimerControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(
      kind: "ZerospikeStartTimerControl",
      provider: ZerospikeControlLabelProvider()
    ) { labels in
      // Opens the start surface rather than arming anything: see the file note.
      ControlWidgetButton(action: OpenURLIntent(DeepLinks.startPostMeal)) {
        Label { Text(labels.startCountdown) } icon: { Image(systemName: "timer") }
      }
    }
    .displayName("Post-meal countdown")
    .description("Open the post-meal countdown in zerospike.")
  }
}
