/**
 * Pins the intended behaviour when the native glucose read throws: the import
 * reports "error" (last sync error read_failed) and, on Android, the change
 * token is NOT committed, so the next pass reads the same samples again.
 * Run: npx tsx scripts/healthReadFailure.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import { eq, fake, finish, kv, resetAll } from "./healthTestHarness";

async function main(): Promise<void> {
  const S = await import("../lib/services/health");
  console.log("zerospike health read failure test");

  resetAll("ios");
  fake.readThrows = true;
  const r = await S.importHealthGlucose("P", "background");
  eq("read throws -> status error", r.status, "error");
  eq("last sync error is read_failed", (await S.getHealthLastSync())?.error, "read_failed");

  resetAll("android");
  kv.set("zerospike.cgmSync.P", "true");
  await S.setHealthBackgroundEntitled(true);
  fake.readThrows = true;
  const o = await S.syncHealthInBackground();
  eq("background outcome is error", o.result?.status, "error");
  eq("change token is not committed after a failed read", fake.commits, 0);
  fake.readThrows = false;
  fake.glucose = [{ value: 120, date: new Date().toISOString(), period_tag: "fasting" }];
  const ok = await S.syncHealthInBackground();
  eq("next successful pass is ok", ok.result?.status, "ok");
  eq("token commits only after the successful pass", fake.commits, 1);
  eq("last sync error cleared", (await S.getHealthLastSync())?.error, null);

  resetAll("ios");
  fake.glucose = [];
  const empty = await S.importHealthGlucose("P", "background");
  eq("empty successful read stays ok", empty.status, "ok");
  finish();
}

main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
