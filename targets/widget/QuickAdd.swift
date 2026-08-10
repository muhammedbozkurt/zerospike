import SwiftUI
import WidgetKit

// The Quick Add widget: three shortcuts straight into the app's own logging
// flows (a glucose reading, a meal, an injection), each a deep link the app
// resolves. Purely navigational, same scope as every other glanceable surface:
// nothing here measures, interprets or advises.
//
// Each shortcut carries its own identity colour from the Midnight Monitor
// palette (cyan for glucose, mint for a meal, violet for an injection). The tile
// is a low-opacity wash of that colour plus a hairline of the same hue, so the
// three targets are told apart before the label is read - rather than the flat
// white-6% grey they used to share.
//
// Labels arrive pre-localized in the shared snapshot (lib/services/liveData.ts,
// widget.addGlucose / addMeal / addInjection); the literals below are gallery
// fallbacks for a device where the app has not written a snapshot yet, same
// policy as the hard-coded complication description.

private enum QuickAddPalette {
  static let ink = Color(red: 0.9176, green: 0.9647, blue: 0.9804)       // #eaf6fa
  static let muted = Color(red: 0.5373, green: 0.6392, blue: 0.6902)     // #89a3b0
  /// Per-shortcut identity hues, straight from lib/theme/tokens.ts.
  static let glucose = Color(red: 0.1804, green: 0.9020, blue: 1.0)      // #2ee6ff accent
  static let meal = Color(red: 0.1333, green: 0.8902, blue: 0.6039)      // #22e39a target mint
  static let injection = Color(red: 0.4863, green: 0.3608, blue: 1.0)    // #7c5cff violet

  /// One place for the tile treatment, so all four tiles stay in step.
  static let tileFillOpacity = 0.16
  static let tileStrokeOpacity = 0.34
  static let badgeFillOpacity = 0.20
}

struct QuickAddShortcut: Identifiable {
  let id: String
  let icon: String
  let label: String
  let tint: Color
  let url: URL?
}

struct QuickAddEntry: TimelineEntry {
  let date: Date
  let labels: LiveData.Labels?

  /// The three logging flows, in the order they are used. The first one is the
  /// primary: it gets the large tile on medium and the whole widget on small.
  ///
  /// URLs are exactly the ones the app already answers: `?sheet=glucose` opens
  /// the dashboard's glucose sheet, `/food` the food tab, `/injection?compose=1`
  /// the injection tab's compose segment. No new parameters are invented here.
  var shortcuts: [QuickAddShortcut] {
    [
      QuickAddShortcut(
        id: "glucose",
        icon: "drop.fill",
        label: labels?.addGlucose ?? "Glucose",
        tint: QuickAddPalette.glucose,
        url: URL(string: "zerospike:///?sheet=glucose")
      ),
      QuickAddShortcut(
        id: "meal",
        icon: "fork.knife",
        label: labels?.addMeal ?? "Meal",
        tint: QuickAddPalette.meal,
        url: URL(string: "zerospike:///food")
      ),
      QuickAddShortcut(
        id: "injection",
        icon: "syringe.fill",
        label: labels?.addInjection ?? "Injection",
        tint: QuickAddPalette.injection,
        url: URL(string: "zerospike:///injection?compose=1")
      ),
    ]
  }
}

struct QuickAddProvider: TimelineProvider {
  func placeholder(in context: Context) -> QuickAddEntry {
    QuickAddEntry(date: Date(), labels: LiveDataStore.read()?.labels)
  }

  func getSnapshot(in context: Context, completion: @escaping (QuickAddEntry) -> Void) {
    completion(QuickAddEntry(date: Date(), labels: LiveDataStore.read()?.labels))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QuickAddEntry>) -> Void) {
    // Nothing here is time-dependent; the app reloads every widget timeline
    // whenever it rewrites the snapshot (data or language change).
    let entry = QuickAddEntry(date: Date(), labels: LiveDataStore.read()?.labels)
    completion(Timeline(entries: [entry], policy: .never))
  }
}

struct QuickAddWidgetView: View {
  @Environment(\.widgetFamily) private var family
  var entry: QuickAddEntry

  private var eyebrow: String {
    entry.labels?.quickAdd ?? "Quick add"
  }

  var body: some View {
    switch family {
    case .systemMedium:
      mediumView
    default:
      smallView
    }
  }

  /// Small: the primary shortcut (glucose) as one full-bleed identity tile, with
  /// the whole widget as the tap target.
  private var smallView: some View {
    let shortcut = entry.shortcuts[0]
    return VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 0) {
        iconBadge(shortcut.icon, tint: shortcut.tint, size: 40, corner: 13, glyph: 18)
        Spacer(minLength: 0)
        Image(systemName: "plus")
          .font(.system(size: 14, weight: .heavy))
          .foregroundColor(shortcut.tint)
      }

      Spacer(minLength: 8)

