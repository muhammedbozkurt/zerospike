/**
 * Pure state machine behind the Health connect and sync runs, kept out of the
 * dashboard so it can be driven with fake timers under plain node.
 *
 * Two failures it exists for (build 97, iOS):
 * - The HealthKit permission request was issued while the Pro welcome (a native
 *   stack modal) was still sliding away. iOS cannot present its sheet over a
 *   dismissing modal, so the native promise never settled, "Syncing..." stayed
 *   up for good and switching the sync off did not clear it. So: no system
 *   permission request until nothing is on top of the screen AND a settle time
 *   has passed (the gate), every wait frees the UI after a limit (the timeout),
 *   and a switch-off supersedes a run in flight so a late answer changes
 *   nothing (the token).
 * - The import in flight is shared per profile, so one hung run made every later
 *   tap return the same hung promise (see createImportShare).
 *
 * A timeout only frees the UI. The run it belongs to is still alive: a person
 * who reads the system sheet for a minute and then allows must still get the
 * import. Only a cancel (switch off) or a newer run ends it.
 */

/** A native-stack modal slides out in well under a second; the rest is margin. */
export const PERMISSION_SETTLE_MS = 1000;
export const GATE_POLL_MS = 200;
/** A screen that stays covered this long gets no request now; the caller retries once it clears. */
export const GATE_MAX_WAIT_MS = 15_000;
/** The system sheet may stay open while the person reads it. */
export const PERMISSION_TIMEOUT_MS = 45_000;
export const SYNC_TIMEOUT_MS = 60_000;
/** An import running longer than this is no longer shared with new callers.
 *  Below SYNC_TIMEOUT_MS on purpose: a retry right after a timeout starts fresh. */
export const IMPORT_STALE_MS = 45_000;

export interface FlowClock {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
}

export const realClock: FlowClock = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export type LateOutcome<T> = { kind: "value"; value: T } | { kind: "stale" };

export type RaceOutcome<T> =
  | LateOutcome<T>
  /** `late` settles with the promise's own result if the run is still wanted, "stale" otherwise. */
  | { kind: "timeout"; late: Promise<LateOutcome<T>> };

export type ClearOutcome = "clear" | "blocked" | "stale";

export interface FlowSession {
  readonly id: number;
  /** Not superseded and not cancelled (a timeout does not end a run). */
  current(): boolean;
  /** Same question, named for the "may I clear the flag I set" call sites. */
  owns(): boolean;
  /** "clear" once nothing covers the screen and the settle time passed; "blocked" when it stayed covered. */
  clear(): Promise<ClearOutcome>;
  race<T>(promise: Promise<T>, ms: number): Promise<RaceOutcome<T>>;
}

export interface HealthFlowOptions {
  /** Something stands in the way of a system dialog (not focused, a Modal open). */
  isBlocked: () => boolean;
  clock: FlowClock;
  settleMs?: number;
  pollMs?: number;
  maxWaitMs?: number;
}

