/**
 * G253-FLASH: a dialog raised right after a glucose save must wait for the
 * entry sheet to be gone, else the sheet's FeedbackHost unmount abandons it and
 * it flashes (the one-time Health write question was spent that way).
 *
 * Run: npx sucrase-node scripts/sheetCloseGate.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "fs";
import { createSheetCloseGate } from "../lib/sheetCloseGate";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await Promise.resolve();
      }
      now = end;
      await Promise.resolve();
    },
  };
}

async function main(): Promise<void> {
  {
    const c = fakeClock();
    const g = createSheetCloseGate({ ...c, settleMs: 400, maxWaitMs: 4000 });
    ok("never opened: clear at once", await g.whenClear());
  }
  {
    // The save path: sheet open, side work asks right away, sheet closes after the slide-out.
    const c = fakeClock();
    const g = createSheetCloseGate({ ...c, settleMs: 400, maxWaitMs: 4000 });
    g.markOpen();
    let result: boolean | null = null;
    void g.whenClear().then((v) => (result = v));
    await c.advance(190);
    ok("still waiting while the sheet is up", result === null);
    g.markClosed();
    await c.advance(399);
    ok("still waiting during the settle", result === null);
    await c.advance(2);
    ok("released true after close + settle", result === true);
    ok("later asks are clear at once", await g.whenClear());
  }
  {
    const c = fakeClock();
    const g = createSheetCloseGate({ ...c, settleMs: 400, maxWaitMs: 4000 });
    g.markOpen();
    let result: boolean | null = null;
    void g.whenClear().then((v) => (result = v));
    await c.advance(4001);
    ok("sheet never closes: gives up false", result === false);
  }
  {
    const c = fakeClock();
    const g = createSheetCloseGate({ ...c, settleMs: 400, maxWaitMs: 4000 });
    g.markOpen();
    g.markClosed();
    await c.advance(100);
    g.markOpen();
    await c.advance(1000);
    let result: boolean | null = null;
    void g.whenClear().then((v) => (result = v));
    await c.advance(500);
    ok("reopened sheet cancels the old settle", result === null);
    g.markClosed();
    await c.advance(401);
    ok("released after the second close", result === true);
  }
  {
    const c = fakeClock();
    const g = createSheetCloseGate({ ...c, settleMs: 400, maxWaitMs: 4000 });
    g.markOpen();
    const seen: boolean[] = [];
    void g.whenClear().then((v) => seen.push(v));
    void g.whenClear().then((v) => seen.push(v));
    g.markClosed();
    await c.advance(401);
    ok("every waiter is released", seen.length === 2 && seen.every(Boolean));
  }

  {
    // Wiring: the dashboard marks the sheet open before the write, waits for the
    // gate before ANY dialog or review request, and reports the sheet's close.
    const src = readFileSync("app/(tabs)/index.tsx", "utf8");
    const at = (needle: string) => src.indexOf(needle);
    const open = at("sheetGate.markOpen()");
    const wait = at("await sheetGate.whenClear()");
    ok("a timed-out wait does not return", !/if \(!\(await sheetGate\.whenClear\(\)\)\) return/.test(src));
    ok("gate marked open", open > 0);
    ok("gate waited on", wait > open);
    ok("wait precedes the low follow-up sheet", wait < at("await maybeOfferLowFollowup(value)"));
    ok("wait precedes the Health question", wait < at("await maybeAskHealthWrite(addedSugar)"));
    ok("wait precedes the review request", wait < at('maybeRequestReview("log_saved")'));
    ok("close reported by the sheet's onClose", /onClose=\{\(\) => \{\s*sheetGate\.markClosed\(\)/.test(src));
  }

  if (failed) {
    console.log(`${failed} FAIL`);
    process.exit(1);
  }
  console.log("sheetCloseGate: ok");
}

void main();
