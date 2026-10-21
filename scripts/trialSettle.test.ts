/**
 * lib/trialSettle.ts correctness harness: the table that turns the store's word
 * on a purchase or a restore into what the paywall does with the trial (the
 * trial_started event, arming the ending reminder and the day it is timed from,
 * taking a stale one down), plus the wiring checks that keep the paywall on that
 * table instead of branching for itself. No jest, same standalone style as
 * scripts/trialTimeline.test.ts.
 *
 * Run from the repo root (the wiring checks read the paywall source):
 * npx tsx scripts/trialSettle.test.ts, or compile with tsc and run with node:
 *
 *   npx tsc scripts/trialSettle.test.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir <tmp> --module commonjs --target es2019 --moduleResolution node \
 *     --skipLibCheck --esModuleInterop \
 *   && node <tmp>/scripts/trialSettle.test.js
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import {
  trialSettleAction,
  type TrialSettleAction,
  type TrialSettleInput,
  type TrialVerdict,
} from "../lib/trialSettle";
// Type-only: compile-time proof that the verdict and the trial state the paywall
// hands over are the very shapes the service produces. tsx strips it.
import type { TrialAfterPurchase, TrialStatus } from "../lib/services/purchases";

const verdictFromService: TrialVerdict = {} as TrialAfterPurchase;
const verdictForService: TrialAfterPurchase = {} as TrialVerdict;
const statusFromService: { active: boolean } | null = null as TrialStatus | null;
void verdictFromService;
void verdictForService;
void statusFromService;

const DAY = 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const INERT: TrialSettleAction = {
  logTrialStarted: false,
  scheduleReminderAt: null,
  trialDays: null,
  cancelReminder: false,
};

function purchase(trial: TrialVerdict, offerDays = 7, now = NOW): TrialSettleAction {
  return trialSettleAction({ restored: false, trial, offerDays, now });
}
function restore(trialStatus: { active: boolean } | null): TrialSettleAction {
  return trialSettleAction({ restored: true, trialStatus });
}

section("A. a purchase that started a trial is reported and its reminder armed from the store");
{
  const expiry = NOW + 7 * DAY - 1234;
  eq(
    "the store's expiry and length are used",
    purchase({ kind: "started", endsAt: expiry, daysLeft: 7 }),
    { logTrialStarted: true, scheduleReminderAt: expiry, trialDays: 7, cancelReminder: false }
  );

  // The offer on screen says 3 days, the store started a 14-day trial: the store wins on both.
  const longExpiry = NOW + 14 * DAY;
  const longer = purchase({ kind: "started", endsAt: longExpiry, daysLeft: 14 }, 3);
  eq("the reminder is timed from the store's expiry, not from the offer's length", longer.scheduleReminderAt, longExpiry);
  ok("and that is not the moment the offer's length would give", longer.scheduleReminderAt !== NOW + 3 * DAY);
  eq("the length handed to the day-1 nudge is the store's", longer.trialDays, 14);

  // And the other way round: the offer says 14, the store started 3 days.
  const shortExpiry = NOW + 3 * DAY;
  const shorter = purchase({ kind: "started", endsAt: shortExpiry, daysLeft: 3 }, 14);
  eq("a shorter store trial is armed from its own expiry", shorter.scheduleReminderAt, shortExpiry);
  ok("not from the offer's longer length", shorter.scheduleReminderAt !== NOW + 14 * DAY);
  eq("with the store's length for the nudge", shorter.trialDays, 3);

  const noExpiry = purchase({ kind: "started", endsAt: null, daysLeft: 5 }, 7);
  eq("without an expiry the store's own length stands in, counted from now", noExpiry.scheduleReminderAt, NOW + 5 * DAY);
  eq("and it is the length the nudge sees", noExpiry.trialDays, 5);

  const nothingFromStore = purchase({ kind: "started", endsAt: null, daysLeft: null }, 7);
  eq("with neither, the offer's length is the last resort", nothingFromStore.scheduleReminderAt, NOW + 7 * DAY);
  eq("for the nudge too", nothingFromStore.trialDays, 7);
  eq("it is still a started trial", nothingFromStore.logTrialStarted, true);

  const clock = purchase({ kind: "started", endsAt: null, daysLeft: null }, 7, NOW + 3 * DAY);
  eq("the fallback follows the clock it is given", clock.scheduleReminderAt, NOW + 10 * DAY);

  eq("a started trial never takes a reminder down", [longer, shorter, noExpiry, nothingFromStore].map((a) => a.cancelReminder), [false, false, false, false]);
}

section("B. a running trial (an already-owned recovery) is left alone");
{
  eq("nothing happens", purchase({ kind: "running" }), INERT);
  eq("whatever length the offer showed", purchase({ kind: "running" }, 30, NOW + 99 * DAY), INERT);
  ok("it is not reported again", !purchase({ kind: "running" }).logTrialStarted);
  ok("no second reminder is armed", purchase({ kind: "running" }).scheduleReminderAt === null);
  ok("and the existing one is not cancelled", !purchase({ kind: "running" }).cancelReminder);
}

section("C. no trial: a reminder an earlier trial left behind comes down");
{
  eq("it is cancelled and nothing else happens", purchase({ kind: "none" }), {
    logTrialStarted: false,
    scheduleReminderAt: null,
    trialDays: null,
    cancelReminder: true,
  });
  ok("no trial is reported", !purchase({ kind: "none" }, 7).logTrialStarted);
  ok("whatever length the offer showed", purchase({ kind: "none" }, 30).cancelReminder);
}

section("D. a restore keeps the reminder of a running trial and retires any other");
{
  eq("a trial that is still running keeps its reminder", restore({ active: true }), INERT);
  eq("a restored entitlement with no trial in it retires it", restore({ active: false }), {
    logTrialStarted: false,
    scheduleReminderAt: null,
    trialDays: null,
    cancelReminder: true,
  });
  eq("nothing known about a trial retires it too", restore(null).cancelReminder, true);
  for (const status of [{ active: true }, { active: false }, null]) {
    const action = restore(status);
    const label = status === null ? "null" : `active ${status.active}`;
    ok(`a restore never reports a started trial (${label})`, !action.logTrialStarted);
    ok(`a restore never arms a reminder (${label})`, action.scheduleReminderAt === null && action.trialDays === null);
  }
}

section("E. invariants over every input the paywall can hand over");
{
  // A trial's expiry always lies ahead of the moment it started, so the verdicts
  // are built from each clock they are settled on.
  const verdictsAt = (now: number): TrialVerdict[] => [
    { kind: "started", endsAt: now + 7 * DAY, daysLeft: 7 },
    { kind: "started", endsAt: now + 1 * DAY, daysLeft: 1 },
    { kind: "started", endsAt: null, daysLeft: 4 },
    { kind: "started", endsAt: null, daysLeft: null },
    { kind: "running" },
    { kind: "none" },
  ];
  let cases = 0;
  let broken = "";
  for (const now of [NOW, NOW + 40 * DAY]) {
    for (const trial of verdictsAt(now)) {
      for (const offerDays of [3, 7, 14]) {
        const a = purchase(trial, offerDays, now);
        cases++;
        const started = trial.kind === "started";
        const label = `${trial.kind}/${offerDays}/${now}`;
        if (a.logTrialStarted !== started) broken = `log mismatch ${label}`;
        if ((a.scheduleReminderAt !== null) !== started) broken = `schedule mismatch ${label}`;
        if ((a.trialDays !== null) !== started) broken = `trialDays mismatch ${label}`;
        if (a.cancelReminder !== (trial.kind === "none")) broken = `cancel mismatch ${label}`;
        if (a.scheduleReminderAt !== null && a.cancelReminder) broken = `both arm and cancel ${label}`;
        if (a.scheduleReminderAt !== null && a.scheduleReminderAt <= now) broken = `reminder not in the future ${label}`;
      }
    }
  }
  ok(`${cases} purchase inputs keep the table's shape`, broken === "", broken);

  const frozen: TrialSettleInput = Object.freeze({
    restored: false,
    trial: Object.freeze({ kind: "started", endsAt: null, daysLeft: null }),
    offerDays: 7,
    now: NOW,
  }) as TrialSettleInput;
  eq("the same input gives the same action", trialSettleAction(frozen), trialSettleAction(frozen));
  const first = trialSettleAction(frozen);
  first.cancelReminder = true;
  eq("an action is a fresh object nobody else shares", trialSettleAction(frozen).cancelReminder, false);
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
function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
/** From `marker` to the first line that closes a 2-space-indented block. */
function blockFrom(text: string, marker: string): string {
  const from = text.indexOf(marker);
  if (from < 0) return "";
  const rest = text.slice(from);
  const end = rest.indexOf("\n  }\n");
  return end < 0 ? rest : rest.slice(0, end);
}

