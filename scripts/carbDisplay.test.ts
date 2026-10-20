/**
 * Carbohydrate display layer: conversions, half-choice rounding, hide/less
 * rules, localized text.   npx tsx scripts/carbDisplay.test.ts
 */
import {
  carbChoiceDisplay,
  carbChoiceText,
  carbChoices,
  carbRegionNote,
  carbUnitGrams,
  isCarbDisplayMode,
  type CarbChoiceStrings,
} from "../lib/carbDisplay";
import { setActiveLang } from "../lib/lang";

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const LRI = "⁦";
const PDI = "⁩";
const strings: CarbChoiceStrings = {
  unit: "g",
  approx: (v) => `≈ ${v.n} × ${v.size} ${v.unit}`,
  less: (v) => `< ${v.n} × ${v.size} ${v.unit}`,
};

// conversions
eq("gram mode is null", carbChoices(60, "gram"), null);
eq("15 g: 60 g", carbChoices(60, "choice15"), 4);
eq("10 g: 60 g", carbChoices(60, "portion10"), 6);
eq("15 g: 22.5 g", carbChoices(22.5, "choice15"), 1.5);
eq("negative", carbChoices(-5, "choice15"), null);
eq("NaN", carbChoices(Number.NaN, "choice15"), null);
eq("Infinity", carbChoices(Number.POSITIVE_INFINITY, "portion10"), null);
eq("unit gram", carbUnitGrams("gram"), null);
eq("unit 15", carbUnitGrams("choice15"), 15);
eq("unit 10", carbUnitGrams("portion10"), 10);

// rounding to the nearest half
const kind = (g: number, m: "choice15" | "portion10") => {
  const d = carbChoiceDisplay(g, m);
  return d.kind === "none" ? "none" : `${d.kind}:${d.value}`;
};
eq("60 g / 15", kind(60, "choice15"), "approx:4");
eq("67 g / 15 = 4.47 -> 4.5", kind(67, "choice15"), "approx:4.5");
eq("63 g / 15 = 4.2 -> 4", kind(63, "choice15"), "approx:4");
eq("64 g / 15 = 4.27 -> 4.5", kind(64, "choice15"), "approx:4.5");
eq("3.75 g = exactly 0.25 -> 0.5", kind(3.75, "choice15"), "approx:0.5");
eq("3.7 g < 0.25 -> less", kind(3.7, "choice15"), "less:0.5");
eq("0 g hidden", kind(0, "choice15"), "none");
eq("0 g hidden 10", kind(0, "portion10"), "none");
eq("1 g less", kind(1, "portion10"), "less:0.5");
eq("2.4 g / 10 less", kind(2.4, "portion10"), "less:0.5");
eq("2.5 g / 10 = 0.25 approx", kind(2.5, "portion10"), "approx:0.5");
eq("big 1200 g / 15", kind(1200, "choice15"), "approx:80");
eq("big 1234.5 g / 10 = 123.45 -> 123.5", kind(1234.5, "portion10"), "approx:123.5");
eq("gram mode none", carbChoiceDisplay(60, "gram").kind, "none");
eq("negative none", carbChoiceDisplay(-3, "choice15").kind, "none");
eq("NaN none", carbChoiceDisplay(Number.NaN, "portion10").kind, "none");

// text, locale number format, LTR isolation
setActiveLang("en");
eq("en 60 g", carbChoiceText(60, "choice15", strings), `${LRI}≈ 4 × 15 g${PDI}`);
eq("en 67 g", carbChoiceText(67, "choice15", strings), `${LRI}≈ 4.5 × 15 g${PDI}`);
eq("en 10 g portions", carbChoiceText(45, "portion10", strings), `${LRI}≈ 4.5 × 10 g${PDI}`);
eq("en less", carbChoiceText(2, "choice15", strings), `${LRI}< 0.5 × 15 g${PDI}`);
eq("en zero", carbChoiceText(0, "choice15", strings), null);
eq("en gram mode", carbChoiceText(60, "gram", strings), null);
setActiveLang("tr");
eq("tr 67 g", carbChoiceText(67, "choice15", strings), `${LRI}≈ 4,5 × 15 g${PDI}`);
eq("tr less", carbChoiceText(2, "portion10", strings), `${LRI}< 0,5 × 10 g${PDI}`);
setActiveLang("de");
eq("de 1200 g grouped", carbChoiceText(15000, "choice15", strings), `${LRI}≈ 1.000 × 15 g${PDI}`);
setActiveLang("en");

// mode guard + region note (information only)
eq("mode ok", isCarbDisplayMode("portion10"), true);
eq("mode bad", isCarbDisplayMode("exchange"), false);
eq("mode null", isCarbDisplayMode(null), false);
eq("note en-US", carbRegionNote("en", "US"), "us");
eq("note en-GB lower", carbRegionNote("en", "gb"), "gb");
eq("note en-CA none", carbRegionNote("en", "CA"), null);
eq("note tr-US none", carbRegionNote("tr", "US"), null);
eq("note no region", carbRegionNote("en", null), null);

if (failed) {
  console.log(`carbDisplay: ${failed} failed`);
  process.exit(1);
}
console.log("carbDisplay: all passed");
