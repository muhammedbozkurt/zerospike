/**
 * Pure parsing for Open Food Facts barcode results. Kept free of network and
 * React Native imports so it can be exercised by a standalone harness: this is
 * the boundary where untrusted third-party JSON becomes a carbohydrate figure
 * that feeds an insulin estimate, so it validates rather than trusts.
 *
 * The network call lives in lib/services/openFoodFacts.ts.
 */

/** Where a cached food row came from, stored in foods.source. */
export const OFF_SOURCE = "off";

/** Human-readable attribution shown next to a food we did not author. */
export const OFF_ATTRIBUTION = "Open Food Facts";

/** Carbohydrate content per 100 g cannot exceed 100 g. */
const MAX_CARB_100G = 100;

/** A serving larger than this is data we do not trust as a default portion. */
const MAX_SERVING_G = 2000;

export interface OffProduct {
  barcode: string;
  name: string;
  brand: string | null;
  /** grams of carbohydrate per 100 g of product */
  carb100g: number;
  /** typical serving in grams; 100 when the product does not state a usable one */
  portionG: number;
}

/**
 * Open Food Facts is keyed by numeric EAN/UPC codes. The scanner also reads QR
 * and Code39, whose payloads are not product barcodes; querying with those
 * would send whatever text they contain to a third party, so they never leave
 * the device.
 */
export function isProductBarcode(code: string): boolean {
  return /^[0-9]{6,14}$/.test(code.trim());
}

/**
 * Display name for a `foods.source` value. Attribution is a factual credit, not
 * translated copy, so it reads the same in every language. An unrecognised
 * source shows verbatim rather than being silently hidden.
 */
export function foodSourceLabel(source: string): string {
  return source === OFF_SOURCE ? OFF_ATTRIBUTION : source;
}

/** Open Food Facts reports numbers as either a number or a numeric string. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Maps a raw product payload onto what the calculator needs, or null when the
 * product is unusable: no name, or no trustworthy carbohydrate figure. A
 * missing serving size is not a failure; it falls back to 100 g.
 *
 * Open Food Facts carries no glycemic index and this does not invent one.
 */
export function parseOffProduct(barcode: string, raw: unknown): OffProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const product = raw as Record<string, unknown>;

  const name = trimmedString(product.product_name);
  if (!name) return null;

  const nutriments =
    product.nutriments && typeof product.nutriments === "object"
      ? (product.nutriments as Record<string, unknown>)
      : {};

  const carb100g = toNumber(nutriments.carbohydrates_100g);
  if (carb100g === null || carb100g < 0 || carb100g > MAX_CARB_100G) return null;

  const serving = toNumber(product.serving_quantity);
  const portionG =
    serving !== null && serving > 0 && serving <= MAX_SERVING_G ? serving : 100;

  return {
    barcode: barcode.trim(),
    name,
    brand: trimmedString(product.brands),
    carb100g,
    portionG,
  };
}