      Text(eyebrow)
        .font(.system(size: 9, weight: .bold))
        .foregroundColor(QuickAddPalette.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)

      Text(shortcut.label)
        .font(.system(size: 14, weight: .semibold))
        .foregroundColor(QuickAddPalette.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.7)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background { tileFill(shortcut.tint, corner: 20) }
    .overlay { tileStroke(shortcut.tint, corner: 20) }
    .padding(4)
    .widgetURL(shortcut.url)
  }

  /// Medium: the primary tile on the left, the two secondary flows stacked on
  /// the right. Each is its own Link target.
  private var mediumView: some View {
    let items = entry.shortcuts
    return VStack(alignment: .leading, spacing: 6) {
      Text(eyebrow)
        .font(.system(size: 9, weight: .bold))
        .foregroundColor(QuickAddPalette.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.leading, 2)

      HStack(spacing: 8) {
        linked(items[0]) { primaryTile(items[0]) }
        VStack(spacing: 8) {
          linked(items[1]) { rowTile(items[1]) }
          linked(items[2]) { rowTile(items[2]) }
        }
      }
    }
    .padding(8)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  /// The primary (first) shortcut, raised: bigger badge, a visible "+" and room
  /// for a two-line label.
  private func primaryTile(_ shortcut: QuickAddShortcut) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 0) {
        iconBadge(shortcut.icon, tint: shortcut.tint, size: 34, corner: 11, glyph: 16)
        Spacer(minLength: 0)
        Image(systemName: "plus")
          .font(.system(size: 13, weight: .heavy))
          .foregroundColor(shortcut.tint)
      }

      Spacer(minLength: 6)

      Text(shortcut.label)
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(QuickAddPalette.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.65)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background { tileFill(shortcut.tint, corner: 18) }
    .overlay { tileStroke(shortcut.tint, corner: 18) }
  }

  /// A secondary shortcut: badge and label on one line, "+" trailing.
  private func rowTile(_ shortcut: QuickAddShortcut) -> some View {
    HStack(spacing: 8) {
      iconBadge(shortcut.icon, tint: shortcut.tint, size: 28, corner: 9, glyph: 13)

      Text(shortcut.label)
        .font(.system(size: 12, weight: .semibold))
        .foregroundColor(QuickAddPalette.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.6)
        .fixedSize(horizontal: false, vertical: true)

      Spacer(minLength: 4)

      Image(systemName: "plus")
        .font(.system(size: 11, weight: .heavy))
        .foregroundColor(shortcut.tint)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background { tileFill(shortcut.tint, corner: 16) }
    .overlay { tileStroke(shortcut.tint, corner: 16) }
  }

  /// Wraps a tile in its deep link when it has one (Link works on medium; the
  /// small family uses widgetURL instead).
  @ViewBuilder
  private func linked<Content: View>(
    _ shortcut: QuickAddShortcut,
    @ViewBuilder content: () -> Content
  ) -> some View {
    if let url = shortcut.url {
      Link(destination: url) { content() }
    } else {
      content()
    }
  }

  private func iconBadge(
    _ name: String,
    tint: Color,
    size: CGFloat,
    corner: CGFloat,
    glyph: CGFloat
  ) -> some View {
    ZStack {
      RoundedRectangle(cornerRadius: corner, style: .continuous)
        .fill(tint.opacity(QuickAddPalette.badgeFillOpacity))
      Image(systemName: name)
        .font(.system(size: glyph, weight: .semibold))
        .foregroundColor(tint)
    }
    .frame(width: size, height: size)
  }

  private func tileFill(_ tint: Color, corner: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: corner, style: .continuous)
      .fill(tint.opacity(QuickAddPalette.tileFillOpacity))
  }

  private func tileStroke(_ tint: Color, corner: CGFloat) -> some View {
    RoundedRectangle(cornerRadius: corner, style: .continuous)
      .strokeBorder(tint.opacity(QuickAddPalette.tileStrokeOpacity), lineWidth: 1)
  }
}

struct ZerospikeQuickAddWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ZerospikeQuickAdd", provider: QuickAddProvider()) { entry in
      if #available(iOS 17.0, *) {
        QuickAddWidgetView(entry: entry)
          .containerBackground(for: .widget) { Color("WidgetBackground") }
      } else {
        QuickAddWidgetView(entry: entry)
          .background(Color("WidgetBackground"))
      }
    }
    // Gallery-only strings, English for every user: the extension bundle carries
    // no localization catalog (see the note on ZerospikeWidget in index.swift).
    // The shortcut labels drawn on the tiles ARE localized - they ride in on the
    // app's snapshot. Purely navigational wording; nothing here claims to measure.
    .configurationDisplayName("Quick add")
    .description("Open a glucose, meal or injection entry in one tap.")
    .supportedFamilies([.systemSmall, .systemMedium])
    .containerBackgroundRemovable(false)
  }
}
