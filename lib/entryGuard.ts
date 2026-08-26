/**
 * Duplicate-entry / future-dated confirmation layer. Pure and DB-free: it only
 * decides WHICH confirmation to ask for, never renders or translates text -
 * the caller resolves each `kind` through i18n. This is a data-entry check,
 * not a medical judgment; nothing here scores, warns about, or interprets a
 * dose.
 */

export type EntryGuardKind =
  | "recent_basal"
  | "recent_bolus"
  | "recent_glucose"
  | "recent_meal"
  | "timer_running"
  | "future_dated";

export interface EntryGuardNotice {
  kind: EntryGuardKind;
  /** ISO time of the existing record the confirmation is about; for
   *  future_dated this is the new entry's own time instead. */
  atIso: string;
  detail?: { units?: number; valueText?: string; foodName?: string };
}

export interface EntryGuardInput {
  /** Date.now(), injected so tests control the clock. */
  now: number;
  /** ISO time of the record about to be saved. Defaults to `now`. */
  entryAtIso?: string;
  entryKind: "glucose" | "meal" | "injection" | "post_meal_timer";
  insulinType?: "basal" | "bolus" | null;
  foodKey?: string | null;
  foodName?: string | null;
  /** The id of the record being EDITED, if any. Any `recent` row sharing this
   *  id is skipped, whatever its own logged_at says - the entry being saved is
   *  never a duplicate of itself. Absent (or null) on a brand-new entry, where
   *  there is nothing yet to exclude - a brand-new entry has no id of its own
   *  to compare against, so nothing is excluded on its behalf. A millisecond
   *  match with an existing row is NOT treated as identity here: two genuinely
   *  different entries can land on the exact same instant (Android's
   *  InlineDateTimePicker zeroes seconds, so two taps in the same minute carry
   *  identical ISO timestamps), and that is precisely the double-entry this
   *  guard exists to catch. */
  excludeId?: string | null;
  /** Caller reads these from the DB; this module never touches storage. Order
   *  does not matter, the nearest match within the window is picked. */
  recent?: {
    injections?: { id: string; logged_at: string; insulin_type: "basal" | "bolus" | null; dose_units: number | null }[];
    glucose?: { id: string; logged_at: string; valueText: string }[];
    meals?: { id: string; logged_at: string; foodKey: string | null; foodName: string | null }[];
  };
  runningTimerEndsAtIso?: string | null;
}

export const GUARD_WINDOW_MS: Record<
  "recent_basal" | "recent_bolus" | "recent_glucose" | "recent_meal" | "future_dated",
  number
> = {
  recent_basal: 6 * 60 * 60 * 1000,
  recent_bolus: 90 * 60 * 1000,
  recent_glucose: 10 * 60 * 1000,
  recent_meal: 30 * 60 * 1000,
  future_dated: 5 * 60 * 1000,
};

function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

interface NearestMatch<T> {
  ms: number;
  iso: string;
  record: T;
}

/** Smallest |entryAtMs - ms| wins; the entry being edited is excluded
 *  upstream by its id (excludeId), not by comparing timestamps here. */
function pickNearest<T>(candidates: NearestMatch<T>[], entryAtMs: number): NearestMatch<T> | null {
  let best: NearestMatch<T> | null = null;
  for (const c of candidates) {
    if (best === null || Math.abs(c.ms - entryAtMs) < Math.abs(best.ms - entryAtMs)) best = c;
  }
  return best;
}

