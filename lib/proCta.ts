import AsyncStorage from "@react-native-async-storage/async-storage";
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

const STORAGE_KEY = "zerospike.proCtaTrial";

const MAX_STORED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let cachedTrial: PaywallTrial | null = null;
let gen = 0;

function notify(): void {
  cacheVersion++;
  listeners.forEach((fn) => fn());
}

function parseStored(raw: string | null): PaywallTrial | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v?.e !== "boolean" || !Number.isInteger(v?.d) || v.d < 0) return null;
    if (typeof v?.t !== "number" || !Number.isFinite(v.t) || Date.now() - v.t > MAX_STORED_AGE_MS) return null;
    return { trialEligible: v.e, trialDays: v.d };
  } catch {
    return null;
  }
}

/** Fills from storage only when memory is empty; hooks then read the cache synchronously. */
export async function hydratePaywallTrial(): Promise<void> {
  const startGen = gen;
  try {
    const stored = parseStored(await AsyncStorage.getItem(STORAGE_KEY));
    if (startGen !== gen) return;
    if (stored && !cachedTrial) {
      cachedTrial = stored;
      notify();
    }
  } catch {}
}

/** Re-reads the persisted value (after a paywall exit or purchase screen); never invalidates it. */
export function resetPaywallTrialCache(): void {
  notify();
  void hydratePaywallTrial();
}

/** Drops memory and storage (Pro gained, or a purchase or restore just landed), so no stale trial promise survives. */
export function clearPaywallTrial(): void {
  gen++;
  cachedTrial = null;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  notify();
}

let cacheVersion = 0;
const listeners = new Set<() => void>();

export function getPaywallTrialCacheVersion(): number {
  return cacheVersion;
}

/** Calls fn after every cache change or reset; returns the unsubscribe. */
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

/** Stores the store's answer; only a real ready result writes, anything else keeps the old value. */
export function primePaywallTrial(r: OfferingsResult | null | undefined): void {
  if (!r || r.status !== "ready" || r.isDevFallback) return;
  const next = trialFromOfferings(r);
  const same = cachedTrial && cachedTrial.trialEligible === next.trialEligible && cachedTrial.trialDays === next.trialDays;
  gen++;
  cachedTrial = next;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ e: next.trialEligible, d: next.trialDays, t: Date.now() })).catch(() => {});
  if (!same) notify();
}

let refreshedThisLaunch = false;

/** The single quiet launch refresh; the hooks themselves never touch the network. */
export async function refreshPaywallTrialOnce(): Promise<void> {
  if (refreshedThisLaunch) return;
  refreshedThisLaunch = true;
  const g = gen;
  try {
    const r = await loadOfferings({ silent: true });
    if (g === gen) primePaywallTrial(r);
  } catch {}
}

export function getPaywallTrialGen(): number {
  return gen;
}

void hydratePaywallTrial();

/**
 * Reads only the in-memory cache (hydrated from storage, filled by the paywall and the launch refresh); empty or unknown means "no trial".
 * enabled=false (Pro users, or no lock rendered) is always "no trial".
 */
export function usePaywallTrial(enabled: boolean = true): PaywallTrial {
  const [, setVersion] = useState(getPaywallTrialCacheVersion());
  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribePaywallTrialReset(() => setVersion(getPaywallTrialCacheVersion()));
    setVersion(getPaywallTrialCacheVersion());
    return unsub;
  }, [enabled]);
  return enabled && cachedTrial ? cachedTrial : NO_TRIAL;
}

/** The label for any Pro lock button: render with t(label.key, label.params). */
export function useProCta(enabled: boolean = true): ProCtaLabel {
  const { trialEligible, trialDays } = usePaywallTrial(enabled);
  return proCtaLabel({ trialEligible, trialDays });
}
