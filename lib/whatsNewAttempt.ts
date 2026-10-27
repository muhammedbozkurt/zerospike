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
