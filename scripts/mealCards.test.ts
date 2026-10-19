/**
 * Pure helpers of the meal cards (components/meal/mealCards.ts):
 *
 *   npx tsx scripts/mealCards.test.ts
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  cardPortionState,
  chipA11yLabel,
  chipText,
  estimateAmountText,
  gramOpenAfterChip,
  searchBlockGroups,
  splitTotalLine,
  targetSharePct,
  visibleChips,
} from "../components/meal/mealCards";
import { buildPortionChips, chipGrams, type PortionChip } from "../lib/mealCompose";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

const LABELS: Record<string, string> = {
  "portion.slice": "Slice",
  "portion.cup": "Cup",
  "portion.portion": "Portion",
  "mealCompose.gramChip": "grams…",
  "common.grams": "g",
};
const t = (k: string) => LABELS[k] ?? k;
const fmt = (n: number) => String(n).replace(".", ",");

const chips = buildPortionChips(
  [
    { label_key: "slice", grams: 30 },
    { label_key: "cup", grams: 240 },
  ],
  "slice"
);

// visibleChips
ok("order: slice x1, x2, cup x1, grams", visibleChips(chips).map((c) => c.id).join() === "slice:1,slice:2,cup:1,grams");
ok("grams chip last", visibleChips(chips).at(-1)?.kind === "grams");
ok("at most 5", visibleChips([...chips, ...chips, ...chips, ...chips]).length <= 5);
const many: PortionChip[] = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`, kind: "measure", label_key: "piece", multiplier: 1, unit_g: 10 + i,
}));
ok("overlong list keeps the grams chip", visibleChips([...many, chips[chips.length - 1]]).at(-1)?.kind === "grams");
ok("overlong list is capped", visibleChips([...many, chips[chips.length - 1]]).length === 5);
ok("duplicate ids dropped", visibleChips([chips[0], chips[0]]).length === 1);
ok("empty list", visibleChips([]).length === 0);

// chip text
ok("measure text", chipText(chips[0], t, fmt) === "1 × Slice", chipText(chips[0], t, fmt));
ok("x2 text", chipText(chips[1], t, fmt) === "2 × Slice");
ok("grams text", chipText(chips[chips.length - 1], t, fmt) === "grams…");
ok("a11y has grams", chipA11yLabel(chips[1], t, fmt) === "2 × Slice, 60 g", chipA11yLabel(chips[1], t, fmt));
ok("a11y grams chip is plain", chipA11yLabel(chips[chips.length - 1], t, fmt) === "grams…");

// card: chips and the gram field are mutually exclusive
const closedMatch = cardPortionState(chips, 60, false);
ok("closed: chips shown, field hidden", closedMatch.showChips && !closedMatch.showGramField);
ok("closed: matching chip selected", closedMatch.selectedChipId === "slice:2", String(closedMatch.selectedChipId));
const closedOdd = cardPortionState(chips, 47, false);
ok("closed, odd grams -> grams chip selected", closedOdd.selectedChipId === "grams");
const open = cardPortionState(chips, 60, true);
ok("open: field shown, chips hidden", open.showGramField && !open.showChips);
ok("open: grams chip is the selected one", open.selectedChipId === "grams");
for (const g of [0, 30, 47, 60, 9999]) {
  for (const o of [true, false]) {
    const s = cardPortionState(chips, g, o);
    ok(`never both (g=${g}, open=${o})`, s.showChips !== s.showGramField);
  }
}
ok("no chips -> no selection", cardPortionState([], 50, false).selectedChipId === null);
ok("grams chip opens the field", gramOpenAfterChip(chips[chips.length - 1]));
ok("a measure chip closes the field", !gramOpenAfterChip(chips[0]));
ok("measure chip grams", chipGrams(chips[1]) === 60);

// total line / target share
ok("share rounds", targetSharePct(26.5, 200) === 13);
ok("no target -> null", targetSharePct(26.5, null) === null && targetSharePct(26.5, 0) === null && targetSharePct(26.5, NaN) === null);
ok("not capped, neutral", targetSharePct(300, 200) === 150);
ok("bad total -> 0", targetSharePct(NaN, 200) === 0 && targetSharePct(-5, 200) === 0);
const SLOT = "";
const en = splitTotalLine(`${SLOT} g carbohydrates`, SLOT);
ok("slot first", en.before === "" && en.after === " g carbohydrates");
const mid = splitTotalLine(`Total ${SLOT} g`, SLOT);
ok("slot in the middle", mid.before === "Total " && mid.after === " g");
ok("missing slot keeps the text", splitTotalLine("no slot", SLOT).after.includes("no slot"));

// estimate chip
ok("amount text", estimateAmountText(2, "slice", fmt) === "2 × slice");
ok("unit only", estimateAmountText(0, "slice", fmt) === "slice");
ok("quantity only", estimateAmountText(1.5, "", fmt) === "1,5");
ok("nothing", estimateAmountText(NaN, " ", fmt) === "-");

// search block
const f = (id: string) => ({ id });
const g1 = searchBlockGroups({ recents: [f("a"), f("b")], favorites: [f("b"), f("c")], starters: [f("s")] });
ok("favorite already in recents is listed once", g1.favorites.map((x) => x.id).join() === "c");
ok("starters hidden when recents exist", g1.starters.length === 0);
const g2 = searchBlockGroups({ recents: [], favorites: [f("c")], starters: [f("s")] });
ok("starters hidden when only favorites exist", g2.starters.length === 0 && g2.favorites.length === 1);
const g3 = searchBlockGroups({ recents: [], favorites: [], starters: [f("s1"), f("s2"), f("s3"), f("s4")] });
ok("starters shown when both empty, three at most", g3.starters.length === 3);
ok("a favorites list fully in recents leaves no starters", searchBlockGroups({ recents: [f("a")], favorites: [f("a")], starters: [f("s")] }).starters.length === 0);

console.log(`mealCards: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
