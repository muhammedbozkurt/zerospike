import { countCustomFoods, FREE_CUSTOM_FOOD_LIMIT } from "./db/foods";

export { FREE_CUSTOM_FOOD_LIMIT };

// Manual logging (glucose/meal/insulin) is UNLIMITED on both tiers as of R1: the
// old lifetime 5-log cap was removed so the reminder loop can build a habit
// before the product asks for money. Pro value now lives in Insights, Health
// auto-sync, multiple profiles, site rotation and doctor exports.

export async function canAddCustomFood(isPro: boolean): Promise<boolean> {
  if (isPro) return true;
  return (await countCustomFoods()) < FREE_CUSTOM_FOOD_LIMIT;
}
