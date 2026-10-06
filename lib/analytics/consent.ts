/**
 * Usage-analytics consent, opt-in (Apple 5.1.1(ii), GDPR Art. 9). Three states
 * instead of an on/off switch, because "never asked" must stay apart from "said
 * no": neither collects anything, but only the first may still be asked once.
 *
 *   unanswered  nothing collected, nothing queued; the user was not asked yet
 *               (or walked past the question) and can still switch it on
 *   granted     the only state in which any sink collects or sends
 *   declined    the user switched it off after having it on (or opted out under
 *               the old on-by-default switch)
 *
 * Dependency-free on purpose, storage injected, so scripts/analyticsConsent.test.ts
 * runs these exact functions under plain node. lib/analytics/optOut.ts is the
 * AsyncStorage-backed instance the app uses.
 */

export type ConsentState = "granted" | "declined" | "unanswered";
/** What a user can actively choose; "unanswered" is only ever the absence of a choice. */
export type ConsentChoice = Exclude<ConsentState, "unanswered">;

export const CONSENT_KEY = "zerospike.analyticsConsent";
/** The pre-opt-in switch: "true" meant the user had turned analytics off. Read once, to migrate. */
export const LEGACY_OPT_OUT_KEY = "zerospike.analyticsOptOut";
/** Set once the question was put to the user (onboarding or the dashboard sheet), whatever the answer. */
export const CONSENT_PROMPTED_KEY = "zerospike.analyticsConsentPrompted";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ConsentChange {
  from: ConsentState;
  to: ConsentState;
}

/** `enabled` is `change.to === "granted"`; the second argument says where it came from. */
export type ConsentListener = (enabled: boolean, change: ConsentChange) => void | Promise<void>;

export function parseConsent(raw: string | null | undefined): ConsentState {
  return raw === "granted" || raw === "declined" ? raw : "unanswered";
}

/**
 * Only an explicit opt-out under the old switch survives as an answer. Absent
 * (on by default) and "false" (switched back on) were never an informed opt-in,
 * so both land on "unanswered" and are asked again.
 */
export function consentFromLegacyOptOut(raw: string | null | undefined): ConsentState {
  return raw === "true" ? "declined" : "unanswered";
}

export interface ConsentController {
  /**
   * The stored state. Never throws: when storage cannot be read the answer is
   * "unanswered" (closed) and nothing is cached or written, so the next call
   * tries again. The first successful read moves the legacy opt-out key over.
   */
  getConsent(): Promise<ConsentState>;
  /** Persists first and throws if that fails (state and sinks stay as they were). Listeners run afterwards, in the background. */
  setConsent(next: ConsentChoice): Promise<void>;
  /** Synchronous view of the last settled state: false until the first read or write has finished. */
  isGrantedNow(): boolean;
  /** Sinks register here. A change to the same state does not notify. Returns the unsubscribe. */
  onChange(listener: ConsentListener): () => void;
  /** Resolves once every listener of every change so far has returned. */
  settled(): Promise<void>;
  /** True once the question was put to the user. An unreadable flag reads true, so a flaky store never turns the ask into a loop. */
  hasPrompted(): Promise<boolean>;
  markPrompted(): Promise<void>;
}

export function createConsentController(storage: KeyValueStorage): ConsentController {
  let known: ConsentState | null = null;
  const listeners = new Set<ConsentListener>();
  // Changes are applied one after another, so a quick on, off, on leaves every
  // sink in the state the user ended on.
  let applying: Promise<void> = Promise.resolve();
  // Reads, writes and the one-time migration never interleave: a set that lands
  // while the migration is still reading would otherwise be overwritten by it.
  let chain: Promise<unknown> = Promise.resolve();

  function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = chain.then(job);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function load(): Promise<ConsentState> {
    if (known !== null) return known;
    try {
      const raw = await storage.getItem(CONSENT_KEY);
      if (raw !== null) {
        known = parseConsent(raw);
        return known;
      }
      const state = consentFromLegacyOptOut(await storage.getItem(LEGACY_OPT_OUT_KEY));
      try {
        await storage.setItem(CONSENT_KEY, state);
        await storage.removeItem(LEGACY_OPT_OUT_KEY);
      } catch {
        // The legacy key is still there, so the next read lands on the same answer.
      }
      known = state;
      return state;
    } catch {
      return "unanswered";
    }
  }

  function notify(change: ConsentChange): void {
    const enabled = change.to === "granted";
    applying = applying.then(async () => {
      for (const listener of [...listeners]) {
        try {
          await listener(enabled, change);
        } catch {
          // one sink failing must not leave the other half switched
        }
      }
    });
  }

  return {
    getConsent: () => serial(load),

    setConsent(next) {
      return serial(async () => {
        const from = await load();
        await storage.setItem(CONSENT_KEY, next);
        known = next;
        try {
          await storage.removeItem(LEGACY_OPT_OUT_KEY);
        } catch {
          // best effort: CONSENT_KEY wins over it from now on
        }
        if (from !== next) notify({ from, to: next });
      });
    },

    isGrantedNow: () => known === "granted",

    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    settled: () => applying,

    hasPrompted() {
      return serial(async () => {
        try {
          return (await storage.getItem(CONSENT_PROMPTED_KEY)) !== null;
        } catch {
          return true;
        }
      });
    },

    markPrompted() {
      return serial(() => storage.setItem(CONSENT_PROMPTED_KEY, "1"));
    },
  };
}

/**
 * The dashboard's one-time consent sheet is for an install that predates the
 * question: onboarding finished, no answer on record, never asked. `null` for
 * a value still being read keeps the sheet away until everything is known.
 */
export function shouldShowConsentSheet(input: {
  ready: boolean;
  onboarded: boolean;
  state: ConsentState | null;
  prompted: boolean | null;
  screenshotMode: boolean;
}): boolean {
  return (
    input.ready &&
    input.onboarded &&
    input.state === "unanswered" &&
    input.prompted === false &&
    !input.screenshotMode
  );
}
