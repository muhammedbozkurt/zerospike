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
import {
  applyAttemptResult,
  attemptWhatsNew,
  createAttemptMemory,
  createWhatsNewHostController,
  createWhatsNewScheduler,
  whatsNewEffectKey,
} from "../lib/whatsNewAttempt";
import { createThanksController } from "../lib/thanks/controller";
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
    const ctlSrc = src("lib/thanks/controller.ts");
    ok("thanks waits on a held slot or open overlay", /d\.overlayOpen\(\) \|\| d\.sheetClaimed\(\)/.test(ctlSrc));
    ok("thanks looks again when the slot or an overlay is released", /d\.onSurveyRelease\(d\.nudge\)/.test(ctlSrc) && /d\.onSheetRelease\(d\.nudge\)/.test(ctlSrc));
    ok("thanks hands the real slot claim to the controller", /\n\s+claim: claimSheet,\n/.test(thanks));
    const attempt = src("lib/whatsNewAttempt.ts");
    ok("what's new claims the slot before it consumes its flag", /d\.claim\(\)[\s\S]{0,700}takeWhatsNew/.test(attempt) && /claim: claimSheet/.test(whats));
    ok("what's new gives the slot back when it does not open", /if \(!opened\) slot\(\)/.test(attempt));
    ok("what's new is built from the tested controller", /createWhatsNewHostController\(/.test(whats) && /ctl\.listen\(\)/.test(whats) && /ctl\.start\(\)/.test(whats) && /ctl\.onVisible\(visible\)/.test(whats) && /ctl\.onRoute\(visible, root\)/.test(whats) && /ctl\.dispose/.test(whats));
    ok("what's new's effect depends on the tested key", /whatsNewEffectKey\(\{ ready, onboarded, root, visible \}, slotTick\)/.test(whats) && /\[ctl, effectKey\]/.test(whats));
    ok("what's new passes the real slot, overlay and release sources", /\n\s+claim: claimSheet,\n/.test(whats) && /\n\s+overlayOpen,\n/.test(whats) && /\n\s+onSheetRelease,\n/.test(whats) && /\n\s+onSurveyRelease,\n/.test(whats) && /bumpTick: \(\) => setSlotTick/.test(whats) && /\n\s+setVisible,\n/.test(whats));
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
      eq("background during settle: the settle timer is cancelled at once", clock.pending(), 0);
      p.schedule();
      eq("background: schedule() arms nothing while in the background", clock.pending(), 0);
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

    // Wiring: the component is a thin shell around the controller.
    const sheet = src("components/ThanksSheet.tsx");
    ok("the host is built from the controller", /createThanksController\(/.test(sheet) && /useEffect\(\(\) => ctl\.sheetEffect\(pending\), /.test(sheet) && /ctl\.mayEvaluate\(pending\)/.test(sheet));
    ok("the host hands the controller the real sources", /\n\s+appState: AppState,\n/.test(sheet) && /\n\s+claim: claimSheet,\n/.test(sheet) && /\n\s+sheetClaimed,\n/.test(sheet) && /\n\s+overlayOpen,\n/.test(sheet) && /\n\s+surveyHeld,\n/.test(sheet) && /\n\s+onSheetRelease,\n/.test(sheet) && /\n\s+onSurveyRelease,\n/.test(sheet) && /\n\s+setVisible,\n/.test(sheet) && /\n\s+setPending,\n/.test(sheet));
    ok("the controller's listeners, visible hook and dispose are used", /ctl\.start\(\)/.test(sheet) && /ctl\.onVisible\(visible\)/.test(sheet) && /ctl\.dispose\(\)/.test(sheet));
    ok("onShown goes to the controller's confirm", /onShown=\{confirmConverted\}/.test(sheet) && /ctl\.confirm\(\)/.test(sheet));
    eq("the stamp is written nowhere but the controller's stampSeen", (sheet.match(/confirmThanksNow\("converted"\)/g) ?? []).length, 1);
    eq("the event is logged nowhere but the controller's logSeen", (sheet.match(/logEvent\("trial_converted_seen"\)/g) ?? []).length, 1);
    ok("the toast is stamped where it is shown", /confirmThanksNow\("renewed"\)/.test(sheet) && /toast\(t\("thanks\.renewalToast"\)/.test(sheet));
    ok("a card tap asks for no review, close does", (sheet.match(/maybeRequestReview\(/g) ?? []).length === 1 && /const close = useCallback\(\(\) => \{[\s\S]*?maybeRequestReview/.test(sheet));
  }

  section("J5. the presenter with the production defaults (no overrides)");
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
    const rig = () => {
      const clock = makeClock();
      const w = { visible: false, seen: 0, cleared: 0, nudges: 0, claims: 0, free: true };
      const p = createSheetPresenter({
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        clear: () => true,
        claim: () => {
          if (!w.free) return null;
          w.free = false;
          w.claims++;
          return () => void (w.free = true);
        },
        setVisible: (v) => void (w.visible = v),
        clearPending: () => void w.cleared++,
        onSeen: () => void w.seen++,
        nudge: () => void w.nudges++,
      });
      return { p, clock, w };
    };
    {
      const { p, clock, w } = rig();
      p.schedule();
      clock.advance(SETTLE_MS - 1);
      eq("defaults: the sheet waits the real settle delay", w.visible, false);
      clock.advance(1);
      eq("defaults: and opens right after it", w.visible, true);
      clock.advance(SHOW_TIMEOUT_MS - 1);
      eq("defaults: the sheet is not taken down before the real timeout", w.visible, true);
      clock.advance(1);
      eq("defaults: and is taken down at the real timeout", w.visible, false);
      eq("defaults: nothing was stamped", [w.seen, w.cleared], [0, 0]);
    }
    {
      const { p, clock, w } = rig();
      for (let i = 0; i < MAX_SHOW_ATTEMPTS; i++) {
        p.schedule();
        clock.advance(SETTLE_MS + SHOW_TIMEOUT_MS);
      }
      eq("defaults: MAX_SHOW_ATTEMPTS presentations are made", w.claims, MAX_SHOW_ATTEMPTS);
      p.schedule();
      clock.advance(SETTLE_MS + SHOW_TIMEOUT_MS);
      eq("defaults: and no more", [w.claims, w.visible], [MAX_SHOW_ATTEMPTS, false]);
    }
  }

  section("J6. the thank-you controller: AppState, background inertness, gate, confirm, dispose");
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
    /** A host loop around the REAL controller, presenter, slot and gate: state changes re-run the effects like React would. */
    function mount(initial: { appState?: string } = {}) {
      const clock = makeClock();
      const listeners: Array<(s: string) => void> = [];
      const appState = {
        currentState: initial.appState ?? "active",
        addEventListener: (_t: "change", cb: (s: string) => void) => {
          listeners.push(cb);
          return { remove: () => void listeners.splice(listeners.indexOf(cb), 1) };
        },
      };
      const env = {
        ready: true,
        onboarded: true,
        root: "(tabs)" as string | undefined,
        visible: false,
        pending: "converted" as string,
        overlay: false,
        held: false,
        screenshot: false,
        tick: 0,
        app: appState.currentState,
        log: [] as string[],
        stamps: 0,
        seenWhileBackground: 0,
        openWhileBackground: 0,
      };
      let queued = false;
      let cleanup: (() => void) | undefined;
      let slotListeners: Array<() => void> = [];
      let overlayListeners: Array<() => void> = [];
      const ctl = createThanksController({
        appState,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        claim: claimSheet,
        sheetClaimed,
        onSheetRelease: (cb) => {
          slotListeners.push(cb);
          return () => void (slotListeners = slotListeners.filter((x) => x !== cb));
        },
        onSurveyRelease: (cb) => {
          overlayListeners.push(cb);
          return () => void (overlayListeners = overlayListeners.filter((x) => x !== cb));
        },
        overlayOpen: () => env.overlay,
        surveyHeld: () => env.held,
        screenshotMode: () => env.screenshot,
        latest: () => env,
        setVisible: (v) => {
          if (env.visible === v) return;
          env.visible = v;
          if (v && env.app === "background") env.openWhileBackground++;
          queued = true;
        },
        setPending: (v) => {
          env.pending = v;
          queued = true;
        },
        nudge: () => {
          env.tick++;
          queued = true;
        },
        logSeen: () => {
          env.log.push("seen-event");
          if (env.app === "background") env.seenWhileBackground++;
        },
        stampSeen: () => void env.stamps++,
      });
      const stopListeners = ctl.start();
      const render = () => {
        ctl.onVisible(env.visible);
        cleanup?.();
        cleanup = ctl.sheetEffect(env.pending);
      };
      const flush = () => {
        for (let i = 0; i < 50 && queued; i++) {
          queued = false;
          render();
        }
      };
      render();
      return {
        env,
        ctl,
        clock,
        flush,
        render,
        send: (s: string) => {
          env.app = s;
          appState.currentState = s;
          [...listeners].forEach((cb) => cb(s));
          flush();
        },
        advance: (ms: number) => {
          clock.advance(ms);
          flush();
        },
        fireSlot: () => [...slotListeners].forEach((cb) => cb()),
        fireOverlay: () => [...overlayListeners].forEach((cb) => cb()),
        listenerCount: () => listeners.length + slotListeners.length + overlayListeners.length,
        stop: () => {
          cleanup?.();
          stopListeners();
          ctl.dispose();
        },
      };
    }

    // The background repro: the sheet must not be rebuilt in the background.
    {
      const m = mount();
      m.advance(SETTLE_MS);
      eq("bg: the sheet is up in the foreground", m.env.visible, true);
      m.send("background");
      eq("bg: it is taken down on backgrounding", m.env.visible, false);
      m.advance(SETTLE_MS * 5);
      eq("bg: it never comes back up while in the background", [m.env.visible, m.env.openWhileBackground], [false, 0]);
      eq("bg: nothing is reported or stamped in the background", [m.env.seenWhileBackground, m.env.stamps, m.env.log.length], [0, 0, 0]);
      eq("bg: the moment is still pending", m.env.pending, "converted");
      eq("bg: no timer left running", m.clock.pending(), 0);
      ok("bg: the slot was given back", !sheetClaimed());
      m.send("active");
      m.advance(SETTLE_MS);
      eq("bg: back in the foreground the flow starts once and opens", m.env.visible, true);
      eq("bg: still nothing stamped before onShown", m.env.stamps, 0);
      m.ctl.confirm();
      eq("bg: onShown stamps and reports once", [m.env.stamps, m.env.log], [1, ["seen-event"]]);
      m.stop();
    }
    // inactive (control centre, a call banner) is not the background.
    {
      const m = mount();
      m.advance(SETTLE_MS);
      m.send("inactive");
      eq("inactive: the sheet stays", m.env.visible, true);
      m.send("active");
      eq("inactive then active: nothing changes", m.env.visible, true);
      m.stop();
    }
    // Starting while already in the background.
    {
      const m = mount({ appState: "background" });
      m.env.app = "background";
      m.advance(SETTLE_MS * 4);
      eq("started in the background: nothing opens", [m.env.visible, m.env.openWhileBackground], [false, 0]);
      m.send("active");
      m.advance(SETTLE_MS);
      eq("and it opens once the app is active", m.env.visible, true);
      m.stop();
    }
    // Foreground resets the attempt budget (watchdog loop, then back to the app).
    {
      const m = mount();
      for (let i = 0; i < MAX_SHOW_ATTEMPTS; i++) m.advance(SETTLE_MS + SHOW_TIMEOUT_MS);
      eq("attempts used up: the sheet is down", m.env.visible, false);
      m.advance(SETTLE_MS * 5);
      eq("attempts used up: it stays down", m.env.visible, false);
      m.send("background");
      m.send("active");
      m.advance(SETTLE_MS);
      eq("a foreground return tries again", m.env.visible, true);
      m.stop();
    }
    // The watchdog's nudge reaches the host through the controller.
    {
      const m = mount();
      const before = m.env.tick;
      m.advance(SETTLE_MS + SHOW_TIMEOUT_MS);
      ok("watchdog: the host is nudged through the controller's dependency", m.env.tick > before);
      m.stop();
    }
    // The gate, through the controller.
    {
      const m = mount();
      m.env.overlay = true;
      m.advance(SETTLE_MS * 3);
      eq("gate: an open Modal keeps the sheet down", m.env.visible, false);
      m.env.overlay = false;
      m.fireOverlay();
      m.flush();
      m.advance(SETTLE_MS);
      eq("gate: its release lets the sheet go up", m.env.visible, true);
      m.stop();

      for (const [name, set] of [
        ["a held survey/winback", (e: any) => (e.held = true)],
        ["screenshot mode", (e: any) => (e.screenshot = true)],
        ["a non-tab route", (e: any) => (e.root = "paywall")],
        ["not onboarded", (e: any) => (e.onboarded = false)],
        ["not ready", (e: any) => (e.ready = false)],
      ] as const) {
        const g = mount();
        set(g.env);
        g.flush();
        g.render();
        g.advance(SETTLE_MS * 3);
        eq(`gate: ${name} keeps the sheet down`, [g.env.visible, typeof g.ctl.sheetEffect("converted")], [false, "undefined"]);
        g.stop();
      }
      const other = claimSheet() as () => void;
      const h = mount();
      h.advance(SETTLE_MS * 3);
      eq("gate: another sheet holding the slot keeps it down", h.env.visible, false);
      other();
      h.fireSlot();
      h.flush();
      h.advance(SETTLE_MS);
      eq("gate: the slot release lets it up", h.env.visible, true);
      h.stop();
      const only = mount();
      eq("only the converted moment opens the sheet", [typeof only.ctl.sheetEffect("renewed"), typeof only.ctl.sheetEffect("none"), typeof only.ctl.sheetEffect("converted")], ["undefined", "undefined", "function"]);
      only.stop();
    }
    // The gate is re-checked at the end of settle.
    {
      const m = mount();
      m.advance(SETTLE_MS - 1);
      m.env.overlay = true;
      m.advance(1);
      eq("gate: a Modal that appeared during settle wins", m.env.visible, false);
      m.stop();
    }
    // confirm: pending cleared through the setter, once.
    {
      const m = mount();
      m.advance(SETTLE_MS);
      m.ctl.confirm();
      eq("confirm: the pending mark is cleared through the host's setter", m.env.pending, "none");
      m.ctl.confirm();
      eq("confirm: a second call does nothing", [m.env.stamps, m.env.log.length], [1, 1]);
      m.flush();
      m.advance(SETTLE_MS * 3);
      eq("confirm: the sheet is not rebuilt afterwards", m.env.visible, true);
      m.stop();
    }
    // Opening does not confirm.
    {
      const m = mount();
      m.advance(SETTLE_MS);
      eq("open: visible but nothing is seen yet", [m.env.visible, m.env.stamps, m.env.log.length], [true, 0, 0]);
      m.stop();
    }
    // Releasing the slot when the sheet is gone.
    {
      const m = mount();
      m.advance(SETTLE_MS);
      ok("slot: held while the sheet is up", sheetClaimed());
      m.ctl.confirm();
      m.env.visible = false;
      m.render();
      ok("slot: released once the sheet is gone", !sheetClaimed());
      m.stop();
    }
    // Evaluation: once per foreground.
    {
      const m = mount();
      m.env.pending = "none";
      eq("evaluate: first look is allowed", m.ctl.mayEvaluate("none"), true);
      eq("evaluate: only once per foreground", m.ctl.mayEvaluate("none"), false);
      m.send("active");
      eq("evaluate: a new foreground allows one more", m.ctl.mayEvaluate("none"), true);
      eq("evaluate: not while a moment is pending", m.ctl.mayEvaluate("converted"), false);
      m.env.overlay = true;
      m.send("active");
      eq("evaluate: not behind a Modal", m.ctl.mayEvaluate("none"), false);
      m.stop();
    }
    // Listeners and dispose.
    {
      const m = mount();
      const before = m.env.tick;
      m.fireSlot();
      m.fireOverlay();
      eq("a slot and an overlay release both nudge the host", m.env.tick - before, 2);
      m.advance(SETTLE_MS);
      m.stop();
      eq("stop removes every listener", m.listenerCount(), 0);
      ok("dispose releases the slot", !sheetClaimed());
      eq("dispose leaves no timer", m.clock.pending(), 0);
    }
    {
      const m = mount();
      m.advance(SETTLE_MS);
      m.ctl.dispose();
      eq("dispose with the sheet up: the watchdog cannot fire later", m.clock.pending(), 0);
      ok("dispose with the sheet up: slot released", !sheetClaimed());
      m.stop();
    }
  }

  section("J7. the What's new controller: gate, wake, effect key, slot, route");
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
        advance: async (ms: number) => {
          const end = now + ms;
          for (;;) {
            const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at;
            timers.delete(next[0]);
            next[1].fn();
            for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
          }
          now = end;
        },
      };
    };
    function mount(seen: string | null = null) {
      const clock = makeClock();
      const store = new Map<string, string>();
      if (seen) store.set("zerospike.whatsNew.seen", seen);
      const env = {
        ready: true,
        onboarded: true,
        root: "(tabs)" as string | undefined,
        visible: false,
        overlay: false,
        held: false,
        screenshot: false,
        asked: false as boolean | null,
        bumps: 0,
        visibleCalls: [] as boolean[],
      };
      let slotL: Array<() => void> = [];
      let ovL: Array<() => void> = [];
      const ctl = createWhatsNewHostController({
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        delayMs: 3000,
        latest: () => env,
        screenshotMode: () => env.screenshot,
        surveyHeld: () => env.held,
        overlayOpen: () => env.overlay,
        askedAtStart: () => env.asked,
        claim: claimSheet,
        kv: { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => void store.set(k, v) },
        appVersion: () => "2.5.0",
        setVisible: (v) => {
          env.visible = v;
          env.visibleCalls.push(v);
        },
        bumpTick: () => void env.bumps++,
        onSheetRelease: (cb) => {
          slotL.push(cb);
          return () => void (slotL = slotL.filter((x) => x !== cb));
        },
        onSurveyRelease: (cb) => {
          ovL.push(cb);
          return () => void (ovL = ovL.filter((x) => x !== cb));
        },
      });
      const off = ctl.listen();
      return {
        env,
        ctl,
        clock,
        store,
        start: () => ctl.start(),
        fireSlot: () => [...slotL].forEach((c) => c()),
        fireOverlay: () => [...ovL].forEach((c) => c()),
        listeners: () => slotL.length + ovL.length,
        off,
      };
    }

    // A Modal that is open keeps it down, and its release wakes it (rerun is bumpTick).
    {
      const m = mount();
      m.env.overlay = true;
      const stop = m.start();
      await m.clock.advance(3100);
      eq("surveyBusy: an open Modal keeps What's new down", [m.env.visible, m.store.get("zerospike.whatsNew.seen")], [false, undefined]);
      m.fireOverlay();
      eq("rerun: the release wakes the host through bumpTick", m.env.bumps, 1);
      m.fireOverlay();
      eq("rerun: only once per waiting spell", m.env.bumps, 1);
      stop();
      m.env.overlay = false;
      const stop2 = m.start();
      await m.clock.advance(3100);
      eq("surveyBusy: with the Modal gone it opens", m.env.visible, true);
      stop2();
      m.ctl.dispose();
      m.off();
    }
    // A slot release wakes a host that was turned away by the slot.
    {
      const m = mount();
      const other = claimSheet() as () => void;
      const stop = m.start();
      await m.clock.advance(3100);
      eq("slot held: turned away", m.env.visible, false);
      other();
      m.fireSlot();
      eq("slot release: wakes the host through bumpTick", m.env.bumps, 1);
      stop();
      m.ctl.dispose();
      m.off();
    }
    // The survey flag not read yet, a held winback, screenshot mode.
    for (const [name, set] of [
      ["the survey flag not read yet", (e: any) => (e.asked = null)],
      ["a held winback", (e: any) => (e.held = true)],
      ["screenshot mode", (e: any) => (e.screenshot = true)],
    ] as const) {
      const m = mount();
      set(m.env);
      const stop = m.start();
      await m.clock.advance(3100);
      eq(`gate: ${name} keeps it down`, m.env.visible, false);
      stop();
      m.off();
    }
    // Eligibility.
    {
      for (const [name, set] of [
        ["not ready", (e: any) => (e.ready = false)],
        ["not onboarded", (e: any) => (e.onboarded = false)],
        ["off the tabs", (e: any) => (e.root = "paywall")],
        ["already visible", (e: any) => (e.visible = true)],
      ] as const) {
        const m = mount();
        set(m.env);
        const stop = m.start();
        await m.clock.advance(3100);
        eq(`eligible: ${name} makes no attempt`, m.store.get("zerospike.whatsNew.seen"), undefined);
        stop();
        m.off();
      }
    }
    // The effect key.
    {
      const s = { ready: true, onboarded: true, root: "(tabs)" as string | undefined, visible: false };
      const base = whatsNewEffectKey(s, 0);
      ok("key: a bumped tick changes it", whatsNewEffectKey(s, 1) !== base);
      ok("key: ready changes it", whatsNewEffectKey({ ...s, ready: false }, 0) !== base);
      ok("key: onboarded changes it", whatsNewEffectKey({ ...s, onboarded: false }, 0) !== base);
      ok("key: the route changes it", whatsNewEffectKey({ ...s, root: "paywall" }, 0) !== base);
      ok("key: visible changes it", whatsNewEffectKey({ ...s, visible: true }, 0) !== base);
      eq("key: identical inputs give an identical key", whatsNewEffectKey({ ...s }, 0), base);
    }
    // Slot, route and dispose.
    {
      const m = mount();
      const stop = m.start();
      await m.clock.advance(3100);
      eq("opened", m.env.visible, true);
      ok("slot: held while the sheet is up", sheetClaimed());
      m.ctl.onRoute(true, "paywall");
      eq("route: leaving the tabs takes the sheet down", m.env.visible, false);
      m.ctl.onRoute(true, "(tabs)");
      eq("route: staying on the tabs leaves it", m.env.visibleCalls, [true, false]);
      m.ctl.onVisible(true);
      ok("slot: still held while visible", sheetClaimed());
      m.ctl.onVisible(false);
      ok("slot: released once the sheet is gone", !sheetClaimed());
      stop();
      m.off();
    }
    {
      const m = mount();
      const stop = m.start();
      await m.clock.advance(3100);
      ok("dispose: slot held first", sheetClaimed());
      m.ctl.dispose();
      ok("dispose: slot released", !sheetClaimed());
      stop();
      m.off();
      eq("listen cleanup removes the listeners", m.listeners(), 0);
    }
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
    ok("the toast goes through the controller's gate", /pending !== "renewed" \|\| !ctl\.clear\(\)/.test(sheet));
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
