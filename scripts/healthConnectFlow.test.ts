/**
 * lib/healthConnectFlow harness: the Health system permission request waits for
 * a covered screen to clear, a timeout frees the UI without dropping a late
 * answer, and switching sync off supersedes whatever is in flight. Fake clock,
 * no native modules. The real orchestration functions run here (the dashboard
 * only wires its UI into them), so these are behavior tests, not source greps.
 *
 * A section that never settles fails the run, and so does a run that ends with
 * unfinished work (a hang must never look like a pass).
 *
 * Run: npx tsx scripts/healthConnectFlow.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: {
  exit: (code: number) => void;
  on: (event: string, cb: () => void) => void;
};
declare function require(id: string): any;
declare function setTimeout(fn: () => void, ms: number): unknown;
declare function clearTimeout(h: unknown): void;

import {
  GATE_MAX_WAIT_MS,
  IMPORT_STALE_MS,
  PERMISSION_SETTLE_MS,
  PERMISSION_TIMEOUT_MS,
  SYNC_TIMEOUT_MS,
  connectNotice,
  createHealthFlow,
  createImportShare,
  createRetryQueue,
  isImportStale,
  settleWriteGrant,
  runConnect,
  runGuardedImport,
  switchOff,
  type FlowClock,
} from "../lib/healthConnectFlow";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0;
let failed = 0;
let finished = false;
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

process.on("beforeExit", () => {
  if (finished) return;
  console.log("  x the run ended with unfinished work (a promise never settled)");
  process.exit(1);
});

const SECTION_LIMIT_MS = 5000;
async function section(name: string, body: () => Promise<void>): Promise<void> {
  console.log(name);
  let timer: unknown = null;
  const limit = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), SECTION_LIMIT_MS);
  });
  const outcome = await Promise.race([body().then(() => "done" as const), limit]);
  clearTimeout(timer);
  if (outcome === "hung") {
    failed++;
    console.log(`  x section hung: ${name}`);
  }
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
    for (let i = 0; i < 20; i++) await Promise.resolve();
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

type Access = { read: boolean; newlyEnabled: boolean };

/** The dashboard's connect wiring with every effect recorded. */
function harness(opts: {
  isBlocked?: () => boolean;
  request?: (wanted: () => boolean) => Promise<Access>;
  sync?: () => Promise<string>;
}) {
  const c = fakeClock();
  const flow = createHealthFlow({ isBlocked: opts.isBlocked ?? (() => false), clock: c.clock });
  const log: string[] = [];
  const state = { syncing: false, switchOn: true, requests: 0, syncs: 0, mirrorOn: false };
  const connect = () =>
    runConnect<Access, string>(flow, {
      setSyncing: (on) => {
        state.syncing = on;
      },
      onBlocked: () => log.push("blocked"),
      request: (wanted) => {
        state.requests++;
        const req = opts.request ?? (async () => ({ read: true, newlyEnabled: true }));
        // The mirror is switched on only for a run that is still wanted.
        return req(wanted).then((a) => {
          if (a.newlyEnabled && wanted()) state.mirrorOn = true;
          return a;
        });
      },
      onDenied: async () => {
        state.switchOn = false;
        log.push("denied");
      },
      sync: (session) =>
        runGuardedImport<string>(
          flow,
          {
            setSyncing: (on) => {
              state.syncing = on;
            },
            run: () => {
              state.syncs++;
              return (opts.sync ?? (async () => "ok"))();
            },
            onResult: async (r) => {
              log.push(`result:${r}`);
            },
          },
          session
        ),
      onConnected: async (synced, access) => {
        log.push(`connected:${synced}:${access.newlyEnabled}`);
      },
    });
  return { c, flow, log, state, connect };
}

