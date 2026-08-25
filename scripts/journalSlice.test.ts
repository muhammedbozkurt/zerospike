/**
 * lib/journalSlice.ts correctness harness. No jest, same standalone style as
 * scripts/alarmSelect.test.ts.
 *
 * The property under test: how much of the feed one slice reveals, for the two
 * callers that now exist. The dashboard shows a PREVIEW (the last couple of
 * days, at most a screenful) and hands off to app/journal.tsx; the journal
 * screen pages through the whole history. Getting the boundary wrong on the
 * dashboard is what the split exists to prevent - a list that keeps growing
 * inside a page that is already scrolling.
 *
 * Run: npx tsx scripts/journalSlice.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  JOURNAL_PAGE_LIMITS,
  JOURNAL_PREVIEW_LIMITS,
  journalDayKey,
  nextJournalCut,
  type JournalSliceRow,
} from "../lib/journalSlice";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike journal slice test");

/** A feed row `dayOffset` days back, at `hour` local time. Newest first is the
 *  caller's job, so the helpers below build in that order. */
function row(dayOffset: number, hour = 12): JournalSliceRow {
  const d = new Date(2026, 7, 20, hour, 0, 0);
  d.setDate(d.getDate() - dayOffset);
  return { logged_at: d.toISOString() };
}

/** `perDay` rows on each of `days` consecutive days, newest first. */
function feed(days: number, perDay: number): JournalSliceRow[] {
  const out: JournalSliceRow[] = [];
  for (let d = 0; d < days; d++) {
    for (let n = 0; n < perDay; n++) out.push(row(d, 20 - n));
  }
  return out;
}

section("A. the preview stops at two DAYS");
{
  const list = feed(10, 3);
  const cut = nextJournalCut(list, 0, JOURNAL_PREVIEW_LIMITS);
  eq("three rows a day, two days = six", cut, 6);
  eq("and the seventh row is a third day", journalDayKey(list[6].logged_at), journalDayKey(row(2).logged_at));
  // The day boundary, not a rolling 48 hours: a row late on day 0 and one early
  // on day 1 are two days even though they are hours apart.
  const tight = [row(0, 1), row(1, 23), row(2, 23)];
  eq("late/early rows still count as their own days", nextJournalCut(tight, 0, JOURNAL_PREVIEW_LIMITS), 2);
}

section("B. the preview stops at fifteen ROWS when the days are busy");
{
  const list = feed(2, 40);
  eq("two very busy days are cut at 15", nextJournalCut(list, 0, JOURNAL_PREVIEW_LIMITS), 15);
  eq("the cap is fifteen", JOURNAL_PREVIEW_LIMITS.maxEntries, 15);
  eq("and the day limit is two", JOURNAL_PREVIEW_LIMITS.maxDays, 2);
  // Exactly on the cap: 15 rows across two days is all of them, not 14.
  const exact = [...feed(1, 8), ...feed(1, 7).map(() => row(1))];
  eq("exactly fifteen rows are all taken", nextJournalCut(exact, 0, JOURNAL_PREVIEW_LIMITS), 15);
}

section("C. whichever limit fills FIRST ends the slice");
{
  // Quiet days: the DAY limit bites before the row cap.
  eq("2 quiet days -> 4 rows", nextJournalCut(feed(5, 2), 0, JOURNAL_PREVIEW_LIMITS), 4);
  // Busy days: the ROW cap bites before the day limit.
  eq("2 busy days -> 15 rows", nextJournalCut(feed(5, 20), 0, JOURNAL_PREVIEW_LIMITS), 15);
  // Right at the crossover: 7 rows a day means day 2 ends it at 14.
  eq("7 a day -> the day limit wins at 14", nextJournalCut(feed(5, 7), 0, JOURNAL_PREVIEW_LIMITS), 14);
  // 8 a day means the row cap wins at 15, one row into the second day's eighth.
  eq("8 a day -> the row cap wins at 15", nextJournalCut(feed(5, 8), 0, JOURNAL_PREVIEW_LIMITS), 15);
}

