import type {
  GlucoseUnit,
  Injection,
  InjectionSite,
  Reminder,
  SitePoint,
  UserProfile,
} from "../db/types";
import { getReminder, listAllBasalReminders } from "../db/reminders";
import { getProfile, updateProfile } from "../db/profiles";
import {
  listRecentInjections,
  logInjection,
  type RecentInjection,
} from "../db/injections";
import { syncLiveData } from "./liveData";
import { logCrash } from "../analytics";
import {
  DUPLICATE_WINDOW_HOURS,
  duplicateBounds,
  pickScopedReminder,
  reminderTriggerTime,
} from "../basalWindow";

/**
 * Resolution + save logic behind app/basal-confirm.tsx (basal insulin
 * confirm flow, task card B). Kept out of the screen so the duplicate-window
 * rule and the profile-resolution rule each live in exactly one place, the
 * same split every other write path in the app (lib/db/*, lib/services/*)
 * already follows.
 */

export { DUPLICATE_WINDOW_HOURS, reminderTriggerTime };

/** How far back a basal reminder's own trigger time can sit and still be
 *  treated as "probably what a reminderId-less basal-confirm open is about"
 *  (resolveBasalReminderByTime below) - generous enough to cover an alarm
 *  the user only opens well after it rang, tight enough that yesterday's
 *  dose never gets picked up by mistake. */
export const BASAL_ALARM_LOOKBACK_HOURS = 12;

export interface BasalReminderCandidate {
  reminder: Reminder;
  profile: UserProfile;
  targetTime: Date;
}

export type ResolveBasalReminderResult =
  | { kind: "none" }
  | { kind: "single"; candidate: BasalReminderCandidate }
  | { kind: "multiple"; candidates: BasalReminderCandidate[] };

/**
 * Finds which profile's own basal reminder most plausibly just rang, purely
 * from TIME - the JS-side stand-in for a reminder id an AlarmKit alarm's
 * "Open" button cannot hand back (native gap, see app/_layout.tsx's alarm
 * consume(); hub card B3). Every ENABLED basal reminder (listAllBasalReminders)
 * is checked against its own last-past trigger (reminderTriggerTime); one
 * within BASAL_ALARM_LOOKBACK_HOURS of `now` is a candidate. A reminder whose
 * own profile has since been deleted is silently skipped (nothing to confirm
 * against). `profileId` (hub card B4) narrows the search to one profile's own
 * reminder, for a caller that already knows which profile this is about.
 */
export async function resolveBasalReminderByTime(
  now: Date = new Date(),
  profileId?: string
): Promise<ResolveBasalReminderResult> {
  const rows = await listAllBasalReminders(profileId);
  const candidates: BasalReminderCandidate[] = [];
  for (const reminder of rows) {
    if (!reminder.profile_id) continue;
    const targetTime = reminderTriggerTime(reminder.time, now);
    if (now.getTime() - targetTime.getTime() > BASAL_ALARM_LOOKBACK_HOURS * 3_600_000) continue;
    const profile = await getProfile(reminder.profile_id);
    if (!profile) continue;
    candidates.push({ reminder, profile, targetTime });
  }
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "single", candidate: candidates[0] };
  return { kind: "multiple", candidates };
}

/** One row of app/basal-confirm.tsx's "chooseProfile" picker: either a real
 *  time-matched reminder, or (hub card B4 #1) a SYNTHETIC "this profile,
 *  right now" entry - `reminder: null` - for the active profile when nothing
 *  of its own matched by time (its reminder is off, or its last trigger is
 *  outside BASAL_ALARM_LOOKBACK_HOURS). The active profile must always be
 *  pickable from its own picker, even with no reminder to point at. */
export interface BasalConfirmProfileOption {
  reminder: Reminder | null;
  profile: UserProfile;
  targetTime: Date;
}

export type ResolveBasalConfirmEntryResult =
  | { kind: "resolved"; reminderId: string | null }
  /** Time matched more than one profile's own basal reminder, and none of
   *  them is the currently active profile - app/basal-confirm.tsx shows a
   *  profile picker (basalConfirm.chooseProfile) instead of guessing. */
  | { kind: "chooseProfile"; candidates: BasalConfirmProfileOption[] };

