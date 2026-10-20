import { useEffect, useMemo, useState } from "react";

import { getFood, listPortions } from "../../lib/db/foods";
import { flOzGramsFor } from "../../lib/db/seedFlOz";
import type { PortionLabelKey } from "../../lib/db/types";
import { getLastPortion, setLastPortion } from "../../lib/lastPortion";
import {
  buildPortionChips,
  type PortionChip,
  type PortionMeasure,
} from "../../lib/mealCompose";

/**
 * Serving presets for the meal cards, loaded ONCE per food and shared.
 *
 * PortionPresetChips loads inside every row, which made each card flash empty
 * and then grow chips. Here the cache is module-level: a card whose food was
 * preloaded (loadFoodPortions when the food is added, or useFoodPortionsMap on
 * the parent) renders its chips on the first frame. Entries older than
 * FRESH_MS are served as they are and refreshed quietly, so presets edited on
 * the food page show up without a restart.
 */

interface Entry {
  measures: PortionMeasure[];
  remembered: PortionLabelKey | undefined;
  /** USDA grams per fluid ounce when the food is a catalog liquid, else null. */
  gPerFlOz: number | null;
  at: number;
}

const FRESH_MS = 60_000;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function isFresh(entry: Entry | undefined): boolean {
  return !!entry && Date.now() - entry.at < FRESH_MS;
}

/** Loads (or returns the cached) presets and the remembered measure of a food.
 *  Never rejects: a failed read is "no presets", the card falls back to a
 *  synthetic portion chip. */
export function loadFoodPortions(foodId: string): Promise<{
  measures: PortionMeasure[];
  remembered: PortionLabelKey | undefined;
  gPerFlOz: number | null;
}> {
  const hit = cache.get(foodId);
  if (isFresh(hit)) return Promise.resolve(hit as Entry);
  const pending = inflight.get(foodId);
  if (pending) return pending;
  const job = (async () => {
    let measures: PortionMeasure[] = [];
    let gPerFlOz: number | null = null;
    try {
      const rows = await listPortions(foodId);
      measures = rows.map((r) => ({ label_key: r.label_key, grams: r.grams }));
      const food = await getFood(foodId);
      gPerFlOz = flOzGramsFor(food?.name_en);
    } catch {
      // see above
    }
    const remembered = await getLastPortion(foodId);
    const entry: Entry = { measures, remembered, gPerFlOz, at: Date.now() };
    cache.set(foodId, entry);
    inflight.delete(foodId);
    notify();
    return entry;
  })();
  inflight.set(foodId, job);
  return job;
}

/** Remembers the chosen measure for next time (same store as the old chips). */
export function rememberPortion(foodId: string, label: PortionLabelKey): void {
  const entry = cache.get(foodId);
  if (entry) cache.set(foodId, { ...entry, remembered: label });
  void setLastPortion(foodId, label);
}

/** Drops cached presets (one food or all), e.g. after the preset editor saved. */
export function invalidateFoodPortions(foodId?: string): void {
  if (foodId) cache.delete(foodId);
  else cache.clear();
  notify();
}

export interface FoodPortionsView {
  /** False until the presets of this food were read once. */
  loaded: boolean;
  measures: PortionMeasure[];
  remembered: PortionLabelKey | undefined;
  /** USDA grams per fluid ounce for a catalog liquid, else null. */
  gPerFlOz: number | null;
  chips: PortionChip[];
}

function viewFor(foodId: string, typicalG: number, ozEntry: boolean): FoodPortionsView {
  const entry = cache.get(foodId);
  const measures = entry?.measures ?? [];
  return {
    loaded: !!entry,
    measures,
    remembered: entry?.remembered,
    gPerFlOz: entry?.gPerFlOz ?? null,
    chips: buildPortionChips(measures, entry?.remembered, typicalG, ozEntry),
  };
}

function useCacheTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return tick;
}

/** One food's chips. typicalG sizes the synthetic "portion" chip of a food
 *  that has no presets; ozEntry adds the US "oz…" entry chip. */
export function useFoodPortions(foodId: string, typicalG = 0, ozEntry = false): FoodPortionsView {
  const tick = useCacheTick();
  useEffect(() => {
    if (foodId) void loadFoodPortions(foodId);
  }, [foodId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => viewFor(foodId, typicalG, ozEntry), [foodId, typicalG, ozEntry, tick]);
}

/** The whole list in one go, for the parent that renders the cards: one effect,
 *  one re-render per finished load batch instead of one hook per card. */
export function useFoodPortionsMap(
  foods: readonly { id: string; typicalG?: number }[],
  ozEntry = false
): Record<string, FoodPortionsView> {
  const tick = useCacheTick();
  const idKey = foods.map((f) => `${f.id}:${f.typicalG ?? 0}`).join("|");
  useEffect(() => {
    for (const f of foods) if (f.id && !f.id.startsWith("est:")) void loadFoodPortions(f.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);
  return useMemo(() => {
    const out: Record<string, FoodPortionsView> = {};
    for (const f of foods) out[f.id] = viewFor(f.id, f.typicalG ?? 0, ozEntry);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, ozEntry, tick]);
}
