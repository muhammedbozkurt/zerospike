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

/** What the win-back screen needs of an offer; purchases.ts' WinbackOffer fits it. */
export interface WinbackHandoffOffer {
  hasRealDiscount: boolean;
  discountedPriceString: string | null;
  standardPriceString: string | null;
  savingsPercent: number;
  source: "apple" | "downsell";
  appleOfferId: string | null;
}

export type WinbackRouteParams = Record<string, string>;

// The trigger's own handoff, kept in memory: a link that opens /winback by
// hand carries params nobody here produced, and those must never decide the
// price the screen shows.
let lastHandoff: string | null = null;

/** Route params for the offer the trigger found, or null when there is nothing to show. */
export function winbackOfferToParams(offer: WinbackHandoffOffer): WinbackRouteParams | null {
  if (!offer.hasRealDiscount || !offer.discountedPriceString) return null;
  const params: WinbackRouteParams = {
    wbSource: offer.source,
    wbPrice: offer.discountedPriceString,
    wbWas: offer.standardPriceString ?? "",
    wbPct: String(offer.savingsPercent),
    wbOfferId: offer.appleOfferId ?? "",
  };
  lastHandoff = JSON.stringify(params);
  return params;
}

/** The offer the trigger handed over, or null (no params, or not the trigger's) so the screen fetches its own. */
export function winbackOfferFromParams(
  raw: Record<string, string | string[] | undefined>
): WinbackHandoffOffer | null {
  const pick = (k: string): string | null => {
    const v = raw[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" ? s : null;
  };
  const source = pick("wbSource");
  const price = pick("wbPrice");
  const was = pick("wbWas");
  const pct = pick("wbPct");
  const offerId = pick("wbOfferId");
  if ((source !== "apple" && source !== "downsell") || !price || was == null || pct == null || offerId == null) {
    return null;
  }
  const params: WinbackRouteParams = { wbSource: source, wbPrice: price, wbWas: was, wbPct: pct, wbOfferId: offerId };
  if (lastHandoff !== JSON.stringify(params)) return null;
  const savingsPercent = Number(pct);
  if (!Number.isFinite(savingsPercent)) return null;
  return {
    hasRealDiscount: true,
    discountedPriceString: price,
    standardPriceString: was === "" ? null : was,
    savingsPercent,
    source,
    appleOfferId: offerId === "" ? null : offerId,
  };
}
