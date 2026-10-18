/**
 * plugins/withIosNoProcessingMode.js: drops expo-background-task's iOS
 * "processing" mode and BGTask identifier. Order is checked against the real
 * expo-background-task plugin through Expo's own mod compiler.
 *
 * Run: npx tsx scripts/withIosNoProcessingMode.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

const { compileModsAsync } = require("@expo/config-plugins/build/plugins/mod-compiler");
const backgroundTask = require("expo-background-task/plugin/build/withBackgroundTask").default;
const plugin = require("../plugins/withIosNoProcessingMode");
const { stripProcessingMode } = plugin;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}
const json = (v: unknown) => JSON.stringify(v);
const ID = "com.expo.modules.backgroundtask.processing";

const mixed = stripProcessingMode({
  UIBackgroundModes: ["fetch", "processing", "remote-notification"],
  BGTaskSchedulerPermittedIdentifiers: ["com.other.task", ID],
});
ok("processing removed, other modes kept in order", json(mixed.UIBackgroundModes) === json(["fetch", "remote-notification"]));
ok("identifier removed, other identifiers kept", json(mixed.BGTaskSchedulerPermittedIdentifiers) === json(["com.other.task"]));

const only = stripProcessingMode({ CFBundleName: "x", UIBackgroundModes: ["processing"], BGTaskSchedulerPermittedIdentifiers: [ID] });
ok("empty UIBackgroundModes key deleted", !("UIBackgroundModes" in only));
ok("empty identifiers key deleted", !("BGTaskSchedulerPermittedIdentifiers" in only));
ok("unrelated keys kept", only.CFBundleName === "x");

const again = stripProcessingMode(stripProcessingMode({ UIBackgroundModes: ["fetch", "processing"], BGTaskSchedulerPermittedIdentifiers: [ID] }));
ok("idempotent", json(again) === json({ UIBackgroundModes: ["fetch"] }));
ok("absent keys are not created", json(stripProcessingMode({ A: 1 })) === json({ A: 1 }));
ok("untouched list stays the same array", (() => {
  const modes = ["fetch"];
  const p = { UIBackgroundModes: modes };
  stripProcessingMode(p);
  return p.UIBackgroundModes !== undefined && json(p.UIBackgroundModes) === json(["fetch"]);
})());

async function compile(order: "before" | "after") {
  const base = {
    name: "t",
    slug: "t",
    ios: { infoPlist: { UIBackgroundModes: ["fetch"] } },
    android: {},
  };
  const list = order === "before" ? [plugin, backgroundTask] : [backgroundTask, plugin];
  let cfg: any = base;
  for (const p of list) cfg = p(cfg);
  const out = await compileModsAsync(cfg, { projectRoot: process.cwd?.() ?? ".", platforms: ["ios"], introspect: true, assertMissingModProviders: false });
  return out.ios.infoPlist;
}

(async () => {
  const before = await compile("before");
  ok("plugin listed before expo-background-task: processing gone", !(before.UIBackgroundModes ?? []).includes("processing"));
  ok("plugin listed before expo-background-task: other mode kept", (before.UIBackgroundModes ?? []).includes("fetch"));
  ok("plugin listed before expo-background-task: identifier gone", !before.BGTaskSchedulerPermittedIdentifiers);

  const after = await compile("after");
  ok("control: plugin listed after expo-background-task leaves processing in", (after.UIBackgroundModes ?? []).includes("processing"));

  console.log(`withIosNoProcessingMode: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
