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
  icon: "../../assets/icon.png",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.greeneyeapp.zerospike"],
  },
  deploymentTarget: "16.4",
  colors: {
    WidgetBackground: "#080e14",
    WidgetAccent: "#2ee6ff",
  },
};
