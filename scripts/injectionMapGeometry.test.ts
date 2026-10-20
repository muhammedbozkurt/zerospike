/**
 * Injection map geometry on small screens (components/injectionMap):
 *  - arms are at least a quarter of the chest width and narrow only gently
 *    from the elbow to the wrist;
 *  - every arm region plate sits inside the drawn arm with visible clearance;
 *  - region plates of one face are at least 8 pt apart at 320 and 375 pt wide;
 *  - in the zoom, dots keep 8 pt to each other and to the plate edge (the dot
 *    shrinks when it has to) and the count stays inside the dot.
 *
 * Run: npx tsx scripts/injectionMapGeometry.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  GEOMETRY,
  REGIONS,
  VB_W,
  armPoints,
  sampleClosed,
  spanAt,
  torsoPoints,
  type Region,
} from "../components/injectionMap/silhouette";
import {
  BADGE_H,
  BADGE_TOP_Y,
  DOT_GAP_PT,
  DOT_R_MAX,
  countFitsInDot,
  dotMetrics,
  mapWidth,
} from "../components/injectionMap/layout";

let fail = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
}

/** [width, height] of the phones the map must hold on, in points. */
const PHONES: Array<[string, number, number]> = [
  ["iPhone SE 1 / small Android 320", 320, 568],
  ["iPhone SE 2/3 375x667", 375, 667],
  ["iPhone mini 375x812", 375, 812],
  ["iPhone 15 393x852", 393, 852],
  ["iPhone Pro Max 430x932", 430, 932],
];
const widthsPt = PHONES.map(([, w, h]) => mapWidth(w, h));
const NARROW = Math.min(...widthsPt);
console.log(`map widths: ${PHONES.map(([n], i) => `${n}=${widthsPt[i]}`).join(", ")}`);
check("narrowest map is 250 pt", NARROW === 250, String(NARROW));

const torso = sampleClosed(torsoPoints());
const armR = sampleClosed(armPoints("screenRight"));
const armL = sampleClosed(armPoints("screenLeft"));

// Chest width = widest torso span beside the arms.
let chest = 0;
for (let y = 95; y <= 160; y += 1) {
  const s = spanAt(torso, y);
  if (s) chest = Math.max(chest, s[1] - s[0]);
}
console.log(`chest width ${chest.toFixed(1)} units, quarter ${(chest / 4).toFixed(1)}`);

let minArm = Infinity;
for (let y = 100; y <= 232; y += 2) {
  const s = spanAt(armR, y);
  if (s) minArm = Math.min(minArm, s[1] - s[0]);
}
check("arm width >= 1/4 of chest from shoulder to wrist", minArm >= chest / 4, `min ${minArm.toFixed(1)} vs ${(chest / 4).toFixed(1)} units`);

const w = (y: number): number => {
  const s = spanAt(armR, y)!;
  return s[1] - s[0];
};
check("arm narrows gently from elbow to wrist", w(222) < w(170) && w(222) >= 0.85 * w(170), `elbow ${w(170).toFixed(1)}, wrist ${w(222).toFixed(1)}`);
const outer = Math.max(...armR.map((p) => p[0])) - VB_W / 2;
check("shoulders wider than the earlier 61 units", outer >= 66, `outer edge ${outer.toFixed(1)} units from the midline`);

const mirrorOk = [120, 160, 200].every((y) => {
  const a = spanAt(armR, y)!;
  const b = spanAt(armL, y)!;
  return Math.abs(a[1] - a[0] - (b[1] - b[0])) < 0.05;
});
check("both arms are mirror images", mirrorOk, "span at y=120,160,200");

const armTop = Math.min(...armR.map((p) => p[1]));
const badgeBottom = BADGE_TOP_Y + (BADGE_H * VB_W) / NARROW;
check("side badges end above the shoulders", badgeBottom + 4 <= armTop, `badge bottom y ${badgeBottom.toFixed(1)}, arm top y ${armTop.toFixed(1)}`);

// Arm regions sit inside the drawn arm. screen-right box = user's *_left site.
for (const r of REGIONS.filter((x) => x.site.startsWith("arm_"))) {
  const outline = r.site.endsWith("_left") ? armR : armL;
  const [bx, by, bw, bh] = r.box;
  let clear = Infinity;
  for (let y = by; y <= by + bh; y += 1) {
    const s = spanAt(outline, y)!;
    clear = Math.min(clear, bx - s[0], s[1] - (bx + bw));
  }
  const pt = (clear * NARROW) / VB_W;
  check(`arm plate ${r.site} fits inside the arm`, clear > 0, `${clear.toFixed(1)} units`);
  check(`arm plate ${r.site} leaves visible clearance at ${NARROW} pt`, pt >= 3.5, `${pt.toFixed(1)} pt to the arm edge`);
}

// The other plates sit inside the torso.
for (const r of REGIONS.filter((x) => !x.site.startsWith("arm_"))) {
  const [bx, by, bw, bh] = r.box;
  let clear = Infinity;
  for (let y = by; y <= by + bh; y += 1) {
    const s = spanAt(torso, y)!;
    clear = Math.min(clear, bx - s[0], s[1] - (bx + bw));
  }
  check(`plate ${r.site} inside the body`, (clear * NARROW) / VB_W >= 2, `${((clear * NARROW) / VB_W).toFixed(1)} pt clear at ${NARROW} pt`);
}

// Gaps between plates of one face.
function gapUnits(a: Region, b: Region): number {
  const [ax, ay, aw, ah] = a.box;
  const [bx, by, bw, bh] = b.box;
  const dx = Math.max(0, Math.max(ax, bx) - Math.min(ax + aw, bx + bw));
  const dy = Math.max(0, Math.max(ay, by) - Math.min(ay + ah, by + bh));
  return Math.hypot(dx, dy);
}
let minGap = Infinity;
for (let i = 0; i < REGIONS.length; i++)
  for (let j = i + 1; j < REGIONS.length; j++) {
    if (REGIONS[i].surface !== REGIONS[j].surface) continue;
    minGap = Math.min(minGap, (gapUnits(REGIONS[i], REGIONS[j]) * NARROW) / VB_W);
  }
check(`plates of one face are >= 8 pt apart at ${NARROW} pt`, minGap >= 8, `closest ${minGap.toFixed(2)} pt`);

// Zoom dots on every phone.
for (let i = 0; i < PHONES.length; i++) {
  const svgW = widthsPt[i];
  let worst = Infinity;
  let rMin = Infinity;
  for (const geo of GEOMETRY.values()) {
    const m = dotMetrics(geo, svgW);
    rMin = Math.min(rMin, m.r);
    worst = Math.min(worst, m.pairPt - 2 * m.r, m.edgePt - m.r);
    check(`${PHONES[i][0]} ${geo.region.site}: radius within 23 pt`, m.r <= DOT_R_MAX, `r ${m.r.toFixed(1)}`);
    for (const digits of [1, 2, 3])
      if (!countFitsInDot(m.r, digits)) check(`${PHONES[i][0]} ${geo.region.site}: ${digits}-digit count inside the dot`, false, `r ${m.r.toFixed(1)}`);
  }
  check(`${PHONES[i][0]} (map ${svgW}): dots keep ${DOT_GAP_PT} pt to each other and to the plate edge`, worst >= DOT_GAP_PT - 1e-6, `tightest ${worst.toFixed(2)} pt, smallest dot r ${rMin.toFixed(1)}`);
}
check("wide screens keep the full 23 pt dot", [...GEOMETRY.values()].every((g) => dotMetrics(g, 384).r === DOT_R_MAX), "384 pt map");

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
if (fail > 0) process.exit(1);
