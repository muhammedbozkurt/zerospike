/**
 * lib/healthConnectFlow harness: the Health system permission request waits for
 * a covered screen to clear, every wait is bounded, and switching sync off
 * supersedes whatever is in flight. Fake clock, no native modules.
 *
 * Run: npx tsx scripts/healthConnectFlow.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

import {
  GATE_MAX_WAIT_MS,
  IMPORT_STALE_MS,
  PERMISSION_SETTLE_MS,
  PERMISSION_TIMEOUT_MS,
  SYNC_TIMEOUT_MS,
  connectNotice,
  createHealthFlow,
  isImportStale,
  type FlowClock,
} from "../lib/healthConnectFlow";

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
function section(name: string): void {
  console.log(name);
}

/** Timers fire in order as time is advanced; promises settle between steps. */
function fakeClock() {
  let nowMs = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: FlowClock = {
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: nowMs + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    now: () => nowMs,
  };
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    await flush();
    const end = nowMs + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      nowMs = Math.max(nowMs, next[1].at);
      next[1].fn();
      await flush();
    }
    nowMs = end;
    await flush();
  };
  return { clock, advance, flush, pending: () => timers.size };
}

/** The dashboard's connect flow, minus the UI: gate, permission, then a sync. */
function connectFlow(
  flow: ReturnType<typeof createHealthFlow>,
  calls: { permission: number; sync: number },
  permission: () => Promise<{ read: boolean; newlyEnabled: boolean }>,
  sync: () => Promise<string>,
  log: string[]
) {
  return (async () => {
    const session = flow.start();
    if (!(await session.clear())) {
      log.push("not-clear");
      return;
    }
    calls.permission++;
    const step = await session.race(permission(), PERMISSION_TIMEOUT_MS);
    const notice = connectNotice(step);
    if (step.kind === "stale") {
      log.push("stale-permission");
      return;
    }
    if (step.kind === "timeout") {
      log.push("timeout-permission");
      return;
    }
    if (notice === "denied") {
      log.push("denied");
      return;
    }
    calls.sync++;
    const out = await session.race(sync(), SYNC_TIMEOUT_MS);
    log.push(out.kind === "value" ? `synced:${out.value}` : `${out.kind}-sync`);
  })();
}