section("F. wiring: the paywall carries the action out and decides nothing itself");
{
  const paywall = src("app/paywall.tsx");
  ok(
    "the paywall imports the mapping from lib/trialSettle",
    /import \{[^}]*\btrialSettleAction\b[^}]*\} from "\.\.\/lib\/trialSettle"/.test(paywall)
  );
  eq("it calls it for a purchase and for a restore, nowhere else", count(paywall, "trialSettleAction("), 2);

  const settle = blockFrom(paywall, "  async function settleTrial(");
  ok("a purchase is settled on the store's verdict", /trial: await trialAfterPurchase\(res\)/.test(settle));
  ok("with the offer's length only as the fallback it is", /restored: false/.test(settle) && /offerDays: trialDays/.test(settle));
  ok("the clock is read when the verdict is, not at render", /now: Date\.now\(\)/.test(settle));

  const restoredFn = blockFrom(paywall, "  async function settleRestoredTrial(");
  ok(
    "a restore is settled on the trial state the store reports right after it",
    /restored: true/.test(restoredFn) && /trialStatus: await getTrialStatus\(\)/.test(restoredFn)
  );
  const restoreHandler = blockFrom(paywall, "  async function onRestore(");
  ok("onRestore hands the trial to that function", /await settleRestoredTrial\(\)/.test(restoreHandler));
  ok("and keeps no trial decision of its own", !/getTrialStatus\(\)/.test(restoreHandler) && !/cancelTrialReminder\(/.test(restoreHandler));
  // The purchase handling moved into the tested flow (lib/paywallBuyFlow); the
  // screen keeps the success side effects in onSuccess.
  const buyHandler = blockFrom(paywall, "    onSuccess: async (p, res) => {");
  ok("buy settles the purchase's trial", /await settleTrial\(res\)/.test(buyHandler));
  ok("and never reads the offer on screen for it", !/annualTrial/.test(buyHandler));

  const apply = blockFrom(paywall, "  function applyTrialAction(");
  ok("the event follows the action's flag", /if \(action\.logTrialStarted\) logEvent\("trial_started", \{ tier: plan \}\)/.test(apply));
  ok(
    "the reminder is armed only when the action carries a time, from that time",
    /if \(action\.scheduleReminderAt !== null\)/.test(apply) &&
      /const endsAt = action\.scheduleReminderAt;/.test(apply) &&
      /scheduleTrialEndingReminder\(endsAt\)/.test(apply)
  );
  ok("the nudge takes the action's length and goes after the reminder", /\.then\(\(\) => armTrialNudge\(days\)\)/.test(apply) && /action\.trialDays \?\? trialDays/.test(apply));
  ok("it is taken down only when the action says so", /if \(action\.cancelReminder\) \{\s*cancelTrialReminder\(\)/.test(apply));

  eq("trial_started is reported from one place", count(paywall, 'logEvent("trial_started"'), 1);
  eq("the ending reminder is armed from one place", count(paywall, "scheduleTrialEndingReminder("), 1);
  eq("the reminder is taken down from one place", count(paywall, "cancelTrialReminder()"), 1);
  const trialCode = [settle, restoredFn, apply, restoreHandler, buyHandler].join("\n");
  ok(
    "the paywall no longer branches on the verdict",
    !/\btrial\.kind\b/.test(trialCode) && !/\.kind === "(started|running|none)"/.test(trialCode)
  );
  ok("nor on whether a trial is active", !/\.active\b/.test(trialCode));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
