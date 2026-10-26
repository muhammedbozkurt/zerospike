/**
 * The decision behind the iOS win-back surface, kept pure (no RevenueCat, no
 * AsyncStorage) so scripts/winbackOffer.test.ts can run it under plain Node.
 * lib/services/purchases.ts does the store round trips and feeds the results in.
 *
 * iOS 18+: Apple's own win-back offer, when the lapsed subscriber is eligible.
 * Anything else (older iOS, no offer, an error or a slow answer): the existing
 * downsell card. Android never touches the Apple path.
 */

/** The store lookup is a native call on a one-shot surface, so it is bounded. */
export const WINBACK_OFFER_TIMEOUT_MS = 3000;

const MIN_IOS_MAJOR = 18;

/** Shape of a RevenueCat PurchasesWinBackOffer (a store product discount). */
export interface AppleWinBackCandidate {
  identifier: string;
  price: number;
  priceString: string;
  cycles: number;
  periodUnit: string;
  periodNumberOfUnits: number;
}

export interface AppleWinBackPick {
  identifier: string;
  discountedPriceString: string;
  savingsPercent: number;
}

export type WinbackSource = "apple" | "downsell" | "none";

export function iosSupportsWinBack(os: string, osVersion: string | number | undefined): boolean {
  if (os !== "ios") return false;
  const major = parseInt(String(osVersion ?? ""), 10);
  return Number.isFinite(major) && major >= MIN_IOS_MAJOR;
}

function monthsOf(unit: string, n: number): number | null {
  const u = String(unit).toUpperCase();
  if (u === "YEAR") return n * 12;
  if (u === "MONTH") return n;
  return null;
}

/**
 * The best offer the card can describe honestly: ONE up-front charge covering a
 * year, cheaper than the standard annual. Multi-cycle (pay as you go), shorter
 * or free offers would make "first year X, then Y per year" untrue, so they are
 * skipped and the existing card decides instead.
 */
export function pickAppleWinBackOffer(
  offers: readonly AppleWinBackCandidate[] | null | undefined,
  standardPrice: number
): AppleWinBackPick | null {
  if (!offers || !(standardPrice > 0)) return null;
  let best: AppleWinBackCandidate | null = null;
  let bestPct = 0;
  for (const o of offers) {
    if (!o || o.cycles !== 1) continue;
    if (monthsOf(o.periodUnit, o.periodNumberOfUnits) !== 12) continue;
    if (!(o.price > 0) || !o.priceString) continue;
    const pct = Math.round((1 - o.price / standardPrice) * 100);
    if (pct < 1) continue;
    if (!best || o.price < best.price) {
      best = o;
      bestPct = pct;
    }
  }
  return best
    ? { identifier: best.identifier, discountedPriceString: best.priceString, savingsPercent: bestPct }
    : null;
}

/**
 * Runs the store lookup under a deadline; any failure or silence is "no offer".
 * The standard price may be a getter because it is read from the same store
 * round trip that fetches the offers.
 */
export async function resolveAppleWinBack(
  fetchOffers: () => Promise<readonly AppleWinBackCandidate[] | null | undefined>,
  standardPrice: number | (() => number),
  timeoutMs: number = WINBACK_OFFER_TIMEOUT_MS
): Promise<AppleWinBackPick | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const offers = await Promise.race([fetchOffers(), deadline]);
    return pickAppleWinBackOffer(offers, typeof standardPrice === "function" ? standardPrice() : standardPrice);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function decideWinbackSource(input: {
  os: string;
  osVersion: string | number | undefined;
  apple: AppleWinBackPick | null;
  downsell: { hasRealDiscount: boolean };
}): WinbackSource {
  if (input.apple && iosSupportsWinBack(input.os, input.osVersion)) return "apple";
  return input.downsell.hasRealDiscount ? "downsell" : "none";
}
