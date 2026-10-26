/**
 * Dashboard / journal glucose sheet (G4, G5): the write happens BEFORE the
 * sheet closes, a failed write keeps the sheet and its value open, and a
 * "new reading" open never inherits a stale edit target.
 *
 * Run: npx sucrase-node scripts/glucoseSheetSave.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  attemptGlucoseWrite,
  openNewReadingState,
  runSheetSubmit,
  settleSheetSubmit,
  type GlucoseSheetState,
} from "../lib/glucoseSheetFlow";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}

async function main(): Promise<void> {
  {
    const log: string[] = [];
    const res = await runSheetSubmit({
      submit: async () => {
        log.push("write:start");
        await Promise.resolve();
        log.push("write:end");
      },
      animateOut: (done) => {
        log.push("animateOut");
        done();
      },
      onClose: () => log.push("close"),
      onFailed: () => log.push("failed"),
    });
    ok("G4 success returns true", res === true);
    ok(
      "G4 write finishes before the sheet animates out and closes",
      log.join(",") === "write:start,write:end,animateOut,close"
    );
  }

  {
    const log: string[] = [];
    const res = await runSheetSubmit({
      submit: async () => {
        log.push("write");
        throw new Error("db locked");
      },
      animateOut: () => log.push("animateOut"),
      onClose: () => log.push("close"),
      onFailed: () => log.push("failed"),
    });
    ok("G4 failure returns false", res === false);
    ok("G4 failure never closes the sheet", !log.includes("animateOut") && !log.includes("close"));
    ok("G4 failure re-arms the sheet for a retry", log.includes("failed"));
  }

  {
    const log: string[] = [];
    const res = await runSheetSubmit({
      submit: async () => false,
      animateOut: () => log.push("animateOut"),
      onClose: () => log.push("close"),
      onFailed: () => log.push("failed"),
    });
    ok("G4 submit()=false keeps the sheet open", res === false && log.join(",") === "failed");
  }
  ok("G4 settle: void result counts as success", (await settleSheetSubmit(() => undefined)) === true);
  ok("G4 settle: false result is a failure", (await settleSheetSubmit(async () => false)) === false);

  {
    const errs: unknown[] = [];
    let threw = false;
    let bad: { ok: boolean } = { ok: true };
    try {
      bad = await attemptGlucoseWrite(
        async () => {
          throw new Error("boom");
        },
        (e) => errs.push(e)
      );
    } catch {
      threw = true;
    }
    ok("G5 failed write does not throw", !threw);
    ok("G5 failed write resolves ok:false", bad.ok === false);
    ok("G5 failed write reports the error once", errs.length === 1);
    const good = await attemptGlucoseWrite(async () => 42, (e) => errs.push(e));
    ok("G5 good write resolves ok:true with its value", good.ok === true && good.value === 42);
    ok("G5 good write does not report", errs.length === 1);
  }

  {
    const stale: GlucoseSheetState<{ id: string }> = {
      open: false,
      edit: { id: "old-reading" },
      initialPeriod: "fasting",
    };
    const next = openNewReadingState(stale, "post_meal_2h");
    ok("G5 new-reading open clears a leftover edit target", next.edit === null);
    ok(
      "G5 new-reading open is open with the requested period",
      next.open && next.initialPeriod === "post_meal_2h"
    );
  }

  if (failed > 0) {
    console.log(`glucoseSheetSave: ${failed} FAIL`);
    process.exit(1);
  }
  console.log("glucoseSheetSave: all passed");
}

void main();
