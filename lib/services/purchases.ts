import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logEvent } from "../analytics";

/**
 * RevenueCat purchases layer.
 *
 * Mirrors the Health bridge: a DEBUG flag keeps everything mocked during
 * development (AsyncStorage, no native module, works in Expo Go), while a
 * production build talks to the real RevenueCat SDK. `react-native-purchases`
 * is lazy-`require`d only in real mode, so dev / Expo Go / bundling never load
 * native code.
 *
 * Flip to real by shipping a production build (DEBUG_MOCK_PURCHASES is __DEV__),
 * or set the constant to `false` to test live billing on a dev build (needs
 * App Store sandbox / Play internal testing, see the project notebook §9).
 */
export const DEBUG_MOCK_PURCHASES = __DEV__;

// RevenueCat PUBLIC SDK keys (safe to embed, not secret).
const RC_API_KEY = Platform.select({
  ios: "appl_VOtCxNdWIKrDWSGaXFPvxPgZsiO",
  android: "goog_ytrLwdOzfMjGeWdDHByBOJlnTBA",
}) as string;

const ENTITLEMENT_ID = "pro";
const PRO_KEY = "zerospike.isPro";
const PLAN_KEY = "zerospike.proPlan";

// react-native-purchases 10.x PURCHASES_ERROR_CODE values (string enum). Compared
// by value so we never statically import the native module (keeps dev / Expo Go
// / bundling from loading native code, matching the lazy require() elsewhere).
const RC_ERR_CANCELLED = "1";
const RC_ERR_ALREADY_PURCHASED = "6";
const RC_ERR_ALREADY_IN_USE = "7";

export type PlanId = "monthly" | "annual" | "lifetime";

export interface ProProduct {
  id: PlanId;
  productId: string; // store product identifier
  priceUSD: string;
  priceEUR: string; // de / fr / es storefronts
  priceTRY: string;
}

export const PRO_PRODUCTS: Record<PlanId, ProProduct> = {
  monthly: {
    id: "monthly",
    productId: "zerospike_pro", // $rc_monthly (Android base plan zerospike_pro:monthly)
    priceUSD: "$4.99",
    priceEUR: "€4,99",
    priceTRY: "₺149,99",
  },
  annual: {
    id: "annual",
    productId: "zerospike_pro_annual", // $rc_annual (Android base plan :annualv2)
    priceUSD: "$29.99",
    priceEUR: "€29,99",
    priceTRY: "₺499,99",
  },
  lifetime: {
    id: "lifetime",
    productId: "zerospike_lifetime", // $rc_lifetime (non-consumable)
    priceUSD: "$109.99",
    priceEUR: "€109,99",
    priceTRY: "₺2.499,99",
  },
};

// ── Real SDK plumbing (lazy) ───────────────────────────────────────────────

let configured = false;
function rc(): any {
  return require("react-native-purchases").default;
}
async function ensureConfigured(): Promise<void> {
  if (DEBUG_MOCK_PURCHASES || configured) return;
  try {
    rc().configure({ apiKey: RC_API_KEY });
    configured = true;
  } catch {
    // configure failures degrade gracefully to "not pro"
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * The last known entitlement, read from local storage ONLY - no SDK configure,
 * no network round trip. This is what the launch path reads: waiting on
 * RevenueCat held the splash screen up for the whole `getCustomerInfo` call, on
 * a cold, possibly offline start. The real value is fetched right after the app
 * is on screen (see AppContext) and corrects the flag then.
 */
export async function isProCached(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRO_KEY)) === "true";
  } catch {
    return false;
  }
}

/**
 * The entitlement as the STORE sees it, or null when the store could not be
 * reached at all (offline, SDK not configured, request failed).
 *
 * That distinction matters to the launch path: it starts from the cached flag, so
 * a failure it could not tell apart from a genuine "no longer subscribed" would
 * demote a paying user mid-session and trip the win-back offer at them. Callers
 * that only want a boolean use isPro() below, which keeps the original
 * "unreachable counts as not pro" reading.
 */
export async function verifyProWithStore(): Promise<boolean | null> {
  if (DEBUG_MOCK_PURCHASES) return isProCached();
  try {
    await ensureConfigured();
    const info = await rc().getCustomerInfo();
    const active = Boolean(info?.entitlements?.active?.[ENTITLEMENT_ID]);
    // Keep the launch cache warm. Only written on a SUCCESSFUL answer, so a
    // failure can never overwrite a paying user's stored flag.
    await AsyncStorage.setItem(PRO_KEY, active ? "true" : "false").catch(() => {});
    return active;
  } catch {
    return null;
  }
}

