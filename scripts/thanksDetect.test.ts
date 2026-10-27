/**
 * lib/thanks harness: when the trial-conversion sheet and the renewal toast may
 * appear, and when they never may. Pure detection, the persist-before-show
 * evaluation, the presentation gate, and the wiring/copy checks.
 *
 * Run: npx tsx scripts/thanksDetect.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

import {
  DAY_MS,
  EMPTY_THANKS_STATE,
  THANKS_STATE_KEY,
  detectThanks,
  parseThanksState,
  serializeThanksState,
  type ThanksEntitlement,
  type ThanksShown,
  type ThanksSnapshot,
} from "../lib/thanks/detect";
import { confirmThanksShown, evaluateThanks, type ThanksDeps } from "../lib/thanks/evaluate";
import { claimSheet, onSheetRelease, sheetClaimed } from "../lib/sheetClaim";
import { mapEntitlement } from "../lib/thanks/map";
import { applyAttemptResult, attemptWhatsNew, createAttemptMemory, createWhatsNewScheduler } from "../lib/whatsNewAttempt";
import {
  MAX_SHOW_ATTEMPTS,
  SETTLE_MS,
  SHOW_TIMEOUT_MS,
  createSheetPresenter,
  type PresenterDeps,
} from "../lib/thanks/presenter";
import { thanksMayPresent, type ThanksGate } from "../lib/thanks/gate";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const T0 = Date.parse("2026-11-01T12:00:00Z");
const NONE: ThanksShown = { convertedSeenAt: null, renewalToastAt: null };
const ANNUAL = "zerospike_pro_annual";
const MONTHLY = "zerospike_pro_monthly";

function ent(over: Partial<ThanksEntitlement> = {}): ThanksEntitlement {
  return {
    active: true,
    periodType: "normal",
    expiresAt: T0 + 365 * DAY_MS,
    productId: ANNUAL,
    billingIssueDetectedAt: null,
    familyShared: false,
    ...over,
  };
}
function snap(over: Partial<ThanksSnapshot> = {}, observedAt = T0 - DAY_MS): ThanksSnapshot {
  return { ...ent(), observedAt, ...over };
}
function run(prev: ThanksSnapshot | null, current: ThanksEntitlement, now = T0, shown: ThanksShown = NONE) {
  return detectThanks({ prev, current, now, shown });
}

async function main() {
  console.log("zerospike thanks test");

  section("A. seeding: the first observation never shows");
  {
    for (const periodType of ["trial", "normal", "intro", "unknown"] as const) {
      const r = run(null, ent({ periodType }));
      eq(`first observation (${periodType}) shows nothing`, r.outcome, "none");
      eq(`first observation (${periodType}) seeds the snapshot`, r.next.periodType, periodType);
      eq(`first observation (${periodType}) stamps the time`, r.next.observedAt, T0);
    }
    eq("first observation of a lifetime seeds quietly", run(null, ent({ expiresAt: null })).outcome, "none");
    eq("first observation while inactive seeds an inactive snapshot", run(null, ent({ active: false })).next.active, false);
  }

  section("B. trial to paid: once in a lifetime");
  {
    const trial = snap({ periodType: "trial", expiresAt: T0 - 1000 });
    const r = run(trial, ent({ periodType: "normal", expiresAt: T0 + 365 * DAY_MS }));
    eq("trial then normal, same product, expiry forward: converted", r.outcome, "converted");
    eq("the new snapshot is the paid one", r.next.periodType, "normal");
    eq("a second time (already seen) is silent", run(trial, ent(), T0, { convertedSeenAt: T0 - 400 * DAY_MS, renewalToastAt: null }).outcome, "none");
    eq("trial still running is silent", run(trial, ent({ periodType: "trial", expiresAt: T0 + 3 * DAY_MS })).outcome, "none");
    eq("trial to normal on another product is silent", run(trial, ent({ productId: MONTHLY })).outcome, "none");
    eq("trial to normal with the expiry not moving is silent", run(trial, ent({ expiresAt: trial.expiresAt })).outcome, "none");
    eq("trial to normal with the expiry going back is silent", run(trial, ent({ expiresAt: (trial.expiresAt as number) - DAY_MS })).outcome, "none");
    eq("a lapsed trial (inactive snapshot) bought again later is not a conversion", run(snap({ active: false, periodType: "unknown", expiresAt: null, productId: null }), ent()).outcome, "none");
    eq("trial then inactive is silent", run(trial, ent({ active: false })).outcome, "none");
  }

  section("C. intro is not a trial");
  {
    const intro = snap({ periodType: "intro", expiresAt: T0 - 1000 });
    eq("intro then normal is silent", run(intro, ent()).outcome, "none");
    eq("normal then intro is silent", run(snap(), ent({ periodType: "intro" })).outcome, "none");
    eq("unknown then normal is silent", run(snap({ periodType: "unknown" }), ent()).outcome, "none");
    eq("trial then intro is silent", run(snap({ periodType: "trial" }), ent({ periodType: "intro" })).outcome, "none");
  }

  section("D. renewal and the 330 day toast limit");
  {
    const before = snap({ expiresAt: T0 - 1000 });
    const after = ent({ expiresAt: T0 - 1000 + 365 * DAY_MS });
    eq("normal to normal, expiry jumped a year: renewed", run(before, after).outcome, "renewed");
    const monthlyPrev = snap({ productId: MONTHLY, expiresAt: T0 - 1000 });
    const monthlyNow = ent({ productId: MONTHLY, expiresAt: T0 - 1000 + 30 * DAY_MS });
    eq("a monthly renewal counts", run(monthlyPrev, monthlyNow).outcome, "renewed");
    eq("expiry forward by exactly one day counts", run(before, ent({ expiresAt: (before.expiresAt as number) + DAY_MS })).outcome, "renewed");
    eq("expiry forward by less than a day is silent", run(before, ent({ expiresAt: (before.expiresAt as number) + DAY_MS - 1 })).outcome, "none");
    eq("expiry unchanged is silent", run(before, ent({ expiresAt: before.expiresAt })).outcome, "none");
    eq("expiry going back is silent", run(before, ent({ expiresAt: (before.expiresAt as number) - 5 * DAY_MS })).outcome, "none");

    const last = (days: number): ThanksShown => ({ convertedSeenAt: null, renewalToastAt: T0 - days * DAY_MS });
    eq("last toast 329 days ago: silent", run(before, after, T0, last(329)).outcome, "none");
    eq("last toast 330 days minus 1 ms ago: silent", run(before, after, T0, { convertedSeenAt: null, renewalToastAt: T0 - 330 * DAY_MS + 1 }).outcome, "none");
    eq("last toast exactly 330 days ago: shown", run(before, after, T0, last(330)).outcome, "renewed");
    eq("last toast 364 days ago (a year, a bit short): shown", run(before, after, T0, last(364)).outcome, "renewed");
    eq("last toast 365 days ago: shown", run(before, after, T0, last(365)).outcome, "renewed");
    {
      const yearlyPrev = snap({ productId: ANNUAL, expiresAt: T0 - 1000 });
      const yearlyNow = ent({ productId: ANNUAL, expiresAt: T0 - 1000 + 365 * DAY_MS });
      const lastToast = T0 - (364 * DAY_MS + 23 * 3600_000);
      eq("yearly subscriber renewing 364 days 23 hours after the last toast: shown", run(yearlyPrev, yearlyNow, T0, { convertedSeenAt: null, renewalToastAt: lastToast }).outcome, "renewed");
      const monthlyP = snap({ productId: MONTHLY, expiresAt: T0 - 1000 });
      const monthlyN = ent({ productId: MONTHLY, expiresAt: T0 - 1000 + 30 * DAY_MS });
      eq("monthly subscriber at 329 days: silent", run(monthlyP, monthlyN, T0, last(329)).outcome, "none");
      eq("monthly subscriber at 330 days: shown", run(monthlyP, monthlyN, T0, last(330)).outcome, "renewed");
    }
    eq("last toast 400 days ago: shown", run(before, after, T0, last(400)).outcome, "renewed");
    eq("last toast in the future (clock moved): silent", run(before, after, T0, last(-10)).outcome, "none");
    eq("a seen conversion does not block a renewal", run(before, after, T0, { convertedSeenAt: T0 - 500 * DAY_MS, renewalToastAt: null }).outcome, "renewed");
    eq("the renewal gate does not look at the conversion stamp", run(before, after, T0, { convertedSeenAt: T0 - DAY_MS, renewalToastAt: null }).outcome, "renewed");
  }

  section("E. lifetime and non-subscription");
  {
    eq("lifetime (no expiry) never renews", run(snap({ expiresAt: null, productId: "zerospike_pro_lifetime" }), ent({ expiresAt: null, productId: "zerospike_pro_lifetime" })).outcome, "none");
    eq("expiry appearing from null is silent", run(snap({ expiresAt: null }), ent()).outcome, "none");
    eq("expiry vanishing to null is silent", run(snap(), ent({ expiresAt: null })).outcome, "none");
    eq("trial to a lifetime purchase is not a conversion", run(snap({ periodType: "trial" }), ent({ expiresAt: null, productId: "zerospike_pro_lifetime" })).outcome, "none");
    eq("a missing product id on either side is silent", run(snap({ productId: null }), ent({ productId: null })).outcome, "none");
  }

  section("F. plan change only seeds");
  {
    const prev = snap({ productId: MONTHLY, expiresAt: T0 - 1000 });
    const r = run(prev, ent({ productId: ANNUAL, expiresAt: T0 + 365 * DAY_MS }));
    eq("monthly to annual with a big expiry jump is silent", r.outcome, "none");
    eq("and the snapshot now holds the new product", r.next.productId, ANNUAL);
    const again = run({ ...r.next, expiresAt: T0 + 30 * DAY_MS }, ent({ productId: ANNUAL, expiresAt: T0 + 395 * DAY_MS }), T0 + 29 * DAY_MS);
    eq("the next real renewal on the new plan is shown", again.outcome, "renewed");
    eq("Android base-plan ids differ as whole strings", run(snap({ productId: "zerospike_pro:monthly" }), ent({ productId: "zerospike_pro:annual", expiresAt: T0 + 400 * DAY_MS })).outcome, "none");
  }

  section("G. inactive");
  {
    const r = run(snap({ periodType: "trial" }), ent({ active: false }));
    eq("inactive shows nothing", r.outcome, "none");
    eq("inactive updates the snapshot", r.next.active, false);
    eq("inactive snapshot carries no period", r.next.periodType, "unknown");
    eq("then active again is a fresh seed", run(r.next, ent()).outcome, "none");
  }

  section("H. the clock");
  {
    const prev = snap({ periodType: "trial", expiresAt: T0 - 1000 }, T0 + 2 * DAY_MS);
    eq("clock behind the last observation: a conversion is silent", run(prev, ent()).outcome, "none");
    const prevN = snap({ expiresAt: T0 - 1000 }, T0 + 2 * DAY_MS);
    eq("clock behind the last observation: a renewal is silent", run(prevN, ent({ expiresAt: T0 + 365 * DAY_MS })).outcome, "none");
    eq("the snapshot is re-stamped with the (earlier) now", run(prevN, ent()).next.observedAt, T0);
    eq("equal time is fine", run(snap({ expiresAt: T0 - 1000 }, T0), ent({ expiresAt: T0 + 365 * DAY_MS })).outcome, "renewed");
  }

  section("H2. billing issue and Family Sharing");
  {
    const trialPrev = snap({ periodType: "trial", expiresAt: T0 - 1000 });
    const paidWithIssue = ent({ periodType: "normal", expiresAt: T0 + 365 * DAY_MS, billingIssueDetectedAt: T0 - 3600_000 });
    const r = run(trialPrev, paidWithIssue);
    eq("trial to paid with a billing issue: silent", r.outcome, "none");
    eq("the old snapshot is kept untouched", r.next, trialPrev);
    eq("when the payment goes through the conversion is still caught", run(r.next, ent({ periodType: "normal", expiresAt: T0 + 365 * DAY_MS }), T0 + DAY_MS).outcome, "converted");

    const normalPrev = snap({ expiresAt: T0 - 1000 });
    const renewedWithIssue = ent({ expiresAt: T0 + 365 * DAY_MS, billingIssueDetectedAt: T0 - 1000 });
    const r2 = run(normalPrev, renewedWithIssue);
    eq("renewal with a billing issue: silent, snapshot kept", [r2.outcome, r2.next], ["none", normalPrev]);
    eq("renewal is caught once the issue clears", run(r2.next, ent({ expiresAt: T0 + 365 * DAY_MS }), T0 + DAY_MS).outcome, "renewed");
    eq("a first observation with a billing issue still only seeds", run(null, paidWithIssue).outcome, "none");

    const fam = ent({ familyShared: true, expiresAt: T0 + 365 * DAY_MS });
    const f1 = run(snap({ expiresAt: T0 - 1000 }), fam);
    eq("a Family Sharing renewal is silent", f1.outcome, "none");
    eq("and the snapshot follows it", [f1.next.familyShared, f1.next.expiresAt], [true, T0 + 365 * DAY_MS]);
    eq("a Family Sharing trial conversion is silent", run(snap({ periodType: "trial", expiresAt: T0 - 1000 }), ent({ familyShared: true, expiresAt: T0 + 365 * DAY_MS })).outcome, "none");
  }

  section("I. state parsing");
  {
    eq("empty", parseThanksState(null), EMPTY_THANKS_STATE);
    eq("garbage", parseThanksState("{nope"), EMPTY_THANKS_STATE);
    eq("array", parseThanksState("[]"), EMPTY_THANKS_STATE);
    eq("wrong types are dropped", parseThanksState(JSON.stringify({ snapshot: { active: "yes" }, convertedSeenAt: "x", renewalToastAt: NaN })), EMPTY_THANKS_STATE);
    const full = {
      snapshot: snap({ periodType: "trial", billingIssueDetectedAt: T0 - 5, familyShared: true }, T0),
      convertedSeenAt: T0,
      renewalToastAt: T0 - DAY_MS,
      pendingConvertedAt: T0 - 7,
      pendingRenewalAt: T0 - 9,
    };
    eq("round trip", parseThanksState(serializeThanksState(full)), full);
    eq("an unknown period reads as unknown", parseThanksState(JSON.stringify({ snapshot: { ...snap(), periodType: "weird" }, convertedSeenAt: null, renewalToastAt: null })).snapshot?.periodType, "unknown");
    eq("the key is the one account-level key", THANKS_STATE_KEY, "zerospike.thanks.v1");
  }

  section("J. evaluation: pending until really shown, installs never shown");
  {
    const makeDeps = (initial: string | null, entitlement: ThanksEntitlement | null, now = T0) => {
      const log: string[] = [];
      const box = { raw: initial };
      const deps: ThanksDeps = {
        readEntitlement: async () => entitlement,
        readRaw: async () => box.raw,
        writeRaw: async (raw) => {
          log.push("write");
          box.raw = raw;
        },
        now: () => now,
      };
      return { deps, log, box };
    };
    const stored = (box: { raw: string | null }) => parseThanksState(box.raw);
    /** Seeds a snapshot for `e` at `now`, returns the raw state. */
    const seeded = async (e: ThanksEntitlement, now = T0): Promise<string | null> => {
      const d = makeDeps(null, e, now);
      await evaluateThanks(d.deps);
      return d.box.raw;
    };

    // Fresh install, reinstall and restore all look the same: no state at all.
    for (const [name, e] of [
      ["fresh install, free", ent({ active: false })],
      ["reinstall, paying", ent()],
      ["restore on a new device, trial", ent({ periodType: "trial", expiresAt: T0 + 2 * DAY_MS })],
      ["restore on a new device, paid", ent({ periodType: "normal" })],
    ] as const) {
      const d = makeDeps(null, e);
      eq(`${name}: nothing shown`, await evaluateThanks(d.deps), "none");
      ok(`${name}: seeded`, stored(d.box).snapshot !== null);
      eq(
        `${name}: no stamps, nothing pending`,
        [stored(d.box).convertedSeenAt, stored(d.box).renewalToastAt, stored(d.box).pendingConvertedAt, stored(d.box).pendingRenewalAt],
        [null, null, null, null]
      );
    }
    {
      const raw = await seeded(ent());
      const d2 = makeDeps(raw, ent(), T0 + 2 * DAY_MS);
      eq("an unchanged entitlement stays silent", await evaluateThanks(d2.deps), "none");
    }

    // Store unreachable: no answer, no write.
    {
      const d = makeDeps(null, null);
      eq("unreachable store: none", await evaluateThanks(d.deps), "none");
      eq("unreachable store: nothing written", d.log.length, 0);
    }

    // Conversion: decided and pending on disk, but NOT stamped as seen.
    {
      const raw = await seeded(ent({ periodType: "trial", expiresAt: T0 + DAY_MS }));
      const paid = ent({ periodType: "normal", expiresAt: T0 + 365 * DAY_MS });
      const d = makeDeps(raw, paid, T0 + 2 * DAY_MS);
      eq("trial then paid: converted is waiting", await evaluateThanks(d.deps), "converted");
      eq("pendingConvertedAt is the decision time", stored(d.box).pendingConvertedAt, T0 + 2 * DAY_MS);
      eq("convertedSeenAt is NOT written before it is shown", stored(d.box).convertedSeenAt, null);
      eq("renewalToastAt untouched", stored(d.box).renewalToastAt, null);

      // The app died (or another sheet was up): it survives and is offered again.
      const relaunch = makeDeps(d.box.raw, paid, T0 + 3 * DAY_MS);
      eq("a restart before it was shown offers it again", await evaluateThanks(relaunch.deps), "converted");
      eq("and keeps the original decision time", stored(relaunch.box).pendingConvertedAt, T0 + 2 * DAY_MS);
      const offline = makeDeps(relaunch.box.raw, null, T0 + 4 * DAY_MS);
      eq("it is offered even when the store cannot be read", await evaluateThanks(offline.deps), "converted");

      // Shown: stamp and clear.
      const confirm = makeDeps(relaunch.box.raw, paid, T0 + 3 * DAY_MS + 1000);
      eq("confirming reports success", await confirmThanksShown(confirm.deps, "converted"), true);
      eq("convertedSeenAt written at show time", stored(confirm.box).convertedSeenAt, T0 + 3 * DAY_MS + 1000);
      eq("pending cleared", stored(confirm.box).pendingConvertedAt, null);
      const after = makeDeps(confirm.box.raw, paid, T0 + 4 * DAY_MS);
      eq("after it was shown it does not come back", await evaluateThanks(after.deps), "none");

      // Even a snapshot that looks like a trial again cannot convert twice.
      const forged = parseThanksState(confirm.box.raw);
      const again = makeDeps(
        serializeThanksState({ ...forged, snapshot: snap({ periodType: "trial", expiresAt: T0 }, T0 + 3 * DAY_MS) }),
        ent({ periodType: "normal", expiresAt: T0 + 400 * DAY_MS }),
        T0 + 4 * DAY_MS
      );
      eq("the lifetime stamp blocks a second conversion", await evaluateThanks(again.deps), "none");
    }

    // Pending goes stale after 14 days; a future-dated one is dropped too.
    {
      const raw = await seeded(ent({ periodType: "trial", expiresAt: T0 + DAY_MS }));
      const paid = ent({ expiresAt: T0 + 365 * DAY_MS });
      const first = makeDeps(raw, paid, T0 + 2 * DAY_MS);
      await evaluateThanks(first.deps);
      const day14 = makeDeps(first.box.raw, paid, T0 + 2 * DAY_MS + 14 * DAY_MS);
      eq("pending at exactly 14 days is still shown", await evaluateThanks(day14.deps), "converted");
      const day14b = makeDeps(first.box.raw, paid, T0 + 2 * DAY_MS + 14 * DAY_MS + 1);
      eq("pending older than 14 days is dropped silently", await evaluateThanks(day14b.deps), "none");
      eq("and the mark is gone from disk", stored(day14b.box).pendingConvertedAt, null);
      const early = makeDeps(first.box.raw, paid, T0);
      eq("a pending stamp from the future (clock moved) is dropped", await evaluateThanks(early.deps), "none");
    }

    // Renewal: same principle.
    {
      const raw = await seeded(ent({ expiresAt: T0 + DAY_MS }));
      const renewed = ent({ expiresAt: T0 + DAY_MS + 365 * DAY_MS });
      const d = makeDeps(raw, renewed, T0 + 2 * DAY_MS);
      eq("renewal: waiting", await evaluateThanks(d.deps), "renewed");
      eq("renewal: pendingRenewalAt written", stored(d.box).pendingRenewalAt, T0 + 2 * DAY_MS);
      eq("renewal: the toast stamp is NOT written yet", stored(d.box).renewalToastAt, null);
      const relaunch = makeDeps(d.box.raw, renewed, T0 + 3 * DAY_MS);
      eq("renewal: survives a restart", await evaluateThanks(relaunch.deps), "renewed");
      const confirm = makeDeps(relaunch.box.raw, renewed, T0 + 3 * DAY_MS + 5);
      await confirmThanksShown(confirm.deps, "renewed");
      eq("renewal: stamp written at show time", stored(confirm.box).renewalToastAt, T0 + 3 * DAY_MS + 5);
      eq("renewal: pending cleared", stored(confirm.box).pendingRenewalAt, null);
      eq("renewal: convertedSeenAt untouched", stored(confirm.box).convertedSeenAt, null);
      const next = makeDeps(confirm.box.raw, ent({ expiresAt: T0 + DAY_MS + 730 * DAY_MS }), T0 + 200 * DAY_MS);
      eq("another renewal inside the limit is silent", await evaluateThanks(next.deps), "none");
      eq("and still moves the snapshot on", stored(next.box).snapshot?.expiresAt, T0 + DAY_MS + 730 * DAY_MS);
      // A pending renewal that the 330 day limit now forbids is dropped.
      const tooSoon = makeDeps(
        serializeThanksState({ ...parseThanksState(d.box.raw), renewalToastAt: T0 + DAY_MS }),
        renewed,
        T0 + 3 * DAY_MS
      );
      eq("a pending renewal inside the limit is dropped", await evaluateThanks(tooSoon.deps), "none");
    }

    // Conversion wins when both are waiting.
    {
      const raw = serializeThanksState({
        ...EMPTY_THANKS_STATE,
        snapshot: snap({}, T0),
        pendingConvertedAt: T0,
        pendingRenewalAt: T0,
      });
      eq("converted is offered before renewed", await evaluateThanks(makeDeps(raw, ent(), T0 + 1000).deps), "converted");
    }

    // Billing issue and Family Sharing through the full path.
    {
      const raw = await seeded(ent({ periodType: "trial", expiresAt: T0 + DAY_MS }));
      const issue = makeDeps(raw, ent({ expiresAt: T0 + 365 * DAY_MS, billingIssueDetectedAt: T0 }), T0 + 2 * DAY_MS);
      eq("billing issue: nothing waiting", await evaluateThanks(issue.deps), "none");
      eq("billing issue: the trial snapshot is still the one on disk", stored(issue.box).snapshot?.periodType, "trial");
      const paidLater = makeDeps(issue.box.raw, ent({ expiresAt: T0 + 365 * DAY_MS }), T0 + 3 * DAY_MS);
      eq("payment recovered: the conversion is caught", await evaluateThanks(paidLater.deps), "converted");

      const raw2 = await seeded(ent({ periodType: "trial", expiresAt: T0 + DAY_MS }));
      const fam = makeDeps(raw2, ent({ familyShared: true, expiresAt: T0 + 365 * DAY_MS }), T0 + 2 * DAY_MS);
      eq("Family Sharing: nothing waiting", await evaluateThanks(fam.deps), "none");
      ok("Family Sharing: the snapshot follows", stored(fam.box).snapshot?.familyShared === true);
      // A pending moment is withdrawn when the entitlement turns out to be shared.
      const pendingRaw = serializeThanksState({ ...EMPTY_THANKS_STATE, snapshot: snap({}, T0), pendingConvertedAt: T0 });
      eq("Family Sharing withdraws a pending moment", await evaluateThanks(makeDeps(pendingRaw, ent({ familyShared: true }), T0 + 1000).deps), "none");
      eq("losing Pro withdraws a pending moment", await evaluateThanks(makeDeps(pendingRaw, ent({ active: false }), T0 + 1000).deps), "none");
    }

    // A failed write is not a show.
    {
      const raw = await seeded(ent({ periodType: "trial", expiresAt: T0 + DAY_MS }));
      const d = makeDeps(raw, ent({ expiresAt: T0 + 365 * DAY_MS }), T0 + 2 * DAY_MS);
      d.deps.writeRaw = async () => {
        throw new Error("disk full");
      };
      eq("a failed write is not shown", await evaluateThanks(d.deps), "none");
      eq("a failed confirm reports false", await confirmThanksShown(d.deps, "converted"), false);
    }
    // A failed read is not a show and never overwrites the state.
    {
      const d = makeDeps("x", ent());
      d.deps.readRaw = async () => {
        throw new Error("read failed");
      };
      eq("a failed read is not shown", await evaluateThanks(d.deps), "none");
      eq("and writes nothing", d.log.length, 0);
    }
    // Two overlapping evaluations (launch plus a quick foreground).
    {
      const raw = await seeded(ent({ periodType: "trial", expiresAt: T0 + DAY_MS }));
      const d = makeDeps(raw, ent({ expiresAt: T0 + 365 * DAY_MS }), T0 + 2 * DAY_MS);
      const slowRead = d.deps.readRaw;
      d.deps.readRaw = async () => {
        await new Promise((r) => setTimeout(r, 5));
        return slowRead();
      };
      const results = await Promise.all([evaluateThanks(d.deps), evaluateThanks(d.deps)]);
      eq("overlapping evaluations keep one pending mark", stored(d.box).pendingConvertedAt, T0 + 2 * DAY_MS);
      eq("and both report the same waiting moment", results, ["converted", "converted"]);
    }
  }

  section("J2. What's new and the thank-you sheet never lose each other");
  {
    const a = claimSheet();
    ok("the first sheet gets the slot", a !== null);
    eq("the second sheet is told to wait", claimSheet(), null);
    ok("the slot reads as taken", sheetClaimed());
    let woke = 0;
    const off = onSheetRelease(() => woke++);
    (a as () => void)();
    eq("releasing wakes the waiting sheet", woke, 1);
    (a as () => void)();
    eq("a second release is harmless", woke, 1);
    const b = claimSheet();
    ok("then the other sheet gets its turn", b !== null);
    (b as () => void)();
    off();
    ok("slot free at the end", !sheetClaimed());

    // The real hosts: simultaneous triggers, one after the other.
    const thanks = src("components/ThanksSheet.tsx");
    const whats = src("components/WhatsNewSheet.tsx");
    ok("thanks claims the slot through the presenter", /claim: claimSheet/.test(thanks));
    ok("thanks waits on a held slot or open overlay", /overlayOpen: overlayOpen\(\) \|\| sheetClaimed\(\)/.test(thanks));
    ok("thanks looks again when the slot or an overlay is released", /onSheetRelease\(bump\)/.test(thanks) && /onSurveyRelease\(bump\)/.test(thanks));
    ok("thanks releases the slot once the sheet is gone", /if \(!visible\) presenter\.current\?\.releaseClaim\(\)/.test(thanks));
    const attempt = src("lib/whatsNewAttempt.ts");
    ok("what's new claims the slot before it consumes its flag", /d\.claim\(\)[\s\S]{0,700}takeWhatsNew/.test(attempt) && /claim: claimSheet/.test(whats));
    ok("what's new gives the slot back when it does not open", /if \(!opened\) slot\(\)/.test(attempt));
    ok("what's new wakes on both the slot and the overlay release", /onSheetRelease\(wake\)/.test(whats) && /onSurveyRelease\(wake\)/.test(whats));
    ok("what's new is driven by the tested scheduler", /createWhatsNewScheduler\(/.test(whats) && /scheduler\.current\?\.onRelease\(\)/.test(whats) && /scheduler\.current\?\.start\(\)/.test(whats));
    ok("both sheets register as overlays", /useOverlayPresence\(visible\)/.test(thanks) && /useOverlayPresence\(visible\)/.test(whats));
  }

  section("H3. a stale snapshot is only a seed (45 days)");
  {
    const limit = 45 * DAY_MS;
    const trialPrev = snap({ periodType: "trial", expiresAt: T0 - limit - 1000 }, T0 - limit);
    const paid = ent({ expiresAt: T0 + 365 * DAY_MS });
    eq("conversion exactly 45 days after the last look is shown", run(trialPrev, paid).outcome, "converted");
    const staleTrial = snap({ periodType: "trial", expiresAt: T0 - limit - 1000 }, T0 - limit - 1);
    const stale = run(staleTrial, paid);
    eq("conversion seen 45 days and 1 ms after the last look is silent", stale.outcome, "none");
    eq("and it re-seeds from the current entitlement", [stale.next.periodType, stale.next.observedAt], ["normal", T0]);
    const renewPrev = snap({ expiresAt: T0 - 1000 }, T0 - limit);
    eq("renewal exactly 45 days after the last look is shown", run(renewPrev, paid).outcome, "renewed");
    eq("renewal after more than 45 days is silent", run(snap({ expiresAt: T0 - 1000 }, T0 - limit - 1), paid).outcome, "none");
    eq("an old snapshot restored from a backup (months) is silent", run(snap({ periodType: "trial", expiresAt: T0 - 200 * DAY_MS }, T0 - 200 * DAY_MS), paid).outcome, "none");
  }

  section("M. RevenueCat entitlement mapping");
  {
    // Shapes follow react-native-purchases' PurchasesEntitlementInfo.
    const rc = (over: Record<string, unknown> = {}) => ({
      identifier: "pro",
      isActive: true,
      willRenew: true,
      periodType: "NORMAL",
      latestPurchaseDate: "2026-10-01T10:00:00Z",
      originalPurchaseDate: "2026-10-01T10:00:00Z",
      expirationDate: "2027-10-01T10:00:00Z",
      store: "APP_STORE",
      productIdentifier: "zerospike_pro_annual",
      isSandbox: false,
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      ownershipType: "PURCHASED",
      ...over,
    });
    eq("no entitlement is inactive", mapEntitlement(undefined).active, false);
    eq("null is inactive", mapEntitlement(null).active, false);
    eq("a purchased annual", mapEntitlement(rc()), {
      active: true,
      periodType: "normal",
      expiresAt: Date.parse("2027-10-01T10:00:00Z"),
      productId: "zerospike_pro_annual",
      billingIssueDetectedAt: null,
      familyShared: false,
    });
    eq("TRIAL maps to trial", mapEntitlement(rc({ periodType: "TRIAL" })).periodType, "trial");
    eq("INTRO maps to intro", mapEntitlement(rc({ periodType: "INTRO" })).periodType, "intro");
    eq("anything else maps to unknown", mapEntitlement(rc({ periodType: "PREPAID" })).periodType, "unknown");
    eq("FAMILY_SHARED maps to familyShared", mapEntitlement(rc({ ownershipType: "FAMILY_SHARED" })).familyShared, true);
    eq("PURCHASED is not shared", mapEntitlement(rc({ ownershipType: "PURCHASED" })).familyShared, false);
    eq("UNKNOWN is not shared", mapEntitlement(rc({ ownershipType: "UNKNOWN" })).familyShared, false);
    eq("a missing ownershipType is not shared", mapEntitlement(rc({ ownershipType: undefined })).familyShared, false);
    eq("billingIssueDetectedAt is parsed", mapEntitlement(rc({ billingIssueDetectedAt: "2026-10-20T08:30:00Z" })).billingIssueDetectedAt, Date.parse("2026-10-20T08:30:00Z"));
    eq("a null billing issue stays null", mapEntitlement(rc({ billingIssueDetectedAt: null })).billingIssueDetectedAt, null);
    eq("an empty product id is null", mapEntitlement(rc({ productIdentifier: "" })).productId, null);
    eq("a garbage date is null", mapEntitlement(rc({ billingIssueDetectedAt: "soon", expirationDate: "later" })).expiresAt, null);
    eq("a lifetime (no expiration) has no expiry", mapEntitlement(rc({ expirationDate: null, productIdentifier: "zerospike_pro_lifetime" })).expiresAt, null);
    eq("Android base-plan id is kept whole", mapEntitlement(rc({ productIdentifier: "zerospike_pro:annual" })).productId, "zerospike_pro:annual");
    ok("purchases.ts maps through the pure mapper", /return mapEntitlement\(info\?\.entitlements\?\.active\?\.\[ENTITLEMENT_ID\]\);/.test(src("lib/services/purchases.ts")));
  }

  section("J3. the What's new host does not poll (real scheduler, fake clock)");
  {
    /** A fake clock: timers fire in order as time is advanced. */
    const makeClock = () => {
      let now = 0;
      let seq = 0;
      const timers = new Map<number, { at: number; fn: () => void }>();
      return {
        setTimer: (fn: () => void, ms: number) => {
          const id = ++seq;
          timers.set(id, { at: now + ms, fn });
          return id;
        },
        clearTimer: (h: unknown) => void timers.delete(h as number),
        pending: () => timers.size,
        advance: async (ms: number) => {
          const end = now + ms;
          for (;;) {
            const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at;
            timers.delete(next[0]);
            next[1].fn();
            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setImmediate(r));
          }
          now = end;
        },
      };
    };
    const makeKv = (seen: string | null) => {
      const m = new Map<string, string>();
      if (seen) m.set("zerospike.whatsNew.seen", seen);
      const stats = { reads: 0 };
      const kv = {
        get: async (k: string) => {
          stats.reads++;
          return m.get(k) ?? null;
        },
        set: async (k: string, v: string) => void m.set(k, v),
      };
      return { kv, stats, m };
    };
    const DELAY = 3000;
    function runHost(kv: any, opts: { gateOpen?: () => boolean; appVersion?: string } = {}) {
      const clock = makeClock();
      const host = { attempts: 0, visible: false, slot: null as null | (() => void), cleanup: (() => {}) as () => void, results: [] as string[], reruns: 0 };
      const sch = createWhatsNewScheduler({
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        delayMs: DELAY,
        eligible: () => !host.visible,
        gateOpen: opts.gateOpen ?? (() => true),
        attempt: () => {
          host.attempts++;
          return attemptWhatsNew({
            claim: claimSheet,
            kv,
            askedAtStart: false,
            latest: () => ({ root: "(tabs)", onboarded: true }),
            surveyHeld: () => false,
            appVersion: opts.appVersion ?? "2.5.0",
            open: (slot) => {
              host.slot = slot;
              host.visible = true;
            },
          }).then((r) => {
            host.results.push(r);
            return r;
          });
        },
        rerun: () => {
          host.reruns++;
          host.cleanup();
          host.cleanup = sch.start();
        },
      });
      const off = onSheetRelease(() => sch.onRelease());
      host.cleanup = sch.start();
      return {
        host,
        clock,
        sch,
        close: () => {
          host.visible = false;
          host.slot?.();
          host.slot = null;
          host.cleanup();
          host.cleanup = sch.start();
        },
        stop: () => {
          host.cleanup();
          off();
        },
      };
    }

    // Already seen: one attempt in the whole session, however long it runs.
    {
      const k = makeKv("2.5.0");
      const h = runHost(k.kv);
      await h.clock.advance(DELAY * 40);
      h.stop();
      eq("nothing to show: one attempt in 40 delays", h.host.attempts, 1);
      eq("nothing to show: the answer was final", h.host.results, ["nothing"]);
      ok("nothing to show: a handful of reads, not one set per delay", k.stats.reads <= 4);
      eq("nothing to show: no timer left running", h.clock.pending(), 0);
      ok("the slot is free afterwards", !sheetClaimed());
    }
    // Due: opens once, and closing it does not start another round.
    {
      const k = makeKv(null);
      const h = runHost(k.kv);
      await h.clock.advance(DELAY + 10);
      eq("due: it opened", h.host.visible, true);
      ok("due: the slot is held while it is up", sheetClaimed());
      h.close();
      await h.clock.advance(DELAY * 10);
      h.stop();
      eq("due: one attempt only, the flag is spent", h.host.attempts, 1);
      ok("due: the slot is free once it closed", !sheetClaimed());
    }
    // Thanks holds the slot: What's new waits, then opens once after the release.
    {
      const k = makeKv(null);
      const thanksSlot = claimSheet() as () => void;
      const h = runHost(k.kv);
      await h.clock.advance(DELAY * 4);
      eq("held slot: it did not open over the thank-you sheet", h.host.visible, false);
      eq("held slot: it was turned away once, not polling", h.host.results, ["busy"]);
      eq("held slot: the flag is untouched", k.m.get("zerospike.whatsNew.seen"), undefined);
      eq("held slot: not done, it is waiting", h.sch.isDone(), false);
      thanksSlot();
      await h.clock.advance(DELAY + 10);
      eq("released slot: it opens after all", h.host.visible, true);
      eq("released slot: exactly two attempts, busy then opened", h.host.results, ["busy", "opened"]);
      h.close();
      await h.clock.advance(DELAY * 6);
      h.stop();
      eq("and nothing more after it closes", h.host.attempts, 2);
    }
    // A refused gate (winback, an open Modal) also waits for a release, and is not final.
    {
      const k = makeKv(null);
      let open = false;
      const h = runHost(k.kv, { gateOpen: () => open });
      await h.clock.advance(DELAY * 3);
      eq("gate refused: no attempt, no polling", h.host.attempts, 0);
      eq("gate refused: not done", h.sch.isDone(), false);
      open = true;
      const other = claimSheet() as () => void;
      other();
      await h.clock.advance(DELAY + 10);
      eq("gate refused: a release wakes it and it opens", h.host.visible, true);
      h.close();
      h.stop();
    }
    // Its own release never wakes it.
    {
      const k = makeKv("2.5.0");
      const h = runHost(k.kv);
      await h.clock.advance(DELAY + 10);
      const reruns = h.host.reruns;
      const s = claimSheet() as () => void;
      s();
      await h.clock.advance(DELAY * 5);
      h.stop();
      eq("a finished host ignores later releases", [h.host.attempts, h.host.reruns - reruns], [1, 0]);
    }
    // The result-to-memory mapping, one answer at a time.
    {
      const probe = (r: "busy" | "retry" | "nothing" | "opened") => {
        const m = createAttemptMemory();
        applyAttemptResult(m, r);
        return { done: m.isDone(), waiting: m.takeWake() };
      };
      eq("busy waits and is not final", probe("busy"), { done: false, waiting: true });
      eq("retry waits and is not final", probe("retry"), { done: false, waiting: true });
      eq("nothing is final", probe("nothing"), { done: true, waiting: false });
      eq("opened is final", probe("opened"), { done: true, waiting: false });
      const m = createAttemptMemory();
      m.markWaiting();
      eq("a wake is handed out once", [m.takeWake(), m.takeWake()], [true, false]);
    }
  }

  section("J4. the thank-you presenter: settle, re-check, watchdog, attempts, seen only on confirm");
  {
    const makeClock = () => {
      let now = 0;
      let seq = 0;
      const timers = new Map<number, { at: number; fn: () => void }>();
      return {
        setTimer: (fn: () => void, ms: number) => {
          const id = ++seq;
          timers.set(id, { at: now + ms, fn });
          return id;
        },
        clearTimer: (h: unknown) => void timers.delete(h as number),
        pending: () => timers.size,
        advance: (ms: number) => {
          const end = now + ms;
          for (;;) {
            const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at;
            timers.delete(next[0]);
            next[1].fn();
          }
          now = end;
        },
      };
    };
    const SETTLE = 100;
    const TIMEOUT = 400;
    const MAX = 3;
    function make(over: Partial<PresenterDeps> = {}) {
      const clock = makeClock();
      const w = {
        visible: false,
        pendingCleared: 0,
        seen: 0,
        nudges: 0,
        claims: 0,
        releases: 0,
        slotFree: true,
        gate: true,
        visibleCalls: [] as boolean[],
      };
      const p = createSheetPresenter({
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        clear: () => w.gate,
        claim: () => {
          if (!w.slotFree) return null;
          w.slotFree = false;
          w.claims++;
          let done = false;
          return () => {
            if (done) return;
            done = true;
            w.slotFree = true;
            w.releases++;
          };
        },
        setVisible: (v) => {
          w.visible = v;
          w.visibleCalls.push(v);
        },
        clearPending: () => void w.pendingCleared++,
        onSeen: () => void w.seen++,
        nudge: () => void w.nudges++,
        settleMs: SETTLE,
        timeoutMs: TIMEOUT,
        maxAttempts: MAX,
        ...over,
      });
      return { p, clock, w };
    }

    eq("defaults: a real settle delay", SETTLE_MS > 0, true);
    eq("defaults: a real timeout", SHOW_TIMEOUT_MS > SETTLE_MS, true);
    eq("defaults: a real attempt cap", MAX_SHOW_ATTEMPTS >= 1, true);

    // Settle: nothing before it, the sheet after it.
    {
      const { p, clock, w } = make();
      p.schedule();
      clock.advance(SETTLE - 1);
      eq("settle: not open before the delay", w.visible, false);
      clock.advance(1);
      eq("settle: open after the delay", w.visible, true);
      eq("settle: the slot is held", w.slotFree, false);
      eq("settle: one attempt counted", p.attempts(), 1);
      eq("settle: nothing is seen yet", [w.seen, w.pendingCleared], [0, 0]);
    }
    // The way closing during the settle delay.
    {
      const { p, clock, w } = make();
      p.schedule();
      clock.advance(SETTLE - 1);
      w.gate = false;
      clock.advance(1);
      eq("re-check: a gate that closed during settle keeps the sheet down", w.visible, false);
      eq("re-check: and no attempt or claim is spent", [p.attempts(), w.claims], [0, 0]);
    }
    // The cancel returned to the effect cleanup.
    {
      const { p, clock, w } = make();
      const cancel = p.schedule();
      cancel();
      clock.advance(SETTLE * 3);
      eq("cancel: a cleaned-up effect never opens", [w.visible, w.claims], [false, 0]);
      eq("cancel: no timer left", clock.pending(), 0);
    }
    // A held slot.
    {
      const { p, clock, w } = make();
      w.slotFree = false;
      p.schedule();
      clock.advance(SETTLE);
      eq("slot held elsewhere: no sheet, no attempt", [w.visible, p.attempts()], [false, 0]);
    }
    // onShown in time.
    {
      const { p, clock, w } = make();
      p.schedule();
      clock.advance(SETTLE + TIMEOUT - 10);
      p.confirm();
      eq("confirm: the watchdog timer is cancelled right away", clock.pending(), 0);
      eq("confirm: seen once", w.seen, 1);
      eq("confirm: the pending mark is cleared", w.pendingCleared, 1);
      p.confirm();
      eq("confirm: a second call is ignored", [w.seen, w.pendingCleared], [1, 1]);
      clock.advance(TIMEOUT * 3);
      eq("confirm: the watchdog is disarmed", [w.visible, w.nudges], [true, 0]);
      eq("confirm: no timer left", clock.pending(), 0);
    }
    // The watchdog: no onShown.
    {
      const { p, clock, w } = make();
      p.schedule();
      clock.advance(SETTLE);
      clock.advance(TIMEOUT - 1);
      eq("watchdog: waits for the timeout", w.visible, true);
      clock.advance(1);
      eq("watchdog: the sheet is taken down", w.visible, false);
      eq("watchdog: the slot is given back", [w.slotFree, w.releases], [true, 1]);
      eq("watchdog: nothing was stamped or cleared (the moment stays pending)", [w.seen, w.pendingCleared], [0, 0]);
      eq("watchdog: the host is nudged to try again", w.nudges, 1);
      p.confirm();
      eq("watchdog: a late onShown cannot stamp it", [w.seen, w.pendingCleared], [0, 0]);
    }
    // Attempts and the cap.
    {
      const { p, clock, w } = make();
      for (let i = 0; i < MAX; i++) {
        p.schedule();
        clock.advance(SETTLE + TIMEOUT);
      }
      eq("attempts: counted per presentation", p.attempts(), MAX);
      eq("attempts: each one claimed and released", [w.claims, w.releases], [MAX, MAX]);
      p.schedule();
      clock.advance(SETTLE + TIMEOUT);
      eq("cap: no more than MAX attempts", [p.attempts(), w.claims, w.visible], [MAX, MAX, false]);
      eq("cap: the visible calls are only open/close pairs", w.visibleCalls.length, MAX * 2);
    }
    // Foreground resets the budget.
    {
      const { p, clock, w } = make();
      for (let i = 0; i < MAX; i++) {
        p.schedule();
        clock.advance(SETTLE + TIMEOUT);
      }
      const nudges = w.nudges;
      p.foreground();
      eq("foreground: the attempt budget is reset", p.attempts(), 0);
      eq("foreground: the flow is restarted", w.nudges, nudges + 1);
      p.schedule();
      clock.advance(SETTLE);
      eq("foreground: the pending moment is tried again", w.visible, true);
    }
    // Background drops the timers and an unconfirmed presentation.
    {
      const { p, clock, w } = make();
      p.schedule();
      p.background();
      clock.advance(SETTLE * 5);
      eq("background during settle: nothing opens", [w.visible, w.claims], [false, 0]);
      eq("background during settle: no timer left", clock.pending(), 0);

      const b = make();
      b.p.schedule();
      b.clock.advance(SETTLE);
      eq("background during watchdog: sheet is up first", b.w.visible, true);
      b.p.background();
      eq("background during watchdog: the unconfirmed sheet is taken down", b.w.visible, false);
      eq("background during watchdog: slot released, nothing stamped", [b.w.slotFree, b.w.seen, b.w.pendingCleared], [true, 0, 0]);
      eq("background during watchdog: no timer left", b.clock.pending(), 0);
      b.clock.advance(TIMEOUT * 3);
      eq("background during watchdog: the watchdog never fires later", b.w.nudges, 0);
      b.p.foreground();
      b.p.schedule();
      b.clock.advance(SETTLE);
      eq("foreground after background: the flow restarts", b.w.visible, true);

      // A sheet the user already sees (confirmed) is left alone.
      const c = make();
      c.p.schedule();
      c.clock.advance(SETTLE);
      c.p.confirm();
      c.p.background();
      eq("background with the sheet confirmed: it stays", c.w.visible, true);
    }
    // dispose
    {
      const { p, clock, w } = make();
      p.schedule();
      clock.advance(SETTLE);
      p.dispose();
      eq("dispose: timers and slot released", [clock.pending(), w.slotFree], [0, true]);
    }

    // Wiring: the component only calls the presenter, and stamps nowhere else.
    const sheet = src("components/ThanksSheet.tsx");
    ok("the host builds its sheet flow from the presenter", /createSheetPresenter\(/.test(sheet) && /presenter\.current\?\.schedule\(\)/.test(sheet));
    ok("onShown goes to the presenter's confirm", /onShown=\{confirmConverted\}/.test(sheet) && /presenter\.current\?\.confirm\(\)/.test(sheet));
    eq("the stamp is written nowhere but the presenter's onSeen", (sheet.match(/confirmThanksNow\("converted"\)/g) ?? []).length, 1);
    eq("the event is logged nowhere but the presenter's onSeen", (sheet.match(/logEvent\("trial_converted_seen"\)/g) ?? []).length, 1);
    ok("background and foreground reach the presenter", /presenter\.current\?\.background\(\)/.test(sheet) && /presenter\.current\?\.foreground\(\)/.test(sheet));
    ok("the toast is stamped where it is shown", /confirmThanksNow\("renewed"\)/.test(sheet) && /toast\(t\("thanks\.renewalToast"\)/.test(sheet));
    ok("a card tap asks for no review, close does", (sheet.match(/maybeRequestReview\(/g) ?? []).length === 1 && /const close = useCallback\(\(\) => \{[\s\S]*?maybeRequestReview/.test(sheet));
  }

  section("K. presentation gate");
  {
    const open: ThanksGate = {
      ready: true,
      onboarded: true,
      screenshotMode: false,
      root: "(tabs)",
      overlayOpen: false,
      winbackHold: false,
      sheetVisible: false,
    };
    eq("a clear tab screen presents", thanksMayPresent(open), true);
    eq("not ready", thanksMayPresent({ ...open, ready: false }), false);
    eq("onboarding unfinished", thanksMayPresent({ ...open, onboarded: false }), false);
    eq("on the onboarding route", thanksMayPresent({ ...open, root: "onboarding" }), false);
    eq("on the paywall", thanksMayPresent({ ...open, root: "paywall" }), false);
    eq("on the downsell", thanksMayPresent({ ...open, root: "downsell" }), false);
    eq("on the winback", thanksMayPresent({ ...open, root: "winback" }), false);
    eq("on another modal route", thanksMayPresent({ ...open, root: "calculator" }), false);
    eq("with a Modal open", thanksMayPresent({ ...open, overlayOpen: true }), false);
    eq("while the winback decides", thanksMayPresent({ ...open, winbackHold: true }), false);
    eq("in screenshot mode", thanksMayPresent({ ...open, screenshotMode: true }), false);
    eq("while the sheet is already up", thanksMayPresent({ ...open, sheetVisible: true }), false);
  }

  section("L. wiring and copy");
  {
    const layout = src("app/_layout.tsx");
    ok("the root layout mounts ThanksHost", /<ThanksHost root=\{root\} \/>/.test(layout));
    const sheet = src("components/ThanksSheet.tsx");
    ok("the sheet asks for the review through the shared gateway", /maybeRequestReview\("trial_converted"\)/.test(sheet));
    ok("the sheet is stamped as seen from its onShown, not before", /onShown=\{confirmConverted\}/.test(sheet));
    ok("the review is asked only from the close path, not from a card", /const close = useCallback\(\(\) => \{[\s\S]*?maybeRequestReview\("trial_converted"\)[\s\S]*?\}, \[confirmConverted, later\]\);/.test(sheet) && (sheet.match(/maybeRequestReview\(/g) ?? []).length === 1);
    ok("a card tap leaves without a review", /const onCard = useCallback\([\s\S]*?\[confirmConverted, later, router\]/.exec(sheet)![0].indexOf("maybeRequestReview") === -1);
    ok("the seen events are logged", /logEvent\("trial_converted_seen"\)/.test(sheet) && /logEvent\("renewal_seen"\)/.test(sheet));
    ok("no font shrinking", !/adjustsFontSizeToFit/.test(sheet));
    ok("no hard-coded colour in the sheet", !/#[0-9a-fA-F]{3,8}\b/.test(sheet) && !/rgba?\(/.test(sheet));
    ok("the sheet and the toast go through the same gate", (sheet.match(/clear\(\)/g) ?? []).length >= 2);
    ok("the cards use existing routes", /"\/settings\/data"/.test(sheet) && /"\/spike"/.test(sheet) && /health: "connect"/.test(sheet));
    ok("whatsNew does not carry the thanks copy", !/thanks/.test(src("lib/whatsNew.ts")));
    const svc = src("lib/services/thanks.ts");
    ok("one unscoped account key", /THANKS_STATE_KEY/.test(svc) && !/profileId|activeProfile/.test(svc));
    const purchases = src("lib/services/purchases.ts");
    ok("the entitlement read does not force the network", /export async function getEntitlementSnapshot[\s\S]*?fetchCustomerInfo\(\)/.test(purchases) && !/invalidateCustomerInfoCache|syncPurchases/.test(purchases.slice(purchases.indexOf("getEntitlementSnapshot"), purchases.indexOf("getEntitlementSnapshot") + 900)));

    const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
    const keys = ["title", "body", "nextLabel", "reportTitle", "reportBody", "healthTitle", "healthBody", "spikeTitle", "spikeBody", "renewalToast"];
    for (const l of langs) {
      const text = src(`lib/i18n/locales/${l}.ts`);
      const m = /\n  thanks: \{\n([\s\S]*?)\n  \},\n/.exec(text);
      ok(`${l}: thanks block exists`, m !== null);
      const block = m ? m[1] : "";
      for (const k of keys) ok(`${l}: thanks.${k}`, new RegExp(`\\n?\\s{4}${k}: "[^"]+",`).test(block + "\n"));
      ok(`${l}: no em-dash`, !new RegExp(String.fromCharCode(0x2014)).test(block));
      ok(`${l}: no hard-coded percent sign`, !/%/.test(block));
    }
    const trBlock = /\n  thanks: \{\n([\s\S]*?)\n  \},\n/.exec(src("lib/i18n/locales/tr.ts"))![1];
    ok("tr title", trBlock.includes('title: "Pro\'ya geçtiniz, teşekkür ederiz"'));
    ok("tr toast", trBlock.includes('renewalToast: "Desteğiniz için teşekkürler"'));
    const banned = /(uyar[ıi]r|tan[ıi]|tedavi|doz\b|alarm)/i;
    ok("tr copy avoids the regulated roots", !banned.test(trBlock));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
