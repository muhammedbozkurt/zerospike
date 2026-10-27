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
import { evaluateThanks, type ThanksDeps } from "../lib/thanks/evaluate";
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
  return { active: true, periodType: "normal", expiresAt: T0 + 365 * DAY_MS, productId: ANNUAL, ...over };
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

  section("D. renewal and the 365 day limit");
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
    eq("last toast 364 days ago: silent", run(before, after, T0, last(364)).outcome, "none");
    eq("last toast 365 days minus 1 ms ago: silent", run(before, after, T0, { convertedSeenAt: null, renewalToastAt: T0 - 365 * DAY_MS + 1 }).outcome, "none");
    eq("last toast exactly 365 days ago: shown", run(before, after, T0, last(365)).outcome, "renewed");
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
    const again = run({ ...r.next, expiresAt: T0 + 365 * DAY_MS }, ent({ productId: ANNUAL, expiresAt: T0 + 730 * DAY_MS }), T0 + 366 * DAY_MS);
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

  section("I. state parsing");
  {
    eq("empty", parseThanksState(null), EMPTY_THANKS_STATE);
    eq("garbage", parseThanksState("{nope"), EMPTY_THANKS_STATE);
    eq("array", parseThanksState("[]"), EMPTY_THANKS_STATE);
    eq("wrong types are dropped", parseThanksState(JSON.stringify({ snapshot: { active: "yes" }, convertedSeenAt: "x", renewalToastAt: NaN })), EMPTY_THANKS_STATE);
    const full = { snapshot: snap({ periodType: "trial" }, T0), convertedSeenAt: T0, renewalToastAt: T0 - DAY_MS };
    eq("round trip", parseThanksState(serializeThanksState(full)), full);
    eq("an unknown period reads as unknown", parseThanksState(JSON.stringify({ snapshot: { ...snap(), periodType: "weird" }, convertedSeenAt: null, renewalToastAt: null })).snapshot?.periodType, "unknown");
    eq("the key is the one account-level key", THANKS_STATE_KEY, "zerospike.thanks.v1");
  }

  section("J. evaluation: persisted before shown, installs never shown");
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
      eq(`${name}: no stamps`, [stored(d.box).convertedSeenAt, stored(d.box).renewalToastAt], [null, null]);
    }
    // ...and the next observation after a restore-while-paid is still silent.
    {
      const d1 = makeDeps(null, ent());
      await evaluateThanks(d1.deps);
      const d2 = makeDeps(d1.box.raw, ent(), T0 + 2 * DAY_MS);
      eq("an unchanged entitlement stays silent", await evaluateThanks(d2.deps), "none");
    }

    // Store unreachable: no answer, no write.
    {
      const d = makeDeps(null, null);
      eq("unreachable store: none", await evaluateThanks(d.deps), "none");
      eq("unreachable store: nothing written", d.log.length, 0);
    }

    // Conversion: stamp and snapshot are on disk before the result returns.
    {
      const seed = makeDeps(null, ent({ periodType: "trial", expiresAt: T0 + DAY_MS }), T0);
      await evaluateThanks(seed.deps);
      const d = makeDeps(seed.box.raw, ent({ periodType: "normal", expiresAt: T0 + 365 * DAY_MS }), T0 + 2 * DAY_MS);
      const order: string[] = [];
      const inner = d.deps.writeRaw;
      d.deps.writeRaw = async (raw) => {
        await inner(raw);
        order.push("written");
      };
      const out = await evaluateThanks(d.deps).then((o) => {
        order.push("returned");
        return o;
      });
      eq("trial then paid: converted", out, "converted");
      eq("the stamp is written before the result is handed back", order, ["written", "returned"]);
      eq("convertedSeenAt is the decision time", stored(d.box).convertedSeenAt, T0 + 2 * DAY_MS);
      eq("renewalToastAt untouched", stored(d.box).renewalToastAt, null);
      // A crash right after: the next launch must not repeat it.
      const relaunch = makeDeps(d.box.raw, ent({ periodType: "normal", expiresAt: T0 + 365 * DAY_MS }), T0 + 2 * DAY_MS + 5000);
      eq("after a crash the conversion does not repeat", await evaluateThanks(relaunch.deps), "none");
      // Even if the snapshot were somehow trial again, the lifetime stamp holds.
      const forged = parseThanksState(d.box.raw);
      const again = makeDeps(
        serializeThanksState({ ...forged, snapshot: snap({ periodType: "trial", expiresAt: T0 }, T0 + 3 * DAY_MS) }),
        ent({ periodType: "normal", expiresAt: T0 + 400 * DAY_MS }),
        T0 + 4 * DAY_MS
      );
      eq("the lifetime stamp blocks a second conversion", await evaluateThanks(again.deps), "none");
    }

    // Renewal.
    {
      const seed = makeDeps(null, ent({ expiresAt: T0 + DAY_MS }), T0);
      await evaluateThanks(seed.deps);
      const d = makeDeps(seed.box.raw, ent({ expiresAt: T0 + DAY_MS + 365 * DAY_MS }), T0 + 2 * DAY_MS);
      eq("renewal: shown", await evaluateThanks(d.deps), "renewed");
      eq("renewalToastAt stamped", stored(d.box).renewalToastAt, T0 + 2 * DAY_MS);
      eq("convertedSeenAt untouched", stored(d.box).convertedSeenAt, null);
      const next = makeDeps(d.box.raw, ent({ expiresAt: T0 + DAY_MS + 730 * DAY_MS }), T0 + 200 * DAY_MS);
      eq("another renewal inside the year is silent", await evaluateThanks(next.deps), "none");
      eq("and still moves the snapshot on", stored(next.box).snapshot?.expiresAt, T0 + DAY_MS + 730 * DAY_MS);
    }

    // A failed write is not a show.
    {
      const seed = makeDeps(null, ent({ periodType: "trial", expiresAt: T0 + DAY_MS }), T0);
      await evaluateThanks(seed.deps);
      const d = makeDeps(seed.box.raw, ent({ expiresAt: T0 + 365 * DAY_MS }), T0 + 2 * DAY_MS);
      d.deps.writeRaw = async () => {
        throw new Error("disk full");
      };
      eq("a failed write is not shown", await evaluateThanks(d.deps), "none");
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
      const seed = makeDeps(null, ent({ periodType: "trial", expiresAt: T0 + DAY_MS }), T0);
      await evaluateThanks(seed.deps);
      const d = makeDeps(seed.box.raw, ent({ expiresAt: T0 + 365 * DAY_MS }), T0 + 2 * DAY_MS);
      const slowRead = d.deps.readRaw;
      d.deps.readRaw = async () => {
        await new Promise((r) => setTimeout(r, 5));
        return slowRead();
      };
      const results = await Promise.all([evaluateThanks(d.deps), evaluateThanks(d.deps)]);
      eq("overlapping evaluations show at most once", results.filter((r) => r === "converted").length, 1);
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
    ok("the review is requested from the sheet's onShown", /onShown=\{onShown\}/.test(sheet));
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
