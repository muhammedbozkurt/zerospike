const { WarningAggregator, withAppDelegate } = require("expo/config-plugins");

// @kingstinct/react-native-healthkit registers its HKObserverQuery observers
// natively so HealthKit can relaunch a terminated app (background delivery).
// Apple requires that registration inside didFinishLaunchingWithOptions, before
// JS exists. The library's published app.plugin.js adds the entitlement but not
// this AppDelegate call (its app.plugin.ts does, and is not what Expo loads).
// BackgroundDeliveryManager is an @objc public class of the ReactNativeHealthkit
// pod module; the other imports in the AppDelegate are `internal import`.

const MODULE_IMPORT = "internal import ReactNativeHealthkit";
const SETUP_CALL = "BackgroundDeliveryManager.shared.setupBackgroundObservers()";
const LAUNCH_FUNC =
  /([ \t]*)(?:public\s+)?override func application\(\s*_ application: UIApplication,\s*didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\? = nil\s*\) -> Bool \{\n/;

function fail(message) {
  throw new Error(`withHealthBackgroundDelivery: ${message}`);
}

function transformAppDelegate(src) {
  let out = src;

  if (!out.includes(MODULE_IMPORT)) {
    if (!/^internal import Expo$/m.test(out)) fail("`internal import Expo` not found in AppDelegate.swift.");
    out = out.replace(/^internal import Expo$/m, `internal import Expo\n${MODULE_IMPORT}`);
  }

  if (!out.includes(SETUP_CALL)) {
    const match = out.match(LAUNCH_FUNC);
    if (!match) fail("didFinishLaunchingWithOptions not found in AppDelegate.swift.");
    out = out.replace(LAUNCH_FUNC, (head, indent) => `${head}${indent}  ${SETUP_CALL}\n`);
  }

  return out;
}

function withHealthBackgroundDelivery(config) {
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") {
      WarningAggregator.addWarningIOS("withHealthBackgroundDelivery", `AppDelegate language "${c.modResults.language}" is not supported.`);
      return c;
    }
    c.modResults.contents = transformAppDelegate(c.modResults.contents);
    return c;
  });
}

module.exports = withHealthBackgroundDelivery;
module.exports.transformAppDelegate = transformAppDelegate;
module.exports.MODULE_IMPORT = MODULE_IMPORT;
module.exports.SETUP_CALL = SETUP_CALL;
