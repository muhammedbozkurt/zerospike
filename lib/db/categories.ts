/** Food categories: universal food-type taxonomy, globally diverse items
 *  live inside each (especially `dishes`). Order = display order on the Food tab. */
export const CATEGORIES = [
  "dishes",
  "staples",
  "bakery",
  "legumes",
  "vegetables",
  "fruits",
  "dairy",
  "protein",
  "fastfood",
  "sweets",
  "nuts",
  "beverages",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * The value the `foods.category` column can actually hold. The twelve above are
 * the DISPLAY categories; "other" is the column's SQL default and the honest
 * answer for a row nobody classified: a barcode result whose Open Food Facts
 * tags matched none of ours, or a custom food the user did not file anywhere.
 *
 * It is deliberately NOT in CATEGORIES, so the Food tab's grid keeps showing the
 * twelve real shelves. Anything offering a full choice (a category picker) uses
 * FOOD_CATEGORIES below.
 */
export type FoodCategory = Category | "other";

/** The default for a food that has not been classified. */
export const DEFAULT_FOOD_CATEGORY: FoodCategory = "other";

/** Every storable category, in picker order, with the catch-all last. */
export const FOOD_CATEGORIES: readonly FoodCategory[] = [
  ...CATEGORIES,
  DEFAULT_FOOD_CATEGORY,
];

/** Narrows an arbitrary string (a stored column, a parsed tag) to a category. */
export function isFoodCategory(value: unknown): value is FoodCategory {
  return (
    typeof value === "string" &&
    (FOOD_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Ionicons name per category (for chips/section headers). */
export const CATEGORY_ICON: Record<FoodCategory, string> = {
  dishes: "globe-outline",
  staples: "nutrition-outline",
  bakery: "pizza-outline",
  legumes: "leaf-outline",
  vegetables: "flower-outline",
  fruits: "color-filter-outline",
  dairy: "egg-outline",
  protein: "fish-outline",
  fastfood: "fast-food-outline",
  sweets: "ice-cream-outline",
  nuts: "ellipse-outline",
  beverages: "wine-outline",
  other: "apps-outline",
};

/** Illustrated emoji per category - the mockup's "hero-food" plate. Icons alone
 *  read as chrome; a food list is easier to scan when each row carries a picture
 *  of the food. Every emoji is still paired with the item's name and carb value. */
export const CATEGORY_EMOJI: Record<FoodCategory, string> = {
  dishes: "🍲",
  staples: "🍚",
  bakery: "🍞",
  // Emoji 12 baseline on purpose: U+1FAD8 beans (Emoji 14) renders as tofu on
  // iOS < 15.4 and Android < 12L.
  legumes: "🥫",
  vegetables: "🥗",
  fruits: "🍎",
  dairy: "🥛",
  protein: "🍗",
  fastfood: "🍔",
  sweets: "🍰",
  nuts: "🥜",
  beverages: "🥤",
  // Not a fallback that leaked into the map: an unclassified food really is "a
  // plate of something", and a scanned or hand-typed row deserves a plate of its
  // own rather than borrowing a shelf it does not belong to.
  other: "🍽️",
};

/** The plate for a food row, falling back to the unclassified plate. */
export function categoryEmoji(category: string): string {
  return (CATEGORY_EMOJI as Record<string, string>)[category] ?? CATEGORY_EMOJI.other;
}
