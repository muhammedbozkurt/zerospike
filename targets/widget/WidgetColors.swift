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

  // The Dynamic Island is always black, so its tones stay fixed dark values.
  static let islandAccent = Color(red: 0.1804, green: 0.9020, blue: 1.0)   // #2ee6ff
  static let islandInk = Color(red: 0.9176, green: 0.9647, blue: 0.9804)   // #eaf6fa
  static let islandMuted = Color(red: 0.5373, green: 0.6392, blue: 0.6902) // #89a3b0
}
