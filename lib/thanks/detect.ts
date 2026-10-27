/**
 * Pure rules for the two thank-you moments: the one-time sheet when a free
 * trial turns into a paid Pro, and the quiet toast on a yearly-at-most renewal.
 * No React Native, no storage: lib/thanks/evaluate.ts feeds it and
 * components/ThanksSheet.tsx (ThanksHost) shows the result, so
 * scripts/thanksDetect.test.ts runs it under plain node.
 *
 * The one rule behind everything: a moment is shown only for a CHANGE seen
 * between two observations of the same entitlement. A first observation (new
 * install, reinstall, restore on a new device) only seeds the snapshot, so
 * nobody is thanked for something that did not just happen.
 */

export const THANKS_STATE_KEY = "zerospike.thanks.v1";

export const DAY_MS = 86_400_000;
/**
 * The renewal toast is shown at most once per this many days. Below 365 on
 * purpose: a yearly renewal lands about a year after the last toast, give or
 * take minutes, and a 365 floor would skip every other year. A monthly
 * subscriber still sees it about once a year.
 */
export const RENEWAL_TOAST_MIN_DAYS = 330;
/** Expiry must move forward by at least this much to count as a renewal. */
export const RENEWAL_MIN_ADVANCE_MS = DAY_MS;
/** A decided-but-not-yet-shown moment older than this is dropped silently. */
export const PENDING_MAX_AGE_MS = 14 * DAY_MS;

export type ThanksPeriod = "trial" | "normal" | "intro" | "unknown";
export type ThanksOutcome = "converted" | "renewed" | "none";

/** The active Pro entitlement as the store reports it right now. */
export interface ThanksEntitlement {
  active: boolean;
  periodType: ThanksPeriod;
  /** Epoch ms of the current period's end; null for lifetime or non-subscription. */
  expiresAt: number | null;
  productId: string | null;
  /** Epoch ms the store flagged a failed charge; null when there is none. */
  billingIssueDetectedAt: number | null;
  /** A Family Sharing entitlement: someone else paid, so there is nobody to thank. */
  familyShared: boolean;
}

export interface ThanksSnapshot extends ThanksEntitlement {
  /** Epoch ms of the observation, to notice the clock going backwards. */
  observedAt: number;
}

export interface ThanksShown {
  convertedSeenAt: number | null;
  renewalToastAt: number | null;
}

export interface ThanksState extends ThanksShown {
  snapshot: ThanksSnapshot | null;
  /**
   * A moment that was decided but has not been on screen yet. The seen stamps
   * above are written only once the sheet or toast is really shown, so a moment
   * that could not be presented (another sheet up, app closed) survives a
   * restart and is shown at the first clear moment.
   */
  pendingConvertedAt: number | null;
  pendingRenewalAt: number | null;
}

export const EMPTY_THANKS_STATE: ThanksState = {
  snapshot: null,
  convertedSeenAt: null,
  renewalToastAt: null,
  pendingConvertedAt: null,
  pendingRenewalAt: null,
};

/** True while a pending stamp is still worth showing. A future stamp (clock moved) is not. */
export function pendingFresh(at: number | null, now: number): boolean {
  return at !== null && now >= at && now - at <= PENDING_MAX_AGE_MS;
}

/** The yearly-at-most gap since the last renewal toast. A future stamp (clock moved) blocks. */
export function renewalGapElapsed(renewalToastAt: number | null, now: number): boolean {
  return renewalToastAt === null || now - renewalToastAt >= RENEWAL_TOAST_MIN_DAYS * DAY_MS;
}

export interface DetectInput {
  /** The previous snapshot; null on a first observation. */
  prev: ThanksSnapshot | null;
  current: ThanksEntitlement;
  now: number;
  shown: ThanksShown;
}