export function createHealthFlow(opts: HealthFlowOptions) {
  const { clock, isBlocked } = opts;
  const settleMs = opts.settleMs ?? PERMISSION_SETTLE_MS;
  const pollMs = opts.pollMs ?? GATE_POLL_MS;
  const maxWaitMs = opts.maxWaitMs ?? GATE_MAX_WAIT_MS;

  let generation = 0;
  let lastChange = Number.NEGATIVE_INFINITY;

  interface Waiter {
    session: number;
    deadline: number;
    resolve: (o: ClearOutcome) => void;
  }
  const waiters = new Set<Waiter>();
  const flushers = new Set<() => void>();
  let pollTimer: unknown = null;

  const stopPoll = () => {
    if (pollTimer !== null) clock.clearTimer(pollTimer);
    pollTimer = null;
  };

  const evaluate = () => {
    pollTimer = null;
    const t = clock.now();
    if (isBlocked()) lastChange = t;
    const clearNow = t - lastChange >= settleMs;
    for (const w of [...waiters]) {
      if (w.session !== generation) {
        waiters.delete(w);
        w.resolve("stale");
      } else if (clearNow) {
        waiters.delete(w);
        w.resolve("clear");
      } else if (t >= w.deadline) {
        waiters.delete(w);
        w.resolve("blocked");
      }
    }
    if (waiters.size > 0) pollTimer = clock.setTimer(evaluate, pollMs);
  };

  /** A run stops mattering: free every pending wait and race of the older runs. */
  const supersede = () => {
    generation += 1;
    const pending = [...flushers];
    flushers.clear();
    for (const f of pending) f();
    stopPoll();
    evaluate();
  };

  return {
    /** The screen's cover changed (focus gained or lost, a Modal closed): restart the settle time. */
    touch(): void {
      lastChange = clock.now();
    },

    /** Begins a run; any run before it is superseded. */
    start(): FlowSession {
      supersede();
      const id = generation;
      const session: FlowSession = {
        id,
        current: () => generation === id,
        owns: () => generation === id,
        clear(): Promise<ClearOutcome> {
          if (!session.current()) return Promise.resolve("stale");
          return new Promise<ClearOutcome>((resolve) => {
            waiters.add({ session: id, deadline: clock.now() + maxWaitMs, resolve });
            stopPoll();
            evaluate();
          });
        },
        race<T>(promise: Promise<T>, ms: number): Promise<RaceOutcome<T>> {
          if (!session.current()) return Promise.resolve({ kind: "stale" });
          return new Promise<RaceOutcome<T>>((resolve) => {
            let phase: "waiting" | "timedOut" | "done" = "waiting";
            let resolveLate: (o: LateOutcome<T>) => void = () => {};
            const finish = (o: LateOutcome<T>) => {
              if (phase === "done") return;
              const wasWaiting = phase === "waiting";
              phase = "done";
              clock.clearTimer(timer);
              flushers.delete(flush);
              if (wasWaiting) resolve(o);
              else resolveLate(o);
            };
            const flush = () => finish({ kind: "stale" });
            const timer = clock.setTimer(() => {
              if (phase !== "waiting") return;
              phase = "timedOut";
              const late = new Promise<LateOutcome<T>>((r) => {
                resolveLate = r;
              });
              resolve({ kind: "timeout", late });
            }, ms);
            flushers.add(flush);
            promise.then(
              (value) => finish(session.current() ? { kind: "value", value } : { kind: "stale" }),
              () => finish({ kind: "stale" })
            );
          });
        },
      };
      return session;
    },

    /** The switch went off (or the screen is gone): nothing in flight may change state any more. */
    cancel(): void {
      supersede();
    },
  };
}

export type HealthFlow = ReturnType<typeof createHealthFlow>;

// -- Orchestration (the dashboard wires its UI into these) -------------------

export interface SwitchOffDeps {
  setSyncing: (on: boolean) => void;
  setSwitch: (on: boolean) => void;
  persist: (on: boolean) => Promise<void>;
}

/** Off is immediate and final: whatever is in flight is superseded and the flags are cleared at once. */
export async function switchOff(flow: HealthFlow, d: SwitchOffDeps): Promise<void> {
  flow.cancel();
  d.setSyncing(false);
  d.setSwitch(false);
  await d.persist(false);
}

export interface ImportDeps<R> {
  setSyncing: (on: boolean) => void;
  run: () => Promise<R>;
  /** Called with the result of a run that is still wanted, on time or late. */
  onResult: (r: R) => Promise<void>;
  /** The screen stayed covered: nothing was asked; try again when it clears. */
  onBlocked?: () => void;
  timeoutMs?: number;
}

/**
 * One import. Without a `shared` session it starts its own and waits for a free
 * screen first (the import may raise the system dialog). A timeout frees the
 * UI; the result still lands if the run is wanted when it arrives.
 */
export async function runGuardedImport<R>(
  flow: HealthFlow,
  d: ImportDeps<R>,
  shared?: FlowSession
): Promise<R | null> {
  const session = shared ?? flow.start();
  d.setSyncing(true);
  try {
    if (!shared) {
      const gate = await session.clear();
      if (gate === "blocked") d.onBlocked?.();
      if (gate !== "clear") return null;
    }
    let out = await session.race(d.run(), d.timeoutMs ?? SYNC_TIMEOUT_MS);
    if (out.kind === "timeout") {
      d.setSyncing(false);
      out = await out.late;
    }
    if (out.kind !== "value") return null;
    await d.onResult(out.value);
    return out.value;
  } finally {
    if (session.owns()) d.setSyncing(false);
  }
}

export interface ConnectAccess {
  read: boolean;
}

