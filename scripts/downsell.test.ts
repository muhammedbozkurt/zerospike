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
function makeDeps(over: { discount?: boolean; screenshot?: boolean; session?: SessionOfferFlag; state?: DownsellState } = {}) {
  const calls = { getState: 0, getOffer: 0 };
  const deps: PaywallExitDeps = {
    isScreenshotMode: () => over.screenshot ?? false,
    session: over.session ?? createSessionOfferFlag(),
    getState: async () => {
      calls.getState++;
      await sleep(5);
      return over.state ?? initialDownsellState;
    },
    getOffer: async () => {
      calls.getOffer++;
      await sleep(40);
      return { hasRealDiscount: over.discount ?? true };
    },
    now: () => NOW,
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

  section("H. the day-7 / winback trigger spends the same lifetime shows");
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
