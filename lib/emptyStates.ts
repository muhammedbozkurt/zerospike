/**
 * Pure "is this tab really empty" decisions for the shared EmptyState. Each one
 * waits for its data to have loaded first: an unfetched list looks identical to
 * an empty one, and a first-use card that flashes for a profile with plenty of
 * history reads as a bug.
 */

export interface FoodEmptyInput {
  todayLoaded: boolean;
  recentLoaded: boolean;
  templatesLoaded: boolean;
  todayMealCount: number;
  recentMealCount: number;
  templateCount: number;
}

/** Food tab, first use: no meal today, none ever logged (recent covers history),
 *  and no saved template to log from. */
export function foodIsEmpty(i: FoodEmptyInput): boolean {
  if (!i.todayLoaded || !i.recentLoaded || !i.templatesLoaded) return false;
  return i.todayMealCount === 0 && i.recentMealCount === 0 && i.templateCount === 0;
}

/** Every injection the heat-map window knows about, mapped or not. */
export function injectionUsageTotal(u: {
  sites: readonly { count: number }[];
  noSiteCount: number;
  legacyCount: number;
}): number {
  return u.sites.reduce((n, s) => n + s.count, 0) + u.noSiteCount + u.legacyCount;
}

export interface InjectionMapEmptyInput {
  historyLoaded: boolean;
  historyCount: number;
  /** Injections inside the heat-map window, with or without a site. */
  usageCount: number;
}

/** Injection map, nothing logged: the map and its legend stay visible, the card
 *  only explains what the colors will mean. */
export function injectionMapIsEmpty(i: InjectionMapEmptyInput): boolean {
  if (!i.historyLoaded) return false;
  return i.historyCount === 0 && i.usageCount === 0;
}

export interface InsightsDataInput {
  readings: number;
  injectionCount: number;
  meals: number;
}

/** Insights has nothing at all to summarise (no reading, injection or meal). */
export function insightsNeedsData(i: InsightsDataInput): boolean {
  return i.readings === 0 && i.injectionCount === 0 && i.meals === 0;
}
