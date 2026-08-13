/**
 * lib/injectionHeat.ts correctness harness. No jest, same standalone style as
 * scripts/rotation.test.ts.
 *
 * Covers the five reference scenarios for the rotation-aware scale, the
 * never-used floor, monotonicity, the [0,1] clamp, and the property the old
 * scale broke: the level depends on COUNTS only, never on which point index a
 * count happens to sit on or on the order the entries were logged.
 *
 * Run: npx tsx scripts/injectionHeat.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  POINTS_PER_REGION,
  POINT_MIN_DENOM,
  REGION_MIN_DENOM,
  SELECTABLE_REGION_COUNT,
  USED_FLOOR,
  pointHeatLevel,
  regionHeatLevel,
} from "../lib/injectionHeat";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function near(name: string, actual: number, expected: number, tol = 0.005): void {
  ok(name, Math.abs(actual - expected) <= tol, `got ${actual.toFixed(4)}, want ~${expected}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike injection-heat scale test");

// ── A. The five reference scenarios ─────────────────────────────────────────
section("A. reference scenarios (region level)");
{
  // 1 entry, all of it in one region: the complaint case. The old scale put this
  // at 1.0 (its own count WAS the maximum) and the region went darkest at once.
  near("total 1, one region -> pale", regionHeatLevel(1, 1), 0.1667);
  ok("total 1, one region is well under half", regionHeatLevel(1, 1) < 0.25);

  // 30 entries spread evenly over the eight regions: mid ramp.
  near("total 30, evenly rotated -> mid", regionHeatLevel(30 / SELECTABLE_REGION_COUNT, 30), 0.5);

  // 30 entries all in one region: that region saturates, the rest stay at 0.
  near("total 30, one region -> darkest", regionHeatLevel(30, 30), 1);
  near("total 30, the untouched seven -> 0", regionHeatLevel(0, 30), 0);

  // Four times the volume, same rotation: still mid ramp.
  near("total 120, evenly rotated -> mid", regionHeatLevel(120 / SELECTABLE_REGION_COUNT, 120), 0.5);
  near("total 120, one region -> darkest", regionHeatLevel(120, 120), 1);
}

section("B. reference scenarios (point level, inside one region)");
{
  // A region with 1 entry: its single used point stays pale.
  near("region 1, one point -> pale", pointHeatLevel(1, 1), 1 / POINT_MIN_DENOM);
  // A region with 16 entries spread over its four points: mid ramp.
  near("region 16, evenly rotated -> mid", pointHeatLevel(16 / POINTS_PER_REGION, 16), 0.5);
  near("region 16, all on one point -> darkest", pointHeatLevel(16, 16), 1);
  near("region 16, the untouched three -> 0", pointHeatLevel(0, 16), 0);
}

// ── C. Never used is a true zero, used-once is not ──────────────────────────
section("C. zero vs used-but-rare");
{
  near("region count 0 -> exactly 0", regionHeatLevel(0, 0), 0);
  near("region count 0 in a busy history -> exactly 0", regionHeatLevel(0, 400), 0);
  near("point count 0 -> exactly 0", pointHeatLevel(0, 50), 0);
  ok(
    "one entry in a 400-entry history still reads as used",
    regionHeatLevel(1, 400) >= USED_FLOOR,
    String(regionHeatLevel(1, 400))
  );
  ok(
    "one entry on a point of a busy region still reads as used",
    pointHeatLevel(1, 200) >= USED_FLOOR,
    String(pointHeatLevel(1, 200))
  );
  ok("the floor is visibly above zero", USED_FLOOR > 0.1);
}

// ── D. Monotonicity ─────────────────────────────────────────────────────────
section("D. monotonic in the count");
{
  let mono = true;
  for (const total of [0, 1, 5, 24, 30, 97, 400]) {
    let prev = -1;
    for (let c = 0; c <= total; c++) {
      const v = regionHeatLevel(c, total);
      if (v < prev - 1e-9) mono = false;
      prev = v;
    }
  }
  ok("region level never falls as the count rises (total fixed)", mono);

  // The realistic move: one more entry raises BOTH the region count and the total.
  let monoLogged = true;
  for (let start = 0; start <= 40; start++) {
    for (let total = start; total <= start + 60; total++) {
      const a = regionHeatLevel(start, total);
      const b = regionHeatLevel(start + 1, total + 1);
      if (b < a - 1e-9) monoLogged = false;
    }
  }
  ok("logging one more entry on a region never lightens it", monoLogged);

  let monoPoint = true;
  for (const regionCount of [0, 1, 4, 12, 33]) {
    let prev = -1;
    for (let c = 0; c <= regionCount; c++) {
      const v = pointHeatLevel(c, regionCount);
      if (v < prev - 1e-9) monoPoint = false;
      prev = v;
    }
  }
  ok("point level never falls as the count rises", monoPoint);
}

// ── E. Clamp ────────────────────────────────────────────────────────────────
section("E. clamped to [0, 1]");
{
  let inRange = true;
  for (const total of [0, 1, 3, 8, 30, 120, 5000]) {
    for (const c of [0, 1, 2, 7, 30, 120, 5000, 100000]) {
      const r = regionHeatLevel(c, total);
      const p = pointHeatLevel(c, total);
      if (!(r >= 0 && r <= 1) || !(p >= 0 && p <= 1)) inRange = false;
    }
  }
  ok("every level lands in [0, 1]", inRange);
  near("an absurd over-use still stops at 1", regionHeatLevel(100000, 100000), 1);
  ok("negative inputs cannot go below 0", regionHeatLevel(-5, 30) === 0 && pointHeatLevel(-5, 12) === 0);
}

// ── F. Independent of point index and of logging order ──────────────────────
section("F. counts only, never the index or the order");
{
  // Four points of one region, the same multiset of counts handed over in every
  // rotation of the array. The set of levels must not move.
  const counts = [4, 1, 0, 7];
  const regionCount = counts.reduce((a, b) => a + b, 0);
  const base = counts.map((c) => pointHeatLevel(c, regionCount));
  let stable = true;
  for (let shift = 1; shift < counts.length; shift++) {
    const rotated = counts.map((_, i) => counts[(i + shift) % counts.length]);
    const levels = rotated.map((c) => pointHeatLevel(c, regionCount));
    for (let i = 0; i < levels.length; i++) {
      if (Math.abs(levels[i] - base[(i + shift) % counts.length]) > 1e-12) stable = false;
    }
  }
  ok("a point's level travels with its count, not with its slot", stable);

  // "1 then 2 then 3 then 4" vs "4 then 3 then 2 then 1": same counts at the end,
  // so the same picture. Order of logging is not an input at all.
  const ascending = [1, 2, 3, 4].map((p) => ({ point: p, count: 1 }));
  const descending = [4, 3, 2, 1].map((p) => ({ point: p, count: 1 }));
  const levelOf = (rows: { point: number; count: number }[], point: number): number => {
    const rc = rows.reduce((s, r) => s + r.count, 0);
    return pointHeatLevel(rows.find((r) => r.point === point)?.count ?? 0, rc);
  };
  let sameEitherWay = true;
  for (const p of [1, 2, 3, 4]) {
    if (Math.abs(levelOf(ascending, p) - levelOf(descending, p)) > 1e-12) sameEitherWay = false;
  }
  ok("walking the points 1->4 or 4->1 paints the identical map", sameEitherWay);
  near("and all four sit pale, not dark", levelOf(ascending, 1), 1 / POINT_MIN_DENOM);
}

// ── G. Constants match the documented model ─────────────────────────────────
section("G. constants");
{
  ok("REGION_MIN_DENOM is 6", REGION_MIN_DENOM === 6);
  ok("POINT_MIN_DENOM is 3", POINT_MIN_DENOM === 3);
  ok("eight selectable regions", SELECTABLE_REGION_COUNT === 8);
  ok("four points per region", POINTS_PER_REGION === 4);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
