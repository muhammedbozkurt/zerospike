/**
 * G253-FIX-B: purchase and Pro lifecycle findings, as permanent tests on the
 * real modules (purchases.ts, downsellGate.ts, the paywall state machine and the
 * route gate). The store SDK, storage and native modules are stubbed at the
 * module loader, the same way scripts/purchasesBehavior.test.ts does.
 *
 *   B1  a payment held for approval (RC code "20") is not an error, and its
 *       later approval is settled once: welcome, trial event, ending reminder
 *   B2  a purchase made from inside onboarding ends on the welcome, not on a
 *       redirect back to a second onboarding
 *   B3  a paywall close never waits on the store past its deadline
 *   B4  getPlan forgets a plan once the store says there is no Pro
 *   B6  a slow restore is "slow", not a connection error, and still lands
 *
 * Run: npx tsx scripts/proPurchaseLifecycle.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type * as PurchasesApi from "../lib/services/purchases";
import { winbackMayOpen, winbackTransition } from "../lib/winbackDue";
import { purchaseToastFor } from "../lib/services/purchaseFlow";
import { approvalSettle, welcomeMayOpen, welcomeRouteReady } from "../lib/pendingApproval";
import {
  isHomeRoute,
  needsOnboardingRedirect,
  onboardingBackAction,
  welcomeExitTarget,
} from "../lib/onboardingGate";
import {
  PAYWALL_EXIT_STORE_TIMEOUT_MS,
  createPaywallExitController,
  createSessionOfferFlag,
  initialDownsellState,
  type PaywallExitDeps,
  type PaywallExitTimer,
} from "../lib/downsellGate";
import { createPurchaseFlow, type PurchaseFlowDeps } from "../lib/paywallBuyFlow";
import {
  paywallCtaKind,
  purchaseOutcomePlan,
  purchaseUiAcceptsPress,
  purchaseUiBusy,
  purchaseUiReduce,
  type PurchaseUiState,
} from "../lib/paywallPurchase";
import { restoreResultOf } from "../lib/analytics/restoreResult";
import { normalizeEventParams } from "../lib/analytics/eventSchema";

const DAY = 24 * 60 * 60 * 1000;
let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Stubs ──────────────────────────────────────────────────────────────────

(globalThis as any).__DEV__ = false;

// A restore deadline of 20 or 60 s would stall the test: waits of a second or
// more run at 1/1000 of their length (the length is kept in `waits`).
const realSetTimeout = globalThis.setTimeout;
const waits: number[] = [];
(globalThis as any).setTimeout = (fn: () => void, ms?: number) => {
  if (ms && ms >= 1000) waits.push(ms);
  return realSetTimeout(fn, ms && ms >= 1000 ? Math.ceil(ms / 1000) : ms);
};
const sleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

const store = new Map<string, string>();
const AsyncStorageStub = {
  getItem: async (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: async (k: string, v: string) => void store.set(k, String(v)),
  removeItem: async (k: string) => void store.delete(k),
};
const rc = {
  customerInfo: (() => ({})) as () => any,
  offerings: (() => ({ current: { availablePackages: [] } })) as () => any,
  purchase: (async (_p: any) => ({})) as (p: any) => Promise<any>,
  restore: (async () => ({})) as () => Promise<any>,
  listeners: [] as ((info: any) => void)[],
};
const rcStub = {
  default: {
    configure: () => {},
    getCustomerInfo: async () => rc.customerInfo(),
    setAttributes: async () => {},
    enableAdServicesAttributionTokenCollection: async () => {},
    addCustomerInfoUpdateListener: (fn: (info: any) => void) => void rc.listeners.push(fn),
    removeCustomerInfoUpdateListener: (fn: (info: any) => void) => {
      const i = rc.listeners.indexOf(fn);
      if (i >= 0) rc.listeners.splice(i, 1);
      return i >= 0;
    },
    getOfferings: async () => rc.offerings(),
    checkTrialOrIntroductoryPriceEligibility: async () => ({}),
    purchasePackage: (p: any) => rc.purchase(p),
    restorePurchases: () => rc.restore(),
  },
};
const rnStub: any = {
  Platform: { OS: "ios", Version: "18.0", select: (o: any) => o[rnStub.Platform.OS] },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
};
const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string, parent: any) {
  const from = parent && typeof parent.filename === "string" ? parent.filename : "";
  if (request === "react-native") return rnStub;
  if (request === "react") return { useSyncExternalStore: (_s: unknown, g: () => unknown) => g() };
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorageStub };
  if (request === "react-native-purchases") return rcStub;
  if (request === "expo-crypto") return { getRandomBytes: (n: number) => new Uint8Array(n) };
  if (/(^|\/)analytics$/.test(request)) return { logEvent: () => {}, logCrash: () => {} };
  if (/(^|\/)analytics\/optOut$/.test(request)) {
    return { getAnalyticsEnabled: async () => false, onAnalyticsEnabledChange: () => () => {} };
  }
  if (request === "./notifications" && /purchases\.(js|ts)$/.test(from)) return { cancelTrialReminder: async () => {} };
  return realLoad.apply(this, arguments as any);
};
/** A new copy of the module. `keepStorage` is a relaunch: storage survives, memory does not. */
function load(keepStorage = false): typeof PurchasesApi {
  if (!keepStorage) store.clear();
  rc.listeners.length = 0;
  const key = require.resolve("../lib/services/purchases");
  delete require.cache[key];
  return require("../lib/services/purchases");
}

