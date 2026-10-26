/**
 * G2 + G28: injection form / edit sheet save path. A write error must reach the
 * user (toast, values kept) and a second tap must never start a second save.
 * Run: npx sucrase-node scripts/injectionSave.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const src = (f: string): string => readFileSync(join(__dirname, "..", f), "utf8");

function body(file: string, startMarker: string, endMarker: string): string {
  const s = src(file);
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a + 1);
  return a >= 0 && b > a ? s.slice(a, b) : "";
}

const form = body("app/(tabs)/injection.tsx", "async function save()", "// Picking a site on the map");
const sheet = body("components/InjectionEditSheet.tsx", "async function save()", "/** Same confirm dialog as the row's own swipe delete");

ok("form save() uses the guarded runner", form.includes("runGuardedSave("));
ok("form save() takes the lock via a ref", form.includes("savingRef"));
ok("form save() reports failures with common.saveFailed", form.includes("common.saveFailed"));
ok("form save() logs the crash", form.includes("logCrash("));
ok("sheet save() uses the guarded runner", sheet.includes("runGuardedSave("));
ok("sheet save() takes the lock via a ref", sheet.includes("savingRef"));
ok("sheet save() reports failures with common.saveFailed", sheet.includes("common.saveFailed"));
ok("sheet save() logs the crash", sheet.includes("logCrash("));

let helper: any = null;
try {
  helper = require("../lib/injectionSave");
} catch {
  ok("lib/injectionSave.ts exists", false);
}

async function main(): Promise<void> {
  if (helper) {
    const { runGuardedSave } = helper;

    {
      const lock = { current: false };
      let writes = 0;
      let release!: () => void;
      const gate = new Promise<boolean>((r) => (release = () => r(true)));
      const base = {
        lock,
        setBusy: () => {},
        confirm: () => gate,
        write: async () => {
          writes++;
          return "row";
        },
        onSaved: () => {},
        onError: () => {},
      };
      const first = runGuardedSave(base);
      const second = await runGuardedSave(base);
      ok("second tap during the first await is rejected", second === "busy");
      release();
      ok("first save completes", (await first) === "saved");
      ok("exactly one write for a double tap", writes === 1);
      ok("lock released after success", lock.current === false);
    }

    {
      const lock = { current: false };
      const errors: Array<[unknown, string]> = [];
      let saved = 0;
      const out = await runGuardedSave({
        lock,
        setBusy: () => {},
        confirm: async () => true,
        write: async () => {
          throw new Error("disk I/O");
        },
        onSaved: () => {
          saved++;
        },
        onError: (e: unknown, phase: string) => errors.push([e, phase]),
      });
      ok("write error resolves to failed, never throws", out === "failed");
      ok("write error reaches onError with phase write", errors.length === 1 && errors[0][1] === "write");
      ok("onSaved is not called after a failed write", saved === 0);
      ok("lock released after failure (retry possible)", lock.current === false);
    }

    {
      const lock = { current: false };
      const phases: string[] = [];
      const out = await runGuardedSave({
        lock,
        setBusy: () => {},
        confirm: async () => true,
        write: async () => "row",
        onSaved: () => {
          throw new Error("ui");
        },
        onError: (_e: unknown, phase: string) => phases.push(phase),
      });
      ok("post-write UI error still counts as saved", out === "saved");
      ok("post-write error is tagged after", phases.length === 1 && phases[0] === "after");
    }

    {
      const lock = { current: false };
      let writes = 0;
      const out = await runGuardedSave({
        lock,
        setBusy: () => {},
        confirm: async () => false,
        write: async () => {
          writes++;
        },
        onSaved: () => {},
        onError: () => {},
      });
      ok("declined confirm cancels without writing", out === "cancelled" && writes === 0);
      ok("lock released after cancel", lock.current === false);
    }

    {
      const lock = { current: false };
      const busy: boolean[] = [];
      const phases: string[] = [];
      const out = await runGuardedSave({
        lock,
        setBusy: (b: boolean) => busy.push(b),
        confirm: async () => {
          throw new Error("guard read");
        },
        write: async () => "x",
        onSaved: () => {},
        onError: (_e: unknown, phase: string) => phases.push(phase),
      });
      ok("confirm-phase throw is reported and fails", out === "failed" && phases[0] === "confirm");
      ok("confirm-phase throw releases busy and lock", busy.join() === "true,false" && lock.current === false);
    }
  }

  console.log(failed ? `${failed} failed` : "all passed");
  if (failed) process.exit(1);
}
void main();
