/**
 * lib/stepperInput.ts correctness harness. The reported defect: a typed dose
 * or ratio was saved as a stale or fragment value while the field showed
 * something else ("12" deleted to "1" committed 1; an emptied field committed
 * nothing; "200" over a max of 150 committed a clamped 150 under a "200" field).
 *
 * Run: npx tsx scripts/stepperInput.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  fieldShowsValue,
  shouldRevertOnUnmount,
  nextInvalidKeys,
  readStepperText,
  resolveStepperBlur,
  sanitizeStepperText,
  stepStepperValue,
} from "../lib/stepperInput";
import { parseDecimalText, sanitizeNumberText } from "../lib/numberInput";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const j = (v: unknown) => JSON.stringify(v);

const b1 = { min: 1, max: 50, decimals: 0 };
ok("read '' -> empty", j(readStepperText("", b1)) === j({ kind: "empty" }));
ok("read ',' -> empty", j(readStepperText(",", { ...b1, decimals: 1 })) === j({ kind: "empty" }));
ok("read 12 -> ok", j(readStepperText("12", b1)) === j({ kind: "ok", value: 12 }));
ok("read 0 -> below", readStepperText("0", b1).kind === "below");
ok("read 60 -> above", readStepperText("60", b1).kind === "above");
ok("read 5,5 dec1 -> ok 5.5", j(readStepperText("5,5", { decimals: 1 })) === j({ kind: "ok", value: 5.5 }));
ok("read Arabic digits -> ok 12", j(readStepperText("١٢", b1)) === j({ kind: "ok", value: 12 }));
ok("read unbounded -> ok", j(readStepperText("99999", { decimals: 0 })) === j({ kind: "ok", value: 99999 }));

ok("sanitize 1.25 dec1", sanitizeStepperText("1.25", 1) === "1.2");
ok("sanitize 1,25 dec1", sanitizeStepperText("1,25", 1) === "1,2");
ok("sanitize 12.5 dec0", sanitizeStepperText("12.5", 0) === "125");

ok("step 0.1+0.2", stepStepperValue(0.1, 0.2, { decimals: 1 }) === 0.3);
ok("step clamp max", stepStepperValue(50, 1, b1) === 50);
ok("step clamp min", stepStepperValue(1, -1, b1) === 1);
ok("step 149.5+1 max 150", stepStepperValue(149.5, 1, { max: 150, decimals: 1 }) === 150);

const b150 = { min: 0, max: 150, decimals: 1 };
ok("blur ok keeps", j(resolveStepperBlur({ kind: "ok", value: 5 }, 12, 5)) === j({ value: 5, emit: false }));
ok("blur empty restores", j(resolveStepperBlur({ kind: "empty" }, 12, 1)) === j({ value: 12, emit: true }));
ok("blur empty same", j(resolveStepperBlur({ kind: "empty" }, 12, 12)) === j({ value: 12, emit: false }));
ok("blur above -> baseline", j(resolveStepperBlur({ kind: "above", value: 200 }, 4, 4)) === j({ value: 4, emit: false }));

const a = new Set<string>();
const withA = nextInvalidKeys(a, "a", false);
ok("keys add", withA.has("a") && withA !== a);
ok("keys add again same ref", nextInvalidKeys(withA, "a", false) === withA);
ok("keys remove", !nextInvalidKeys(withA, "a", true).has("a"));
ok("keys remove absent same ref", nextInvalidKeys(a, "a", true) === a);
const both = nextInvalidKeys(withA, "b", false);
ok("keys independent", nextInvalidKeys(both, "a", true).has("b") && !nextInvalidKeys(both, "a", true).has("a"));

const b24 = { min: 0, max: 150, decimals: 1 };
ok("echo: field shows value -> true", fieldShowsValue("24", 24, b24) === true);
ok("echo: value returns to earlier emit but field differs -> external", fieldShowsValue("0", 24, b24) === false);
ok("echo: empty field -> external", fieldShowsValue("", 24, b24) === false);
ok("echo: out-of-range field -> external", fieldShowsValue("155", 150, { ...b24 }) === false);
ok("echo: comma decimal", fieldShowsValue("5,5", 5.5, b24) === true);
{
  // F1 sequence: dose 24 saved, field focused, bolus (0) then basal (24) set from outside.
  const field = "24";
  const afterBolus = fieldShowsValue(field, 0, b24) ? field : "0";
  const afterBasal = fieldShowsValue(afterBolus, 24, b24) ? afterBolus : "24";
  ok("F1: external 24 after 0 replaces the field", afterBolus === "0" && afterBasal === "24");
  // calculator: typed 150, slider 155, slider back to 150 (field must follow 155 then 150)
  const t1 = fieldShowsValue("150", 155, { min: 0, max: 1500, decimals: 0 }) ? "150" : "155";
  const t2 = fieldShowsValue(t1, 150, { min: 0, max: 1500, decimals: 0 }) ? t1 : "150";
  ok("F1: slider 155 then 150 keeps field in sync", t1 === "155" && t2 === "150");
}
{
  // F4: invalid "999" leaves a fragment in the parent; +/- must step from the focus baseline.
  const bnd = { min: 1, max: 50, decimals: 0 };
  ok("F4: step from baseline, not fragment", stepStepperValue(12, 1, bnd) === 13 && stepStepperValue(1, 1, bnd) === 2);
}
{
  // F2/F3: unmount while invalid with revertOnUnmount reports baseline (resolveStepperBlur semantics).
  const r = resolveStepperBlur(readStepperText("", b1), 24, 2);
  ok("F2/F3: invalid + fragment 2 reverts to baseline 24 (emit)", r.value === 24 && r.emit === true);
}

ok("F3c: invalid, nothing emitted (baseline == current) -> no revert write", shouldRevertOnUnmount(false, 10, 10) === false);
ok("F3d: out-of-range paste, nothing emitted -> no revert write", readStepperText("60", b1).kind === "above" && shouldRevertOnUnmount(false, 12, 12) === false);
ok("F3: invalid with fragment emitted -> revert", shouldRevertOnUnmount(false, 24, 2) === true);
ok("F3: valid -> never revert", shouldRevertOnUnmount(true, 24, 2) === false);

/**
 * REGRESSION ORACLE. oldOnText mirrors components/Stepper.tsx onText before the
 * fix: returns the value passed to onChange (or undefined when not called).
 */
