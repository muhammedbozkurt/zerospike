import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Spike's daily message allowance.
 *
 * Every message costs money upstream, so the assistant is metered per day and
 * per tier. The counter is a local, per-day tally (no server round-trip and no
 * identity), which is enough for a cost guard on a single-device app; the edge
 * function carries its own independent rate limit for the case where the URL
 * leaks (see supabase/functions/ai-ask-spike/index.ts).
 *
 * Running out is a neutral state, not an error: the UI says how many are left,
 * and when the day's allowance is spent it says so plainly and offers Pro to a
 * free user rather than failing a send.
 */

export const FREE_DAILY_MESSAGES = 3;
export const PRO_DAILY_MESSAGES = 50;

const COUNT_KEY = "zerospike.spikeDailyCount";

export interface SpikeUsage {
  /** Messages sent today. */
  used: number;
  /** The tier's daily allowance. */
  limit: number;
  /** limit - used, floored at 0. */
  remaining: number;
}

export function dailyLimitFor(isPro: boolean): number {
  return isPro ? PRO_DAILY_MESSAGES : FREE_DAILY_MESSAGES;
}

/** Local calendar day key. Never toISOString(), which is UTC and would roll the
 *  allowance over at the wrong moment for most of the world. */
function todayKey(now = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface StoredCount {
  day: string;
  count: number;
}

async function readCount(): Promise<StoredCount> {
  try {
    const raw = await AsyncStorage.getItem(COUNT_KEY);
    if (!raw) return { day: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as Partial<StoredCount>;
    // A stored day that is not today means the allowance has already reset.
    if (parsed?.day !== todayKey()) return { day: todayKey(), count: 0 };
    return { day: parsed.day, count: Number(parsed.count) || 0 };
  } catch {
    return { day: todayKey(), count: 0 };
  }
}

/** Today's usage for a tier. Rolls over on its own when the date changes. */
export async function getSpikeUsage(isPro: boolean): Promise<SpikeUsage> {
  const limit = dailyLimitFor(isPro);
  const { count } = await readCount();
  return { used: count, limit, remaining: Math.max(0, limit - count) };
}

/**
 * Records one sent message and returns the usage AFTER it. Call this when a
 * message is actually dispatched, so a failed send does not burn an allowance.
 */
export async function noteSpikeMessage(isPro: boolean): Promise<SpikeUsage> {
  const limit = dailyLimitFor(isPro);
  const current = await readCount();
  const next: StoredCount = { day: todayKey(), count: current.count + 1 };
  try {
    await AsyncStorage.setItem(COUNT_KEY, JSON.stringify(next));
  } catch {
    // A failed write only loses one tick of the counter; never block the send.
  }
  return { used: next.count, limit, remaining: Math.max(0, limit - next.count) };
}
