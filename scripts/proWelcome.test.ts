/**
 * lib/proWelcome.ts correctness harness: the Pro welcome checklist state (which
 * steps show, how a step is recorded, what counts as incomplete, when the welcome
 * is reopened after a Health connect), plus the service that tells the welcome a
 * step finished (run with AsyncStorage and analytics stubbed). No jest, same
 * standalone style as scripts/downsell.test.ts.
 *
 * Run: npx tsx scripts/proWelcome.test.ts, or compile with tsc and run with node:
 *
 *   npx tsc scripts/proWelcome.test.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir <tmp> --module commonjs --target es2019 --moduleResolution node \
 *     --skipLibCheck --esModuleInterop \
 *   && node <tmp>/scripts/proWelcome.test.js
 *
 * Run it from the repo root (the wiring checks at the end read source files).
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import {
  HEALTH_RETURN_WINDOW_MS,
  PRO_WELCOME_STEPS,
  applyStepStatus,
  healthImportDays,
  incompleteCount,
  incompleteSteps,
  parseProWelcomeState,
  serializeProWelcomeState,
  shouldAutoOpenWelcome,
  shouldReturnToWelcome,
  visibleSteps,
  withHealthMirror,
  type ProWelcomeState,
} from "../lib/proWelcome";
// Type-only: makes tsc compile the service next to this file; it is loaded
// further down, once its storage and analytics have been stubbed.
import type * as ServiceApi from "../lib/services/proWelcome";

declare global {
  // Read by lib/analytics/index.ts, which tsc compiles through the service's
  // import; with no react-native types in this program nothing else declares it.
  const __DEV__: boolean;
}

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike proWelcome test");

section("A. the three steps, in order");
{
  eq("steps", [...PRO_WELCOME_STEPS], ["health", "insights", "reminders"]);
}

section("B. Health step only where Health can be connected");
{
  eq("Health usable", visibleSteps(true), ["health", "insights", "reminders"]);
  eq("Health not usable", visibleSteps(false), ["insights", "reminders"]);
}

section("C. import window per platform");
{
  eq("iOS reads 90 days", healthImportDays("ios"), 90);
  eq("Android reads 30 days", healthImportDays("android"), 30);
}

section("D. recording a step");
{
  const empty: ProWelcomeState = {};
  const done = applyStepStatus(empty, "insights", "done");
  eq("done is recorded", done, { insights: "done" });
  ok("the input is never mutated", Object.keys(empty).length === 0);

  const skipped = applyStepStatus(empty, "reminders", "skipped");
  eq("skipped is recorded", skipped, { reminders: "skipped" });

  ok("a repeat returns the same object", applyStepStatus(done, "insights", "done") === done);
  ok("skipping a finished step changes nothing", applyStepStatus(done, "insights", "skipped") === done);
  eq("a skipped step can still be finished", applyStepStatus(skipped, "reminders", "done"), { reminders: "done" });
  ok("a repeated skip returns the same object", applyStepStatus(skipped, "reminders", "skipped") === skipped);
  eq("other steps are kept", applyStepStatus(done, "reminders", "skipped"), { insights: "done", reminders: "skipped" });
}

section("E. incomplete steps, as the dashboard card counts them");
{
  eq("fresh state, Health usable", incompleteCount({}, true), 3);
  eq("fresh state, no Health", incompleteCount({}, false), 2);
  eq("one done", incompleteCount({ insights: "done" }, true), 2);
  eq("a skipped step is still to do", incompleteCount({ insights: "skipped" }, true), 3);
  eq("all done", incompleteCount({ health: "done", insights: "done", reminders: "done" }, true), 0);
  eq(
    "a Health step done earlier does not count when Health is unusable now",
    incompleteSteps({ health: "done" }, false),
    ["insights", "reminders"]
  );
  eq(
    "remaining steps keep their order",
    incompleteSteps({ insights: "done" }, true),
    ["health", "reminders"]
  );
}

section("F. Health already connected counts as done");
{
  const s: ProWelcomeState = { insights: "done" };
  eq("sync on marks Health done", withHealthMirror(s, true), { insights: "done", health: "done" });
  ok("sync off leaves the state alone", withHealthMirror(s, false) === s);
  eq("sync on over a skipped Health step", withHealthMirror({ health: "skipped" }, true), { health: "done" });
  eq("the count follows", incompleteCount(withHealthMirror({}, true), true), 2);
}

section("G. whether a fresh trial or purchase opens the welcome");
{
  ok("nothing done yet", shouldAutoOpenWelcome({}, true));
  ok("one step left", shouldAutoOpenWelcome({ health: "done", insights: "done" }, true));
  ok("everything done: skip the screen", !shouldAutoOpenWelcome({ health: "done", insights: "done", reminders: "done" }, true));
  ok("everything visible done, Health unusable", !shouldAutoOpenWelcome({ insights: "done", reminders: "done" }, false));
}

section("H. storage format is tolerant");
{
  const state: ProWelcomeState = { health: "done", reminders: "skipped" };
  eq("round trip", parseProWelcomeState(serializeProWelcomeState(state)), state);
  eq("null", parseProWelcomeState(null), {});
  eq("undefined", parseProWelcomeState(undefined), {});
  eq("empty string", parseProWelcomeState(""), {});
  eq("not json", parseProWelcomeState("{oops"), {});
  eq("an array", parseProWelcomeState("[1,2]"), {});
  eq("a number", parseProWelcomeState("7"), {});
  eq("unknown steps and values are dropped", parseProWelcomeState('{"health":"done","insights":"maybe","other":"done"}'), { health: "done" });
}

section("H2. coming back to the welcome after the dashboard connected Health");
{
  ok("the wait for the dashboard is bounded", HEALTH_RETURN_WINDOW_MS > 0 && HEALTH_RETURN_WINDOW_MS <= 5 * 60_000);
  ok("steps left: come back", shouldReturnToWelcome({}, true));
  ok("Health was the last open step: nothing to come back to", !shouldReturnToWelcome({ insights: "done", reminders: "done" }, true));
  ok("a skipped step is still open", shouldReturnToWelcome({ insights: "done", reminders: "skipped" }, true));
  ok("the Health step itself counts as done by now", shouldReturnToWelcome({ health: "skipped", insights: "done" }, true));
  ok("without Health only the other two count", shouldReturnToWelcome({}, false));
  ok("without Health and both done: stay out", !shouldReturnToWelcome({ insights: "done", reminders: "done" }, false));
}

const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};
const nodePath = require("path") as {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};
const ROOT = (() => {
  for (const start of [__dirname, process.cwd()]) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (
        fs.existsSync(nodePath.join(dir, "package.json")) &&
        fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"))
      ) {
        return dir;
      }
      dir = nodePath.dirname(dir);
    }
  }
  throw new Error("could not locate the repo root from " + __dirname);
})();
function src(rel: string): string {
  return fs.readFileSync(nodePath.join(ROOT, rel), "utf8");
}

section("I. wiring: the welcome opens from the paywall and the dashboard");
{
  const paywall = src("app/paywall.tsx");
  ok(
    "a successful purchase replaces the paywall with the welcome",
    /router\.replace\("\/pro-welcome"\)/.test(paywall)
  );
  ok("the paywall only opens it when steps are left", /shouldAutoOpenWelcome\(/.test(paywall));
  const screen = src("app/pro-welcome.tsx");
  ok("the screen reports its view", /logEvent\("pro_welcome_view"/.test(screen));
  ok("every step goes through the service", /markProWelcomeStep\(/.test(screen));
  const dash = src("app/(tabs)/index.tsx");
  ok("the dashboard card opens the welcome", /router\.push\("\/pro-welcome"\)/.test(src("components/TrialCard.tsx")));
  ok("the dashboard mounts the trial card", /<TrialCard\b/.test(dash));
  ok(
    "a successful Health connect finishes the Health step",
    /markProWelcomeStep\("health", "done"\)/.test(dash)
  );

  const connectFrom = screen.slice(screen.indexOf("function connectHealth()"));
  const connect = connectFrom.slice(0, connectFrom.indexOf("\n  }\n"));
  ok(
    "Connect goes back to the existing dashboard instead of stacking a second one",
    /router\.dismissTo\(\{ pathname: "\/\(tabs\)", params: \{ health: "connect" \} \}\)/.test(connect) &&
      !/router\.navigate\(/.test(connect)
  );
  ok(
    "it starts listening before it leaves, so a fast connect is not missed",
    connect.indexOf("waitForProWelcomeStep(") >= 0 &&
      connect.indexOf("waitForProWelcomeStep(") < connect.indexOf("router.dismissTo(")
  );
  ok(
    "it reopens the welcome only while a step is left",
    /shouldReturnToWelcome\(/.test(connect) && /router\.push\("\/pro-welcome"\)/.test(connect)
  );
  ok(
    "the welcome is for Pro: the flag, then the cached entitlement, then the paywall",
    /isProUser/.test(screen) &&
      /isProCached\(\)/.test(screen) &&
      /router\.replace\("\/paywall"\)/.test(screen)
  );
  ok("nothing of the checklist renders for a visitor who is not Pro", /if \(!allowed\) \{\s*return \(/.test(screen));

  const settings = src("app/settings/app.tsx");
  ok(
    "Settings lists the welcome for any Pro user with steps left, trial or not",
    /isProUser && stepsLeft != null && stepsLeft > 0/.test(settings) && !/isProUser && onTrial/.test(settings)
  );
}

(async () => {
  section("J. the welcome hears when the dashboard finishes a step");
  {
    const store = new Map<string, string>();
    const events: { name: string; params?: any }[] = [];
    const Module = require("module");
    const realLoad = Module._load;
    Module._load = function (request: string) {
      if (request === "@react-native-async-storage/async-storage") {
        return {
          __esModule: true,
          default: {
            getItem: async (k: string) => (store.has(k) ? (store.get(k) as string) : null),
            setItem: async (k: string, v: string) => void store.set(k, String(v)),
            removeItem: async (k: string) => void store.delete(k),
          },
        };
      }
      if (/(^|\/)analytics$/.test(request)) {
        return {
          logEvent: (name: string, params?: any) => void events.push({ name, params }),
          logCrash: () => {},
        };
      }
      return realLoad.apply(this, arguments);
    };
    let svc: typeof ServiceApi;
    try {
      svc = require("../lib/services/proWelcome");
    } finally {
      Module._load = realLoad;
    }
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 15));
    const stepEvents = () => events.filter((e) => e.name === "pro_welcome_step");

    let settled: boolean | null = null;
    const waiting = svc.waitForProWelcomeStep("health", 2_000).then((v) => (settled = v));
    await svc.markProWelcomeStep("insights", "done");
    await svc.markProWelcomeStep("health", "skipped");
    await tick();
    ok("another step, and a skip of this one, do not settle it", settled === null);

    await svc.markProWelcomeStep("health", "done");
    eq("the Health step finishing settles it true", await waiting, true);
    eq("the step is on record", JSON.parse(store.get("zerospike.proWelcome") as string).health, "done");
    eq("each transition was reported once", stepEvents().length, 3);

    const second = svc.waitForProWelcomeStep("health", 40);
    await svc.markProWelcomeStep("health", "done");
    eq("a repeat is no transition: nothing to hear, the wait times out", await second, false);
    eq("and it reported nothing", stepEvents().length, 3);

    const a = svc.waitForProWelcomeStep("reminders", 2_000);
    const b = svc.waitForProWelcomeStep("reminders", 2_000);
    await svc.markProWelcomeStep("reminders", "done");
    eq("two waiters both hear it", [await a, await b], [true, true]);

    eq("no answer in time: false", await svc.waitForProWelcomeStep("insights", 30), false);
    eq("the step events are still the four real transitions", stepEvents().length, 4);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.log("test crashed", err);
  process.exit(1);
});