function oldOnText(s: string, min: number | undefined, max: number | undefined, decimals: number): number | undefined {
  const cleaned = sanitizeNumberText(s, decimals > 0);
  const parsed = parseDecimalText(cleaned);
  if (parsed == null) return undefined;
  let v = parsed;
  if (max != null) v = Math.min(max, v);
  if (min != null) v = Math.max(min, v);
  return v;
}

/** Fixed logic: committed value after typing `s` (undefined = no commit), plus validity. */
function newOnText(s: string, bnd: { min?: number; max?: number; decimals: number }) {
  const r = readStepperText(sanitizeStepperText(s, bnd.decimals), bnd);
  return { commit: r.kind === "ok" ? r.value : undefined, valid: r.kind === "ok" };
}

const bd = { min: 1, max: 150, decimals: 0 };
const seq = ["12", "1", ""];
let stateOld = 12;
for (const s of seq) {
  const c = oldOnText(s, bd.min, bd.max, bd.decimals);
  if (c !== undefined) stateOld = c;
}
// Old logic: field is empty but parent holds the fragment 1, save enabled.
ok("oracle old: empty field leaves fragment 1 saved (defect)", stateOld === 1 && sanitizeStepperText("", 0) === "");

const reads = seq.map((s) => readStepperText(sanitizeStepperText(s, 0), bd));
ok("oracle reads ok(12), ok(1), empty", j(reads) === j([{ kind: "ok", value: 12 }, { kind: "ok", value: 1 }, { kind: "empty" }]));
const last = newOnText("", bd);
ok("oracle new: empty is invalid (save disabled)", last.valid === false && last.commit === undefined);
ok("oracle new: blur restores baseline 12 and emits", j(resolveStepperBlur(reads[2], 12, 1)) === j({ value: 12, emit: true }));

ok("oracle old: 200 over max committed clamped 150 (defect)", oldOnText("200", 1, 150, 0) === 150);
const n200 = newOnText("200", bd);
ok("oracle new: 200 above max, no commit, invalid", n200.commit === undefined && n200.valid === false && readStepperText("200", bd).kind === "above");
ok("oracle new: 200 blur -> baseline", resolveStepperBlur(readStepperText("200", bd), 4, 4).value === 4);
void b150;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
