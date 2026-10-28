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
 *   has passed (the gate), every wait is bounded (the timeout), and a switch-off
 *   supersedes a run in flight so a late answer changes nothing (the token).
 * - The import in flight is shared per profile, so one hung run made every later
 *   tap return the same hung promise (see isImportStale).
 */

/** A native-stack modal slides out in well under a second; the rest is margin. */
export const PERMISSION_SETTLE_MS = 1000;
export const GATE_POLL_MS = 200;
/** A screen that stays covered this long gets no request at all. */
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

export type RaceOutcome<T> =
  | { kind: "value"; value: T }
  | { kind: "timeout" }
  | { kind: "stale" };

export interface FlowSession {
  readonly id: number;
  /** Not superseded, not cancelled and not timed out. */
  current(): boolean;
  /** Still the latest run: true after a timeout too, false after a cancel or a newer run. */
  owns(): boolean;
  /** Resolves true once nothing covers the screen and the settle time passed. */
  clear(): Promise<boolean>;
  /** Waits for `promise` at most `ms`; a cancel or newer run resolves "stale" at once. */
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
    resolve: (ok: boolean) => void;
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
        w.resolve(false);
      } else if (clearNow) {
        waiters.delete(w);
        w.resolve(true);
      } else if (t >= w.deadline) {
        waiters.delete(w);
        w.resolve(false);
      }
    }
    if (waiters.size > 0) pollTimer = clock.setTimer(evaluate, pollMs);
  };

  /** A run stops mattering: free every pending wait and race of the older runs. */
  const supersede = () => {
    generation += 1;
    for (const f of [...flushers]) f();
    flushers.clear();
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
      let expired = false;
      const session: FlowSession = {
        id,
        current: () => generation === id && !expired,
        owns: () => generation === id,
        clear(): Promise<boolean> {
          if (!session.current()) return Promise.resolve(false);
          return new Promise<boolean>((resolve) => {
            waiters.add({ session: id, deadline: clock.now() + maxWaitMs, resolve });
            stopPoll();
            evaluate();
          });
        },
        race<T>(promise: Promise<T>, ms: number): Promise<RaceOutcome<T>> {
          if (!session.current()) return Promise.resolve({ kind: "stale" });
          return new Promise<RaceOutcome<T>>((resolve) => {
            let done = false;
            const settle = (out: RaceOutcome<T>) => {
              if (done) return;
              done = true;
              clock.clearTimer(timer);
              flushers.delete(flush);
              resolve(out);
            };
            const flush = () => settle({ kind: "stale" });
            const timer = clock.setTimer(() => {
              expired = true;
              settle({ kind: "timeout" });
            }, ms);
            flushers.add(flush);
            promise.then(
              (value) => settle(session.current() ? { kind: "value", value } : { kind: "stale" }),
              () => settle({ kind: "stale" })
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

/**
 * Whether an import started at `startedAt` may still be shared with a new
 * caller. A run past the limit is treated as hung and a fresh one starts.
 */
export function isImportStale(startedAt: number, now: number, maxMs: number = IMPORT_STALE_MS): boolean {
  return now - startedAt >= maxMs;
}

export type ConnectNotice = "none" | "denied" | "timeout";

/**
 * What to tell the person after a permission step. A refusal where the grant
 * list is authoritative (Android) sends them to the platform's settings; a
 * timeout is a retry, not a refusal.
 */
export function connectNotice(
  step: RaceOutcome<{ read: boolean }>
): ConnectNotice {
  if (step.kind === "timeout") return "timeout";
  if (step.kind === "stale") return "none";
  return step.value.read ? "none" : "denied";
}
