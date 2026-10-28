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

/**
 * The slice of the router the welcome's buttons need. A button that leads to
 * another screen must close this modal first: on iOS a push issued while the
 * modal is up lands underneath it, so nothing changes on screen and "Continue"
 * then needs a second tap (same fix as app/alarm-tour.tsx).
 */
export interface WelcomeNav<H> {
  canGoBack: () => boolean;
  back: () => void;
  push: (href: H) => void;
}

/**
 * Dismiss first, then go. The dismiss only happens when there is something
 * under the modal: the welcome can be the root of a launch flow, and a back()
 * with nothing behind it is a no-op that would leave it sitting over the target.
 */
export function leaveThen<H>(nav: WelcomeNav<H>, href: H): void {
  if (nav.canGoBack()) nav.back();
  nav.push(href);
}

export type WelcomeFeatureId = "insights" | "pdf" | "cgm" | "health" | "spike";

/**
 * What Pro opens, in the order the welcome lists it. Every entry is a benefit the
 * paywall already sells. The fourth slot is the Health sync where Health can be
 * connected, and the larger Spike allowance everywhere else.
 */
export function welcomeFeatures(healthAvailable: boolean): WelcomeFeatureId[] {
  return ["insights", "pdf", "cgm", healthAvailable ? "health" : "spike"];
}

/** "Connect my data" shows only where Health exists and is not connected yet. */
export function showConnectData(
  state: ProWelcomeState,
  healthAvailable: boolean
): boolean {
  return healthAvailable && state.health !== "done";
}

/** The reminder shortcut disappears once a reminder was set up from here. */
export function showReminderStep(state: ProWelcomeState): boolean {
  return state.reminders !== "done";
}

export interface CelebrationPlan {
  /** Badge spring, halo pulse and sparks run. False is the static final look. */
  animate: boolean;
  /** Number of sparks drawn around the badge. */
  sparks: number;
}

/** Reduce Motion means no motion at all: a still badge, no sparks. */
export function celebrationPlan(reducedMotion: boolean): CelebrationPlan {
  return reducedMotion ? { animate: false, sparks: 0 } : { animate: true, sparks: SPARK_COUNT };
}

export const SPARK_COUNT = 14;
/** The whole burst, from first spark to last fade. One shot, never looped. */
export const SPARK_BURST_MS = 1300;

export type SparkTone = "accent" | "strong" | "target" | "warm";

export interface SparkSpec {
  /** Radians, 0 = to the right, clockwise on screen. */
  angle: number;
  /** How far from the badge centre the spark travels, in dp. */
  distance: number;
  size: number;
  delayMs: number;
  shape: "dot" | "star";
  tone: SparkTone;
}

const SPARK_TONES: readonly SparkTone[] = ["accent", "target", "strong", "warm"];

/** Deterministic burst: the same layout every time, spread evenly round the badge. */
export function sparkSpecs(count: number = SPARK_COUNT): SparkSpec[] {
  const out: SparkSpec[] = [];
  for (let i = 0; i < count; i++) {
    const near = i % 2 === 0;
    out.push({
      angle: (i / count) * Math.PI * 2 - Math.PI / 2 + (near ? 0 : Math.PI / count),
      distance: near ? 92 : 112,
      size: i % 3 === 0 ? 16 : near ? 10 : 7,
      delayMs: (i % 4) * 60,
      shape: i % 3 === 0 ? "star" : "dot",
      tone: SPARK_TONES[i % SPARK_TONES.length],
    });
  }
  return out;
}

/**
 * Insights, reminders and the Health connect all live behind the onboarding
 * gate. Until onboarding is finished the welcome only celebrates and closes;
 * those shortcuts stay out of it (they are still in Settings afterwards).
 */
export function welcomeLinksOpen(onboardingDone: boolean): boolean {
  return onboardingDone;
}
