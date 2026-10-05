declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
import { injectionDoseOk } from "../lib/injectionDose";

const cases: [number, number | null | undefined, boolean][] = [
  [0, undefined, false], [-1, undefined, false], [NaN, undefined, false], [0.5, undefined, true], [150, undefined, true],
  [0, null, true],
  [0, 4, false],
  [0, 0, true],
  [2, null, true],
];
let bad = 0;
for (const [v, o, want] of cases) {
  if (injectionDoseOk(v, o) !== want) {
    console.log(`FAIL ${v} ${o}`);
    bad++;
  }
}
console.log(bad ? `${bad} failed` : `${cases.length} passed, 0 failed`);
if (bad) process.exit(1);