export function checkEntryGuards(input: EntryGuardInput): EntryGuardNotice[] {
  const notices: EntryGuardNotice[] = [];
  const now = input.now;

  const parsedEntryAt = parseIso(input.entryAtIso);
  const entryAtMs = parsedEntryAt ?? now;
  /** A record is the entry being edited (not a duplicate) only when it shares
   *  the caller's excludeId. A shared instant is a coincidence, not identity -
   *  see the excludeId doc comment above. */
  const isExcluded = (id: string): boolean =>
    input.excludeId != null && id === input.excludeId;

  if (parsedEntryAt !== null && entryAtMs - now > GUARD_WINDOW_MS.future_dated) {
    notices.push({ kind: "future_dated", atIso: input.entryAtIso as string });
  }

  if (input.entryKind === "post_meal_timer") {
    const endsMs = parseIso(input.runningTimerEndsAtIso);
    if (endsMs !== null && endsMs > now) {
      notices.push({ kind: "timer_running", atIso: input.runningTimerEndsAtIso as string });
    }
  }

  if (input.entryKind === "injection" && (input.insulinType === "basal" || input.insulinType === "bolus")) {
    const windowMs = input.insulinType === "basal" ? GUARD_WINDOW_MS.recent_basal : GUARD_WINDOW_MS.recent_bolus;
    const kind: EntryGuardKind = input.insulinType === "basal" ? "recent_basal" : "recent_bolus";
    const candidates: NearestMatch<{ dose_units: number | null }>[] = [];
    for (const inj of input.recent?.injections ?? []) {
      if (inj.insulin_type !== input.insulinType) continue;
      const ms = parseIso(inj.logged_at);
      if (ms === null || isExcluded(inj.id)) continue;
      if (Math.abs(entryAtMs - ms) > windowMs) continue;
      candidates.push({ ms, iso: inj.logged_at, record: { dose_units: inj.dose_units } });
    }
    const best = pickNearest(candidates, entryAtMs);
    if (best !== null) {
      const detail = best.record.dose_units !== null ? { units: best.record.dose_units } : undefined;
      notices.push({ kind, atIso: best.iso, ...(detail ? { detail } : {}) });
    }
  }

  if (input.entryKind === "glucose") {
    const candidates: NearestMatch<{ valueText: string }>[] = [];
    for (const g of input.recent?.glucose ?? []) {
      const ms = parseIso(g.logged_at);
      if (ms === null || isExcluded(g.id)) continue;
      if (Math.abs(entryAtMs - ms) > GUARD_WINDOW_MS.recent_glucose) continue;
      candidates.push({ ms, iso: g.logged_at, record: { valueText: g.valueText } });
    }
    const best = pickNearest(candidates, entryAtMs);
    if (best !== null) {
      notices.push({ kind: "recent_glucose", atIso: best.iso, detail: { valueText: best.record.valueText } });
    }
  }

  if (input.entryKind === "meal" && input.foodKey != null) {
    const candidates: NearestMatch<{ foodName: string | null }>[] = [];
    for (const m of input.recent?.meals ?? []) {
      if (m.foodKey == null || m.foodKey !== input.foodKey) continue;
      const ms = parseIso(m.logged_at);
      if (ms === null || isExcluded(m.id)) continue;
      if (Math.abs(entryAtMs - ms) > GUARD_WINDOW_MS.recent_meal) continue;
      candidates.push({ ms, iso: m.logged_at, record: { foodName: m.foodName } });
    }
    const best = pickNearest(candidates, entryAtMs);
    if (best !== null) {
      const detail = best.record.foodName !== null ? { foodName: best.record.foodName } : undefined;
      notices.push({ kind: "recent_meal", atIso: best.iso, ...(detail ? { detail } : {}) });
    }
  }

  return notices;
}

/** Fixed headroom added on top of the widest GUARD_WINDOW_MS entry, so a
 *  future change to that window (a longer recent_basal, say) widens the DB
 *  read that feeds checkEntryGuards without a second place to remember to
 *  update. The one number here that is NOT derived from GUARD_WINDOW_MS. */
export const GUARD_QUERY_LOOKBACK_PAD_MS = 2 * 60 * 60 * 1000;

/** How far past `now`/`entryAtIso` a guard read still reaches: a backdated
 *  entry can itself be future-dated relative to some OTHER record it should
 *  still be compared against, so the read does not stop exactly at "now". */
export const GUARD_QUERY_LOOKAHEAD_MS = 60 * 60 * 1000;

/** Recomputed on every call (not cached at module load) so it always tracks
 *  the live GUARD_WINDOW_MS object, including in tests that mutate it. */
function guardQueryLookbackMs(): number {
  const widest = Math.max(...Object.values(GUARD_WINDOW_MS));
  return widest + GUARD_QUERY_LOOKBACK_PAD_MS;
}

export interface GuardQueryRange {
  sinceIso: string;
  untilIso: string;
}

/**
 * The DB read range a caller needs so checkEntryGuards never runs against a
 * half-fetched window: measured from BOTH `now` and the entry's own time (a
 * backdated entry has to reach back from ITS moment, not from now - P5a), and
 * reaching forward past both too (a future-dated entry, or a same-day one
 * close to now, still needs its neighbours). Pure and DB-free, like the rest
 * of this module: the caller runs the actual query.
 */
export function guardQueryRange(now: number, entryAtIso?: string | null): GuardQueryRange {
  const entryAtMs = parseIso(entryAtIso) ?? now;
  const sinceMs = Math.min(now, entryAtMs) - guardQueryLookbackMs();
  const untilMs = Math.max(now, entryAtMs) + GUARD_QUERY_LOOKAHEAD_MS;
  return { sinceIso: new Date(sinceMs).toISOString(), untilIso: new Date(untilMs).toISOString() };
}
