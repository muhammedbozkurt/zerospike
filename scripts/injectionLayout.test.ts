declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
import { injectionColumns } from "../lib/injectionLayout";

// Mirrors lib/useLayout WIDE_MIN_DP (600); not imported because it pulls react-native.
const wideOf = (w: number, h: number) => Math.min(w, h) >= 600;

// [label, width, height, twoCol, gap]
const cases: [string, number, number, boolean, number][] = [
  ["phone portrait", 390, 844, false, 0],
  ["phone landscape", 844, 390, false, 0],
  ["7in tablet portrait 600dp", 600, 960, false, 0],
  ["7in tablet landscape", 960, 600, true, 0],
  ["10in tablet portrait 800dp", 800, 1280, true, 0],
  ["10in tablet landscape", 1280, 800, true, 24],
  ["ipad 13in portrait", 1032, 1376, true, 0],
  ["ipad 13in landscape", 1376, 1032, true, 48],
  ["narrow wide 650", 650, 1000, false, 0],
];

let bad = 0;
for (const [label, w, h, twoCol, gap] of cases) {
  const r = injectionColumns(w, wideOf(w, h));
  if (r.twoCol !== twoCol || r.gap !== gap) {
    bad++;
    console.log(`FAIL ${label}: got ${JSON.stringify(r)} want ${twoCol}/${gap}`);
  }
}
if (bad) process.exit(1);
console.log(`ok ${cases.length} cases`);
