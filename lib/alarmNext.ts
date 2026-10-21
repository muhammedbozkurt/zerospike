/**
 * The next moment a reminder should ring, kept pure (no clock of its own, no
 * native calls) so scripts/alarmReschedule.test.ts can pin it under plain Node.
 *
 * AlarmKit alarms are armed ONE occurrence at a time (a fixed date, no
 * repeat rule): a repeating system alarm outlives the reminder record that
 * owns it, so an alarm could keep ringing after the row, the profile or the
 * whole app data was gone. The cost is that every occurrence has to be
 * re-armed by the app (see lib/alarmReschedule.ts), and this function is where
 * "which occurrence" is decided.
 */
export interface NextAlarmSource {
  /** "HH:MM", the format lib/db/reminders.ts stores. */
  time: string;
  /** reminders.enabled (0 | 1). Omitted means enabled. */
  enabled?: number | boolean;
  /** Weekdays it rings on, 0 = Sunday ... 6 = Saturday (Date#getDay). Omitted
   *  or null means every day, which is all a reminder row carries today; an
   *  empty list means no active day at all. */
  days?: readonly number[] | null;
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** The wall-clock time as numbers, or null for anything that is not a real
 *  time of day. */
export function parseAlarmTime(time: string): { hour: number; minute: number } | null {
  const m = TIME_RE.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * The first moment STRICTLY after `now` at which `reminder` rings, in the
 * device's local time zone, or null when it never does (disabled, no active
 * day, or an unreadable time).
 *
 * Built with the local-calendar Date constructor for every candidate day, so a
 * daylight-saving change moves the offset but never the wall-clock time: 08:00
 * stays 08:00 on both sides of the switch. A wall-clock time that does not
 * exist that day (the spring-forward gap) is normalized forward by the
 * platform, the same way the OS notification trigger treats it.
 */
export function nextAlarmDate(
  reminder: NextAlarmSource,
  now: Date | number
): Date | null {
  if (reminder.enabled !== undefined && !reminder.enabled) return null;
  const at = parseAlarmTime(reminder.time);
  if (!at) return null;

  let weekdays: Set<number> | null = null;
  if (reminder.days != null) {
    weekdays = new Set(
      reminder.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    );
    if (weekdays.size === 0) return null;
  }

  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  const base = new Date(nowMs);

  // 8 candidate days cover "today" through the same weekday next week, so any
  // non-empty weekday set is guaranteed a hit.
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + offset,
      at.hour,
      at.minute,
      0,
      0
    );
    if (candidate.getTime() <= nowMs) continue;
    if (weekdays && !weekdays.has(candidate.getDay())) continue;
    return candidate;
  }
  return null;
}
