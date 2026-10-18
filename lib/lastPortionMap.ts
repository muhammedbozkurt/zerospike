import { PORTION_LABEL_KEYS, type PortionLabelKey } from "./db/types";

export const LAST_PORTION_KEY = "zerospike.lastPortion";
export const LAST_PORTION_CAP = 300;

export type LastPortionMap = Record<string, PortionLabelKey>;

/** Tolerant of anything storage hands back: junk entries are dropped, not thrown. */
export function parseLastPortions(raw: string | null | undefined): LastPortionMap {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: LastPortionMap = {};
    for (const [id, label] of Object.entries(v as Record<string, unknown>)) {
      if (id && (PORTION_LABEL_KEYS as readonly unknown[]).includes(label)) {
        out[id] = label as PortionLabelKey;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Newest entry last; past the cap the oldest foods fall off. */
export function withLastPortion(
  map: LastPortionMap,
  foodId: string,
  label: PortionLabelKey,
  cap = LAST_PORTION_CAP
): LastPortionMap {
  if (!foodId) return map;
  const next: LastPortionMap = { ...map };
  delete next[foodId];
  next[foodId] = label;
  const ids = Object.keys(next);
  for (let i = 0; i < ids.length - cap; i++) delete next[ids[i]];
  return next;
}

/** The preset to select on open: the remembered label if this food still has it. */
export function pickRememberedPortion<T extends { label_key: PortionLabelKey }>(
  presets: readonly T[],
  remembered: PortionLabelKey | undefined
): T | undefined {
  if (!remembered) return undefined;
  return presets.find((p) => p.label_key === remembered);
}
