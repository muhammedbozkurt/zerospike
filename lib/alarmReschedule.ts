/**
 * Idempotent re-arming of the one-occurrence AlarmKit alarms, plus the two
 * clean-up sweeps (alarms and Live Activities the app no longer has a record
 * for). Pure and dependency-free: every effect goes through the ports the
 * caller injects (lib/services/notifications.ts wires the real AlarmKit
 * module), so scripts/alarmReschedule.test.ts exercises it with fakes under
 * plain Node.
 *
 * The identity of an alarm is the caller's "zerospike-alarm-<reminderId>"
 * string, which is derived from the reminder row, so no column is needed to
 * pair a row with its alarm. What IS remembered between runs is the plan: for
 * each id, the moment it was armed for and a signature of everything shown on
 * the alarm screen. Comparing against it is what makes a repeat run a no-op.
 */
import type { AlarmRoute } from "../modules/zerospike-alarmkit";

/** How long after its fire moment an alarm may still be ringing on the lock
 *  screen. Re-arming reuses the SAME system identity (cancel, then schedule),
 *  and cancelling a ringing alarm silences it, so a pass that cannot be a
 *  user's own action must leave a just-fired alarm alone. */
export const ALARM_RING_GUARD_MS = 10 * 60 * 1000;

export interface PlannedAlarm {
  id: string;
  atMs: number;
  label: string;
  stopLabel: string;
  openLabel: string;
  route: AlarmRoute;
}

export interface AlarmPlanEntry {
  atMs: number;
  sig: string;
}
export type AlarmPlan = Record<string, AlarmPlanEntry>;

export interface AlarmPorts {
  /** AlarmKit exists on this device (iOS 26+ with the native module linked).
   *  False on Android and on iOS < 26: no port below is ever called then. */
  present(): boolean;
  /** present() AND the user granted the AlarmKit permission: the only state in
   *  which a new alarm can be armed. Cancelling needs no permission. */
  authorized(): boolean;
  /** Identity strings AlarmKit currently holds an alarm for. */
  listIds(): string[];
  /** Cancel-then-schedule under the same id (the native contract). */
  schedule(alarm: PlannedAlarm): Promise<boolean>;
  cancel(id: string): Promise<void>;
  /** Cancels every system alarm outside `keepIds`, including ones the native
   *  identity map never knew about. Returns null when the installed binary has
   *  no such call, so the caller falls back to listIds/cancel. */
  cancelUnowned?(keepIds: string[]): Promise<number | null>;
  loadPlan(): Promise<AlarmPlan>;
  savePlan(plan: AlarmPlan): Promise<void>;
  now(): number;
}

export type AlarmEnsureResult =
  /** Armed (or re-armed) just now. */
  | "armed"
  /** Already armed for exactly this occurrence: no native call was made. */
  | "kept"
  /** Left alone because it may be ringing right now (background passes only). */
  | "deferred"
  /** Could not be armed; the caller falls back to a notification. */
  | "failed";

export function alarmSignature(a: PlannedAlarm): string {
  return JSON.stringify([a.atMs, a.label, a.stopLabel, a.openLabel, a.route]);
}

export interface AlarmSession {
  ensure(
    alarm: PlannedAlarm,
    opts?: { protectRinging?: boolean }
  ): Promise<AlarmEnsureResult>;
  cancel(id: string): Promise<void>;
  /** Cancels every alarm outside `keepIds` and forgets their plan entries.
   *  Returns the ids it took down (best effort for the unmapped ones). */
  sweep(keepIds: readonly string[]): Promise<string[]>;
  /** Writes the plan back, only when something changed. */
  commit(): Promise<void>;
}

