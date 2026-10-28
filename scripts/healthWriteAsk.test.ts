/**
 * G253-FLASH: the one-time Health write question is marked asked only after an
 * answer. A dialog torn down unanswered (host unmounted) is not an answer.
 *
 * Run: npx sucrase-node scripts/healthWriteAsk.test.ts
 */
import { readFileSync } from "fs";
import { runHealthWriteAsk } from "../lib/healthWriteAsk";

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}

async function main(): Promise<void> {
  for (const [answer, outcome] of [
    [true, "yes"],
    [false, "later"],
  ] as const) {
    const log: string[] = [];
    const out = await runHealthWriteAsk({
      show: async () => {
        log.push("shown");
        return answer;
      },
      markAsked: async () => void log.push("marked"),
    });
    ok(`${outcome}: outcome`, out === outcome);
    ok(`${outcome}: marked after the dialog`, log.join(",") === "shown,marked");
  }
  {
    let marked = 0;
    const out = await runHealthWriteAsk({
      show: async (onAbandon) => {
        onAbandon();
        return false;
      },
      markAsked: async () => void marked++,
    });
    ok("abandoned: outcome", out === "abandoned");
    ok("abandoned: question not spent", marked === 0);
  }
  {
    let marked = false;
    let release: (v: boolean) => void = () => undefined;
    const p = runHealthWriteAsk({
      show: () => new Promise<boolean>((r) => (release = r)),
      markAsked: async () => void (marked = true),
    });
    await Promise.resolve();
    ok("not marked while the dialog is open", !marked);
    release(false);
    await p;
    ok("marked once answered", marked);
  }
  {
    const src = readFileSync("app/(tabs)/index.tsx", "utf8");
    const ask = src.indexOf("async function maybeAskHealthWrite");
    const body = src.slice(ask, src.indexOf("async function maybeOfferLowFollowup"));
    ok("no mark before the dialog", !/await markHealthWriteAskSeen\(\);/.test(body));
    ok("goes through runHealthWriteAsk", body.includes("runHealthWriteAsk("));
    const fb = readFileSync("components/Feedback.tsx", "utf8");
    ok("Feedback reports abandonment", fb.includes("abandonCb.current?.()") && fb.includes("cb?.()"));
  }
  if (failed) {
    console.log(`${failed} FAIL`);
    process.exit(1);
  }
  console.log("healthWriteAsk: ok");
}

void main();