async function main() {
  await section("A. modal open: no request; closed: exactly one, after the settle time", async () => {
    let covered = true;
    const h = harness({ isBlocked: () => covered });
    h.flow.touch();
    const run = h.connect();
    await h.c.advance(5000);
    eq("no request while the modal is up", h.state.requests, 0);
    ok("the card shows Syncing while it waits", h.state.syncing);
    covered = false;
    h.flow.touch();
    await h.c.advance(PERMISSION_SETTLE_MS - 100);
    eq("still none inside the settle time", h.state.requests, 0);
    await h.c.advance(400);
    eq("one request after the modal is gone", h.state.requests, 1);
    eq("outcome", await run, "done");
    await h.c.advance(10_000);
    eq("never asked a second time", h.state.requests, 1);
    ok("Syncing is cleared at the end", !h.state.syncing);
    eq("no timer is left behind", h.c.pending(), 0);
  });

  await section("A2. nothing covering: no needless delay", async () => {
    const h = harness({});
    const run = h.connect();
    await h.c.flush();
    eq("asked at once on a free screen", h.state.requests, 1);
    await run;
  });

  await section("A3. a screen covered past the limit never asks and reports blocked", async () => {
    const h = harness({ isBlocked: () => true });
    const run = h.connect();
    await h.c.advance(GATE_MAX_WAIT_MS + 1000);
    eq("outcome", await run, "blocked");
    eq("no request", h.state.requests, 0);
    eq("the caller was told to retry", h.log, ["blocked"]);
    ok("Syncing is cleared", !h.state.syncing);
    eq("no timer is left behind", h.c.pending(), 0);
  });

  await section("A4. a second modal during the settle time restarts it", async () => {
    let covered = false;
    const h = harness({ isBlocked: () => covered });
    h.flow.touch();
    const run = h.connect();
    await h.c.advance(600);
    covered = true;
    await h.c.advance(600);
    eq("nothing while it is covered again", h.state.requests, 0);
    covered = false;
    await h.c.advance(PERMISSION_SETTLE_MS + 400);
    await run;
    eq("one request once it is really free", h.state.requests, 1);
  });

  await section("B. a permission sheet read past the limit: UI is freed, the late grant still imports", async () => {
    let grant: (a: Access) => void = () => {};
    const h = harness({ request: () => new Promise<Access>((r) => (grant = r)) });
    const run = h.connect();
    await h.c.advance(PERMISSION_TIMEOUT_MS + 10);
    ok("Syncing ended at the timeout", !h.state.syncing);
    eq("no sync yet", h.state.syncs, 0);
    grant({ read: true, newlyEnabled: true });
    await h.c.advance(100);
    eq("outcome", await run, "done");
    eq("the late grant started the import", h.state.syncs, 1);
    eq("and the normal follow-up ran", h.log, ["result:ok", "connected:ok:true"]);
    ok("the mirror switched on for the wanted run", h.state.mirrorOn);
    ok("Syncing is cleared at the end", !h.state.syncing);
    eq("no timer is left behind", h.c.pending(), 0);
  });

  await section("B2. a sync longer than the limit: UI freed, no error, result still lands", async () => {
    let finish: (v: string) => void = () => {};
    const h = harness({ sync: () => new Promise<string>((r) => (finish = r)) });
    const run = h.connect();
    await h.c.advance(SYNC_TIMEOUT_MS + 10);
    ok("Syncing ended at the timeout", !h.state.syncing);
    eq("nothing reported as an error", h.log, []);
    finish("ok");
    await h.c.advance(100);
    eq("outcome", await run, "done");
    eq("the late import is reported and the connect completes", h.log, ["result:ok", "connected:ok:true"]);
  });

  await section("B3. a hung request that never comes back ends with no timer left", async () => {
    const h = harness({ request: () => new Promise<Access>(() => {}) });
    const run = h.connect();
    await h.c.advance(PERMISSION_TIMEOUT_MS + 10);
    ok("Syncing ended", !h.state.syncing);
    h.flow.cancel();
    eq("a cancel ends the waiting run", await run, "stale");
    eq("no timer is left behind", h.c.pending(), 0);
  });

  await section("C. switching off (switchOff) cancels; a late answer changes nothing", async () => {
    let grant: (a: Access) => void = () => {};
    const h = harness({ request: () => new Promise<Access>((r) => (grant = r)) });
    const run = h.connect();
    await h.c.flush();
    eq("the request is out", h.state.requests, 1);
    const persisted: boolean[] = [];
    const ui = { syncing: true, switchOn: true };
    await switchOff(h.flow, {
      setSyncing: (on) => (ui.syncing = on),
      setSwitch: (on) => (ui.switchOn = on),
      persist: async (on) => {
        persisted.push(on);
      },
    });
    eq("off clears Syncing at once", ui.syncing, false);
    eq("off flips the switch at once", ui.switchOn, false);
    eq("off is persisted", persisted, [false]);
    eq("the waiting run ends", await run, "stale");
    grant({ read: true, newlyEnabled: true });
    await h.c.advance(1000);
    eq("the late grant starts no sync", h.state.syncs, 0);
    eq("the late grant switches no mirror on", h.state.mirrorOn, false);
    eq("nothing else happened", h.log, []);
    eq("no timer is left behind", h.c.pending(), 0);
  });

  await section("C2. switching off while the gate still waits", async () => {
    const h = harness({ isBlocked: () => true });
    const run = h.connect();
    await h.c.advance(3000);
    h.flow.cancel();
    eq("outcome", await run, "stale");
    eq("never asked", h.state.requests, 0);
    eq("no timer is left behind", h.c.pending(), 0);
  });

  await section("C3. a newer run supersedes the older one", async () => {
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
  });

  await section("C4. a late result of a superseded run is dropped", async () => {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => false, clock: c.clock });
    const a = flow.start();
    let resolveA: (v: number) => void = () => {};
    const raced = a.race(new Promise<number>((r) => (resolveA = r)), 1000);
    await c.advance(1001);
    const first = await raced;
    eq("timeout reported", first.kind, "timeout");
    ok("a timed-out run is still wanted", a.current());
    flow.start();
    resolveA(5);
    eq("after a newer run the late value is stale", first.kind === "timeout" ? await first.late : null, { kind: "stale" });
  });

  await section("B4. a late grant shows Syncing again while its import runs", async () => {
    let grant: (a: Access) => void = () => {};
    let finish: (v: string) => void = () => {};
    const h = harness({
      request: () => new Promise<Access>((r) => (grant = r)),
      sync: () => new Promise<string>((r) => (finish = r)),
    });
    const run = h.connect();
    await h.c.advance(PERMISSION_TIMEOUT_MS + 10);
    ok("freed at the timeout", !h.state.syncing);
    grant({ read: true, newlyEnabled: false });
    await h.c.advance(50);
    eq("the import started", h.state.syncs, 1);
    ok("Syncing is back while the late import runs", h.state.syncing);
    finish("ok");
    await h.c.advance(50);
    eq("done", await run, "done");
    ok("Syncing cleared", !h.state.syncing);
  });

  await section("C5. switching off during the first import: no connect follow-up at all", async () => {
    let finish: (v: string) => void = () => {};
    const h = harness({ sync: () => new Promise<string>((r) => (finish = r)) });
    const run = h.connect();
    await h.c.advance(50);
    eq("the import is running", h.state.syncs, 1);
    await switchOff(h.flow, { setSyncing: () => {}, setSwitch: () => {}, persist: async () => {} });
    finish("ok");
    await h.c.advance(100);
    eq("outcome", await run, "stale");
    eq("no connected event, write-on toast or backfill offer", h.log.filter((l) => l.startsWith("connected")), []);
    eq("no result handled", h.log.filter((l) => l.startsWith("result")), []);
  });

  await section("C6. the write mirror follows the run (real settleWriteGrant)", async () => {
    let enabled = 0;
    const enable = async () => {
      enabled++;
      return true;
    };
    eq("new grant, wanted run: switched on", await settleWriteGrant({ write: true, wasAuthorized: false, wanted: () => true, enable }), true);
    eq("new grant, cancelled run: not switched on", await settleWriteGrant({ write: true, wasAuthorized: false, wanted: () => false, enable }), false);
    eq("existing grant: left alone", await settleWriteGrant({ write: true, wasAuthorized: true, wanted: () => true, enable }), false);
    eq("write refused: nothing", await settleWriteGrant({ write: false, wasAuthorized: false, wanted: () => true, enable }), false);
    eq("enable ran exactly once", enabled, 1);
    ok("health.ts passes the run's wanted() to it", /settleWriteGrant\(\{[\s\S]*?wanted,/.test(src("lib/services/health.ts")));
  });

  await section("H. retry belongs to the profile that asked", async () => {
    let active: string | null = "A";
    let focused = false;
    const ran: string[] = [];
    const q = createRetryQueue({
      activeProfileId: () => active,
      isFocused: () => focused,
      run: (kind, id) => ran.push(`${kind}:${id}`),
    });
    q.queue("sync", "A");
    q.queue("connect", "A");
    eq("the first request wins", q.pending(), { kind: "sync", profileId: "A" });
    q.flush();
    eq("nothing while the screen is covered", ran, []);
    focused = true;
    q.flush();
    eq("runs once for the asking profile", ran, ["sync:A"]);
    q.flush();
    eq("and only once", ran, ["sync:A"]);

    q.queue("sync", "A");
    active = "C";
    q.flush();
    eq("a switch to another profile drops it (nothing runs for C)", ran, ["sync:A"]);
    eq("and clears the entry", q.pending(), null);

    q.queue("connect", "C");
    q.clear();
    q.flush();
    eq("a profile change clears it", ran, ["sync:A"]);
    const dash = src("app/(tabs)/index.tsx");
    ok("the dashboard queues with the profile id", /retryQueue\.queue\("sync", profileId\)/.test(dash) && /retryQueue\.queue\("connect", profileId\)/.test(dash));
    ok("the profile effect clears the queue", /setCgmOn\(null\);\s*retryQueue\.clear\(\)/.test(dash));
    ok("a retried sync re-checks the profile's own switch", /readProfileFlag\(CGM_KEY, profileId\)\s*\.then\(\(on\) =>\s*\{\s*if \(on && activeProfileIdRef/.test(dash));
  });

  await section("D. import runs: gate before the import, never bypassed", async () => {
    const c = fakeClock();
    let covered = true;
    const flow = createHealthFlow({ isBlocked: () => covered, clock: c.clock });
    flow.touch();
    let imports = 0;
    const results: string[] = [];
    const run = runGuardedImport<string>(flow, {
      setSyncing: () => {},
      run: async () => {
        imports++;
        return "ok";
      },
      onResult: async (r) => {
        results.push(r);
      },
    });
    await c.advance(8000);
    eq("no import while covered", imports, 0);
    covered = false;
    flow.touch();
    await c.advance(PERMISSION_SETTLE_MS + 300);
    eq("one import once clear", await run, "ok");
    eq("imports", imports, 1);
    eq("result handled once", results, ["ok"]);
  });

  await section("D2. covered import reports blocked (caller retries when the screen clears)", async () => {
    const c = fakeClock();
    const flow = createHealthFlow({ isBlocked: () => true, clock: c.clock });
    let blocked = 0;
    let imports = 0;
    const run = runGuardedImport<string>(flow, {
      setSyncing: () => {},
      onBlocked: () => blocked++,
      run: async () => {
        imports++;
        return "ok";
      },
      onResult: async () => {},
    });
    await c.advance(GATE_MAX_WAIT_MS + 500);
    eq("returns null", await run, null);
    eq("blocked reported once", blocked, 1);
    eq("no import", imports, 0);
  });

  await section("E. refused access", async () => {
    eq("refused read is a refusal", connectNotice({ kind: "value", value: { read: false } }), "denied");
    eq("granted read has nothing to say", connectNotice({ kind: "value", value: { read: true } }), "none");
    eq("a timeout is not a refusal", connectNotice({ kind: "timeout" }), "timeout");
    eq("a superseded run says nothing", connectNotice({ kind: "stale" }), "none");
    const h = harness({ request: async () => ({ read: false, newlyEnabled: false }) });
    eq("denied outcome", await h.connect(), "denied");
    eq("denied stops before the sync", h.state.syncs, 0);
    eq("the switch is off and the denial reported", h.log, ["denied"]);
    ok("Syncing is cleared", !h.state.syncing);
  });

  await section("F. a hung import is not shared forever (the real share used by health.ts)", async () => {
    ok("fresh import is shared", !isImportStale(1000, 1000 + IMPORT_STALE_MS - 1));
    ok("a hung import is not", isImportStale(1000, 1000 + IMPORT_STALE_MS));
    ok("stale limit is under the sync timeout", IMPORT_STALE_MS < SYNC_TIMEOUT_MS);

    let now = 0;
    const share = createImportShare<string>(() => now);
    let starts = 0;
    const hang = () => {
      starts++;
      return new Promise<string>(() => {});
    };
    void share.share("p", hang);
    void share.share("p", hang);
    eq("overlapping callers share one import", starts, 1);
    now = IMPORT_STALE_MS - 1;
    void share.share("p", hang);
    eq("still shared just before the limit", starts, 1);
    now = IMPORT_STALE_MS;
    void share.share("p", hang);
    eq("a hung import is replaced by a fresh one after the limit", starts, 2);
    void share.share("other", hang);
    eq("another profile is independent", starts, 3);

    let resolveIt: (v: string) => void = () => {};
    const quick = createImportShare<string>(() => now);
    const first = quick.share("p", () => new Promise<string>((r) => (resolveIt = r)));
    resolveIt("done");
    eq("the shared result", await first, "done");
    let again = 0;
    await quick.share("p", async () => {
      again++;
      return "x";
    });
    eq("a finished import is not reused", again, 1);

    const wired = src("lib/services/health.ts");
    ok("health.ts shares imports through the tested helper", /importShare\.share\((profileId|key),/.test(wired));
  });

  await section("G. wiring", async () => {
    const dash = src("app/(tabs)/index.tsx");
    ok("connect goes through runConnect (via connectHealthSync)", /connectHealthSync\(healthFlow/.test(dash) && /runConnect</.test(src("lib/cgm/connectSync.ts")));
    ok("the connect passes the run's wanted() to the permission request", /requestHealthReadWriteAccess\(profileId, wanted\)/.test(dash));
    ok("sync goes through runGuardedImport", /runGuardedImport<SyncResult>\(\s*healthFlow/.test(dash));
    ok("off goes through switchOff", /switchOff\(healthFlow/.test(dash));
    ok("the dashboard drops the flow on unmount", /=> healthFlow\.cancel\(\), \[healthFlow\]/.test(dash));
    ok("a covered screen retries once it clears", /flushRetry\(\)/.test(dash));
    ok("the screen is not free until focus says so", /const focusedRef = useRef\(false\)/.test(dash));
    ok("the Android read refusal has its own text", /healthReadDeniedStepsAndroid/.test(dash));
    ok("onboarding bounds its Health request", /session\.race\(requestHealthPermissions\(\), PERMISSION_TIMEOUT_MS\)/.test(src("app/onboarding.tsx")));
    for (const lang of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
      ok(`${lang} has the read-denied text`, /healthReadDeniedStepsAndroid: "/.test(src(`lib/i18n/locales/${lang}.ts`)));
    }
    const en = src("lib/i18n/locales/en.ts");
    ok("the read text says reading, not writing", /healthReadDeniedStepsAndroid: "[^"]*reading Blood glucose/.test(en));
  });

  finished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
