/**
 * Standalone harness for usage-analytics consent, which is opt-in (Apple
 * 5.1.1(ii), GDPR Art. 9): the three-state answer and its migration from the old
 * on-by-default switch (lib/analytics/consent.ts), the dashboard sheet's rule,
 * the folding of log kinds and of the other insulin-only values, the "delete my
 * server records" flow, and the wiring of all of it into the sinks and screens.
 * No jest; compile + run with node (run from the repo root):
 *
 *   npx tsc scripts/analyticsConsent.test.ts lib/analytics/consent.ts \
 *     lib/analytics/eventSchema.ts lib/analytics/deleteDevice.ts \
 *     --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution node --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/analyticsConsent.test.js
 *
 * Sections A to J run the pure parts and pin the screens by reading their source,
 * the way scripts/onboardingSteps.test.ts pins its screen. Sections K and K2 run
 * the REAL Supabase sink, the facade, the consent store, the outbox
 * (a real SQLite) and the delete flow, with only the native edge stubbed at the
 * module loader (React Native, AsyncStorage, expo modules, the
 * RevenueCat SDK, fetch, the app database), the way scripts/purchasesBehavior.test.ts
 * runs purchases.ts. What must not leave the device is read from the fetch log, the
 * outbox and the console. The sink is compiled next to this file through
 * the type-only imports at the top; the process exits by itself because the sink
 * keeps a timer while the app is in the foreground.
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare const require: {
  (id: string): any;
  resolve(id: string): string;
  cache: Record<string, unknown>;
};
declare function setTimeout(fn: () => void, ms: number): unknown;

import {
  CONSENT_KEY,
  CONSENT_PROMPTED_KEY,
  LEGACY_OPT_OUT_KEY,
  consentFromLegacyOptOut,
  createConsentController,
  parseConsent,
  shouldShowConsentSheet,
  type ConsentState,
  type KeyValueStorage,
} from "../lib/analytics/consent";
import {
  LOG_KINDS,
  normalizeEventParams,
  normalizeLogKind,
  sanitizeEvent,
} from "../lib/analytics/eventSchema";
import {
  APP_USER_ID_HEADER,
  buildDeleteRequest,
  classifyDeleteStatus,
  isSendableAppUserId,
  runDeleteFlow,
  type DeleteResult,
} from "../lib/analytics/deleteDevice";
import { V24_CREATE_ANALYTICS_QUEUE } from "../lib/db/v24Sql";
// Type-only: it makes tsc compile the real sinks (and what they import) next to
// this file without loading them before the stubs in section K are in place.
import type * as FacadeApi from "../lib/analytics/index";
import type * as OptOutApi from "../lib/analytics/optOut";
import type * as ServerRecordsApi from "../lib/analytics/serverRecords";
import type * as SupabaseSinkApi from "../lib/analytics/supabaseSink";

interface Dirent {
  name: string;
  isDirectory: () => boolean;
}
const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
  readdirSync: (p: string, opts: { withFileTypes: true }) => Dirent[];
};
const nodePath = require("path") as {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => any;
};

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

/** JSON with sorted keys, so two objects compare equal whatever order they were built in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "undefined";
}

function eq<T>(name: string, actual: T, expected: T): void {
  ok(
    name,
    canonical(actual) === canonical(expected),
    `got ${canonical(actual)}, want ${canonical(expected)}`
  );
}
function section(title: string): void {
  console.log(`\n${title}`);
}
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const ROOT = (() => {
  const isRoot = (dir: string) =>
    fs.existsSync(nodePath.join(dir, "package.json")) &&
    fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"));
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (isRoot(dir)) return dir;
    dir = nodePath.dirname(dir);
  }
  if (isRoot(process.cwd())) return process.cwd();
  throw new Error("could not locate the repo root from " + __dirname);
})();

function src(rel: string): string {
  return fs.readFileSync(nodePath.join(ROOT, rel), "utf8");
}

/** Text from the first `from` marker up to the next `to` marker after it. */
function between(source: string, from: string, to: string): string {
  const a = source.indexOf(from);
  if (a === -1) return "";
  const b = source.indexOf(to, a + from.length);
  return b === -1 ? source.slice(a) : source.slice(a, b);
}

function listFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(nodePath.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") listFiles(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(rel);
    }
  }
}

