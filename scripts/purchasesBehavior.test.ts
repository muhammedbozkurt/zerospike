/**
 * lib/services/purchases.ts behaviour harness. The RevenueCat SDK, AsyncStorage,
 * the analytics sink, the notifications service and the analytics switch are
 * stubbed at the module loader, so the REAL purchases module runs end to end:
 * the cache a failed store read must not touch (and what an offline read may
 * still call a trial), the single "entitlement lost" report, the iOS trial
 * eligibility behind hasFreeTrial, what a purchase did to the trial (the
 * decision the paywall acts on, including an intro price that is no trial and an
 * error that lands after the payment), the stale reminder coming down (also for a
 * trial cancelled in the store), the store's answer turning into the paywall's
 * action, and the RevenueCat device id following the analytics switch. No jest,
 * same standalone style as scripts/calc.test.ts.
 *
 * Run from the repo root, compile with tsc and run with node:
 *
 *   npx tsc scripts/purchasesBehavior.test.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir <tmp> --module commonjs --target es2019 --moduleResolution node \
 *     --skipLibCheck --esModuleInterop \
 *   && node <tmp>/scripts/purchasesBehavior.test.js
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: {
  (id: string): any;
  resolve: (id: string) => string;
  cache: Record<string, unknown>;
};
declare function setTimeout(handler: () => void, ms?: number): unknown;

// Type-only: it makes tsc compile purchases.ts (and what it imports) next to this
// file without loading it before the stubs below are in place.
import type * as PurchasesApi from "../lib/services/purchases";
import { TRIAL_REMINDER_LEAD_DAYS, trialReminderFireAt } from "../lib/trialTimeline";
import { trialSettleAction } from "../lib/trialSettle";
import { purchaseToastFor } from "../lib/services/purchaseFlow";

const DAY = 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

// ── Stubs ──────────────────────────────────────────────────────────────────

(globalThis as any).__DEV__ = false;

const store = new Map<string, string>();
const AsyncStorageStub = {
  getItem: async (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: async (k: string, v: string) => void store.set(k, String(v)),
  removeItem: async (k: string) => void store.delete(k),
};

const events: { name: string; params?: any }[] = [];
const crashes: { message: string; ctx: any }[] = [];
const analyticsStub = {
  logEvent: (name: string, params?: any) => void events.push({ name, params }),
  logCrash: (err: any, ctx?: any) => void crashes.push({ message: String(err && err.message), ctx }),
};
const lostEvents = () => events.filter((e) => e.name === "entitlement_lost");

const optOutState = {
  enabled: true,
  listeners: [] as ((enabled: boolean) => void | Promise<void>)[],
};
const optOutStub = {
  getAnalyticsEnabled: async () => optOutState.enabled,
  onAnalyticsEnabledChange: (listener: (enabled: boolean) => void | Promise<void>) => {
    optOutState.listeners.push(listener);
    return () => void optOutState.listeners.splice(optOutState.listeners.indexOf(listener), 1);
  },
};

const notificationsState = { cancelTrialReminder: 0 };
const notificationsStub = {
  cancelTrialReminder: async () => void notificationsState.cancelTrialReminder++,
};

const appStateListeners: ((state: string) => void)[] = [];
const rnStub: any = {
  Platform: { OS: "ios", select: (o: any) => o[rnStub.Platform.OS] },
  AppState: {
    addEventListener: (_type: string, fn: (state: string) => void) => {
      appStateListeners.push(fn);
      return { remove: () => void appStateListeners.splice(appStateListeners.indexOf(fn), 1) };
    },
  },
};

const rc = {
  customerInfo: (() => ({})) as () => any,
  offerings: (() => ({ current: { availablePackages: [] } })) as () => any,
  eligibility: (() => ({})) as (ids: string[]) => any,
  purchase: ((_pkg: any) => ({})) as (pkg: any) => any,
  restore: (() => ({})) as () => any,
  configureCalls: 0,
  attributeCalls: [] as any[],
  eligibilityCalls: [] as string[][],
  listeners: [] as ((info: any) => void)[],
};
const rcStub = {
  default: {
    configure: () => void rc.configureCalls++,
    getCustomerInfo: async () => rc.customerInfo(),
    setAttributes: async (a: any) => void rc.attributeCalls.push(a),
    enableAdServicesAttributionTokenCollection: async () => {},
    addCustomerInfoUpdateListener: (fn: (info: any) => void) => void rc.listeners.push(fn),
    removeCustomerInfoUpdateListener: (fn: (info: any) => void) => {
      const i = rc.listeners.indexOf(fn);
      if (i >= 0) rc.listeners.splice(i, 1);
      return i >= 0;
    },
    getOfferings: async () => rc.offerings(),
    checkTrialOrIntroductoryPriceEligibility: async (ids: string[]) => {
      rc.eligibilityCalls.push([...ids]);
      return rc.eligibility(ids);
    },
    purchasePackage: async (pkg: any) => rc.purchase(pkg),
    restorePurchases: async () => rc.restore(),
  },
};

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string, parent: any) {
  const from = parent && typeof parent.filename === "string" ? parent.filename : "";
  if (request === "react-native") return rnStub;
  if (request === "react") return { useSyncExternalStore: (_sub: unknown, get: () => unknown) => get() };
  if (request === "@react-native-async-storage/async-storage") {
    return { __esModule: true, default: AsyncStorageStub };
  }
  if (request === "react-native-purchases") return rcStub;
  if (request === "expo-crypto") {
    return { getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 3) };
  }
  if (/(^|\/)analytics$/.test(request)) return analyticsStub;
  if (/(^|\/)analytics\/optOut$/.test(request)) return optOutStub;
  if (request === "./notifications" && /purchases\.(js|ts)$/.test(from)) return notificationsStub;
  return realLoad.apply(this, arguments);
};

function reset(): void {
  store.clear();
  events.length = 0;
  crashes.length = 0;
  optOutState.enabled = true;
  optOutState.listeners.length = 0;
  notificationsState.cancelTrialReminder = 0;
  appStateListeners.length = 0;
  rnStub.Platform.OS = "ios";
  rc.customerInfo = () => ({});
  rc.offerings = () => ({ current: { availablePackages: [] } });
  rc.eligibility = () => ({});
  rc.purchase = () => ({});
  rc.restore = () => ({});
  rc.configureCalls = 0;
  rc.attributeCalls.length = 0;
  rc.eligibilityCalls.length = 0;
  rc.listeners.length = 0;
}

/** A fresh copy of the module: its configure flag, store status and queue start clean. */
function loadPurchases(): typeof PurchasesApi {
  const key = require.resolve("../lib/services/purchases");
  delete require.cache[key];
  return require("../lib/services/purchases");
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const entitlementInfo = (ent: any) => ({
  entitlements: { active: { pro: ent }, all: { pro: { periodType: ent.periodType } } },
});
// `extra` carries what only some tests care about: willRenew, latestPurchaseDate.
const trialInfo = (days: number, extra: any = {}) =>
  entitlementInfo({ periodType: "TRIAL", expirationDate: inDays(days), productIdentifier: "zerospike_pro_annual", ...extra });
const paidInfo = (productIdentifier = "zerospike_pro_annual", extra: any = {}) =>
  entitlementInfo({ periodType: "NORMAL", expirationDate: inDays(365), productIdentifier, ...extra });
const introInfo = (extra: any = {}) =>
  entitlementInfo({ periodType: "INTRO", expirationDate: inDays(30), productIdentifier: "zerospike_pro_annual", ...extra });
const lifetimeInfo = () =>
  entitlementInfo({ periodType: "NORMAL", expirationDate: null, productIdentifier: "zerospike_lifetime" });
const unknownInfo = (periodType?: string) =>
  entitlementInfo({ periodType, expirationDate: inDays(7), productIdentifier: "zerospike_pro_annual" });
const inactiveInfo = (periodType?: string) => ({
  entitlements: { active: {}, all: periodType ? { pro: { periodType } } : {} },
});

const FREE_INTRO = { price: 0, priceString: "$0.00", periodUnit: "DAY", periodNumberOfUnits: 7 };
const pkg = (packageType: string, productId: string, price: number, extra: any = {}) => ({
  identifier: `$rc_${packageType.toLowerCase()}`,
  packageType,
  product: { identifier: productId, priceString: `$${price}`, price, currencyCode: "USD", introPrice: null, ...extra },
});
const iosOffering = (annualExtra: any = { introPrice: FREE_INTRO }) => ({
  current: {
    availablePackages: [
      pkg("MONTHLY", "zerospike_pro", 4.99),
      pkg("ANNUAL", "zerospike_pro_annual", 29.99, annualExtra),
      pkg("LIFETIME", "zerospike_lifetime", 79.99),
    ],
  },
});
const eligibilityOf = (status: number) => ({
  zerospike_pro_annual: { status, description: "stub" },
});

(async () => {
  console.log("zerospike purchases behaviour test");

  // ── A ────────────────────────────────────────────────────────────────────
  section("A. a failed store read never touches the cached entitlement");
  {
    reset();
    const P = loadPurchases();
    rc.customerInfo = () => trialInfo(5);
    eq("a good read says active", await P.verifyProWithStore(), true);
    eq("and warms the cache", store.get("zerospike.isPro"), "true");
    eq("store status ok", P.getStoreStatus(), "ok");

    rc.customerInfo = () => {
      throw new Error("offline");
    };
    eq("a failed read is null, never false", await P.verifyProWithStore(), null);
    eq("the cached flag is untouched", store.get("zerospike.isPro"), "true");
    eq("the caller still gets the last known entitlement", await P.isPro(), true);
    eq("store status error", P.getStoreStatus(), "error");
    const offlineTrial = await P.getTrialStatus();
    eq("the trial countdown survives offline", offlineTrial && offlineTrial.active && offlineTrial.daysLeft, 5);
    ok("with the store's own expiry", typeof offlineTrial?.expiresAt === "number");
    eq(
      "the outage is reported once, not per retry",
      crashes.filter((c) => c.ctx && c.ctx.op === "getCustomerInfo").length,
      1
    );
    eq("a failure is not a loss", lostEvents().length, 0);

    rc.customerInfo = () => null as any;
    eq("an empty answer counts as a failure too", await P.verifyProWithStore(), null);
    eq("cache still untouched", store.get("zerospike.isPro"), "true");
  }

  // ── A2 ───────────────────────────────────────────────────────────────────
  section("A2. offline, the period type the store last reported decides whether there is a trial");
  {
    const offline = () => {
      throw new Error("offline");
    };
    for (const [label, info] of [
      ["a paying subscriber", () => paidInfo()],
      ["a lifetime owner (no expiry at all)", () => lifetimeInfo()],
      ["an intro-price period", () => introInfo()],
    ] as [string, () => any][]) {
      reset();
      const P = loadPurchases();
      rc.customerInfo = info;
      eq(`${label}: Pro is active online`, await P.verifyProWithStore(), true);
      rc.customerInfo = offline;
      eq(`${label}: the store cannot be read`, await P.verifyProWithStore(), null);
      eq(`${label}: no trial is invented from the cached period`, await P.getTrialStatus(), null);
      eq(`${label}: so nothing counts as during a trial`, await P.isDuringTrial(), false);
    }

    reset();
    let P = loadPurchases();
    rc.customerInfo = () => trialInfo(5);
    await P.verifyProWithStore();
    rc.customerInfo = offline;
    eq("a trial user keeps the countdown offline", (await P.getTrialStatus())?.daysLeft, 5);
    eq("and still counts as during a trial", await P.isDuringTrial(), true);

    reset();
    P = loadPurchases();
    store.set("zerospike.proFacts", JSON.stringify({ periodType: "trial", expiresAt: Date.now() - DAY }));
    rc.customerInfo = offline;
    eq("a remembered trial that has run out is not a trial", await P.getTrialStatus(), null);

    reset();
    P = loadPurchases();
    rc.customerInfo = offline;
    eq("nothing remembered, nothing to say", await P.getTrialStatus(), null);
  }

  // ── B ────────────────────────────────────────────────────────────────────
  section("B. entitlement_lost is reported once per loss");
  {
    reset();
    const P = loadPurchases();
    rc.customerInfo = () => trialInfo(3);
    await P.verifyProWithStore();
    rc.customerInfo = () => inactiveInfo("TRIAL");
    eq("the store says inactive", await P.verifyProWithStore(), false);
    eq("cache flips to false", store.get("zerospike.isPro"), "false");
    eq("one loss event", lostEvents().length, 1);
    eq("with the lapsed entitlement's period type", lostEvents()[0] && lostEvents()[0].params, { period_type: "trial" });
    await P.verifyProWithStore();
    eq("a repeat read does not report again", lostEvents().length, 1);

    rc.customerInfo = () => trialInfo(3);
    await P.verifyProWithStore();
    rc.customerInfo = () => inactiveInfo();
    await Promise.all([P.verifyProWithStore(), P.verifyProWithStore(), P.verifyProWithStore()]);
    eq("three concurrent answers report one more loss, not three", lostEvents().length, 2);
    eq(
      "its period type falls back to the last facts",
      lostEvents()[1] && lostEvents()[1].params,
      { period_type: "trial" }
    );

    rc.customerInfo = () => paidInfo();
    await P.verifyProWithStore();
    let changes = 0;
    const stop = P.watchEntitlement(() => void changes++);
    await flush();
    eq("the update listener is attached", rc.listeners.length, 1);
    rc.listeners[0](inactiveInfo("NORMAL"));
    await flush();
    eq("a pushed lapse reports with the store's period type", lostEvents()[lostEvents().length - 1].params, { period_type: "normal" });
    eq("and tells the caller", changes, 1);
    const afterPush = lostEvents().length;
    rc.listeners[0](inactiveInfo("NORMAL"));
    await flush();
    eq("a second push of the same lapse is not a second loss", lostEvents().length, afterPush);
    rc.listeners[0](null);
    await flush();
    eq("an empty push is ignored", store.get("zerospike.isPro"), "false");
    stop();
    eq("the listener is detached", rc.listeners.length, 0);
  }

  // ── C ────────────────────────────────────────────────────────────────────
  section("C. iOS: hasFreeTrial follows the store's eligibility, not the offer");
  {
    for (const [label, status, want] of [
      ["ELIGIBLE", 2, true],
      ["UNKNOWN", 0, false],
      ["INELIGIBLE", 1, false],
      ["NO_INTRO_OFFER_EXISTS", 3, false],
    ] as [string, number, boolean][]) {
      reset();
      const P = loadPurchases();
      rc.offerings = () => iosOffering();
      rc.eligibility = () => eligibilityOf(status);
      const res = await P.loadOfferings();
      eq(`${label}: the offering loads`, res.status, "ready");
      eq(`${label}: annual hasFreeTrial`, res.plans.annual?.hasFreeTrial, want);
      eq(`${label}: annual freeTrialDays`, res.plans.annual?.freeTrialDays, want ? 7 : 0);
      eq(`${label}: only the free-trial product is asked about`, rc.eligibilityCalls, [["zerospike_pro_annual"]]);
      eq(`${label}: plans without an intro offer are untouched`, res.plans.monthly?.hasFreeTrial, false);
    }

    reset();
    {
      const Q = loadPurchases();
      rc.offerings = () => ({ current: { availablePackages: [] } });
      await Q.loadOfferings();
      await Q.loadOfferings();
      eq("a failed offerings load emits no analytics event", events.length, 0);
    }

    reset();
    {
      const Q = loadPurchases();
      rc.offerings = () => {
        throw new Error("offline");
      };
      const r = await Q.loadOfferings();
      eq("fetch_error is unavailable", r.status, "unavailable");
      eq("fetch_error still marks the store status error", Q.getStoreStatus(), "error");
    }

    reset();
    let P = loadPurchases();
    rc.offerings = () => iosOffering();
    rc.eligibility = () => ({});
    eq(
      "a missing eligibility entry is not eligible",
      (await P.loadOfferings()).plans.annual?.hasFreeTrial,
      false
    );

    reset();
    P = loadPurchases();
    rc.offerings = () => iosOffering();
    rc.eligibility = () => {
      throw new Error("eligibility unavailable");
    };
    const failedCheck = await P.loadOfferings();
    eq("a failed check does not fail the paywall", failedCheck.status, "ready");
    eq("but it promises no trial", failedCheck.plans.annual?.hasFreeTrial, false);
    eq("the prices are still there", failedCheck.plans.annual?.priceString, "$29.99");
    eq("the failure is reported", crashes.filter((c) => c.ctx && c.ctx.op === "trialEligibility").length, 1);
    eq("and the store itself still counts as reachable", P.getStoreStatus(), "ok");

    // A check that never answers must not hold the paywall hostage: only the
    // eligibility wait is shortened here, every other timer keeps its length.
    reset();
    P = loadPurchases();
    rc.offerings = () => iosOffering();
    rc.eligibility = () => new Promise(() => {});
    const realSetTimeout = (globalThis as any).setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, ms?: number, ...rest: unknown[]) =>
      realSetTimeout(fn, ms === P.ELIGIBILITY_TIMEOUT_MS ? 20 : ms, ...rest);
    let slowCheck: PurchasesApi.OfferingsResult;
    try {
      slowCheck = await P.loadOfferings();
    } finally {
      (globalThis as any).setTimeout = realSetTimeout;
    }
    eq("a check that never answers still loads the paywall", slowCheck.status, "ready");
    eq("with the plain price and no trial", slowCheck.plans.annual?.hasFreeTrial, false);
    eq("and the wait is reported", crashes.filter((c) => c.ctx && c.ctx.op === "trialEligibility").length, 1);

    reset();
    P = loadPurchases();
    rc.offerings = () => iosOffering({ introPrice: null });
    const noTrial = await P.loadOfferings();
    eq("no free-trial product, no eligibility call", rc.eligibilityCalls.length, 0);
    eq("and no trial", noTrial.plans.annual?.hasFreeTrial, false);

    reset();
    P = loadPurchases();
    rc.offerings = () => iosOffering({ introPrice: { price: 1.99, priceString: "$1.99", periodUnit: "MONTH", periodNumberOfUnits: 1 } });
    const paidIntro = await P.loadOfferings();
    eq("a paid intro price is not a trial and needs no eligibility call", rc.eligibilityCalls.length, 0);
    eq("it stays a paid intro", paidIntro.plans.annual?.introPriceString, "$1.99");
    eq("with no free trial", paidIntro.plans.annual?.hasFreeTrial, false);
  }

  section("C2. Android keeps what the offer says");
  {
    reset();
    rnStub.Platform.OS = "android";
    const P = loadPurchases();
    rc.offerings = () => ({
      current: {
        availablePackages: [
          pkg("ANNUAL", "zerospike_pro_annual:annualv2", 29.99, {
            introPrice: FREE_INTRO,
            subscriptionOptions: [{ freePhase: { billingPeriod: { unit: "DAY", value: 7 } } }],
          }),
        ],
      },
    });
    const res = await P.loadOfferings();
    eq("annual hasFreeTrial", res.plans.annual?.hasFreeTrial, true);
    eq("annual freeTrialDays", res.plans.annual?.freeTrialDays, 7);
    eq("the eligibility API is not used on Android", rc.eligibilityCalls.length, 0);
  }

  // ── D ────────────────────────────────────────────────────────────────────
  section("D. after a purchase the trial decision comes from the store");
  {
    // An eligible account: the annual purchase starts a real trial.
    reset();
    let P = loadPurchases();
    let info = trialInfo(7);
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    let res = await P.purchasePro("annual");
    eq("the purchase went through", res.ok, true);
    let after = await P.trialAfterPurchase(res);
    eq("a trial started", after.kind, "started");
    const expiry = Date.parse(info.entitlements.active.pro.expirationDate);
    eq("with the store's own expiry", (after as any).endsAt, expiry);
    eq("and its length from today", (after as any).daysLeft, 7);
    eq(
      "the reminder is timed from that expiry, lead days before it",
      trialReminderFireAt(expiry),
      expiry - TRIAL_REMINDER_LEAD_DAYS * DAY
    );

    // The same package on an account that already used its intro offer.
    reset();
    P = loadPurchases();
    info = paidInfo() as any;
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    eq("the purchase went through", res.ok, true);
    eq("but no trial started, whatever the offer said", (await P.trialAfterPurchase(res)).kind, "none");

    // The store unreachable right after the purchase: what the purchase itself
    // reported is still on record.
    reset();
    P = loadPurchases();
    info = trialInfo(7);
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    rc.customerInfo = () => {
      throw new Error("offline");
    };
    after = await P.trialAfterPurchase(res);
    eq("an offline read still finds the trial the purchase made", after.kind, "started");
    eq("with its expiry", (after as any).endsAt, Date.parse(info.entitlements.active.pro.expirationDate));

    // Lifetime and monthly purchases carry no trial.
    reset();
    P = loadPurchases();
    info = paidInfo("zerospike_lifetime") as any;
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    res = await P.purchasePro("lifetime");
    eq("lifetime: no trial", (await P.trialAfterPurchase(res)).kind, "none");

    // An already-owned recovery is not a new trial.
    reset();
    P = loadPurchases();
    info = trialInfo(4);
    rc.offerings = () => iosOffering();
    rc.purchase = () => {
      const err: any = new Error("already purchased");
      err.code = "6";
      throw err;
    };
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    eq("the recovery counts as a success", res.ok && res.recovered, true);
    eq(
      "a running trial is left alone: not started again, not cancelled",
      (await P.trialAfterPurchase(res)).kind,
      "running"
    );

    reset();
    P = loadPurchases();
    info = paidInfo() as any;
    rc.offerings = () => iosOffering();
    rc.purchase = () => {
      const err: any = new Error("already purchased");
      err.code = "6";
      throw err;
    };
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    eq("a recovered paid subscription is no trial", (await P.trialAfterPurchase(res)).kind, "none");

    // A cancelled or failed purchase.
    reset();
    P = loadPurchases();
    rc.offerings = () => iosOffering();
    rc.purchase = () => {
      const err: any = new Error("cancelled");
      err.userCancelled = true;
      throw err;
    };
    res = await P.purchasePro("annual");
    eq("a cancelled purchase is not ok", res.ok, false);
    eq("and starts nothing", (await P.trialAfterPurchase(res)).kind, "none");

    // An entitlement already past its expiry is not a running trial.
    reset();
    P = loadPurchases();
    info = trialInfo(-1);
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    eq("an expired trial entitlement starts nothing", (await P.trialAfterPurchase(res)).kind, "none");
  }

  // ── D1 ───────────────────────────────────────────────────────────────────
  section("D1. an intro-price period is a paid period, never a trial");
  {
    const NO_TRIAL = { active: false, daysLeft: null, expiresAt: null };
    reset();
    let P = loadPurchases();
    rc.customerInfo = () => introInfo();
    eq("the store says Pro is active", await P.verifyProWithStore(), true);
    eq("but it is no trial", await P.getTrialStatus(), NO_TRIAL);
    eq("nor is the user during one", await P.isDuringTrial(), false);

    reset();
    P = loadPurchases();
    const info: any = introInfo();
    rc.offerings = () =>
      iosOffering({ introPrice: { price: 1.99, priceString: "$1.99", periodUnit: "MONTH", periodNumberOfUnits: 1 } });
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    const res = await P.purchasePro("annual");
    eq("the intro-price purchase went through", res.ok, true);
    eq("and started no trial", (await P.trialAfterPurchase(res)).kind, "none");

    for (const [label, periodType] of [
      ["a period type this build does not know", "SOMETHING_NEW"],
      ["no period type at all", undefined],
    ] as [string, string | undefined][]) {
      reset();
      P = loadPurchases();
      rc.customerInfo = () => unknownInfo(periodType);
      eq(`${label}: Pro is active`, await P.verifyProWithStore(), true);
      eq(`${label}: but it is no trial`, await P.getTrialStatus(), NO_TRIAL);
    }
  }

  // ── D2 ───────────────────────────────────────────────────────────────────
  section("D2. an error after the store took the payment is a purchase, not a recovery");
  {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const failure = (code?: string) => {
      const err: any = new Error("store error");
      if (code !== undefined) err.code = code;
      return err;
    };
    // The payment goes through at `purchasedAt`, a moment after the attempt began
    // and before the error comes back; the store then reports the entitlement as
    // `info(purchasedAt)` says.
    const buyWith = async (code: string | undefined, info: (purchasedAt: string) => any) => {
      reset();
      const P = loadPurchases();
      let purchasedAt = "";
      rc.offerings = () => iosOffering();
      rc.purchase = async () => {
        purchasedAt = new Date().toISOString();
        await sleep(8);
        throw failure(code);
      };
      rc.customerInfo = () => info(purchasedAt);
      const res = await P.purchasePro("annual");
      return { P, res, after: await P.trialAfterPurchase(res) };
    };
    const NETWORK = "10";

    // The dropped connection came after the payment: the trial is new.
    let t = await buyWith(NETWORK, (at) => trialInfo(7, { latestPurchaseDate: at }));
    eq("the purchase counts as made", [t.res.ok, t.res.recovered, t.res.error], [true, false, null]);
    eq("it started a trial", t.after.kind, "started");
    ok("timed from the store's expiry", typeof (t.after as any).endsAt === "number");
    eq("the user hears it was activated, not that it was already theirs", purchaseToastFor(t.res)?.key, "paywall.activated");
    eq("the plan is remembered", store.get("zerospike.proPlan"), "annual");

    // The same error for a subscriber whose trial began three days ago.
    t = await buyWith(NETWORK, () => trialInfo(4, { latestPurchaseDate: inDays(-3) }));
    eq("an older entitlement is only found again", [t.res.ok, t.res.recovered], [true, true]);
    eq("its running trial is left alone", t.after.kind, "running");
    eq("and the user is told it was already theirs", purchaseToastFor(t.res)?.key, "paywall.alreadyOwned");

    // An already-owned error is a recovery, whatever date the entitlement carries.
    for (const code of ["6", "7"]) {
      t = await buyWith(code, (at) => trialInfo(7, { latestPurchaseDate: at }));
      eq(`already-owned error ${code}: a recovery`, [t.res.ok, t.res.recovered], [true, true]);
      eq(`already-owned error ${code}: not a new trial`, t.after.kind, "running");
    }
    {
      reset();
      const P = loadPurchases();
      let restored = false;
      const found = () => trialInfo(7, { latestPurchaseDate: new Date().toISOString() });
      rc.offerings = () => iosOffering();
      rc.purchase = async () => {
        throw failure("7");
      };
      rc.customerInfo = () => (restored ? found() : inactiveInfo());
      rc.restore = () => {
        restored = true;
        return found();
      };
      const res = await P.purchasePro("annual");
      eq("a recovery that needed the restore is still a recovery", [res.ok, res.recovered], [true, true]);
      eq("and still no new trial", (await P.trialAfterPurchase(res)).kind, "running");
    }

    t = await buyWith(NETWORK, () => paidInfo("zerospike_pro_annual", { latestPurchaseDate: inDays(-200) }));
    eq("a long-time subscriber hitting an unrelated error", [t.res.ok, t.res.recovered], [true, true]);
    eq("has no trial", t.after.kind, "none");

    t = await buyWith(NETWORK, (at) => paidInfo("zerospike_pro_annual", { latestPurchaseDate: at }));
    eq("a paid purchase that landed despite the error counts as made", [t.res.ok, t.res.recovered], [true, false]);
    eq("and started no trial", t.after.kind, "none");

    t = await buyWith(NETWORK, () => trialInfo(7));
    eq("with no purchase date to go by it stays a recovery", [t.res.ok, t.res.recovered], [true, true]);
    eq("as it always was", t.after.kind, "running");
    t = await buyWith(NETWORK, () => trialInfo(7, { latestPurchaseDate: "not a date" }));
    eq("an unreadable date says the same", [t.res.ok, t.res.recovered], [true, true]);

    // Bought in the very millisecond the attempt began still counts as made. The
    // clock is frozen for it, the timers are not.
    const realNow = Date.now;
    const T = realNow.call(Date);
    Date.now = () => T;
    try {
      t = await buyWith(NETWORK, () => trialInfo(7, { latestPurchaseDate: new Date(T).toISOString() }));
      eq("bought at the moment the attempt began: made", t.res.recovered, false);
      t = await buyWith(NETWORK, () => trialInfo(7, { latestPurchaseDate: new Date(T - 1000).toISOString() }));
      eq("bought a second before it began: found again", t.res.recovered, true);
    } finally {
      Date.now = realNow;
    }

    // Nothing to recover: still an error.
    t = await buyWith(NETWORK, () => inactiveInfo());
    eq("a failed purchase with no entitlement", [t.res.ok, t.res.recovered, t.res.error], [false, false, "storeError"]);
    eq("starts nothing", t.after.kind, "none");
    t = await buyWith("6", () => inactiveInfo());
    eq("an already-owned error that no restore can back", [t.res.ok, t.res.error], [false, "alreadyOwned"]);

    // The discounted annual runs through the same recovery.
    const buyDownsell = async (info: (purchasedAt: string) => any) => {
      reset();
      const P = loadPurchases();
      let purchasedAt = "";
      rc.offerings = () => ({
        current: iosOffering().current,
        all: { downsell: { availablePackages: [pkg("ANNUAL", "zerospike_pro_annual", 19.99)] } },
      });
      rc.purchase = async () => {
        purchasedAt = new Date().toISOString();
        await sleep(8);
        throw failure(NETWORK);
      };
      rc.customerInfo = () => info(purchasedAt);
      return P.purchaseDownsell();
    };
    let d = await buyDownsell((at) => paidInfo("zerospike_pro_annual", { latestPurchaseDate: at }));
    eq("downsell: an error after the payment counts as made", [d.ok, d.recovered], [true, false]);
    d = await buyDownsell(() => paidInfo("zerospike_pro_annual", { latestPurchaseDate: inDays(-200) }));
    eq("downsell: an old entitlement is only found again", [d.ok, d.recovered], [true, true]);
  }

  // ── E ────────────────────────────────────────────────────────────────────
  section("E. the trial reminder comes down when the trial is no longer running");
  {
    reset();
    let P = loadPurchases();
    rc.customerInfo = () => trialInfo(7);
    await P.verifyProWithStore();
    const stop = P.watchEntitlement(() => {});
    await flush();
    rc.listeners[0](trialInfo(6));
    await flush();
    eq("a push that still shows the trial leaves the reminder alone", notificationsState.cancelTrialReminder, 0);
    rc.listeners[0](paidInfo());
    await flush();
    eq("a push showing the trial converted takes it down", notificationsState.cancelTrialReminder, 1);
    rc.listeners[0](paidInfo());
    await flush();
    eq("and later pushes do not touch it again", notificationsState.cancelTrialReminder, 1);
    stop();

    reset();
    P = loadPurchases();
    rc.customerInfo = () => trialInfo(7);
    await P.verifyProWithStore();
    rc.customerInfo = () => inactiveInfo("TRIAL");
    await P.verifyProWithStore();
    eq("a lapsed trial takes it down too", notificationsState.cancelTrialReminder, 1);

    reset();
    P = loadPurchases();
    rc.customerInfo = () => inactiveInfo();
    for (let i = 0; i < 4; i++) await P.verifyProWithStore();
    await flush();
    eq("a free user's refreshes never touch the notification stack", notificationsState.cancelTrialReminder, 0);

    reset();
    P = loadPurchases();
    rc.customerInfo = () => paidInfo();
    for (let i = 0; i < 4; i++) await P.verifyProWithStore();
    await flush();
    eq("nor does a paying user's", notificationsState.cancelTrialReminder, 0);

    reset();
    P = loadPurchases();
    rc.customerInfo = () => trialInfo(5);
    await P.verifyProWithStore();
    rc.restore = () => trialInfo(5);
    eq("a restore that brings back the running trial", await P.restore(), "restored");
    await flush();
    eq("does not cancel its reminder", notificationsState.cancelTrialReminder, 0);
    rc.restore = () => paidInfo("zerospike_lifetime");
    eq("a restore of a paid entitlement", await P.restore(), "restored");
    await flush();
    eq("retires a reminder the earlier trial left", notificationsState.cancelTrialReminder, 1);

    // An intro price after a trial is a paid period: the trial is over.
    reset();
    P = loadPurchases();
    rc.customerInfo = () => trialInfo(7);
    await P.verifyProWithStore();
    rc.customerInfo = () => introInfo();
    await P.verifyProWithStore();
    await flush();
    eq("an intro-price period is no running trial, so the reminder comes down", notificationsState.cancelTrialReminder, 1);
  }

  section("E2. a trial cancelled in the store will not convert, so its reminder comes down");
  {
    reset();
    let P = loadPurchases();
    rc.customerInfo = () => trialInfo(7, { willRenew: true });
    await P.verifyProWithStore();
    const stop = P.watchEntitlement(() => {});
    await flush();
    rc.listeners[0](trialInfo(6, { willRenew: true }));
    await flush();
    eq("a trial set to renew keeps its reminder", notificationsState.cancelTrialReminder, 0);
    rc.listeners[0](trialInfo(6));
    await flush();
    eq("a store that says nothing about renewal is not a cancellation", notificationsState.cancelTrialReminder, 0);
    rc.listeners[0](trialInfo(5, { willRenew: false }));
    await flush();
    eq("one cancelled in the store takes it down while the trial still runs", notificationsState.cancelTrialReminder, 1);
    stop();

    reset();
    P = loadPurchases();
    rc.customerInfo = () => trialInfo(5, { willRenew: false });
    eq("the app was closed when it was cancelled: Pro is still active", await P.verifyProWithStore(), true);
    await flush();
    eq("the next read takes the reminder down without any earlier trial on record", notificationsState.cancelTrialReminder, 1);
    eq("and the trial still counts as running until it ends", (await P.getTrialStatus())?.active, true);

    reset();
    P = loadPurchases();
    rc.customerInfo = () => paidInfo("zerospike_pro_annual", { willRenew: false });
    await P.verifyProWithStore();
    await P.verifyProWithStore();
    await flush();
    eq("a paid subscription that will not renew is not a trial's concern", notificationsState.cancelTrialReminder, 0);
  }

  // ── F ────────────────────────────────────────────────────────────────────
  section("F. the RevenueCat device id only exists while usage analytics is on");
  {
    reset();
    let P = loadPurchases();
    rc.customerInfo = () => inactiveInfo();
    await P.verifyProWithStore();
    await flush();
    eq("analytics on: the id is attached once", rc.attributeCalls.length, 1);
    ok("as device_id", rc.attributeCalls[0] && typeof rc.attributeCalls[0].device_id === "string");

    reset();
    optOutState.enabled = false;
    P = loadPurchases();
    rc.customerInfo = () => inactiveInfo();
    await P.verifyProWithStore();
    await P.verifyProWithStore();
    await flush();
    eq("analytics off: the SDK start only takes a leftover id off the customer", rc.attributeCalls, [{ device_id: null }]);
    ok("and no id is ever attached", rc.attributeCalls.every((a) => a.device_id === null));

    // Whatever configures the SDK first does it, not one particular caller.
    reset();
    optOutState.enabled = false;
    P = loadPurchases();
    rc.offerings = () => iosOffering({ introPrice: null });
    await P.loadOfferings();
    await flush();
    eq("analytics off, first touch is the offering: the leftover id is taken off too", rc.attributeCalls, [{ device_id: null }]);

    reset();
    P = loadPurchases();
    rc.offerings = () => iosOffering({ introPrice: null });
    await P.loadOfferings();
    await flush();
    eq("analytics on, first touch is the offering: the id is attached", rc.attributeCalls.length, 1);
    ok("as the device id", typeof rc.attributeCalls[0]?.device_id === "string");

    reset();
    P = loadPurchases();
    rc.customerInfo = () => inactiveInfo();
    await P.verifyProWithStore();
    await flush();
    const id = rc.attributeCalls[0] && rc.attributeCalls[0].device_id;
    eq("one switch listener is registered", optOutState.listeners.length, 1);
    optOutState.enabled = false;
    await optOutState.listeners[0](false);
    eq("switching analytics off takes the id back", rc.attributeCalls[rc.attributeCalls.length - 1], { device_id: null });
    optOutState.enabled = true;
    await optOutState.listeners[0](true);
    eq("switching it on puts the same id back", rc.attributeCalls[rc.attributeCalls.length - 1], { device_id: id });

    // The listener was told "on", but the switch is off again by the time it runs.
    optOutState.enabled = false;
    const sent = rc.attributeCalls.length;
    await optOutState.listeners[0](true);
    eq("an 'on' that is already stale attaches nothing", rc.attributeCalls.length, sent);
  }

  // ── G ────────────────────────────────────────────────────────────────────
  section("G. the store's answer becomes the action the paywall carries out");
  {
    const settle = async (P: typeof PurchasesApi, res: PurchasesApi.PurchaseOutcome, offerDays = 3) =>
      trialSettleAction({ restored: false, trial: await P.trialAfterPurchase(res), offerDays, now: Date.now() });
    const INERT = { logTrialStarted: false, scheduleReminderAt: null, trialDays: null, cancelReminder: false };
    const CANCEL = { logTrialStarted: false, scheduleReminderAt: null, trialDays: null, cancelReminder: true };

    // An eligible account: the offer said 3 days, the store started 7.
    reset();
    let P = loadPurchases();
    let info: any = trialInfo(7);
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    let res = await P.purchasePro("annual");
    eq(
      "a started trial is reported and armed from the store's expiry and length",
      await settle(P, res),
      {
        logTrialStarted: true,
        scheduleReminderAt: Date.parse(info.entitlements.active.pro.expirationDate),
        trialDays: 7,
        cancelReminder: false,
      }
    );

    reset();
    P = loadPurchases();
    info = paidInfo();
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    eq("an account that used its intro offer elsewhere: a paid period retires the old reminder", await settle(P, res), CANCEL);

    reset();
    P = loadPurchases();
    info = introInfo();
    rc.offerings = () => iosOffering();
    rc.purchase = () => ({ customerInfo: info });
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    eq("an intro price is not reported as a trial", await settle(P, res), CANCEL);

    reset();
    P = loadPurchases();
    info = trialInfo(4);
    rc.offerings = () => iosOffering();
    rc.purchase = () => {
      const err: any = new Error("already purchased");
      err.code = "6";
      throw err;
    };
    rc.customerInfo = () => info;
    res = await P.purchasePro("annual");
    eq("an already-owned recovery of a running trial changes nothing", await settle(P, res), INERT);

    reset();
    P = loadPurchases();
    rc.offerings = () => iosOffering();
    rc.purchase = () => {
      const err: any = new Error("network");
      err.code = "10";
      throw err;
    };
    rc.customerInfo = () => trialInfo(7, { latestPurchaseDate: new Date().toISOString() });
    res = await P.purchasePro("annual");
    const landed = await settle(P, res);
    eq("a trial whose purchase threw after the payment is still reported", landed.logTrialStarted, true);
    ok("and gets its reminder", typeof landed.scheduleReminderAt === "number");
    eq("with the store's length", landed.trialDays, 7);

    // A restore brings back a running trial, or an entitlement with none in it.
    reset();
    P = loadPurchases();
    rc.customerInfo = () => trialInfo(5);
    await P.verifyProWithStore();
    rc.restore = () => trialInfo(5);
    eq("restoring a running trial", await P.restore(), "restored");
    eq(
      "leaves its reminder",
      trialSettleAction({ restored: true, trialStatus: await P.getTrialStatus() }),
      INERT
    );
    rc.customerInfo = () => paidInfo("zerospike_lifetime");
    rc.restore = () => paidInfo("zerospike_lifetime");
    eq("restoring a lifetime purchase", await P.restore(), "restored");
    eq(
      "retires a reminder the earlier trial left",
      trialSettleAction({ restored: true, trialStatus: await P.getTrialStatus() }),
      CANCEL
    );
  }

  // ── H ────────────────────────────────────────────────────────────────────
  section("H. the downsell card needs a discount this account can really take");
  {
    const OFFER_ID = "zerospike_pro_annual_offer";
    const OFFER_INTRO = { price: 19.99, priceString: "$19.99", periodUnit: "YEAR", periodNumberOfUnits: 1 };
    const downsellWith = async (os: string, eligibility: () => any, offerExtra: any = { introPrice: OFFER_INTRO }) => {
      reset();
      rnStub.Platform.OS = os;
      const P = loadPurchases();
      rc.offerings = () => ({
        current: iosOffering().current,
        all: { downsell: { availablePackages: [pkg("ANNUAL", OFFER_ID, 29.99, offerExtra)] } },
      });
      rc.eligibility = eligibility;
      const offer = await P.getDownsellOffer();
      return { offer, calls: rc.eligibilityCalls.map((c) => c.join(",")) };
    };

    let r = await downsellWith("ios", () => ({ [OFFER_ID]: { status: 2 } }));
    eq("iOS eligible: the card is offered", [r.offer.hasRealDiscount, r.offer.discountedPriceString, r.offer.standardPriceString, r.offer.savingsPercent], [true, "$19.99", "$29.99", 33]);
    eq("and the offer product itself was asked about", r.calls, [OFFER_ID]);

    r = await downsellWith("ios", () => ({ [OFFER_ID]: { status: 1 } }));
    eq("iOS ineligible (trial already used): no card", r.offer.hasRealDiscount, false);
    eq("and no price leaks out", [r.offer.discountedPriceString, r.offer.savingsPercent], [null, 0]);

    r = await downsellWith("ios", () => ({ [OFFER_ID]: { status: 0 } }));
    eq("iOS unknown: fail closed, no card", r.offer.hasRealDiscount, false);

    r = await downsellWith("ios", () => ({}));
    eq("iOS missing entry: no card", r.offer.hasRealDiscount, false);

    r = await downsellWith("ios", () => {
      throw new Error("eligibility offline");
    });
    eq("iOS check fails: no card", r.offer.hasRealDiscount, false);

    r = await downsellWith("ios", () => ({}), {});
    eq("iOS plain lower price (no intro offer to be ineligible for): unchanged", [r.offer.hasRealDiscount, r.calls.length], [false, 0]);

    r = await downsellWith("android", () => ({ [OFFER_ID]: { status: 1 } }));
    eq("Android: eligibility is never asked, behaviour unchanged", [r.offer.hasRealDiscount, r.offer.discountedPriceString, r.calls.length], [true, "$19.99", 0]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
