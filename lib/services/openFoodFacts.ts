import Constants from "expo-constants";

import { isProductBarcode, parseOffProduct, type OffProduct } from "./offParse";

/**
 * Barcode lookup against Open Food Facts (openfoodfacts.org), a free, public,
 * key-less product database. API v3, documented at
 * https://openfoodfacts.github.io/openfoodfacts-server/api/
 *
 * Privacy: the request carries the scanned barcode and nothing else. No
 * profile, no logs, no identifiers. Open Food Facts asks every client to
 * identify itself in the User-Agent, so we send the app name, version and a
 * support URL.
 *
 * Parsing and validation live in ./offParse (pure, tested separately).
 */

const ENDPOINT = "https://world.openfoodfacts.org/api/v3/product";

/** Only what the calculator needs; the full product record is large. */
const FIELDS = "product_name,brands,nutriments,serving_quantity";

const TIMEOUT_MS = 5000;

export {
  OFF_ATTRIBUTION,
  OFF_SOURCE,
  foodSourceLabel,
  isProductBarcode,
  type OffProduct,
} from "./offParse";

export type OffLookup =
  | { kind: "found"; product: OffProduct }
  /** No such barcode, or a product with no usable carbohydrate figure. */
  | { kind: "not_found" }
  /** No network, timeout, or the service answered with something unusable. */
  | { kind: "unreachable" };

function userAgent(): string {
  const version = Constants.expoConfig?.version ?? "1.0.0";
  return `zerospike/${version} (https://greeneyeapp.com/zerospike/support)`;
}

/**
 * Looks the barcode up online. Never throws: every failure resolves to
 * "not_found" or "unreachable", both of which drop the user into the manual
 * "add as a new food" flow with the barcode pre-filled.
 */
export async function lookupBarcode(barcode: string): Promise<OffLookup> {
  const code = barcode.trim();
  if (!isProductBarcode(code)) return { kind: "not_found" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}/${code}.json?fields=${FIELDS}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": userAgent() },
      signal: controller.signal,
    });

    // 404 is the service's answer for an unknown barcode, not a failure to
    // reach it. Anything else outside 2xx means we got no answer at all.
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return { kind: "unreachable" };

    const body = (await response.json()) as { product?: unknown };
    const product = parseOffProduct(code, body.product);
    return product ? { kind: "found", product } : { kind: "not_found" };
  } catch {
    // Abort (timeout), DNS failure, airplane mode, malformed JSON.
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
