import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Lang } from "../db/types";

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
 * App Store sandbox / Play internal testing — see the project notebook §9).
 */
export const DEBUG_MOCK_PURCHASES = __DEV__;

// RevenueCat PUBLIC SDK keys (safe to embed — not secret).
const RC_API_KEY = Platform.select({
  ios: "appl_VOtCxNdWIKrDWSGaXFPvxPgZsiO",
  android: "goog_ytrLwdOzfMjGeWdDHByBOJlnTBA",
}) as string;

const ENTITLEMENT_ID = "pro";
const PRO_KEY = "zerospike.isPro";
const PLAN_KEY = "zerospike.proPlan";

export type PlanId = "monthly" | "annual" | "lifetime";

export interface ProProduct {
  id: PlanId;
  productId: string; // store product identifier
  priceUSD: string;
  priceTRY: string;
}

export const PRO_PRODUCTS: Record<PlanId, ProProduct> = {
  monthly: {
    id: "monthly",
    productId: "zerospike_pro", // $rc_monthly (Android base plan zerospike_pro:monthly)
    priceUSD: "$4.99",
    priceTRY: "₺149,99",
  },
  annual: {
    id: "annual",
    productId: "zerospike_pro_annual", // $rc_annual (Android base plan :annualv2)
    priceUSD: "$29.99",
    priceTRY: "₺899,99",
  },
  lifetime: {
    id: "lifetime",
    productId: "zerospike_lifetime", // $rc_lifetime (non-consumable)
    priceUSD: "$59.99",
    priceTRY: "₺1.299,99",
  },
};

/** Static fallback price (real localized price overrides via getOfferingPrices). */
export function priceFor(plan: PlanId, lang: Lang): string {
  return lang === "tr" ? PRO_PRODUCTS[plan].priceTRY : PRO_PRODUCTS[plan].priceUSD;
}

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

export async function isPro(): Promise<boolean> {
  if (DEBUG_MOCK_PURCHASES) {
    try {
      return (await AsyncStorage.getItem(PRO_KEY)) === "true";
    } catch {
      return false;
    }
  }
  try {
    await ensureConfigured();
    const info = await rc().getCustomerInfo();
    return Boolean(info?.entitlements?.active?.[ENTITLEMENT_ID]);
  } catch {
    return false;
  }
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

/** Purchase a plan. Returns true if Pro is now active (false on cancel/error). */
export async function purchasePro(plan: PlanId = "monthly"): Promise<boolean> {
  if (DEBUG_MOCK_PURCHASES) {
    await AsyncStorage.setItem(PRO_KEY, "true");
    await AsyncStorage.setItem(PLAN_KEY, plan);
    return true;
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
    if (!pkg) return false;
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const ok = Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]);
    if (ok) await AsyncStorage.setItem(PLAN_KEY, plan);
    return ok;
  } catch {
    // user cancelled or store error
    return false;
  }
}

export async function restore(): Promise<boolean> {
  if (DEBUG_MOCK_PURCHASES) {
    return (await AsyncStorage.getItem(PRO_KEY)) === "true";
  }
  try {
    await ensureConfigured();
    const info = await rc().restorePurchases();
    return Boolean(info?.entitlements?.active?.[ENTITLEMENT_ID]);
  } catch {
    return false;
  }
}

/** Real localized prices for the paywall (empty in mock → static fallback). */
export async function getOfferingPrices(): Promise<Partial<Record<PlanId, string>>> {
  if (DEBUG_MOCK_PURCHASES) return {};
  try {
    await ensureConfigured();
    const offerings = await rc().getOfferings();
    const pkgs = offerings?.current?.availablePackages ?? [];
    const out: Partial<Record<PlanId, string>> = {};
    for (const p of pkgs) {
      // Android subscription ids carry a base plan ("zerospike_pro:monthly").
      const id = (p.product?.identifier ?? "").split(":")[0];
      const price = p.product?.priceString;
      if (id === PRO_PRODUCTS.monthly.productId) out.monthly = price;
      if (id === PRO_PRODUCTS.annual.productId) out.annual = price;
      if (id === PRO_PRODUCTS.lifetime.productId) out.lifetime = price;
    }
    return out;
  } catch {
    return {};
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
    // sheet unavailable — ignore
  }
}

/** Developer toggle (Settings → Developer) — local override for testing UI. */
export async function setProOverride(value: boolean): Promise<void> {
  await AsyncStorage.setItem(PRO_KEY, value ? "true" : "false");
  if (!value) await AsyncStorage.removeItem(PLAN_KEY);
}