export interface ConnectDeps<A extends ConnectAccess, R> {
  setSyncing: (on: boolean) => void;
  /** The system permission request. `wanted` tells whether its follow-up effects still apply. */
  request: (wanted: () => boolean) => Promise<A>;
  onDenied: (access: A) => Promise<void>;
  /** The import after a grant, run on the same session. */
  sync: (session: FlowSession) => Promise<R | null>;
  onConnected: (synced: R | null, access: A) => Promise<void>;
  onBlocked?: () => void;
  timeoutMs?: number;
}

export type ConnectResult = "done" | "denied" | "blocked" | "stale";

/** The connect flow: gate, permission (late answers still count), then the first import. */
export async function runConnect<A extends ConnectAccess, R>(
  flow: HealthFlow,
  d: ConnectDeps<A, R>
): Promise<ConnectResult> {
  const session = flow.start();
  d.setSyncing(true);
  try {
    const gate = await session.clear();
    if (gate === "blocked") d.onBlocked?.();
    if (gate !== "clear") return gate === "blocked" ? "blocked" : "stale";
    let step = await session.race(d.request(() => session.current()), d.timeoutMs ?? PERMISSION_TIMEOUT_MS);
    if (step.kind === "timeout") {
      d.setSyncing(false);
      step = await step.late;
    }
    if (step.kind !== "value") return "stale";
    const access = step.value;
    if (!access.read) {
      await d.onDenied(access);
      return "denied";
    }
    const synced = await d.sync(session);
    if (!session.current()) return "stale";
    await d.onConnected(synced, access);
    return "done";
  } finally {
    if (session.owns()) d.setSyncing(false);
  }
}

export type RetryKind = "connect" | "sync";

export interface RetryQueueDeps {
  activeProfileId: () => string | null;
  isFocused: () => boolean;
  run: (kind: RetryKind, profileId: string) => void;
}

/**
 * One run that found the screen covered for too long, to be tried again once it
 * clears. It belongs to the profile that asked: a profile switch in between
 * drops it, so one profile's Health sync (or connect) can never run for another.
 */
export function createRetryQueue(d: RetryQueueDeps) {
  let queued: { kind: RetryKind; profileId: string } | null = null;
  return {
    queue(kind: RetryKind, profileId: string): void {
      queued ??= { kind, profileId };
    },
    /** Runs the queued retry if the screen is free and the profile is still the one that asked. */
    flush(): void {
      if (queued === null || !d.isFocused()) return;
      const entry = queued;
      queued = null;
      if (entry.profileId !== d.activeProfileId()) return;
      d.run(entry.kind, entry.profileId);
    },
    clear(): void {
      queued = null;
    },
    pending: () => queued,
  };
}

/**
 * The follow-up of a combined read+write permission answer: the write mirror
 * is switched on only for a NEW grant and only while the run that asked is
 * still wanted (a cancelled run must not switch it on unannounced). Returns
 * whether it was switched on.
 */
export async function settleWriteGrant(o: {
  write: boolean;
  wasAuthorized: boolean;
  wanted: () => boolean;
  enable: () => Promise<boolean>;
}): Promise<boolean> {
  if (o.write && !o.wasAuthorized && o.wanted()) return o.enable();
  return false;
}

/**
 * Imports in flight, one per key. A run past `maxMs` is treated as hung: a new
 * caller starts a fresh one instead of being handed the old promise.
 */
export function createImportShare<T>(now: () => number, maxMs: number = IMPORT_STALE_MS) {
  const inFlight = new Map<string, { promise: Promise<T>; startedAt: number }>();
  return {
    share(key: string, start: () => Promise<T>): Promise<T> {
      const running = inFlight.get(key);
      if (running && !isImportStale(running.startedAt, now(), maxMs)) return running.promise;
      const promise: Promise<T> = start().finally(() => {
        if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
      });
      inFlight.set(key, { promise, startedAt: now() });
      return promise;
    },
  };
}

/** Whether an import started at `startedAt` may still be shared with a new caller. */
export function isImportStale(startedAt: number, now: number, maxMs: number = IMPORT_STALE_MS): boolean {
  return now - startedAt >= maxMs;
}

export type ConnectNotice = "none" | "denied" | "timeout";

/**
 * What to tell the person after a permission step. A refusal where the grant
 * list is authoritative (Android) sends them to the platform's settings; a
 * timeout is neither (the answer may still come).
 */
export function connectNotice(
  step: { kind: "value"; value: { read: boolean } } | { kind: "timeout" } | { kind: "stale" }
): ConnectNotice {
  if (step.kind === "timeout") return "timeout";
  if (step.kind === "stale") return "none";
  return step.value.read ? "none" : "denied";
}
