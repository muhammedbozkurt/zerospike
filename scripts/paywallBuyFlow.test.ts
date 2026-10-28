/**
 * lib/paywallBuyFlow.ts driven for real (mock store and mock navigation, the
 * real state machine and the real exit controller of lib/downsellGate.ts): the
 * orderings that decide whether a payment ends on the Pro welcome.
 *
 * Run: npx tsx scripts/paywallBuyFlow.test.ts
 */
import { createPurchaseFlow, type PurchaseFlowDeps } from "../lib/paywallBuyFlow";
import {
  createPaywallExitController,
  createSessionOfferFlag,
  initialDownsellState,
  type PaywallExitDeps,
} from "../lib/downsellGate";
import type { PaywallPlan, PurchaseUiState } from "../lib/paywallPurchase";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
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

type Res = { ok: boolean; cancelled?: boolean; recovered?: boolean; error?: string };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Everything the screen would own, mocked. */
function makeEnv(opts: { discount?: boolean; holdOffer?: boolean } = {}) {
  const log: string[] = [];
  const offer = deferred<{ hasRealDiscount: boolean }>();
  const session = createSessionOfferFlag();
  const exitDeps: PaywallExitDeps = {
    isScreenshotMode: () => false,
    session,
    getState: async () => initialDownsellState,
    getOffer: () => (opts.holdOffer ? offer.promise : Promise.resolve({ hasRealDiscount: opts.discount ?? true })),
    entitlementNow: async () => ({ isPro: false, trialActive: false, lifetime: false }),
    onboardingIncomplete: async () => false,
    markOffered: async () => {
      log.push("stamp");
    },
    now: () => 1_800_000_000_000,
  };
  const states: PurchaseUiState[] = [];
  let store: { next: () => Promise<Res>; calls: PaywallPlan[] } = {
    calls: [],
    next: async () => ({ ok: true }),
  };
  const toasts: string[] = [];
  const planRef = { plan: "annual" as PaywallPlan };
  // eslint-disable-next-line prefer-const
  let flow!: ReturnType<typeof createPurchaseFlow<Res>>;
  const ctl = createPaywallExitController(
    exitDeps,
    { closePaywall: () => void log.push("back"), openDownsell: () => void log.push("downsell") },
    () => flow.isBusy()
  );
  const deps: PurchaseFlowDeps<Res> = {
    isExiting: () => ctl.isExiting(),
    abandonPendingExit: () => ctl.abandonPendingExit(),
    purchase: (p) => {
      store.calls.push(p);
      return store.next();
    },
    refreshPro: async () => {},
    onPress: () => void log.push("press"),
    onResult: (_p, r) => void log.push(`result:${r.ok ? "ok" : r.cancelled ? "cancelled" : "error"}`),
    onSuccess: async () => {
      log.push("welcome");
    },
    onCancelled: async () => {
      await ctl.requestAfterCancel({ plan: planRef.plan, isPro: false });
    },
    onPending: () => void log.push("pending"),
    onFailed: (_p, _r, err) => void toasts.push(err ? "thrown" : "error"),
    onPostPurchaseError: () => void log.push("postError"),
    onState: (s) => void states.push(s),
  };
  flow = createPurchaseFlow<Res>(deps);
  return {
    flow,
    ctl,
    log,
    offer,
    session,
    states,
    toasts,
    planRef,
    deps,
    setStore: (next: () => Promise<Res>) => {
      store = { calls: store.calls, next };
    },
    get calls() {
      return store.calls;
    },
  };
}