/**
 * What app/basal-confirm.tsx resolves BEFORE calling resolveBasalConfirmContext
 * (app/_layout.tsx's alarm path uses this indirectly too - it navigates here
 * with no reminderId either, exactly the case this function exists for): a
 * given `reminderId` always wins outright (an explicit deep link, e.g. a
 * tapped notification, already knows exactly which row this is about). Only
 * a reminderId-LESS open runs the time-based search - see
 * resolveBasalReminderByTime - and there are two different shapes of that:
 *
 *  - `profileId` given (task package A's dashboard button, which always
 *    knows its own active profile): the search is SCOPED to that one
 *    profile's own basal reminder. A miss resolves straight to that profile
 *    at `now` (reminderId null, same as resolveBasalConfirmContext's own
 *    fallback) - there is only one profile in play to begin with, so
 *    "chooseProfile" never applies here.
 *  - `profileId` absent (AlarmKit's "Open" - the actual native gap this
 *    resolver exists for): searches every profile. `activeProfileId` breaks
 *    a multi-candidate tie silently - if the active profile's OWN basal
 *    reminder is among the candidates, it is used with no picker shown.
 *    Otherwise the picker is shown, and the active profile is always
 *    included in it (a synthetic "right now" entry when its own reminder
 *    did not itself match).
 */
export async function resolveBasalConfirmEntry(params: {
  reminderId?: string | null;
  profileId?: string | null;
  activeProfileId?: string | null;
  now?: Date;
}): Promise<ResolveBasalConfirmEntryResult> {
  if (params.reminderId) return { kind: "resolved", reminderId: params.reminderId };
  const now = params.now ?? new Date();

  if (params.profileId) {
    const scoped = await resolveBasalReminderByTime(now, params.profileId);
    if (scoped.kind === "none") return { kind: "resolved", reminderId: null };
    // "multiple" cannot really happen once scoped to one profile_id (a
    // profile keeps at most one basal reminder row - see
    // dedupeBasalReminderRows in lib/db/reminders.ts), but the first one
    // still resolves deterministically rather than erroring.
    const candidate = pickScopedReminder(
      scoped.kind === "single" ? scoped.candidate : scoped.candidates[0],
      now
    );
    // The dashboard card is about TODAY: a reminder whose last trigger is
    // from an earlier day must not pull the dose onto yesterday's time.
    if (!candidate) return { kind: "resolved", reminderId: null };
    return { kind: "resolved", reminderId: candidate.reminder.id };
  }

  const result = await resolveBasalReminderByTime(now);
  if (result.kind === "none") return { kind: "resolved", reminderId: null };
  if (result.kind === "single") {
    return { kind: "resolved", reminderId: result.candidate.reminder.id };
  }
  const activeMatch = params.activeProfileId
    ? result.candidates.find((c) => c.profile.id === params.activeProfileId)
    : undefined;
  if (activeMatch) return { kind: "resolved", reminderId: activeMatch.reminder.id };

  let candidates: BasalConfirmProfileOption[] = result.candidates;
  if (params.activeProfileId) {
    const activeProfile = await getProfile(params.activeProfileId);
    if (activeProfile) {
      candidates = [...candidates, { reminder: null, profile: activeProfile, targetTime: now }];
    }
  }
  return { kind: "chooseProfile", candidates };
}

export interface BasalConfirmContext {
  profile: UserProfile;
  /** The reminder this confirm is about, or null when opened with no
   *  reminderId (a direct "I did it" entry point, no specific reminder). */
  reminder: Reminder | null;
  targetTime: Date;
}

/**
 * Resolves which profile and target time a basal-confirm open is about. A
 * `reminderId` OWNS the resolution through its own profile_id - never the
 * currently-active profile - so confirming a reminder that fired for a
 * profile the user has since switched away from still lands on the right
 * profile's log. `fallbackProfileId` (the screen's own active profile) is
 * used only when there is NO reminderId, or the reminder row itself no
 * longer exists (both read as "nothing to own the resolution", so the
 * active profile is the honest fallback). If the reminder still exists but
 * its OWN profile_id names a profile that has since been deleted, this does
 * NOT fall back to a different profile's log - it resolves to null (the
 * screen's error state, app/basal-confirm.tsx's "loadError"), since silently
 * writing that reminder's confirmation against a different profile would be
 * worse than surfacing nothing.
 */
