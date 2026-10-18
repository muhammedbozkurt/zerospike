const { withInfoPlist } = require("expo/config-plugins");

// expo-background-task's config plugin adds UIBackgroundModes "processing" and a
// BGTaskScheduler identifier on iOS with no platform option. The app registers
// that task on Android only (lib/services/healthBackground.ts); iOS background
// delivery comes from HealthKit, so the unused mode would be a App Review
// guideline 2.5.4 risk. Expo applies the last listed plugin's Info.plist action
// first, so this plugin must be listed BEFORE expo-background-task in app.json
// for its action to run after the one it cleans up.
const PROCESSING_MODE = "processing";
const BG_TASK_IDENTIFIER = "com.expo.modules.backgroundtask.processing";

function removeFromList(plist, key, value) {
  if (!Array.isArray(plist[key])) return;
  const kept = plist[key].filter((entry) => entry !== value);
  if (kept.length) plist[key] = kept;
  else delete plist[key];
}

function stripProcessingMode(infoPlist) {
  removeFromList(infoPlist, "UIBackgroundModes", PROCESSING_MODE);
  removeFromList(infoPlist, "BGTaskSchedulerPermittedIdentifiers", BG_TASK_IDENTIFIER);
  return infoPlist;
}

function withIosNoProcessingMode(config) {
  return withInfoPlist(config, (c) => {
    stripProcessingMode(c.modResults);
    return c;
  });
}

module.exports = withIosNoProcessingMode;
module.exports.stripProcessingMode = stripProcessingMode;
