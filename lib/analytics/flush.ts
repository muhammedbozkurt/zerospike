/**
 * Batching and retry policy for the Supabase sink's queue, with the store and
 * the network injected so scripts/analyticsSchema.test.ts can drive it under
 * plain node. See ./supabaseSink for what triggers a flush.
 */

import type { PropValue } from "./eventSchema";

export const FLUSH_BATCH_SIZE = 50;
export const FLUSH_INTERVAL_MS = 30_000;
/** One flush call sends at most this many batches; the next trigger carries on. */
export const MAX_BATCHES_PER_FLUSH = 10;
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;
/** A 429's Retry-After is honoured as sent, but never beyond this. */
export const RETRY_AFTER_MAX_MS = 6 * 60 * 60_000;

export interface QueuedEvent {
  id: number;
  name: string;
  props: Record<string, PropValue>;
  ts: string;
  sessionId: string;
  isPro: boolean;
  /** Null until a send of this row was first attempted (see nextBatch). */
  batchId: string | null;
}

/** ok and drop both delete the batch; retry keeps it and waits. */
export type SendResult =
  | { status: "ok" }
  | { status: "drop" }
  | { status: "retry"; retryAfterMs?: number };

export interface FlushStore {
  peek(limit: number): Promise<QueuedEvent[]>;
  /** Stamps rows with the id their request carries, so a retry reuses it. */
  tag(ids: number[], batchId: string): Promise<void>;
  remove(ids: number[]): Promise<void>;
}

/** 1, 2, 4, 8, 16 minutes, then capped at 30 for the n-th failure in a row. */
export function backoffDelayMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/** Seconds or an HTTP date, as a wait in ms (0 to RETRY_AFTER_MAX_MS), or undefined when unreadable. */
export function parseRetryAfter(header: string | null, now: number): number | undefined {
  const text = header?.trim() ?? "";
  if (text === "") return undefined;
  let ms: number;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else if (/[a-z]/i.test(text)) {
    // An HTTP date always has day and month names; Date.parse alone would read
    // a stray "-5" as a year.
    const at = Date.parse(text);
    if (!Number.isFinite(at)) return undefined;
    ms = at - now;
  } else {
    return undefined;
  }
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, ms));
}

/**
 * What a track response means for the batch that was sent:
 * - `duplicate: true` in the body (any status): the server already stored this
 *   batch id, so the batch is done.
 * - 2xx (202 with some events dropped included): done.
 * - 429: the hourly request cap; wait as long as Retry-After says.
 * - 400, 413, 422: this exact body will never be accepted, and keeping it would
 *   block every event queued behind it, so it is dropped.
 * - anything else (503 storage, 5xx, a missing or misconfigured function): retry
 *   with the backoff.
 */
export function classifyResponse(
  status: number,
  retryAfter: string | null,
  body: unknown,
  now: number
): SendResult {
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { duplicate?: unknown }).duplicate === true
  ) {
    return { status: "ok" };
  }
  if (status >= 200 && status < 300) return { status: "ok" };
  if (status === 429) {
    return { status: "retry", retryAfterMs: parseRetryAfter(retryAfter, now) };
  }
  if (status === 400 || status === 413 || status === 422) return { status: "drop" };
  return { status: "retry" };
}

/**
 * The rows the next request carries. Rows already stamped with a batch id come
 * back as exactly that batch, whatever was queued after them: the server stores
 * a batch id once, so a retry that grew would lose its extra events as a
 * "duplicate". Untagged rows form a new batch: the leading run that shares the
 * first row's session and Pro state, since one request carries one session_id
 * and one is_pro.
 */
export function nextBatch(rows: readonly QueuedEvent[]): QueuedEvent[] {
  if (rows.length === 0) return [];
  const first = rows[0];
  const belongs = (row: QueuedEvent): boolean =>
    first.batchId !== null
      ? row.batchId === first.batchId
      : row.batchId === null &&
        row.sessionId === first.sessionId &&
        row.isPro === first.isPro;
  let end = 1;
  while (end < rows.length && belongs(rows[end])) end++;
  return rows.slice(0, end);
}

export interface Flusher {
  flush(): Promise<void>;
  /** Forgets the backoff, for a fresh start such as the user turning analytics back on. */
  reset(): void;
  /** Earliest time a flush may hit the network again (0 when not waiting). */
  retryAt(): number;
}

export function createFlusher(deps: {
  store: FlushStore;
  send(batch: QueuedEvent[], batchId: string): Promise<SendResult>;
  newBatchId(): string;
  now(): number;
  /** False while opted out or before the app is ready. */
  canSend(): boolean;
}): Flusher {
  let failures = 0;
  let notBefore = 0;
  let running: Promise<void> | null = null;

  function fail(retryAfterMs?: number): void {
    if (retryAfterMs !== undefined) {
      notBefore = deps.now() + retryAfterMs;
      return;
    }
    failures += 1;
    notBefore = deps.now() + backoffDelayMs(failures);
  }

  async function run(): Promise<void> {
    try {
      for (let sent = 0; sent < MAX_BATCHES_PER_FLUSH; sent++) {
        if (!deps.canSend()) return;
        const rows = await deps.store.peek(FLUSH_BATCH_SIZE);
        // Opting out can land while peek() is pending.
        if (rows.length === 0 || !deps.canSend()) return;
        const batch = nextBatch(rows);
        const ids = batch.map((row) => row.id);
        let batchId = batch[0].batchId;
        if (batchId === null) {
          batchId = deps.newBatchId();
          await deps.store.tag(ids, batchId);
        }
        if (!deps.canSend()) return;
        const result = await deps.send(batch, batchId);
        if (result.status === "retry") {
          fail(result.retryAfterMs);
          return;
        }
        await deps.store.remove(ids);
        failures = 0;
        notBefore = 0;
      }
    } catch {
      fail();
    }
  }

  return {
    flush() {
      if (running) return running;
      if (deps.now() < notBefore) return Promise.resolve();
      running = run().finally(() => {
        running = null;
      });
      return running;
    },
    reset() {
      failures = 0;
      notBefore = 0;
    },
    retryAt: () => notBefore,
  };
}