section("D. short and empty feeds");
{
  eq("an empty feed cuts at 0", nextJournalCut([], 0, JOURNAL_PREVIEW_LIMITS), 0);
  eq("one row", nextJournalCut([row(0)], 0, JOURNAL_PREVIEW_LIMITS), 1);
  eq("a single day of three", nextJournalCut(feed(1, 3), 0, JOURNAL_PREVIEW_LIMITS), 3);
  // Fewer rows than either limit: everything, and no phantom extra.
  eq("two days of two", nextJournalCut(feed(2, 2), 0, JOURNAL_PREVIEW_LIMITS), 4);
  // Past the end is a no-op rather than a negative or a throw.
  eq("from past the end", nextJournalCut(feed(2, 2), 99, JOURNAL_PREVIEW_LIMITS), 99);
}

section("E. a slice ALWAYS advances, so paging can never stall");
{
  // A single row that on its own would open one day too many still advances by
  // one: otherwise "show more" would sit there doing nothing forever.
  const sparse = [row(0), row(5), row(10), row(20), row(40)];
  let cut = 0;
  const seen: number[] = [];
  for (let i = 0; i < 10 && cut < sparse.length; i++) {
    const next = nextJournalCut(sparse, cut, JOURNAL_PREVIEW_LIMITS);
    ok(`slice ${i} advances`, next > cut, `${cut} -> ${next}`);
    seen.push(next - cut);
    cut = next;
  }
  eq("the whole sparse feed is reachable", cut, sparse.length);
  // Even with absurd limits, one row at a time still moves.
  eq(
    "zero-day limit still advances",
    nextJournalCut(sparse, 0, { maxEntries: 10, maxDays: 0 }),
    1
  );
  eq(
    "zero-row limit still advances",
    nextJournalCut(sparse, 0, { maxEntries: 0, maxDays: 10 }),
    1
  );
}

section("F. paging from a non-zero start (the full journal screen)");
{
  const list = feed(30, 3);
  const first = nextJournalCut(list, 0, JOURNAL_PAGE_LIMITS);
  eq("the first page is 14 days of 3", first, 42);
  const second = nextJournalCut(list, first, JOURNAL_PAGE_LIMITS);
  eq("the second page picks up where it left off", second, 84);
  // Each page's day window is anchored on its OWN newest row, not on "now" -
  // which is what lets a user who stopped logging for a month still open on a
  // full page of records instead of an empty list with a button under it.
  const gap = [...feed(2, 1), ...Array.from({ length: 5 }, (_, i) => row(60 + i))];
  const afterGap = nextJournalCut(gap, 2, JOURNAL_PAGE_LIMITS);
  eq("a month-long gap does not empty the next page", afterGap, gap.length);
}

section("G. the two limit sets are what each screen advertises");
{
  eq("full page rows", JOURNAL_PAGE_LIMITS.maxEntries, 50);
  eq("full page days", JOURNAL_PAGE_LIMITS.maxDays, 14);
  ok(
    "the preview is strictly smaller than a full page",
    JOURNAL_PREVIEW_LIMITS.maxEntries < JOURNAL_PAGE_LIMITS.maxEntries &&
      JOURNAL_PREVIEW_LIMITS.maxDays < JOURNAL_PAGE_LIMITS.maxDays
  );
}

section("H. journalDayKey is a local, sortable calendar day");
{
  const d = new Date(2026, 0, 5, 23, 30);
  eq("zero-padded", journalDayKey(d.toISOString()), "2026-01-05");
  eq(
    "two times on the same local day share a key",
    journalDayKey(new Date(2026, 0, 5, 0, 1).toISOString()),
    journalDayKey(new Date(2026, 0, 5, 23, 59).toISOString())
  );
  ok(
    "a minute later, across midnight, does not",
    journalDayKey(new Date(2026, 0, 5, 23, 59).toISOString()) !==
      journalDayKey(new Date(2026, 0, 6, 0, 0).toISOString())
  );
  eq("garbage never throws", journalDayKey("not a date"), "");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
