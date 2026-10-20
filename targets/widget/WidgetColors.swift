import SwiftUI
import UIKit
import WidgetKit

// The single place that names the Assets.xcassets colour sets. Each set carries
// a light and a dark value (generated from expo-target.config.js `colors`), so
// the system appearance picks the right one.
enum WidgetPalette {
  static let background = Color("WidgetBackground")
  static let surface = Color("WidgetSurface")
  static let ink = Color("WidgetTextPrimary")
  static let muted = Color("WidgetTextSecondary")
  static let accent = Color("WidgetAccent")
  static let accentFill = Color("WidgetAccentFill")
  static let low = Color("WidgetGlucoseLow")
  static let target = Color("WidgetGlucoseNormal")
  static let high = Color("WidgetGlucoseElevated")
  static let wellAbove = Color("WidgetGlucoseHigh")
  static let veryHigh = Color("WidgetGlucoseVeryHigh")
  static let violet = Color("WidgetViolet")
  static let warning = Color("WidgetWarning")

  // The Live Activity's brand turquoise (the app's accentFill family). The lock
  // screen card follows the system appearance: #087089 on the light card,
  // #22c7e0 on the dark one.
  static let activityAccent = Color("ActivityAccent")

  // The Dynamic Island is always black, so its tones stay fixed dark values.
  // Same #22c7e0 as ActivityAccent's dark value (10.3:1 on #000000).
  static let islandAccent = Color(red: 0.1333, green: 0.7804, blue: 0.8784) // #22c7e0
  static let islandInk = Color(red: 0.9176, green: 0.9647, blue: 0.9804)   // #eaf6fa
  static let islandMuted = Color(red: 0.5373, green: 0.6392, blue: 0.6902) // #89a3b0

  /// Resolves a colour set for an explicit scheme. For the few modifiers that
  /// take a Color value (activityBackgroundTint) and so never see the SwiftUI
  /// environment override that WidgetThemed applies to views.
  static func resolved(_ name: String, scheme: ColorScheme) -> Color {
    guard let base = UIColor(named: name) else { return Color(name) }
    let style: UIUserInterfaceStyle = scheme == .dark ? .dark : .light
    return Color(base.resolvedColor(with: UITraitCollection(userInterfaceStyle: style)))
  }
}

// The in-app appearance choice ("light" | "dark" | "system"), written by the app
// into the App Group under this key (lib/services/widgetTheme.ts). Widgets and
// the Live Activity follow it instead of the system appearance; "system" or a
// missing value falls back to the system. Mirrored by effectiveWidgetScheme in
// lib/theme/widgetTheme.ts.
enum WidgetThemePreference {
  static let key = "themePreference"

  static func read() -> String? {
    UserDefaults(suiteName: LiveDataStore.appGroup)?.string(forKey: key)
  }

  static func effective(system: ColorScheme) -> ColorScheme {
    switch read() {
    case "light": return .light
    case "dark": return .dark
    default: return system
    }
  }
}

/// Re-points every colour set inside the view at the effective scheme. The
/// lock-screen accessory families are left alone: iOS draws them in its own
/// vibrant material, always against the wallpaper, so a forced light ink would
/// vanish there.
struct WidgetThemed: ViewModifier {
  @Environment(\.colorScheme) private var system
  @Environment(\.widgetFamily) private var family

  @ViewBuilder
  func body(content: Content) -> some View {
    switch family {
    case .accessoryRectangular, .accessoryInline, .accessoryCircular:
      content
    default:
      content.environment(\.colorScheme, WidgetThemePreference.effective(system: system))
    }
  }
}

extension View {
  func widgetThemed() -> some View {
    modifier(WidgetThemed())
  }
}

/// The widget ground as a view, so it resolves against the effective scheme.
struct WidgetBackdrop: View {
  var body: some View {
    WidgetPalette.background.widgetThemed()
  }
}
