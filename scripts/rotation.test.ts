/**
 * lib/rotationPick.ts correctness harness. No jest, same standalone style as
 * scripts/mealResponse.test.ts.
 *
 * Covers the "never re-suggest the point just injected" rule: empty history, a
 * single point ever used, a fully-used region set (sanity on the base LRU
 * order), a fresh rotation-cycle reset that makes the last point read as
 * "never used", every point tied at the same usage timestamp, and the
 * degenerate single-point-universe fallback the real 32-point map never hits.
 *
 * Run: npx tsx scripts/rotation.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { pickLeastRecentlyUsedPoint, pointKey, type RotationPoint } from "../lib/rotationPick";
import { SELECTABLE_SITES, SITE_POINTS } from "../lib/db/types";

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
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function eqPoint(name: string, actual: RotationPoint, expected: RotationPoint): void {
  ok(
    name,
    pointKey(actual.site, actual.point) === pointKey(expected.site, expected.point),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const ALL: RotationPoint[] = SELECTABLE_SITES.flatMap((site) =>
  SITE_POINTS.map((point) => ({ site, point }))
);
const FIRST = ALL[0]; // abdomen_left, point 1
const SECOND = ALL[1]; // abdomen_left, point 2

console.log("zerospike rotation-pick test");

// ── A. Empty history ─────────────────────────────────────────────────────────
section("A. empty history");
{
  const result = pickLeastRecentlyUsedPoint({ cycleLastUsed: new Map(), lastPoint: null });
  eqPoint("no rows at all -> the canonical first point", result, FIRST);
}

// ── B. A single point ever used ──────────────────────────────────────────────
section("B. a single point ever used");
{
  const used: RotationPoint = { site: "thigh_left", point: 3 };
  const cycleLastUsed = new Map([[pointKey(used.site, used.point), "2026-07-01T08:00:00.000Z"]]);
  const result = pickLeastRecentlyUsedPoint({ cycleLastUsed, lastPoint: used });
  ok(
    "never repeats the only point on record",
    !(result.site === used.site && result.point === used.point),
    JSON.stringify(result)
  );
  eqPoint("31 points are untouched, so the canonical first one wins", result, FIRST);
}

// ── C. Fully-used set (sanity on the base LRU order + the invariant holds) ──
section("C. every point used, distinct timestamps");
{
  // Shuffle the timestamps across the canonical order so the oldest and the
  // most-recent (== lastPoint) are not adjacent by coincidence.
  const cycleLastUsed = new Map<string, string>();
  const order = [...ALL].sort((a, b) => pointKey(a.site, a.point).localeCompare(pointKey(b.site, b.point)));
  order.forEach((p, i) => {
    // ISO timestamps increasing by index; index 0 is oldest, last index newest.
    const ms = Date.parse("2026-01-01T00:00:00.000Z") + i * 3_600_000;
    cycleLastUsed.set(pointKey(p.site, p.point), new Date(ms).toISOString());
  });
  const newest = order[order.length - 1];
  const oldest = order[0];
  const result = pickLeastRecentlyUsedPoint({ cycleLastUsed, lastPoint: newest });
  eqPoint("the mathematically oldest point still wins", result, oldest);
  ok(
    "the just-injected (newest) point is never the answer",
    !(result.site === newest.site && result.point === newest.point)
  );
}

// ── D. Rotation-cycle reset right after the last injection ──────────────────
section("D. reset skip (last point reads as 'never used' in the fresh cycle)");
{
  // cycleStart landed AFTER the last injection, so the cycle window's usage
  // map has no entry for it at all - exactly what a "new cycle" stamp taken
  // right after logging produces. A few OTHER points do have cycle usage.
  const cycleLastUsed = new Map<string, string>([
    [pointKey(ALL[2].site, ALL[2].point), "2026-07-10T09:00:00.000Z"],
    [pointKey(ALL[3].site, ALL[3].point), "2026-07-10T10:00:00.000Z"],
  ]);
  const result = pickLeastRecentlyUsedPoint({ cycleLastUsed, lastPoint: FIRST });
  eqPoint("the canonical-first slot (== last point) is skipped for the next one", result, SECOND);
}

// ── E. Every point tied at the exact same usage timestamp ───────────────────
section("E. all 32 points equally used (exact tie)");
{
  const cycleLastUsed = new Map<string, string>();
  const stamp = "2026-06-01T12:00:00.000Z";
  for (const p of ALL) cycleLastUsed.set(pointKey(p.site, p.point), stamp);
  const result = pickLeastRecentlyUsedPoint({ cycleLastUsed, lastPoint: FIRST });
  ok(
    "a tie never resolves back to the just-injected point",
    !(result.site === FIRST.site && result.point === FIRST.point)
  );
  eqPoint("stable order picks the next canonical point", result, SECOND);
}

// ── F. Degenerate single-point universe (only-option fallback) ──────────────
section("F. only one point exists in the universe");
{
  const only: RotationPoint = { site: "arm_right", point: 4 };
  const cycleLastUsed = new Map([[pointKey(only.site, only.point), "2026-05-01T00:00:00.000Z"]]);
  const result = pickLeastRecentlyUsedPoint({
    cycleLastUsed,
    lastPoint: only,
    allPoints: [only],
  });
  eqPoint("with truly no alternative, the last point is returned", result, only);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
