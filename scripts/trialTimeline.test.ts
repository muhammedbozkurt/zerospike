/**
 * lib/trialTimeline.ts correctness harness: the paywall's trial timeline, the
 * ending-reminder lead and delivery gate, the 24-hour Health nudge gate and the
 * personal line, plus two runs against the real code: the personal read against
 * an in-memory SQLite (node:sqlite), and the reminder title through i18next in
 * all nine languages. No jest, same standalone style as scripts/downsell.test.ts.
 *
 * Run: npx tsx scripts/trialTimeline.test.ts, or compile with tsc and run with node:
 *
 *   npx tsc scripts/trialTimeline.test.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir <tmp> --module commonjs --target es2019 --moduleResolution node \
 *     --skipLibCheck --esModuleInterop \
 *   && node <tmp>/scripts/trialTimeline.test.js
 *
 * Run it from the repo root (the wiring checks at the end read source files).
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import {
  DEFAULT_TRIAL_DAYS,
  PERSONAL_MIN_READINGS,
  PERSONAL_WINDOW_DAYS,
  TRIAL_NUDGE_DELAY_MS,
  TRIAL_REMINDER_LEAD_DAYS,
  buildTrialTimeline,
  perMonthPrice,
  personalSummary,
  shouldScheduleTrialNudge,
  trialReminderArmed,
  trialReminderDeliverable,
  trialReminderFireAt,
  trialReminderFireInDays,
} from "../lib/trialTimeline";
import { rangeFromWindow } from "../lib/insights";
import type { SugarLog } from "../lib/db/types";
// Type-only: makes tsc compile lib/db/logs.ts next to this file; it is loaded
// further down, once the database it talks to has been swapped for an in-memory one.
import type * as LogsApi from "../lib/db/logs";

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
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 6, 12, 0, 0).getTime();

console.log("zerospike trialTimeline test");

section("A. constants match the spec");
{
  eq("reminder lead is 2 days", TRIAL_REMINDER_LEAD_DAYS, 2);
  eq("nudge delay is 24 hours", TRIAL_NUDGE_DELAY_MS, DAY);
  eq("personal window is 14 days", PERSONAL_WINDOW_DAYS, 14);
  eq("personal line needs 3 readings", PERSONAL_MIN_READINGS, 3);
  eq("default trial length", DEFAULT_TRIAL_DAYS, 7);
}

section("B. 7-day trial: today, N-2 reminder, N charge");
{
  eq("rows", buildTrialTimeline(7), [
    { kind: "today", day: 0 },
    { kind: "reminder", day: 5 },
    { kind: "charge", day: 7 },
  ]);
}

section("C. other lengths");
{
  eq("14 days: reminder on day 12", buildTrialTimeline(14), [
    { kind: "today", day: 0 },
    { kind: "reminder", day: 12 },
    { kind: "charge", day: 14 },
  ]);
  eq("3 days: reminder on day 1", buildTrialTimeline(3), [
    { kind: "today", day: 0 },
    { kind: "reminder", day: 1 },
    { kind: "charge", day: 3 },
  ]);
  eq("2 days: too short for a reminder, two rows", buildTrialTimeline(2), [
    { kind: "today", day: 0 },
    { kind: "charge", day: 2 },
  ]);
  eq("1 day: two rows", buildTrialTimeline(1), [
    { kind: "today", day: 0 },
    { kind: "charge", day: 1 },
  ]);
}

section("D. the reminder row and the scheduler agree");
{
  for (const n of [1, 2, 3, 4, 7, 14, 30]) {
    const row = buildTrialTimeline(n).find((r) => r.kind === "reminder");
    eq(`n=${n} reminder row present iff armed`, row !== undefined, trialReminderArmed(n));
    if (row) eq(`n=${n} row day equals the fire delay`, row.day, trialReminderFireInDays(n));
  }
  ok("2-day trial arms nothing", !trialReminderArmed(2));
  ok("1-day trial arms nothing", !trialReminderArmed(1));
  ok("0-day trial arms nothing", !trialReminderArmed(0));
  ok("garbage length arms nothing", !trialReminderArmed(Number.NaN));
  eq("7-day trial fires after 5 days", trialReminderFireInDays(7), 5);
}

section("E. a missing or broken length falls back to the default for display");
{
  const last = (n: number) => buildTrialTimeline(n)[buildTrialTimeline(n).length - 1];
  eq("NaN", last(Number.NaN), { kind: "charge", day: DEFAULT_TRIAL_DAYS });
  eq("zero", last(0), { kind: "charge", day: DEFAULT_TRIAL_DAYS });
  eq("negative", last(-3), { kind: "charge", day: DEFAULT_TRIAL_DAYS });
  eq("fraction rounds down", last(7.9), { kind: "charge", day: 7 });
}

section("F. monthly equivalent");
{
  ok("29.99 / 12", Math.abs((perMonthPrice(29.99) as number) - 29.99 / 12) < 1e-9);
  eq("zero price", perMonthPrice(0), null);
  eq("negative price", perMonthPrice(-1), null);
  eq("null price", perMonthPrice(null), null);
  eq("undefined price", perMonthPrice(undefined), null);
  eq("NaN price", perMonthPrice(Number.NaN), null);
}

section("G0. the reminder follows the trial's real end");
{
  const endsAt = Date.UTC(2026, 9, 13, 8, 30, 0);
  eq("fires the lead days before the end", trialReminderFireAt(endsAt), endsAt - TRIAL_REMINDER_LEAD_DAYS * DAY);
  eq("a 7-day trial that ends on the 13th reminds on the 11th", new Date(trialReminderFireAt(endsAt)).toISOString(), "2026-10-11T08:30:00.000Z");
  ok("a garbage end gives no usable moment", Number.isNaN(trialReminderFireAt(Number.NaN)));

  const perm = (permission: "granted" | "denied" | "deniedPermanently" | "undetermined" | "unavailable", notificationsEnabled = true) =>
    trialReminderDeliverable({ notificationsEnabled, permission });
  ok("granted and switched on", perm("granted"));
  ok("never asked: the purchase raises the prompt", perm("undetermined"));
  ok("refused with a retry left (Android): still askable", perm("denied"));
  ok("refused for good: nothing can be delivered", !perm("deniedPermanently"));
  ok("an unreadable state promises nothing", !perm("unavailable"));
  ok("the app's own switch off wins over a granted permission", !perm("granted", false));
  ok("and over an askable one", !perm("undetermined", false));

  const kinds = (rows: { kind: string }[]) => rows.map((r) => r.kind);
  eq("reminder deliverable: three rows", kinds(buildTrialTimeline(7, true)), ["today", "reminder", "charge"]);
  eq("not deliverable: the reminder row is dropped", kinds(buildTrialTimeline(7, false)), ["today", "charge"]);
  eq("the default still promises it", kinds(buildTrialTimeline(7)), ["today", "reminder", "charge"]);
  eq("a trial too short stays two rows either way", kinds(buildTrialTimeline(2, true)), ["today", "charge"]);
}

section("G. Health nudge gate");
{
  const base = { trialDays: 7, healthAvailable: true, healthConnected: false };
  ok("7-day trial, Health usable and not connected", shouldScheduleTrialNudge(base));
  ok("already connected", !shouldScheduleTrialNudge({ ...base, healthConnected: true }));
  ok("Health not available on this device", !shouldScheduleTrialNudge({ ...base, healthAvailable: false }));
  ok("2-day trial still fits a 24 hour nudge", shouldScheduleTrialNudge({ ...base, trialDays: 2 }));
  ok("1-day trial would land at the very end", !shouldScheduleTrialNudge({ ...base, trialDays: 1 }));
  ok("garbage length", !shouldScheduleTrialNudge({ ...base, trialDays: Number.NaN }));
}

function log(daysAgo: number, mgdl: number, source = "manual", hoursExtra = 0): SugarLog {
  const at = new Date(NOW - daysAgo * DAY - hoursExtra * 3600_000).toISOString();
  return {
    id: `l-${daysAgo}-${mgdl}-${source}-${hoursExtra}`,
    profile_id: "p1",
    glucose_level_mgdl: mgdl,
    period_tag: "fasting",
    source,
    logged_at: at,
    tags: [],
    healthkit_uuid: null,
  };
}
const BAND = { low: 70, high: 180 };

section("H. personal line");
{
  eq("no readings", personalSummary([], BAND, NOW), null);
  eq("two readings are not enough", personalSummary([log(1, 100), log(2, 120)], BAND, NOW), null);

  const three = personalSummary([log(1, 100), log(2, 120), log(3, 140)], BAND, NOW);
  ok("three readings produce a summary", three !== null);
  eq("count", three?.readings, 3);
  eq("average", three?.avgMgdl, 120);
  eq("all in range", three?.inRangePct, 100);

  const mixed = personalSummary(
    [log(1, 60), log(2, 100), log(3, 200), log(4, 120)],
    BAND,
    NOW
  );
  eq("four readings counted", mixed?.readings, 4);
  eq("mixed average", mixed?.avgMgdl, 120);
  eq("two of four in range", mixed?.inRangePct, 50);

  const withOld = personalSummary(
    [log(1, 100), log(2, 120), log(20, 300), log(30, 300)],
    BAND,
    NOW
  );
  eq("readings older than 14 days are ignored (only two left)", withOld, null);

  const edge = personalSummary(
    [log(1, 100), log(2, 120), log(PERSONAL_WINDOW_DAYS, 140)],
    BAND,
    NOW
  );
  eq("a reading exactly on the 14-day edge still counts", edge?.readings, 3);
  const justOutside = personalSummary(
    [log(1, 100), log(2, 120), log(PERSONAL_WINDOW_DAYS, 140, "manual", 1)],
    BAND,
    NOW
  );
  eq("one hour past the edge does not", justOutside, null);

  const withHealth = personalSummary(
    [log(1, 100), log(2, 120), log(3, 140, "health"), log(4, 160, "health")],
    BAND,
    NOW
  );
  eq("Health imports are not the user's own readings", withHealth, null);

  const health3 = personalSummary(
    [log(1, 100), log(2, 120), log(3, 140), log(4, 400, "health")],
    BAND,
    NOW
  );
  eq("imports never move the average", health3?.avgMgdl, 120);
  eq("imports never move the count", health3?.readings, 3);

  const future = personalSummary(
    [log(1, 100), log(2, 120), log(-1, 140)],
    BAND,
    NOW
  );
  eq("a reading dated in the future is outside the window", future, null);
}

const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};
const nodePath = require("path") as {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};
// Walks up from the compiled file, then from the working directory, so the
// harness also runs when its output is compiled outside the repo.
const ROOT = (() => {
  for (const start of [__dirname, process.cwd()]) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (
        fs.existsSync(nodePath.join(dir, "package.json")) &&
        fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"))
      ) {
        return dir;
      }
      dir = nodePath.dirname(dir);
    }
  }
  throw new Error("could not locate the repo root from " + __dirname);
})();
function src(rel: string): string {
  return fs.readFileSync(nodePath.join(ROOT, rel), "utf8");
}

section("I. wiring: the trial reminder and the paywall use these rules");
{
  const notif = src("lib/services/notifications.ts");
  ok(
    "the reminder lead comes from trialTimeline, not a literal",
    /trialReminderFireAt\(/.test(notif) && !/const leadDays = 2/.test(notif)
  );
  const schedFrom = notif.slice(notif.indexOf("export async function scheduleTrialEndingReminder"));
  const sched = schedFrom.slice(0, schedFrom.indexOf("\n}\n"));
  ok("scheduling takes the trial's end, not a length", /scheduleTrialEndingReminder\(trialEndsAt: number\)/.test(sched));
  ok("the fire time is the store's end minus the lead", /trialReminderFireAt\(trialEndsAt\)/.test(sched));
  ok("scheduling reads the app's own notification switch", /\(await getNotificationPrefs\(\)\)\.enabled/.test(sched));
  ok(
    "and asks it before it asks the OS",
    sched.indexOf("getNotificationPrefs()") >= 0 &&
      sched.indexOf("getNotificationPrefs()") < sched.indexOf("ensureNotificationPermission()")
  );
  ok(
    "the title and the language re-arm share one content builder",
    (notif.match(/trialEndingContent\(\)/g) || []).length >= 3
  );
  ok(
    "the title gets the lead as a parameter",
    /i18n\.t\("notifications\.trialTitle", \{ count: days, days \}\)/.test(notif)
  );

  const layout = src("app/_layout.tsx");
  const trialCase = layout.match(/case "trial":[\s\S]*?break;/);
  ok(
    "tapping the trial reminder opens Insights",
    trialCase !== null && /router\.navigate\("\/insights"\)/.test(trialCase[0])
  );
  ok(
    "tapping the trial reminder no longer opens Settings > App",
    trialCase !== null && !/settings\/app/.test(trialCase[0].replace(/\/\/.*$/gm, ""))
  );

  const paywall = src("app/paywall.tsx");
  ok("the paywall builds its rows with buildTrialTimeline", /buildTrialTimeline\(/.test(paywall));
  ok(
    "the reminder row follows the notification switch and the OS state",
    /buildTrialTimeline\(trialDays, reminderOk\)/.test(paywall) &&
      /getNotificationPrefs\(\)/.test(paywall) &&
      /getNotificationPermission\(\)/.test(paywall) &&
      /trialReminderDeliverable\(/.test(paywall)
  );
  ok(
    "trial_started carries only the tier",
    /logEvent\("trial_started", \{ tier: plan \}\)/.test(paywall)
  );
  const buyFrom = paywall.slice(paywall.indexOf("  async function buy()"));
  const buyBody = buyFrom.slice(0, buyFrom.indexOf("\n  }\n"));
  ok(
    "a purchase is judged by the store, not by the offer that was on screen",
    /trialAfterPurchase\(res\)/.test(paywall) &&
      /trialSettleAction\(/.test(paywall) &&
      /settleTrial\(res\)/.test(buyBody) &&
      !/annualTrial/.test(buyBody)
  );
  ok(
    "the reminder is timed from the store's expiry, not the offer's length",
    /scheduleTrialEndingReminder\(endsAt\)/.test(paywall) &&
      !/scheduleTrialEndingReminder\(trialDays\)/.test(paywall)
  );
  const restoreFrom = paywall.slice(paywall.indexOf("async function onRestore"));
  const restoreBody = restoreFrom.slice(0, restoreFrom.indexOf("\n  }\n"));
  ok(
    "a restore keeps the reminder of a trial that is still running (the rule is locked in trialSettle.test.ts)",
    /await settleRestoredTrial\(\)/.test(restoreBody) &&
      /trialSettleAction\(\{ restored: true, trialStatus: await getTrialStatus\(\) \}\)/.test(paywall)
  );
  ok(
    "the personal line reads the profile's own readings through the SQL-side query",
    /listManualSugarLogs\(/.test(paywall) && !/listSugarLogs\(/.test(paywall)
  );
  ok(
    "the lifetime anchor is formatted for the locale",
    /num\(lifetimeYears\)/.test(paywall) && !/String\(lifetimeYears\)/.test(paywall)
  );

  const logs = src("lib/db/logs.ts");
  const manualFrom = logs.slice(logs.indexOf("export async function listManualSugarLogs"));
  const manual = manualFrom.slice(0, manualFrom.indexOf("\n}\n"));
  ok("the manual read filters Health out in SQL", /source != 'health'/.test(manual));
  ok("it bounds the span in SQL", /rangeClause\("logged_at", range\)/.test(manual));
  ok("and has no row cap", !/LIMIT/i.test(manual));
}

(async () => {
  section("J. the personal line is read SQL-side, so a Health import cannot crowd it out");
  {
    const Module = require("module");
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL,
      period_tag TEXT NOT NULL DEFAULT 'manual',
      source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      healthkit_uuid TEXT
    );`);
    const insert = db.prepare(
      "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags, healthkit_uuid) VALUES (?, ?, ?, ?, ?, ?, '[]', ?)"
    );
    const T = Date.UTC(2026, 9, 6, 12);
    // The audit's scenario: a CGM-style Health import (a row every five minutes)
    // for two weeks, plus one manual reading a day: 100 on the newest seven days,
    // 250 on the older seven.
    for (let d = 0; d < 14; d++) {
      for (let i = 0; i < 288; i++) {
        insert.run(`h${d}-${i}`, "p", 150, "random", "health", new Date(T - d * DAY - i * 300_000).toISOString(), `u${d}-${i}`);
      }
      insert.run(`m${d}`, "p", d < 7 ? 100 : 250, "fasting", "manual", new Date(T - d * DAY - 3 * 3600_000 - 1000).toISOString(), null);
    }
    insert.run("other-profile", "q", 999, "fasting", "manual", new Date(T - 1000).toISOString(), null);
    insert.run("too-old", "p", 999, "fasting", "manual", new Date(T - 15 * DAY).toISOString(), null);
    insert.run("future", "p", 999, "fasting", "manual", new Date(T + 3600_000).toISOString(), null);

    const dbAdapter = {
      getAllAsync: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params),
    };
    const realLoad = Module._load;
    Module._load = function (request: string, parent: any) {
      const from = parent && typeof parent.filename === "string" ? parent.filename : "";
      if (request === "./index" && /[\\/]lib[\\/]db[\\/]logs\.(js|ts)$/.test(from)) {
        return { getDb: async () => dbAdapter };
      }
      if (request === "expo-crypto") return {};
      return realLoad.apply(this, arguments);
    };
    let logs: typeof LogsApi;
    try {
      logs = require("../lib/db/logs");
    } finally {
      Module._load = realLoad;
    }

    const range = rangeFromWindow(PERSONAL_WINDOW_DAYS, T);
    const own = await logs.listManualSugarLogs("p", range);
    eq("every manual reading of the window, and only those", own.length, 14);
    ok("no Health import in it", own.every((r) => r.source !== "health"));
    ok("nothing of another profile", own.every((r) => r.profile_id === "p"));
    ok("nothing outside the span (too old, in the future)", own.every((r) => r.id.startsWith("m")));
    ok("newest first", own[0].id === "m0" && own[13].id === "m13");
    eq(
      "the personal line counts the whole two weeks",
      personalSummary(own, BAND, T),
      { readings: 14, avgMgdl: 175, inRangePct: 50 }
    );

    const capped = await logs.listSugarLogs("p", 2000, range);
    eq(
      "contrast: the old capped read only reached the newest week",
      personalSummary(capped, BAND, T),
      { readings: 7, avgMgdl: 100, inRangePct: 100 }
    );
  }

  section("K. the reminder title carries the lead, with the right number wording per language");
  {
    // Resolved from the repo root, so it works wherever the compiled copy of
    // this file was written.
    const i18next = require(nodePath.join(ROOT, "node_modules", "i18next"));
    const langs = ["tr", "en", "de", "fr", "es", "it", "pt", "ar", "ja"];
    const resources: Record<string, unknown> = {};
    for (const lang of langs) {
      const text = src(`lib/i18n/locales/${lang}.ts`);
      const pick = (key: string): string => {
        const m = text.match(new RegExp(`\\n    ${key}: "([^"\\n]*)",`));
        return m ? m[1] : "";
      };
      const title = pick("trialTitle");
      const plural = pick("trialTitle_plural");
      ok(`${lang}: the title has a {{days}} slot`, title.includes("{{days}}"), title);
      ok(`${lang}: so does its plural form`, plural.includes("{{days}}"), plural);
      ok(`${lang}: no day count is written into the copy`, !/[0-9]/.test(title + plural), title + " | " + plural);
      resources[lang] = {
        translation: { notifications: { trialTitle: title, trialTitle_plural: plural, trialBody: pick("trialBody") } },
      };
    }
    // The same options as lib/i18n/index.ts, so the plural suffixes resolve the same way.
    const inst = i18next.createInstance();
    inst.init({
      resources,
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      returnNull: false,
      compatibilityJSON: "v3",
    });
    const title = (lang: string, n: number) => inst.t("notifications.trialTitle", { lng: lang, count: n, days: n });
    eq("en, 2", title("en", 2), "Your Pro trial ends in 2 days");
    eq("en, 1", title("en", 1), "Your Pro trial ends in 1 day");
    eq("de, 2", title("de", 2), "Ihre Pro-Testphase endet in 2 Tagen");
    eq("de, 1", title("de", 1), "Ihre Pro-Testphase endet in 1 Tag");
    eq("fr, 2", title("fr", 2), "Votre essai Pro se termine dans 2 jours");
    eq("fr, 1", title("fr", 1), "Votre essai Pro se termine dans 1 jour");
    eq("es, 2", title("es", 2), "Su prueba de Pro termina en 2 días");
    eq("es, 1", title("es", 1), "Su prueba de Pro termina en 1 día");
    eq("it, 2", title("it", 2), "La Sua prova di Pro finisce tra 2 giorni");
    eq("it, 1", title("it", 1), "La Sua prova di Pro finisce tra 1 giorno");
    eq("pt, 2", title("pt", 2), "Seu teste do Pro termina em 2 dias");
    eq("pt, 1", title("pt", 1), "Seu teste do Pro termina em 1 dia");
    eq("tr, 2", title("tr", 2), "Pro denemeniz 2 gün sonra bitiyor");
    eq("ja, 2", title("ja", 2), "Proのトライアルは2日後に終了します");
    for (const lang of langs) {
      for (const n of [1, 2, 3, 5]) {
        const out = title(lang, n);
        ok(`${lang}, ${n}: the number is filled in and no slot is left`, out.includes(String(n)) && !out.includes("{{"), out);
      }
    }
    // "Apple Sağlık'ten" broke vowel harmony (Sağlık takes -tan), and the name is
    // not ours to inflect (Apple Sağlık on iOS, Health Connect on Android), so the
    // label goes through a postposition that never changes. "üzerinden" and not
    // "uygulamasından": the longer one wraps to a third line in the 2-line grid
    // cell on 375 to 390 pt phones and the noun that says what is imported is lost.
    const trSrc = src("lib/i18n/locales/tr.ts");
    ok(
      "the Turkish paywall Health feature no longer glues a suffix onto the Health name",
      !/\{\{health\}\}'/.test(trSrc) &&
        /featureShortHealth: "\{\{health\}\} üzerinden aktarım"/.test(trSrc)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.log("test crashed", err);
  process.exit(1);
});
