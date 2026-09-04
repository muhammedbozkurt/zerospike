import Constants from "expo-constants";

import { isProductBarcode, parseOffProduct, type OffProduct } from "./offParse";
import type { Lang } from "../db/types";

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

/**
 * Only what the calculator and the food list need; the full product record is
 * large. One per-language name per app language lets a cached product read
 * correctly whatever language the app is in, and `categories_tags` is what a
 * shelf is guessed from. Everything else stays on the server.
 */
const FIELDS = [
  "product_name",
  "product_name_tr",
  "product_name_en",
  "product_name_de",
  "product_name_es",
  "product_name_fr",
  "product_name_it",
  "product_name_pt",
  "product_name_ar",
  "product_name_ja",
  "brands",
  "categories_tags",
  "nutriments",
  "serving_quantity",
].join(",");

const TIMEOUT_MS = 5000;

/**
 * Open Food Facts has no v3 text search; the v1 `cgi/search.pl` endpoint does,
 * with its own field list. `code` replaces the barcode the v3 lookup gets from
 * the URL path, and `serving_size` (a free-text string, "250 g") replaces the
 * numeric `serving_quantity` a product endpoint returns - see
 * servingSizeToGrams below, which bridges the two so parseOffProduct's own
 * validated conversion still does the actual work.
 */
const SEARCH_FIELDS = `code,${FIELDS},serving_size`;

/** Search subdomains OFF does not run: routed to the worldwide catalogue
 *  instead, same as a product lookup falls back to its `product_name`. */
const SEARCH_WORLD_LANGS: ReadonlySet<Lang> = new Set(["ar", "ja"]);

/**
 * Open Food Facts asks search clients to stay under ~10 requests/minute.
 * There is no live-as-you-type search (a single user tap triggers one call),
 * and this is the backstop that keeps a second impatient tap - or a second
 * mounted screen - from firing another request too soon; searchProducts
 * answers "rate_limited" itself rather than letting the request go out and
 * risking the whole client getting throttled.
 */
const SEARCH_RATE_LIMIT_MS = 6000;
let lastSearchAt = 0;

/** A single-character query is not a search, it is a keystroke; sending it to
 *  Open Food Facts would burn a rate-limited request on a term the local
 *  catalogue's own FTS is about to re-run anyway on the next character.
 *  Exported so the button that triggers searchProducts (OffSearchResults) can
 *  hide itself under the same floor instead of duplicating the number. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/**
 * Open Food Facts search results carry `serving_size` as free text ("250 g",
 * "1 tranche (30g)"), not the numeric grams a product endpoint returns. Only
 * the first gram figure is trusted; parseOffProduct still owns the actual
 * bounds check (a nonsense figure falls back to its own 100 g default), so
 * this only needs to extract a plausible number, not fully validate one - a
 * negative or zero figure ("-5 g", "0 g") is not plausible, so those return
 * undefined here rather than reaching parseOffProduct as a negative grams.
 */
function servingSizeToGrams(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/(-?\d+(?:[.,]\d+)?)\s*g\b/i);
  if (!match) return undefined;
  const grams = parseFloat(match[1].replace(",", "."));
  return Number.isFinite(grams) && grams > 0 ? grams : undefined;
}

export {
  OFF_SOURCE,
  foodSourceLabel,
  mapOffCategory,
  type OffNames,
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

export type OffSearchOutcome =
  /** `products` can be empty - a real answer with nothing usable in it,
   *  distinct from `unreachable` below. */
  | { kind: "found"; products: OffProduct[] }
  /** No network, timeout, or the service answered with something unusable. */
  | { kind: "unreachable" }
  /** This call would have gone out inside SEARCH_RATE_LIMIT_MS of the last
   *  one; refused locally rather than risking the whole client getting
   *  throttled by Open Food Facts. */
  | { kind: "rate_limited" };

/**
 * Searches Open Food Facts by product name, for the "found nothing locally"
 * button next to the catalogue's own search - never called as the user
 * types, only once per tap (see SEARCH_RATE_LIMIT_MS above). Never throws:
 * every failure resolves to "unreachable", matching lookupBarcode.
 */
export async function searchProducts(
  query: string,
  lang: Lang
): Promise<OffSearchOutcome> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) return { kind: "found", products: [] };

  const now = Date.now();
  if (now - lastSearchAt < SEARCH_RATE_LIMIT_MS) return { kind: "rate_limited" };
  lastSearchAt = now;

  const lc = SEARCH_WORLD_LANGS.has(lang) ? "world" : lang;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url =
      `https://${lc}.openfoodfacts.org/cgi/search.pl` +
      `?search_terms=${encodeURIComponent(trimmed)}` +
      `&search_simple=1&action=process&json=1&page_size=20&fields=${SEARCH_FIELDS}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": userAgent() },
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "unreachable" };

    const body = (await response.json()) as { products?: unknown };
    const rawProducts = Array.isArray(body.products) ? body.products : [];
    const products: OffProduct[] = [];
    for (const raw of rawProducts) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const code = typeof item.code === "string" ? item.code.trim() : "";
      if (!isProductBarcode(code)) continue;
      // parseOffProduct reads serving_quantity (numeric grams); the search
      // endpoint only has serving_size (free text), so it is converted into
      // the field parseOffProduct already knows how to validate, rather than
      // duplicating that bounds check here.
      const shim = {
        ...item,
        serving_quantity: item.serving_quantity ?? servingSizeToGrams(item.serving_size),
      };
      const parsed = parseOffProduct(code, shim);
      if (parsed) products.push(parsed);
    }
    return { kind: "found", products };
  } catch {
    // Abort (timeout), DNS failure, airplane mode, malformed JSON.
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
