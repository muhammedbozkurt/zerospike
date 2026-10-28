/**
 * lib/proCta.ts harness: the Pro lock button label (trial only for a definite,
 * eligible, positive whole-day trial), the offerings reduction behind it, the
 * persistent cache (hydrate + prime), and a few wiring checks on the lock surfaces.
 *
 * Run from the repo root: npx tsx scripts/proCta.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare function require(id: string): any;

let loadCalls = 0;
let loader: () => Promise<any> = async () => ({ status: "unavailable", isDevFallback: false, plans: {} });

const store = new Map<string, string>();
let holdReads = false;
const releases: (() => void)[] = [];
const AsyncStorageStub = {
  getItem: async (k: string) => {
    const v = store.has(k) ? (store.get(k) as string) : null;
    if (holdReads) await new Promise<void>((res) => releases.push(res));
    return v;
  },
  setItem: async (k: string, v: string) => void store.set(k, String(v)),
  removeItem: async (k: string) => void store.delete(k),
};

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string, parent: any) {
  if (request === "react") return { useState: (v: unknown) => [v, () => {}], useEffect: (fn: () => void) => {
      fn();
    },
  };
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorageStub };
  if (request === "./services/purchases") {
    return {
      loadOfferings: () => {
        loadCalls++;
        return loader();
      },
    };
  }
  return realLoad.apply(this, arguments);
};

const {
  proCtaLabel,
  trialFromOfferings,
  primePaywallTrial,
  hydratePaywallTrial,
  clearPaywallTrial,
  refreshPaywallTrialOnce,
  resetPaywallTrialCache,
  subscribePaywallTrialReset,
  getPaywallTrialCacheVersion,
  usePaywallTrial,
  useProCta,
} = require("../lib/proCta");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

const annual = (hasFreeTrial: boolean, freeTrialDays: number) => ({
  status: "ready",
  isDevFallback: false,
  plans: { annual: { hasFreeTrial, freeTrialDays } },
});

async function main(): Promise<void> {
  ok("not eligible => upgrade", proCtaLabel({ trialEligible: false, trialDays: 7 }).kind === "upgrade");
  const trial = proCtaLabel({ trialEligible: true, trialDays: 7 });
  ok("eligible 7 => trial", trial.kind === "trial" && trial.params.days === 7);
  ok("trial key", trial.key === "proCta.trial");
  const up = proCtaLabel({ trialEligible: false, trialDays: 0 });
  ok("upgrade key", up.key === "proCta.upgrade");
  ok("upgrade params empty", Object.keys(up.params).length === 0);
  for (const bad of [0, -1, NaN, 1.5, undefined, Infinity]) {
    ok(`trialDays ${String(bad)} => upgrade`, proCtaLabel({ trialEligible: true, trialDays: bad }).kind === "upgrade");
  }

  ok("annual trial 7 => eligible", JSON.stringify(trialFromOfferings(annual(true, 7))) === '{"trialEligible":true,"trialDays":7}');
  ok("no free trial => false", trialFromOfferings(annual(false, 0)).trialEligible === false);
  ok("unavailable => false", trialFromOfferings({ status: "unavailable", isDevFallback: false, plans: {} }).trialEligible === false);
  ok("dev fallback => false", trialFromOfferings({ ...annual(true, 7), isDevFallback: true }).trialEligible === false);
  ok("null => false", trialFromOfferings(null).trialEligible === false);
  ok("no annual plan => false", trialFromOfferings({ status: "ready", isDevFallback: false, plans: {} }).trialEligible === false);
  const noDays = trialFromOfferings(annual(true, 0));
  ok("trial without real days => upgrade label", proCtaLabel(noDays).kind === "upgrade");

  clearPaywallTrial();
  loadCalls = 0;
  ok("empty cache => no trial, no network", usePaywallTrial(true).trialEligible === false && useProCta(true).kind === "upgrade" && loadCalls === 0, String(loadCalls));

  primePaywallTrial(annual(true, 7));
  ok("after prime trial shows", useProCta(true).kind === "trial" && usePaywallTrial(true).trialDays === 7);
  ok("prime never calls network", loadCalls === 0);
  ok("ready prime is persisted", /^\{"e":true,"d":7,"t":\d+\}$/.test(String(store.get("zerospike.proCtaTrial"))), String(store.get("zerospike.proCtaTrial")));

  primePaywallTrial({ status: "unavailable", isDevFallback: false, plans: {} });
  ok("non-ready prime keeps the stored value", useProCta(true).kind === "trial" && store.has("zerospike.proCtaTrial"));
  primePaywallTrial({ ...annual(true, 3), isDevFallback: true });
  ok("dev fallback prime keeps the stored value", usePaywallTrial(true).trialDays === 7);

  resetPaywallTrialCache();
  await hydratePaywallTrial();
  ok("reset does not invalidate cache or storage", useProCta(true).kind === "trial" && store.has("zerospike.proCtaTrial"));

  clearPaywallTrial();
  await Promise.resolve();
  ok("clear (Pro gained) => upgrade and storage empty", useProCta(true).kind === "upgrade" && !store.has("zerospike.proCtaTrial"));

  store.set("zerospike.proCtaTrial", JSON.stringify({ e: true, d: 14, t: Date.now() }));
  await hydratePaywallTrial();
  ok("stored eligibility is read synchronously after hydrate", usePaywallTrial(true).trialDays === 14 && useProCta(true).kind === "trial" && loadCalls === 0);
  clearPaywallTrial();
  store.set("zerospike.proCtaTrial", "garbage");
  await hydratePaywallTrial();
  ok("corrupt stored value => upgrade", useProCta(true).kind === "upgrade");
  clearPaywallTrial();

  loader = async () => annual(true, 7);
  loadCalls = 0;
  await refreshPaywallTrialOnce();
  await refreshPaywallTrialOnce();
  ok("launch refresh runs once and primes", loadCalls === 1 && useProCta(true).kind === "trial", String(loadCalls));
  clearPaywallTrial();

  const entry = (e: boolean, d: number, t?: number) => JSON.stringify(t === undefined ? { e, d } : { e, d, t });
  const flush = () => new Promise((res) => setTimeout(res, 0));
  const DAY = 24 * 60 * 60 * 1000;

  store.set("zerospike.proCtaTrial", entry(true, 7, Date.now() - 6 * DAY));
  await hydratePaywallTrial();
  ok("a 6 day old stored value is used", useProCta(true).kind === "trial");
  clearPaywallTrial();
  store.set("zerospike.proCtaTrial", entry(true, 7, Date.now() - 8 * DAY));
  await hydratePaywallTrial();
  ok("an 8 day old stored value is ignored", useProCta(true).kind === "upgrade");
  store.set("zerospike.proCtaTrial", entry(true, 7));
  await hydratePaywallTrial();
  ok("a stored value without a timestamp is ignored", useProCta(true).kind === "upgrade");
  clearPaywallTrial();

  store.set("zerospike.proCtaTrial", entry(true, 7, Date.now()));
  holdReads = true;
  const pending = hydratePaywallTrial();
  await flush();
  primePaywallTrial(annual(false, 0));
  holdReads = false;
  releases.splice(0).forEach((f) => f());
  await pending;
  ok("a late hydrate never overwrites a fresher ineligible prime", useProCta(true).kind === "upgrade");
  clearPaywallTrial();

  store.set("zerospike.proCtaTrial", entry(true, 14, Date.now()));
  holdReads = true;
  const slow = hydratePaywallTrial();
  store.set("zerospike.proCtaTrial", entry(true, 7, Date.now()));
  const fast = hydratePaywallTrial();
  await flush();
  holdReads = false;
  releases.splice(1).forEach((f) => f());
  await fast;
  releases.splice(0).forEach((f) => f());
  await slow;
  ok("a second hydrate never replaces an already hydrated cache", usePaywallTrial(true).trialDays === 7, String(usePaywallTrial(true).trialDays));
  clearPaywallTrial();

  store.set("zerospike.proCtaTrial", entry(true, 7, Date.now()));
  holdReads = true;
  resetPaywallTrialCache();
  await flush();
  clearPaywallTrial();
  holdReads = false;
  releases.splice(0).forEach((f) => f());
  await flush();
  ok("clear during an in-flight hydrate is not undone", useProCta(true).kind === "upgrade");
  clearPaywallTrial();

  const oldT = Date.now() - 5 * DAY;
  store.set("zerospike.proCtaTrial", entry(true, 7, oldT));
  await hydratePaywallTrial();
  primePaywallTrial(annual(true, 7));
  await flush();
  ok("priming the same value refreshes the stored timestamp", JSON.parse(String(store.get("zerospike.proCtaTrial"))).t > oldT + 4 * DAY);
  clearPaywallTrial();

  const freshModule = () => {
    delete require.cache[require.resolve("../lib/proCta")];
    return require("../lib/proCta");
  };

  const m1 = freshModule();
  m1.clearPaywallTrial();
  m1.primePaywallTrial(annual(true, 7));
  const before = store.get("zerospike.proCtaTrial");
  loader = async () => {
    throw new Error("offline");
  };
  await m1.refreshPaywallTrialOnce();
  ok("a throwing loader leaves cache and storage unchanged", m1.usePaywallTrial(true).trialDays === 7 && store.get("zerospike.proCtaTrial") === before);
  m1.clearPaywallTrial();

  const m2 = freshModule();
  let answer: (v: unknown) => void = () => {};
  loader = () => new Promise((res) => (answer = res));
  const inflight = m2.refreshPaywallTrialOnce();
  m2.clearPaywallTrial();
  answer(annual(true, 7));
  await inflight;
  await flush();
  ok("a refresh answered after a clear is not primed", m2.usePaywallTrial(true).trialEligible === false && !store.has("zerospike.proCtaTrial"));

  let notified = 0;
  const unsub = subscribePaywallTrialReset(() => notified++);
  const v0 = getPaywallTrialCacheVersion();
  resetPaywallTrialCache();
  ok("reset bumps version and notifies", getPaywallTrialCacheVersion() === v0 + 1 && notified === 1);
  unsub();
  resetPaywallTrialCache();
  ok("unsubscribed listener not called", notified === 1);

  primePaywallTrial(annual(true, 7));
  ok("disabled hook ignores a primed trial", usePaywallTrial(false).trialEligible === false && useProCta(false).kind === "upgrade");
  ok("enabled hook sees the primed trial", useProCta(true).kind === "trial");
  clearPaywallTrial();

  const fs = require("fs");
  const root = process.cwd();
  const read = (p: string): string => fs.readFileSync(`${root}/${p}`, "utf8");
  for (const f of ["app/insights.tsx", "app/(tabs)/settings.tsx", "app/settings/app.tsx", "app/(tabs)/injection.tsx", "app/add-food.tsx"]) {
    ok(`${f} gates useProCta on !isProUser`, read(f).includes("useProCta(!isProUser"));
  }
  // The Health card is a Pro upsell only where a free profile may not import: a
  // free profile in CGM mode gets the 24 hour import (lib/cgm/importPolicy).
  const home = read("app/(tabs)/index.tsx");
  ok(
    "app/(tabs)/index.tsx gates useProCta on the import gate, which is derived from isProUser",
    home.includes("useProCta(!importAllowed") && home.includes("healthImportAllowed({ isPro: isProUser")
  );
  const layout = read("app/_layout.tsx");
  ok("_layout clears on Pro and refreshes otherwise", /if \(isProUser\) clearPaywallTrial\(\);\s*else void refreshPaywallTrialOnce\(\);/.test(layout));
  const paywall = read("app/paywall.tsx");
  ok("paywall primes the trial from offerings", paywall.includes("primePaywallTrial(r)"));
  ok("paywall clears the trial on purchase and restore", /onSuccess: async \(p, res\) => \{\s*clearPaywallTrial\(\);/.test(paywall) && /if \(result === "restored"\) \{\s*clearPaywallTrial\(\);/.test(paywall));
  console.log(`proCta: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
