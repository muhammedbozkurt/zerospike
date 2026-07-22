/** Food categories — universal food-type taxonomy, globally diverse items
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

/** Ionicons name per category (for chips/section headers). */
export const CATEGORY_ICON: Record<Category, string> = {
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
};

/** Illustrated emoji per category - the mockup's "hero-food" plate. Icons alone
 *  read as chrome; a food list is easier to scan when each row carries a picture
 *  of the food. Every emoji is still paired with the item's name and carb value. */
export const CATEGORY_EMOJI: Record<Category, string> = {
  dishes: "🍲",
  staples: "🍚",
  bakery: "🍞",
  legumes: "🫘",
  vegetables: "🥗",
  fruits: "🍎",
  dairy: "🥛",
  protein: "🍗",
  fastfood: "🍔",
  sweets: "🍰",
  nuts: "🥜",
  beverages: "🥤",
};

/** The plate for a food row, falling back to a neutral plate for unknowns. */
export function categoryEmoji(category: string): string {
  return (CATEGORY_EMOJI as Record<string, string>)[category] ?? "🍽️";
}
