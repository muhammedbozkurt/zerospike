/**
 * plugins/withHealthBackgroundDelivery.js: HealthKit background delivery call
 * in the AppDelegate, on top of the installed expo template and the
 * withSceneLifecycle output.
 *
 * Run: npx tsx scripts/withHealthBackgroundDelivery.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

const fs = require("fs");
const os = require("os");
const nodePath = require("path");
const { execFileSync } = require("child_process");
const plugin = require("../plugins/withHealthBackgroundDelivery");
const scene = require("../plugins/withSceneLifecycle");

const { transformAppDelegate, SETUP_CALL } = plugin;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const root = nodePath.join(__dirname, "..");
const tmp: string = fs.mkdtempSync(nodePath.join(os.tmpdir(), "health-bg-"));
execFileSync("tar", ["-xzf", nodePath.join(root, "node_modules/expo/template.tgz"), "-C", tmp]);
const TEMPLATE: string = fs.readFileSync(nodePath.join(tmp, "package/ios/HelloWorld/AppDelegate.swift"), "utf8");

ok("fixture: template has didFinishLaunchingWithOptions", TEMPLATE.includes("didFinishLaunchingWithOptions launchOptions"));

const out: string = transformAppDelegate(TEMPLATE);
ok("no module import is added (C++ interop safe)", !out.includes("import ReactNativeHealthkit"));
ok("runtime lookup uses the exported @objc names", SETUP_CALL.includes("ReactNativeHealthkit.BackgroundDeliveryManager") && SETUP_CALL.includes("setupBackgroundObservers"));
ok("setup call added once", count(out, SETUP_CALL) === 1);

const fnStart = out.indexOf("didFinishLaunchingWithOptions launchOptions");
const bodyStart = out.indexOf("{\n", fnStart) + 2;
ok("setup call is the first statement of didFinishLaunching", out.slice(bodyStart).startsWith(`    ${SETUP_CALL}\n`));
ok("setup call precedes the React Native factory", out.indexOf(SETUP_CALL) < out.indexOf("ExpoReactNativeFactory(delegate:"));
ok("rest of the template untouched", out.replace(`    ${SETUP_CALL}\n`, "") === TEMPLATE);
ok("idempotent: second pass is a no-op", transformAppDelegate(out) === out);

const afterScene: string = scene.transformAppDelegate(TEMPLATE, () => undefined);
const sceneThenHealth: string = transformAppDelegate(afterScene);
const healthThenScene: string = scene.transformAppDelegate(out, () => undefined);
ok("composes with withSceneLifecycle in either order", sceneThenHealth === healthThenScene);
ok("scene pass still removes the window block", !sceneThenHealth.includes("UIWindow(frame:") && sceneThenHealth.includes(SETUP_CALL));
ok("scene pass is still idempotent afterwards", scene.transformAppDelegate(sceneThenHealth, () => undefined) === sceneThenHealth);

const preInjected = TEMPLATE.replace(
  "    let delegate = ReactNativeDelegate()",
  `    ${SETUP_CALL}\n    let delegate = ReactNativeDelegate()`,
);
ok("an existing manual call is not duplicated", count(transformAppDelegate(preInjected), SETUP_CALL) === 1);

ok(
  "missing didFinishLaunching fails loudly",
  throws(() => transformAppDelegate(TEMPLATE.replace("didFinishLaunchingWithOptions launchOptions", "didFinishLaunchingWithOptions opts"))),
);

console.log(`withHealthBackgroundDelivery: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
