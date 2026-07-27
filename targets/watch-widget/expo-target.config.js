/**
 * R10 FAZ 3 (kill-switch): watch face complications (accessoryCircular +
 * accessoryRectangular) via WidgetKit. Shares the same App Group as
 * targets/watch so it reads the exact snapshot the watch app's
 * WCSessionDelegate wrote - it never talks to WatchConnectivity itself.
 *
 * appGroupsByDefault mirrors ios.entitlements automatically for this target
 * type, so no explicit entitlements block is needed here (see targets/watch's
 * config, which DOES need one - the "watch" app-product type does not get the
 * same default).
 */
module.exports = {
  type: "watch-widget",
  name: "ZerospikeComplications",
  bundleIdentifier: ".watchapp.widget",
  // No `icon`: a WidgetKit extension has no icon of its own (it renders via
  // SwiftUI and is presented under the watch app's icon in the complications
  // picker). Passing one here made the icon generator emit iPhone/iPad-idiom
  // assets instead of watchOS ones, which Xcode then rejected as
  // inapplicable - this target simply doesn't need the config option.
};
