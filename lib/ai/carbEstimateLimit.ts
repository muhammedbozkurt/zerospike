import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Daily allowance of the meal-text carb estimate: free 1, Pro 50. The server
 * keeps the binding count (`ce:<device>` in spike_usage, UTC day); this local
 * tally only spares a free user a request that would be refused. Its day is the
 * UTC day too, so the two roll over at the same moment. Device scoped, never
 * profile scoped: the server counts per installation.
 */
export const CARB_FREE_DAILY = 1;
export const CARB_PRO_DAILY = 50;

const COUNT_KEY = "zerospike.carbEstimateDailyCount";

export interface CarbUsage {
  used: number;
  limit: number;
  remaining: number;
}

export function carbDailyLimit(isPro: boolean): number {
  return isPro ? CARB_PRO_DAILY : CARB_FREE_DAILY;
}

export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

interface Stored {
  day: string;
  count: number;
}

/** A stored day that is not today's UTC day means the allowance has reset. */
export function countForDay(raw: string | null, day: string): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed?.day !== day) return 0;
    const n = Number(parsed.count);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function usageOf(count: number, isPro: boolean): CarbUsage {
  const limit = carbDailyLimit(isPro);
  return { used: count, limit, remaining: Math.max(0, limit - count) };
}

async function readCount(now: Date): Promise<number> {
  try {
    return countForDay(await AsyncStorage.getItem(COUNT_KEY), utcDayKey(now));
  } catch {
    return 0;
  }
}

async function writeCount(count: number, now: Date): Promise<void> {
  try {
    await AsyncStorage.setItem(COUNT_KEY, JSON.stringify({ day: utcDayKey(now), count }));
  } catch {
    // The server count still binds; a lost tick only costs one refused request.
  }
}

export async function getCarbUsage(isPro: boolean, now: Date = new Date()): Promise<CarbUsage> {
  return usageOf(await readCount(now), isPro);
}

/** One answered estimate (a failed request does not burn the allowance). */
export async function noteCarbEstimate(isPro: boolean, now: Date = new Date()): Promise<CarbUsage> {
  const next = (await readCount(now)) + 1;
  await writeCount(next, now);
  return usageOf(next, isPro);
}

/** The server said the day's allowance is gone: the tally catches up to it. */
export async function markCarbExhausted(isPro: boolean, now: Date = new Date()): Promise<CarbUsage> {
  const limit = carbDailyLimit(isPro);
  const current = await readCount(now);
  const next = Math.max(current, limit);
  await writeCount(next, now);
  return usageOf(next, isPro);
}