/** An AsyncStorage stand-in that can be told to fail, and remembers what was asked of it. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const log: string[] = [];
  const failing = { read: false, write: false, remove: false };
  const storage: KeyValueStorage = {
    async getItem(key) {
      log.push(`get ${key}`);
      if (failing.read) throw new Error("read failed");
      return data.has(key) ? (data.get(key) as string) : null;
    },
    async setItem(key, value) {
      log.push(`set ${key}=${value}`);
      if (failing.write) throw new Error("write failed");
      data.set(key, value);
    },
    async removeItem(key) {
      log.push(`remove ${key}`);
      if (failing.remove) throw new Error("remove failed");
      data.delete(key);
    },
  };
  return { storage, data, log, failing };
}

async function rejects(job: () => Promise<unknown>): Promise<boolean> {
  try {
    await job();
    return false;
  } catch {
    return true;
  }
}

function rules(): void {
  section("A. the answer, read from what is stored");
  const stored: [string | null | undefined, ConsentState][] = [
    ["granted", "granted"],
    ["declined", "declined"],
    ["unanswered", "unanswered"],
    [null, "unanswered"],
    [undefined, "unanswered"],
    ["", "unanswered"],
    ["true", "unanswered"],
    ["GRANTED", "unanswered"],
    [" granted", "unanswered"],
    ["yes", "unanswered"],
  ];
  for (const [raw, want] of stored) {
    eq(`parseConsent(${JSON.stringify(raw)})`, parseConsent(raw), want);
  }

  const legacy: [string | null | undefined, ConsentState][] = [
    ["true", "declined"],
    ["false", "unanswered"],
    [null, "unanswered"],
    [undefined, "unanswered"],
    ["", "unanswered"],
    ["TRUE", "unanswered"],
    ["1", "unanswered"],
  ];
  for (const [raw, want] of legacy) {
    eq(`the old opt-out key ${JSON.stringify(raw)} becomes ${want}`, consentFromLegacyOptOut(raw), want);
  }

  eq("the keys", [CONSENT_KEY, LEGACY_OPT_OUT_KEY, CONSENT_PROMPTED_KEY], [
    "zerospike.analyticsConsent",
    "zerospike.analyticsOptOut",
    "zerospike.analyticsConsentPrompted",
  ]);

  section("B. the dashboard sheet is for installs that were never asked");
  const base = {
    ready: true,
    onboarded: true,
    state: "unanswered" as ConsentState | null,
    prompted: false as boolean | null,
    screenshotMode: false,
  };
  eq("onboarded, no answer, never asked: due", shouldShowConsentSheet(base), true);
  eq("not before the app is ready", shouldShowConsentSheet({ ...base, ready: false }), false);
  eq("not before onboarding is finished", shouldShowConsentSheet({ ...base, onboarded: false }), false);
  eq("not once granted", shouldShowConsentSheet({ ...base, state: "granted" }), false);
  eq("not to someone who already said no", shouldShowConsentSheet({ ...base, state: "declined" }), false);
  eq("not while the answer is still being read", shouldShowConsentSheet({ ...base, state: null }), false);
  eq("not once it was asked", shouldShowConsentSheet({ ...base, prompted: true }), false);
  eq("not while the asked flag is still being read", shouldShowConsentSheet({ ...base, prompted: null }), false);
  eq("not in screenshot mode", shouldShowConsentSheet({ ...base, screenshotMode: true }), false);
}

async function reading(): Promise<void> {
  section("C. the stored answer: first read, migration, trouble with storage");

  {
    const m = memoryStorage();
    const c = createConsentController(m.storage);
    eq("a fresh install is unanswered", await c.getConsent(), "unanswered");
    eq("and that is written down once", m.data.get(CONSENT_KEY), "unanswered");
    eq("the synchronous gate is closed", c.isGrantedNow(), false);
    const touched = m.log.length;
    await c.getConsent();
    eq("a second read is served from memory", m.log.length, touched);
  }

  {
    const m = memoryStorage({ [LEGACY_OPT_OUT_KEY]: "true" });
    const c = createConsentController(m.storage);
    eq("an opt-out under the old switch stays an answer: declined", await c.getConsent(), "declined");
    eq("it is written under the new key", m.data.get(CONSENT_KEY), "declined");
    eq("and the old key is gone", m.data.has(LEGACY_OPT_OUT_KEY), false);
    eq("declined is not granted", c.isGrantedNow(), false);
  }

  {
    const m = memoryStorage({ [LEGACY_OPT_OUT_KEY]: "false" });
    const c = createConsentController(m.storage);
    eq("a switch that was on is not an informed opt-in: unanswered", await c.getConsent(), "unanswered");
    eq("and the old key is gone", m.data.has(LEGACY_OPT_OUT_KEY), false);
  }

  {
    const m = memoryStorage({ [CONSENT_KEY]: "granted", [LEGACY_OPT_OUT_KEY]: "true" });
    const c = createConsentController(m.storage);
    eq("the new key wins over a leftover old one", await c.getConsent(), "granted");
    eq("and opens the synchronous gate", c.isGrantedNow(), true);
    ok("without a migration write", !m.log.some((l) => l.startsWith("set ")));
  }

  {
    const m = memoryStorage({ [CONSENT_KEY]: "maybe" });
    const c = createConsentController(m.storage);
    eq("an unreadable value is unanswered", await c.getConsent(), "unanswered");
    eq("and is not written over", m.data.get(CONSENT_KEY), "maybe");
  }

  {
    const m = memoryStorage({ [CONSENT_KEY]: "granted" });
    m.failing.read = true;
    const c = createConsentController(m.storage);
    eq("a storage read error counts as off", await c.getConsent(), "unanswered");
    eq("the gate stays closed", c.isGrantedNow(), false);
    ok("and nothing was written", !m.log.some((l) => l.startsWith("set ") || l.startsWith("remove ")));
    m.failing.read = false;
    eq("the error was not cached: the next read finds the real answer", await c.getConsent(), "granted");
    eq("and opens the gate", c.isGrantedNow(), true);
  }

  {
    const m = memoryStorage({ [LEGACY_OPT_OUT_KEY]: "true" });
    m.failing.write = true;
    const c = createConsentController(m.storage);
    eq("a migration that cannot be written still answers declined", await c.getConsent(), "declined");
    eq("the old key is kept", m.data.get(LEGACY_OPT_OUT_KEY), "true");
    eq("and nothing exists under the new key", m.data.has(CONSENT_KEY), false);
    m.failing.write = false;
    const again = createConsentController(m.storage);
    eq("the next launch lands on the same answer", await again.getConsent(), "declined");
    eq("and the migration completes then", m.data.get(CONSENT_KEY), "declined");
  }

  {
    // A set that arrives while the migration is still reading must not be overwritten by it.
    const m = memoryStorage({ [LEGACY_OPT_OUT_KEY]: "true" });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: KeyValueStorage = {
      ...m.storage,
      async getItem(key) {
        await gate;
        return m.storage.getItem(key);
      },
    };
    const c = createConsentController(slow);
    const first = c.getConsent();
    const second = c.setConsent("granted");
    release();
    eq("the migration reads declined", await first, "declined");
    await second;
    eq("the choice made meanwhile is what stays", m.data.get(CONSENT_KEY), "granted");
    eq("and is what is read afterwards", await c.getConsent(), "granted");
  }

  {
    // The same race, with the migration's own write as the slow step: without the
    // queue the late write would land last and put "declined" over the choice.
    const m = memoryStorage({ [LEGACY_OPT_OUT_KEY]: "true" });
    let releaseWrite: () => void = () => {};
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writes = 0;
    const slow: KeyValueStorage = {
      ...m.storage,
      async setItem(key, value) {
        if (writes++ === 0) await writeGate;
        return m.storage.setItem(key, value);
      },
    };
    const c = createConsentController(slow);
    const first = c.getConsent();
    const second = c.setConsent("granted");
    await tick();
    await tick();
    releaseWrite();
    eq("the migration still reads declined", await first, "declined");
    await second;
    eq("a slow migration write cannot overwrite a choice made while it ran", m.data.get(CONSENT_KEY), "granted");
    eq("and the old key is gone", m.data.has(LEGACY_OPT_OUT_KEY), false);
  }
}

async function writing(): Promise<void> {
  section("D. choosing: persistence, notifications, ordering");

  {
    const m = memoryStorage();
    const c = createConsentController(m.storage);
    const seen: string[] = [];
    c.onChange((enabled, change) => {
      seen.push(`${enabled}:${change.from}>${change.to}`);
    });
    await c.setConsent("granted");
    await c.settled();
    eq("unanswered to granted notifies as enabled", seen, ["true:unanswered>granted"]);
    eq("and is stored", m.data.get(CONSENT_KEY), "granted");
    eq("and opens the gate", c.isGrantedNow(), true);

    await c.setConsent("granted");
    await c.settled();
    eq("the same answer again does not notify", seen.length, 1);

    await c.setConsent("declined");
    await c.settled();
    eq("granted to declined notifies as disabled", seen[1], "false:granted>declined");
    eq("and closes the gate", c.isGrantedNow(), false);

    await c.setConsent("declined");
    await c.settled();
    eq("declined again does not notify", seen.length, 2);

    await c.setConsent("granted");
    await c.settled();
    eq("declined to granted notifies as enabled", seen[2], "true:declined>granted");
  }

  {
    const m = memoryStorage();
    const c = createConsentController(m.storage);
    const seen: string[] = [];
    c.onChange((enabled, change) => {
      seen.push(`${enabled}:${change.from}>${change.to}`);
    });
    await c.setConsent("declined");
    await c.settled();
    eq("unanswered to declined still tells the sinks, with where it came from", seen, ["false:unanswered>declined"]);
  }

  {
    const m = memoryStorage({ [CONSENT_KEY]: "declined", [LEGACY_OPT_OUT_KEY]: "true" });
    const c = createConsentController(m.storage);
    await c.setConsent("granted");
    eq("choosing removes a leftover old key", m.data.has(LEGACY_OPT_OUT_KEY), false);
    m.failing.remove = true;
    m.data.set(LEGACY_OPT_OUT_KEY, "true");
    await c.setConsent("declined");
    eq("a failed clean-up does not undo the choice", m.data.get(CONSENT_KEY), "declined");
  }

  {
    const m = memoryStorage();
    const c = createConsentController(m.storage);
    let calls = 0;
    c.onChange(() => {
      calls++;
    });
    await c.getConsent();
    m.failing.write = true;
    ok("a choice that cannot be stored throws", await rejects(() => c.setConsent("granted")));
    await c.settled();
    eq("the answer is unchanged", await c.getConsent(), "unanswered");
    eq("the gate stayed closed", c.isGrantedNow(), false);
    eq("and nobody was told", calls, 0);
  }

  {
    // The gate flips when the choice is stored, not when the sinks have finished reacting.
    const m = memoryStorage();
    const c = createConsentController(m.storage);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done = false;
    c.onChange(async () => {
      await gate;
      done = true;
    });
    await c.setConsent("granted");
    ok("the gate is open the moment setConsent resolves", c.isGrantedNow());
    ok("while the slow sink is still working", !done);
    release();
    await c.settled();
    ok("and settled() waits for it", done);
  }

  {
    const m = memoryStorage();
    const c = createConsentController(m.storage);
    const order: string[] = [];
    c.onChange(async (enabled) => {
      order.push(`a1:${enabled}`);
      await tick();
      order.push(`a2:${enabled}`);
    });
    c.onChange(() => {
      throw new Error("a sink that breaks");
    });
    const off = c.onChange((enabled) => {
      order.push(`c:${enabled}`);
    });
    await c.setConsent("granted");
    await c.setConsent("declined");
    await c.setConsent("granted");
    await c.settled();
    eq(
      "quick on, off, on: every sink hears all three, in order, one change at a time",
      order,
      ["a1:true", "a2:true", "c:true", "a1:false", "a2:false", "c:false", "a1:true", "a2:true", "c:true"]
    );
    off();
    await c.setConsent("declined");
    await c.settled();
    eq("an unsubscribed listener hears nothing more", order.filter((o) => o.startsWith("c:")).length, 3);
    ok("and the others still do", order.includes("a1:false") && order.length > 9);
  }

  section("E. the asked flag");
  {
    const m = memoryStorage();
    const c = createConsentController(m.storage);
    eq("never asked", await c.hasPrompted(), false);
    await c.markPrompted();
    eq("asked", await c.hasPrompted(), true);
    eq("stored", m.data.get(CONSENT_PROMPTED_KEY), "1");
    eq("asking does not answer", await c.getConsent(), "unanswered");
    eq("and does not open the gate", c.isGrantedNow(), false);
    m.failing.read = true;
    eq("an unreadable flag reads as asked, so a flaky store never loops the question", await c.hasPrompted(), true);
    const m2 = memoryStorage();
    m2.failing.write = true;
    ok("a flag that cannot be written throws", await rejects(() => createConsentController(m2.storage).markPrompted()));
  }
}

function kinds(): void {
  section("F. log kinds fold into glucose, meal or other");
  eq("LOG_KINDS", [...LOG_KINDS], ["glucose", "meal", "other"]);

  const cases: [unknown, string | undefined][] = [
    ["glucose", "glucose"],
    ["meal", "meal"],
    ["other", "other"],
    ["injection", "other"],
    ["basal", "other"],
    ["bolus", "other"],
    ["med", "other"],
    ["health_import", "other"],
    ["Glucose", "other"],
    ["two words", undefined],
    ["142", undefined],
    ["", undefined],
    [142, undefined],
    [null, undefined],
    [undefined, undefined],
    [true, undefined],
    ["x".repeat(65), undefined],
    ["Öğün", undefined],
  ];
  for (const [given, want] of cases) {
    eq(`normalizeLogKind(${JSON.stringify(given)})`, normalizeLogKind(given), want);
  }

  const params = { kind: "basal", source: "x" };
  eq("log_added folds the kind and keeps the rest", normalizeEventParams("log_added", params), {
    kind: "other",
    source: "x",
  });
  eq("the caller's object is left alone", params, { kind: "basal", source: "x" });
  for (const name of ["first_log", "log_added", "log_edited"]) {
    eq(`${name} is folded`, normalizeEventParams(name, { kind: "med" }), { kind: "other" });
  }
  eq("a kind that is a sentence is removed", normalizeEventParams("log_added", { kind: "two words", n: 1 }), { n: 1 });
  eq("a numeric kind is removed", normalizeEventParams("log_edited", { kind: 142 }), {});
  eq("a null kind is removed", normalizeEventParams("log_added", { kind: null }), {});
  eq("other events are untouched", normalizeEventParams("paywall_view", { kind: "basal", source: "x" }), {
    kind: "basal",
    source: "x",
  });
  eq("no params stay no params", normalizeEventParams("log_added", undefined), undefined);
  eq("an event without a kind passes as it is", normalizeEventParams("log_added", { source: "template" }), {
    source: "template",
  });

  // The whole chain a call site goes through: logEvent folds, the sink sanitizes.
  for (const given of ["glucose", "meal", "injection", "basal", "med", "health_import"]) {
    for (const name of ["log_added", "log_edited"]) {
      const res = sanitizeEvent(name, normalizeEventParams(name, { kind: given }));
      const sent = res.ok ? res.props.kind : undefined;
      ok(
        `${name} ${given} leaves the device as one of the three kinds`,
        typeof sent === "string" && (LOG_KINDS as readonly string[]).includes(sent),
        `got ${String(sent)}`
      );
    }
  }
  const first = sanitizeEvent("first_log", normalizeEventParams("first_log", { kind: "injection" }));
  eq("first_log folds too", first.ok ? first.props.kind : undefined, "other");

  // The few values only an insulin user can produce fold the same way: the
  // paywall entry of the injection tab, and the Spike button that opens it.
  const paywall = { source: "rotation", trial_eligible: true, context: "inapp" };
  eq("the rotation paywall source leaves as 'feature'", normalizeEventParams("paywall_view", paywall), {
    source: "feature",
    trial_eligible: true,
    context: "inapp",
  });
  eq("and so does a rotation context", normalizeEventParams("paywall_view", { source: "direct", context: "rotation" }), {
    source: "direct",
    context: "feature",
  });
  eq("the caller's paywall params are left alone", paywall, { source: "rotation", trial_eligible: true, context: "inapp" });
  for (const name of ["paywall_dismiss", "purchase_completed"]) {
    eq(`${name} folds the same source`, normalizeEventParams(name, { source: "rotation" }), { source: "feature" });
  }
  for (const source of [
    "health", "foods", "profiles", "mealResponse", "spike", "insights", "export", "settings", "after_logs", "direct",
    "winback", "downsell", "feature", "Rotation", "constructor", "__proto__",
  ]) {
    eq(`paywall source ${source} is not touched`, normalizeEventParams("paywall_view", { source }), { source });
  }
  eq("the injection map action leaves as open_feature", normalizeEventParams("spike_action_tap", { action: "open_injection_map" }), {
    action: "open_feature",
  });
  for (const action of ["open_reminders", "start_meal_timer", "connect_health", "open_insights", "open_widget_guide", "open_journal"]) {
    eq(`Spike action ${action} is not touched`, normalizeEventParams("spike_action_tap", { action }), { action });
  }
  eq("a folded value on an event that never had one stays", normalizeEventParams("downsell_view", { trigger: "rotation" }), {
    trigger: "rotation",
  });
  eq("a non-string value is not folded", normalizeEventParams("paywall_view", { source: 1 }), { source: 1 });
  eq("a missing field adds nothing", normalizeEventParams("paywall_view", { trial_eligible: false }), { trial_eligible: false });
  for (const [name, params] of [
    ["paywall_view", { source: "rotation", trial_eligible: true, context: "rotation" }],
    ["paywall_dismiss", { source: "rotation" }],
    ["purchase_completed", { tier: "annual", source: "rotation" }],
    ["spike_action_tap", { action: "open_injection_map" }],
  ] as [string, Record<string, string | boolean>][]) {
    const res = sanitizeEvent(name, normalizeEventParams(name, params));
    const wire = res.ok ? JSON.stringify(res.props) : "";
    ok(`${name} puts no 'rotation' or injection map on the wire`, res.ok && !/rotation|injection/.test(wire), wire);
  }
  const used = sanitizeEvent("carb_estimate_used", {
    tier: "free",
    item_count: 3,
    source: "food_tab",
    text: "2 slices of bread",
    grams_carb: 48,
    total_grams_carb: 48.5,
  });
  ok("a carb estimate event carries tier, count and source only", used.ok && Object.keys(used.props).sort().join() === "item_count,source,tier", JSON.stringify(used));
  ok("meal text and grams are stripped", used.ok && used.issues.filter((i) => i.includes("(dropped)")).length === 3, JSON.stringify(used.issues));
  const blocked = sanitizeEvent("carb_estimate_blocked", { reason: "a long sentence about bread" });
  ok("a blocked reason outside the closed set is dropped", blocked.ok && !("reason" in blocked.props));
}

async function deletion(): Promise<void> {
  section("G. delete my server records");
  const id = "0b1f6a52-3c1e-4e0e-9a0e-2f7b2f2a9d11";
  const req = buildDeleteRequest(id);
  eq("a POST", req.method, "POST");
  eq("the installation ID travels as x-device-id", req.headers["x-device-id"], id);
  eq("as JSON", req.headers["Content-Type"], "application/json");
  eq("with an empty body", req.body, "{}");
  eq("and nothing else in the headers", Object.keys(req.headers).sort(), ["Content-Type", "x-device-id"]);

  // The RevenueCat app user id lets the function find the subscription events
  // that never carried the installation ID.
  const rcId = "$RCAnonymousID:0123456789abcdef0123456789abcdef";
  const withRc = buildDeleteRequest(id, rcId);
  eq("that header is called x-rc-app-user-id", APP_USER_ID_HEADER, "x-rc-app-user-id");
  eq("the app user id travels in it", withRc.headers[APP_USER_ID_HEADER], rcId);
  eq("and nothing else changes", Object.keys(withRc.headers).sort(), ["Content-Type", "x-device-id", "x-rc-app-user-id"]);
  eq("the installation ID is still sent with it", withRc.headers["x-device-id"], id);
  for (const missing of [undefined, null, ""]) {
    eq(`${JSON.stringify(missing)} leaves the header out`, APP_USER_ID_HEADER in buildDeleteRequest(id, missing).headers, false);
  }
  const fits: [unknown, boolean][] = [
    [rcId, true],
    ["a", true],
    ["a".repeat(128), true],
    ["a".repeat(129), false],
    ["", false],
    ["has a space", false],
    [" leading", false],
    ["tab\there", false],
    ["line\nbreak", false],
    ["café", false],
    ["١٢", false],
    [42, false],
    [null, false],
    [undefined, false],
  ];
  for (const [value, want] of fits) {
    eq(`isSendableAppUserId(${JSON.stringify(value)})`, isSendableAppUserId(value), want);
  }
  eq(
    "an id the function would refuse is left out of the request instead of failing the deletion",
    APP_USER_ID_HEADER in buildDeleteRequest(id, "has a space").headers,
    false
  );

  for (const status of [200, 201, 202, 204, 299]) {
    eq(`${status} is deleted`, classifyDeleteStatus(status), { ok: true });
  }
  for (const status of [400, 401, 403, 404, 405, 413, 422]) {
    eq(`${status} is rejected`, classifyDeleteStatus(status), { ok: false, reason: "rejected" });
  }
  for (const status of [0, 301, 408, 409, 429, 500, 502, 503, 504]) {
    eq(`${status} means try again later`, classifyDeleteStatus(status), { ok: false, reason: "unavailable" });
  }

  {
    const calls: string[] = [];
    const result = await runDeleteFlow({
      clearQueue: async () => {
        await tick();
        calls.push("clear");
      },
      post: async () => {
        calls.push("post");
        return { ok: true };
      },
    });
    eq("the outbox is emptied, the server asked, the outbox emptied again", calls, ["clear", "post", "clear"]);
    eq("and the result is the server's", result, { ok: true });
  }
  {
    const calls: string[] = [];
    const failure: DeleteResult = { ok: false, reason: "unavailable" };
    const result = await runDeleteFlow({
      clearQueue: async () => {
        calls.push("clear");
      },
      post: async () => {
        calls.push("post");
        return failure;
      },
    });
    eq("a failed deletion does not clear again", calls, ["clear", "post"]);
    eq("and reports why", result, failure);
  }

  // The full order: nothing may be uploading while the server deletes, and
  // The after-delete hook only runs after the server said yes.
  const wired = (calls: string[], post: () => Promise<DeleteResult>, extra: object = {}) => ({
    pauseSending: async () => {
      calls.push("pause");
      await tick();
      calls.push("paused");
      return () => {
        calls.push("resume");
      };
    },
    clearQueue: async () => {
      calls.push("clear");
    },
    post: async () => {
      calls.push("post");
      return post();
    },
    afterDeleted: async () => {
      calls.push("forget");
    },
    ...extra,
  });
  {
    const calls: string[] = [];
    const result = await runDeleteFlow(wired(calls, async () => ({ ok: true })));
    eq(
      "uploads stop and settle first, then the outbox is cleared, the server asked, the outbox cleared again, the hook run, uploads resumed",
      calls,
      ["pause", "paused", "clear", "post", "clear", "forget", "resume"]
    );
    eq("and the result is the server's", result, { ok: true });
  }
  {
    const calls: string[] = [];
    const failure: DeleteResult = { ok: false, reason: "unavailable" };
    const result = await runDeleteFlow(wired(calls, async () => failure));
    eq("a failed deletion skips the hook and still lets uploads go on", calls, ["pause", "paused", "clear", "post", "resume"]);
    eq("and reports why", result, failure);
  }
  {
    const calls: string[] = [];
    const result = await runDeleteFlow(
      wired(calls, async () => ({ ok: true }), {
        afterDeleted: async () => {
          calls.push("forget");
          throw new Error("native module missing");
        },
      })
    );
    eq("an after-delete hook that fails changes nothing", result, { ok: true });
    eq("and uploads still resume", calls[calls.length - 1], "resume");
  }
  {
    const calls: string[] = [];
    const result = await runDeleteFlow(
      wired(calls, async () => ({ ok: true }), {
        pauseSending: async () => {
          calls.push("pause");
          throw new Error("no sink");
        },
      })
    );
    eq("an uploader that cannot be paused does not keep the person from deleting", calls, ["pause", "clear", "post", "clear", "forget"]);
    eq("and the deletion counts", result, { ok: true });
  }
  {
    const calls: string[] = [];
    ok(
      "a request that throws still lets uploads resume",
      await rejects(() =>
        runDeleteFlow(
          wired(calls, async () => {
            throw new Error("boom");
          })
        )
      )
    );
    eq("and the order up to there held", calls, ["pause", "paused", "clear", "post", "resume"]);
  }
}

function firstLogSql(): void {
  section("H. first_log counts one kind of entry per kind, with a real SQLite");
  const source = src("lib/services/firstLog.ts");
  const block = between(source, "const COUNT_SQL", "};");
  const sql = new Map<string, string>();
  const re = /(\w+):\s*"(SELECT[^"]+)"/g;
  for (let m = re.exec(block); m; m = re.exec(block)) sql.set(m[1], m[2]);
  eq("one count per log kind", [...sql.keys()].sort(), [...LOG_KINDS].sort());

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sugar_logs (id INTEGER PRIMARY KEY, source TEXT);");
  db.exec("CREATE TABLE meal_logs (id INTEGER PRIMARY KEY);");
  db.exec("CREATE TABLE injection_logs (id INTEGER PRIMARY KEY);");
  db.exec("CREATE TABLE med_logs (id INTEGER PRIMARY KEY);");
  const count = (kind: string): number =>
    (db.prepare(sql.get(kind) as string).get() as { c: number }).c;
  const add = (table: string, n: number, source?: string) => {
    for (let i = 0; i < n; i++) {
      if (table === "sugar_logs") db.prepare("INSERT INTO sugar_logs (source) VALUES (?);").run(source ?? "manual");
      else db.prepare(`INSERT INTO ${table} DEFAULT VALUES;`).run();
    }
  };

  eq("an empty install has none", [count("glucose"), count("meal"), count("other")], [0, 0, 0]);
  add("sugar_logs", 2, "health");
  eq("a Health import is not an entry the user made", count("glucose"), 0);
  add("sugar_logs", 1, "manual");
  eq("one manual reading is one", count("glucose"), 1);
  add("sugar_logs", 4, "manual");
  eq("capped at two, enough to tell first from not first", count("glucose"), 2);
  add("meal_logs", 3);
  eq("meals are capped the same way", count("meal"), 2);
  add("injection_logs", 1);
  eq("an injection is an 'other' entry", count("other"), 1);
  add("med_logs", 1);
  eq("and so is a medication entry, in the same count", count("other"), 2);
  add("injection_logs", 5);
  eq("capped at two across both tables", count("other"), 2);
  db.close();

  const db2 = new DatabaseSync(":memory:");
  db2.exec("CREATE TABLE injection_logs (id INTEGER PRIMARY KEY);");
  db2.exec("CREATE TABLE med_logs (id INTEGER PRIMARY KEY);");
  db2.prepare("INSERT INTO med_logs DEFAULT VALUES;").run();
  eq("medication alone counts as one", (db2.prepare(sql.get("other") as string).get() as { c: number }).c, 1);
  db2.close();

  ok("noteFirstLog folds through the shared rule", /const kind = firstLogKindOf\(logged\);/.test(source));
  ok(
    "the call sites keep their own kinds",
    /export type LoggedKind = "glucose" \| "meal" \| "injection" \| "med" \| "basal";/.test(source)
  );
}

function wiring(): void {
  section("I. wiring: sinks, screens, config");

  const opt = src("lib/analytics/optOut.ts");
  for (const name of [
    "ANALYTICS_OPT_OUT_KEY",
    "isAnalyticsOptedOut",
    "getAnalyticsEnabled",
    "onAnalyticsEnabledChange",
    "setAnalyticsEnabled",
  ]) {
    ok(`optOut still exports ${name}`, new RegExp(`export (async function|function|const) ${name}\\b`).test(opt));
  }
  ok("getAnalyticsEnabled keeps its signature", /export async function getAnalyticsEnabled\(\): Promise<boolean>/.test(opt));
  ok("and is on only for granted", /\(await consent\.getConsent\(\)\) === "granted"/.test(opt));
  ok("the controller runs on AsyncStorage", opt.includes("createConsentController(AsyncStorage)"));
  ok("the sync gate is exported", /export function isAnalyticsEnabledNow\(\): boolean/.test(opt));

  const sink = src("lib/analytics/supabaseSink.ts");
  ok("the Supabase sink gates on the shared synchronous consent", sink.includes("isAnalyticsEnabledNow()"));
  ok("no private on-by-default flag is left", !/let enabled = true/.test(sink));
  ok("the flusher sends only while granted", /canSend: \(\) => ready && isEnabled\(\)/.test(sink));
  ok("events are persisted only while granted", /if \(isEnabled\(\)\) persist\(/.test(sink));
  ok(
    "and are not even buffered in memory once the answer is known to be no",
    /if \(consentSettled && !isEnabled\(\)\) return;/.test(sink)
  );
  ok(
    "an install that is not opted in has its outbox emptied at start",
    /if \(!isEnabled\(\)\) \{[\s\S]{0,500}await clearQueue\(\);/.test(sink)
  );
  ok(
    "switching off sends nothing about it: no opt-out signal, and the only request the sink makes is the flusher's batch",
    !/sendOptOutSignal|OPT_OUT_SIGNAL|enabled: false/.test(sink) && (sink.match(/postBatch\(/g) ?? []).length === 1
  );
  ok("the flusher also holds still while the delete button runs", /canSend: \(\) => ready && isEnabled\(\) && !paused/.test(sink));
  ok("the outbox clearer is exported for the delete button", /export async function clearAnalyticsQueue\(\)/.test(sink));
  ok("and so is the uploads pause", /export async function pauseAnalyticsSending\(\): Promise<\(\) => void>/.test(sink));
  ok(
    "the pause joins the batch in flight before it returns",
    /paused = true;\s*await flusher\.flush\(\);\s*return \(\) => \{\s*paused = false;/.test(sink)
  );


  const app = JSON.parse(src("app.json")) as {
    expo: {
      plugins: unknown[];
      extra: Record<string, string>;
      ios: { privacyManifests: { NSPrivacyTracking: boolean; NSPrivacyCollectedDataTypes: Record<string, any>[] } };
    };
  };
  ok("app.json installs no Firebase plugin", !JSON.stringify(app.expo.plugins).toLowerCase().includes("firebase"));
  ok("app.json names no Google services file", !JSON.stringify(app.expo).includes("googleServicesFile"));
  eq(
    "app.json carries the delete-device URL",
    app.expo.extra.deleteDeviceFnUrl,
    "https://jcpepqectdubbmchhdsn.supabase.co/functions/v1/delete-device"
  );

  const manifest = app.expo.ios.privacyManifests;
  const byType = new Map<string, Record<string, any>>();
  for (const entry of manifest.NSPrivacyCollectedDataTypes) {
    byType.set(String(entry.NSPrivacyCollectedDataType).replace("NSPrivacyCollectedDataType", ""), entry);
  }
  eq("nothing is tracking", manifest.NSPrivacyTracking, false);
  eq(
    "the twelve declared types",
    [...byType.keys()].sort(),
    ["AdvertisingData", "DeviceID", "EmailAddress", "Health", "OtherDiagnosticData", "OtherUsageData", "OtherUserContent", "PerformanceData", "ProductInteraction", "PurchaseHistory", "SearchHistory", "UserID"]
  );
  ok("no CrashData type", !byType.has("CrashData"));
  eq("Health is for app functionality only", byType.get("Health")?.NSPrivacyCollectedDataTypePurposes, ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]);
  for (const type of ["Health", "PurchaseHistory", "UserID", "AdvertisingData", "ProductInteraction", "OtherUsageData", "DeviceID", "PerformanceData", "OtherDiagnosticData", "OtherUserContent", "EmailAddress"]) {
    eq(`${type} is linked`, byType.get(type)?.NSPrivacyCollectedDataTypeLinked, true);
  }
  for (const type of ["SearchHistory"]) {
    eq(`${type} is not linked`, byType.get(type)?.NSPrivacyCollectedDataTypeLinked, false);
  }
  ok(
    "no type is used for tracking",
    [...byType.values()].every((e) => e.NSPrivacyCollectedDataTypeTracking === false)
  );
  const docPath = "docs/apple-ads/privacy-2.3.7.md";
  if (fs.existsSync(nodePath.join(ROOT, docPath))) {
    const block = /```json\n([\s\S]*?)```/.exec(between(src(docPath), "## 3. app.json privacy manifest", "## 4. Google Play"));
    if (block) {
      const proposed = (JSON.parse("{" + block[1] + "}") as { privacyManifests: unknown }).privacyManifests;
      eq("the manifest is the one in the 2.3.7 privacy doc, section 3", manifest, proposed);
    }
  }

  const onb = src("app/onboarding.tsx");
  ok("the analytics switch starts off until the stored answer is read", /const \[analyticsOptIn, setAnalyticsOptIn\] = useState\(false\);/.test(onb) && onb.includes("setAnalyticsOptIn(state === \"granted\")"));
  const analyticsStep = between(onb, 'case "analytics":', "// ── Per-step footer");
  ok("the analytics step shows it", analyticsStep.includes("<ConsentSwitchRow") && analyticsStep.includes("analyticsOptIn"));
  ok("the disclaimer is no longer a step and the reveal does not carry it", !onb.includes('case "disclaimer":') && !/<ConsentSwitchRow/.test(between(onb, "{phase === \"reveal\" ? (", "{phase === \"quiz\" ? (")));
  const footer = between(onb, 'if (step === "analytics") {', "// Two explicit paths");
  ok("Continue on the analytics step runs the consent write", footer.includes("continueFromAnalytics") && !/disabled/.test(footer));
  const cont = between(onb, "async function continueFromAnalytics", "function hintFor");
  ok(
    "only an explicit on is recorded",
    /const stored = await getAnalyticsConsent\(\);\s*if \(wantOn && stored !== "granted"\) \{\s*await setAnalyticsConsent\("granted"\);/.test(onb)
  );
  ok(
    "declined is written only to withdraw a stored grant, from the freshly read state",
    (onb.match(/setAnalyticsConsent\("declined"\)/g) ?? []).length === 1 &&
      /else if \(!wantOn && stored === "granted"\) \{\s*await setAnalyticsConsent\("declined"\);/.test(onb)
  );
  ok("a failed write stops Continue and shows the error", /if \(!\(await syncConsent\(analyticsOptIn\)\)\) return;/.test(cont) && onb.includes('toast(t("common.saveFailed"), "error")'));
  ok("the switch writes as it moves and is disabled until loaded", onb.includes("void toggleAnalytics(next)") && onb.includes("disabled={!consentLoaded || savingConsent}"));
  ok(
    "a synchronous busy ref guards both handlers and Continue waits for the stored read",
    (onb.match(/if \(consentBusy\.current/g) ?? []).length === 2 &&
      (onb.match(/consentBusy\.current = false;/g) ?? []).length === 2 &&
      footer.includes("loading={savingConsent || !consentLoaded}")
  );
  ok("the question counts as asked either way", cont.includes("await markAnalyticsConsentPrompted();"));
  const finish = between(onb, "async function finishToReveal", "function goToDashboard");
  ok("finishing no longer touches consent", !/setAnalyticsConsent|markAnalyticsConsentPrompted/.test(finish));
  ok("onboarding_done is still sent at the end, from the reveal's continue", between(onb, "async function goToDashboard", "router.replace").includes('logEvent("onboarding_done"'));
  ok("the analytics step is the first quiz step", /BASE_STEPS[^\n]*\["analytics"/.test(src("lib/onboardingSteps.ts")));

  const sheet = src("lib/analytics/ConsentSheet.tsx");
  ok("the sheet is a SheetShell like the others", sheet.includes("<SheetShell"));
  ok("it decides through the shared rule", sheet.includes("shouldShowConsentSheet("));
  ok("never in screenshot mode", sheet.includes("isScreenshotMode()"));
  ok("only while the dashboard is in front", sheet.includes("useFocusEffect"));
  ok(
    "close, backdrop and back all mean not now",
    /onClose=\{\(\) => void answer\(false\)\}/.test(sheet) &&
      /label=\{t\("settings\.analytics\.sheetDecline"\)\}[\s\S]{0,120}onPress=\{\(\) => void answer\(false\)\}/.test(sheet)
  );
  ok(
    "only Turn on records consent",
    (sheet.match(/setAnalyticsConsent\(/g) ?? []).length === 1 && sheet.includes('setAnalyticsConsent("granted")')
  );
  ok("declined is never written from the sheet", !sheet.includes('"declined"'));
  ok(
    "a failed write closes it without marking it asked",
    /recorded = false/.test(sheet) && /if \(recorded\) \{[\s\S]{0,160}markAnalyticsConsentPrompted\(\)/.test(sheet)
  );

  const dash = src("app/(tabs)/index.tsx");
  ok(
    "the dashboard mounts the sheet once",
    (dash.match(/<AnalyticsConsentSheet \/>/g) ?? []).length === 1 &&
      dash.includes('import { AnalyticsConsentSheet } from "../../lib/analytics/ConsentSheet";')
  );

  const data = src("app/settings/data.tsx");
  ok("the switch records granted or declined", /const next: ConsentChoice = value \? "granted" : "declined";/.test(data));
  ok("and reads on only for granted", /analyticsConsent === "granted"/.test(data));
  ok("the installation ID comes from getDeviceId", data.includes("getDeviceId()") && data.includes('id === "unknown" ? null : id'));
  ok("and can be copied by press and hold, or shared", data.includes("selectable") && data.includes("Share.share({ message: installId })"));
  ok("it is pinned left to right", data.includes('writingDirection: "ltr"'));
  const del = between(data, "async function onDeleteServerRecords", "// Opt-in");
  ok("deletion asks first, as a destructive action", del.includes("destructive: true") && del.indexOf("await confirm(") !== -1 && del.indexOf("await confirm(") < del.indexOf("deleteMyServerRecords()"));
  ok("success and failure each have their own text", del.includes("settings.analytics.deleteDone") && del.includes("settings.analytics.deleteFailed"));
  const deleteRow = between(data, "onPress={onDeleteServerRecords}", "</Pressable>");
  ok(
    "the row has the danger look and its sub line may take two lines (German at 130% font size was cut off)",
    deleteRow.includes('accessibilityLabel={t("settings.analytics.deleteRow")}') &&
      (deleteRow.match(/GLUCOSE_RICH\.low/g) ?? []).length >= 3 &&
      /numberOfLines=\{2\}>\s*\{t\("settings\.analytics\.deleteSub"\)\}/.test(deleteRow)
  );
  ok("while it runs the row shows the hourglass", /deletingServer \? \(\s*<Ionicons name="hourglass-outline"/.test(deleteRow));

  const records = src("lib/analytics/serverRecords.ts");
  ok(
    "the button runs the delete flow: pause, outbox, server",
    /runDeleteFlow\(\{\s*pauseSending: pauseAnalyticsSending,\s*clearQueue: clearAnalyticsQueue,\s*post: \(\) => postDeleteDevice\(\),\s*\}\)/.test(records)
  );
  const transport = src("lib/analytics/transport.ts");
  ok("the delete URL is read from app config", transport.includes(".deleteDeviceFnUrl as string | undefined"));
  ok("the request is the pure builder's, with the RevenueCat app user id", transport.includes("...buildDeleteRequest(id, appUserId)"));
  ok(
    "the app user id is read from the SDK only once it is configured, and the read is bounded",
    /isConfigured\(\)\) \? await purchases\.getAppUserID\(\)/.test(transport) && transport.includes("APP_USER_ID_TIMEOUT_MS")
  );
  ok("track still carries the device ID as x-device-id", /"x-device-id": id/.test(transport));

  // The two ends of the deletion agree on the header and on what an id may look like.
  const fn = src("supabase/functions/delete-device/index.ts");
  const idPattern = /const APP_USER_ID = (\/\^[^;]+\$\/);/;
  const clientPattern = idPattern.exec(src("lib/analytics/deleteDevice.ts"));
  const serverPattern = idPattern.exec(fn);
  ok("the function reads the header the app sends", fn.includes(`req.headers.get("${APP_USER_ID_HEADER}")`));
  ok("and checks an id with the same pattern", !!clientPattern && !!serverPattern && clientPattern[1] === serverPattern[1]);
  ok(
    "a bad id is a 400 before anything is touched",
    fn.includes('error: "bad_app_user_id"') && fn.indexOf('error: "bad_app_user_id"') < fn.indexOf("= serviceCreds()")
  );
  ok("the function calls the v2 RPC with both ids", /"rpc\/delete_device_data_v2",\s*\{\s*p_device_id: deviceId,\s*p_app_user_id: appUserId,/.test(fn));
  ok("and no longer claims the app renews its install id", !/renews its install id/.test(fn));

  // The SQL behind it. What these migrations do was run against a real Postgres
  // (supabase/postgres 17); here only their shape is pinned.
  const v2 = src("supabase/migrations/20261006143000_delete_device_data_v2.sql");
  ok("delete_device_data_v2 takes the app user id and defaults it to null", /delete_device_data_v2\(\s*p_device_id text,\s*p_app_user_id text default null\s*\)/.test(v2));
  ok(
    "it matches subscription events on the device id or on either app user id column",
    /device_id = p_device_id\s*or \(v_user is not null and \(app_user_id = v_user or original_app_user_id = v_user\)\)/.test(v2)
  );
  ok("a blank id matches nothing", /nullif\(btrim\(coalesce\(p_app_user_id, ''\)\), ''\)/.test(v2));
  ok(
    "only the service role may run it",
    v2.includes("revoke all on function public.delete_device_data_v2(text, text) from public, anon, authenticated;") &&
      v2.includes("grant execute on function public.delete_device_data_v2(text, text) to service_role;")
  );
  const retention = src("supabase/migrations/20261006110710_subscription_events_retention.sql");
  ok(
    "the first delete function is left as it was, for the function version still deployed",
    retention.includes("create or replace function public.delete_device_data(p_device_id text)") && !retention.includes("delete_device_data_v2")
  );
  const cron = src("supabase/migrations/20261006143100_cron_enable.sql");
  ok("pg_cron is enabled by the migration, not only looked for", cron.includes("create extension if not exists pg_cron;"));
  for (const [name, schedule, command] of [
    ["purge-app-events", "17 3 * * *", "select public.purge_app_events(180)"],
    ["purge-spike-logs", "17 3 * * *", "select public.purge_spike_logs()"],
    ["purge-subscription-events", "27 3 * * *", "select public.purge_subscription_events(24, 90)"],
  ]) {
    ok(`the retention job ${name} is scheduled`, cron.includes(`cron.schedule('${name}', '${schedule}', '${command}')`));
  }
  ok(
    "a job of the same name, or the old Spike job name, is unscheduled first, so a re-run leaves one of each",
    cron.includes("cron.unschedule(v_job)") && cron.includes("'spike-logs-retention'") && cron.indexOf("cron.unschedule") < cron.indexOf("cron.schedule(")
  );
  ok(
    "the earlier migrations keep their own conditional blocks",
    [
      "supabase/migrations/20261006094929_app_events.sql",
      "supabase/migrations/20261006095331_spike_calls.sql",
      "supabase/migrations/20261006110710_subscription_events_retention.sql",
    ].every((f) => src(f).includes("if exists (select 1 from pg_extension where extname = 'pg_cron')"))
  );

  const all: string[] = [];
  for (const dir of ["app", "components", "lib"]) listFiles(dir, all);
  const users = all.filter((f) => !f.startsWith("lib/i18n/") && src(f).includes("paywall.subtitle"));
  eq("nothing reads paywall.subtitle", users, []);
}

function copy(): void {
  section("J. the words, in nine languages");
  const LANGS = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  const banned: Record<string, RegExp> = {
    en: /alarm|alert|warn|diagnos|treat|dose|dosage/i,
    tr: /uyar|alarm|\btanı|tedavi|doz/i,
    de: /alarm|warn|diagnos|behandl|dosis|dosier/i,
    fr: /alarme|alerte|avertit|diagnos|traite|dose/i,
    es: /alarma|alerta|avisa|diagnos|trata|dosis/i,
    it: /allarme|avvis|diagnos|tratta|dose/i,
    pt: /alarme|alerta|avisa|diagnos|trata|dose/i,
    ar: /تنبيه|إنذار|ينبه|يحذر|يشخص|يعالج|جرعة/,
    ja: /アラーム|警報|警告|診断|治療|用量/,
  };
  // One formal address per language: the informal pronouns and possessives must be absent.
  const informal: Record<string, RegExp> = {
    en: /$^/,
    tr: /\b(senin|sen|sana|seni)\b/i,
    de: /\b(du|dein|deine|deinen|deinem|dir|dich)\b/i,
    fr: /(?<![\p{L}])(tu|ton|ta|tes|toi|te)(?![\p{L}])/iu,
    es: /\b(tú|tu|tus|ti|contigo)\b/i,
    it: /\b(tu|tuo|tua|tuoi|tue)\b/i,
    pt: /\b(tu|teu|tua|teus|tuas)\b/i,
    ar: /$^/,
    ja: /$^/,
  };
  const whileOn: Record<string, RegExp> = {
    en: /while usage analytics is on/i,
    tr: /Kullanım analitiği açıkken/,
    de: /Solange die Nutzungsanalyse aktiviert ist/,
    fr: /Tant que les statistiques d'utilisation sont activées/,
    es: /Mientras la analítica de uso esté activada/,
    it: /Finché l'analisi di utilizzo è attiva/,
    pt: /Enquanto a análise de uso estiver ativada/,
    ar: /وما دامت تحليلات الاستخدام مفعّلة/,
    ja: /「利用状況の分析」がオンの間/,
  };
  const usageEventsWord: Record<string, RegExp> = {
    en: /usage events/i,
    tr: /kullanım olayları/,
    de: /Nutzungsereignisse/,
    fr: /événements d'utilisation/,
    es: /eventos de uso/,
    it: /eventi di utilizzo/,
    pt: /eventos de uso/,
    ar: /أحداث الاستخدام/,
    ja: /利用イベント/,
  };
  // The words of the usage analytics switch itself are held to the same rules as
  // the strings around it.
  const analyticsKeys = [
    "section",
    "title",
    "hint",
    "installId",
    "installIdHint",
    "installIdShare",
    "deleteRow",
    "deleteSub",
    "deleteConfirmTitle",
    "deleteConfirmBody",
    "deleteDone",
    "deleteFailed",
    "sheetTitle",
    "sheetAccept",
    "sheetDecline",
  ];
  for (const lang of LANGS) {
    const text = src(`lib/i18n/locales/${lang}.ts`);
    const strings: [string, string][] = [];
    for (const key of ["analyticsConsentTitle", "analyticsConsentBody", "qAnalytics", "analyticsHelpCollect", "analyticsHelpNever", "analyticsHelpOff", "analyticsShort1", "analyticsShort2", "analyticsShort3", "analyticsDetails"]) {
      const m = new RegExp(`\\n {4}${key}: "([^"]+)"`).exec(text);
      ok(`${lang} has onboarding.${key}`, m !== null);
      if (m) strings.push([`onboarding.${key}`, m[1]]);
    }
    const block = /\n {4}analytics: \{([\s\S]*?)\n {4}\},/.exec(text);
    ok(`${lang} has settings.analytics`, block !== null);
    if (block) {
      for (const key of analyticsKeys) {
        const m = new RegExp(`\\n {6}${key}: "([^"]+)"`).exec(block[1]);
        ok(`${lang} has settings.analytics.${key}`, m !== null);
        if (m) strings.push([`settings.analytics.${key}`, m[1]]);
      }
    }
    // Other strings that say what leaves the device and under which store terms.
    const field = (key: string): string =>
      new RegExp(`\\n {4}${key}: "((?:[^"\\\\]|\\\\.)*)"`).exec(text)?.[1] ?? "";
    const deviceId = field("consentDeviceId");
    const legal = field("legalNote");
    strings.push(["spike.consentDeviceId", deviceId], ["paywall.legalNote", legal]);
    for (const key of ["consentShort1", "consentShort2", "consentShort3", "consentShortScope", "consentAgree", "consentDetails"]) {
      strings.push([`spike.${key}`, field(key)]);
    }
    for (const [key, value] of strings) {
      ok(`${lang} ${key} is not empty`, value.trim().length > 0);
      ok(`${lang} ${key} has no en or em dash`, !/[–—]/.test(value));
      ok(`${lang} ${key} avoids regulated wording`, !banned[lang].test(value), value);
      ok(`${lang} ${key} keeps to one formal address`, !informal[lang].test(value), value);
    }
    const sub = strings.find(([k]) => k === "settings.analytics.deleteSub");
    // The row shows it on two lines at most (numberOfLines={2}); German is the widest language and sets the limit.
    ok(`${lang} deleteSub fits the row's two lines`, !!sub && sub[1].length <= 72, sub ? `${sub[1].length} chars` : "missing");

    const hub = field("hubData");
    ok(
      `${lang} the Data screen is titled like its menu row`,
      hub !== "" && field("dataSection") === hub,
      `${field("dataSection")} / ${hub}`
    );

    // The installation ID: the daily limit and the 90 day log come first and
    // carry no condition; the usage events and the RevenueCat record come after
    // the clause that makes them depend on the switch, which is named as the
    // settings screen names it.
    const title = block ? (new RegExp(`\\n {6}title: "([^"]+)"`).exec(block[1])?.[1] ?? "") : "";
    const at = deviceId.search(whileOn[lang]);
    ok(`${lang} consentDeviceId has the 'while usage analytics is on' clause`, at > 0, deviceId);
    ok(`${lang} the 90 day log is named before it, so it reads as unconditional`, deviceId.indexOf("90") > -1 && deviceId.indexOf("90") < at);
    ok(`${lang} the usage events come after it`, deviceId.slice(at).search(usageEventsWord[lang]) > -1 && deviceId.slice(0, at).search(usageEventsWord[lang]) === -1);
    ok(`${lang} and so does the RevenueCat record`, deviceId.indexOf("RevenueCat") > at && deviceId.slice(0, at).indexOf("RevenueCat") === -1);
    ok(`${lang} the clause calls the switch what Settings calls it`, title !== "" && deviceId.toLowerCase().includes(title.toLowerCase()), title);

    ok(`${lang} the paywall note names both stores, App Store first`, legal.includes("App Store") && legal.includes("Google Play") && legal.indexOf("App Store") < legal.indexOf("Google Play"));
    ok(`${lang} and keeps the 24 hour rule`, legal.includes("24"));
    ok(`${lang} and stays short enough for the German footnote`, legal.length > 0 && legal.length <= 800, `${legal.length} chars`);

    const paywall = /\n {2}paywall: \{([\s\S]*?)\n {2}\},/.exec(text);
    ok(`${lang} has the paywall block`, paywall !== null);
    ok(`${lang} paywall.subtitle is gone`, !!paywall && !/\n {4}subtitle:/.test(paywall[1]));
  }
  const tr = src("lib/i18n/locales/tr.ts");
  const trBody = /analyticsConsentBody: "([^"]+)"/.exec(tr);
  ok("Turkish consent copy keeps its diacritics", !!trBody && /[ığşüöçİ]/.test(trBody[1]));
}

// ── K. the real sinks ───────────────────────────────────────────────────────
// The real facade, consent store and Supabase sink (flusher, outbox, transport)
// run end to end. Only the native edge is stood in for: React
// Native, AsyncStorage, expo modules, the RevenueCat SDK, fetch,
// and the app database, which is a real SQLite with the real analytics_queue
// DDL. "Nothing leaves" is then read where it counts: the fetch log, the outbox
// and the console.

const TRACK_URL = "https://track.test/fn";
const DELETE_URL = "https://delete.test/fn";
const DEVICE_ID = "0b1f6a52-3c1e-4e0e-9a0e-2f7b2f2a9d11";
const RC_USER_ID = "$RCAnonymousID:0123456789abcdef0123456789abcdef";

interface NetCall {
  kind: string;
  headers: Record<string, string>;
  body: any;
}

const rig = {
  storage: memoryStorage(),
  db: null as any,
  calls: [] as NetCall[],
  /** The next request of this kind waits for the gate. */
  hold: null as { kind: string; gate: Promise<void> } | null,
  /** The next "empty the outbox" statement waits for this. */
  holdClear: null as Promise<void> | null,
  status: { track: 202, delete: 200 } as Record<string, number>,
  rc: { configured: true, userId: RC_USER_ID as unknown, fails: false, hangs: false },
  appState: { current: "active", listeners: [] as ((state: string) => void)[] },
  bytes: 0,
  /** What expo-application answers; null is a binary that does not report it. */
  native: { build: "94" as string | null, version: "2.4.0" as string | null },
  config: {
    ios: { buildNumber: "93" } as { buildNumber?: string } | undefined,
    android: { versionCode: 94 } as { versionCode?: number } | undefined,
  },
};

