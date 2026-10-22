import { AppState, type AppStateStatus } from "react-native";

import { getDb } from "../db/index";
import { uuid } from "../uuid";
import { setAnalyticsSink, type AnalyticsParams } from "./index";
import { sanitizeEvent } from "./eventSchema";
import { FLUSH_INTERVAL_MS, createFlusher } from "./flush";
import { getAnalyticsConsent, isAnalyticsEnabledNow, onAnalyticsEnabledChange } from "./optOut";
import { createQueue, orderByClientTs, type NewQueueEvent, type QueueDb } from "./queue";
import { createSessionTracker } from "./session";
import { isTestEnvironmentNow } from "./testEnvironment";
import { isTrackConfigured, postBatch } from "./transport";

/**
 * Supabase analytics sink. Every schema v1 event (./eventSchema) goes into a
 * SQLite outbox (./queue) and is posted in batches to the `track` edge function
 * (./transport) when the app returns to the foreground, goes to the background,
 * and every 30 s while it is open. Failures back off (./flush); the outbox
 * survives a kill. The sink produces app_open itself, and analytics_opt_out
 * (enabled: true) when the user switches usage analytics on.
 *
 * Off in dev builds (set EXPO_PUBLIC_ANALYTICS_DEV=1 to
 * try it against the real function), in screenshot mode, on emulators and
 * simulators and on Firebase Test Lab / Play pre-launch devices (see
 * ./testEnvironment), and off when extra.trackFnUrl is unset. Consent is not
 * touched: only the collection stays silent there.
 *
 * Opt-in (./optOut): the sink collects and sends only while the stored consent
 * is "granted". Never asked, declined and an unreadable store all mean off:
 * nothing is written to the outbox (events logged while the answer is still
 * being read wait in memory and are dropped if it is not "granted"), and an
 * outbox left over from the old on-by-default switch is emptied at start.
 * Switching it off later stops the sink and empties the outbox, and nothing
 * more goes to the server, not even a note that it was switched off.
 */

const SINK_SLOT = "supabase";
/** Events logged before AppContext is ready wait in memory; this caps them. */
const PRE_READY_LIMIT = 100;

type PendingEvent = Omit<NewQueueEvent, "isPro">;

interface SinkController {
  setIsPro(value: boolean): void;
  /** Forgets everything not yet sent: the outbox and the events waiting in memory. */
  clearQueue(): Promise<void>;
  /** Stops the uploads and resolves once no request is in flight; the result lets them go on. */
  pauseSending(): Promise<() => void>;
}

let controller: SinkController | null = null;

// The shared app database, resolved per call: the sink starts at module load,
// before initDatabase() has opened anything.
const db: QueueDb = {
  async runAsync(sql, params) {
    return (await getDb()).runAsync(sql, params ?? []);
  },
  async getAllAsync<T>(sql: string, params?: (string | number | null)[]) {
    return (await getDb()).getAllAsync<T>(sql, params ?? []);
  },
};