async function main(): Promise<void> {
  console.log("zerospike paywall buy flow test");

  section("A. an exit decision is pending: the button does not start a purchase");
  {
    const e = makeEnv({ holdOffer: true });
    const closing = e.ctl.requestUserClose({ plan: "annual", isPro: false });
    await tick();
    ok("the exit lock is held while the lookup runs", e.ctl.isExiting());
    eq("buy() is refused", await e.flow.buy("annual"), "ignored");
    eq("the store was never called", e.calls.length, 0);
    ok("restore is refused too", (await e.flow.restore(async () => void e.log.push("restore"))) === "ignored" && !e.log.includes("restore"));
    e.offer.resolve({ hasRealDiscount: true });
    await closing;
    eq("the decision then navigates exactly once, to the downsell", e.log.filter((l) => l === "downsell" || l === "back"), ["downsell"]);
    ok("and no purchase press was logged", !e.log.includes("press"));
    eq("flow state untouched", e.flow.getState(), "idle");

    const x = makeEnv({ holdOffer: true });
    const closing2 = x.ctl.requestUserClose({ plan: "monthly", isPro: false });
    await tick();
    eq("buy() refused while a plain exit is pending", await x.flow.buy("monthly"), "ignored");
    x.offer.resolve({ hasRealDiscount: true });
    await closing2;
    eq("monthly: the decision closes the paywall once", x.log.filter((l) => l === "downsell" || l === "back"), ["back"]);
  }

  section("B. a purchase that has started owns the exit: a pending decision navigates nowhere");
  {
    const e = makeEnv({ holdOffer: true });
    const closing = e.ctl.requestExit({ plan: "annual", isPro: false });
    await tick();
    e.ctl.abandonPendingExit();
    e.offer.resolve({ hasRealDiscount: true });
    await closing;
    eq("no navigation at all", e.log.filter((l) => l === "downsell" || l === "back"), []);
    ok("the lock is released", !e.ctl.isExiting());
    ok("the session slot of the dropped offer is handed back", !e.session.isReserved());
    eq("abandon with nothing pending is a no-op", (() => { e.ctl.abandonPendingExit(); return e.ctl.isExiting(); })(), false);
  }

  section("C. success: welcome opens, the CTA stays locked, a user close is ignored meanwhile");
  {
    const e = makeEnv();
    const pay = deferred<Res>();
    e.setStore(() => pay.promise);
    const run = e.flow.buy("annual");
    await tick();
    eq("purchasing", e.flow.getState(), "purchasing");
    ok("busy", e.flow.isBusy());
    await e.ctl.requestUserClose({ plan: "annual", isPro: false });
    eq("an X tap during the purchase navigates nowhere", e.log.filter((l) => l === "downsell" || l === "back"), []);
    eq("a second press is refused", await e.flow.buy("annual"), "ignored");
    pay.resolve({ ok: true });
    await run;
    eq("the store was called once", e.calls.length, 1);
    eq("the welcome opened once", e.log.filter((l) => l === "welcome").length, 1);
    eq("state stays done (spinner stays)", e.flow.getState(), "done");
    ok("still busy: the CTA stays locked after buy() returned", e.flow.isBusy());
    ok("the state never went back to idle", !e.states.slice(e.states.indexOf("done")).includes("idle"));
    eq("another press after success is refused", await e.flow.buy("annual"), "ignored");
    eq("and so is restore", await e.flow.restore(async () => {}), "ignored");
    ok("no downsell or close navigation was started by the flow", !e.log.includes("downsell") && !e.log.includes("back"));
  }

  section("D. cancelled store sheet: silent; stay unless the downsell gate says downsell");
  {
    const m = makeEnv();
    m.planRef.plan = "monthly";
    m.setStore(async () => ({ ok: false, cancelled: true }));
    eq("monthly cancel runs", await m.flow.buy("monthly"), "ran");
    eq("the paywall stays: no navigation", m.log.filter((l) => l === "downsell" || l === "back"), []);
    eq("button back to normal", m.flow.getState(), "idle");
    ok("the exit lock is released", !m.ctl.isExiting());
    eq("no error message", m.toasts, []);
    ok("no welcome", !m.log.includes("welcome"));
    m.setStore(async () => ({ ok: true }));
    eq("the next press is accepted", await m.flow.buy("monthly"), "ran");
    ok("and succeeds into the welcome", m.log.includes("welcome"));

    const none = makeEnv({ discount: false });
    none.setStore(async () => ({ ok: false, cancelled: true }));
    await none.flow.buy("annual");
    eq("annual but no real discount: stays too", none.log.filter((l) => l === "downsell" || l === "back"), []);
    eq("annual no discount: idle and unlocked", [none.flow.getState(), none.ctl.isExiting()], ["idle", false]);

    const a = makeEnv({ discount: true });
    a.setStore(async () => ({ ok: false, cancelled: true }));
    await a.flow.buy("annual");
    eq("annual with a verified discount: the downsell opens", a.log.filter((l) => l === "downsell" || l === "back"), ["downsell"]);
    ok("the lock stays so the button cannot start a payment under the transition", a.ctl.isExiting());
    eq("a press during that transition is refused", await a.flow.buy("annual"), "ignored");
    eq("no error message on a cancel", a.toasts, []);
  }

  section("E. store error: one short message, same plan retried");
  {
    const e = makeEnv();
    e.setStore(async () => ({ ok: false, error: "boom" }));
    await e.flow.buy("lifetime");
    eq("one error message", e.toasts, ["error"]);
    eq("state failed (retry label)", e.flow.getState(), "failed");
    ok("failed is not busy: the button is live", !e.flow.isBusy());
    ok("no welcome, no navigation", !e.log.includes("welcome") && !e.log.includes("downsell") && !e.log.includes("back"));
    e.setStore(async () => ({ ok: true }));
    await e.flow.buy("lifetime");
    eq("the retry used the same plan", e.calls, ["lifetime", "lifetime"]);
    ok("the retry reaches the welcome", e.log.includes("welcome"));

    const t = makeEnv();
    t.setStore(async () => {
      throw new Error("store down");
    });
    await t.flow.buy("monthly");
    eq("a thrown store call: one message, failed", [t.toasts, t.flow.getState()], [["thrown"], "failed"]);

    const c = makeEnv();
    c.flow.planChanged();
    c.setStore(async () => ({ ok: false }));
    await c.flow.buy("annual");
    c.flow.planChanged();
    eq("choosing another plan clears the retry state", c.flow.getState(), "idle");
  }

  section("F. double tap in one tick reaches the store once");
  {
    const e = makeEnv();
    const pay = deferred<Res>();
    e.setStore(() => pay.promise);
    const a = e.flow.buy("annual");
    const b = e.flow.buy("annual");
    pay.resolve({ ok: true });
    eq("second call ignored", [await a, await b], ["ran", "ignored"]);
    eq("one store call", e.calls.length, 1);
  }

  section("G. follow-up work that throws after the store answered is not a purchase failure");
  {
    const e = makeEnv();
    e.deps.onSuccess = async () => {
      throw new Error("navigation failed");
    };
    const flow = createPurchaseFlow<Res>(e.deps);
    await flow.buy("annual");
    eq("no error message after a successful payment", e.toasts, []);
    ok("the post-purchase handler ran", e.log.includes("postError"));
    eq("state stays done", flow.getState(), "done");

    const c = makeEnv();
    c.setStore(async () => ({ ok: false, cancelled: true }));
    c.deps.onCancelled = async () => {
      throw new Error("gate failed");
    };
    const flow2 = createPurchaseFlow<Res>(c.deps);
    await flow2.buy("annual");
    eq("a throwing gate after a cancel shows no error", c.toasts, []);
    eq("and the button is back to normal", flow2.getState(), "idle");
  }

  section("H. restore shares the guards and settles");
  {
    const e = makeEnv();
    const gate = deferred<void>();
    const first = e.flow.restore(() => gate.promise);
    eq("busy while restoring", e.flow.isBusy(), true);
    eq("a second restore is refused", await e.flow.restore(async () => {}), "ignored");
    eq("a purchase press is refused while restoring", await e.flow.buy("annual"), "ignored");
    gate.resolve();
    await first;
    eq("idle again", e.flow.getState(), "idle");
    const thrown = makeEnv();
    await thrown.flow.restore(async () => {
      throw new Error("x");
    }).catch(() => undefined);
    eq("a throwing restore still settles", thrown.flow.getState(), "idle");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