async function main() {
  section("A. modal open: no request; closed: exactly one, after the settle time");
  {
    const c = fakeClock();
    let covered = true;
    const flow = createHealthFlow({ isBlocked: () => covered, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const log: string[] = [];
    flow.touch();
    const run = connectFlow(flow, calls, async () => ({ read: true, newlyEnabled: false }), async () => "ok", log);
    await c.advance(5000);
    eq("no request while the modal is up", calls.permission, 0);
    covered = false;
    flow.touch();
    await c.advance(PERMISSION_SETTLE_MS - 100);
    eq("still none inside the settle time", calls.permission, 0);
    await c.advance(400);
    await run;
    eq("one request after the modal is gone", calls.permission, 1);
    eq("then the sync runs", log, ["synced:ok"]);
    await c.advance(10_000);
    eq("never asked a second time", calls.permission, 1);
    eq("no timer is left behind", c.pending(), 0);
  }

  section("A2. nothing covering: no needless delay");
  {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => false, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const run = connectFlow(flow, calls, async () => ({ read: true, newlyEnabled: false }), async () => "ok", []);
    await c.flush();
    eq("asked at once on a free screen", calls.permission, 1);
    await run;
  }

  section("A3. a screen covered past the limit never asks");
  {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => true, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const log: string[] = [];
    const run = connectFlow(flow, calls, async () => ({ read: true, newlyEnabled: false }), async () => "ok", log);
    await c.advance(GATE_MAX_WAIT_MS + 1000);
    await run;
    eq("no request", calls.permission, 0);
    eq("reported as not clear", log, ["not-clear"]);
    eq("no timer is left behind", c.pending(), 0);
  }

  section("A4. a second modal opening during the settle time restarts it");
  {
    const c = fakeClock();
    let covered = false;
    const flow = createHealthFlow({ isBlocked: () => covered, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    flow.touch();
    const run = connectFlow(flow, calls, async () => ({ read: true, newlyEnabled: false }), async () => "ok", []);
    await c.advance(600);
    covered = true;
    await c.advance(600);
    eq("nothing while it is covered again", calls.permission, 0);
    covered = false;
    await c.advance(PERMISSION_SETTLE_MS + 400);
    await run;
    eq("one request once it is really free", calls.permission, 1);
  }

  section("B. a permission promise that never settles ends at the timeout");
  {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => false, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const log: string[] = [];
    let owns = true;
    const session0 = flow.start();
    const run = (async () => {
      const step = await session0.race(new Promise<never>(() => {}), PERMISSION_TIMEOUT_MS);
      log.push(step.kind);
      owns = session0.owns();
    })();
    await c.advance(PERMISSION_TIMEOUT_MS - 1);
    eq("still waiting just before the limit", log, []);
    await c.advance(2);
    await run;
    eq("timeout reported", log, ["timeout"]);
    ok("a timed-out run still owns the flag it set (so it clears it)", owns);
    ok("but it is no longer current", !session0.current());
    eq("no timer is left behind", c.pending(), 0);
    void calls;

    const retry = flow.start();
    const again = await retry.race(Promise.resolve(7), 1000);
    eq("a retry after a timeout works", again, { kind: "value", value: 7 });
  }

  section("B2. a hung sync ends at its timeout");
  {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => false, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const log: string[] = [];
    const run = connectFlow(
      flow,
      calls,
      async () => ({ read: true, newlyEnabled: false }),
      () => new Promise<string>(() => {}),
      log
    );
    await c.advance(SYNC_TIMEOUT_MS + 10);
    await run;
    eq("sync timed out", log, ["timeout-sync"]);
  }

  section("C. switching off cancels; a late answer changes nothing");
  {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => false, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const log: string[] = [];
    let resolvePermission: (v: { read: boolean; newlyEnabled: boolean }) => void = () => {};
    const run = connectFlow(
      flow,
      calls,
      () => new Promise((r) => (resolvePermission = r)),
      async () => "ok",
      log
    );
    await c.flush();
    eq("the request is out", calls.permission, 1);
    flow.cancel();
    await run;
    eq("the waiting run ends at once", log, ["stale-permission"]);
    resolvePermission({ read: true, newlyEnabled: true });
    await c.advance(1000);
    eq("the late grant starts no sync", calls.sync, 0);
    eq("and adds nothing to the outcome", log, ["stale-permission"]);
    eq("no timer is left behind", c.pending(), 0);
  }

  section("C2. switching off while the gate still waits");
  {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => true, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const log: string[] = [];
    const run = connectFlow(flow, calls, async () => ({ read: true, newlyEnabled: false }), async () => "ok", log);
    await c.advance(3000);
    flow.cancel();
    await run;
    eq("never asked", calls.permission, 0);
    eq("ended without a request", log, ["not-clear"]);
    eq("no timer is left behind", c.pending(), 0);
  }

  section("C3. a newer run supersedes the older one; the older cannot clear the newer's flag");
  {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => false, clock: c.clock });
    const a = flow.start();
    const pendingA = a.race(new Promise<number>(() => {}), 10_000);
    const b = flow.start();
    eq("the older race is freed", await pendingA, { kind: "stale" });
    ok("older no longer owns", !a.owns());
    ok("newer owns", b.owns());
    flow.cancel();
    ok("a cancel takes ownership from the newer too", !b.owns());
    eq("a cancelled session races stale at once", await b.race(Promise.resolve(1), 1000), { kind: "stale" });
  }

  section("D. refused access");
  {
    eq("refused read is a refusal", connectNotice({ kind: "value", value: { read: false } }), "denied");
    eq("granted read has nothing to say", connectNotice({ kind: "value", value: { read: true } }), "none");
    eq("a timeout is a retry, not a refusal", connectNotice({ kind: "timeout" }), "timeout");
    eq("a superseded run says nothing", connectNotice({ kind: "stale" }), "none");

    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => false, clock: c.clock });
    const calls = { permission: 0, sync: 0 };
    const log: string[] = [];
    await connectFlow(flow, calls, async () => ({ read: false, newlyEnabled: false }), async () => "ok", log);
    eq("denied stops before the sync", log, ["denied"]);
    eq("no sync was started", calls.sync, 0);
  }

  section("E. a hung import is not shared forever");
  {
    ok("fresh import is shared", !isImportStale(1000, 1000 + IMPORT_STALE_MS - 1));
    ok("a hung import is not", isImportStale(1000, 1000 + IMPORT_STALE_MS));
    ok("stale limit is under the sync timeout (a retry after a timeout starts fresh)", IMPORT_STALE_MS < SYNC_TIMEOUT_MS);
  }

  section("F. wiring");
  {
    const dash = src("app/(tabs)/index.tsx");
    const toggle = dash.slice(dash.indexOf("async function toggleCgm"), dash.indexOf("function openHealthFlow"));
    ok("connect waits for a clear screen before the request", /session\.clear\(\)[\s\S]*requestHealthReadWriteAccess/.test(toggle));
    ok("the permission request is bounded", /session\.race\(\s*requestHealthReadWriteAccess[\s\S]*PERMISSION_TIMEOUT_MS/.test(toggle));
    ok("off cancels the flow and clears Syncing", /!next[\s\S]*healthFlow\.cancel\(\)[\s\S]*setSyncing\(false\)[\s\S]*setCgmOn\(false\)/.test(toggle));
    const sync = dash.slice(dash.indexOf("async function runSync"), dash.indexOf("async function offerHealthSettings"));
    ok("sync waits for a clear screen", /session\.clear\(\)[\s\S]*importHealthGlucose/.test(sync));
    ok("the import is bounded", /SYNC_TIMEOUT_MS/.test(sync));
    ok("only the owning run clears Syncing", /session\.owns\(\)\)\s*setSyncing\(false\)/.test(sync));
    ok("the dashboard drops the flow on unmount", /=> healthFlow\.cancel\(\), \[healthFlow\]/.test(dash));
    ok("health.ts no longer shares a stale import", /isImportStale\(running\.startedAt/.test(src("lib/services/health.ts")));
    ok("onboarding bounds its Health request", /session\.race\(requestHealthPermissions\(\), PERMISSION_TIMEOUT_MS\)/.test(src("app/onboarding.tsx")));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