function sameProduct(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function inactiveSnapshot(now: number): ThanksSnapshot {
  return {
    active: false,
    periodType: "unknown",
    expiresAt: null,
    productId: null,
    billingIssueDetectedAt: null,
    familyShared: false,
    observedAt: now,
  };
}

/**
 * Decides which moment (if any) this observation is, and the snapshot to keep.
 * The snapshot is always returned, shown or not.
 */
export function detectThanks(input: DetectInput): { outcome: ThanksOutcome; next: ThanksSnapshot } {
  const { prev, current, now, shown } = input;
  if (!current.active) return { outcome: "none", next: inactiveSnapshot(now) };

  const next: ThanksSnapshot = {
    active: true,
    periodType: current.periodType,
    expiresAt: current.expiresAt,
    productId: current.productId,
    billingIssueDetectedAt: current.billingIssueDetectedAt,
    familyShared: current.familyShared,
    observedAt: now,
  };

  // Someone else's subscription: never thanked, but the snapshot follows it.
  if (current.familyShared) return { outcome: "none", next };
  // A failed charge: the old snapshot stays, so the payment that goes through
  // later is still seen as the change it is (trial to paid, or a renewal).
  if (current.billingIssueDetectedAt !== null && prev && prev.active) {
    return { outcome: "none", next: prev };
  }

  // First observation: seed only.
  if (!prev || !prev.active) return { outcome: "none", next };
  // The clock went back since the last look: nothing here can be trusted.
  if (now < prev.observedAt) return { outcome: "none", next };
  if (!sameProduct(prev.productId, current.productId)) return { outcome: "none", next };

  const expiryMovedForward =
    prev.expiresAt !== null && current.expiresAt !== null && current.expiresAt > prev.expiresAt;

  // Only a real free trial counts; "intro" is a discounted paid period.
  const trialToPaid = prev.periodType === "trial" && current.periodType === "normal";
  if (trialToPaid) {
    if (!expiryMovedForward) return { outcome: "none", next };
    if (shown.convertedSeenAt !== null) return { outcome: "none", next };
    return { outcome: "converted", next };
  }

  if (prev.periodType === "normal" && current.periodType === "normal") {
    if (prev.expiresAt === null || current.expiresAt === null) return { outcome: "none", next };
    if (current.expiresAt - prev.expiresAt < RENEWAL_MIN_ADVANCE_MS) return { outcome: "none", next };
    if (!renewalGapElapsed(shown.renewalToastAt, now)) return { outcome: "none", next };
    return { outcome: "renewed", next };
  }

  return { outcome: "none", next };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function periodOf(v: unknown): ThanksPeriod {
  return v === "trial" || v === "normal" || v === "intro" ? v : "unknown";
}

/** Unreadable or foreign content is an empty state: it can only cause a re-seed, never a show. */
export function parseThanksState(raw: string | null | undefined): ThanksState {
  if (!raw) return EMPTY_THANKS_STATE;
  try {
    const p: unknown = JSON.parse(raw);
    if (p === null || typeof p !== "object" || Array.isArray(p)) return EMPTY_THANKS_STATE;
    const o = p as Record<string, unknown>;
    const s = o.snapshot;
    let snapshot: ThanksSnapshot | null = null;
    if (s !== null && typeof s === "object" && !Array.isArray(s)) {
      const so = s as Record<string, unknown>;
      const observedAt = numOrNull(so.observedAt);
      if (typeof so.active === "boolean" && observedAt !== null) {
        snapshot = {
          active: so.active,
          periodType: periodOf(so.periodType),
          expiresAt: numOrNull(so.expiresAt),
          productId: strOrNull(so.productId),
          billingIssueDetectedAt: numOrNull(so.billingIssueDetectedAt),
          familyShared: so.familyShared === true,
          observedAt,
        };
      }
    }
    return {
      snapshot,
      convertedSeenAt: numOrNull(o.convertedSeenAt),
      renewalToastAt: numOrNull(o.renewalToastAt),
      pendingConvertedAt: numOrNull(o.pendingConvertedAt),
      pendingRenewalAt: numOrNull(o.pendingRenewalAt),
    };
  } catch {
    return EMPTY_THANKS_STATE;
  }
}

export function serializeThanksState(state: ThanksState): string {
  return JSON.stringify(state);
}
