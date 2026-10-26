/**
 * H3: unrelated foods that shared a plate because a short keyword matched
 * inside another word ("hake" in "shake", "ham" in "chamomile"):
 *
 *   npx tsx scripts/foodEmoji.test.ts
 *
 * An optional first argument swaps the module under test (used to run this file
 * against the pre-fix table).
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void; argv: string[] };
declare const require: (id: string) => any;

import { SEED_FOODS } from "../lib/db/seed";

const target = process.argv[2] ?? "../lib/foodMeta";
const { emojiFor } = require(target) as typeof import("../lib/foodMeta");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

const catOf = (en: string): string => SEED_FOODS.find((f) => f.en === en)?.cat ?? "other";
const plate = (en: string): string => emojiFor(en, catOf(en));

const cases: [string, string][] = [
  ["Protein shake", "🥤"],
  ["Mascarpone", "🧀"],
  ["Chamomile tea", "🍵"],
  ["Champagne", "🍷"],
  ["Macchiato", "☕"],
  ["Chianti wine", "🍷"],
  ["Kombucha", "🍵"],
  ["Peppermint tea", "🍵"],
  ["Goat milk", "🍼"],
  ["Goat cheese", "🧀"],
  ["Goat meat", "🥩"],
  ["Pandoro", "🥐"],
  ["Shochu (Japanese distilled spirit)", "🥃"],
  ["Jambalaya", "🍛"],
  ["Cauliflower rice", "🥦"],
  ["Pearl barley (cooked)", "🌾"],
  ["Tagine", "🥘"],
  ["Ginger", "🌱"],
  ["Pain au chocolat", "🥐"],
  ["Corn dog", "🌭"],
  ["Green beans", "🫛"],
  ["Bean sprouts", "🌱"],
  ["Pumpkin seeds", "🌱"],
  // untouched neighbours of the new short-keyword guards
  ["Gingerbread cookie", "🍪"],
  ["Cauliflower", "🥦"],
  ["White beans", "🫘"],
  ["Hake", "🐟"],
  ["Carp", "🐟"],
  ["Ham", "🍖"],
  ["Oatmeal", "🥣"],
  ["Pizza", "🍕"],
  ["Jam", "🍯"],
  ["Peanut butter", "🫙"],
];
for (const [en, want] of cases) {
  const got = SEED_FOODS.some((f) => f.en === en) ? plate(en) : "(not in seed)";
  ok(`${en} -> ${want}`, got === want, `got ${got}`);
}

console.log(`foodEmoji: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
