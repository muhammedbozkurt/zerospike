/**
 * lib/appVersion.ts: the build number fallback follows the platform (never the
 * other store's field), and the places that used Constants.nativeAppVersion
 * (undefined on SDK 57) read getAppVersion() instead. Run from the repo root:
 *
 *   npx tsx scripts/appVersion.test.ts
 */
import { readFileSync } from "node:fs";

declare const require: { (id: string): any; resolve: (id: string) => string; cache: Record<string, unknown> };

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const rig = {
  os: "ios" as string,
  native: { build: null as string | null, version: null as string | null },
  config: undefined as any,
};

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string) {
  if (request === "react-native") {
    return {
      Platform: {
        get OS() {
          return rig.os;
        },
      },
    };
  }
  if (request === "expo-application") {
    return {
      get nativeBuildVersion() {
        return rig.native.build;
      },
      get nativeApplicationVersion() {
        return rig.native.version;
      },
    };
  }
  if (request === "expo-constants") {
    return {
      __esModule: true,
      default: {
        get expoConfig() {
          return rig.config;
        },
      },
    };
  }
  return realLoad.apply(this, arguments);
};

const { getAppVersion, getAppVersionOrEmpty, getBuildNumber } = require("../lib/appVersion");

const BOTH = { version: "2.4.0", ios: { buildNumber: "93" }, android: { versionCode: 94 } };

rig.native = { build: "77", version: "2.3.7" };
rig.config = BOTH;
eq("the binary's build wins", getBuildNumber(), "77");
eq("the binary's version wins", getAppVersion(), "2.3.7");

rig.native = { build: null, version: null };
rig.os = "ios";
eq("iOS falls back to the iOS build number", getBuildNumber(), "93");
rig.os = "android";
eq("Android falls back to the versionCode", getBuildNumber(), "94");
eq("the config version is the fallback", getAppVersion(), "2.4.0");

rig.os = "ios";
rig.config = { version: "2.4.0", android: { versionCode: 94 } };
eq("iOS without a buildNumber does not borrow the versionCode", getBuildNumber(), "unknown");
rig.os = "android";
rig.config = { version: "2.4.0", ios: { buildNumber: "93" } };
eq("Android without a versionCode does not borrow the buildNumber", getBuildNumber(), "unknown");

rig.config = undefined;
eq("no config at all", getAppVersion(), "unknown");
eq("the payload variant is empty instead of 'unknown'", getAppVersionOrEmpty(), "");
rig.config = { version: "2.4.0" };
eq("the payload variant carries a real version", getAppVersionOrEmpty(), "2.4.0");

for (const file of ["lib/whatsNewStore.ts", "lib/feedbackClient.ts"]) {
  const src = readFileSync(file, "utf8");
  eq(`${file} no longer reads Constants.nativeAppVersion`, /nativeAppVersion/.test(src), false);
  eq(`${file} reads the shared helper`, /getAppVersionOrEmpty\(\)/.test(src), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
