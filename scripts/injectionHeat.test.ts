/**
 * lib/injectionHeat.ts harness: the absolute five-tier scale (0, 1, 2, 3, 4+)
 * of the injection map, and the colours those tiers draw in both themes.
 *
 * Run: npx tsx scripts/injectionHeat.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { HEAT_TIER_LABELS, HEAT_TIER_MIN, heatTierForCount } from "../lib/injectionHeat";
import { PALETTES } from "../lib/theme/tokens";

let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${String(got)}${ok ? "" : ` (want ${String(want)})`}`);
}

// Counts 0..5 land on tiers 0,1,2,3,4,4 (5 is the "4+" tier).
const boundaries: Array<[number, number]> = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 4],
  [6, 4],
  [40, 4],
];
for (const [count, tier] of boundaries) eq(`count ${count} is tier ${tier}`, heatTierForCount(count), tier);
eq("counts 0..5 map to 0,1,2,3,4,4", [0, 1, 2, 3, 4, 5].map(heatTierForCount).join(","), "0,1,2,3,4,4");

eq("negative count is tier 0", heatTierForCount(-3), 0);
eq("NaN is tier 0", heatTierForCount(NaN), 0);

eq("tier thresholds", HEAT_TIER_MIN.join(","), "0,1,2,3,4");
eq("legend labels", HEAT_TIER_LABELS.join("|"), "0|1|2|3|4+");

let mono = true;
let prev = 0;
for (let c = 0; c <= 60; c++) {
  const tier = heatTierForCount(c);
  if (tier < prev) mono = false;
  prev = tier;
}
eq("tier never falls as the count rises", mono, true);

// Absolute scale: the same count gives the same tier whatever else is logged.
eq("one entry stays tier 1 in any history", heatTierForCount(1), 1);

// Five points, each coloured by its own count, on the same scale as the regions.
const pointCounts = [0, 1, 2, 3, 5];
const pointTiers = pointCounts.map(heatTierForCount);
eq("five counts get five tiers", pointTiers.join(","), "0,1,2,3,4");

function lum(hex: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const c = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

for (const scheme of ["light", "dark"] as const) {
  const scale = PALETTES[scheme].heatScale;
  const colors = pointTiers.map((t) => scale[t]);
  eq(`${scheme}: scale has five entries`, scale.length, 5);
  eq(`${scheme}: one recorded point differs from an empty one`, colors[1] !== colors[0], true);
  eq(`${scheme}: all five tier colours differ`, new Set(colors).size, 5);
  // Light: each tier one step DARKER. Dark: each tier one step more luminous.
  let ordered = true;
  for (let i = 1; i < 5; i++) {
    const a = lum(scale[i - 1]);
    const b = lum(scale[i]);
    if (scheme === "light" ? !(b < a) : !(b > a)) ordered = false;
  }
  eq(`${scheme}: luminance steps ${scheme === "light" ? "down" : "up"} on every tier`, ordered, true);
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
if (fail > 0) process.exit(1);