function resetRig(stored: Record<string, string>, beforeBoot?: () => void): void {
  rig.storage = memoryStorage({ "zerospike.deviceId": DEVICE_ID, ...stored });
  if (rig.db) rig.db.close();
  rig.db = new DatabaseSync(":memory:");
  rig.db.exec(V24_CREATE_ANALYTICS_QUEUE);
  rig.calls = [];
  rig.hold = null;
  rig.holdClear = null;
  rig.status = { track: 202, delete: 200 };
  rig.rc = { configured: true, userId: RC_USER_ID, fails: false, hangs: false };
  rig.appState = { current: "active", listeners: [] };
  rig.native = { build: "94", version: "2.4.0" };
  rig.config = { ios: { buildNumber: "93" }, android: { versionCode: 94 } };
  if (beforeBoot) beforeBoot();
}

const emitAppState = (state: string): void => {
  rig.appState.current = state;
  for (const listener of [...rig.appState.listeners]) listener(state);
};

const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let stubsInstalled = false;
function installStubs(): void {
  if (stubsInstalled) return;
  stubsInstalled = true;
  (globalThis as any).__DEV__ = false;

  const rnStub = {
    Platform: { OS: "ios", Version: "17.0" },
    AppState: {
      get currentState() {
        return rig.appState.current;
      },
      addEventListener(_type: string, listener: (state: string) => void) {
        rig.appState.listeners.push(listener);
        return { remove() {} };
      },
    },
  };
  const purchasesApi = {
    isConfigured: async () => rig.rc.configured,
    getAppUserID: async () => {
      if (rig.rc.fails) throw new Error("no singleton instance");
      if (rig.rc.hangs) return new Promise<string>(() => {});
      return rig.rc.userId;
    },
  };

  const Module = require("module");
  const realLoad = Module._load;
  Module._load = function (request: string, parent: any) {
    const from = parent && typeof parent.filename === "string" ? parent.filename : "";
    if (!/[\\/]lib[\\/](analytics|identity|uuid|appVersion)/.test(from)) return realLoad.apply(this, arguments);
    switch (request) {
      case "react-native":
        return rnStub;
      case "../screenshotMode":
        return { isScreenshotMode: () => false };
      case "@react-native-async-storage/async-storage":
        return { __esModule: true, default: rig.storage.storage };
      case "expo-constants":
        return {
          __esModule: true,
          default: {
            get expoConfig() {
              return {
                extra: { trackFnUrl: TRACK_URL, deleteDeviceFnUrl: DELETE_URL },
                version: "8.8.8",
                ios: rig.config.ios,
                android: rig.config.android,
              };
            },
          },
        };
      case "expo-application":
        return {
          __esModule: true,
          get nativeBuildVersion() {
            return rig.native.build;
          },
          get nativeApplicationVersion() {
            return rig.native.version;
          },
        };
      case "expo-device":
        return { __esModule: true, osVersion: "17.0" };
      case "expo-crypto":
        return {
          getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (rig.bytes++ * 31 + i * 7 + 3) & 255),
        };
      case "../db/index":
        return {
          getDb: async () => ({
            runAsync: async (sql: string, params: unknown[] = []) => {
              if (rig.holdClear && /^DELETE FROM analytics_queue;?$/.test(sql.trim())) {
                const gate = rig.holdClear;
                rig.holdClear = null;
                await gate;
              }
              return rig.db.prepare(sql).run(...params);
            },
            getAllAsync: async (sql: string, params: unknown[] = []) => rig.db.prepare(sql).all(...params),
          }),
        };
      case "../i18n":
        return { currentLang: () => "en" };
      case "react-native-purchases":
        return { default: purchasesApi };
      default:
        return realLoad.apply(this, arguments);
    }
  };

  (globalThis as any).fetch = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    const kind = url === DELETE_URL ? "delete" : url === TRACK_URL ? "track" : "other";
    rig.calls.push({ kind, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (rig.hold && rig.hold.kind === kind) {
      const gate = rig.hold.gate;
      rig.hold = null;
      await gate;
    }
    return { status: rig.status[kind] ?? 500, headers: { get: () => null }, json: async () => ({}) };
  };
}

