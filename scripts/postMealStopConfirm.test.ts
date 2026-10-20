/**
 * The post-meal card's X asks before cancelling. Run: npx tsx scripts/postMealStopConfirm.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (m: string) => any;

import { cancelPostMealTimerAfterConfirm } from "../lib/postMealTimer";

let failed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log("FAIL " + name);
  }
}

async function main() {
  {
    let cancelled = 0;
    const busy = { current: false };
    const ran = await cancelPostMealTimerAfterConfirm(
      async () => true,
      async () => {
        cancelled++;
      },
      busy
    );
    check("confirm runs cancel", ran && cancelled === 1 && !busy.current);
  }
  {
    let cancelled = 0;
    const busy = { current: false };
    const ran = await cancelPostMealTimerAfterConfirm(
      async () => false,
      async () => {
        cancelled++;
      },
      busy
    );
    check("keep does not cancel", !ran && cancelled === 0 && !busy.current);
  }
  {
    let asked = 0;
    let cancelled = 0;
    let release: (v: boolean) => void = () => {};
    const busy = { current: false };
    const ask = () => {
      asked++;
      return new Promise<boolean>((r) => (release = r));
    };
    const cancel = async () => {
      cancelled++;
    };
    const first = cancelPostMealTimerAfterConfirm(ask, cancel, busy);
    const second = await cancelPostMealTimerAfterConfirm(ask, cancel, busy);
    check("second tap while open is ignored", !second && asked === 1);
    release(true);
    await first;
    check("only one cancel", cancelled === 1 && !busy.current);
  }
  {
    const busy = { current: false };
    let threw = false;
    try {
      await cancelPostMealTimerAfterConfirm(
        async () => true,
        async () => {
          throw new Error("x");
        },
        busy
      );
    } catch {
      threw = true;
    }
    check("busy released after failure", threw && !busy.current);
  }
  {
    const fs = require("fs");
    const src: string = fs.readFileSync("app/(tabs)/index.tsx", "utf8");
    check("card X is wired to the confirm handler", src.includes("onCancel={requestCancelEatingTimer}"));
    check("card X is not wired straight to cancel", !src.includes("onCancel={cancelEatingTimer}"));
  }
  console.log(failed ? `${failed} failed` : "postMealStopConfirm ok");
  if (failed) process.exit(1);
}
main();
