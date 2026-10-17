import { useEffect, useState } from "react";

import { loadOfferings, type OfferingsResult } from "./services/purchases";

export type ProCtaLabel =
  | { kind: "trial"; key: "proCta.trial"; params: { days: number } }
  | { kind: "upgrade"; key: "proCta.upgrade"; params: Record<string, never> };

/**
 * A trial is promised only when the store says this account may take it and the
 * length is a real positive whole number; every other case is the plain upgrade.
 */
export function proCtaLabel(input: {
  trialEligible: boolean;
  trialDays: number | undefined;
}): ProCtaLabel {
  const { trialEligible, trialDays } = input;
  if (trialEligible === true && Number.isInteger(trialDays) && (trialDays as number) > 0) {
    return { kind: "trial", key: "proCta.trial", params: { days: trialDays as number } };
  }
  return { kind: "upgrade", key: "proCta.upgrade", params: {} };
}

let offeringsPromise: Promise<OfferingsResult> | null = null;

function sharedOfferings(): Promise<OfferingsResult> {
  if (!offeringsPromise) {
    const p = loadOfferings();
    offeringsPromise = p;
    p.then(
      (r) => {
        if (r.status !== "ready" && offeringsPromise === p) offeringsPromise = null;
      },
      () => {
        if (offeringsPromise === p) offeringsPromise = null;
      }
    );
  }
  return offeringsPromise;
}

/** Forget the cached offerings (after a purchase or restore changes eligibility). */
export function resetPaywallTrialCache(): void {
  offeringsPromise = null;
  cacheVersion++;
  listeners.forEach((fn) => fn());
}

let cacheVersion = 0;
const listeners = new Set<() => void>();

export function getPaywallTrialCacheVersion(): number {
  return cacheVersion;
}

/** Calls fn after every resetPaywallTrialCache(); returns the unsubscribe. */
export function subscribePaywallTrialReset(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export interface PaywallTrial {
  trialEligible: boolean;
  trialDays: number;
}

const NO_TRIAL: PaywallTrial = { trialEligible: false, trialDays: 0 };

export function trialFromOfferings(r: OfferingsResult | null | undefined): PaywallTrial {
  if (!r || r.status !== "ready" || r.isDevFallback) return NO_TRIAL;
  const annual = r.plans.annual;
  if (annual?.hasFreeTrial !== true) return NO_TRIAL;
  const days = annual.freeTrialDays;
  return { trialEligible: true, trialDays: Number.isInteger(days) && days > 0 ? days : 0 };
}

/** Cached one-shot read; any failure reads as "no trial". */
export function getPaywallTrial(): Promise<PaywallTrial> {
  return sharedOfferings().then(trialFromOfferings, () => NO_TRIAL);
}

/**
 * Never promises a trial until the store answered with a real, eligible one.
 * enabled=false (Pro users, or no lock rendered) never touches the store.
 */
export function usePaywallTrial(enabled: boolean = true): PaywallTrial {
  const [state, setState] = useState<PaywallTrial>(NO_TRIAL);
  const [version, setVersion] = useState(getPaywallTrialCacheVersion());
  useEffect(
    () => subscribePaywallTrialReset(() => setVersion(getPaywallTrialCacheVersion())),
    []
  );
  useEffect(() => {
    if (!enabled) {
      setState(NO_TRIAL);
      return;
    }
    let alive = true;
    getPaywallTrial().then((r) => {
      if (alive) setState(r);
    });
    return () => {
      alive = false;
    };
  }, [enabled, version]);
  return enabled ? state : NO_TRIAL;
}

/** The label for any Pro lock button: render with t(label.key, label.params). */
export function useProCta(enabled: boolean = true): ProCtaLabel {
  const { trialEligible, trialDays } = usePaywallTrial(enabled);
  return proCtaLabel({ trialEligible, trialDays });
}