export async function resolveBasalConfirmContext(params: {
  reminderId?: string | null;
  fallbackProfileId?: string | null;
}): Promise<BasalConfirmContext | null> {
  const reminder = params.reminderId ? await getReminder(params.reminderId) : null;
  const profileId = reminder?.profile_id ?? params.fallbackProfileId ?? null;
  if (!profileId) return null;
  const profile = await getProfile(profileId);
  if (!profile) return null;
  const targetTime = reminder ? reminderTriggerTime(reminder.time) : new Date();
  return { profile, reminder, targetTime };
}

/** The existing basal row (if any) within DUPLICATE_WINDOW_HOURS of
 *  `targetTime`, nearest first. `sameDayOnly` (dashboard entry) clips the
 *  window to the target's own day, so yesterday's late dose does not block
 *  today's. */
export async function findDuplicateBasalInjection(
  profileId: string,
  targetTime: Date,
  opts: { sameDayOnly?: boolean } = {}
): Promise<RecentInjection | null> {
  const bounds = duplicateBounds(targetTime, opts);
  const since = new Date(bounds.sinceMs).toISOString();
  const until = new Date(bounds.untilMs).toISOString();
  const rows = (await listRecentInjections(profileId, since, until)).filter(
    (r) => r.insulin_type === "basal"
  );
  if (rows.length === 0) return null;
  const targetMs = targetTime.getTime();
  return rows.reduce((closest, row) =>
    Math.abs(new Date(row.logged_at).getTime() - targetMs) <
    Math.abs(new Date(closest.logged_at).getTime() - targetMs)
      ? row
      : closest
  );
}

export interface SaveBasalConfirmationInput {
  profileId: string;
  doseUnits: number;
  site: InjectionSite | null;
  sitePoint: SitePoint | null;
  loggedAt: Date;
  glucoseUnit: GlucoseUnit;
  /** The profile's CURRENT basal_daily_units, so a first-time dose can seed
   *  it without a second profile read inside this function. */
  currentBasalDailyUnits: number | null;
  /** Dashboard entry: the duplicate check only looks at the saved time's own day. */
  duplicateSameDayOnly?: boolean;
}

export type SaveBasalConfirmationResult =
  | { kind: "saved"; injection: Injection }
  /** doseUnits was not > 0 - a basal confirm always records an actual dose
   *  (hub card B4 #2); the UI's own Save button is already disabled for
   *  this, so this is the service-side backstop, not the primary gate. */
  | { kind: "invalidDose" }
  /** The time the user actually saves against (editable on the site step)
   *  already has a basal row within DUPLICATE_WINDOW_HOURS - caught here too,
   *  not just at screen-open, because the user can change `loggedAt` AFTER
   *  the initial (open-time) check already cleared it. Nothing is written;
   *  the caller (app/basal-confirm.tsx) switches to the same "duplicate"
   *  state the open-time check produces. */
  | { kind: "duplicate"; existing: RecentInjection };

/**
 * Logs the confirmed basal dose (source: 'reminder' - Injection.source is a
 * plain string column, see lib/db/types.ts, so this needs no schema change),
 * backfills the profile's own basal_daily_units the first time a dose is
 * entered, and re-syncs the widget/watch snapshot - the same steps every
 * other injection write path in the app takes, gathered here so the screen
 * stays thin.
 */
export async function saveBasalConfirmation(
  input: SaveBasalConfirmationInput
): Promise<SaveBasalConfirmationResult> {
  if (!(input.doseUnits > 0)) return { kind: "invalidDose" };

  const existing = await findDuplicateBasalInjection(input.profileId, input.loggedAt, {
    sameDayOnly: input.duplicateSameDayOnly,
  });
  if (existing) return { kind: "duplicate", existing };

  const injection = await logInjection({
    profile_id: input.profileId,
    insulin_type: "basal",
    dose_units: input.doseUnits,
    site: input.site,
    site_point: input.site ? input.sitePoint : null,
    logged_at: input.loggedAt.toISOString(),
    source: "reminder",
  });
  if (!input.currentBasalDailyUnits) {
    // Best-effort: the injection is already logged and stays logged even if
    // this optional backfill fails (a transient DB error must never turn an
    // already-successful save into an apparent failure the user is asked to
    // retry, which would risk a duplicate row).
    try {
      await updateProfile(input.profileId, { basal_daily_units: input.doseUnits });
    } catch (err) {
      logCrash(err, { screen: "basalConfirm", step: "backfillBasalDailyUnits" });
    }
  }
  void syncLiveData(input.profileId, input.glucoseUnit);
  return { kind: "saved", injection };
}
