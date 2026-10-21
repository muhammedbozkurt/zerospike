/**
 * lib/downsellGate.ts correctness harness (2.4 paywall-exit rule: annual
 * selected + cancelled purchase or closed paywall => same-session offer once,
 * then 7-day cool-off, a lifetime cap of 2 and one discount screen per
 * session). No jest, same standalone style as scripts/downsellDay7.test.ts.
 *
 * Run: npx tsx scripts/downsell.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function setTimeout(fn: () => void, ms: number): unknown;

import { shouldTriggerDay7 } from "../lib/day7Downsell";
import {
  DOWNSELL_MAX_SHOWS,
  DOWNSELL_REARM_MS,
  canShowDownsell,
  applyDownsellShown,
  initialDownsellState,
  normalizeDownsellState,
  createSessionOfferFlag,
  decidePaywallExit,
  createPaywallExitController,
  applyDownsellStamp,
  clampLastShownAt,
  downsellCooldownElapsed,
  downsellEligible,
  entitlementBlocksDownsell,
  type EntitlementNow,
  paywallExitLocalGate,
  shouldOfferDownsellOnPaywallExit,
  type DownsellState,
  type PaywallExitInput,
  type PaywallExitDeps,
  type SessionOfferFlag,
} from "../lib/downsellGate";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 8, 7, 10, 0, 0).getTime();

function exitInput(over: Partial<PaywallExitInput> = {}): PaywallExitInput {
  return {
    state: initialDownsellState,
    now: NOW,
    plan: "annual",
    isPro: false,
    shownThisSession: false,
    hasRealDiscount: true,
    ...over,
  };
}

/** Async fake of the real wiring (storage and store both take a few ms). */
function makeDeps(over: {
    discount?: boolean;
    screenshot?: boolean;
    session?: SessionOfferFlag;
    state?: DownsellState;
    proNow?: boolean;
    trialActive?: boolean;
    lifetime?: boolean;
    onboardingIncomplete?: boolean;
    failOffer?: boolean;
    failState?: boolean;
    failStamp?: boolean;
    now?: number;
    /** Shared persisted state: markOffered writes it, getState reads it. */
    store?: { state: DownsellState };
  } = {}) {
  const calls = { getState: 0, getOffer: 0, stamps: 0 };
  const deps: PaywallExitDeps = {
    isScreenshotMode: () => over.screenshot ?? false,
    session: over.session ?? createSessionOfferFlag(),
    getState: async () => {
      calls.getState++;
      await sleep(5);
      if (over.failState) throw new Error("storage down");
      return over.store ? over.store.state : (over.state ?? initialDownsellState);
    },
    getOffer: async () => {
      calls.getOffer++;
      await sleep(40);
      if (over.failOffer) throw new Error("store down");
      return { hasRealDiscount: over.discount ?? true };
    },
    entitlementNow: async () => {
      await sleep(1);
      return {
        isPro: over.proNow ?? false,
        trialActive: over.trialActive ?? false,
        lifetime: over.lifetime ?? false,
      };
    },
    onboardingIncomplete: async () => over.onboardingIncomplete ?? false,
    markOffered: async (at) => {
      calls.stamps++;
      if (over.failStamp) throw new Error("storage down");
      if (over.store) over.store.state = applyDownsellStamp(over.store.state, "inapp", at);
    },
    now: () => over.now ?? NOW,
  };
  return { deps, calls };
}

function makeNav() {
  const log: string[] = [];
  return { log, nav: { closePaywall: () => void log.push("back"), openDownsell: () => void log.push("downsell") } };
}

