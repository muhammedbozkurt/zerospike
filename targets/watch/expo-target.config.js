/**
 * R10 FAZ 3 (kill-switch): the standalone Apple Watch companion app. Deployed
 * as a HUMAN EAS build step; the Swift here is compiled by Xcode, not by the
 * app's tsc gate.
 *
 * Bundle id resolves to com.greeneyeapp.zerospike.watchapp (a leading "." in
 * bundleIdentifier appends to the main app's id). The App Group is shared with
 * the watch-widget target (targets/watch-widget) so the watch app and its
 * complications read the same on-watch snapshot - NOT shared with the phone's
 * own App Group across devices; a watch extension cannot read that (see
 * targets/watch/LiveData.swift).
 */
module.exports = {
  type: "watch",
  name: "ZerospikeWatch",
  bundleIdentifier: ".watchapp",
  icon: "../../assets/brand/icon-1024.png",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.greeneyeapp.zerospike"],
  },
};