interface Booted {
  facade: typeof FacadeApi;
  optOut: typeof OptOutApi;
  supabase: typeof SupabaseSinkApi;
  records: typeof ServerRecordsApi;
}

/** A new app run: fresh copies of every analytics module, as a cold start gives them. */
function loadSinks(): Booted {
  for (const key of Object.keys(require.cache)) {
    if (/[\\/]lib[\\/](analytics|identity)[\\/]/.test(key) || /[\\/]lib[\\/](uuid|appVersion)\.js$/.test(key)) {
      delete require.cache[key];
    }
  }
  return {
    facade: require("../lib/analytics/index"),
    optOut: require("../lib/analytics/optOut"),
    supabase: require("../lib/analytics/supabaseSink"),
    records: require("../lib/analytics/serverRecords"),
  };
}

/** Starts the sinks the way app/_layout.tsx and RootNavigator do, with the stored answer given. */
async function boot(stored: Record<string, string> = {}, beforeBoot?: () => void): Promise<Booted> {
  installStubs();
  resetRig(stored, beforeBoot);
  const m = loadSinks();
  m.supabase.initSupabaseSink();
  m.supabase.setAnalyticsIsPro(false);
  await settle();
  return m;
}

/** Granted, and past the start-up flush, so what the scenario sees is its own traffic. */
async function bootGranted(): Promise<Booted> {
  const m = await boot({ [CONSENT_KEY]: "granted" });
  rig.calls.length = 0;
  return m;
}

