import Foundation

/// Every deep link the iOS widget extension can open, in ONE place (2.3.0's
/// K2-B). The strings are byte-identical to the JS side's own list in
/// lib/services/androidWidget.ts (URI_ADD_GLUCOSE ... URI_ADD_MED) and are
/// resolved by expo-router against the "zerospike" scheme registered in
/// app.json; app/(tabs)/index.tsx is what reads the `sheet` parameter.
///
/// Before this, the same six URLs were retyped as literals across QuickAdd,
/// the main widget and the Live Activity, which is how the Live Activity ended
/// up with no link at all and the main widget with one that disagreed with its
/// own accessory families.
enum DeepLinks {
  /// The plain app-open link. Nothing points at it since the main widget's tap
  /// became a logging shortcut; kept because it is the scheme's own root and
  /// the fallback any future surface would reach for.
  static let dashboard = URL(string: "zerospike:///")!
  static let addGlucose = URL(string: "zerospike:///?sheet=glucose")!
  static let addMeal = URL(string: "zerospike:///food")!
  /// The injection tab's BODY MAP, not its compose form. A widget tap arrives
  /// with no site chosen, and the map is where that choice is made; dropping
  /// someone straight into the dose field asks them to answer the second
  /// question before the first. `?compose=1` still exists and is what the
  /// dashboard's own quick-add uses, where the site question is already behind
  /// the user. `segment` is a parameter the screen already answers.
  static let addInjection = URL(string: "zerospike:///injection?segment=map")!
  static let addMed = URL(string: "zerospike:///?sheet=med")!
  /// The reminders screen (Settings > My reminders), where an upcoming
  /// reminder can actually be changed. Resolved by expo-router against the
  /// same route the in-app "next reminder" line pushes.
  static let reminders = URL(string: "zerospike:///settings/reminders")!
  /// The post-meal reading sheet - the same target the post-meal notification
  /// routes to (NotificationRoute "postMeal" in app/_layout.tsx).
  static let postMeal2h = URL(string: "zerospike:///?sheet=post_meal_2h")!
  /// The dashboard's post-meal countdown START surface.
  ///
  /// The widget deliberately does NOT arm a timer of its own. The app owns the
  /// duration picker and the "a countdown is already running" confirmation, and
  /// a tile that silently started a window would bypass both - so this link
  /// opens the surface and the user confirms there, exactly as they do in-app.
  static let startPostMeal = URL(string: "zerospike:///?sheet=post_meal_start")!
}
