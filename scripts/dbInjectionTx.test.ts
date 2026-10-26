/**
 * Opus-4 FIX-D madde 1, 2, 7 against the REAL lib/db/injections.ts and
 * lib/db/meals.ts on node:sqlite (expo-sqlite faked by a thin adapter).
 *   1. getCalculatorInjectionForMeal never returns a row turned into basal
 *   2. inDbTransaction takes the write lock up front (BEGIN IMMEDIATE), so a
 *      concurrent writer on another connection is waited out, not an instant
 *      "database is locked"
 *   7. health mirror events of writes inside a transaction fire after COMMIT
 *      only, and never on ROLLBACK
 * Run: npx tsx scripts/dbInjectionTx.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { randomBytes } from "node:crypto";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "zs-tx-"));
const dbPath = join(dir, "t.db");

function open(): DatabaseSync {
  const d = new DatabaseSync(dbPath);
  d.exec("PRAGMA busy_timeout = 5000;");
  return d;
}

function adapter(d: DatabaseSync) {
  const bind = (p?: unknown[]) => (p ?? []) as any[];
  return {
    execAsync: async (sql: string) => {
      d.exec(sql);
    },
    runAsync: async (sql: string, p?: unknown[]) => {
      const r = d.prepare(sql).run(...bind(p));
      return { changes: Number(r.changes) };
    },
    getFirstAsync: async (sql: string, p?: unknown[]) =>
      (d.prepare(sql).get(...bind(p)) as any) ?? null,
    getAllAsync: async (sql: string, p?: unknown[]) => d.prepare(sql).all(...bind(p)) as any[],
    isInTransactionSync: () => d.isTransaction,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      d.exec("BEGIN");
      try {
        await fn();
        d.exec("COMMIT");
      } catch (e) {
        if (d.isTransaction) d.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const main = open();
main.exec("PRAGMA journal_mode = WAL;");
main.exec(`
  CREATE TABLE injection_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, site TEXT, site_point INTEGER,
    dose_units REAL, insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
    meal_log_id TEXT, note TEXT, source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]', bolus_kind TEXT, insulin_product_id TEXT,
    insulin_product_other TEXT, health_uuid TEXT
  );
  CREATE TABLE meal_logs (id TEXT PRIMARY KEY, insulin_dose_units REAL);
  CREATE TABLE sugar_logs (id INTEGER PRIMARY KEY, v REAL);
  INSERT INTO meal_logs VALUES ('M', 4);
`);
const db = adapter(main);

const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "./index" || request.endsWith("/db/index")) return { getDb: async () => db };
  if (request === "expo-crypto") return { getRandomBytes: (n: number) => randomBytes(n) };
  return realLoad.call(this, request, ...rest);
};

async function run() {
  const inj = await import("../lib/db/injections");
  const meals = await import("../lib/db/meals");
  const hooks = await import("../lib/db/healthRecordHooks");

  // 1. same-timestamp basal B1 and bolus B2 for one meal
  const AT = "2026-10-27T12:00:00.000Z";
  const base = { profile_id: "P", meal_log_id: "M", source: "calculator" as const, logged_at: AT };
  const b1 = await inj.logInjection({ ...base, dose_units: 4, insulin_type: "bolus" });
  await inj.updateInjection(b1.id, { insulin_type: "basal" });
  const b2 = await inj.logInjection({ ...base, dose_units: 5, insulin_type: "bolus" });
  const got = await inj.getCalculatorInjectionForMeal("M");
  ok("1: own bolus B2 is found, not the basal-converted B1", got?.id === b2.id, `got ${got?.id} (B1 ${b1.id}, B2 ${b2.id})`);
  await inj.updateInjection(b2.id, { insulin_type: "basal" });
  ok("1: no bolus left -> null", (await inj.getCalculatorInjectionForMeal("M")) === null);
  main.exec("DELETE FROM injection_logs;");

  // 7. events fire after COMMIT only
  const seen: { id: string; inTx: boolean }[] = [];
  hooks.setHealthRecordHooks({
    injectionSaved: (i) => seen.push({ id: i.id, inTx: main.isTransaction }),
    removed: (_k, recs) => recs.forEach((r) => seen.push({ id: r.id, inTx: main.isTransaction })),
  });
  let inside = -1;
  await meals.inDbTransaction(async () => {
    const a = await inj.logInjection({ ...base, dose_units: 1, insulin_type: "bolus" });
    await inj.updateInjection(a.id, { dose_units: 2 });
    inside = seen.length;
  });
  ok("7: nothing emitted while the transaction is open", inside === 0, `emitted ${inside}`);
  ok("7: both events emitted after commit", seen.length === 2, `emitted ${seen.length}`);
  ok("7: events fire outside the transaction", seen.every((s) => !s.inTx));

  seen.length = 0;
  let threw = false;
  try {
    await meals.inDbTransaction(async () => {
      await inj.logInjection({ ...base, dose_units: 9, insulin_type: "bolus" });
      throw new Error("boom");
    });
  } catch {
    threw = true;
  }
  ok("7: rollback rethrows", threw);
  ok("7: rolled-back write emits nothing", seen.length === 0, `emitted ${seen.length}`);
  ok("7: rolled-back row is gone", (main.prepare("SELECT COUNT(*) c FROM injection_logs WHERE dose_units = 9").get() as any).c === 0);
  ok("7: connection is out of the transaction after rollback", !main.isTransaction);

  seen.length = 0;
  await inj.logInjection({ ...base, dose_units: 3, insulin_type: "bolus" });
  ok("7: a plain write outside a transaction emits immediately", seen.length === 1);

  // 2. a second connection writes while we run the read-then-write unit
  const worker = new Worker(
    `
    const { workerData, parentPort } = require("node:worker_threads");
    const { DatabaseSync } = require("node:sqlite");
    const d = new DatabaseSync(workerData.path);
    d.exec("PRAGMA busy_timeout = 5000;");
    d.exec("BEGIN");
    d.exec("INSERT INTO sugar_logs(v) VALUES (1)");
    parentPort.postMessage("holding");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    d.exec("COMMIT");
    parentPort.postMessage("done");
  `,
    { eval: true, workerData: { path: dbPath } }
  );
  await new Promise<void>((res) => worker.once("message", () => res()));
  const t0 = Date.now();
  let err = "";
  try {
    await meals.inDbTransaction(async () => {
      await db.getAllAsync("SELECT * FROM meal_logs");
      await db.runAsync("UPDATE meal_logs SET insulin_dose_units = 5 WHERE id = 'M'");
    });
  } catch (e) {
    err = String((e as Error).message);
  }
  ok("2: unit succeeds although another connection was writing", err === "", err);
  ok("2: it waited for the other writer", err === "" && Date.now() - t0 >= 150, `${Date.now() - t0}ms`);
  ok("2: edit landed", (main.prepare("SELECT insulin_dose_units d FROM meal_logs WHERE id='M'").get() as any).d === 5);
  await new Promise<void>((res) => worker.once("message", () => res()));
  await worker.terminate();

  // 2b. overlapping units on one connection run one after another
  const order: string[] = [];
  const unit = (n: string) => async () => {
    order.push(n + ":b");
    await new Promise((r) => setTimeout(r, 5));
    order.push(n + ":e");
  };
  await Promise.all([meals.inDbTransaction(unit("a")), meals.inDbTransaction(unit("b"))]);
  ok("2: overlapping units are serialized", order.join(" ") === "a:b a:e b:b b:e", order.join(" "));

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
void run();
