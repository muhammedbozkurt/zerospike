import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logCrash, logEvent } from "../analytics";
import { getAnalyticsEnabled, onAnalyticsEnabledChange } from "../analytics/optOut";
import { getDeviceId } from "../identity/deviceId";

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

// INTRO_ELIGIBILITY_STATUS (same by-value reasoning). Only ELIGIBLE promises a
// trial: UNKNOWN is RevenueCat saying it cannot tell, and its own guidance is to
// show the non-intro price rather than a misleading offer.
const RC_INTRO_ELIGIBLE = 2;

/**
 * How long the paywall waits on the eligibility answer before showing the plain
 * price. The check is a native call on the one screen that sells the product, so
 * it is bounded like the restore is.
 */
export const ELIGIBILITY_TIMEOUT_MS = 8000;

export type PlanId = "monthly" | "annual" | "lifetime";

export interface ProProduct {
  id: PlanId;
  productId: string; // store product identifier
  priceUSD: string;
}

export const PRO_PRODUCTS: Record<PlanId, ProProduct> = {
  monthly: {
    id: "monthly",
    productId: "zerospike_pro", // $rc_monthly (Android base plan zerospike_pro:monthly)
    priceUSD: "$4.99",
  },
  annual: {
    id: "annual",
    productId: "zerospike_pro_annual", // $rc_annual (Android base plan :annualv2)
    priceUSD: "$29.99",
  },
  lifetime: {
    id: "lifetime",
    productId: "zerospike_lifetime", // $rc_lifetime (non-consumable)
    priceUSD: "$99.99",
  },
};

// ── Real SDK plumbing (lazy) ───────────────────────────────────────────────

let configured = false;
function rc(): any {
  return require("react-native-purchases").default;
}

// ── Store health ────────────────────────────────────────────────────────────

/**
 * Whether the last store read worked. "error" is NOT "not subscribed": the
 * stored entitlement keeps standing (see verifyProWithStore) and the UI uses
 * this to offer "Restore purchases" where a stuck state could otherwise hide it.
 */
export type StoreStatus = "ok" | "error";

let storeStatus: StoreStatus = "ok";
const storeStatusListeners = new Set<() => void>();

function setStoreStatus(next: StoreStatus): void {
  if (next === storeStatus) return;
  storeStatus = next;
  storeStatusListeners.forEach((l) => l());
}

export function getStoreStatus(): StoreStatus {
  return storeStatus;
}

export function subscribeStoreStatus(listener: () => void): () => void {
  storeStatusListeners.add(listener);
  return () => {
    storeStatusListeners.delete(listener);
  };
}

export function useStoreStatus(): StoreStatus {
  return useSyncExternalStore(subscribeStoreStatus, getStoreStatus, getStoreStatus);
}

/**
 * Marks the store unreachable. Logged once per outage (the ok to error flip),
 * not on every retry: an offline user would otherwise report on each focus.
 */
function noteStoreFailure(op: string, err: unknown): void {
  const flipped = storeStatus !== "error";
  setStoreStatus("error");
  if (flipped) logCrash(err, { service: "purchases", op });
}

// ── Last known entitlement facts ────────────────────────────────────────────

export type PeriodType = "trial" | "normal" | "intro" | "unknown";

interface EntitlementFacts {
  periodType: PeriodType;
  /** Epoch ms of the current period's end, null when the store reported none. */
  expiresAt: number | null;
}

const FACTS_KEY = "zerospike.proFacts";

function periodTypeOf(ent: unknown): PeriodType {
  switch (String((ent as any)?.periodType ?? "").toUpperCase()) {
    case "TRIAL":
      return "trial";
    case "INTRO":
      return "intro";
    case "NORMAL":
      return "normal";
    default:
      return "unknown";
  }
}

