// Health Connect shows the app's permission rationale (the "privacy policy"
// link in its permission dialog) by sending an implicit intent:
//   - up to Android 13: action androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE
//   - Android 14+: activity-alias guarded by START_VIEW_PERMISSION_USAGE,
//     action VIEW_PERMISSION_USAGE, category HEALTH_PERMISSIONS
// react-native-health-connect points both at MainActivity, so the user lands on
// the normal home screen and Play's "rationale / privacy policy screen"
// requirement is not met. JS cannot read an intent's action (Linking only sees
// VIEW URLs), and a <data> element on the filter would make it never match,
// because Health Connect sends these intents without data. So both entry
// points are redirected to a tiny native trampoline activity that opens the
// in-app route through the app's own deep link scheme.
//
// Registration order matters: Expo runs manifest mods in REVERSE order of the
// plugins list, so this plugin must be listed BEFORE "react-native-health-connect"
// in app.json to run AFTER it and see the filter and alias it adds.

const RATIONALE_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const VIEW_PERMISSION_USAGE_ACTION = "android.intent.action.VIEW_PERMISSION_USAGE";
const HEALTH_PERMISSIONS_CATEGORY = "android.intent.category.HEALTH_PERMISSIONS";
const DEFAULT_CATEGORY = "android.intent.category.DEFAULT";
const VIEW_PERMISSION_USAGE_ALIAS = "ViewPermissionUsageActivity";
const START_VIEW_PERMISSION_USAGE = "android.permission.START_VIEW_PERMISSION_USAGE";

// Lives in modules/zerospike-alarmkit (the only Android library module the app
// already autolinks); declared here, in the app manifest, so the rationale
// filters stay in one place with the rest of this transform.
const RATIONALE_ACTIVITY = "expo.modules.zerospikealarmkit.HealthRationaleActivity";

const NAME = "android:name";

function nameOf(node) {
  return node && node.$ ? node.$[NAME] : undefined;
}

function hasAction(filter, action) {
  return (filter.action || []).some((a) => nameOf(a) === action);
}

function isMainActivity(activity) {
  const isLauncher = (activity["intent-filter"] || []).some((f) =>
    (f.category || []).some((c) => nameOf(c) === "android.intent.category.LAUNCHER")
  );
  return isLauncher || /(^|\.)MainActivity$/.test(nameOf(activity) || "");
}

function isViewPermissionUsageAlias(alias) {
  const name = nameOf(alias) || "";
  return (
    name === VIEW_PERMISSION_USAGE_ALIAS ||
    name.endsWith(`.${VIEW_PERMISSION_USAGE_ALIAS}`) ||
    (alias["intent-filter"] || []).some((f) => hasAction(f, VIEW_PERMISSION_USAGE_ACTION))
  );
}

/** Drops the rationale action from every intent-filter of an activity. A filter left with no action is removed. */
function stripRationaleFilters(activity) {
  if (!activity["intent-filter"]) return;
  activity["intent-filter"] = activity["intent-filter"].filter((filter) => {
    if (!hasAction(filter, RATIONALE_ACTION)) return true;
    filter.action = filter.action.filter((a) => nameOf(a) !== RATIONALE_ACTION);
    return filter.action.length > 0;
  });
}

function rationaleActivityNode() {
  return {
    $: {
      [NAME]: RATIONALE_ACTIVITY,
      "android:exported": "true",
      "android:excludeFromRecents": "true",
      "android:noHistory": "true",
      "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
    },
    "intent-filter": [
      {
        action: [{ $: { [NAME]: RATIONALE_ACTION } }],
        category: [{ $: { [NAME]: DEFAULT_CATEGORY } }],
      },
    ],
  };
}

function viewPermissionUsageAliasNode() {
  return {
    $: {
      [NAME]: VIEW_PERMISSION_USAGE_ALIAS,
      "android:exported": "true",
      "android:targetActivity": RATIONALE_ACTIVITY,
      "android:permission": START_VIEW_PERMISSION_USAGE,
    },
    "intent-filter": [
      {
        action: [{ $: { [NAME]: VIEW_PERMISSION_USAGE_ACTION } }],
        category: [{ $: { [NAME]: HEALTH_PERMISSIONS_CATEGORY } }],
      },
    ],
  };
}

/**
 * Pure manifest transform on the `manifest` key of a parsed AndroidManifest.xml.
 * Mutates and returns it. Idempotent.
 *  - removes the rationale intent-filter from MainActivity
 *  - declares HealthRationaleActivity with that intent-filter
 *  - points the VIEW_PERMISSION_USAGE alias (creating it when absent) at it
 * Every other filter, alias and attribute is left as it was.
 */
function routeHealthRationale(manifest) {
  const application = manifest.application && manifest.application[0];
  if (!application) throw new Error("withHealthRationaleRouting: no <application> in manifest.");

  application.activity = application.activity || [];
  const main = application.activity.find(isMainActivity);
  if (!main) throw new Error("withHealthRationaleRouting: MainActivity not found in manifest.");
  stripRationaleFilters(main);

  const existing = application.activity.find((a) => nameOf(a) === RATIONALE_ACTIVITY);
  if (!existing) {
    application.activity.push(rationaleActivityNode());
  } else if (!(existing["intent-filter"] || []).some((f) => hasAction(f, RATIONALE_ACTION))) {
    existing["intent-filter"] = [...(existing["intent-filter"] || []), rationaleActivityNode()["intent-filter"][0]];
  }

  application["activity-alias"] = application["activity-alias"] || [];
  const alias = application["activity-alias"].find(isViewPermissionUsageAlias);
  if (alias) {
    alias.$["android:targetActivity"] = RATIONALE_ACTIVITY;
  } else {
    application["activity-alias"].push(viewPermissionUsageAliasNode());
  }
  return manifest;
}

module.exports = function withHealthRationaleRouting(config) {
  const { withAndroidManifest } = require("expo/config-plugins");
  return withAndroidManifest(config, (c) => {
    routeHealthRationale(c.modResults.manifest);
    return c;
  });
};

module.exports.routeHealthRationale = routeHealthRationale;
module.exports.RATIONALE_ACTIVITY = RATIONALE_ACTIVITY;
module.exports.RATIONALE_ACTION = RATIONALE_ACTION;
module.exports.VIEW_PERMISSION_USAGE_ACTION = VIEW_PERMISSION_USAGE_ACTION;