function startSink(): SinkController {
  const session = createSessionTracker(uuid);
  const queue = createQueue(db);
  const preReady: PendingEvent[] = [];
  // Events logged while the gate was shut; an opt-in made before the sink is
  // ready must not carry them to the server.
  const beforeConsent = new WeakSet<PendingEvent>();
  let ready = false;
  let activating = false;
  let isPro = false;
  let appActive = false;
  let coldOpenPending = true;
  // Held while "Delete my server records" runs, so no batch starts behind it.
  let paused = false;
  let ticker: ReturnType<typeof setInterval> | null = null;
  // Inserts run strictly in call order, and a failed one never blocks the next.
  let writes: Promise<void> = Promise.resolve();

  // Reading the stored answer also fills the synchronous gate below. The gate is
  // shared with the consent switch itself, so it is already shut the moment the
  // user says no, not when this sink gets round to hearing about it.
  let consentSettled = false;
  const consentLoaded = getAnalyticsConsent().then(() => {
    consentSettled = true;
    // Whatever was logged while the answer was still being read is only kept
    // when the stored answer is "granted": a later opt-in covers what happens
    // after it, never what came before.
    if (!isEnabled()) preReady.length = 0;
  });
  const isEnabled = (): boolean => isAnalyticsEnabledNow();

  const flusher = createFlusher({
    store: queue,
    send: (batch, batchId) => postBatch(batch, batchId),
    newBatchId: uuid,
    now: Date.now,
    canSend: () => ready && isEnabled() && !paused,
  });

  function persist(rows: NewQueueEvent[]): void {
    writes = writes.then(() => queue.insert(rows)).catch(() => {});
  }

  function flushAfterWrites(): void {
    void writes.then(() => flusher.flush());
  }

  async function clearQueue(): Promise<void> {
    await writes;
    await queue.clear().catch(() => {});
  }

  // With `paused` set the flusher starts no new batch, so flush() only joins the
  // one that is already on its way (and returns at once when there is none).
  async function pauseSending(): Promise<() => void> {
    paused = true;
    await flusher.flush();
    return () => {
      paused = false;
    };
  }

  function record(name: string, params?: AnalyticsParams): void {
    const result = sanitizeEvent(name, params);
    if (!result.ok) return;
    const event: PendingEvent = {
      name,
      props: result.props,
      ts: new Date().toISOString(),
      sessionId: session.id(),
    };
    if (!ready) {
      // Once the answer is known to be no there is nothing worth keeping, not
      // even in memory until the app is ready.
      if (consentSettled && !isEnabled()) return;
      if (!isEnabled()) beforeConsent.add(event);
      preReady.push(event);
      if (preReady.length > PRE_READY_LIMIT) preReady.shift();
      return;
    }
    if (isEnabled()) persist([{ ...event, isPro }]);
  }

  function startTicker(): void {
    if (ticker || !appActive || !ready || !isEnabled()) return;
    ticker = setInterval(() => void flusher.flush(), FLUSH_INTERVAL_MS);
  }

  function stopTicker(): void {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = null;
  }

  function handleActive(): void {
    appActive = true;
    const { warmOpen } = session.onForeground(Date.now());
    if (coldOpenPending) {
      coldOpenPending = false;
      record("app_open", { cold: true });
    } else if (warmOpen) {
      record("app_open", { cold: false });
    }
    startTicker();
    flushAfterWrites();
  }

  function handleBackground(): void {
    appActive = false;
    session.onBackground(Date.now());
    stopTicker();
    flushAfterWrites();
  }

  function onAppState(state: AppStateStatus): void {
    if (state === "active") handleActive();
    else if (state === "background") handleBackground();
  }

  // The first is_pro from AppContext also means the database is open and the
  // cached entitlement is known: only now can events be stamped and stored.
  async function activate(): Promise<void> {
    if (ready || activating) return;
    activating = true;
    await consentLoaded;
    ready = true;
    activating = false;
    if (!isEnabled()) {
      // Not opted in (never asked, declined, or opted out under the old
      // on-by-default switch): nothing waiting may be kept, and whatever an
      // earlier session left in the outbox goes.
      preReady.length = 0;
      await clearQueue();
      return;
    }
    persist(orderByClientTs(preReady.splice(0)).map((event) => ({ ...event, isPro })));
    startTicker();
    flushAfterWrites();
  }

  async function handleConsent(next: boolean): Promise<void> {
    await consentLoaded;
    if (!next) {
      // The gate is already shut, so nothing new is taken, and nothing is sent
      // about it either: once the answer is no, this sink says nothing more.
      // Forget the rest. Switched back on while the outbox was being emptied:
      // what was logged since is covered by the new consent and stays.
      preReady.length = 0;
      stopTicker();
      if (ready && !isEnabled()) await clearQueue();
      return;
    }
    flusher.reset();
    if (!ready) {
      for (let i = preReady.length - 1; i >= 0; i--) {
        if (beforeConsent.has(preReady[i])) preReady.splice(i, 1);
      }
    }
    // Before the sink is ready this waits with the other early events and is
    // written, in clock order, when activate() runs.
    record("analytics_opt_out", { enabled: true });
    if (!ready) return;
    startTicker();
    flushAfterWrites();
  }

  setAnalyticsSink(record, SINK_SLOT);
  onAnalyticsEnabledChange(handleConsent);
  AppState.addEventListener("change", onAppState);
  if (AppState.currentState === "active") handleActive();

  return {
    setIsPro(value) {
      isPro = value;
      void activate();
    },
    async clearQueue() {
      preReady.length = 0;
      await clearQueue();
    },
    pauseSending,
  };
}

/** Called once from app/_layout.tsx at module load. */
export function initSupabaseSink(): void {
  if (controller || !isTrackConfigured || isTestEnvironmentNow()) return;
  controller = startSink();
}

/**
 * Hands the sink the entitlement. RootNavigator calls it only once AppContext is
 * ready and again on every change; events are stamped with the value current
 * when they were logged. No-op while the sink is off.
 */
export function setAnalyticsIsPro(isPro: boolean): void {
  controller?.setIsPro(isPro);
}

/**
 * Empties the on-device outbox (and what still waits in memory): the "Delete my
 * server records" button runs it around the server call so nothing logged
 * before the deletion is uploaded after it. Works without a running sink (dev,
 * screenshot mode, no track URL) and never throws.
 */
export async function clearAnalyticsQueue(): Promise<void> {
  try {
    if (controller) await controller.clearQueue();
    else await createQueue(db).clear();
  } catch {
    // an outbox that cannot be cleared is not worth failing the caller for
  }
}

/**
 * Stops the uploads and resolves once the request already on its way (at most
 * one) has come back; the function it returns lets them go on. The delete button
 * runs it around the server call, so that nothing in flight can reach the server
 * after the deletion. A no-op without a running sink, and never throws.
 */
export async function pauseAnalyticsSending(): Promise<() => void> {
  try {
    if (controller) return await controller.pauseSending();
  } catch {
    // an uploader that cannot be paused is not worth failing the caller for
  }
  return () => {};
}
