/**
 * The on-device outbox behind the Supabase sink: the analytics_queue table
 * (schema v24, lib/db/v24Sql.ts). The database handle is passed in as a narrow
 * interface so scripts/analyticsSchema.test.ts can run these exact statements
 * against node:sqlite.
 */

import type { PropValue } from "./eventSchema";
import type { FlushStore, QueuedEvent } from "./flush";

/** Past this many rows the oldest events are deleted to make room. */
export const QUEUE_MAX_ROWS = 5000;

type Bind = string | number | null;

export interface QueueDb {
  runAsync(sql: string, params?: Bind[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params?: Bind[]): Promise<T[]>;
}

export interface NewQueueEvent {
  name: string;
  props: Record<string, PropValue>;
  ts: string;
  sessionId: string;
  isPro: boolean;
}

export interface EventQueue extends FlushStore {
  insert(events: readonly NewQueueEvent[]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

const INSERT_SQL =
  "INSERT INTO analytics_queue (name, props, ts, session_id, is_pro) VALUES (?, ?, ?, ?, ?);";
// The 5001st newest id is the cutoff: it and everything older goes. With fewer
// rows the subquery is empty, `id <= NULL` is never true, and nothing is deleted.
const TRIM_SQL =
  "DELETE FROM analytics_queue WHERE id <= (SELECT id FROM analytics_queue ORDER BY id DESC LIMIT 1 OFFSET ?);";
const PEEK_SQL =
  "SELECT id, name, props, ts, session_id, is_pro, batch_id FROM analytics_queue ORDER BY id ASC LIMIT ?;";
const COUNT_SQL = "SELECT COUNT(*) AS c FROM analytics_queue;";

interface QueueRowRecord {
  id: number;
  name: string;
  props: string;
  ts: string;
  session_id: string;
  is_pro: number;
  batch_id: string | null;
}

function parseProps(raw: string): Record<string, PropValue> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, PropValue>;
    }
  } catch {
    // a row nobody can read still has to leave the queue
  }
  return {};
}

function inList(ids: readonly number[]): string {
  return ids.map(() => "?").join(",");
}

export function createQueue(db: QueueDb): EventQueue {
  return {
    async insert(events) {
      if (events.length === 0) return;
      for (const event of events) {
        await db.runAsync(INSERT_SQL, [
          event.name,
          JSON.stringify(event.props),
          event.ts,
          event.sessionId,
          event.isPro ? 1 : 0,
        ]);
      }
      await db.runAsync(TRIM_SQL, [QUEUE_MAX_ROWS]);
    },

    async peek(limit) {
      const rows = await db.getAllAsync<QueueRowRecord>(PEEK_SQL, [limit]);
      return rows.map(
        (row): QueuedEvent => ({
          id: row.id,
          name: row.name,
          props: parseProps(row.props),
          ts: row.ts,
          sessionId: row.session_id,
          isPro: row.is_pro === 1,
          batchId: row.batch_id,
        })
      );
    },

    async tag(ids, batchId) {
      if (ids.length === 0) return;
      await db.runAsync(
        `UPDATE analytics_queue SET batch_id = ? WHERE id IN (${inList(ids)});`,
        [batchId, ...ids]
      );
    },

    async remove(ids) {
      if (ids.length === 0) return;
      await db.runAsync(`DELETE FROM analytics_queue WHERE id IN (${inList(ids)});`, [...ids]);
    },

    async clear() {
      await db.runAsync("DELETE FROM analytics_queue;");
    },

    async count() {
      const rows = await db.getAllAsync<{ c: number }>(COUNT_SQL);
      return rows[0]?.c ?? 0;
    },
  };
}
