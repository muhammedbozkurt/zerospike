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