export async function openAlarmSession(ports: AlarmPorts): Promise<AlarmSession> {
  let plan: AlarmPlan = {};
  try {
    plan = (await ports.loadPlan()) ?? {};
  } catch {
    plan = {};
  }
  const live = new Set(ports.present() ? ports.listIds() : []);
  let dirty = false;

  return {
    async ensure(alarm, opts) {
      if (!ports.authorized()) return "failed";
      const now = ports.now();
      const sig = alarmSignature(alarm);
      const entry = plan[alarm.id];
      const isLive = live.has(alarm.id);

      if (entry && isLive && entry.sig === sig && entry.atMs > now) return "kept";

      if (
        opts?.protectRinging &&
        entry &&
        isLive &&
        entry.atMs <= now &&
        now - entry.atMs < ALARM_RING_GUARD_MS
      ) {
        return "deferred";
      }

      const ok = await ports.schedule(alarm);
      if (ok) {
        plan[alarm.id] = { atMs: alarm.atMs, sig };
        live.add(alarm.id);
        dirty = true;
        return "armed";
      }
      if (entry) {
        delete plan[alarm.id];
        dirty = true;
      }
      live.delete(alarm.id);
      return "failed";
    },

    async cancel(id) {
      if (ports.present() && (live.has(id) || plan[id])) {
        await ports.cancel(id);
      }
      live.delete(id);
      if (plan[id]) {
        delete plan[id];
        dirty = true;
      }
    },

    async sweep(keepIds) {
      if (!ports.present()) return [];
      const keep = new Set(keepIds);
      const cancelled: string[] = [];

      let handledNatively = false;
      if (ports.cancelUnowned) {
        const n = await ports.cancelUnowned([...keep]);
        handledNatively = n !== null;
      }
      for (const id of [...live]) {
        if (keep.has(id)) continue;
        if (!handledNatively) await ports.cancel(id);
        live.delete(id);
        cancelled.push(id);
      }
      for (const id of Object.keys(plan)) {
        if (keep.has(id)) continue;
        delete plan[id];
        dirty = true;
      }
      return cancelled;
    },

    async commit() {
      if (!dirty) return;
      dirty = false;
      try {
        await ports.savePlan(plan);
      } catch {
        // best-effort: a lost plan only costs one redundant re-arm next pass
      }
    },
  };
}

/**
 * Whether the post-meal alarm still belongs to a countdown. True while a
 * stored end exists and is not older than the ring guard; an unreadable value
 * counts as "yes" so an uncertain read never takes a working timer down.
 */
export function postMealAlarmStillOwned(
  storedEnd: string | null | undefined,
  readFailed: boolean,
  now: number
): boolean {
  if (readFailed) return true;
  if (!storedEnd) return false;
  const end = parseInt(storedEnd, 10);
  if (!Number.isFinite(end)) return false;
  return end + ALARM_RING_GUARD_MS > now;
}

/** Cancel the post-meal alarm after its countdown finished only once it can no
 *  longer be ringing (see ALARM_RING_GUARD_MS). An UNKNOWN end never cancels:
 *  several readers race to clear a finished timer, and the second one finds the
 *  stored end already gone while the alarm may still be sounding. A stale alarm
 *  left that way is collected by the launch sweep (applyReminders), which no
 *  longer keeps it once the stored end is older than the guard. */
export function shouldCancelPostMealAlarmAfterEnd(
  endedAtMs: number | null,
  now: number
): boolean {
  if (endedAtMs == null || !Number.isFinite(endedAtMs)) return false;
  return now - endedAtMs >= ALARM_RING_GUARD_MS;
}

export interface FinishPostMealPorts {
  cancelAlarm(): Promise<void>;
  endActivity(): Promise<void>;
}

/** The countdown reached its end (or was cleared): the Live Activity always
 *  comes down, the alarm too unless it may be ringing right now. Safe to call
 *  any number of times. */
export async function finishPostMealCountdown(
  endedAtMs: number | null,
  now: number,
  ports: FinishPostMealPorts
): Promise<{ alarmCancelled: boolean }> {
  let alarmCancelled = false;
  if (shouldCancelPostMealAlarmAfterEnd(endedAtMs, now)) {
    await ports.cancelAlarm();
    alarmCancelled = true;
  }
  await ports.endActivity();
  return { alarmCancelled };
}

export interface ActivityPorts {
  /** null when the installed binary cannot list activities. */
  listIds(): string[] | null;
  endAllExcept(keepIds: string[]): Promise<number>;
}

/**
 * Ends Live Activities the app has no countdown for. With no running
 * countdown every activity is orphaned; with one, a single activity is kept
 * (the first, the one start/update act on) and any duplicate goes.
 */
export async function sweepOrphanActivities(
  countdownRunning: boolean,
  ports: ActivityPorts
): Promise<number> {
  const ids = ports.listIds();
  if (ids === null || ids.length === 0) return 0;
  const keep = countdownRunning ? [ids[0]] : [];
  return ports.endAllExcept(keep);
}
