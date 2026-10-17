/**
 * lib/proCta.ts harness: the Pro lock button label (trial only for a definite,
 * eligible, positive whole-day trial), the offerings reduction behind it, the
 * shared one-promise cache, and a few wiring checks on the lock surfaces.
 *
 * Run from the repo root: npx tsx scripts/proCta.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare function require(id: string): any;

let loadCalls = 0;
let loader: () => Promise<any> = async () => ({ status: "unavailable", isDevFallback: false, plans: {} });

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string, parent: any) {
  if (request === "react") return { useState: (v: unknown) => [v, () => {}], useEffect: () => {} };
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
  getPaywallTrial,
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

  resetPaywallTrialCache();
  loadCalls = 0;
  loader = async () => annual(true, 7);
  const [a, b] = await Promise.all([getPaywallTrial(), getPaywallTrial()]);
  ok("two calls, one loadOfferings", loadCalls === 1, String(loadCalls));
  ok("shared result", a.trialEligible && b.trialDays === 7);

  resetPaywallTrialCache();
  loader = async () => annual(true, 14);
  const c = await getPaywallTrial();
  ok("reload after reset", loadCalls === 2 && c.trialDays === 14, String(loadCalls));

  resetPaywallTrialCache();
  loadCalls = 0;
  loader = async () => {
    throw new Error("boom");
  };
  const d = await getPaywallTrial();
  ok("reject => false", d.trialEligible === false);
  loader = async () => annual(true, 7);
  const e = await getPaywallTrial();
  ok("rejected promise not cached", loadCalls === 2 && e.trialEligible === true, String(loadCalls));

  resetPaywallTrialCache();
  loader = async () => ({ status: "unavailable", isDevFallback: false, plans: {} });
  ok("unavailable via cache => false", (await getPaywallTrial()).trialEligible === false);

  resetPaywallTrialCache();
  loadCalls = 0;
  loader = async () => ({ status: "unavailable", isDevFallback: false, plans: {} });
  await getPaywallTrial();
  await getPaywallTrial();
  ok("non-ready result not cached", loadCalls === 2, String(loadCalls));

  let notified = 0;
  const unsub = subscribePaywallTrialReset(() => notified++);
  const v0 = getPaywallTrialCacheVersion();
  resetPaywallTrialCache();
  ok("reset bumps version and notifies", getPaywallTrialCacheVersion() === v0 + 1 && notified === 1);
  unsub();
  resetPaywallTrialCache();
  ok("unsubscribed listener not called", notified === 1);

  loadCalls = 0;
  ok("disabled hook does not load", usePaywallTrial(false).trialEligible === false && useProCta(false).kind === "upgrade" && loadCalls === 0);

  const fs = require("fs");
  const root = process.cwd();
  const read = (p: string): string => fs.readFileSync(`${root}/${p}`, "utf8");
  for (const f of ["app/insights.tsx", "app/(tabs)/settings.tsx", "app/settings/app.tsx", "app/(tabs)/injection.tsx", "app/add-food.tsx", "app/(tabs)/index.tsx"]) {
    ok(`${f} gates useProCta on !isProUser`, read(f).includes("useProCta(!isProUser"));
  }
  console.log(`proCta: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
