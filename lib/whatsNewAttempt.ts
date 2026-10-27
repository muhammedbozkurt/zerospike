import { SURVEY_ASKED_KEY, SURVEY_PENDING_KEY, type KeyValueStore } from "./feedbackSurvey";
import { isWhatsNewRoute, surveyInTheWay, takeWhatsNew } from "./whatsNew";

/**
 * One attempt of the What's new host to open its sheet, kept out of the
 * component so the loop-safety rules are testable under plain node.
 *
 * - "busy": another self-opening sheet holds the slot. The host is WAITING and
 *   is woken when that slot is released.
 * - "nothing": nothing to show (the survey is in the way, or the sheet was
 *   already seen). Final for the session: the host must not try again.
 * - "retry": the screen changed while storage was read; the flag was not touched.
 * - "opened": the flag is consumed and the sheet is going up (the slot stays
 *   held until it closes).
 */
export type WhatsNewAttempt = "busy" | "nothing" | "retry" | "opened";

export interface WhatsNewAttemptDeps {
  claim: () => (() => void) | null;
  kv: KeyValueStore;
  askedAtStart: boolean;
  latest: () => { root: string | undefined; onboarded: boolean };
  surveyHeld: () => boolean;
  appVersion: string;
  open: (slot: () => void) => void;
}

export async function attemptWhatsNew(d: WhatsNewAttemptDeps): Promise<WhatsNewAttempt> {
  const slot = d.claim();
  if (!slot) return "busy";
  let opened = false;
  try {
    if (await surveyInTheWay(d.kv, d.askedAtStart, { pending: SURVEY_PENDING_KEY, asked: SURVEY_ASKED_KEY })) {
      return "nothing";
    }
    const again = d.latest();
    if (!isWhatsNewRoute(again.root) || d.surveyHeld()) return "retry";
    const due = await takeWhatsNew(d.kv, { onboarded: again.onboarded, appVersion: d.appVersion });
    if (!due) return "nothing";
    opened = true;
    d.open(slot);
    return "opened";
  } finally {
    if (!opened) slot();
  }
}

/**
 * The host's two bits of memory. `done` is set once an attempt found nothing to
 * show, so the host stops polling for the rest of the session. `waiting` is set
 * only when the host was turned away (slot or overlay taken), so a slot release
 * wakes the host that is actually waiting and never the one that just released.
 */
export function createAttemptMemory() {
  let done = false;
  let waiting = false;
  return {
    isDone: () => done,
    markDone: () => {
      done = true;
    },
    markWaiting: () => {
      waiting = true;
    },
    /** True once per waiting spell: whether a release should wake the host. */
    takeWake: () => {
      const w = waiting;
      waiting = false;
      return w;
    },
  };
}

export type AttemptMemory = ReturnType<typeof createAttemptMemory>;

/** What each answer means for the host's memory (the loop-safety rules). */
export function applyAttemptResult(memory: AttemptMemory, result: WhatsNewAttempt): void {
  if (result === "nothing" || result === "opened") memory.markDone();
  else memory.markWaiting();
}

export interface SchedulerDeps {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  delayMs: number;
  /** The host's own preconditions: ready, onboarded, a tab screen, sheet not up. */
  eligible: () => boolean;
  /** Nothing else (winback, an open Modal, the survey's state) is in the way. */
  gateOpen: () => boolean;
  attempt: () => Promise<WhatsNewAttempt>;
  /** Run the host's effect again. */
  rerun: () => void;
}

/**
 * The host's effect and its release listener as one testable unit. start() is
 * the effect body (returns the cleanup); onRelease() is the slot/overlay
 * release listener, which re-runs the host only if it was turned away.
 */
export function createWhatsNewScheduler(d: SchedulerDeps) {
  const memory = createAttemptMemory();
  return {
    start(): () => void {
      if (!d.eligible() || memory.isDone()) return () => {};
      const handle = d.setTimer(() => {
        if (!d.gateOpen()) {
          memory.markWaiting();
          return;
        }
        void d.attempt().then((result) => applyAttemptResult(memory, result));
      }, d.delayMs);
      return () => d.clearTimer(handle);
    },
    onRelease(): void {
      if (memory.takeWake()) d.rerun();
    },
    isDone: () => memory.isDone(),
  };
}
