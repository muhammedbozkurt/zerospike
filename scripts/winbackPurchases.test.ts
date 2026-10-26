/**
 * getWinbackOffer / purchaseWinback through the REAL purchases module with the
 * RevenueCat SDK stubbed: the platform split (iOS 18+ Apple win-back offer,
 * iOS < 18 / no offer / error / hang falls to the existing downsell card,
 * Android never asks Apple) and what the buy calls. No jest.
 *
 * Run: npx -y tsx scripts/winbackPurchases.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: {
  (id: string): any;
  resolve: (id: string) => string;
  cache: Record<string, unknown>;
};
declare function setTimeout(handler: () => void, ms?: number): unknown;

import type * as PurchasesApi from "../lib/services/purchases";

(globalThis as any).__DEV__ = false;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
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

const store = new Map<string, string>();
const AsyncStorageStub = {
  getItem: async (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: async (k: string, v: string) => void store.set(k, String(v)),
  removeItem: async (k: string) => void store.delete(k),
};
const analyticsStub = { logEvent: () => {}, logCrash: () => {} };
const optOutStub = {
  getAnalyticsEnabled: async () => true,
  onAnalyticsEnabledChange: () => () => {},
};

const rnStub: any = {
  Platform: { OS: "ios", Version: "18.2", select: (o: any) => o[rnStub.Platform.OS] },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
};

const rc = {
  offerings: (() => ({})) as () => any,
  winBackOffers: (async (_pkg: any) => undefined) as (pkg: any) => Promise<any>,
  eligibility: (() => ({})) as (ids: string[]) => any,
  winBackCalls: 0,
  purchasedWithWinBack: [] as { pkg: any; offer: any }[],
  purchasedPackages: [] as any[],
  customerInfo: (() => ({})) as () => any,
};
const rcStub = {
  default: {
    configure: () => {},
    getCustomerInfo: async () => rc.customerInfo(),
    setAttributes: async () => {},
    enableAdServicesAttributionTokenCollection: async () => {},
    addCustomerInfoUpdateListener: () => {},
    removeCustomerInfoUpdateListener: () => true,
    getOfferings: async () => rc.offerings(),
    checkTrialOrIntroductoryPriceEligibility: async (ids: string[]) => rc.eligibility(ids),
    getEligibleWinBackOffersForPackage: async (pkg: any) => {
      rc.winBackCalls++;
      return rc.winBackOffers(pkg);
    },
    purchasePackageWithWinBackOffer: async (pkg: any, offer: any) => {
      rc.purchasedWithWinBack.push({ pkg, offer });
      return { customerInfo: rc.customerInfo() };
    },
    purchasePackage: async (pkg: any) => {
      rc.purchasedPackages.push(pkg);
      return { customerInfo: rc.customerInfo() };
    },
  },
};

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string, parent: any) {
  const from = parent && typeof parent.filename === "string" ? parent.filename : "";
  if (request === "react-native") return rnStub;
  if (request === "react") return { useSyncExternalStore: (_sub: unknown, get: () => unknown) => get() };
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorageStub };
  if (request === "react-native-purchases") return rcStub;
  if (request === "expo-crypto") return { getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 3) };
  if (/(^|\/)analytics$/.test(request)) return analyticsStub;
  if (/(^|\/)analytics\/optOut$/.test(request)) return optOutStub;
  if (request === "./notifications" && /purchases\.(js|ts)$/.test(from)) return { cancelTrialReminder: async () => {} };
  return realLoad.apply(this, arguments);
};

function loadPurchases(): typeof PurchasesApi {
  const key = require.resolve("../lib/services/purchases");
  delete require.cache[key];
  return require("../lib/services/purchases");
}

const pkg = (packageType: string, productId: string, price: number, extra: any = {}) => ({
  identifier: `$rc_${packageType.toLowerCase()}`,
  packageType,
  product: { identifier: productId, priceString: `$${price}`, price, currencyCode: "USD", introPrice: null, ...extra },
});
const STANDARD_ANNUAL = pkg("ANNUAL", "zerospike_pro_annual", 29.99);
const DOWNSELL_INTRO = { price: 19.99, priceString: "$19.99", cycles: 1, periodUnit: "YEAR", periodNumberOfUnits: 1 };
const withDownsell = () => ({
  current: { availablePackages: [pkg("MONTHLY", "zerospike_pro", 4.99), STANDARD_ANNUAL] },
  all: { downsell: { availablePackages: [pkg("ANNUAL", "zerospike_pro_annual_offer", 29.99, { introPrice: DOWNSELL_INTRO })] } },
});
const withoutDownsell = () => ({
  current: { availablePackages: [pkg("MONTHLY", "zerospike_pro", 4.99), STANDARD_ANNUAL] },
  all: {},
});
const APPLE_OFFER = { identifier: "winback_y1", price: 14.99, priceString: "$14.99", cycles: 1, periodUnit: "YEAR", periodNumberOfUnits: 1 };
const proInfo = { entitlements: { active: { pro: { periodType: "NORMAL", expirationDate: new Date(Date.now() + 3e10).toISOString(), productIdentifier: "zerospike_pro_annual" } }, all: {} } };

function reset(os = "ios", version: string | number = "18.2"): void {
  store.clear();
  rnStub.Platform.OS = os;
  rnStub.Platform.Version = version;
  rc.offerings = withoutDownsell;
  rc.winBackOffers = async () => undefined;
  rc.eligibility = () => ({});
  rc.winBackCalls = 0;
  rc.purchasedWithWinBack.length = 0;
  rc.purchasedPackages.length = 0;
  rc.customerInfo = () => proInfo;
}

console.log("zerospike winback purchases test");

(async () => {
  section("A. iOS 18+");
  {
    reset();
    rc.winBackOffers = async () => [APPLE_OFFER];
    let P = loadPurchases();
    let o = await P.getWinbackOffer();
    eq("eligible offer: apple source", [o.source, o.appleOfferId, o.hasRealDiscount], ["apple", "winback_y1", true]);
    eq("store price strings, standard from the annual package", [o.discountedPriceString, o.standardPriceString], ["$14.99", "$29.99"]);
    eq("percent", o.savingsPercent, 50);
    eq("buy applies the Apple offer to the annual package", await P.purchaseWinback(o).then((r) => r.ok), true);
    eq("purchasePackageWithWinBackOffer called once with that offer", [rc.purchasedWithWinBack.length, rc.purchasedWithWinBack[0]?.offer.identifier, rc.purchasedWithWinBack[0]?.pkg.identifier], [1, "winback_y1", "$rc_annual"]);
    eq("downsell offering untouched", rc.purchasedPackages.length, 0);

    reset();
    rc.offerings = withDownsell;
    rc.winBackOffers = async () => [APPLE_OFFER];
    rc.eligibility = (ids) => Object.fromEntries(ids.map((id) => [id, { status: 2 }]));
    P = loadPurchases();
    o = await P.getWinbackOffer();
    eq("apple offer beats the downsell card", o.source, "apple");

    reset();
    rc.offerings = withDownsell;
    rc.winBackOffers = async () => [];
    rc.eligibility = (ids) => Object.fromEntries(ids.map((id) => [id, { status: 2 }]));
    P = loadPurchases();
    o = await P.getWinbackOffer();
    eq("no apple offer: existing downsell card", [o.source, o.appleOfferId, o.hasRealDiscount], ["downsell", null, true]);
    await P.purchaseWinback(o);
    eq("downsell buy uses purchasePackage", [rc.purchasedPackages.length, rc.purchasedWithWinBack.length], [1, 0]);

    reset();
    rc.winBackOffers = async () => undefined;
    P = loadPurchases();
    o = await P.getWinbackOffer();
    eq("no apple offer, no downsell: nothing", [o.source, o.hasRealDiscount], ["downsell", false]);

    reset();
    rc.offerings = withDownsell;
    rc.winBackOffers = async () => {
      throw new Error("store down");
    };
    rc.eligibility = (ids) => Object.fromEntries(ids.map((id) => [id, { status: 2 }]));
    P = loadPurchases();
    o = await P.getWinbackOffer();
    eq("apple lookup error: existing downsell card", [o.source, o.hasRealDiscount], ["downsell", true]);

    reset();
    rc.winBackOffers = async () => {
      throw new Error("store down");
    };
    P = loadPurchases();
    o = await P.getWinbackOffer();
    eq("apple lookup error, no downsell: nothing", o.hasRealDiscount, false);

    reset();
    rc.winBackOffers = async () => [{ ...APPLE_OFFER, price: 0, priceString: "$0.00" }];
    P = loadPurchases();
    o = await P.getWinbackOffer();
    eq("unsupported (free) offer: nothing", o.hasRealDiscount, false);

    reset();
    rc.winBackOffers = async () => [APPLE_OFFER];
    P = loadPurchases();
    o = await P.getWinbackOffer();
    rc.winBackOffers = async () => [];
    const r = await P.purchaseWinback(o);
    eq("offer gone at buy time: store error, no purchase", [r.ok, r.error, rc.purchasedWithWinBack.length], [false, "storeError", 0]);

    reset();
    rc.winBackOffers = async () => [APPLE_OFFER];
    P = loadPurchases();
    o = await P.getWinbackOffer();
    rc.purchasedWithWinBack.length = 0;
    const origCustomer = rc.customerInfo;
    rcStub.default.purchasePackageWithWinBackOffer = async () => {
      throw { userCancelled: true, code: "1" };
    };
    const c = await P.purchaseWinback(o);
    eq("user cancel is a cancel", [c.ok, c.cancelled], [false, true]);
    rc.customerInfo = origCustomer;
  }

  section("B. iOS 17 and Android");
  {
    reset("ios", "17.5");
    rc.offerings = withDownsell;
    rc.winBackOffers = async () => [APPLE_OFFER];
    rc.eligibility = (ids) => Object.fromEntries(ids.map((id) => [id, { status: 2 }]));
    let P = loadPurchases();
    let o = await P.getWinbackOffer();
    eq("iOS 17: existing downsell card", [o.source, o.hasRealDiscount], ["downsell", true]);
    eq("iOS 17: Apple never asked", rc.winBackCalls, 0);

    reset("android", 34);
    rc.offerings = withDownsell;
    rc.winBackOffers = async () => [APPLE_OFFER];
    P = loadPurchases();
    o = await P.getWinbackOffer();
    eq("Android: downsell card as before", [o.source, o.appleOfferId], ["downsell", null]);
    eq("Android: Apple never asked", rc.winBackCalls, 0);
    eq("Android: winbackHasRealDiscount follows the downsell", await P.winbackHasRealDiscount(), o.hasRealDiscount);

    reset("android", 34);
    P = loadPurchases();
    eq("Android without a downsell: nothing", (await P.getWinbackOffer()).hasRealDiscount, false);
  }

  section("C. a hung Apple lookup does not hold the surface past ~3 s");
  {
    reset();
    rc.offerings = withDownsell;
    rc.winBackOffers = () => new Promise(() => {});
    rc.eligibility = (ids) => Object.fromEntries(ids.map((id) => [id, { status: 2 }]));
    const P = loadPurchases();
    const t0 = Date.now();
    const o = await P.getWinbackOffer();
    const ms = Date.now() - t0;
    eq("falls to the existing card", o.source, "downsell");
    ok("within the 3 s budget plus slack", ms >= 2900 && ms < 4500, `${ms} ms`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.log("crashed", e);
  process.exit(1);
});
