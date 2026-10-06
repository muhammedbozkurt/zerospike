import AsyncStorage from "@react-native-async-storage/async-storage";
import { logCrash, logEvent } from "../analytics";
import {
  applyStepStatus,
  parseProWelcomeState,
  serializeProWelcomeState,
  type ProWelcomeState,
  type ProWelcomeStatus,
  type ProWelcomeStep,
} from "../proWelcome";

const PRO_WELCOME_KEY = "zerospike.proWelcome";

export async function getProWelcomeState(): Promise<ProWelcomeState> {
  try {
    return parseProWelcomeState(await AsyncStorage.getItem(PRO_WELCOME_KEY));
  } catch (err) {
    logCrash(err, { service: "proWelcome", op: "read" });
    return {};
  }
}

// The dashboard (Health connected) and the welcome screen both write; a chain
// keeps the two read-modify-write cycles from overwriting each other.
let writeChain: Promise<unknown> = Promise.resolve();

type StepListener = (step: ProWelcomeStep, status: ProWelcomeStatus) => void;
const stepListeners = new Set<StepListener>();

/**
 * Persists one checklist step and reports it once. A repeat (or a "not now" on
 * an already finished step) changes nothing and logs nothing. Only a real
 * transition reaches the listeners (see waitForProWelcomeStep).
 */
export function markProWelcomeStep(
  step: ProWelcomeStep,
  status: ProWelcomeStatus
): Promise<void> {
  const run = writeChain.then(async () => {
    const before = await getProWelcomeState();
    const after = applyStepStatus(before, step, status);
    if (after === before) return;
    try {
      await AsyncStorage.setItem(PRO_WELCOME_KEY, serializeProWelcomeState(after));
    } catch (err) {
      logCrash(err, { service: "proWelcome", op: "write", step });
      return;
    }
    logEvent("pro_welcome_step", { step, done: status === "done" });
    for (const listener of [...stepListeners]) {
      try {
        listener(step, status);
      } catch (err) {
        logCrash(err, { service: "proWelcome", op: "listener", step });
      }
    }
  });
  writeChain = run.catch((err) => logCrash(err, { service: "proWelcome", op: "chain" }));
  return run;
}

/**
 * Resolves true when `step` is recorded as done (by whichever screen finishes
 * it) within `timeoutMs`, false when the time runs out first. The welcome hands
 * the Health connect to the dashboard and leaves, so this outlives the screen
 * that asked: it holds no component state, only a listener and a timer, and both
 * are gone as soon as it settles.
 */
export function waitForProWelcomeStep(
  step: ProWelcomeStep,
  timeoutMs: number
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const settle = (done: boolean) => {
      clearTimeout(timer);
      stepListeners.delete(listener);
      resolve(done);
    };
    const listener: StepListener = (s, status) => {
      if (s === step && status === "done") settle(true);
    };
    const timer = setTimeout(() => settle(false), timeoutMs);
    stepListeners.add(listener);
  });
}