async function main(): Promise<void> {
  console.log("zerospike downsellGate test");

  section("A. constants match the spec");
  {
    eq("DOWNSELL_MAX_SHOWS", DOWNSELL_MAX_SHOWS, 2);
    eq("DOWNSELL_REARM_MS", DOWNSELL_REARM_MS, 7 * DAY);
  }

  section("B. first paywall exit, annual selected, real discount -> offered in the same session");
  {
    ok("fresh user, annual, real discount", shouldOfferDownsellOnPaywallExit(exitInput()));
    ok(
      "no dismissal-count or 24h wait (legacy fields are ignored)",
      shouldOfferDownsellOnPaywallExit(
        exitInput({ state: { ...initialDownsellState, dismissCount: 0, firstDismissAt: null } })
      )
    );
  }

  section("C. no real store discount -> never offered");
  {
    ok("hasRealDiscount false", !shouldOfferDownsellOnPaywallExit(exitInput({ hasRealDiscount: false })));
    ok("local gate alone is still open (store lookup decides)", paywallExitLocalGate(exitInput()));
  }

  section("D. other plan selected -> not offered");
  {
    ok("monthly", !shouldOfferDownsellOnPaywallExit(exitInput({ plan: "monthly" })));
    ok("lifetime", !shouldOfferDownsellOnPaywallExit(exitInput({ plan: "lifetime" })));
  }

  section("E. already Pro -> never offered");
  {
    ok("isPro", !shouldOfferDownsellOnPaywallExit(exitInput({ isPro: true })));
  }

  section("F. never twice in one session");
  {
    ok("shownThisSession blocks", !shouldOfferDownsellOnPaywallExit(exitInput({ shownThisSession: true })));
    const shown = applyDownsellShown(initialDownsellState, "inapp", NOW);
    ok(
      "same session blocked even past the cool-off",
      !shouldOfferDownsellOnPaywallExit(
        exitInput({ state: shown, now: NOW + 8 * DAY, shownThisSession: true })
      )
    );
  }

  section("G. 7-day cool-off and lifetime cap of 2");
  {
    const first = applyDownsellShown(initialDownsellState, "inapp", NOW);
    eq("count after first show", first.count, 1);
    const at = (ms: number) => exitInput({ state: first, now: NOW + ms });
    ok("blocked an hour later (new session)", !shouldOfferDownsellOnPaywallExit(at(1 * HOUR)));
    ok("blocked just under 7 days", !shouldOfferDownsellOnPaywallExit(at(DOWNSELL_REARM_MS - 1000)));
    ok("allowed at exactly 7 days", shouldOfferDownsellOnPaywallExit(at(DOWNSELL_REARM_MS)));
    const second = applyDownsellShown(first, "inapp", NOW + DOWNSELL_REARM_MS);
    eq("count after second show", second.count, DOWNSELL_MAX_SHOWS);
    ok(
      "lifetime cap reached -> never again",
      !shouldOfferDownsellOnPaywallExit(exitInput({ state: second, now: NOW + 100 * DAY }))
    );
  }

  section("H. a day7 show spends one of the shared lifetime shows (winback does not)");
  {
    const viaDay7 = applyDownsellShown(initialDownsellState, "day7", NOW);
    ok("a day7 show starts the cool-off for the paywall exit", !canShowDownsell(viaDay7, NOW + 1 * DAY));
    ok("and re-opens after 7 days", canShowDownsell(viaDay7, NOW + DOWNSELL_REARM_MS));
  }

  section("I. getDownsellState normalisation (old shape, garbage)");
  {
    const oldShape = JSON.parse('{"count":1,"lastShownAt":1700000000000,"lastTrigger":"inapp"}');
    eq("pre-2.3.4 blob keeps its data, legacy fields default", normalizeDownsellState(oldShape), {
      count: 1,
      lastShownAt: 1700000000000,
      lastTrigger: "inapp",
      dismissCount: 0,
      firstDismissAt: null,
    });
    eq("null -> initial", normalizeDownsellState(null), initialDownsellState);
    eq("string -> initial", normalizeDownsellState("x"), initialDownsellState);
    eq("empty object -> initial", normalizeDownsellState({}), initialDownsellState);
    eq(
      "bad field types are dropped",
      normalizeDownsellState({ count: "nope", lastShownAt: "x", lastTrigger: "bogus" }),
      initialDownsellState
    );
    ok(
      "a normalised old blob is eligible for the paywall exit",
      shouldOfferDownsellOnPaywallExit(exitInput({ state: normalizeDownsellState({}) }))
    );
  }

  section("J. session flag lifecycle");
  {
    const flag = createSessionOfferFlag();
    ok("starts free", !flag.isReserved());
    ok("first reserve wins", flag.reserve());
    ok("second reserve refused", !flag.reserve());
    ok("still reserved", flag.isReserved());
    flag.release();
    ok("released -> free again", !flag.isReserved());
    ok("reserve after release wins", flag.reserve());
  }

  section("K. decidePaywallExit: slot kept on downsell, handed back otherwise");
  {
    const a = makeDeps();
    eq("annual + discount -> downsell", await decidePaywallExit(a.deps, { plan: "annual", isPro: false }), "downsell");
    ok("slot stays reserved for the opened offer", a.deps.session.isReserved());

    const noDisc = makeDeps({ discount: false });
    eq("no discount -> exit", await decidePaywallExit(noDisc.deps, { plan: "annual", isPro: false }), "exit");
    ok("slot handed back when the store has no discount", !noDisc.deps.session.isReserved());

    const monthly = makeDeps();
    eq("monthly -> exit", await decidePaywallExit(monthly.deps, { plan: "monthly", isPro: false }), "exit");
    ok("monthly: store never queried", monthly.calls.getOffer === 0);
    ok("monthly: slot handed back", !monthly.deps.session.isReserved());

    const pro = makeDeps();
    eq("pro -> exit", await decidePaywallExit(pro.deps, { plan: "annual", isPro: true }), "exit");
    ok("pro: slot untouched", !pro.deps.session.isReserved());

    const shot = makeDeps({ screenshot: true });
    eq("screenshot mode -> exit", await decidePaywallExit(shot.deps, { plan: "annual", isPro: false }), "exit");
    ok("screenshot mode: store never queried, slot untouched", shot.calls.getOffer === 0 && !shot.deps.session.isReserved());

    const capped = makeDeps({
      state: { ...applyDownsellShown(applyDownsellShown(initialDownsellState, "inapp", NOW - 30 * DAY), "inapp", NOW - 20 * DAY) },
    });
    eq("lifetime cap -> exit", await decidePaywallExit(capped.deps, { plan: "annual", isPro: false }), "exit");
  }

  section("L. shared flag: winback / day-7 holding the slot blocks the paywall exit, and vice versa");
  {
    const shared = createSessionOfferFlag();
    ok("winback reserves first", shared.reserve());
    const d = makeDeps({ session: shared });
    eq("paywall exit while winback holds the slot -> exit", await decidePaywallExit(d.deps, { plan: "annual", isPro: false }), "exit");
    ok("the winback's slot is NOT released by the refused paywall exit", shared.isReserved());
    ok("store never queried", d.calls.getOffer === 0);

    const shared2 = createSessionOfferFlag();
    const p = makeDeps({ session: shared2 });
    eq("paywall exit opens the downsell", await decidePaywallExit(p.deps, { plan: "annual", isPro: false }), "downsell");
    ok("winback now refused in the same session", !shared2.reserve());
  }

  section("M. concurrency: X tap + back gesture during the offer lookup");
  {
    // Bare decide, no controller: the reservation alone must stop two slots.
    const d = makeDeps();
    const [r1, r2] = await Promise.all([
      decidePaywallExit(d.deps, { plan: "annual", isPro: false }),
      (async () => {
        await sleep(10);
        return decidePaywallExit(d.deps, { plan: "annual", isPro: false });
      })(),
    ]);
    eq("exactly one downsell out of two overlapping decisions", [r1, r2].filter((x) => x === "downsell").length, 1);

    // With the controller: one navigation in total.
    const c = makeDeps();
    const n = makeNav();
    const ctl = createPaywallExitController(c.deps, n.nav);
    const first = ctl.requestExit({ plan: "annual", isPro: false });
    await sleep(10);
    const second = ctl.requestExit({ plan: "annual", isPro: false });
    await Promise.all([first, second]);
    eq("annual double exit -> a single downsell navigation, no back", n.log, ["downsell"]);
    eq("offer queried once", c.calls.getOffer, 1);

    // Ineligible double tap (monthly): one back, not two.
    const m = makeDeps();
    const mn = makeNav();
    const mctl = createPaywallExitController(m.deps, mn.nav);
    await Promise.all([
      mctl.requestExit({ plan: "monthly", isPro: false }),
      mctl.requestExit({ plan: "monthly", isPro: false }),
    ]);
    eq("monthly double tap -> a single back", mn.log, ["back"]);

    // Cancelled purchase and X at once also collapse into one.
    const x = makeDeps({ discount: false });
    const xn = makeNav();
    const xctl = createPaywallExitController(x.deps, xn.nav);
    await Promise.all([
      xctl.requestExit({ plan: "annual", isPro: false }),
      xctl.requestExit({ plan: "annual", isPro: false }),
      xctl.requestExit({ plan: "annual", isPro: false }),
    ]);
    eq("three overlapping exits, no discount -> a single back", xn.log, ["back"]);
    ok("slot handed back", !x.deps.session.isReserved());
  }

  section("N. error paths and fresh entitlement");
  {
    const fo = makeDeps({ failOffer: true });
    eq("getOffer throws -> exit", await decidePaywallExit(fo.deps, { plan: "annual", isPro: false }), "exit");
    ok("getOffer throws -> slot released", !fo.deps.session.isReserved());

    const fs = makeDeps({ failState: true });
    eq("getState throws -> exit", await decidePaywallExit(fs.deps, { plan: "annual", isPro: false }), "exit");
    ok("getState throws -> slot released", !fs.deps.session.isReserved());

    const fn = makeNav();
    const fctl = createPaywallExitController(makeDeps({ failOffer: true }).deps, fn.nav);
    await fctl.requestExit({ plan: "annual", isPro: false });
    eq("controller: a failing store still closes the paywall once", fn.log, ["back"]);

    // The screen's cached isPro is stale (false) but the user has just paid.
    const paid = makeDeps({ proNow: true });
    eq("paid since the screen rendered -> exit", await decidePaywallExit(paid.deps, { plan: "annual", isPro: false }), "exit");
    ok("paid: offer never queried, slot released", paid.calls.getOffer === 0 && !paid.deps.session.isReserved());
  }

  section("O. analytics fires once per accepted exit");
  {
    const d = makeDeps();
    const n = makeNav();
    const ctl = createPaywallExitController(d.deps, n.nav);
    let logged = 0;
    const a = ctl.requestExit({ plan: "annual", isPro: false }, () => void logged++);
    await sleep(10);
    const b = ctl.requestExit({ plan: "annual", isPro: false }, () => void logged++);
    await Promise.all([a, b]);
    eq("onAccepted ran once", logged, 1);
  }

  section("P. user close is a no-op while a purchase or restore is busy");
  {
    const d = makeDeps();
    const n = makeNav();
    let busy = true;
    const ctl = createPaywallExitController(d.deps, n.nav, () => busy);
    let logged = 0;
    await ctl.requestUserClose({ plan: "annual", isPro: false }, () => void logged++);
    eq("busy: no navigation", n.log, []);
    eq("busy: no analytics", logged, 0);
    ok("busy: store never queried, slot untouched", d.calls.getOffer === 0 && !d.deps.session.isReserved());
    // The cancelled purchase is the blocker itself and must still get through.
    await ctl.requestExit({ plan: "annual", isPro: false });
    eq("cancelled purchase while busy still exits (downsell)", n.log, ["downsell"]);

    const d2 = makeDeps();
    const n2 = makeNav();
    busy = false;
    const ctl2 = createPaywallExitController(d2.deps, n2.nav, () => busy);
    await ctl2.requestUserClose({ plan: "annual", isPro: false });
    eq("not busy: user close proceeds", n2.log, ["downsell"]);
  }

  section("Q. persisted 7-day window: stamped when the offer opens, honoured by a NEW session");
  {
    const store = { state: initialDownsellState };
    const s1 = makeDeps({ store, now: NOW });
    eq("session 1: first exit -> downsell", await decidePaywallExit(s1.deps, { plan: "annual", isPro: false }), "downsell");
    eq("the date is stamped at once (one write)", s1.calls.stamps, 1);
    eq("stamp keeps the lifetime count untouched", store.state.count, 0);
    eq("stamp carries the time", store.state.lastShownAt, NOW);

    // Profile > "Try Pro" > paywall > close, in the same session.
    eq("same session, second exit -> exit", await decidePaywallExit(s1.deps, { plan: "annual", isPro: false }), "exit");

    // App relaunched an hour later: fresh session flag, same persisted state.
    const s2 = makeDeps({ store, now: NOW + HOUR });
    eq("new session 1 h later -> exit (persisted date)", await decidePaywallExit(s2.deps, { plan: "annual", isPro: false }), "exit");
    ok("blocked before any store lookup", s2.calls.getOffer === 0);
    ok("and the session slot is handed back", !s2.deps.session.isReserved());

    const s3 = makeDeps({ store, now: NOW + DOWNSELL_REARM_MS - 1000 });
    eq("new session just under 7 days -> exit", await decidePaywallExit(s3.deps, { plan: "annual", isPro: false }), "exit");

    const s4 = makeDeps({ store, now: NOW + DOWNSELL_REARM_MS });
    eq("new session at 7 days -> one more downsell", await decidePaywallExit(s4.deps, { plan: "annual", isPro: false }), "downsell");
  }

  section("R. the screen's own record (accept or decline alike) and the lifetime total of 2");
  {
    const store = { state: initialDownsellState };
    const d1 = makeDeps({ store });
    await decidePaywallExit(d1.deps, { plan: "annual", isPro: false });
    // downsell.tsx records the show once the discount is confirmed: accept and decline both come after it.
    store.state = applyDownsellShown(store.state, "inapp", NOW);
    eq("record after the stamp keeps one show", store.state.count, 1);
    eq("and the same date", store.state.lastShownAt, NOW);

    const d2 = makeDeps({ store, now: NOW + 2 * DAY });
    eq("2 days later, declined or accepted alike -> exit", await decidePaywallExit(d2.deps, { plan: "annual", isPro: false }), "exit");

    const d3 = makeDeps({ store, now: NOW + 8 * DAY });
    eq("8 days later -> second show", await decidePaywallExit(d3.deps, { plan: "annual", isPro: false }), "downsell");
    store.state = applyDownsellShown(store.state, "inapp", NOW + 8 * DAY);
    eq("lifetime total is now 2", store.state.count, DOWNSELL_MAX_SHOWS);

    const d4 = makeDeps({ store, now: NOW + 400 * DAY });
    eq("a year later, still never a third", await decidePaywallExit(d4.deps, { plan: "annual", isPro: false }), "exit");
  }

  section("S. a stamped offer that never reached the screen's record still starts the window");
  {
    const store = { state: initialDownsellState };
    const a = makeDeps({ store });
    await decidePaywallExit(a.deps, { plan: "annual", isPro: false });
    // The user closed the screen before it could record (or the 2nd fetch had no discount).
    const b = makeDeps({ store, now: NOW + 3 * DAY });
    eq("count 0 but stamped: still blocked", await decidePaywallExit(b.deps, { plan: "annual", isPro: false }), "exit");
    ok("the lifetime show was not burned", store.state.count === 0);
    const c = makeDeps({ store, failStamp: true, now: NOW + 9 * DAY });
    eq("a failing stamp write never blocks the offer itself", await decidePaywallExit(c.deps, { plan: "annual", isPro: false }), "downsell");
  }

  section("T. day-7 and winback share the same persisted window");
  {
    const stamped = applyDownsellStamp(initialDownsellState, "inapp", NOW);
    eq("cooldownElapsed: never stamped", downsellCooldownElapsed(null, NOW), true);
    eq("cooldownElapsed: 1 day", downsellCooldownElapsed(NOW, NOW + DAY), false);
    eq("cooldownElapsed: exactly 7 days", downsellCooldownElapsed(NOW, NOW + 7 * DAY), true);
    eq("cooldownElapsed: date in the future (clock moved back)", downsellCooldownElapsed(NOW + DAY, NOW), false);
    ok("canShowDownsell uses the date even at count 0", !canShowDownsell(stamped, NOW + DAY));
    ok("and opens after 7 days", canShowDownsell(stamped, NOW + 7 * DAY));
    ok("a counted show without a date blocks (cannot prove the window)", !canShowDownsell({ ...initialDownsellState, count: 1 }, NOW));
    const day7 = {
      onboardedAtMs: NOW - 30 * DAY,
      now: NOW + 2 * DAY,
      shownCount: stamped.count,
      alreadyTriggered: false,
      lastShownAt: stamped.lastShownAt,
      rearmMs: DOWNSELL_REARM_MS,
      isPro: false,
      hasRealDiscount: true,
    };
    ok("day-7 after a paywall stamp 2 days ago -> no", !shouldTriggerDay7(day7));
    ok("day-7 after 7 days -> yes", shouldTriggerDay7({ ...day7, now: NOW + 7 * DAY }));
    const winback = applyDownsellStamp(initialDownsellState, "winback", NOW);
    eq("winback stamp does not spend a lifetime show", winback.count, 0);
    ok("winback stamp blocks the paywall exit for 7 days", !canShowDownsell(winback, NOW + 3 * DAY));
  }

  section("U. never for a trial, subscription or lifetime; never during onboarding; never without a real discount");
  {
    const ent = (over: Partial<EntitlementNow> = {}): EntitlementNow => ({ isPro: false, trialActive: false, lifetime: false, ...over });
    ok("free user passes the entitlement check", !entitlementBlocksDownsell(ent()));
    ok("subscription (isPro) blocks", entitlementBlocksDownsell(ent({ isPro: true })));
    ok("running trial alone blocks", entitlementBlocksDownsell(ent({ trialActive: true })));
    ok("lifetime alone blocks", entitlementBlocksDownsell(ent({ lifetime: true })));

    const base = {
      state: initialDownsellState,
      now: NOW,
      sessionTaken: false,
      entitlement: ent(),
      onboardingIncomplete: false,
      hasRealDiscount: true,
    };
    ok("baseline eligible", downsellEligible(base));
    ok("subscription -> never", !downsellEligible({ ...base, entitlement: ent({ isPro: true }) }));
    ok("trial -> never", !downsellEligible({ ...base, entitlement: ent({ trialActive: true }) }));
    ok("lifetime -> never", !downsellEligible({ ...base, entitlement: ent({ lifetime: true }) }));
    ok("onboarding first session -> never", !downsellEligible({ ...base, onboardingIncomplete: true }));
    ok("no real discount -> never", !downsellEligible({ ...base, hasRealDiscount: false }));
    ok("session slot taken -> never", !downsellEligible({ ...base, sessionTaken: true }));
    ok("7-day window -> never", !downsellEligible({ ...base, state: applyDownsellShown(initialDownsellState, "inapp", NOW - DAY) }));
    ok("lifetime cap 2 -> never", !downsellEligible({ ...base, state: { ...initialDownsellState, count: 2, lastShownAt: NOW - 30 * DAY } }));

    const held: [string, { trialActive?: boolean; lifetime?: boolean; proNow?: boolean }][] = [
      ["trial", { trialActive: true }],
      ["lifetime", { lifetime: true }],
      ["subscription", { proNow: true }],
    ];
    for (const [label, over] of held) {
      const d = makeDeps(over);
      eq(`decidePaywallExit: ${label} -> exit`, await decidePaywallExit(d.deps, { plan: "annual", isPro: false }), "exit");
      ok(`decidePaywallExit: ${label}: offer never priced, nothing stamped, slot back`, d.calls.getOffer === 0 && d.calls.stamps === 0 && !d.deps.session.isReserved());
    }
    const ob = makeDeps({ onboardingIncomplete: true });
    eq("decidePaywallExit: onboarding unfinished -> exit", await decidePaywallExit(ob.deps, { plan: "annual", isPro: false }), "exit");
    ok("onboarding: offer never priced, nothing stamped", ob.calls.getOffer === 0 && ob.calls.stamps === 0 && !ob.deps.session.isReserved());
    const nd = makeDeps({ discount: false });
    eq("decidePaywallExit: no real discount -> exit", await decidePaywallExit(nd.deps, { plan: "annual", isPro: false }), "exit");
    ok("no discount: nothing stamped (the window is not started by an empty offer)", nd.calls.stamps === 0);
  }

  section("V. old persisted shapes still normalise and gate");
  {
    const v1 = normalizeDownsellState(JSON.parse('{"count":1,"lastShownAt":1700000000000,"lastTrigger":"inapp"}'));
    ok("count 1 with a date: blocked inside 7 days", !canShowDownsell(v1, 1700000000000 + DAY));
    ok("count 1 with a date: open after 7 days", canShowDownsell(v1, 1700000000000 + 7 * DAY));
    const noDate = normalizeDownsellState(JSON.parse('{"count":1}'));
    ok("count 1 without a date: blocked", !canShowDownsell(noDate, NOW));
    const stampOnly = normalizeDownsellState(JSON.parse('{"count":0,"lastShownAt":1700000000000,"lastTrigger":"winback"}'));
    ok("stamp-only blob round-trips and blocks inside the window", !canShowDownsell(stampOnly, 1700000000000 + DAY));
    eq("JSON round trip of a stamped state", normalizeDownsellState(JSON.parse(JSON.stringify(applyDownsellStamp(initialDownsellState, "winback", NOW)))), applyDownsellStamp(initialDownsellState, "winback", NOW));
  }

  section("W. a stamp in the future (clock moved forward, then back) holds the window at most one window");
  {
    const skewed = applyDownsellStamp(initialDownsellState, "inapp", NOW + 365 * DAY);
    ok("raw future stamp blocks", !canShowDownsell(skewed, NOW));
    const healed = clampLastShownAt(skewed, NOW);
    eq("clamped to now", healed.lastShownAt, NOW);
    ok("still blocked right after (the window starts when noticed)", !canShowDownsell(healed, NOW + DAY));
    ok("open one window later, not a year later", canShowDownsell(healed, NOW + 7 * DAY));
    eq("a past stamp is untouched (same object)", clampLastShownAt(applyDownsellStamp(initialDownsellState, "inapp", NOW - DAY), NOW).lastShownAt, NOW - DAY);
    eq("no stamp is untouched", clampLastShownAt(initialDownsellState, NOW), initialDownsellState);
  }

  section("X. cancelled store sheet: only a downsell decision leaves, anything else stays");
  {
    const stay = makeDeps({ discount: false });
    const n1 = makeNav();
    const c1 = createPaywallExitController(stay.deps, n1.nav);
    await c1.requestAfterCancel({ plan: "annual", isPro: false });
    eq("no discount: no navigation", n1.log, []);
    ok("lock released, slot handed back", !c1.isExiting() && !stay.deps.session.isReserved());

    const monthly = makeDeps();
    const n2 = makeNav();
    const c2 = createPaywallExitController(monthly.deps, n2.nav);
    await c2.requestAfterCancel({ plan: "monthly", isPro: false });
    eq("monthly: no navigation, store never queried", [n2.log, monthly.calls.getOffer], [[], 0]);
    ok("monthly: lock released", !c2.isExiting());

    const go = makeDeps();
    const n3 = makeNav();
    const c3 = createPaywallExitController(go.deps, n3.nav);
    await c3.requestAfterCancel({ plan: "annual", isPro: false });
    eq("annual with a verified discount: the downsell opens", n3.log, ["downsell"]);
    ok("lock kept through the transition", c3.isExiting());

    const again = makeDeps();
    const n4 = makeNav();
    const c4 = createPaywallExitController(again.deps, n4.nav);
    await c4.requestAfterCancel({ plan: "monthly", isPro: false });
    await c4.requestAfterCancel({ plan: "annual", isPro: false });
    eq("after a stay the controller can decide again", n4.log, ["downsell"]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
