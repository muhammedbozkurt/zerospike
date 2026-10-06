/**
 * Pure state of the Pro welcome checklist. Persistence lives in
 * lib/services/proWelcome.ts; keeping the rules here makes them testable under
 * plain Node.
 */

export type ProWelcomeStep = "health" | "insights" | "reminders";

export const PRO_WELCOME_STEPS: readonly ProWelcomeStep[] = [
  "health",
  "insights",
  "reminders",
];

/** A step with no entry is still pending. */
export type ProWelcomeStatus = "done" | "skipped";

export type ProWelcomeState = Partial<Record<ProWelcomeStep, ProWelcomeStatus>>;

/** How far back the platform's Health store is read on import. */
export function healthImportDays(platform: "ios" | "android"): number {
  return platform === "ios" ? 90 : 30;
}

/** The Health step only exists where Health can really be connected. */
export function visibleSteps(healthAvailable: boolean): ProWelcomeStep[] {
  return PRO_WELCOME_STEPS.filter((s) => s !== "health" || healthAvailable);
}

export function parseProWelcomeState(raw: string | null | undefined): ProWelcomeState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ProWelcomeState = {};
    for (const step of PRO_WELCOME_STEPS) {
      const v = (parsed as Record<string, unknown>)[step];
      if (v === "done" || v === "skipped") out[step] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeProWelcomeState(state: ProWelcomeState): string {
  return JSON.stringify(state);
}

/**
 * Records one step. Done is final: a later "not now" never takes a finished
 * step back. Returns the SAME object when nothing changes, so a caller can tell
 * a real transition from a repeat.
 */
export function applyStepStatus(
  state: ProWelcomeState,
  step: ProWelcomeStep,
  status: ProWelcomeStatus
): ProWelcomeState {
  const current = state[step];
  if (current === status || current === "done") return state;
  return { ...state, [step]: status };
}

/** Health counts as done when its sync is already on, whatever the checklist says. */
export function withHealthMirror(
  state: ProWelcomeState,
  healthSyncOn: boolean
): ProWelcomeState {
  return healthSyncOn ? applyStepStatus(state, "health", "done") : state;
}

/** Steps still to do among the visible ones. A skipped step is still to do. */
export function incompleteSteps(
  state: ProWelcomeState,
  healthAvailable: boolean
): ProWelcomeStep[] {
  return visibleSteps(healthAvailable).filter((s) => state[s] !== "done");
}

export function incompleteCount(
  state: ProWelcomeState,
  healthAvailable: boolean
): number {
  return incompleteSteps(state, healthAvailable).length;
}

/** Whether a fresh trial or purchase has anything left to show on the welcome. */
export function shouldAutoOpenWelcome(
  state: ProWelcomeState,
  healthAvailable: boolean
): boolean {
  return incompleteCount(state, healthAvailable) > 0;
}

/**
 * How long the welcome keeps waiting for the Health connect it handed to the
 * dashboard (permission dialog, first import). Past it, the connect is taken as
 * abandoned and a later connect from the dashboard no longer pulls the welcome
 * back up on its own.
 */
export const HEALTH_RETURN_WINDOW_MS = 120_000;

/**
 * Whether to come back to the welcome once the dashboard has finished the Health
 * connect the welcome started: only while a step is still open, otherwise the
 * checklist has nothing left to say.
 */
export function shouldReturnToWelcome(
  state: ProWelcomeState,
  healthAvailable: boolean
): boolean {
  return shouldAutoOpenWelcome(withHealthMirror(state, true), healthAvailable);
}
