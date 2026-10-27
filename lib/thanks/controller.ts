import { createSheetPresenter } from "./presenter";
import { thanksMayPresent } from "./gate";

/** The slice of React Native's AppState the controller needs. */
export interface AppStateLike {
  currentState?: string;
  addEventListener: (type: "change", listener: (state: string) => void) => { remove: () => void };
}

export interface ControllerDeps {
  appState: AppStateLike;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** The one-sheet slot (lib/sheetClaim). */
  claim: () => (() => void) | null;
  sheetClaimed: () => boolean;
  onSheetRelease: (cb: () => void) => () => void;
  onSurveyRelease: (cb: () => void) => () => void;
  overlayOpen: () => boolean;
  surveyHeld: () => boolean;
  screenshotMode: () => boolean;
  /** The host's current props and state. */
  latest: () => { ready: boolean; onboarded: boolean; root: string | undefined; visible: boolean };
  /** State setters of the host component. */
  setVisible: (visible: boolean) => void;
  setPending: (value: "none") => void;
  /** Runs the host's effects again (a tick state). */
  nudge: () => void;
  /** The sheet is really on screen: report it and stamp it on disk. */
  logSeen: () => void;
  stampSeen: () => void;
  settleMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

/**
 * Everything the thank-you host does except hold React state: the gate, the
 * AppState routing, the release listeners, and the effect bodies. The component
 * is a thin shell that sets state and renders (components/ThanksSheet.tsx), so
 * this can be driven with a fake AppState and a fake clock under plain node.
 */
export function createThanksController(d: ControllerDeps) {
  let foreground = 0;
  let evaluatedIn = -1;

  const clear = (): boolean => {
    const s = d.latest();
    return thanksMayPresent({
      ready: s.ready,
      onboarded: s.onboarded,
      screenshotMode: d.screenshotMode(),
      root: s.root,
      overlayOpen: d.overlayOpen() || d.sheetClaimed(),
      winbackHold: d.surveyHeld(),
      sheetVisible: s.visible,
    });
  };

  const presenter = createSheetPresenter({
    setTimer: d.setTimer,
    clearTimer: d.clearTimer,
    clear,
    claim: d.claim,
    setVisible: d.setVisible,
    clearPending: () => d.setPending("none"),
    onSeen: () => {
      d.logSeen();
      d.stampSeen();
    },
    nudge: d.nudge,
    settleMs: d.settleMs,
    timeoutMs: d.timeoutMs,
    maxAttempts: d.maxAttempts,
  });

  return {
    clear,
    presenter,
    /**
     * Listeners: AppState (background tears a presentation down, active restarts
     * the flow) and the slot/overlay releases. Returns the cleanup.
     */
    start(): () => void {
      if (d.appState.currentState === "background") presenter.background();
      const sub = d.appState.addEventListener("change", (state) => {
        if (state === "background") presenter.background();
        if (state !== "active") return;
        foreground += 1;
        presenter.foreground();
        d.nudge();
      });
      const offOverlay = d.onSurveyRelease(d.nudge);
      const offSlot = d.onSheetRelease(d.nudge);
      return () => {
        sub.remove();
        offOverlay();
        offSlot();
      };
    },
    /** Whether to take the one look at the entitlement now (once per foreground, only when clear). */
    mayEvaluate(pending: string): boolean {
      if (pending !== "none" || evaluatedIn === foreground || !clear()) return false;
      evaluatedIn = foreground;
      return true;
    },
    /** The sheet effect: schedules the presentation and returns the cleanup. */
    sheetEffect(pending: string): (() => void) | undefined {
      if (pending !== "converted" || !clear()) return undefined;
      return presenter.schedule();
    },
    /** The slot is held from the decision to open until the sheet is gone. */
    onVisible(visible: boolean): void {
      if (!visible) presenter.releaseClaim();
    },
    /** The sheet's onShown (and the close path): the one place a moment is seen. */
    confirm(): void {
      presenter.confirm();
    },
    dispose(): void {
      presenter.dispose();
    },
  };
}
