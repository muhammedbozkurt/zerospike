/**
 * plugins/withAndroidPermissionTrim.js: dry run of the manifest transform on
 * a sample manifest, plus a check that app.json keeps every permission the
 * app really needs and never lists one the trim removes.
 *
 * Run: npx tsx scripts/androidPermissions.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

const { trimManifestPermissions, REMOVED_PERMISSIONS } = require("../plugins/withAndroidPermissionTrim");
const appJson = require("../app.json");
const fs = require("fs");
const path = require("path");
const { ANDROID_SYNC_WINDOW_DAYS, SYNC_WINDOW_DAYS } = require("../lib/services/healthTypes");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

const MUST_REMOVE = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WRITE_CONTACTS",
  "android.permission.RECORD_AUDIO",
  "com.google.android.gms.permission.AD_ID",
  "android.permission.ACCESS_ADSERVICES_AD_ID",
  "com.google.android.c2dm.permission.RECEIVE",
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "android.permission.READ_APP_BADGE",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

// Used by shipped code: must never be removed.
const MUST_KEEP = [
  "android.permission.CAMERA",
  "android.permission.READ_CONTACTS",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.INTERNET",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.POST_PROMOTED_NOTIFICATIONS",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.USE_FULL_SCREEN_INTENT",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
  "com.android.vending.BILLING",
  "android.permission.health.READ_BLOOD_GLUCOSE",
  "android.permission.health.WRITE_BLOOD_GLUCOSE",
  "android.permission.health.WRITE_NUTRITION",
  "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
];

const entry = (name: string, extra: Record<string, string> = {}) => ({
  $: { "android:name": name, ...extra },
});
const removed = (m: any, name: string): boolean =>
  m["uses-permission"].some(
    (p: any) => p.$["android:name"] === name && p.$["tools:node"] === "remove",
  );
const kept = (m: any, name: string): boolean =>
  m["uses-permission"].some(
    (p: any) => p.$["android:name"] === name && p.$["tools:node"] !== "remove",
  );

for (const name of MUST_REMOVE) ok(`list contains ${name}`, REMOVED_PERMISSIONS.includes(name));
for (const name of MUST_KEEP) ok(`list excludes ${name}`, !REMOVED_PERMISSIONS.includes(name));
ok("no duplicate entries in REMOVED_PERMISSIONS", new Set(REMOVED_PERMISSIONS).size === REMOVED_PERMISSIONS.length);

// Sample: the app manifest already lists some entries (template + app.json);
// library-only ones are absent and must be added as removals.
const sample = {
  $: { "xmlns:android": "http://schemas.android.com/apk/res/android" } as Record<string, string>,
  "uses-permission": [
    entry("android.permission.SYSTEM_ALERT_WINDOW"),
    entry("android.permission.RECORD_AUDIO"),
    ...MUST_KEEP.map((n) => entry(n)),
  ],
};
const out = trimManifestPermissions(sample);
ok("returns the same manifest object", out === sample);
ok("tools namespace declared", sample.$["xmlns:tools"] === "http://schemas.android.com/tools");
for (const name of MUST_REMOVE) ok(`removed ${name}`, removed(sample, name));
for (const name of MUST_KEEP) ok(`kept ${name}`, kept(sample, name));
ok(
  "existing entry flagged in place, not duplicated",
  sample["uses-permission"].filter((p: any) => p.$["android:name"] === "android.permission.SYSTEM_ALERT_WINDOW").length === 1,
);

const before = JSON.stringify(sample);
trimManifestPermissions(sample);
ok("idempotent", JSON.stringify(sample) === before);
const empty = trimManifestPermissions({} as any);
ok("empty manifest gets all removals", REMOVED_PERMISSIONS.every((n: string) => removed(empty, n)));

const android = appJson.expo.android;
ok("app.json android.permissions is an array", Array.isArray(android.permissions));
for (const name of android.permissions) {
  ok(`app.json permission not trimmed: ${name}`, !REMOVED_PERMISSIONS.includes(name));
}
for (const name of [
  "android.permission.CAMERA",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.USE_FULL_SCREEN_INTENT",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.POST_PROMOTED_NOTIFICATIONS",
  "android.permission.health.READ_BLOOD_GLUCOSE",
  "android.permission.health.WRITE_BLOOD_GLUCOSE",
  "android.permission.health.WRITE_NUTRITION",
  "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
]) {
  ok(`app.json keeps ${name}`, android.permissions.includes(name));
}
ok(
  "app.json still blocks USE_EXACT_ALARM",
  (android.blockedPermissions ?? []).includes("android.permission.USE_EXACT_ALARM"),
);
ok(
  "plugin registered in app.json",
  appJson.expo.plugins.includes("./plugins/withAndroidPermissionTrim"),
);

// FINE location stays: the SOS link must carry a precise position (coarse is a
// ~3 km block), so the trim must not remove it.
ok("FINE location not trimmed", !REMOVED_PERMISSIONS.includes("android.permission.ACCESS_FINE_LOCATION"));
ok("c2dm.RECEIVE trimmed (local notifications only)", REMOVED_PERMISSIONS.includes("com.google.android.c2dm.permission.RECEIVE"));
ok("app.json does not list c2dm.RECEIVE", !android.permissions.includes("com.google.android.c2dm.permission.RECEIVE"));

// Health Connect rules: no insulin type, no activity reads, no history permission.
const hcPerms: string[] = android.permissions.filter((n: string) => n.startsWith("android.permission.health."));
const HC_ALLOWED = [
  "android.permission.health.READ_BLOOD_GLUCOSE",
  "android.permission.health.WRITE_BLOOD_GLUCOSE",
  "android.permission.health.WRITE_NUTRITION",
  "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
];
ok("health permissions are exactly the four allowed", hcPerms.length === HC_ALLOWED.length && HC_ALLOWED.every((n) => hcPerms.includes(n)));
const hcSource: string = fs.readFileSync(path.join(__dirname, "../lib/services/healthConnect.ts"), "utf8");
const hcTypes = new Set<string>();
for (const m of hcSource.matchAll(/(?:recordType:\s*|readRecords\(\s*)"([A-Za-z]+)"/g)) hcTypes.add(m[1]);
for (const bad of ["Insulin", "InsulinDelivery", "ActiveCaloriesBurned", "ExerciseSession", "Steps", "TotalCaloriesBurned"]) {
  ok(`healthConnect.ts never touches ${bad}`, !hcSource.includes(`"${bad}"`));
}
ok("healthConnect.ts only uses BloodGlucose and BackgroundAccessPermission literals", [...hcTypes].every((t) => ["BloodGlucose", "BackgroundAccessPermission"].includes(t)));
ok("Android sync window is 30 days, iOS 90", ANDROID_SYNC_WINDOW_DAYS === 30 && SYNC_WINDOW_DAYS === 90);

console.log(`androidPermissions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
