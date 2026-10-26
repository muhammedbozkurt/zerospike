/**
 * G11: the dashboard basal card (profileId, no reminderId) must be about
 * TODAY. Reminder 22:00, yesterday's 22:10 basal row, now 09:00: the card
 * must target "now" with no duplicate from yesterday's row, so today's dose
 * can be entered and is written to today.
 *
 * G27: the saved-confirmation toast exists in all 9 languages and names the
 * profile.
 *
 * Run: npx sucrase-node scripts/basalDashboardEntry.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  pickScopedReminder,
  duplicateBounds,
  isSameLocalDay,
  reminderTriggerTime,
} from "../lib/basalWindow";
import en from "../lib/i18n/locales/en";
import tr from "../lib/i18n/locales/tr";
import de from "../lib/i18n/locales/de";
import fr from "../lib/i18n/locales/fr";
import es from "../lib/i18n/locales/es";
import it from "../lib/i18n/locales/it";
import pt from "../lib/i18n/locales/pt";
import ar from "../lib/i18n/locales/ar";
import ja from "../lib/i18n/locales/ja";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}

const at = (dayOffset: number, h: number, m: number, base: Date): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
};

function insideWindow(row: Date, b: { sinceMs: number; untilMs: number }): boolean {
  return row.getTime() >= b.sinceMs && row.getTime() <= b.untilMs;
}

// Same selection the service makes: an accepted reminder keeps its trigger
// time, a rejected one falls back to "now" (resolveBasalConfirmContext).
function scopedTarget(raw: Date, now: Date): Date {
  const picked = pickScopedReminder({ targetTime: raw }, now);
  return picked ? picked.targetTime : new Date(now);
}

const base = new Date(2026, 9, 27, 12, 0, 0, 0);

// G11 morning scenario
{
  const now = at(0, 9, 0, base);
  const yesterdayRow = at(-1, 22, 10, base);
  const raw = reminderTriggerTime("22:00", now);
  ok("G11 setup: the raw reminder trigger is yesterday 22:00", !isSameLocalDay(raw, now));

  const target = scopedTarget(raw, now);
  ok("G11 dashboard target is today, not yesterday's reminder time", isSameLocalDay(target, now));
  ok("G11 dashboard target is the current moment", target.getTime() === now.getTime());

  const b = duplicateBounds(target, { sameDayOnly: true });
  ok("G11 yesterday 22:10 row is not a duplicate of the morning card", !insideWindow(yesterdayRow, b));
}

// reminder earlier today stays the target
{
  const now = at(0, 9, 0, base);
  const raw = reminderTriggerTime("07:30", now);
  const target = scopedTarget(raw, now);
  ok("G11 a reminder that already rang today keeps its own time", target.getTime() === raw.getTime());
}

// just after midnight: yesterday's late dose must not block today's entry
{
  const now = at(0, 0, 30, base);
  const raw = reminderTriggerTime("22:00", now);
  const target = scopedTarget(raw, now);
  ok("G11 00:30 target is today", isSameLocalDay(target, now));
  const row = at(-1, 22, 10, base);
  const b = duplicateBounds(target, { sameDayOnly: true });
  ok("G11 00:30: yesterday 22:10 row is outside the today-only window", !insideWindow(row, b));
  const todayRow = at(0, 0, 10, base);
  ok("G11 00:30: a row from 00:10 today still counts as a duplicate", insideWindow(todayRow, b));
}

// reminder-driven open (no sameDayOnly) keeps the 3 h window both ways
{
  const now = at(0, 0, 30, base);
  const raw = reminderTriggerTime("22:00", now);
  const b = duplicateBounds(raw);
  ok("G11 reminder open keeps its +-3 h window", insideWindow(at(-1, 22, 10, base), b));
}

// G27
const dicts: Record<string, any> = { en, tr, de, fr, es, it, pt, ar, ja };
for (const [lang, d] of Object.entries(dicts)) {
  const s = d.basalConfirm?.saved;
  ok(`G27 ${lang} basalConfirm.saved exists`, typeof s === "string" && s.length > 0);
  ok(`G27 ${lang} basalConfirm.saved names the profile`, typeof s === "string" && s.includes("{{name}}"));
  ok(`G27 ${lang} basalConfirm.saved has no em-dash`, typeof s === "string" && !s.includes("—"));
}

if (failed > 0) {
  console.log(`basalDashboardEntry: ${failed} FAIL`);
  process.exit(1);
}
console.log("basalDashboardEntry: all passed");