function isoMs(iso: unknown): number | null {
  if (typeof iso !== "string" || iso === "") return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Whether Pro is currently running as a free trial, and how much is left. */
export interface TrialStatus {
  active: boolean;
  /** Whole days remaining, rounded UP, so the last partial day still reads as a
   *  day the user has. Null when the store reported no expiry at all. */
  daysLeft: number | null;
  /** Epoch ms the trial turns into the first charge, null when the store
   *  reported none. The ending reminder is timed from this. */
  expiresAt: number | null;
}

const NO_TRIAL: TrialStatus = { active: false, daysLeft: null, expiresAt: null };

/**
 * The trial state of ONE entitlement. Only periodType TRIAL counts: INTRO is a
 * discounted PAID period, not a free trial, and must never be presented as one.
 * An entitlement already past its expiry is not a running trial either.
 */
function trialStatusOf(ent: unknown): TrialStatus {
  if (!ent || periodTypeOf(ent) !== "trial") return NO_TRIAL;
  const expiresAt = isoMs((ent as any).expirationDate);
  if (expiresAt === null) return { active: true, daysLeft: null, expiresAt: null };
  const left = Math.ceil((expiresAt - Date.now()) / 86400000);
  return left > 0 ? { active: true, daysLeft: left, expiresAt } : NO_TRIAL;
}

async function readFacts(): Promise<EntitlementFacts | null> {
  try {
    const raw = await AsyncStorage.getItem(FACTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const periodType = periodTypeOf({ periodType: parsed?.periodType });
    const expiresAt = typeof parsed?.expiresAt === "number" ? parsed.expiresAt : null;
    return { periodType, expiresAt };
  } catch (err) {
    logCrash(err, { service: "purchases", op: "readFacts" });
    return null;
  }
}

async function writeFacts(facts: EntitlementFacts | null): Promise<void> {
  try {
    if (facts) await AsyncStorage.setItem(FACTS_KEY, JSON.stringify(facts));
    else await AsyncStorage.removeItem(FACTS_KEY);
  } catch (err) {
    logCrash(err, { service: "purchases", op: "writeFacts" });
  }
}

/**
 * The single place a store answer becomes the cached entitlement. Serialized, so
 * two answers arriving together (a foreground refresh and RevenueCat's own push)
 * can neither interleave their cache writes nor report the same loss twice.
 *
 * The true to false step is the only "entitlement lost" there is: it needs a
 * SUCCESSFUL store answer (a failed read never reaches here) that says inactive
 * while the cache said active. The period type comes from the lapsed entitlement
 * itself, or from the last facts seen while it was active.
 *
 * It is also where a stale trial-ending reminder comes down: every path that
 * learns the store's word (the foreground refresh, RevenueCat's push, a purchase,
 * a restore) lands here, so a trial that converted, lapsed or was refunded takes
 * its pending reminder with it, and one that is still running leaves it alone.
 */
let applyChain: Promise<unknown> = Promise.resolve();

function applyCustomerInfo(info: unknown): Promise<boolean> {
  const run = applyChain.then(() => applyCustomerInfoNow(info));
  applyChain = run.catch((err) =>
    logCrash(err, { service: "purchases", op: "applyCustomerInfo" })
  );
  return run;
}

async function applyCustomerInfoNow(info: unknown): Promise<boolean> {
  const ent = (info as any)?.entitlements?.active?.[ENTITLEMENT_ID];
  const active = Boolean(ent);
  let wasActive = false;
  try {
    wasActive = (await AsyncStorage.getItem(PRO_KEY)) === "true";
    await AsyncStorage.setItem(PRO_KEY, active ? "true" : "false");
  } catch (err) {
    logCrash(err, { service: "purchases", op: "cacheWrite" });
  }
  const before = await readFacts();
  const lost = wasActive && !active;
  if (active) {
    await writeFacts({ periodType: periodTypeOf(ent), expiresAt: isoMs(ent.expirationDate) });
  } else {
    if (lost) {
      const fromStore = periodTypeOf((info as any)?.entitlements?.all?.[ENTITLEMENT_ID]);
      const periodType = fromStore !== "unknown" ? fromStore : (before?.periodType ?? "unknown");
      logEvent("entitlement_lost", { period_type: periodType });
    }
    await writeFacts(null);
  }
  // Gated on a trial having been seen (or Pro having just lapsed) so a free or
  // paying user's every foreground refresh does not touch the notification stack.
  if (!trialStatusOf(ent).active && (before?.periodType === "trial" || lost)) {
    dropTrialReminder();
  }
  // A trial cancelled in the store will not convert, and a reminder saying Pro
  // carries on would be wrong. Only a running trial qualifies, so a free or
  // paying user's refreshes still leave the notification stack alone.
  if (trialStatusOf(ent).active && (ent as any).willRenew === false) {
    dropTrialReminder();
  }
  setStoreStatus("ok");
  return active;
}

/**
 * Takes the pending trial-ending reminder (and the day-1 nudge) down. The
 * notifications service is required on demand: it pulls in the whole native
 * notification stack, which a plain entitlement read must not load.
 */
function dropTrialReminder(): void {
  void (async () => {
    try {
      const notifications: { cancelTrialReminder: () => Promise<void> } =
        require("./notifications");
      await notifications.cancelTrialReminder();
    } catch (err) {
      logCrash(err, { service: "purchases", op: "dropTrialReminder" });
    }
  })();
}

/** Reads the customer info from the store and runs it through the cache. Throws when the store cannot be read. */
async function fetchCustomerInfo(): Promise<any> {
  await ensureConfigured();
  const info = await rc().getCustomerInfo();
  if (info == null || typeof info !== "object") throw new Error("empty customer info");
  await applyCustomerInfo(info);
  return info;
}

/**
 * Links this install's anonymous id to the RevenueCat customer, so a purchase can
 * be matched to the usage events. That is an analytics purpose, so it follows the
 * analytics switch: nothing is sent while usage analytics is off.
 */
async function attachDeviceId(): Promise<void> {
  try {
    if (!(await getAnalyticsEnabled())) return;
    const id = await getDeviceId();
    if (id && id !== "unknown") await rc().setAttributes({ device_id: id });
  } catch (err) {
    logCrash(err, { service: "purchases", op: "setAttributes" });
  }
}

/** Follows the Settings > Data switch: off takes the id back off the customer, on puts it there again. */
async function syncDeviceIdAttribute(enabled: boolean): Promise<void> {
  if (enabled) {
    await attachDeviceId();
    return;
  }
  try {
    await rc().setAttributes({ device_id: null });
  } catch (err) {
    logCrash(err, { service: "purchases", op: "clearAttribute" });
  }
}

/**
 * Puts the id on the customer, or takes it off, to match the analytics switch as
 * it stands when the SDK starts. A switch turned off while the SDK was not
 * running never reached syncDeviceIdAttribute, so an id left by an earlier
 * session would otherwise stay on the customer.
 */
async function syncDeviceIdToSwitch(): Promise<void> {
  try {
    await syncDeviceIdAttribute(await getAnalyticsEnabled());
  } catch (err) {
    logCrash(err, { service: "purchases", op: "syncAttribute" });
  }
}

async function ensureConfigured(): Promise<void> {
  if (DEBUG_MOCK_PURCHASES || configured) return;
  try {
    rc().configure({ apiKey: RC_API_KEY });
    configured = true;
  } catch (err) {
    noteStoreFailure("configure", err);
  }
  if (!configured) return;
  if (Platform.OS === "ios") {
    // Apple Search Ads attribution token; no ATT prompt needed, no-op below iOS 14.3.
    rc()
      .enableAdServicesAttributionTokenCollection()
      .catch((err: unknown) => logCrash(err, { service: "purchases", op: "adServices" }));
  }
  void syncDeviceIdToSwitch();
  onAnalyticsEnabledChange(syncDeviceIdAttribute);
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
  } catch (err) {
    logCrash(err, { service: "purchases", op: "readCache" });
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
 * that only want a boolean use isPro() below, which falls back to the last
 * known entitlement when the store cannot answer.
 */
export async function verifyProWithStore(): Promise<boolean | null> {
  if (DEBUG_MOCK_PURCHASES) return isProCached();
  try {
    // The cache is only written from a SUCCESSFUL answer (applyCustomerInfo), so
    // a failure can never overwrite a paying user's stored flag.
    const info = await fetchCustomerInfo();
    return Boolean(info?.entitlements?.active?.[ENTITLEMENT_ID]);
  } catch (err) {
    noteStoreFailure("getCustomerInfo", err);
    return null;
  }
}

/** The entitlement as best known: the store's answer, else the last one cached. */
export async function isPro(): Promise<boolean> {
  const verified = await verifyProWithStore();
  return verified ?? (await isProCached());
}

/**
 * Keeps the entitlement fresh while the app runs: `onChange` fires when the app
 * comes back to the foreground (a trial can end, or a subscription renew, while
 * it was away) and after RevenueCat pushes an update of its own (a renewal, a
 * refund, a purchase made on another device). The pushed info is run through the
 * cache first, so even a caller that ignores `onChange` never reads a stale flag,
 * and that same pass retires the trial-ending reminder once the trial is no
 * longer running (see applyCustomerInfo). Returns the unsubscribe function. A
 * no-op on a dev build, which has no store.
 */
export function watchEntitlement(onChange: () => void): () => void {
  if (DEBUG_MOCK_PURCHASES) return () => {};
  let stopped = false;
  let listening = false;
  const appSub = AppState.addEventListener("change", (state) => {
    if (state === "active") onChange();
  });
  const listener = (info: unknown) => {
    if (info == null || typeof info !== "object") return;
    void applyCustomerInfo(info).then(() => {
      if (!stopped) onChange();
    });
  };
  void ensureConfigured().then(() => {
    if (stopped || !configured) return;
    try {
      rc().addCustomerInfoUpdateListener(listener);
      listening = true;
    } catch (err) {
      logCrash(err, { service: "purchases", op: "addListener" });
    }
  });
  return () => {
    stopped = true;
    appSub.remove();
    if (!listening) return;
    try {
      rc().removeCustomerInfoUpdateListener(listener);
    } catch (err) {
      logCrash(err, { service: "purchases", op: "removeListener" });
    }
  };
}

/** Which plan unlocked Pro (for display), if known. */
export async function getPlan(): Promise<PlanId | null> {
  if (!DEBUG_MOCK_PURCHASES) {
    try {
      const info = await fetchCustomerInfo();
      const ent = info?.entitlements?.active?.[ENTITLEMENT_ID];
      // Android subscription ids carry a base plan, e.g. "zerospike_pro:monthly".
      const id = (ent?.productIdentifier ?? "").split(":")[0];
      if (id === PRO_PRODUCTS.lifetime.productId) return "lifetime";
      if (id === PRO_PRODUCTS.annual.productId) return "annual";
      if (id === PRO_PRODUCTS.monthly.productId) return "monthly";
    } catch (err) {
      // An unreachable store falls through to the plan stored at purchase time.
      noteStoreFailure("getPlan", err);
    }
  }
  try {
    const v = await AsyncStorage.getItem(PLAN_KEY);
    return v === "monthly" || v === "annual" || v === "lifetime" ? v : null;
  } catch (err) {
    logCrash(err, { service: "purchases", op: "readPlan" });
    return null;
  }
}

/**
 * The free-trial state as the STORE sees it. When the store cannot be read at
 * all (offline, SDK not configured, request failed) the last trial seen is
 * returned instead, and null only when there is none: the same "unreachable is
 * not an answer" distinction verifyProWithStore draws, so the UI can stay silent
 * instead of claiming there is no trial.
 *
 * Only periodType TRIAL counts (see trialStatusOf).
 */
export async function getTrialStatus(): Promise<TrialStatus | null> {
  if (DEBUG_MOCK_PURCHASES) {
    // No real entitlement exists on a dev build, so this mirrors
    // devFallbackPlans: annual is the plan that carries the trial there, and a
    // mock purchase of it is the only state in which the trial row is reviewable.
    try {
      const pro = (await AsyncStorage.getItem(PRO_KEY)) === "true";
      const plan = await AsyncStorage.getItem(PLAN_KEY);
      if (!pro || plan !== "annual") return NO_TRIAL;
      return {
        active: true,
        daysLeft: FALLBACK_TRIAL_DAYS,
        expiresAt: Date.now() + FALLBACK_TRIAL_DAYS * 86400000,
      };
    } catch (err) {
      logCrash(err, { service: "purchases", op: "mockTrial" });
      return null;
    }
  }
  try {
    const info = await fetchCustomerInfo();
    return trialStatusOf(info?.entitlements?.active?.[ENTITLEMENT_ID]);
  } catch (err) {
    noteStoreFailure("getTrialStatus", err);
    return lastKnownTrialStatus();
  }
}

/**
 * The trial as last seen while the store was readable, for when it is not: a
 * trial user who goes offline keeps their countdown instead of it vanishing.
 * Null when nothing was seen, or the remembered trial has already run out.
 */
async function lastKnownTrialStatus(): Promise<TrialStatus | null> {
  const facts = await readFacts();
  if (!facts || facts.periodType !== "trial") return null;
  if (facts.expiresAt === null) return { active: true, daysLeft: null, expiresAt: null };
  const left = Math.ceil((facts.expiresAt - Date.now()) / 86400000);
  return left > 0 ? { active: true, daysLeft: left, expiresAt: facts.expiresAt } : null;
}

/** Whether the user is inside a free trial right now, for event params. */
export async function isDuringTrial(): Promise<boolean> {
  return (await getTrialStatus())?.active === true;
}

/** Why a purchase attempt did not activate Pro. */
export type PurchaseErrorClass = "cancelled" | "alreadyOwned" | "storeError";

/**
 * Outcome of a purchase attempt.
 * - `ok`        Pro is active (either the purchase went through, or it was
 *               recovered without a restart, see `recovered`).
 * - `cancelled` the user dismissed the native sheet (distinct from a store
 *               error), so the caller can route a cancel into the downsell.
 * - `recovered` Pro was already the user's and the attempt only found it again
 *               (an already-owned error, or another error with an entitlement
 *               that predates the attempt), so the UI can tell the user "this is
 *               already yours" instead of "purchased". An error that arrives
 *               after the store took the payment is a plain success instead.
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
 * already-owned error, runs a restore. Store-read only; never throws. Returns the
 * active entitlement, or null when Pro could not be found.
 */
async function recoverEntitlement(alreadyOwned: boolean): Promise<object | null> {
  try {
    const info = await fetchCustomerInfo();
    const ent = info?.entitlements?.active?.[ENTITLEMENT_ID];
    if (ent) return ent;
  } catch (err) {
    // fall through to the restore attempt
    noteStoreFailure("recoverCustomerInfo", err);
  }
  if (alreadyOwned) {
    try {
      const info: any = await withTimeout(rc().restorePurchases(), 20000);
      await applyCustomerInfo(info);
      return info?.entitlements?.active?.[ENTITLEMENT_ID] ?? null;
    } catch (err) {
      noteStoreFailure("recoverRestore", err);
      return null;
    }
  }
  return null;
}

/** Whether the entitlement's latest purchase is at or after `sinceMs`. An unreadable date says no. */
function boughtSince(ent: unknown, sinceMs: number): boolean {
  const at = isoMs((ent as any)?.latestPurchaseDate);
  return at !== null && at >= sinceMs;
}

/**
 * Shared catch handler for a purchase attempt: classifies the error and, for a
 * non-cancel failure, tries to recover the entitlement (already-owned or a
 * purchase that actually went through). Used by both purchasePro and
 * purchaseDownsell so neither can end up silently stuck.
 */
async function classifyAndRecover(
  e: any,
  plan: PlanId,
  startedAt: number
): Promise<PurchaseOutcome> {
  const code = e?.code;
  if (Boolean(e?.userCancelled) || code === RC_ERR_CANCELLED) {
    return { ok: false, cancelled: true, recovered: false, error: "cancelled" };
  }
  const alreadyOwned =
    code === RC_ERR_ALREADY_PURCHASED || code === RC_ERR_ALREADY_IN_USE;
  const ent = await recoverEntitlement(alreadyOwned);
  if (ent) {
    await AsyncStorage.setItem(PLAN_KEY, plan).catch((err) =>
      logCrash(err, { service: "purchases", op: "writePlan" })
    );
    // An error other than already-owned can arrive AFTER the store took the
    // payment (a receipt that could not be posted, a dropped connection). An
    // entitlement whose latest purchase is newer than this attempt is that
    // purchase landing, not an old one found again, so it settles like any other
    // purchase: a trial it started gets its reminder and its trial_started.
    const landed = !alreadyOwned && boughtSince(ent, startedAt);
    return { ok: true, cancelled: false, recovered: !landed, error: null };
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
  const startedAt = Date.now();
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
    if (ok) {
      await applyCustomerInfo(customerInfo);
      await AsyncStorage.setItem(PLAN_KEY, plan);
    }
    return {
      ok,
      cancelled: false,
      recovered: false,
      error: ok ? null : "storeError",
    };
  } catch (e: any) {
    return classifyAndRecover(e, plan, startedAt);
  }
}

/**
 * What a completed purchase did to the trial, as the STORE reports it now.
 * - `started`  a new free trial began; `endsAt` is the store's own expiry (null
 *              when it reported none) and `daysLeft` its length from today.
 * - `running`  the purchase was an already-owned recovery while a trial is
 *              active: that trial is not new, and its reminder is not ours to touch.
 * - `none`     no trial is running (a paid period, or a failed purchase): any
 *              reminder left over from an earlier trial no longer applies.
 *
 * The decision never comes from the offer the paywall showed: the same package
 * starts a trial for one account and a paid period for another (the user already
 * took the intro offer on another device), and only the store knows which.
 */
export type TrialAfterPurchase =
  | { kind: "started"; endsAt: number | null; daysLeft: number | null }
  | { kind: "running" }
  | { kind: "none" };

export async function trialAfterPurchase(res: PurchaseOutcome): Promise<TrialAfterPurchase> {
  if (!res.ok) return { kind: "none" };
  const status = await getTrialStatus();
  if (status?.active !== true) return { kind: "none" };
  if (res.recovered) return { kind: "running" };
  return { kind: "started", endsAt: status.expiresAt, daysLeft: status.daysLeft };
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
    const active = await applyCustomerInfo(info);
    return active ? "restored" : "none";
  } catch (err) {
    noteStoreFailure("restore", err);
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
  } catch (err) {
    // sheet unavailable, ignore
    logCrash(err, { service: "purchases", op: "codeRedemption" });
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
  /**
   * True when the plan carries a real free trial (intro price 0) THIS user can
   * still take. On iOS the store decides that per account (an intro offer is once
   * per subscription group), so the offer existing is not enough: see
   * loadOfferings. Everything the paywall says about a trial hangs off this flag.
   */
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
    lifetime: { priceString: PRO_PRODUCTS.lifetime.priceUSD, price: 99.99, currencyCode: "USD", hasFreeTrial: false, introPriceString: null, introPrice: null, freeTrialDays: 0 },
  };
}

/**
 * Which of these store products this account may still take the intro offer on.
 * iOS only: Apple grants a free trial once per subscription group per Apple
 * Account, and `product.introPrice` is there whether or not it is still
 * available, so the offer on the product proves nothing about the person.
 * Anything short of a definite ELIGIBLE (INELIGIBLE, UNKNOWN, no intro offer, a
 * missing entry, a failed or slow check) is "not eligible": the paywall then
 * shows the plain price instead of promising a trial it may not give.
 */
async function trialEligibleProductIds(productIds: string[]): Promise<Set<string>> {
  const eligible = new Set<string>();
  if (productIds.length === 0) return eligible;
  try {
    const result: any = await withTimeout(
      rc().checkTrialOrIntroductoryPriceEligibility(productIds),
      ELIGIBILITY_TIMEOUT_MS
    );
    for (const id of productIds) {
      if (Number(result?.[id]?.status) === RC_INTRO_ELIGIBLE) eligible.add(id);
    }
  } catch (err) {
    logCrash(err, { service: "purchases", op: "trialEligibility" });
  }
  return eligible;
}

/**
 * Loads the current offering as display-ready plan metadata. In release, when
 * the offering cannot be fetched or mapped, returns status 'unavailable' (never
 * a hardcoded fallback) so the paywall can
 * show a retry state instead of fake prices. Store status bookkeeping happens
 * either way.
 */
export async function loadOfferings(): Promise<OfferingsResult> {
  if (DEBUG_MOCK_PURCHASES) {
    return { status: "ready", isDevFallback: true, plans: devFallbackPlans() };
  }
  try {
    await ensureConfigured();
    const offerings = await rc().getOfferings();
    setStoreStatus("ok");
    const pkgs = offerings?.current?.availablePackages ?? [];
    const mapped: { meta: PlanMeta; plan: PlanId; productId: string }[] = [];
    for (const p of pkgs) {
      const m = mapRcPackage(p);
      if (!m) continue;
      mapped.push({ meta: m.meta, plan: m.plan, productId: String(p.product?.identifier ?? "") });
    }
    if (Platform.OS === "ios") {
      const withTrial = mapped.filter((m) => m.meta.hasFreeTrial);
      const eligible = await trialEligibleProductIds(withTrial.map((m) => m.productId));
      for (const m of withTrial) {
        if (eligible.has(m.productId)) continue;
        m.meta.hasFreeTrial = false;
        m.meta.freeTrialDays = 0;
      }
    }
    const plans: OfferingPlans = {};
    for (const m of mapped) plans[m.plan] = m.meta;
    if (Object.keys(plans).length > 0) {
      return { status: "ready", isDevFallback: false, plans };
    }
  } catch (err) {
    noteStoreFailure("getOfferings", err);
  }
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
  standardPriceString: "$29.99",
  savingsPercent: 33,
};

function findAnnualMapped(pkgs: any[]): { meta: PlanMeta; productId: string } | undefined {
  for (const p of pkgs ?? []) {
    const m = mapRcPackage(p);
    if (m && m.plan === "annual") return { meta: m.meta, productId: String(p.product?.identifier ?? "") };
  }
  return undefined;
}

function findAnnual(pkgs: any[]): PlanMeta | undefined {
  return findAnnualMapped(pkgs)?.meta;
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
    const discountedMapped = findAnnualMapped(
      offerings?.all?.[DOWNSELL_OFFERING_ID]?.availablePackages ?? []
    );
    const discounted = discountedMapped?.meta;
    if (!realDiscount(standard, discounted)) return NO_DOWNSELL;
    // iOS: the discount is an introductory offer in the same subscription group
    // as the standard annual, which Apple grants once per Apple Account. The
    // price on the product is there whether or not this account can still take
    // it, so without a definite ELIGIBLE the App Store would charge the full
    // price behind a card that promised the discount.
    if (Platform.OS === "ios" && discounted!.introPrice != null) {
      const eligible = await trialEligibleProductIds([discountedMapped!.productId]);
      if (!eligible.has(discountedMapped!.productId)) return NO_DOWNSELL;
    }
    return {
      hasRealDiscount: true,
      discountedPriceString: discounted!.introPriceString ?? discounted!.priceString,
      standardPriceString: standard!.priceString,
      savingsPercent: savingsPct(standard, discounted),
    };
  } catch (err) {
    noteStoreFailure("getDownsellOffer", err);
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
  const startedAt = Date.now();
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
    if (ok) {
      await applyCustomerInfo(customerInfo);
      await AsyncStorage.setItem(PLAN_KEY, "annual");
    }
    return {
      ok,
      cancelled: false,
      recovered: false,
      error: ok ? null : "storeError",
    };
  } catch (e: any) {
    return classifyAndRecover(e, "annual", startedAt);
  }
}