export async function isPro(): Promise<boolean> {
  return (await verifyProWithStore()) === true;
}

/** Which plan unlocked Pro (for display), if known. */
export async function getPlan(): Promise<PlanId | null> {
  try {
    if (!DEBUG_MOCK_PURCHASES) {
      await ensureConfigured();
      const info = await rc().getCustomerInfo();
      const ent = info?.entitlements?.active?.[ENTITLEMENT_ID];
      // Android subscription ids carry a base plan, e.g. "zerospike_pro:monthly".
      const id = (ent?.productIdentifier ?? "").split(":")[0];
      if (id === PRO_PRODUCTS.lifetime.productId) return "lifetime";
      if (id === PRO_PRODUCTS.annual.productId) return "annual";
      if (id === PRO_PRODUCTS.monthly.productId) return "monthly";
    }
    const v = await AsyncStorage.getItem(PLAN_KEY);
    return v === "monthly" || v === "annual" || v === "lifetime" ? v : null;
  } catch {
    return null;
  }
}

/** Why a purchase attempt did not activate Pro. */
export type PurchaseErrorClass = "cancelled" | "alreadyOwned" | "storeError";

/**
 * Outcome of a purchase attempt.
 * - `ok`        Pro is active (either the purchase went through, or it was
 *               recovered without a restart, see `recovered`).
 * - `cancelled` the user dismissed the native sheet (distinct from a store
 *               error), so the caller can route a cancel into the downsell.
 * - `recovered` Pro became active via already-owned recovery, so the UI can
 *               tell the user "this is already yours" instead of "purchased".
 * - `error`     failure classification when `!ok` (null on success).
 */
export interface PurchaseOutcome {
  ok: boolean;
  cancelled: boolean;
  recovered: boolean;
  error: PurchaseErrorClass | null;
}

const OK_OUTCOME: PurchaseOutcome = {
  ok: true,
  cancelled: false,
  recovered: false,
  error: null,
};

/**
 * After a failed purchase, tries to activate Pro without a restart: first checks
 * whether the entitlement is in fact already active (the store can report
 * "already purchased" for something the user genuinely owns), then, for an
 * already-owned error, runs a restore. Store-read only; never throws.
 */
