/**
 * Touch-target measurement for the injection map (components/injectionMap/silhouette.ts):
 * every region's touch rectangle must be at least 44 pt both ways at the
 * narrowest supported map width, touch rectangles of regions visible together
 * must not overlap, and every region plate must sit inside the silhouette.
 *
 * Run: npx tsx scripts/injectionMapHit.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { REGIONS, VB_W, hitBoxFor, type Region } from "../components/injectionMap/silhouette";

/** svgW = min(round(winW * 0.78), 384): winW 320 is the narrowest phone, 384 the cap. */
const WIDTHS = [250, 292, 306, 384];
const MIN_PT = 44;

let fail = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
}

type Box = readonly [number, number, number, number];
const overlap = (a: Box, b: Box): boolean =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

let minPt = Infinity;
for (const r of REGIONS) {
  const [, , w, h] = hitBoxFor(r);
  const scale = WIDTHS[0] / VB_W;
  const pt = Math.min(w, h) * scale;
  minPt = Math.min(minPt, pt);
  check(`hit ${r.site}`, pt >= MIN_PT, `${w.toFixed(1)} x ${h.toFixed(1)} units = ${pt.toFixed(1)} pt at width ${WIDTHS[0]}`);
}
console.log(`min hit side: ${minPt.toFixed(1)} pt at ${WIDTHS[0]}, ${((minPt / WIDTHS[0]) * WIDTHS[1]).toFixed(1)} pt at ${WIDTHS[1]}`);

const pairs: Array<[Region, Region]> = [];
for (let i = 0; i < REGIONS.length; i++)
  for (let j = i + 1; j < REGIONS.length; j++) pairs.push([REGIONS[i], REGIONS[j]]);
for (const [a, b] of pairs) {
  const sameFace = a.surface === b.surface;
  const hit = overlap(hitBoxFor(a), hitBoxFor(b));
  const plates = overlap(a.box, b.box);
  check(`plates ${a.site}/${b.site}`, !plates, "no overlap");
  if (sameFace) check(`hit ${a.site}/${b.site}`, !hit, "no touch overlap on one face");
}

for (const r of REGIONS) {
  const [x, y, w, h] = hitBoxFor(r);
  check(`inside canvas ${r.site}`, x >= 0 && y >= 0 && x + w <= VB_W && y + h <= 380, `${x},${y},${w},${h}`);
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
if (fail > 0) process.exit(1);
