import SwiftUI

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
}
