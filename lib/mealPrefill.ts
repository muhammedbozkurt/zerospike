/**
 * Opening a saved meal in the calculator. A carb estimate is saved with no
 * weight (portion 0): the carbs would be lost on re-save, so such a row opens
 * as 100 g of a food whose carb_100g equals the saved carbs.
 */
export const NO_WEIGHT_PORTION_G = 100;

export function hasMealWeight(portionG: number): boolean {
  return Number.isFinite(portionG) && portionG > 0;
}

export function mealPrefill(log: { portion_g: number; calculated_carbs_g: number }): {
  portion_g: number;
  carb_100g: number;
} {
  if (hasMealWeight(log.portion_g)) {
    return { portion_g: log.portion_g, carb_100g: (log.calculated_carbs_g * 100) / log.portion_g };
  }
  return { portion_g: NO_WEIGHT_PORTION_G, carb_100g: log.calculated_carbs_g };
}