async function recoverEntitlement(alreadyOwned: boolean): Promise<boolean> {
  try {
    await ensureConfigured();
    const info = await rc().getCustomerInfo();
    if (info?.entitlements?.active?.[ENTITLEMENT_ID]) return true;
  } catch {
    // fall through to the restore attempt
  }
  if (alreadyOwned) {
    try {
      const info: any = await withTimeout(rc().restorePurchases(), 20000);
      return Boolean(info?.entitlements?.active?.[ENTITLEMENT_ID]);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Shared catch handler for a purchase attempt: classifies the error and, for a
 * non-cancel failure, tries to recover the entitlement (already-owned or a
 * purchase that actually went through). Used by both purchasePro and
 * purchaseDownsell so neither can end up silently stuck.
 */
async function classifyAndRecover(
  e: any,
  plan: PlanId
): Promise<PurchaseOutcome> {
  const code = e?.code;
  if (Boolean(e?.userCancelled) || code === RC_ERR_CANCELLED) {
    return { ok: false, cancelled: true, recovered: false, error: "cancelled" };
  }
  const alreadyOwned =
    code === RC_ERR_ALREADY_PURCHASED || code === RC_ERR_ALREADY_IN_USE;
  if (await recoverEntitlement(alreadyOwned)) {
    await AsyncStorage.setItem(PLAN_KEY, plan).catch(() => {});
    return { ok: true, cancelled: false, recovered: true, error: null };
  }
  return {
    ok: false,
    cancelled: false,
    recovered: false,
    error: alreadyOwned ? "alreadyOwned" : "storeError",
  };
}

export async function purchasePro(
  plan: PlanId = "monthly"
): Promise<PurchaseOutcome> {
  if (DEBUG_MOCK_PURCHASES) {
    await AsyncStorage.setItem(PRO_KEY, "true");
    await AsyncStorage.setItem(PLAN_KEY, plan);
    return OK_OUTCOME;
  }
  try {
    await ensureConfigured();
    const Purchases = rc();
    const offerings = await Purchases.getOfferings();
    const pkgs = offerings?.current?.availablePackages ?? [];
    const targetId = PRO_PRODUCTS[plan].productId;
    // On Android a subscription product id carries its base plan, e.g.
    // "zerospike_pro:monthly", so match by the part before ":" too.
    const baseId = (id?: string) => (id ?? "").split(":")[0];
    const wantType =
      plan === "lifetime" ? "LIFETIME" : plan === "annual" ? "ANNUAL" : "MONTHLY";
    const pkg =
      pkgs.find((p: any) => baseId(p.product?.identifier) === targetId) ??
      pkgs.find((p: any) => p.packageType === wantType);
    if (!pkg) {
      return { ok: false, cancelled: false, recovered: false, error: "storeError" };
    }
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const ok = Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]);
    if (ok) await AsyncStorage.setItem(PLAN_KEY, plan);
    return {
      ok,
      cancelled: false,
      recovered: false,
      error: ok ? null : "storeError",
    };
  } catch (e: any) {
    return classifyAndRecover(e, plan);
  }
}

export type RestoreResult = "restored" | "none" | "error";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Restores prior purchases. Distinguishes a successful restore, an account with
 * nothing to restore, and a real failure (offline, store error, or a hang) so
 * the UI can give honest feedback instead of silently looking stuck.
 */
export async function restore(): Promise<RestoreResult> {
  if (DEBUG_MOCK_PURCHASES) {
    return (await AsyncStorage.getItem(PRO_KEY)) === "true" ? "restored" : "none";
  }
  try {
    await ensureConfigured();
    const info: any = await withTimeout(rc().restorePurchases(), 20000);
    return info?.entitlements?.active?.[ENTITLEMENT_ID] ? "restored" : "none";
  } catch {
    return "error";
  }
}

/**
 * Presents the App Store offer/promo code redemption sheet (iOS 14+). Lets a
 * user redeem a code you generated in App Store Connect from inside the app.
 * No-op on Android (use the Play "redeem code" flow there).
 */
export async function presentCodeRedemption(): Promise<void> {
  if (DEBUG_MOCK_PURCHASES || Platform.OS !== "ios") return;
  try {
    await ensureConfigured();
    await rc().presentCodeRedemptionSheet();
  } catch {
    // sheet unavailable, ignore
  }
}

/** Developer toggle (Settings → Developer): local override for testing UI. */
export async function setProOverride(value: boolean): Promise<void> {
  await AsyncStorage.setItem(PRO_KEY, value ? "true" : "false");
  if (!value) await AsyncStorage.removeItem(PLAN_KEY);
}

// ── Rich offerings: real prices + trial + fallback status ───────────────────

export interface PlanMeta {
  /** Localized store price string (e.g. "₺499,99"). */
  priceString: string;
  /** Raw numeric price for derived math (savings %, per-month). */
  price: number;
  currencyCode: string;
  /** True when the plan carries a real free trial (intro price 0). */
  hasFreeTrial: boolean;
  /** A paid intro price (not a free trial), if any. */
  introPriceString: string | null;
  introPrice: number | null;
  /**
   * Free-trial length in days, read from the store's own offer (so an A/B on
   * the trial length in RevenueCat/App Store Connect/Play Console never needs
   * a code change). 0 when `hasFreeTrial` is false; falls back to
   * FALLBACK_TRIAL_DAYS when a real trial exists but its length could not be
   * parsed from the store data.
   */
  freeTrialDays: number;
}
export type OfferingPlans = Partial<Record<PlanId, PlanMeta>>;
export interface OfferingsResult {
  status: "ready" | "unavailable";
  isDevFallback: boolean;
  plans: OfferingPlans;
}

function planFromPackageType(t?: string): PlanId | null {
  if (t === "MONTHLY") return "monthly";
  if (t === "ANNUAL") return "annual";
  if (t === "LIFETIME") return "lifetime";
  return null;
}

// Used whenever a real trial exists but its length could not be read from the
// store (missing/unparseable period data), so the paywall/reminder degrade to
// the length this app has always shipped instead of breaking.
const FALLBACK_TRIAL_DAYS = 7;

function periodUnitToDays(unit?: string | null, count?: number | null): number | null {
  if (!unit || !count || count <= 0) return null;
  switch (unit) {
    case "DAY":
      return count;
    case "WEEK":
      return count * 7;
    case "MONTH":
      return count * 30;
    case "YEAR":
      return count * 365;
    default:
      return null;
  }
}

/**
 * Free-trial length in days for a package's intro offer, read straight from
 * the store: iOS carries it on `product.introPrice` (periodUnit /
 * periodNumberOfUnits); Android has no such convenience field, so it is read
 * from the matching subscriptionOption's `freePhase` billing period instead.
 * Null when neither is present or parseable.
 */
function freeTrialDaysFromPackage(p: any): number | null {
  const prod = p?.product;
  if (!prod) return null;
  if (Platform.OS === "ios") {
    const intro = prod.introPrice;
    return periodUnitToDays(intro?.periodUnit, intro?.periodNumberOfUnits);
  }
  const options: any[] = prod.subscriptionOptions ?? [];
  const withFreePhase = options.find((o) => o?.freePhase) ?? prod.defaultOption;
  const phase = withFreePhase?.freePhase;
  return periodUnitToDays(phase?.billingPeriod?.unit, phase?.billingPeriod?.value);
}

function mapRcPackage(
  p: any
): { plan: PlanId; meta: PlanMeta; pkg: any } | null {
  const prod = p?.product;
  if (!prod) return null;
  // Android subscription ids carry a base plan ("zerospike_pro:monthly").
  const baseId = (prod.identifier ?? "").split(":")[0];
  const plan: PlanId | null =
    baseId === PRO_PRODUCTS.monthly.productId
      ? "monthly"
      : baseId === PRO_PRODUCTS.annual.productId
        ? "annual"
        : baseId === PRO_PRODUCTS.lifetime.productId
          ? "lifetime"
          : planFromPackageType(p.packageType);
  if (!plan) return null;
  const intro = prod.introPrice;
  const isFreeTrial = intro != null && Number(intro.price) === 0;
  return {
    plan,
    pkg: p,
    meta: {
      priceString: String(prod.priceString ?? ""),
      price: Number(prod.price ?? 0),
      currencyCode: String(prod.currencyCode ?? ""),
      hasFreeTrial: isFreeTrial,
      introPriceString: intro && !isFreeTrial ? String(intro.priceString) : null,
      introPrice: intro && !isFreeTrial ? Number(intro.price) : null,
      freeTrialDays: isFreeTrial ? freeTrialDaysFromPackage(p) ?? FALLBACK_TRIAL_DAYS : 0,
    },
  };
}

// Dev-only placeholder plans (hardcoded USD, annual carries the intended 7-day
// trial). NEVER rendered in release: when the real offering can't load,
// loadOfferings returns status 'unavailable' so the paywall shows a retry state.
// Kept in step with docs/pricing-2026-08.md - the paywall now DERIVES figures
// from these prices (the lifetime anchor), so a stale placeholder would show a
// wrong ratio in every dev build and screenshot.
function devFallbackPlans(): OfferingPlans {
  return {
    monthly: { priceString: PRO_PRODUCTS.monthly.priceUSD, price: 4.99, currencyCode: "USD", hasFreeTrial: false, introPriceString: null, introPrice: null, freeTrialDays: 0 },
    annual: { priceString: PRO_PRODUCTS.annual.priceUSD, price: 29.99, currencyCode: "USD", hasFreeTrial: true, introPriceString: null, introPrice: null, freeTrialDays: FALLBACK_TRIAL_DAYS },
    lifetime: { priceString: PRO_PRODUCTS.lifetime.priceUSD, price: 109.99, currencyCode: "USD", hasFreeTrial: false, introPriceString: null, introPrice: null, freeTrialDays: 0 },
  };
}

/**
 * Loads the current offering as display-ready plan metadata. In release, when
 * the offering cannot be fetched or mapped, returns status 'unavailable' (never
 * a hardcoded fallback) and fires offerings_fallback_shown so the paywall can
 * show a retry state instead of fake prices.
 */
export async function loadOfferings(): Promise<OfferingsResult> {
  if (DEBUG_MOCK_PURCHASES) {
    return { status: "ready", isDevFallback: true, plans: devFallbackPlans() };
  }
  let reason = "fetch_error";
  try {
    await ensureConfigured();
    const offerings = await rc().getOfferings();
    const pkgs = offerings?.current?.availablePackages ?? [];
    reason = pkgs.length === 0 ? "empty_offering" : "no_mappable_packages";
    const plans: OfferingPlans = {};
    for (const p of pkgs) {
      const m = mapRcPackage(p);
      if (m) plans[m.plan] = m.meta;
    }
    if (Object.keys(plans).length > 0) {
      return { status: "ready", isDevFallback: false, plans };
    }
  } catch {
    reason = "fetch_error";
  }
  logEvent("offerings_fallback_shown", { reason });
  return { status: "unavailable", isDevFallback: false, plans: {} };
}

// ── Downsell / winback discounted offering ───────────────────────────────────

const DOWNSELL_OFFERING_ID = "downsell";

export interface DownsellOffer {
  hasRealDiscount: boolean;
  discountedPriceString: string | null;
  standardPriceString: string | null;
  savingsPercent: number;
}

const NO_DOWNSELL: DownsellOffer = {
  hasRealDiscount: false,
  discountedPriceString: null,
  standardPriceString: null,
  savingsPercent: 0,
};

/**
 * Dev-only stand-in for the real 'downsell' offering, which does not exist on a
 * dev build: without it the screen could only ever be seen in its no-offer
 * fallback, so the discount card itself was never previewable. purchaseDownsell
 * already grants Pro under the same flag, so the whole flow runs end to end.
 */
const MOCK_DOWNSELL: DownsellOffer = {
  hasRealDiscount: true,
  discountedPriceString: "$19.99",
  standardPriceString: "$39.99",
  savingsPercent: 50,
};

function findAnnual(pkgs: any[]): PlanMeta | undefined {
  for (const p of pkgs ?? []) {
    const m = mapRcPackage(p);
    if (m && m.plan === "annual") return m.meta;
  }
  return undefined;
}

// Same-currency, genuinely-lower check. Keeps every discount surface from ever
// faking a saving that is not real.
function realDiscount(standard?: PlanMeta, discounted?: PlanMeta): boolean {
  if (!standard || !discounted) return false;
  if (standard.currencyCode !== discounted.currencyCode) return false;
  const d = discounted.introPrice ?? discounted.price;
  return d < standard.price;
}

function savingsPct(standard?: PlanMeta, discounted?: PlanMeta): number {
  if (!standard || !discounted || standard.price <= 0) return 0;
  const d = discounted.introPrice ?? discounted.price;
  return Math.round((1 - d / standard.price) * 100);
}

/**
 * Reads the dedicated 'downsell' RevenueCat offering's annual package and
 * reports a discount only when it is (same currency) genuinely cheaper than the
 * standard annual. In dev there is no real offering, so a mock discount is
 * returned instead and the card can be reviewed on a dev build.
 */
export async function getDownsellOffer(): Promise<DownsellOffer> {
  if (DEBUG_MOCK_PURCHASES) return MOCK_DOWNSELL;
  try {
    await ensureConfigured();
    const offerings = await rc().getOfferings();
    const standard = findAnnual(offerings?.current?.availablePackages ?? []);
    const discounted = findAnnual(
      offerings?.all?.[DOWNSELL_OFFERING_ID]?.availablePackages ?? []
    );
    if (!realDiscount(standard, discounted)) return NO_DOWNSELL;
    return {
      hasRealDiscount: true,
      discountedPriceString: discounted!.introPriceString ?? discounted!.priceString,
      standardPriceString: standard!.priceString,
      savingsPercent: savingsPct(standard, discounted),
    };
  } catch {
    return NO_DOWNSELL;
  }
}

/** One-shot check for the winback trigger: only open if a real discount exists. */
export async function winbackHasRealDiscount(): Promise<boolean> {
  return (await getDownsellOffer()).hasRealDiscount;
}

/** Purchases the discounted annual from the 'downsell' offering. */
export async function purchaseDownsell(): Promise<PurchaseOutcome> {
  if (DEBUG_MOCK_PURCHASES) {
    await AsyncStorage.setItem(PRO_KEY, "true");
    await AsyncStorage.setItem(PLAN_KEY, "annual");
    return OK_OUTCOME;
  }
  try {
    await ensureConfigured();
    const Purchases = rc();
    const offerings = await Purchases.getOfferings();
    const pkgs = offerings?.all?.[DOWNSELL_OFFERING_ID]?.availablePackages ?? [];
    const target = (pkgs as any[]).find((p) => {
      const m = mapRcPackage(p);
      return m?.plan === "annual";
    });
    if (!target) {
      return { ok: false, cancelled: false, recovered: false, error: "storeError" };
    }
    const { customerInfo } = await Purchases.purchasePackage(target);
    const ok = Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]);
    if (ok) await AsyncStorage.setItem(PLAN_KEY, "annual");
    return {
      ok,
      cancelled: false,
      recovered: false,
      error: ok ? null : "storeError",
    };
  } catch (e: any) {
    return classifyAndRecover(e, "annual");
  }
}
