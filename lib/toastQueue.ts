/**
 * Single-slot toast state machine behind components/Feedback.tsx. Pure and free
 * of React / Animated: the component runs the returned effects.
 *
 * Exactly one toast is ever visible: a new toast replaces the current one on the
 * spot. The earlier build kept the old message mounted while it faded out, so a
 * toast fired during the exit animation re-showed the dying one for a moment.
 * Every pending timer and exit animation is tagged with a toast id, and any
 * event carrying a stale id is ignored.
 *
 * One exception protects the "Undo" window: a plain success/info toast that
 * arrives while a toast carrying an action is on screen waits in a short FIFO
 * and appears after that toast leaves, instead of wiping the button out. Errors
 * and toasts with their own action are never held back.
 */

export type ToastPhase = "idle" | "in" | "shown" | "out";

export interface ToastItem<A = unknown> {
  id: number;
  message: string;
  kind: string;
  action: A | null;
}

export interface QueuedToast {
  message: string;
  kind: string;
  visibleMs: number;
}

export interface ToastState<A = unknown> {
  current: ToastItem<A> | null;
  phase: ToastPhase;
  queue: QueuedToast[];
  seq: number;
  /** OS "Reduce Motion": the toast appears and disappears in a single frame. */
  reduceMotion: boolean;
}

export type ToastEvent<A = unknown> =
  | { type: "show"; message: string; kind: string; action: A | null; visibleMs: number }
  | { type: "hideDue"; id: number }
  | { type: "exitDone"; id: number; finished: boolean }
  | { type: "actionRun"; id: number }
  | { type: "motion"; reduceMotion: boolean };

export type ToastEffect =
  | { type: "disarm" }
  | { type: "reset" }
  | { type: "enter"; ms: number }
  | { type: "arm"; id: number; ms: number }
  | { type: "exit"; id: number; ms: number };

export const TOAST_ENTER_MS = 220;
export const TOAST_EXIT_MS = 220;
export const TOAST_ACTION_EXIT_MS = 160;
export const TOAST_QUEUE_MAX = 3;
/** Max card width on a tablet; phones are narrower than this anyway. */
export const TOAST_MAX_WIDTH = 560;

/** How long a toast stays up: 5 s when it carries an action ("Undo"), the same
 *  window as the undo batch (lib/feedback.ts UNDO_TOAST_MS); longer with a
 *  screen reader, which needs time to reach the button. */
export function toastVisibleMs(opts: {
  hasAction: boolean;
  screenReader: boolean;
  plainMs: number;
  actionMs: number;
  actionScreenReaderMs: number;
}): number {
  if (!opts.hasAction) return opts.plainMs;
  return opts.screenReader ? opts.actionScreenReaderMs : opts.actionMs;
}

/** An action with an optional quieter second button (e.g. "Add region" + "Undo"). */
export interface TwoButtonAction {
  label: string;
  onPress: () => void | Promise<void>;
  secondary?: { label: string; onPress: () => void | Promise<void> };
}

/** The button that was pressed: the secondary one only when asked for AND present. */
export function pickToastAction<A extends TwoButtonAction>(
  action: A,
  which?: "secondary"
): { label: string; onPress: () => void | Promise<void> } {
  return which === "secondary" && action.secondary ? action.secondary : action;
}

/** What a screen reader hears when the toast appears: the message, then every
 *  button on offer (the toast never takes focus, so this is the only cue). */
export function toastAnnouncement(message: string, action?: TwoButtonAction | null): string {
  if (!action) return message;
  return action.secondary
    ? `${message}. ${action.label}. ${action.secondary.label}`
    : `${message}. ${action.label}`;
}

export function initialToastState<A = unknown>(): ToastState<A> {
  return { current: null, phase: "idle", queue: [], seq: 0, reduceMotion: false };
}

function holdsUndoWindow<A>(state: ToastState<A>): boolean {
  return (
    state.current?.action != null && (state.phase === "in" || state.phase === "shown")
  );
}

function enqueue(queue: QueuedToast[], item: QueuedToast): QueuedToast[] {
  const last = queue[queue.length - 1];
  if (last && last.message === item.message && last.kind === item.kind) return queue;
  return [...queue, item].slice(-TOAST_QUEUE_MAX);
}

export function reduceToast<A>(
  state: ToastState<A>,
  ev: ToastEvent<A>
): { state: ToastState<A>; effects: ToastEffect[] } {
  switch (ev.type) {
    case "show": {
      if (ev.action == null && ev.kind !== "error" && holdsUndoWindow(state)) {
        const queue = enqueue(state.queue, { message: ev.message, kind: ev.kind, visibleMs: ev.visibleMs });
        return { state: queue === state.queue ? state : { ...state, queue }, effects: [] };
      }
      const id = state.seq + 1;
      const item: ToastItem<A> = { id, message: ev.message, kind: ev.kind, action: ev.action };
      // A toast that is still fully on screen is swapped in place (no flicker).
      // One that is fading out, or gone, restarts from 0 so the new content
      // never appears at the dying toast's half-faded opacity.
      const visible = state.phase === "in" || state.phase === "shown";
      const effects: ToastEffect[] = [{ type: "disarm" }];
      if (!visible) effects.push({ type: "reset" });
      effects.push({ type: "enter", ms: state.reduceMotion ? 0 : TOAST_ENTER_MS }, { type: "arm", id, ms: ev.visibleMs });
      return { state: { ...state, current: item, phase: "in", seq: id }, effects };
    }
    case "hideDue": {
      const c = state.current;
      if (!c || c.id !== ev.id || (state.phase !== "in" && state.phase !== "shown")) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, current: { ...c, action: null }, phase: "out" },
        effects: [{ type: "exit", id: c.id, ms: state.reduceMotion ? 0 : TOAST_EXIT_MS }],
      };
    }
    case "actionRun": {
      const c = state.current;
      if (!c || c.id !== ev.id || (state.phase !== "in" && state.phase !== "shown")) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, current: { ...c, action: null }, phase: "out" },
        effects: [
          { type: "disarm" },
          { type: "exit", id: c.id, ms: state.reduceMotion ? 0 : TOAST_ACTION_EXIT_MS },
        ],
      };
    }
    case "motion":
      return { state: { ...state, reduceMotion: ev.reduceMotion }, effects: [] };
    case "exitDone": {
      const c = state.current;
      // An interrupted exit (finished === false) was cancelled by a newer toast.
      if (!c || c.id !== ev.id || state.phase !== "out" || !ev.finished) {
        return { state, effects: [] };
      }
      const [next, ...rest] = state.queue;
      if (!next) return { state: { ...state, current: null, phase: "idle" }, effects: [] };
      const id = state.seq + 1;
      return {
        state: {
          ...state,
          current: { id, message: next.message, kind: next.kind, action: null },
          phase: "in",
          queue: rest,
          seq: id,
        },
        effects: [
          { type: "disarm" },
          { type: "reset" },
          { type: "enter", ms: state.reduceMotion ? 0 : TOAST_ENTER_MS },
          { type: "arm", id, ms: next.visibleMs },
        ],
      };
    }
  }
}
