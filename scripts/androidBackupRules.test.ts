/**
 * plugins/withAndroidBackupRules.js: the backup rules must keep SQLite and
 * AsyncStorage in the cloud backup and only drop the SecureStore file. The
 * expo-secure-store plugin's own rules carry <include domain="sharedpref">,
 * and Android then backs up ONLY what is included, so they stay off.
 *
 * Run: npx tsx scripts/androidBackupRules.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

const fs = require("fs");
const path = require("path");
const appJson = require("../app.json");
const plugin = require("../plugins/withAndroidBackupRules");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

const rules: { fullBackupContent: string; dataExtractionRules: string } = plugin.buildRules();
const manifest = { application: [{ $: { "android:allowBackup": "true" } }] };
plugin.applyManifest(manifest);
const attrs = manifest.application[0].$ as Record<string, string>;

for (const [name, xml] of Object.entries(rules)) {
  ok(`${name}: no <include>`, !/<include\b/.test(xml));
  ok(`${name}: SecureStore.xml excluded`, /<exclude domain="sharedpref" path="SecureStore\.xml"\s*\/>/.test(xml));
}
ok("extraction rules: cloud-backup section", /<cloud-backup>[\s\S]*SecureStore\.xml[\s\S]*<\/cloud-backup>/.test(rules.dataExtractionRules));
ok("extraction rules: device-transfer section", /<device-transfer>[\s\S]*SecureStore\.xml[\s\S]*<\/device-transfer>/.test(rules.dataExtractionRules));
ok("fullBackupContent root", /<full-backup-content>/.test(rules.fullBackupContent));
ok("data-extraction-rules root", /<data-extraction-rules>/.test(rules.dataExtractionRules));
ok("manifest fullBackupContent", attrs["android:fullBackupContent"] === "@xml/zs_backup_rules");
ok("manifest dataExtractionRules", attrs["android:dataExtractionRules"] === "@xml/zs_data_extraction_rules");
ok("allowBackup stays true", attrs["android:allowBackup"] === "true");

const secureStore = (appJson.expo.plugins as unknown[]).find(
  (p) => Array.isArray(p) && p[0] === "expo-secure-store"
) as [string, { configureAndroidBackup?: boolean }] | undefined;
ok("expo-secure-store plugin present", secureStore != null);
ok("its backup rules are switched off", secureStore?.[1]?.configureAndroidBackup === false);
ok(
  "app.json lists the backup plugin",
  (appJson.expo.plugins as unknown[]).includes("./plugins/withAndroidBackupRules")
);

// The excluded file name is the one the native module really uses.
const kt = path.join(
  __dirname,
  "..",
  "node_modules/expo-secure-store/android/src/main/java/expo/modules/securestore/SecureStoreModule.kt"
);
if (fs.existsSync(kt)) {
  const m = /SHARED_PREFERENCES_NAME = "([^"]+)"/.exec(fs.readFileSync(kt, "utf8"));
  ok("SecureStore prefs file name matches the native module", m != null && `${m[1]}.xml` === "SecureStore.xml");
}

console.log(`\nandroid backup rules: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
