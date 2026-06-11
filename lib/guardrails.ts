import { countAllLogs, FREE_LOG_LIMIT } from "./db/logs";
import { countCustomFoods, FREE_CUSTOM_FOOD_LIMIT } from "./db/foods";

export { FREE_LOG_LIMIT, FREE_CUSTOM_FOOD_LIMIT };

/** Pro users are unrestricted; free users are capped at FREE_LOG_LIMIT. */
export async function canAddLog(
  profileId: string,
  isPro: boolean
): Promise<boolean> {
  if (isPro) return true;
  return (await countAllLogs(profileId)) < FREE_LOG_LIMIT;
}

export async function canAddCustomFood(isPro: boolean): Promise<boolean> {
  if (isPro) return true;
  return (await countCustomFoods()) < FREE_CUSTOM_FOOD_LIMIT;
}
