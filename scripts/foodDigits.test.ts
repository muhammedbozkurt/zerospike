/**
 * G22: Eastern Arabic and Persian digits in gram / ounce / carb fields:
 *
 *   npx tsx scripts/foodDigits.test.ts
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (id: string) => any;

import { parseGramsInput } from "../lib/mealCompose";
import { parseOzInput } from "../lib/portionUnits";
import type { EditableItem } from "../lib/ai/carbEstimateClient";

// carbEstimateClient imports Expo modules; same stand-ins as carbEstimate.test.ts.
const nodeModule = require("module");
const stubs: Record<string, unknown> = {
  "expo-constants": { __esModule: true, default: { expoConfig: { extra: {} } } },
  "expo/fetch": { fetch: async () => undefined },
  "@react-native-async-storage/async-storage": {
    __esModule: true,
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  },
  "expo-crypto": { getRandomBytes: (n: number) => new Uint8Array(n).fill(7) },
};
const realLoad = nodeModule._load;
nodeModule._load = function (request: string, ...rest: unknown[]) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.call(this, request, ...rest);
};
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
const { canAddEstimate, editableGrams, editableToEstimateLines, hasUnreadableAmount } =
  require("../lib/ai/carbEstimateClient") as typeof import("../lib/ai/carbEstimateClient");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

ok("arabic-indic grams", parseGramsInput("١٢") === 12, String(parseGramsInput("١٢")));
ok("persian grams", parseGramsInput("۱۲۵") === 125, String(parseGramsInput("۱۲۵")));
ok("arabic decimal separator", parseGramsInput("١٢٫٥") === 12.5, String(parseGramsInput("١٢٫٥")));
ok("arabic digits with comma", parseGramsInput("١٢,٥") === 12.5);
ok("latin comma decimal still works", parseGramsInput("12,5") === 12.5);
ok("empty is 0", parseGramsInput("") === 0);
ok("junk is 0", parseGramsInput("abc") === 0);
ok("negative stays 0", parseGramsInput("-5") === 0);
ok("capped", parseGramsInput("999999") === 9999);
ok("rounds", parseGramsInput("10.04") === 10);

ok("arabic oz", parseOzInput("١,٥") === 42.5, String(parseOzInput("١,٥")));
ok("persian oz", parseOzInput("۲") === 56.7, String(parseOzInput("۲")));
ok("oz latin unchanged", parseOzInput("1.5") === 42.5);
ok("oz junk 0", parseOzInput("abc") === 0 && parseOzInput("") === 0 && parseOzInput("-2") === 0);
ok("oz capped", parseOzInput("99999") === 9999);

const line = (over: Partial<EditableItem>): EditableItem => ({
  key: "ce0",
  name: "Rice",
  quantityText: "1",
  unit: "cup",
  gramsText: "45",
  ...over,
});

ok("estimate grams from arabic digits", editableGrams(line({ gramsText: "٤٥" })) === 45);
ok(
  "estimate line carries arabic quantity",
  editableToEstimateLines([line({ quantityText: "٢", gramsText: "٣٠" })])[0].quantity === 2
);
ok("readable amount", hasUnreadableAmount(line({ gramsText: "٤٥" })) === false);
ok("empty amount is a deliberate 0", hasUnreadableAmount(line({ gramsText: "" })) === false);
ok("separator only is unreadable", hasUnreadableAmount(line({ gramsText: "," })) === true);
ok("letters only is unreadable", hasUnreadableAmount(line({ gramsText: "abc" })) === true);
ok("unreadable quantity counts", hasUnreadableAmount(line({ quantityText: "." })) === true);
ok(
  "unreadable amount blocks add",
  canAddEstimate({ resultShown: true, items: [line({ gramsText: "x" })], saving: false }) === false
);
ok(
  "readable amount allows add",
  canAddEstimate({ resultShown: true, items: [line({ gramsText: "٤٥" })], saving: false }) === true
);

// Opus3 fix-b: one rule for grouped thousands and signs in gram fields.
ok("grams 1.500 is unreadable", parseGramsInput("1.500") === 0);
ok("grams 1,500 is unreadable", parseGramsInput("1,500") === 0);
ok("grams arabic grouped is unreadable", parseGramsInput("١٬٥٠٠") === 0);
ok("grams arabic decimal 3 digits is unreadable", parseGramsInput("١٫٥٠٠") === 0);
ok("grams 1.5 and 1,50 still read", parseGramsInput("1.5") === 1.5 && parseGramsInput("1,50") === 1.5);
ok("grams 1500 plain still reads", parseGramsInput("1500") === 1500);
ok("grams 12,34 reads", parseGramsInput("12,34") === 12.3);
ok("unreadable 1.500", hasUnreadableAmount(line({ gramsText: "1.500" })) === true);
ok("unreadable 1,500", hasUnreadableAmount(line({ gramsText: "1,500" })) === true);
ok("unreadable arabic grouped", hasUnreadableAmount(line({ gramsText: "١٬٥٠٠" })) === true);
ok("1,5 stays readable", hasUnreadableAmount(line({ gramsText: "1,5" })) === false);
for (const noisy of ["1.500g", "1.500 g", "1,500 gr", "١٫٥٠٠ غ"]) {
  ok(`grams ${JSON.stringify(noisy)} is unreadable`, parseGramsInput(noisy) === 0);
  ok(`grams ${JSON.stringify(noisy)} is flagged unreadable`, hasUnreadableAmount(line({ gramsText: noisy })) === true);
}
for (const [txt, want] of [["1,5", 1.5], ["12,25", 12.3], ["0,5", 0.5], ["١٫٥", 1.5], ["1,5g", 1.5], ["12 g", 12]] as [string, number][]) {
  ok(`grams ${JSON.stringify(txt)} still reads ${want}`, parseGramsInput(txt) === want);
}
for (const signed of ["-5", "\u200F-5", "\u22125", "+5", "\u20135"]) {
  ok(`signed grams ${JSON.stringify(signed)} is 0`, parseGramsInput(signed) === 0);
  ok(`signed grams ${JSON.stringify(signed)} is unreadable`, hasUnreadableAmount(line({ gramsText: signed })) === true);
  ok(`signed quantity ${JSON.stringify(signed)} is unreadable`, hasUnreadableAmount(line({ quantityText: signed })) === true);
}

console.log(`foodDigits: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