const logIt = (m: Booted, name: string, params?: Record<string, string | number | boolean>): void =>
  m.facade.logEvent(name as any, params);
const PAYWALL = { source: "health", trial_eligible: true, context: "inapp" };
const queueCount = (): number => rig.db.prepare("SELECT COUNT(*) AS c FROM analytics_queue").get().c;
const tracks = (): NetCall[] => rig.calls.filter((c) => c.kind === "track");
const sent = (): { name: string; props: Record<string, unknown> }[] => tracks().flatMap((c) => c.body.events);

function holdNext(kind: string): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  rig.hold = { kind, gate };
  return { release };
}

/** Background stops the sink's ticker, so nothing keeps the process alive. */
async function end(): Promise<void> {
  emitAppState("background");
  await settle();
}

async function sinks(): Promise<void> {
  section("K. the real sinks: consent gates everything, and nothing leaves once it is withdrawn");

  for (const [label, stored] of [
    ["never asked", {}],
    ["declined", { [CONSENT_KEY]: "declined" }],
  ] as [string, Record<string, string>][]) {
    const m = await boot(stored);
    logIt(m, "paywall_view", PAYWALL);
    logIt(m, "onboarding_step", { step: "welcome", index: 0 });
    emitAppState("background");
    await settle();
    emitAppState("active");
    await settle();
    eq(`${label}: no request leaves the device`, rig.calls.length, 0);
    eq(`${label}: nothing is written to the outbox`, queueCount(), 0);
    await end();

    await boot(stored, () => {
      for (const name of ["app_open", "paywall_view", "first_log"]) {
        rig.db
          .prepare("INSERT INTO analytics_queue (name, props, ts, session_id, is_pro) VALUES (?, ?, ?, ?, ?)")
          .run(name, "{}", "2026-10-01T10:00:00.000Z", "old-session", 0);
      }
    });
    emitAppState("background");
    await settle();
    eq(`${label}: an outbox left from the on-by-default days is emptied at start`, queueCount(), 0);
    eq(`${label}: and never uploaded`, rig.calls.length, 0);
    await end();
  }

  {
    const m = await boot({ [CONSENT_KEY]: "granted" });
    logIt(m, "paywall_view", { source: "rotation", trial_eligible: false, context: "inapp" });
    logIt(m, "paywall_dismiss", { source: "rotation" });
    logIt(m, "log_added", { kind: "basal" });
    logIt(m, "spike_action_tap", { action: "open_injection_map" });
    logIt(m, "spike_action_tap", { action: "open_reminders" });
    emitAppState("background");
    await settle();
    const events = sent();
    ok("granted: batches reach the track function", tracks().length >= 1);
    eq("granted: with the installation ID", tracks()[0].headers["x-device-id"], DEVICE_ID);
    ok(
      "granted: app_open and every logged event are in them",
      ["app_open", "paywall_view", "paywall_dismiss", "log_added", "spike_action_tap"].every((n) => events.some((e) => e.name === n))
    );
    const propsOf = (name: string, i = 0) => events.filter((e) => e.name === name)[i]?.props;
    eq("granted: the insulin-only paywall entry leaves as 'feature'", propsOf("paywall_view")?.source, "feature");
    eq("granted: so does its dismissal", propsOf("paywall_dismiss")?.source, "feature");
    eq("granted: a basal entry leaves as 'other'", propsOf("log_added")?.kind, "other");
    eq("granted: the injection map button leaves as open_feature", propsOf("spike_action_tap", 0)?.action, "open_feature");
    eq("granted: the other buttons are untouched", propsOf("spike_action_tap", 1)?.action, "open_reminders");
    ok("granted: nothing insulin shaped is anywhere in what was sent", !/rotation|injection|basal/.test(JSON.stringify(events)));
    await end();
  }

  {
    const m = await boot({ [CONSENT_KEY]: "granted" });
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    ok("granted, then switched off: it was sending until then", tracks().length >= 1);
    rig.calls.length = 0;
    emitAppState("active");
    await settle();
    logIt(m, "paywall_view", PAYWALL);
    await settle();
    ok("an event is waiting in the outbox when the user says no", queueCount() >= 1);
    await m.optOut.setAnalyticsConsent("declined");
    await m.optOut.analyticsConsentSettled();
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    emitAppState("active");
    await settle();
    eq("switched off: not one request leaves, not even a note that it was switched off", rig.calls.length, 0);
    eq("switched off: what was waiting is forgotten", queueCount(), 0);
    await end();
  }

  {
    // The flusher keeps its own gate: rows still in the outbox in the moment
    // between the user's no and the outbox being emptied must not go out.
    const m = await bootGranted();
    logIt(m, "paywall_view", PAYWALL);
    await settle();
    ok("an event is waiting in the outbox", queueCount() >= 1);
    let release: () => void = () => {};
    rig.holdClear = new Promise<void>((resolve) => {
      release = resolve;
    });
    await m.optOut.setAnalyticsConsent("declined");
    await settle();
    emitAppState("background");
    await settle();
    eq("rows still in the outbox are not uploaded while it is being emptied after a no", rig.calls.length, 0);
    release();
    await m.optOut.analyticsConsentSettled();
    eq("and the outbox ends up empty", queueCount(), 0);
    await end();
  }

  for (const [label, stored] of [
    ["never asked, then declined", {}],
    ["declined, declined again", { [CONSENT_KEY]: "declined" }],
  ] as [string, Record<string, string>][]) {
    const m = await boot(stored);
    await m.optOut.setAnalyticsConsent("declined");
    await m.optOut.analyticsConsentSettled();
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    eq(`${label}: not one request leaves`, rig.calls.length, 0);
    eq(`${label}: nothing is queued`, queueCount(), 0);
    await end();
  }

  {
    const m = await boot();
    await m.optOut.setAnalyticsConsent("granted");
    await m.optOut.analyticsConsentSettled();
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    const events = sent();
    ok("switched on: the events after the choice are sent", events.some((e) => e.name === "paywall_view"));
    eq("switched on: it says so, in the one direction it ever says anything", events.filter((e) => e.name === "analytics_opt_out").map((e) => e.props), [{ enabled: true }]);
    await end();
  }

  {
    const m = await bootGranted();
    const errors: unknown[][] = [];
    const realError = (console as any).error;
    const realXhr = (globalThis as any).XMLHttpRequest;
    let xhrCalls = 0;
    (globalThis as any).XMLHttpRequest = function () {
      xhrCalls += 1;
    };
    (console as any).error = (...a: unknown[]) => void errors.push(a);
    try {
      m.facade.logCrash(new Error("boom"), { screen: "home" });
      await settle();
    } finally {
      (console as any).error = realError;
      (globalThis as any).XMLHttpRequest = realXhr;
    }
    eq("logCrash writes the error to the console, once", errors.length, 1);
    ok(
      "and the console line carries the stack, not a bracketed message",
      errors[0]?.some((x) => typeof x === "string" && x.startsWith("Error: boom") && x.includes("\n    at ")) === true
    );
    eq("logCrash makes no fetch call", rig.calls.length, 0);
    eq("logCrash makes no XMLHttpRequest", xhrCalls, 0);
    eq("logCrash writes nothing to the outbox", queueCount(), 0);
    await end();
  }

  {
    const m = await bootGranted();
    const errors: unknown[][] = [];
    const warns: unknown[][] = [];
    const realError = (console as any).error;
    const realWarn = (console as any).warn;
    (console as any).error = (...a: unknown[]) => void errors.push(a);
    (console as any).warn = (...a: unknown[]) => void warns.push(a);
    (globalThis as any).__DEV__ = true;
    try {
      m.facade.logCrash(new Error("devboom"), { screen: "home" });
      await settle();
    } finally {
      (globalThis as any).__DEV__ = false;
      (console as any).error = realError;
      (console as any).warn = realWarn;
    }
    eq("logCrash in dev warns once and does not use console.error", [warns.length, errors.length], [1, 0]);
    ok("dev warn carries the Error stack", warns[0]?.some((x) => typeof x === "string" && x.includes("devboom") && x.includes("\n    at ")) === true);
    await end();
  }

  section("K2. delete my server records, through the real sinks");
  {
    const m = await bootGranted();
    logIt(m, "paywall_view", PAYWALL);
    const batch = holdNext("track");
    emitAppState("background");
    await settle();
    eq("a batch is on its way", tracks().length, 1);
    const deleting = m.records.deleteMyServerRecords();
    await settle();
    eq("the deletion waits for it", rig.calls.filter((c) => c.kind === "delete").length, 0);
    batch.release();
    const result = await deleting;
    eq("then the server is asked, once", rig.calls.map((c) => c.kind), ["track", "delete"]);
    eq("and the deletion succeeded", result, { ok: true });
    const request = rig.calls[1];
    eq("with the installation ID", request.headers["x-device-id"], DEVICE_ID);
    eq("and the RevenueCat app user id", request.headers[APP_USER_ID_HEADER], RC_USER_ID);
    eq("the outbox is empty", queueCount(), 0);
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("active");
    emitAppState("background");
    await settle();
    eq("uploads go on afterwards", tracks().length, 2);
    await end();
  }
  {
    const m = await bootGranted();
    const request = holdNext("delete");
    const deleting = m.records.deleteMyServerRecords();
    await settle();
    eq("the deletion request is pending", rig.calls.map((c) => c.kind), ["delete"]);
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    emitAppState("active");
    await settle();
    eq("nothing is uploaded while it runs", tracks().length, 0);
    request.release();
    eq("it succeeds", await deleting, { ok: true });
    eq("what was logged meanwhile goes with it", queueCount(), 0);
    emitAppState("background");
    await settle();
    eq("and none of it leaves afterwards", tracks().length, 0);
    await end();
  }
  {
    const m = await bootGranted();
    rig.status.delete = 503;
    const request = holdNext("delete");
    const deleting = m.records.deleteMyServerRecords();
    await settle();
    logIt(m, "paywall_view", PAYWALL);
    request.release();
    eq("a failed deletion says why", await deleting, { ok: false, reason: "unavailable" });
    emitAppState("background");
    await settle();
    eq("uploads go on, with what was logged meanwhile", tracks().length, 1);
    ok("which is not lost", sent().some((e) => e.name === "paywall_view"));
    await end();
  }
  {
    const m = await bootGranted();
    rig.status.delete = 400;
    eq("a request the function refuses is reported as rejected", await m.records.deleteMyServerRecords(), { ok: false, reason: "rejected" });
    await end();
  }
  for (const [label, setup] of [
    ["the SDK is not configured yet", () => void (rig.rc.configured = false)],
    ["the SDK has no id", () => void (rig.rc.userId = null)],
    ["the id would not pass the function", () => void (rig.rc.userId = "has a space")],
    ["the SDK throws", () => void (rig.rc.fails = true)],
  ] as [string, () => void][]) {
    const m = await bootGranted();
    setup();
    eq(`${label}: the deletion still goes through`, await m.records.deleteMyServerRecords(), { ok: true });
    const request = rig.calls.find((c) => c.kind === "delete");
    eq(`${label}: with the installation ID alone`, [request?.headers["x-device-id"], request?.headers[APP_USER_ID_HEADER]], [DEVICE_ID, undefined]);
    await end();
  }
  {
    const m = await bootGranted();
    rig.rc.hangs = true;
    const started = Date.now();
    eq("a stalled SDK does not hold the deletion up for long", await m.records.deleteMyServerRecords(), { ok: true });
    ok("about three seconds at most", Date.now() - started < 6000, `${Date.now() - started} ms`);
    eq("and the request goes without the app user id", rig.calls.find((c) => c.kind === "delete")?.headers[APP_USER_ID_HEADER], undefined);
    await end();
  }
  {
    // No Supabase sink running (dev, screenshot mode, no track URL): the delete flow still works.
    installStubs();
    resetRig({ [CONSENT_KEY]: "granted" });
    const m = loadSinks();
    eq("without a running sink the deletion still goes through", await m.records.deleteMyServerRecords(), { ok: true });
    eq("and asks the server once", rig.calls.map((c) => c.kind), ["delete"]);
  }
}

