/**
 * Reminder write lock: withTransactionAsync is not exclusive, so overlapping
 * reminder write units must run one after another, and a throw must not wedge
 * the queue. Run: npx tsx scripts/writeLock.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

import { createWriteLock } from "../lib/writeLock";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

async function main() {
  const lock = createWriteLock();
  const log: string[] = [];
  const unit = (name: string) => async () => {
    log.push(`${name}:begin`);
    await tick();
    log.push(`${name}:end`);
    return name;
  };
  const results = await Promise.all([lock(unit("a")), lock(unit("b")), lock(unit("c"))]);
  ok("returns each result", results.join(",") === "a,b,c");
  ok(
    "units never interleave",
    log.join(" ") === "a:begin a:end b:begin b:end c:begin c:end",
    log.join(" ")
  );

  const boom = lock(async () => {
    throw new Error("boom");
  });
  const after = lock(async () => "after");
  let threw = false;
  try {
    await boom;
  } catch {
    threw = true;
  }
  ok("a throw reaches its caller", threw);
  ok("a throw does not wedge the queue", (await after) === "after");

  const src: string = fs.readFileSync(path.join(__dirname, "../lib/db/reminders.ts"), "utf8");
  const body = (name: string) => {
    const i = src.indexOf(`export async function ${name}`);
    const j = src.indexOf("\nexport ", i + 1);
    return src.slice(i, j === -1 ? undefined : j);
  };
  for (const fn of ["inReminderTransaction", "dedupeBasalReminderRows", "reorderReminders"]) {
    ok(`${fn} runs under the write lock`, body(fn).includes("reminderWriteLock("));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
