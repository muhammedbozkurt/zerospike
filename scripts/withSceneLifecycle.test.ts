/**
 * plugins/withSceneLifecycle.js: UIScene life cycle adoption (iOS 27 SDK).
 * The AppDelegate and the Xcode project come from the installed expo
 * template (node_modules/expo/template.tgz).
 *
 * Run: npx tsx scripts/withSceneLifecycle.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

const fs = require("fs");
const os = require("os");
const nodePath = require("path");
const { execFileSync } = require("child_process");
const xcode = require("xcode");
const plugin = require("../plugins/withSceneLifecycle");

const {
  transformAppDelegate,
  applySceneManifest,
  writeSceneDelegate,
  addSceneDelegateToProject,
  SCENE_MANIFEST,
  SCENE_DELEGATE_SOURCE,
} = plugin;

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
const tmp: string = fs.mkdtempSync(nodePath.join(os.tmpdir(), "scene-lifecycle-"));
execFileSync("tar", ["-xzf", nodePath.join(root, "node_modules/expo/template.tgz"), "-C", tmp]);
const templateIos = nodePath.join(tmp, "package/ios");
const TEMPLATE: string = fs.readFileSync(nodePath.join(templateIos, "HelloWorld/AppDelegate.swift"), "utf8");

// --- AppDelegate ---------------------------------------------------------

ok("fixture: template still starts React Native in the AppDelegate", TEMPLATE.includes("factory.startReactNative("));
const warnings: string[] = [];
const collect = (m: string) => warnings.push(m);
const out: string = transformAppDelegate(TEMPLATE, collect);
ok("conforms to ExpoReactNativeFactoryProvider", out.includes("class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {"));
ok("no window creation left", !out.includes("UIWindow(frame:"));
ok("no startReactNative left", !out.includes("startReactNative("));
ok("factory still stored for the scene delegate", out.includes("reactNativeFactory = factory"));
ok("legacy openURL override removed", !out.includes("open url: URL"));
ok("legacy continueUserActivity override removed", !out.includes("continue userActivity"));
ok("no warnings for the stock template", warnings.length === 0);
ok("no triple blank lines", !/\n\n\n/.test(out));
ok("ReactNativeDelegate untouched", out.includes("class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {"));
ok("idempotent: second pass is a no-op", transformAppDelegate(out, collect) === out);

ok(
  "unknown code inside the window block fails loudly",
  throws(() =>
    transformAppDelegate(TEMPLATE.replace("    factory.startReactNative(", "    SomeVendor.setup()\n    factory.startReactNative("), collect),
  ),
);
ok(
  "unrecognised startReactNative shape fails loudly",
  throws(() => transformAppDelegate(TEMPLATE.replace('withModuleName: "main"', 'withModuleName: "other"'), collect)),
);

const driftWarnings: string[] = [];
const drifted: string = transformAppDelegate(
  TEMPLATE.replace("// Linking API", "// Linking").replace("// Universal Links", "// Universal"),
  (m: string) => driftWarnings.push(m),
);
ok("unrecognised link overrides are kept", drifted.includes("open url: URL") && drifted.includes("continue userActivity"));
ok("unrecognised link overrides each raise a warning", driftWarnings.length === 2);

// --- Info.plist ----------------------------------------------------------

const fresh = applySceneManifest({ CFBundleName: "x" });
ok("manifest added when absent", JSON.stringify(fresh.UIApplicationSceneManifest) === JSON.stringify(SCENE_MANIFEST));
ok("manifest added as a copy, not the shared constant", fresh.UIApplicationSceneManifest !== SCENE_MANIFEST);
fresh.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes = true;
ok("mutating the written manifest leaves the constant alone", SCENE_MANIFEST.UIApplicationSupportsMultipleScenes === false);
const sameManifest = JSON.parse(JSON.stringify(SCENE_MANIFEST));
const reordered = {
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
        UISceneConfigurationName: "Default Configuration",
      },
    ],
  },
  UIApplicationSupportsMultipleScenes: false,
};
const plistSame = { UIApplicationSceneManifest: sameManifest };
ok("identical manifest left untouched", applySceneManifest(plistSame).UIApplicationSceneManifest === sameManifest);
ok("key order does not count as different", !throws(() => applySceneManifest({ UIApplicationSceneManifest: reordered })));
ok(
  "different manifest fails loudly",
  throws(() => applySceneManifest({ UIApplicationSceneManifest: { ...sameManifest, UIApplicationSupportsMultipleScenes: true } })),
);

// --- SceneDelegate.swift on disk -------------------------------------------

const sdPath = nodePath.join(tmp, "SceneDelegate.swift");
ok("file written when absent", writeSceneDelegate(sdPath) === true && fs.readFileSync(sdPath, "utf8") === SCENE_DELEGATE_SOURCE);
ok("identical file left alone", writeSceneDelegate(sdPath) === false);
fs.writeFileSync(sdPath, SCENE_DELEGATE_SOURCE.replace("startedReactNative", "olderFlag"));
ok("older plugin output rewritten", writeSceneDelegate(sdPath) === true && fs.readFileSync(sdPath, "utf8") === SCENE_DELEGATE_SOURCE);
fs.writeFileSync(sdPath, "class SceneDelegate {}\n");
ok("foreign file fails loudly", throws(() => writeSceneDelegate(sdPath)));
ok("foreign file not overwritten", fs.readFileSync(sdPath, "utf8") === "class SceneDelegate {}\n");

// --- Xcode project -------------------------------------------------------

const project = xcode.project(nodePath.join(templateIos, "HelloWorld.xcodeproj/project.pbxproj"));
project.parseSync();
const mainTarget: string = project.findTargetKey("HelloWorld");
// A watch app is an application product too (as @bacons/apple-targets makes
// it); listing it first is what breaks a lookup by product type.
const watch = project.addTarget("ZerospikeWatch", "application", "watch");
const widget = project.addTarget("ZerospikeWidget", "app_extension", "widget");
for (const t of [watch, widget]) project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", t.uuid);
const projectTargets: { value: string }[] = project.getFirstProject().firstProject.targets;
projectTargets.sort((a, b) => (a.value === watch.uuid ? -1 : b.value === watch.uuid ? 1 : 0));
ok(
  "fixture: lookup by product type now picks the watch app",
  project.getTarget("com.apple.product-type.application").uuid === watch.uuid,
);

function sourcesOf(targetUuid: string): string[] {
  const objects = project.hash.project.objects;
  const target = objects.PBXNativeTarget[targetUuid];
  const phase = target.buildPhases
    .map((p: { value: string }) => objects.PBXSourcesBuildPhase[p.value])
    .find((p: unknown) => p);
  return phase ? phase.files.map((f: { comment: string }) => f.comment) : [];
}

ok("SceneDelegate added on first run", addSceneDelegateToProject(project, "HelloWorld") === true);
ok("SceneDelegate compiled in the app target", sourcesOf(mainTarget).includes("SceneDelegate.swift in Sources"));
ok("SceneDelegate not compiled in the watch app", !sourcesOf(watch.uuid).includes("SceneDelegate.swift in Sources"));
ok("SceneDelegate not compiled in the widget", !sourcesOf(widget.uuid).includes("SceneDelegate.swift in Sources"));
const firstWrite: string = project.writeSync();
ok("second run is a no-op", addSceneDelegateToProject(project, "HelloWorld") === false && project.writeSync() === firstWrite);
ok("exactly one file reference", count(firstWrite, "/* SceneDelegate.swift */ = {isa = PBXFileReference") === 1);
ok("missing target fails loudly", throws(() => addSceneDelegateToProject(project, "NoSuchTarget")));

// --- Generated Swift against the installed Expo API ------------------------

const expoSceneDelegate: string = fs.readFileSync(
  nodePath.join(root, "node_modules/expo/ios/AppDelegates/ExpoAppSceneDelegate.swift"),
  "utf8",
);
const expoProvider: string = fs.readFileSync(
  nodePath.join(root, "node_modules/expo/ios/AppDelegates/ExpoReactNativeFactoryProvider.swift"),
  "utf8",
);
ok("expo: base class is open", /open class ExpoAppSceneDelegate: UIResponder, UIWindowSceneDelegate/.test(expoSceneDelegate));
ok("expo: window is open", /open var window: UIWindow\?/.test(expoSceneDelegate));
ok(
  "expo: willConnectTo is open",
  /open func scene\(\s*_ scene: UIScene,\s*willConnectTo session: UISceneSession,\s*options connectionOptions: UIScene\.ConnectionOptions\s*\)/.test(
    expoSceneDelegate,
  ),
);
ok("expo: base willConnectTo starts React Native", /factory\.startReactNative\(/.test(expoSceneDelegate));
ok("expo: openURLContexts is open", /open func scene\(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>\)/.test(expoSceneDelegate));
ok("expo: continue userActivity is open", /open func scene\(_ scene: UIScene, continue userActivity: NSUserActivity\)/.test(expoSceneDelegate));
ok(
  "expo: performActionFor is open",
  /open func windowScene\(\s*_ windowScene: UIWindowScene,\s*performActionFor shortcutItem: UIApplicationShortcutItem,\s*completionHandler: @escaping \(Bool\) -> Void/.test(
    expoSceneDelegate,
  ),
);
ok("expo: provider is public", /public protocol ExpoReactNativeFactoryProvider: AnyObject/.test(expoProvider));
ok("expo: provider window is settable", /var window: UIWindow\? \{ get set \}/.test(expoProvider));

const sd: string = SCENE_DELEGATE_SOURCE;
ok("swift: generated marker first", sd.startsWith("// Generated by plugins/withSceneLifecycle.js"));
ok("swift: class name kept for the Info.plist", sd.includes("@objc(SceneDelegate)\nclass SceneDelegate: ExpoAppSceneDelegate {"));
ok("swift: overrides willConnectTo", /override func scene\(\n\s*_ scene: UIScene,\n\s*willConnectTo session: UISceneSession,\n\s*options connectionOptions: UIScene\.ConnectionOptions\n\s*\)/.test(sd));
ok("swift: first connection goes through Expo unchanged", sd.includes("super.scene(scene, willConnectTo: session, options: connectionOptions)"));
ok("swift: never starts React Native itself", !sd.includes("startReactNative("));
ok("swift: started flag set only after a root view exists", sd.includes("SceneDelegate.startedReactNative = window?.rootViewController != nil"));
ok("swift: reuse requires the flag and a running root view controller", /guard SceneDelegate\.startedReactNative,[\s\S]*previousWindow\.rootViewController != nil\s*else \{/.test(sd));
ok("swift: the whole window moves to the new scene", sd.includes("previousWindow.windowScene = windowScene"));
ok("swift: root view controller is not detached", !sd.includes("rootViewController = nil") && !sd.includes("window.rootViewController = rootViewController"));
ok("swift: no second window created on reconnect", count(sd, "UIWindow(windowScene:") === 0);
ok("swift: moved window mirrored to scene and app delegate", sd.includes("self.window = previousWindow") && sd.includes("provider.window = previousWindow"));
ok("swift: moved window shown and key", sd.includes("previousWindow.makeKeyAndVisible()"));
ok("swift: reconnect URLs forwarded", sd.includes("self.scene(scene, openURLContexts: connectionOptions.urlContexts)"));
ok("swift: reconnect activities forwarded", sd.includes("connectionOptions.userActivities.forEach { self.scene(scene, continue: $0) }"));
ok("swift: reconnect quick action forwarded", sd.includes("self.windowScene(windowScene, performActionFor: shortcutItem) { _ in }"));
ok("expo: sceneDidBecomeActive is open", /open func sceneDidBecomeActive\(_ scene: UIScene\)/.test(expoSceneDelegate));
ok("swift: overrides sceneDidBecomeActive", sd.includes("override func sceneDidBecomeActive(_ scene: UIScene) {"));
ok(
  "swift: life-cycle event forwarded before the key window check",
  sd.indexOf("super.sceneDidBecomeActive(scene)") > -1 &&
    sd.indexOf("super.sceneDidBecomeActive(scene)") < sd.indexOf("windowScene.keyWindow == nil"),
);
ok("swift: makes the app window key only when the scene has none", /windowScene\.keyWindow == nil else \{\s*return\s*\}\s*window\.makeKey\(\)/.test(sd));
ok("swift: UIKit imported for the window APIs", /^import UIKit$/m.test(sd));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`withSceneLifecycle: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