async function measurement(): Promise<void> {
  section("L. measurement: build field, restore/winback events, early-event order, install id");

  {
    const m = await bootGranted();
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    const body = tracks()[0]?.body;
    eq("build is the native build number, not unknown", body?.build, "94");
    eq("app_version is the native version", body?.app_version, "2.4.0");
    await end();
  }
  {
    const m = await bootGranted();
    rig.native = { build: null, version: null };
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    const body = tracks()[0]?.body;
    eq("without a native build the config's iOS build number is used", body?.build, "93");
    eq("and the config version", body?.app_version, "8.8.8");
    await end();
  }
  {
    const m = await bootGranted();
    rig.native = { build: null, version: null };
    rig.config = { ios: undefined, android: { versionCode: 94 } };
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    eq("without an iOS build number the Android versionCode is used", tracks()[0]?.body?.build, "94");
    await end();
  }

  {
    const { isInstallId, DEVICE_ID_FALLBACK } = require("../lib/identity/deviceId");
    eq("a uuid is an install id", isInstallId(DEVICE_ID), true);
    eq("the storage-failure fallback is not", isInstallId(DEVICE_ID_FALLBACK), false);
    eq("nor is the old literal", isInstallId("unknown"), false);
    eq("nor null", isInstallId(null), false);
  }
  {
    const m = await boot({ [CONSENT_KEY]: "granted" }, () => {
      const store = rig.storage.storage;
      const read = store.getItem.bind(store);
      store.getItem = async (key: string) => {
        if (key === "zerospike.deviceId") throw new Error("storage unavailable");
        return read(key);
      };
    });
    logIt(m, "paywall_view", PAYWALL);
    emitAppState("background");
    await settle();
    eq("a failing id read sends nothing this session", tracks().length, 0);
    ok("and the events stay queued", queueCount() > 0);
    await end();
  }

  {
    const { createOnceGate } = require("../lib/analytics/once");
    const gate = createOnceGate();
    const logged: string[] = [];
    // welcome, first quiz step, hardware back to welcome, first quiz step again
    for (const step of ["welcome", "name", "welcome", "name", "unit"]) {
      if (gate(step)) logged.push(step);
    }
    eq("going back to a seen step logs it only once", logged, ["welcome", "name", "unit"]);
  }

  {
    installStubs();
    resetRig({});
    const RealDate = Date;
    let fakeNow: number | null = null;
    (globalThis as any).Date = class extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0 && fakeNow !== null) super(fakeNow);
        else super(...(args as [any]));
      }
      static now(): number {
        return fakeNow ?? RealDate.now();
      }
    };
    try {
      const m = loadSinks();
      fakeNow = Date.parse("2026-10-22T10:00:10.000Z");
      m.supabase.initSupabaseSink();
      await settle();
      fakeNow = Date.parse("2026-10-22T10:00:20.000Z");
      await m.optOut.setAnalyticsConsent("granted");
      await m.optOut.analyticsConsentSettled();
      fakeNow = Date.parse("2026-10-22T10:00:05.000Z");
      logIt(m, "paywall_view", PAYWALL);
      fakeNow = null;
      m.supabase.setAnalyticsIsPro(false);
      await settle();
      emitAppState("background");
      await settle();
      const events = tracks().flatMap((c) => c.body.events as { name: string; ts: string }[]);
      const names = events.map((e) => e.name);
      ok("the opt-in made before the sink was ready is not lost", names.includes("analytics_opt_out"), names.join(","));
      ok("the other early events arrive too", names.includes("app_open") && names.includes("paywall_view"));
      eq("early events are written in client_ts order", events.map((e) => e.ts), [...events.map((e) => e.ts)].sort());
    } finally {
      (globalThis as any).Date = RealDate;
    }
    await end();
  }
}

async function main(): Promise<void> {
  console.log("zerospike analytics consent test");
  rules();
  await reading();
  await writing();
  kinds();
  await deletion();
  firstLogSql();
  wiring();
  copy();
  await sinks();
  await measurement();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.log("test crashed:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
