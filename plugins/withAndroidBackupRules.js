const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const BACKUP_RULES = "zs_backup_rules";
const EXTRACTION_RULES = "zs_data_extraction_rules";

// expo-secure-store keeps its values in this SharedPreferences file
// (SHARED_PREFERENCES_NAME in SecureStoreModule.kt). The Keystore key that
// decrypts them never leaves the device, so a restored copy is unreadable.
const EXCLUDE = '<exclude domain="sharedpref" path="SecureStore.xml"/>';

/**
 * Backup rules with NO <include>: Android then backs up everything by default
 * (SQLite journal, AsyncStorage) and drops only the excluded file. The rules
 * expo-secure-store generates carry <include domain="sharedpref" path=".">,
 * and one include makes Android back up ONLY what is included, so the diary
 * would silently be left out of a phone-to-phone restore. That plugin's
 * configureAndroidBackup is therefore false in app.json.
 */
function buildRules() {
  return {
    fullBackupContent: `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  ${EXCLUDE}
</full-backup-content>
`,
    dataExtractionRules: `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    ${EXCLUDE}
  </cloud-backup>
  <device-transfer>
    ${EXCLUDE}
  </device-transfer>
</data-extraction-rules>
`,
  };
}

function applyManifest(manifest) {
  const app = manifest.application && manifest.application[0];
  if (!app) return manifest;
  app.$ = app.$ || {};
  app.$["android:allowBackup"] = "true";
  app.$["android:fullBackupContent"] = `@xml/${BACKUP_RULES}`;
  app.$["android:dataExtractionRules"] = `@xml/${EXTRACTION_RULES}`;
  return manifest;
}

function withAndroidBackupRules(config) {
  config = withAndroidManifest(config, (c) => {
    applyManifest(c.modResults.manifest);
    return c;
  });
  return withDangerousMod(config, [
    "android",
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      const rules = buildRules();
      fs.writeFileSync(path.join(dir, `${BACKUP_RULES}.xml`), rules.fullBackupContent);
      fs.writeFileSync(path.join(dir, `${EXTRACTION_RULES}.xml`), rules.dataExtractionRules);
      return c;
    },
  ]);
}

module.exports = withAndroidBackupRules;
module.exports.buildRules = buildRules;
module.exports.applyManifest = applyManifest;
