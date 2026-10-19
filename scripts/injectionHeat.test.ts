/**
 * lib/injectionHeat.ts harness: the absolute four-tier scale (0, 1-2, 3-5, 6+)
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

const boundaries: Array<[number, number]> = [
  [0, 0],
  [1, 1],
  [2, 1],
  [3, 2],
  [5, 2],
  [6, 3],
  [7, 3],
  [40, 3],
];
for (const [count, tier] of boundaries) eq(`count ${count} is tier ${tier}`, heatTierForCount(count), tier);

eq("negative count is tier 0", heatTierForCount(-3), 0);
eq("NaN is tier 0", heatTierForCount(NaN), 0);

eq("tier thresholds", HEAT_TIER_MIN.join(","), "0,1,3,6");
eq("legend labels", HEAT_TIER_LABELS.join("|"), "0|1-2|3-5|6+");

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

// Four points of one region, each coloured by its own count.
const pointCounts = [0, 1, 3, 6];
const pointTiers = pointCounts.map(heatTierForCount);
eq("four points get four tiers", pointTiers.join(","), "0,1,2,3");

for (const scheme of ["light", "dark"] as const) {
  const ramp = PALETTES[scheme].heatRamp;
  const colors = pointTiers.map((t) => ramp[t]);
  eq(`${scheme}: one recorded point differs from an empty one`, colors[1] !== colors[0], true);
  eq(`${scheme}: all four tier colours differ`, new Set(colors).size, 4);
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
if (fail > 0) process.exit(1);