const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const offering = {
  current: {
    availablePackages: [
      { packageType: "MONTHLY", product: { identifier: "zerospike_pro", price: 4.99, priceString: "$4.99", currencyCode: "USD", introPrice: null } },
      { packageType: "ANNUAL", product: { identifier: "zerospike_pro_annual", price: 29.99, priceString: "$29.99", currencyCode: "USD", introPrice: { price: 0, priceString: "$0", periodUnit: "DAY", periodNumberOfUnits: 7 } } },
      { packageType: "LIFETIME", product: { identifier: "zerospike_lifetime", price: 99.99, priceString: "$99.99", currencyCode: "USD", introPrice: null } },
    ],
  },
};
const active = (productIdentifier: string, periodType = "NORMAL", days: number | null = 365) => ({
  entitlements: {
    active: { pro: { productIdentifier, periodType, expirationDate: days == null ? null : inDays(days), latestPurchaseDate: new Date().toISOString() } },
    all: {},
  },
});
const inactive = () => ({ entitlements: { active: {}, all: {} } });

async function main(): Promise<void> {
  console.log("zerospike pro purchase lifecycle test");

  section("B1. a payment held for approval is not an error");
  {
    const P = load();
    rc.offerings = () => offering;
    rc.customerInfo = () => inactive();
    rc.purchase = async () => {
      throw { code: "20", userCancelled: false, message: "payment pending" };
    };
    const res = await P.purchasePro("annual");
    eq("outcome is pending, not a store error", [res.ok, res.cancelled, res.error], [false, false, "pending"]);
    eq("toast is the info message", purchaseToastFor(res), { key: "purchasePending.toast", kind: "info" });
    ok("no entitlement was written", (await P.isProCached()) === false);
    eq("approval is not available while pending", await P.takeApprovedPurchase(), null);

    // The screen: pending keeps the CTA waiting, never "retry", and refuses a second request.
    eq("outcome plan: only the pending message", purchaseOutcomePlan(res), {
      toast: true,
      runDownsellGate: false,
      openWelcome: false,
      awaitApproval: true,
    });
    eq("state machine: purchasing -> pending", purchaseUiReduce("purchasing", "pending"), "pending");
    ok("pending refuses a press", !purchaseUiAcceptsPress("pending"));
    ok("pending does not block a close", !purchaseUiBusy("pending"));
    eq("pending allows restore", purchaseUiReduce("pending", "restoreStart"), "restoring");
    eq("CTA label kind", paywallCtaKind({ plan: "annual", annualTrial: true, hasPrice: true, failed: false, pending: true }), "pending");
    eq("a plain failure still reads retry", paywallCtaKind({ plan: "annual", annualTrial: true, hasPrice: true, failed: true }), "retry");

    // Approval arrives later through RevenueCat's own push (watchEntitlement path).
    let changes = 0;
    const stop = P.watchEntitlement(() => void changes++);
    await sleep(20);
    let approvals = 0;
    P.subscribePurchaseApproval(() => void approvals++);
    eq("the push listener is registered", rc.listeners.length, 1);
    rc.listeners[0](active("zerospike_pro_annual", "TRIAL", 7));
    await sleep(30);
    eq("watchEntitlement still reports the change", changes, 1);
    eq("approval listeners are told once", approvals, 1);
    ok("Pro is cached now", (await P.isProCached()) === true);
    const approved = await P.takeApprovedPurchase();
    eq("approved purchase: plan and a started trial", [approved?.plan, approved?.trial.kind], ["annual", "started"]);
    eq("handed over once only", await P.takeApprovedPurchase(), null);
    rc.listeners[0](active("zerospike_pro_annual", "TRIAL", 7));
    await sleep(30);
    eq("a later push does not approve again", [approvals, await P.takeApprovedPurchase()], [1, null]);
    stop();

    // What the root then does with it.
    const now = Date.now();
    const settle = approvalSettle(approved!, now);
    ok("trial_started is reported", settle.trial.logTrialStarted);
    ok("the ending reminder is armed from the store's expiry", settle.trial.scheduleReminderAt !== null && settle.trial.scheduleReminderAt > now + 6 * DAY);
    eq("purchase_completed source", settle.completed, { tier: "annual", source: "pending_approval" });
    ok("the welcome opens on the home", welcomeRouteReady("(tabs)"));
    for (const r of ["spike", "calculator", "paywall", "onboarding", "alarm-tour", undefined]) {
      ok(`the welcome waits on ${String(r)}`, !welcomeRouteReady(r as string | undefined));
    }
  }

  section("B1b. approval found on the next launch, and a paid (non-trial) plan");
  {
    const P1 = load();
    rc.offerings = () => offering;
    rc.customerInfo = () => inactive();
    rc.purchase = async () => {
      throw { code: "20", message: "pending" };
    };
    await P1.purchasePro("monthly");
    // App closed. Next launch: the cold start reads the store and finds Pro.
    const P2 = load(true);
    rc.customerInfo = () => active("zerospike_pro", "NORMAL", 30);
    eq("launch read sees Pro", await P2.verifyProWithStore(), true);
    const approved = await P2.takeApprovedPurchase();
    eq("approved after relaunch, no trial", [approved?.plan, approved?.trial.kind], ["monthly", "none"]);
    const settle = approvalSettle(approved!, Date.now());
    eq("no trial event or reminder for a paid plan", [settle.trial.logTrialStarted, settle.trial.scheduleReminderAt], [false, null]);
  }

  section("B1c. a fresh attempt, or a note gone stale, never replays an approval");
  {
    const P = load();
    rc.offerings = () => offering;
    rc.customerInfo = () => inactive();
    rc.purchase = async () => {
      throw { code: "20", message: "pending" };
    };
    await P.purchasePro("annual");
    rc.purchase = async () => ({ customerInfo: active("zerospike_pro_annual", "NORMAL", 365) });
    const res = await P.purchasePro("annual");
    ok("the later purchase succeeded", res.ok);
    await sleep(10);
    eq("its own success is not also an approval", await P.takeApprovedPurchase(), null);

    const Q = load();
    rc.customerInfo = () => inactive();
    rc.offerings = () => offering;
    rc.purchase = async () => {
      throw { code: "20", message: "pending" };
    };
    await Q.purchasePro("annual");
    const key = "zerospike.pendingPurchase";
    const note = JSON.parse(store.get(key) as string);
    store.set(key, JSON.stringify({ ...note, at: Date.now() - Q.PENDING_PURCHASE_TTL_MS - 1000 }));
    rc.customerInfo = () => active("zerospike_pro_annual");
    await Q.verifyProWithStore();
    eq("a note past its ttl is ignored", await Q.takeApprovedPurchase(), null);
  }

  section("B1d. the buy flow: pending is a message, not a failure or a welcome");
  {
    const log: string[] = [];
    const states: PurchaseUiState[] = [];
    const deps: PurchaseFlowDeps<any> = {
      isExiting: () => false,
      abandonPendingExit: () => {},
      purchase: async () => ({ ok: false, cancelled: false, recovered: false, error: "pending" }),
      refreshPro: async () => {},
      onPress: () => void log.push("press"),
      onResult: () => void log.push("result"),
      onSuccess: async () => void log.push("welcome"),
      onCancelled: async () => void log.push("cancelled"),
      onPending: () => void log.push("pending"),
      onFailed: () => void log.push("failed"),
      onPostPurchaseError: () => void log.push("postError"),
      onState: (s) => void states.push(s),
    };
    const flow = createPurchaseFlow(deps);
    await flow.buy("annual");
    eq("only the pending path ran", log, ["press", "result", "pending"]);
    eq("the state ends in pending", flow.getState(), "pending");
    eq("a second press is refused", await flow.buy("annual"), "ignored");
    eq("no extra store request", log.length, 3);
  }

  section("B2. onboarding -> paywall -> purchase lands on the welcome, in the same onboarding");
  {
    const gate = (root: string | undefined, onboarded = false, ready = true) =>
      needsOnboardingRedirect({ ready, onboarded, root });
    ok("a fresh install is sent to onboarding from the tabs", gate("(tabs)"));
    ok("the quiz itself is not redirected", !gate("onboarding"));
    ok("the paywall is let through", !gate("paywall"));
    ok("downsell and winback are let through", !gate("downsell") && !gate("winback"));
    ok("the Pro welcome is let through (was redirected)", !gate("pro-welcome"));
    ok("an onboarded user is never redirected", !gate("(tabs)", true));
    ok("nothing is decided before the app is ready", !gate("(tabs)", false, false));
    ok("only the home opens sales and the welcome by themselves", isHomeRoute("(tabs)") && !isHomeRoute("pro-welcome"));

    // The stack the way expo-router keeps it: push paywall, replace it with the
    // welcome, close the welcome with a back. The quiz is the SAME route entry.
    const stack: { name: string; id: number }[] = [{ name: "onboarding", id: 1 }];
    let nextId = 2;
    const push = (name: string) => void stack.push({ name, id: nextId++ });
    const replaceTop = (name: string) => void stack.splice(stack.length - 1, 1, { name, id: nextId++ });
    const back = () => void stack.pop();
    let redirects = 0;
    const settleRoute = () => {
      // The layout: a redirect to /onboarding REPLACES the top route.
      if (gate(stack[stack.length - 1].name)) {
        redirects++;
        replaceTop("onboarding");
      }
    };
    push("paywall");
    settleRoute();
    replaceTop("pro-welcome");
    settleRoute();
    eq("the welcome stays on top, nothing redirected", [stack[stack.length - 1].name, redirects], ["pro-welcome", 0]);
    back();
    settleRoute();
    eq("closing the welcome returns to the quiz entry it left", stack, [{ name: "onboarding", id: 1 }]);
  }

  section("B3. a paywall close never waits on the store past its deadline");
  {
    // A fake clock: timers are fired by hand, nothing really waits.
    type Pending = { fn: () => void; ms: number; live: boolean };
    const timers: Pending[] = [];
    const timer: PaywallExitTimer = {
      set: (fn, ms) => {
        const t = { fn, ms, live: true };
        timers.push(t);
        return t;
      },
      clear: (h) => void ((h as Pending).live = false),
    };
    const fire = () => timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn()));
    const never = <T,>() => new Promise<T>(() => {});

    function build(over: Partial<PaywallExitDeps> = {}) {
      const log: string[] = [];
      const session = createSessionOfferFlag();
      const deps: PaywallExitDeps = {
        isScreenshotMode: () => false,
        session,
        getState: async () => initialDownsellState,
        getOffer: async () => ({ hasRealDiscount: true }),
        entitlementNow: async () => ({ isPro: false, trialActive: false, lifetime: false }),
        onboardingIncomplete: async () => false,
        markOffered: async () => void log.push("stamp"),
        now: () => 1_800_000_000_000,
        timer,
        ...over,
      };
      const ctl = createPaywallExitController(deps, {
        closePaywall: () => void log.push("back"),
        openDownsell: () => void log.push("downsell"),
      });
      return { log, session, ctl };
    }

    eq("deadline is 2.5 s", PAYWALL_EXIT_STORE_TIMEOUT_MS, 2500);

    // a) the entitlement read hangs (slow network)
    {
      const e = build({ entitlementNow: () => never() });
      void e.ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(10);
      ok("still deciding before the deadline", e.ctl.isExiting() && e.log.length === 0);
      eq("the deadline is the configured one", timers.filter((t) => t.live).map((t) => t.ms), [2500]);
      fire();
      await sleep(10);
      eq("the deadline closes the paywall, no downsell, no stamp", e.log, ["back"]);
      ok("the session slot is handed back", e.session.reserve());
    }
    // b) the offer lookup hangs
    {
      const e = build({ getOffer: () => never() });
      void e.ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(10);
      fire();
      await sleep(10);
      eq("a hung offer lookup also closes", e.log, ["back"]);
    }
    // c) a second close while the decision hangs (X again, or the swipe) leaves at once
    {
      const e = build({ entitlementNow: () => never() });
      void e.ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(10);
      await e.ctl.requestUserClose({ plan: "annual", isPro: false });
      eq("the second close leaves without waiting", e.log, ["back"]);
      fire();
      await sleep(10);
      eq("the late deadline navigates nowhere more", e.log, ["back"]);
      ok("the slot is not left taken", e.session.reserve());
    }
    // d) a lookup that answers after the deadline touches nothing
    {
      let release!: (v: { isPro: boolean; trialActive: boolean; lifetime: boolean }) => void;
      const slow = new Promise<{ isPro: boolean; trialActive: boolean; lifetime: boolean }>((r) => (release = r));
      const e = build({ entitlementNow: () => slow });
      void e.ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(10);
      fire();
      await sleep(10);
      const other = e.session.reserve();
      release({ isPro: false, trialActive: false, lifetime: false });
      await sleep(20);
      eq("the late answer does not stamp or navigate", e.log, ["back"]);
      ok("and does not release a slot another offer took", other && !e.session.reserve());
    }
    // e) the happy path is unchanged: a verified discount still opens the downsell
    {
      const e = build();
      await e.ctl.requestUserClose({ plan: "annual", isPro: false });
      eq("a quick answer still opens the downsell", e.log, ["stamp", "downsell"]);
      ok("the deadline timer was cleared", timers.every((t) => !t.live));
    }
    // f) a swipe/second close after the decision has already navigated does nothing more
    {
      const e = build();
      await e.ctl.requestUserClose({ plan: "annual", isPro: false });
      await e.ctl.requestUserClose({ plan: "annual", isPro: false });
      eq("a repeat after the decision is ignored", e.log, ["stamp", "downsell"]);
    }
  }

  section("B4. getPlan forgets a plan the store no longer backs");
  {
    const P = load();
    rc.offerings = () => offering;
    rc.purchase = async () => ({ customerInfo: active("zerospike_lifetime", "NORMAL", null) });
    await P.purchasePro("lifetime");
    rc.customerInfo = () => active("zerospike_lifetime", "NORMAL", null);
    eq("the plan is lifetime while Pro is active", await P.getPlan(), "lifetime");
    rc.customerInfo = () => inactive(); // refund
    eq("the store says no Pro", await P.verifyProWithStore(), false);
    eq("getPlan no longer says lifetime", await P.getPlan(), null);
    rc.customerInfo = () => {
      throw new Error("offline");
    };
    eq("offline after a refund: still no stale plan", await P.getPlan(), null);
  }
  {
    const P = load();
    rc.offerings = () => offering;
    rc.purchase = async () => ({ customerInfo: active("zerospike_pro_annual") });
    await P.purchasePro("annual");
    rc.customerInfo = () => {
      throw new Error("offline");
    };
    eq("offline while Pro: the remembered plan still answers", await P.getPlan(), "annual");
  }

  section("B6. a slow restore is not a connection error");
  {
    const P = load();
    let resolveLate: (v: any) => void = () => {};
    rc.restore = () => new Promise((r) => (resolveLate = r));
    rc.customerInfo = () => inactive();
    waits.length = 0;
    const result = await P.restore();
    eq("the result is slow", result, "slow");
    eq("iOS waits a minute", waits.includes(60000), true);
    eq("slow is reported as an error in the closed analytics set", restoreResultOf("slow"), "error");
    resolveLate(active("zerospike_pro_annual"));
    await sleep(30);
    ok("the late restore still turns Pro on", (await P.isProCached()) === true);
    eq("restoreTimeoutMs: ios 60 s, android 20 s", [P.restoreTimeoutMs("ios"), P.restoreTimeoutMs("android")], [60000, 20000]);
    // A genuine failure is still an error.
    const Q = load();
    rc.restore = async () => {
      throw new Error("network");
    };
    eq("a real failure stays an error", await Q.restore(), "error");
  }

  section("B10. the three feature reasons keep one analytics series");
  {
    const fold = (reason: string) => (normalizeEventParams("purchase_result", { reason }) as any).reason;
    eq("folds", [fold("nightscout"), fold("carbEstimate"), fold("cgmHistory"), fold("health"), fold("rotation")], ["health", "spike", "insights", "health", "feature"]);
  }

  section("B2-1. a pending note is approved only by the purchase it stands for");
  {
    const pendingAnnual = async () => {
      const P = load();
      rc.offerings = () => offering;
      rc.customerInfo = () => inactive();
      rc.purchase = async () => {
        throw { code: "20", message: "pending" };
      };
      await P.purchasePro("annual");
      return P;
    };
    const dated = (id: string, extra: Record<string, unknown>) => {
      const a = active(id, "NORMAL", 30);
      Object.assign((a.entitlements.active as any).pro, extra);
      return a;
    };
    // R3: the Ask to Buy was declined, a restore of an old monthly follows.
    {
      const P = await pendingAnnual();
      rc.restore = async () => dated("zerospike_pro", { latestPurchaseDate: new Date(Date.now() - 200 * DAY).toISOString() });
      eq("restore finds Pro", await P.restore(), "restored");
      eq("R3: no approval from a restore", await P.takeApprovedPurchase(), null);
      ok("R3: no welcome is owed", (await P.welcomeOwed()) === false);
    }
    // R4: another device (a different product, a fresh purchase date) brings Pro.
    {
      const P = await pendingAnnual();
      rc.customerInfo = () => dated("zerospike_pro", {});
      await P.verifyProWithStore();
      eq("R4: another product is not the pending annual", await P.takeApprovedPurchase(), null);
    }
    // The right product, but bought before the note: an old purchase found again.
    {
      const P = await pendingAnnual();
      rc.customerInfo = () => dated("zerospike_pro_annual", { latestPurchaseDate: new Date(Date.now() - DAY).toISOString() });
      await P.verifyProWithStore();
      eq("an older purchase of the same product is not it", await P.takeApprovedPurchase(), null);
    }
    // A family share of the same product.
    {
      const P = await pendingAnnual();
      rc.customerInfo = () => dated("zerospike_pro_annual", { ownershipType: "FAMILY_SHARED" });
      await P.verifyProWithStore();
      eq("a family share is not it", await P.takeApprovedPurchase(), null);
    }
    // The real approval still settles, even after a mismatch was ignored.
    {
      const P = await pendingAnnual();
      rc.customerInfo = () => dated("zerospike_pro", {});
      await P.verifyProWithStore();
      rc.customerInfo = () => dated("zerospike_pro_annual", { ownershipType: "PURCHASED" });
      await P.verifyProWithStore();
      eq("the matching purchase is approved", (await P.takeApprovedPurchase())?.plan, "annual");
    }
    // Android base plan ids still match.
    {
      const P = await pendingAnnual();
      rc.customerInfo = () => dated("zerospike_pro_annual:yearly", {});
      await P.verifyProWithStore();
      eq("a base-plan product id matches", (await P.takeApprovedPurchase())?.plan, "annual");
    }
  }

  section("B2-R. downsell and winback approvals settle on their own product; clock skew; settled notes");
  {
    const withOffer = {
      current: offering.current,
      all: {
        downsell: {
          availablePackages: [
            { packageType: "ANNUAL", product: { identifier: "zerospike_pro_annual_offer", price: 29.99, priceString: "$29.99", currencyCode: "USD", introPrice: { price: 19.99, priceString: "$19.99" } } },
          ],
        },
      },
    };
    const androidOffer = {
      current: offering.current,
      all: {
        downsell: {
          availablePackages: [
            { packageType: "ANNUAL", product: { identifier: "zerospike_pro_annual_offer:annual-offer", price: 29.99, priceString: "$29.99", currencyCode: "USD", introPrice: { price: 19.99, priceString: "$19.99" } } },
          ],
        },
      },
    };
    const proNow = (id: string, extra: Record<string, unknown> = {}) => {
      const a = active(id, "NORMAL", 365);
      Object.assign((a.entitlements.active as any).pro, extra);
      return a;
    };
    const pendingThrow = async () => {
      throw { code: "20", message: "pending" };
    };
    // R5: the downsell on iOS and on Android, and the winback that buys it.
    const cases: [string, string, string, (P: typeof PurchasesApi) => Promise<any>][] = [
      ["downsell ios", "ios", "zerospike_pro_annual_offer", (P) => P.purchaseDownsell()],
      ["downsell android", "android", "zerospike_pro_annual_offer:annual-offer", (P) => P.purchaseDownsell()],
      ["winback(downsell) android", "android", "zerospike_pro_annual_offer:annual-offer", (P) => P.purchaseWinback({ hasRealDiscount: true, source: "downsell", discountedPriceString: "$19.99", standardPriceString: "$29.99", savingsPercent: 33, appleOfferId: null } as any)],
    ];
    for (const [name, os, pid, buy] of cases) {
      rnStub.Platform.OS = os;
      const P = load();
      rc.offerings = () => (os === "android" ? androidOffer : withOffer);
      rc.customerInfo = () => inactive();
      rc.purchase = pendingThrow;
      const res = await buy(P);
      eq(`${name}: pending`, res.error, "pending");
      await sleep(2);
      rc.customerInfo = () => proNow(pid, { latestPurchaseDate: new Date().toISOString() });
      await P.verifyProWithStore();
      const approved = await P.takeApprovedPurchase();
      eq(`${name}: approved once as annual`, approved?.plan, "annual");
      eq(`${name}: not handed over twice (one purchase_completed)`, await P.takeApprovedPurchase(), null);
      ok(`${name}: the welcome is owed`, await P.welcomeOwed());
      // The standard annual product is not this purchase.
      const Q = load();
      rc.offerings = () => (os === "android" ? androidOffer : withOffer);
      rc.customerInfo = () => inactive();
      rc.purchase = pendingThrow;
      await buy(Q);
      rc.customerInfo = () => proNow("zerospike_pro_annual", { latestPurchaseDate: new Date().toISOString() });
      await Q.verifyProWithStore();
      eq(`${name}: another product is still not it`, await Q.takeApprovedPurchase(), null);
    }
    rnStub.Platform.OS = "ios";
    // A note from before productId was recorded falls back to the plan's product.
    {
      const P = load();
      store.set("zerospike.pendingPurchase", JSON.stringify({ plan: "annual", state: "pending", at: Date.now() - 1000, trial: false, trialEndsAt: null, trialDaysLeft: null }));
      rc.customerInfo = () => proNow("zerospike_pro_annual", { latestPurchaseDate: new Date().toISOString() });
      await P.verifyProWithStore();
      eq("an old note without a product id still matches the plan's product", (await P.takeApprovedPurchase())?.plan, "annual");
    }
    // R9: the device clock is ahead of the store by a minute, so the store's date is before the note's.
    {
      const P = load();
      rc.offerings = () => offering;
      rc.customerInfo = () => inactive();
      rc.purchase = pendingThrow;
      await P.purchasePro("annual");
      rc.customerInfo = () => proNow("zerospike_pro_annual", { latestPurchaseDate: new Date(Date.now() - 60_000).toISOString() });
      await P.verifyProWithStore();
      eq("R9: a store date 1 minute behind the device still counts", (await P.takeApprovedPurchase())?.plan, "annual");
      const Q = load();
      rc.customerInfo = () => inactive();
      await Q.purchasePro("annual");
      rc.customerInfo = () => proNow("zerospike_pro_annual", { latestPurchaseDate: new Date(Date.now() - 10 * 60_000).toISOString() });
      await Q.verifyProWithStore();
      eq("a purchase 10 minutes older than the note is still not it", await Q.takeApprovedPurchase(), null);
    }
    // R7: a settled note survives a new attempt and a restore; restore does drop a pending one.
    {
      const P = load();
      rc.offerings = () => offering;
      rc.customerInfo = () => inactive();
      rc.purchase = pendingThrow;
      await P.purchasePro("annual");
      await sleep(2);
      rc.customerInfo = () => proNow("zerospike_pro_annual", { latestPurchaseDate: new Date().toISOString() });
      await P.verifyProWithStore();
      await P.takeApprovedPurchase();
      ok("R7: welcome owed", await P.welcomeOwed());
      rc.purchase = async () => {
        throw { code: "1", userCancelled: true };
      };
      await P.purchasePro("monthly");
      ok("R7: a new purchase attempt keeps the settled note", await P.welcomeOwed());
      rc.restore = async () => proNow("zerospike_pro_annual");
      await P.restore();
      ok("R7: restore keeps it too", await P.welcomeOwed());
      await P.ackWelcomeShown();
      ok("R7: only the ack clears it", (await P.welcomeOwed()) === false);
    }
  }

  section("B2-6a. the note outlives the hand-over until the welcome is shown");
  {
    const P = load();
    rc.offerings = () => offering;
    rc.customerInfo = () => inactive();
    rc.purchase = async () => {
      throw { code: "20", message: "pending" };
    };
    await P.purchasePro("annual");
    rc.customerInfo = () => active("zerospike_pro_annual", "NORMAL", 365);
    await P.verifyProWithStore();
    eq("approved once", (await P.takeApprovedPurchase())?.plan, "annual");
    eq("events cannot repeat", await P.takeApprovedPurchase(), null);
    ok("the welcome is still owed", await P.welcomeOwed());
    // The app is killed before the welcome opens.
    const P2 = load(true);
    ok("owed after a relaunch", await P2.welcomeOwed());
    rc.restore = async () => active("zerospike_pro_annual", "NORMAL", 365);
    await P2.restore();
    ok("a restore does not erase the owed welcome", await P2.welcomeOwed());
    await P2.ackWelcomeShown();
    ok("shown: nothing is owed", (await P2.welcomeOwed()) === false);
    eq("and nothing to hand over", await P2.takeApprovedPurchase(), null);
  }

  section("B2-4. the welcome waits for every other overlay");
  {
    const open = { root: "(tabs)", overlayOpen: false, sheetClaimed: false, surveyHeld: false };
    ok("home and nothing else open: opens", welcomeMayOpen(open));
    ok("a Modal sheet is open: waits", !welcomeMayOpen({ ...open, overlayOpen: true }));
    ok("a sheet has claimed its slot: waits", !welcomeMayOpen({ ...open, sheetClaimed: true }));
    ok("the survey hold: waits", !welcomeMayOpen({ ...open, surveyHeld: true }));
    ok("off the home: waits", !welcomeMayOpen({ ...open, root: "spike" }));
    const host = readFileSync(join(process.cwd(), "components/ProApprovalHost.tsx"), "utf8");
    ok("the host asks the three sources", /overlayOpen\(\)/.test(host) && /sheetClaimed\(\)/.test(host) && /surveyHeld\(\)/.test(host));
    ok("the host retries on both release events", /onSheetRelease\(/.test(host) && /onSurveyRelease\(/.test(host));
    ok("the note is erased only after the push", host.indexOf('router.push("/pro-welcome")') < host.indexOf("ackWelcomeShown()", host.indexOf("router.push")));
  }

  section("B2-5. the 7-day stamp is written only when the downsell opens");
  {
    const mk = (over: Partial<PaywallExitDeps>, log: string[]) => {
      const deps: PaywallExitDeps = {
        isScreenshotMode: () => false,
        session: createSessionOfferFlag(),
        getState: async () => initialDownsellState,
        getOffer: async () => ({ hasRealDiscount: true }),
        entitlementNow: async () => ({ isPro: false, trialActive: false, lifetime: false }),
        onboardingIncomplete: async () => false,
        markOffered: async () => void log.push("STAMP"),
        now: () => 1_800_000_000_000,
        timer: { set: () => 1, clear: () => {} },
        ...over,
      };
      const ctl = createPaywallExitController(deps, {
        closePaywall: () => void log.push("back"),
        openDownsell: () => void log.push("downsell"),
      });
      return ctl;
    };
    // R1: a second X while the lookup runs, then the store says downsell.
    {
      const log: string[] = [];
      let answer!: (v: { hasRealDiscount: boolean }) => void;
      const ctl = mk({ getOffer: () => new Promise((r) => (answer = r)) }, log);
      void ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(5);
      await ctl.requestUserClose({ plan: "annual", isPro: false });
      answer({ hasRealDiscount: true });
      await sleep(20);
      eq("R1: left at once, no stamp for an offer nobody saw", log, ["back"]);
    }
    // R2: the deadline fires while the stamp would be written.
    {
      const log: string[] = [];
      let fire!: () => void;
      let release!: () => void;
      const ctl = mk(
        {
          markOffered: () => new Promise<void>((r) => ((release = r), void log.push("STAMP"))),
          getOffer: () => new Promise(() => {}),
          timer: { set: (fn: () => void) => ((fire = fn), 1), clear: () => {} },
        },
        log
      );
      void ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(5);
      fire();
      await sleep(5);
      release?.();
      await sleep(5);
      eq("R2: the deadline closes, no stamp", log, ["back"]);
    }
    // A purchase takes over while the decision is pending.
    {
      const log: string[] = [];
      let answer!: (v: { hasRealDiscount: boolean }) => void;
      const ctl = mk({ getOffer: () => new Promise((r) => (answer = r)) }, log);
      void ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(5);
      ctl.abandonPendingExit();
      answer({ hasRealDiscount: true });
      await sleep(20);
      eq("a purchase took over: no stamp, no screen", log, []);
    }
    // A slow stamp write does not hold the screen up, and a failing one is harmless.
    {
      const log: string[] = [];
      const ctl = mk({ markOffered: () => Promise.reject(new Error("disk")) }, log);
      await ctl.requestUserClose({ plan: "annual", isPro: false });
      await sleep(5);
      eq("a failed write still opens the downsell", log, ["downsell"]);
    }
  }

  section("B2-2. Pro coming back cancels the win-back");
  {
    eq("lapse makes it due", winbackTransition(true, false), "lost");
    eq("Pro regained clears it", winbackTransition(false, true), "regained");
    eq("Pro stays Pro: also clears (idempotent)", winbackTransition(true, true), "regained");
    eq("first read as free is nothing", winbackTransition(null, false), "none");
    eq("free stays free", winbackTransition(false, false), "none");
    const s = { ready: true, due: true, home: true, isPro: false };
    ok("due, home and free: opens", winbackMayOpen(s));
    ok("Pro: never opens", !winbackMayOpen({ ...s, isPro: true }));
    ok("not home: waits", !winbackMayOpen({ ...s, home: false }));
    ok("not due: nothing", !winbackMayOpen({ ...s, due: false }));
    const layout = readFileSync(join(process.cwd(), "app/_layout.tsx"), "utf8");
    ok("the root clears the due flag and the survey hold on regain", /move === "regained"[\s\S]{0,400}setWinbackDue\(false\)[\s\S]{0,200}surveyHold\.current\?\.\(\)/.test(layout));
    ok("the root re-checks Pro right before spending the one-time offer", /params && !proNowRef\.current[\s\S]{0,60}markWinbackShown/.test(layout));
    const wb = readFileSync(join(process.cwd(), "app/winback.tsx"), "utf8");
    ok("the winback screen redirects a Pro opener", /proAtOpen \|\| \(offer && !offer\.hasRealDiscount\)/.test(wb) && /if \(!offer \|\| proAtOpen\) return;/.test(wb));
  }

  section("B2-3. the onboarding back key and the welcome's exit");
  {
    ok("unfocused onboarding ignores back (the welcome is on top)", onboardingBackAction({ focused: false, phase: "quiz", stepIdx: 3 }) === "ignore");
    eq("focused quiz step 0 goes to the welcome phase", onboardingBackAction({ focused: true, phase: "quiz", stepIdx: 0 }), "toWelcome");
    eq("focused later step goes one back", onboardingBackAction({ focused: true, phase: "quiz", stepIdx: 2 }), "previousStep");
    eq("the reveal swallows it", onboardingBackAction({ focused: true, phase: "reveal", stepIdx: 0 }), "swallow");
    eq("the welcome phase keeps the system default", onboardingBackAction({ focused: true, phase: "welcome", stepIdx: 0 }), "ignore");
    const onb = readFileSync(join(process.cwd(), "app/onboarding.tsx"), "utf8");
    ok("the handler lives in useFocusEffect", /useFocusEffect\(\s*useCallback\(\(\) => \{\s*if \(Platform\.OS !== "android"\) return;\s*const sub = BackHandler/.test(onb));
    eq("unfinished onboarding exits the welcome to the quiz", welcomeExitTarget(false), "/onboarding");
    eq("finished onboarding exits to the tabs", welcomeExitTarget(true), "/(tabs)");
  }

  section("B2-6b. downsell and winback keep the CTA off while an approval is awaited");
  {
    for (const f of ["app/downsell.tsx", "app/winback.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      ok(`${f}: pending sets the awaiting flag`, /res\.error === "pending"\) setAwaitingApproval\(true\)/.test(src));
      ok(`${f}: the CTA is disabled while awaiting`, /disabled=\{busy \|\| awaitingApproval\}\s*\n\s*onPress=\{accept\}/.test(src));
      ok(`${f}: accept refuses a second request`, /awaitingApproval \|\|/.test(src));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
