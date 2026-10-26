/**
 * components/NumericField and the rules behind it (lib/numericField.ts), the
 * glucose offer (lib/glucoseSuggestion.ts) and how the screens use them.
 *
 * Run: npx tsx scripts/numericField.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
declare function require(id: string): any;

import {
  BASAL_DAILY_BOUNDS,
  DOSE_BOUNDS,
  GLUCOSE_ENTRY_BOUNDS,
  INJECTION_DOSE_BOUNDS,
  editableMax,
  fieldShowsValue,
  filterNumericText,
  glucoseEntryBounds,
  numericError,
  numericValid,
  readNumeric,
  readNumericInput,
  stepAllowed,
  stepIsBlocked,
  stepNumeric,
} from "../lib/numericField";
import { CARB_RATIO_BOUNDS, ISF_BOUNDS } from "../lib/calcSetup";
import { hasDecimalSeparator, parseWholeText, sanitizeWholeText } from "../lib/numberInput";
import { createConfirmGate } from "../lib/ratioWriter";
import { glucoseFromDisplay, glucoseToDisplay } from "../lib/glucose";
import {
  RECENT_GLUCOSE_WINDOW_MINUTES,
  fieldIsOffer,
  offerExpiresInMs,
  recentGlucoseSuggestion,
} from "../lib/glucoseSuggestion";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const fs = require("fs");
const nodePath = require("path");
const ROOT = nodePath.join(__dirname, "..");
const src = (rel: string): string => fs.readFileSync(nodePath.join(ROOT, rel), "utf8");

section("1. text: digits and one separator, comma and dot read the same");
{
  eq("letters are dropped", filterNumericText("12abc", 1), "12");
  eq("only letters leave it empty", filterNumericText("abc", 1), "");
  eq("a comma stays a comma", filterNumericText("7,5", 1), "7,5");
  eq("a dot stays a dot", filterNumericText("7.5", 1), "7.5");
  eq("a second separator is dropped, the digits stay", filterNumericText("7.5.5", 2), "7.55");
  eq("a comma after a dot is dropped too", filterNumericText("7.5,5", 1), "7.5");
  eq("decimals are cut to the field's places", filterNumericText("7.55", 1), "7.5");
  eq("an integer field keeps the separator on screen", filterNumericText("7.5", 0), "7.5");
  eq("ISF mg/dL 45,5 stays 45,5", filterNumericText("45,5", 0), "45,5");
  eq("glucose mg/dL 5,5 stays 5,5", filterNumericText("5,5", 0), "5,5");
  eq("12.0 stays 12.0", filterNumericText("12.0", 0), "12.0");
  eq("7.5.5 in a whole-number field keeps both", filterNumericText("7.5.5", 0), "7.5.5");
  eq("a leading separator stays", filterNumericText(",5", 0), ",5");
  eq("minus signs and spaces are dropped", filterNumericText("-1 2", 0), "12");
  eq("Arabic-Indic digits become Latin", filterNumericText("١٢٣", 0), "123");
  const b = { min: 1, max: 100, decimals: 1 };
  eq("7,5 reads as 7.5", readNumeric("7,5", b).value, 7.5);
  eq("7.5 reads as 7.5", readNumeric("7.5", b).value, 7.5);
  eq("the Arabic decimal mark reads too", readNumeric("7٫5", b).value, 7.5);
  eq("empty is empty", readNumeric("", b).kind, "empty");
  eq("empty carries no value", readNumeric("", b).value, null);
  eq("a lone separator is empty", readNumeric(",", b).kind, "empty");
}

section("2. bounds: outside is refused, never clamped into a value");
{
  const carb = { ...CARB_RATIO_BOUNDS, decimals: 1 };
  eq("carb ratio min is 1", CARB_RATIO_BOUNDS.min, 1);
  eq("carb ratio max is 100", CARB_RATIO_BOUNDS.max, 100);
  eq("1 is accepted", readNumeric("1", carb).value, 1);
  eq("100 is accepted", readNumeric("100", carb).value, 100);
  eq("0.5 is below", readNumeric("0.5", carb).kind, "below");
  eq("0.5 commits nothing", readNumeric("0.5", carb).value, null);
  eq("101 is above", readNumeric("101", carb).kind, "above");
  eq("101 commits nothing", readNumeric("101", carb).value, null);

  eq("ISF mg/dL min is 1", ISF_BOUNDS.mgdl.min, 1);
  eq("ISF mg/dL max is 500", ISF_BOUNDS.mgdl.max, 500);
  eq("ISF mmol min is 0.1", ISF_BOUNDS.mmol.min, 0.1);
  eq("ISF mmol max is 27.7 (500 mg/dL is the ceiling, 27.8 would be 501)", ISF_BOUNDS.mmol.max, 27.7);
  ok("the mmol ceiling converts to at most 500 mg/dL", glucoseFromDisplay(ISF_BOUNDS.mmol.max, "mmol") <= ISF_BOUNDS.mgdl.max);
  ok("a stored 500 mg/dL shows inside the mmol bounds", glucoseToDisplay(500, "mmol") <= 27.8 && glucoseToDisplay(500, "mmol") >= 27.7);
  eq("ISF 500 accepted", readNumeric("500", { ...ISF_BOUNDS.mgdl, decimals: 0 }).value, 500);
  eq("ISF 501 refused", readNumeric("501", { ...ISF_BOUNDS.mgdl, decimals: 0 }).value, null);
  eq("ISF 0 refused", readNumeric("0", { ...ISF_BOUNDS.mgdl, decimals: 0 }).value, null);
  eq("ISF 27.8 mmol refused", readNumeric("27.8", { ...ISF_BOUNDS.mmol, decimals: 1 }).value, null);
  eq("ISF 0.1 mmol accepted", readNumeric("0.1", { ...ISF_BOUNDS.mmol, decimals: 1 }).value, 0.1);

  eq("dose min is 0", DOSE_BOUNDS.min, 0);
  eq("dose max is 100", DOSE_BOUNDS.max, 100);
  eq("dose step is 0.5", DOSE_BOUNDS.step, 0.5);
  const dose = { min: DOSE_BOUNDS.min, max: DOSE_BOUNDS.max, decimals: DOSE_BOUNDS.decimals };
  eq("0 units is a real value", readNumeric("0", dose).value, 0);
  eq("4,25 units kept exactly", readNumeric("4,25", dose).value, 4.25);
  eq("100 accepted", readNumeric("100", dose).value, 100);
  eq("100.5 refused", readNumeric("100.5", dose).kind, "above");

  eq("glucose mg/dL min", GLUCOSE_ENTRY_BOUNDS.mgdl.min, 20);
  eq("glucose mg/dL max", GLUCOSE_ENTRY_BOUNDS.mgdl.max, 600);
  eq("glucose mmol min", GLUCOSE_ENTRY_BOUNDS.mmol.min, 1.1);
  eq("glucose mmol max", GLUCOSE_ENTRY_BOUNDS.mmol.max, 33.3);
  eq("1.1 mmol/L is 20 mg/dL", glucoseFromDisplay(1.1, "mmol"), 20);
  eq("33.3 mmol/L is 600 mg/dL", glucoseFromDisplay(33.3, "mmol"), 600);
  const gm = glucoseEntryBounds("mgdl");
  const gl = glucoseEntryBounds("mmol");
  eq("19 mg/dL refused", readNumeric("19", gm).value, null);
  eq("20 mg/dL accepted", readNumeric("20", gm).value, 20);
  eq("600 mg/dL accepted", readNumeric("600", gm).value, 600);
  eq("601 mg/dL refused", readNumeric("601", gm).value, null);
  eq("1.0 mmol/L refused", readNumeric("1.0", gl).value, null);
  eq("1,1 mmol/L accepted", readNumeric("1,1", gl).value, 1.1);
  eq("33,3 mmol/L accepted", readNumeric("33,3", gl).value, 33.3);
  eq("33.4 mmol/L refused", readNumeric("33.4", gl).value, null);
}

section("3. error text: when it shows, and which one");
{
  eq("above shows the moment it is typed", numericError("above", { blurred: false, required: false }), "above");
  eq("below waits for the field to be left", numericError("below", { blurred: false, required: false }), null);
  eq("below shows once it is left", numericError("below", { blurred: true, required: false }), "below");
  eq("a good value shows nothing", numericError("ok", { blurred: true, required: true }), null);
  eq("optional empty shows nothing", numericError("empty", { blurred: true, required: false }), null);
  eq("required empty shows once it is left", numericError("empty", { blurred: true, required: true }), "required");
  eq("required empty while typing shows nothing", numericError("empty", { blurred: false, required: true }), null);
  eq("ok is valid", numericValid("ok", true), true);
  eq("optional empty is valid", numericValid("empty", false), true);
  eq("required empty is not valid", numericValid("empty", true), false);
  eq("below is not valid", numericValid("below", false), false);
  eq("above is not valid", numericValid("above", false), false);
}

section("4. - / + presses: step, clamp, and never fill by themselves");
{
  const dose = { ...DOSE_BOUNDS };
  eq("dose + from 4 is 4.5", stepNumeric(4, 1, dose), 4.5);
  eq("dose - from 4 is 3.5", stepNumeric(4, -1, dose), 3.5);
  eq("dose - stops at 0", stepNumeric(0.5, -1, dose), 0);
  eq("dose - at 0 stays 0", stepNumeric(0, -1, dose), 0);
  eq("dose + stops at 100", stepNumeric(100, 1, dose), 100);
  eq("empty + lands on one step (0.5)", stepNumeric(null, 1, dose), 0.5);
  eq("empty - leaves it empty", stepNumeric(null, -1, dose), null);
  eq("floating point does not leak (0.1 + 0.2 style)", stepNumeric(0.3, 1, { step: 0.1, decimals: 1, min: 0, max: 5 }), 0.4);
  const carb = { step: 0.5, decimals: 1, ...CARB_RATIO_BOUNDS };
  eq("carb ratio + steps by 0.5", stepNumeric(10, 1, carb), 10.5);
  eq("carb ratio - stops at 1", stepNumeric(1, -1, carb), 1);
  eq("carb ratio empty + starts at the minimum", stepNumeric(null, 1, carb), 1);
  const isf = { step: 1, decimals: 0, ...ISF_BOUNDS.mgdl };
  eq("ISF + steps by 1 mg/dL", stepNumeric(50, 1, isf), 51);
  eq("ISF empty + starts at the minimum", stepNumeric(null, 1, isf), 1);
  const isfMmol = { step: 0.1, decimals: 1, ...ISF_BOUNDS.mmol };
  eq("ISF mmol + steps by 0.1", stepNumeric(2.2, 1, isfMmol), 2.3);
  eq("ISF mmol empty + starts at the minimum", stepNumeric(null, 1, isfMmol), 0.1);
  eq("ISF mmol top stops at 27.7", stepNumeric(27.7, 1, isfMmol), 27.7);
  eq("a blocked press is detected at the top", stepIsBlocked(100, 1, dose), true);
  eq("and at the bottom", stepIsBlocked(0, -1, dose), true);
  eq("an empty field blocks -", stepIsBlocked(null, -1, dose), true);
  eq("an empty field allows +", stepIsBlocked(null, 1, dose), false);
  eq("a middle value blocks nothing", stepIsBlocked(4, 1, dose), false);
  // Every tenth of a mmol/L ISF maps to its own mg/dL value and back.
  let stable = true;
  for (let t = 1; t <= 277; t++) {
    const shown = t / 10;
    if (glucoseToDisplay(glucoseFromDisplay(shown, "mmol"), "mmol") !== shown) stable = false;
  }
  ok("0.1-27.7 mmol/L each survive the mg/dL round trip as shown", stable);
}

section("5. the glucose offer: 15 minutes, offered not applied");
{
  const now = new Date("2026-10-21T14:00:00.000Z");
  const at = (minAgo: number, extraSec = 0) =>
    new Date(now.getTime() - minAgo * 60_000 - extraSec * 1000).toISOString();
  eq("the window is 15 minutes", RECENT_GLUCOSE_WINDOW_MINUTES, 15);
  eq("14:59 ago is offered", recentGlucoseSuggestion([{ glucose_level_mgdl: 110, logged_at: at(14, 59) }], now)?.mgdl, 110);
  eq("exactly 15:00 ago is still offered", recentGlucoseSuggestion([{ glucose_level_mgdl: 110, logged_at: at(15) }], now)?.mgdl, 110);
  eq("15:01 ago is not", recentGlucoseSuggestion([{ glucose_level_mgdl: 110, logged_at: at(15, 1) }], now), null);
  eq("an hour ago is not", recentGlucoseSuggestion([{ glucose_level_mgdl: 110, logged_at: at(60) }], now), null);
  eq("a reading from right now is offered", recentGlucoseSuggestion([{ glucose_level_mgdl: 95, logged_at: at(0) }], now)?.mgdl, 95);
  eq("a future-dated reading is not offered", recentGlucoseSuggestion([{ glucose_level_mgdl: 95, logged_at: at(-5) }], now), null);
  eq("no logs, no offer", recentGlucoseSuggestion([], now), null);
  eq("null logs, no offer", recentGlucoseSuggestion(null, now), null);
  eq("the newest of several wins", recentGlucoseSuggestion([
    { glucose_level_mgdl: 100, logged_at: at(10) },
    { glucose_level_mgdl: 120, logged_at: at(2) },
    { glucose_level_mgdl: 90, logged_at: at(6) },
  ], now)?.mgdl, 120);
  eq("an old one is skipped for an in-window one", recentGlucoseSuggestion([
    { glucose_level_mgdl: 200, logged_at: at(30) },
    { glucose_level_mgdl: 120, logged_at: at(5) },
  ], now)?.mgdl, 120);
  eq("a reading the field could not hold is not offered (19)", recentGlucoseSuggestion([{ glucose_level_mgdl: 19, logged_at: at(1) }], now), null);
  eq("nor 601", recentGlucoseSuggestion([{ glucose_level_mgdl: 601, logged_at: at(1) }], now), null);
  eq("an unreadable timestamp is skipped", recentGlucoseSuggestion([{ glucose_level_mgdl: 100, logged_at: "nope" }], now), null);
}

section("6. screens: the shared field, and the offer is never applied by itself");
{
  const calc = src("app/calculator.tsx");
  const field = src("components/NumericField.tsx");
  const logic = src("lib/numericField.ts");

  ok("the field asks for a numeric keyboard (decimal-pad / number-pad)", field.includes('"decimal-pad"') && field.includes('"number-pad"'));
  ok("never the punctuation keyboard", !field.includes("numbers-and-punctuation"));
  ok("no auto-shrinking text", !/adjustsFontSizeToFit/.test(field));
  ok("the buttons are named (decrease / increase) with the field label", field.includes('t("common.decrease")') && field.includes('t("common.increase")'));
  ok("the buttons and the field read the value and unit", (field.match(/accessibilityValue=\{\{ text: valueText \}\}/g) ?? []).length >= 2 && field.includes("`${text} ${suffix}`"));
  ok("the field has a hint that carries the error", field.includes("accessibilityHint={hint}") && field.includes("const hint = errorText"));
  ok("the error is announced", field.includes('accessibilityRole="alert"'));
  ok("the range message names both bounds", field.includes('t("numeric.range"'));
  ok("the unit sits at the end (suffix after the input)", field.indexOf("<TextInput") < field.indexOf("{suffix ? ("));
  ok("it fills itself with nothing", !/onChange\(\s*(min|max|step)\b/.test(field));
  ok("the logic is free of React", !/from "react/.test(logic));

  ok("glucose uses the shared field", /function glucoseCard\(\)[\s\S]{0,2200}<NumericField/.test(calc));
  ok("glucose bounds come from the shared table", calc.includes("glucoseSheetBounds(unit)"));
  ok("glucose placeholders exist for both units", calc.includes("numeric.glucoseExampleMmol") && calc.includes("numeric.glucoseExampleMgdl"));
  ok("the field is the only thing the calculation reads: glucose starts empty", calc.includes('const [glucose, setGlucose] = useState("");'));
  ok("the offer is read from the pure function", calc.includes("recentGlucoseSuggestion("));
  const setGlucoseCalls = calc.match(/setGlucose\([^;]*;/g) ?? [];
  const tapIdx = calc.indexOf("function useOfferedGlucose()");
  const tapBody = calc.slice(tapIdx, calc.indexOf("\n  }\n", tapIdx));
  ok("the offer reaches the field only inside the tap handler", tapBody.includes("setGlucose(String(glucoseToDisplay(offer.mgdl, unit)))"));
  ok(
    "no other place writes the offered value into the field",
    setGlucoseCalls.every((c) => !/offer|latestReading/.test(c) || tapBody.includes(c)),
    setGlucoseCalls.join(" | ")
  );
  ok("the calculation reads the typed glucose, not the offer", /const glucoseTyped = useMemo\(\(\) => parseDecimalText\(glucose\)/.test(calc) && !/glucoseMgdl[^;]*latestReading/.test(calc));
  ok("the offer is for a new record only", calc.includes("!isEdit && glucose === \"\"") && calc.includes("if (isEdit || !activeProfile) return;"));
  ok("the offer is tappable, labelled, and says what it will do", calc.includes('t("calculator.glucoseOffer"') && calc.includes('onPress={useOfferedGlucose}'));
  ok("save waits for a valid glucose and dose", calc.includes('stepperFields.reporter("glucose")') && calc.includes('stepperFields.reporter("dose")'));
  ok("the portion is the shared field too", !calc.includes("<Stepper") && calc.split('stepperFields.reporter("portion")').length === 2);

  const ratio = src("components/RatioInput.tsx");
  ok("the ratio inputs are NumericField presets", ratio.includes("<NumericField"));
  ok("carb ratio steps by 0.5", /step=\{0\.5\}/.test(ratio));
  ok("ISF steps by 1 mg/dL or 0.1 mmol/L", /step=\{mmol \? 0\.1 : 1\}/.test(ratio));

  const prof = src("app/settings/profile.tsx");
  const setup = src("app/profile-setup.tsx");
  ok("Profile and Targets uses the presets", prof.includes("<CarbRatioInput") && prof.includes("<IsfInput"));
  ok("the profile editor uses the presets", setup.includes("<CarbRatioInput") && setup.includes("<IsfInput"));
  ok("Profile's basal dose is the shared field", prof.includes("<NumericField") && !prof.includes("<Stepper"));
  ok("no screen of ours keeps the old ratio input", !/<RatioInput\b/.test(calc + prof + setup));
}

section("7. coming back from the ratios: the record stays open");
{
  const line = src("components/CarbRatioLine.tsx");
  const prof = src("app/settings/profile.tsx");
  const calc = src("app/calculator.tsx");
  ok("the calculator's line sends a return marker to Profile", line.includes('params: { returnTo: "calculator" }') && line.includes("returnAfterConfirm"));
  ok("other screens' lines are unchanged (plain push)", line.includes(': "/settings/profile"'));
  ok("Profile goes back only after a confirmation that was written, once, through the gate", /createConfirmGate\(\{[\s\S]{0,500}onConfirmed: \(\) => \{[\s\S]{0,200}to === "calculator" && r\.canGoBack\(\)\) r\.back\(\)/.test(prof) && prof.includes("onBusy: setConfirming"));
  ok("going back is a pop, so the open record keeps its state", !/router\.(replace|push)\([^)]*calculator/.test(prof));
  ok("the sheet closes onto the same screen after its own confirmation", /onConfirmed=\{\(\) => \{\s*setSetupOpen\(false\);/.test(calc));
  ok("the sheet never resets the form it sits on", !/setPortion\(|setGlucose\(|setSlot\(/.test(calc.slice(calc.indexOf("function CalcSetupSheet("), calc.indexOf("function PendingDoseCard("))));
  ok("Profile follows what the sheet stored until the user edits there", prof.includes("storedRatiosKey") && prof.includes("ratioTouchedRef.current"));
}

section("8. the new strings exist in all nine languages");
{
  const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  const keysNumeric = ["range", "required", "carbRatioExample", "isfExampleMgdl", "isfExampleMmol", "glucoseExampleMgdl", "glucoseExampleMmol"];
  for (const l of langs) {
    const s = src(`lib/i18n/locales/${l}.ts`);
    const block = s.slice(s.indexOf("\n  numeric: {"), s.indexOf("\n  ratio: {"));
    for (const k of keysNumeric) ok(`${l}: numeric.${k}`, new RegExp(`\\n    ${k}: "[^"]+"`).test(block));
    ok(`${l}: numeric.range names min, max and unit`, block.includes("{{min}}") && block.includes("{{max}}") && block.includes("{{unit}}"));
    ok(`${l}: calculator.pending`, /\n    pending: "[^"]+"/.test(s));
    ok(`${l}: calculator.glucoseOffer`, /\n    glucoseOffer: "[^"]*\{\{value\}\}[^"]*\{\{unit\}\}[^"]*"/.test(s));
    ok(`${l}: calculator.setup.hint`, /\n      hint: "[^"]+"/.test(s));
    ok(`${l}: decrease / increase exist`, /\n    decrease: "[^"]+"/.test(s) && /\n    increase: "[^"]+"/.test(s));
    ok(`${l}: no em dash in the new text`, !/—/.test(block));
  }
  ok("tr pending is the agreed text", src("lib/i18n/locales/tr.ts").includes('pending: "Onay bekliyor"'));
  ok("tr hint is the agreed text", src("lib/i18n/locales/tr.ts").includes('hint: "İşaretleyince hesaplanan toplam görünür"'));
  ok("tr offer is the agreed text", src("lib/i18n/locales/tr.ts").includes("Son ölçüm {{value}} {{unit}}, kullanmak için dokunun"));
  ok("de uses Sie in the range text", src("lib/i18n/locales/de.ts").includes("Geben Sie einen Wert"));
}

section("9. geometry: the field's width budget in every language");
{
  // The row is [- 44pt] [input, flex] [unit, up to 38%] [+ 44pt] inside a border.
  // 18pt bold text: about 10.5pt a number, 9pt a Latin letter, 18pt a CJK glyph.
  const BUTTON = 44;
  const INPUT_PAD = 16;
  const BORDER = 2;
  const glyph = (ch: string): number =>
    /[0-9]/.test(ch) ? 10.5 : /[\u3000-\u9fff]/.test(ch) ? 18 : ch === " " ? 5 : 9;
  const textW = (t: string): number => [...t].reduce((n, ch) => n + glyph(ch), 0);
  const suffixW = (t: string): number => [...t].reduce((n, ch) => n + (/[\u3000-\u9fff]/.test(ch) ? 12 : 7), 0);
  const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  const pick = (s: string, re: RegExp): string => (s.match(re) ?? ["", ""])[1];
  const PHONE_CONTENT = 288; // a 320pt phone minus 16pt gutters
  const SHEET_TABLET = 560;
  let worst = 0;
  for (const l of langs) {
    const s = src(`lib/i18n/locales/${l}.ts`);
    const block = s.slice(s.indexOf("\n  numeric: {"), s.indexOf("\n  ratio: {"));
    const ph = ["carbRatioExample", "isfExampleMgdl", "isfExampleMmol", "glucoseExampleMgdl", "glucoseExampleMmol"].map((k) => pick(block, new RegExp(`${k}: "([^"]+)"`)));
    const carbUnit = pick(s, /\n    carbRatioUnit: "([^"]+)"/);
    const need = (placeholder: string, suffix: string, stepper: boolean): number =>
      BORDER + (stepper ? 2 * BUTTON : 0) + suffixW(suffix) + INPUT_PAD + textW(placeholder);
    const rows: [string, number][] = [
      [`${l} carb ratio (stepper, ${carbUnit})`, need(ph[0], carbUnit, true)],
      [`${l} ISF mg/dL (stepper)`, need(ph[1], "mg/dL", true)],
      [`${l} ISF mmol/L (stepper)`, need(ph[2], "mmol/L", true)],
      [`${l} glucose mg/dL`, need(ph[3], "mg/dL", false)],
      [`${l} glucose mmol/L`, need(ph[4], "mmol/L", false)],
    ];
    for (const [name, w] of rows) {
      worst = Math.max(worst, w);
      ok(`${name}: needs ${Math.round(w)}pt, has ${PHONE_CONTENT}pt`, w <= PHONE_CONTENT);
    }
    const unitsLabel = pick(s, /\n    units: "([^"]+)"/);
    const unitsW = suffixW(unitsLabel) + 2 * BUTTON + INPUT_PAD + BORDER + textW("100");
    ok(`${l} dose (stepper, ${unitsLabel}): needs ${Math.round(unitsW)}pt`, unitsW <= PHONE_CONTENT);
    ok(`${l} the unit label fits its cap (${unitsLabel})`, suffixW(unitsLabel) <= PHONE_CONTENT * 0.38);
  }
  ok(`the widest need (${Math.round(worst)}pt) fits a 560pt tablet sheet with room to spare`, worst < SHEET_TABLET / 2);
  const field = src("components/NumericField.tsx");
  ok("the unit is capped at 38% so it can never push the number out", field.includes('maxWidth: "38%"'));
  ok("the input may shrink (minWidth 0) instead of overflowing", /flex: 1,\s*minWidth: 0/.test(field));
  ok("the box clips instead of overflowing", field.includes('overflow: "hidden"'));
  ok("touch targets are 44pt", field.includes("width: HIT_TARGET") && field.includes("minHeight: HIT_TARGET"));
  const calc = src("app/calculator.tsx");
  ok("the sheet caps its fields at 360pt so a tablet sheet does not stretch them", calc.includes("maxWidth: 360"));
}

section("10. outside values reach a focused box; pastes are refused, not rewritten");
{
  const b = { min: 20, max: 600, decimals: 0 };
  // O1: the box holds "50", a chip sets 200 from outside
  const typed = readNumericInput("50", "5", { min: 0, max: 1500, decimals: 0 });
  eq("typed 50 reads 50", typed.value, 50);
  ok("the parent echoing 50 back is the box's own value", fieldShowsValue(typed, 50));
  ok("a chip setting 200 is NOT the box's value, so the text must change", !fieldShowsValue(typed, 200));
  const empty = readNumericInput("", "1", b);
  ok("an empty box shows a null value", fieldShowsValue(empty, null));
  ok("an offer setting 110 on an empty box must replace the text", !fieldShowsValue(empty, 110));
  const below = readNumericInput("1", "", b);
  eq("a '1' on the way to 110 is below, no value", below.kind, "below");
  ok("and null echoes it", fieldShowsValue(below, null));
  ok("an offer of 110 over that '1' replaces it", !fieldShowsValue(below, 110));

  // paste / replace: refused, with the text kept visible
  const gl = { min: 1, max: 100, decimals: 1 };
  eq("pasted -3 is malformed, not 3", readNumeric("-3", gl).kind, "malformed");
  eq("pasted -3 commits nothing", readNumeric("-3", gl).value, null);
  eq("pasted 1e2 is malformed, not 12", readNumeric("1e2", gl).kind, "malformed");
  eq("pasted 7.5.5 is malformed, not 7.55", readNumeric("7.5.5", { min: 1, max: 100, decimals: 2 }).kind, "malformed");
  eq("pasted 7.55 into a one-decimal box is refused, not cut", readNumeric("7.55", gl).kind, "malformed");
  eq("a plain pasted 7,5 is fine", readNumeric("7,5", gl).value, 7.5);
  eq("a pasted 45,5 into a whole-number box is refused, shown as typed", readNumeric("45,5", { min: 1, max: 500, decimals: 0 }).text, "45,5");
  eq("and commits nothing", readNumeric("45,5", { min: 1, max: 500, decimals: 0 }).value, null);
  eq("and is malformed", readNumeric("45,5", { min: 1, max: 500, decimals: 0 }).kind, "malformed");
  eq("1.500 portion is malformed (no thousands guess)", readNumeric("1.500", { min: 0, max: 1500, decimals: 0 }).kind, "malformed");
  eq("1,500 portion is malformed too", readNumeric("1,500", { min: 0, max: 1500, decimals: 0 }).kind, "malformed");
  eq("1,5 portion is malformed", readNumeric("1,5", { min: 0, max: 1500, decimals: 0 }).kind, "malformed");
  eq("pasted with spaces around is fine", readNumeric(" 12 ", gl).value, 12);
  // typing one character at a time is lenient
  eq("a stray letter typed on the end is simply not entered", readNumericInput("12a", "12", gl).text, "12");
  eq("and it stays a good value", readNumericInput("12a", "12", gl).kind, "ok");
  eq("a second typed separator is not entered", readNumericInput("7..", "7.", gl).text, "7.");
  eq("a typed minus on an empty box is not entered", readNumericInput("-", "", gl).kind, "empty");
  eq("backspace is lenient", readNumericInput("1", "12", gl).value, 1);
  eq("a cut from the middle is lenient", readNumericInput("12", "132", gl).value, 12);
  eq("a replaced selection that is plain is fine", readNumericInput("7", "50", gl).value, 7);
  eq("a replaced selection that is not plain is refused", readNumericInput("-3", "500", gl).kind, "malformed");
  eq("malformed shows the error at once", numericError("malformed", { blurred: false, required: false }), "malformed");
  eq("malformed is not valid", numericValid("malformed", false), false);
  eq("- / + do nothing on refused text", stepAllowed("above") || stepAllowed("below") || stepAllowed("malformed"), false);
  eq("- / + do nothing on an empty REQUIRED box", stepAllowed("empty", true), false);
  eq("- / + still work on an empty optional box", stepAllowed("empty", false), true);
  eq("- / + work on a number", stepAllowed("ok"), true);
  eq("- / + work on an empty box", stepAllowed("empty"), true);
}

section("11. the offer attaches to its stored row; it expires; it hides on a back-dated meal");
{
  const now = new Date("2026-10-21T14:00:00.000Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  const offer = recentGlucoseSuggestion([{ id: "row-1", glucose_level_mgdl: 111, logged_at: ago(14) }], now);
  eq("the offer carries its row id", offer?.id, "row-1");
  // O3: mmol round trip 111 -> 6.2 -> 112 must not look like a different reading
  const shown = glucoseToDisplay(111, "mmol");
  eq("111 mg/dL is shown as 6.2 mmol/L", shown, 6.2);
  eq("which would come back as 112 mg/dL", glucoseFromDisplay(shown, "mmol"), 112);
  ok("the field showing 6.2 IS the offer", fieldIsOffer(6.2, shown));
  ok("6.3 is not", !fieldIsOffer(6.3, shown));
  ok("an empty field is not", !fieldIsOffer(null, shown));
  eq("expiry is 15 minutes after the reading", Math.round(offerExpiresInMs(ago(14), now) / 1000), 61);
  eq("an expired reading has no time left", offerExpiresInMs(ago(20), now), 0);
  eq("an unreadable stamp has no time left", offerExpiresInMs("nope", now), 0);
  const calc = src("app/calculator.tsx");
  ok("a save attaches to the tapped row instead of writing it again", calc.includes("boundOffer?.id") && /boundId\s*\?\s*\{ id: boundId \}\s*:\s*await findMatchingSugarLog/.test(calc) && /!\(await getSugarLog\(boundId\)\)\) boundId = null/.test(calc));
  ok("the tapped mg/dL value, not the rounded one, drives the estimate", /return boundOffer \? boundOffer\.mgdl : glucoseFromDisplay\(glucoseTyped, unit\)/.test(calc));
  ok("the binding needs the field to still show the offer and a record logged now", /offerBinding &&\s*loggedAt == null &&\s*fieldIsOffer\(glucoseTyped, glucoseToDisplay\(offerBinding\.mgdl, unit\)\)/.test(calc));
  ok("the offer hides on a back-dated meal", /!isEdit && glucose === "" && loggedAt == null/.test(calc));
  ok("the offer clears itself when its reading expires", calc.includes("offerExpiresInMs(s.loggedAt, now)") && calc.includes("setOfferTick"));
  ok("the offered rows come from a 15 minute window", calc.includes("listRecentSugarLogs(activeProfile.id, since)") && calc.includes("RECENT_GLUCOSE_WINDOW_MINUTES * 60_000"));
}

section("12. ratios: one atomic confirmation, locked boxes, no silent failures");
{
  const writer = src("lib/ratioWriter.ts");
  const calc = src("app/calculator.tsx");
  const prof = src("app/settings/profile.tsx");
  ok("ticking builds ONE patch from the draft", writer.includes("ratioConfirmDraftPatch(draft)") && !/enqueue\(\{ ratios_confirmed: 1 \}\)/.test(writer));
  ok("a failed write restores the draft", writer.includes("if (!pending) pending = draft"));
  ok("the sheet box is locked while the write runs and shows ticked only on success", calc.includes("disabled={!complete || confirming}") && /if \(next && confirmStillCurrent\(ok, sent, fieldsRef\.current\)\) \{\s*setConfirmed\(true\)/.test(calc) && !/setConfirmed\(next\)/.test(calc));
  ok("Profile reports a failed write", prof.includes('useRatioWriter(() => toast(t("common.saveFailed"), "error"))'));
  ok("Profile's box is enabled whenever the four numbers are filled (a tick flushes first)", prof.includes("disabled={!ratioFieldsComplete(ratioDraft) || confirming}") && !prof.includes("disabled={!ratioDraftIsStored}"));
  ok("the pending card shows only when four values wait for the tick", calc.split("calcSetupPrefilled(activeProfile)").length >= 4 && calc.includes("activeProfile?.ratios_confirmed !== 1 && calcSetupPrefilled(activeProfile)"));
  ok("an empty common.saveFailed text exists in all nine languages", ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"].every((l) => /\n    saveFailed: "[^"]+"/.test(src(`lib/i18n/locales/${l}.ts`))));
}

section("13. the basal daily dose settles before it is written");
{
  const prof = src("app/settings/profile.tsx");
  ok("typing only records a pending value", /function onBasalChange\(v: number \| null\)\s*\{\s*setBasalUnits\(v \?\? 0\);\s*basalPendingRef\.current = v;/.test(prof));
  ok("there is no pause timer: the write waits for the field to be left", !prof.includes("setTimeout(flushBasal") && !prof.includes("basalTimerRef") && prof.includes("onBlur={onBasalBlur}"));
  ok("an invalid value is never written", /if \(v === undefined \|\| basalInvalidRef\.current\) return;/.test(prof));
  ok("refused text returns to the stored value on blur", /function onBasalBlur\(\)\s*\{\s*if \(basalInvalidRef\.current\)[\s\S]{0,300}setBasalUnits\(activeProfile\?\.basal_daily_units \?\? 0\)/.test(prof));
  ok("leaving the screen writes a settled value", /useEffect\(\s*\(\) => \(\) => \{\s*flushBasal\(\);/.test(prof));
  ok("the field no longer persists on every keystroke", !/onChange=\{\(v\) => \{\s*setBasalUnits\(v \?\? 0\);\s*void persist/.test(prof));
}

section("14. every stepper in the app is the shared field");
{
  const sites: [string, string][] = [
    ["app/add-food.tsx", "carbs 0-100 g (1 decimal), portion 1-2000 g"],
    ["app/meal-template.tsx", "item portion 0-2000 g"],
    ["app/onboarding.tsx", "daily basal 0-200 U"],
    ["app/basal-confirm.tsx", "dose"],
    ["app/(tabs)/injection.tsx", "dose"],
    ["components/InjectionEditSheet.tsx", "dose"],
    ["app/calculator.tsx", "portion 0-1500 g, glucose, dose"],
    ["app/settings/profile.tsx", "daily basal 0-200 U, ratios"],
  ];
  for (const [rel, what] of sites) {
    const text = src(rel);
    ok(`${rel}: no <Stepper left (${what})`, !/<Stepper\b/.test(text));
    ok(`${rel}: uses NumericField or its presets`, /<NumericField|<CarbRatioInput|<IsfInput/.test(text));
  }
  for (const rel of ["app/basal-confirm.tsx", "app/(tabs)/injection.tsx", "components/InjectionEditSheet.tsx"]) {
    const text = src(rel);
    ok(`${rel}: an injection dose uses INJECTION_DOSE_BOUNDS (0-200, step 0.5, 2 decimals)`, text.includes("INJECTION_DOSE_BOUNDS.max") && text.includes("INJECTION_DOSE_BOUNDS.min") && text.includes("INJECTION_DOSE_BOUNDS.step") && text.includes("INJECTION_DOSE_BOUNDS.decimals") && !/[^_]DOSE_BOUNDS\./.test(text.replace(/INJECTION_DOSE_BOUNDS\./g, "")));
    ok(`${rel}: an empty or refused dose is never stored (null is ignored, the box is required)`, /if \(v == null\) return;/.test(text) && /\brequired\b/.test(text));
  }
  const addFood = src("app/add-food.tsx");
  ok("add-food keeps its gram bounds", /min=\{0\}\s*max=\{100\}\s*decimals=\{1\}/.test(addFood) && /min=\{1\}\s*max=\{2000\}\s*decimals=\{0\}/.test(addFood));
  ok("meal-template keeps 0-2000 g", /min=\{0\}\s*max=\{2000\}\s*decimals=\{0\}/.test(src("app/meal-template.tsx")));
  ok("onboarding and Profile share the one daily basal bound", src("app/onboarding.tsx").includes("max={BASAL_DAILY_BOUNDS.max}") && src("app/settings/profile.tsx").includes("max={BASAL_DAILY_BOUNDS.max}") && BASAL_DAILY_BOUNDS.max === 200 && BASAL_DAILY_BOUNDS.min === 0);
  ok("add-food and the portion fields keep the chip / slider sync (value flows in through the shared field)", src("components/NumericField.tsx").includes("fieldShowsValue(readingRef.current, value)"));
  ok("only the validity hook is left in components/Stepper.tsx for callers", /export function useStepperValidity/.test(src("components/Stepper.tsx")));
  const field = src("components/NumericField.tsx");
  ok("the hold repeat stops on a tick that changes nothing", /if \(!press\(dir, c\.longStep \?\? c\.step\)\) \{\s*stopHold\(\);\s*return;/.test(field));
  ok("- / + are disabled on refused text and on an empty required box", field.includes("|| !stepAllowed(kind, required)") && field.includes("stepAllowed(readingRef.current.kind, cfgRef.current.required)"));
  ok("iOS announces the error, Android reads the live region", field.includes("AccessibilityInfo.announceForAccessibility(errorText)") && field.includes('Platform.OS === "android" ? "polite" : "none"'));
  ok("a prop value outside the bounds is shown as an error, not as fine", field.includes("function fromValue") && /min != null && v < min \? "below"/.test(field));
}

section("15. new profiles are born unconfirmed");
{
  for (const rel of ["lib/db/profiles.ts", "lib/db/index.ts", "lib/db/screenshotSeed.ts"]) {
    const text = src(rel);
    const inserts = text.match(/INSERT (?:OR IGNORE )?INTO user_profiles[\s\S]*?;`/g) ?? [];
    ok(`${rel}: every profile INSERT names ratios_confirmed`, inserts.length > 0 && inserts.every((q) => q.includes("ratios_confirmed")));
  }
}

section("16. whole-number fields: a separator stays visible and is refused, key by key");
{
  type R = { text: string; kind: string; value: number | null };
  const keys = (seq: string, b: { min?: number; max?: number; decimals: number }): R => {
    let text = "";
    let r: R = { text: "", kind: "empty", value: null };
    for (const k of seq) {
      r = readNumericInput(text + k, text, b) as R;
      text = r.text;
    }
    return r;
  };
  const isf = { min: 1, max: 500, decimals: 0 };
  const gl = { min: 20, max: 600, decimals: 0 };
  const portion = { min: 0, max: 1500, decimals: 0 };
  eq("keys 4,5,comma,5 in the ISF box: refused", keys("45,5", isf).kind, "malformed");
  eq("... no value reaches the parent", keys("45,5", isf).value, null);
  eq("... the box still shows 45,5, not 455 and not 45", keys("45,5", isf).text, "45,5");
  eq("keys 5,comma,5 in the glucose box: refused, shows 5,5", `${keys("5,5", gl).kind}/${keys("5,5", gl).text}/${keys("5,5", gl).value}`, "malformed/5,5/null");
  eq("keys 1,2,comma,5 in the glucose box: refused (not 125)", `${keys("12,5", gl).kind}/${keys("12,5", gl).text}`, "malformed/12,5");
  eq("a dot works the same way (98.6)", `${keys("98.6", gl).kind}/${keys("98.6", gl).value}`, "malformed/null");
  eq("keys 1,.,5,0,0 in the portion box: refused", `${keys("1.500", portion).kind}/${keys("1.500", portion).text}`, "malformed/1.500");
  eq("keys 1,comma,5 in the portion box: refused", keys("1,5", portion).kind, "malformed");
  eq("the separator typed alone is refused too", keys("45,", isf).kind, "malformed");
  // fixing it: backspace removes the separator
  const fixed = readNumericInput("45", "45,5", isf);
  eq("deleting back to 45 is a good value again", `${fixed.kind}/${fixed.value}`, "ok/45");
  eq("45, then backspace on the comma is 45", readNumericInput("45", "45,", isf).value, 45);
  // an ordinary run of keys is unaffected
  eq("keys 4,5 are 45", keys("45", isf).value, 45);
  eq("keys 5,0,0 are 500", keys("500", isf).value, 500);
  eq("keys 5,0,1 are above", keys("501", isf).kind, "above");
  // the same box with decimals still reads a separator normally
  eq("a one-decimal box reads 7,5", keys("7,5", { min: 1, max: 100, decimals: 1 }).value, 7.5);
  eq("the whole-number error is the integerOnly text", true, src("components/NumericField.tsx").includes('t("numeric.integerOnly")'));
  // no other layer quietly cuts or drops the separator
  eq("sanitizeWholeText keeps 45,5", sanitizeWholeText("45,5"), "45,5");
  eq("sanitizeWholeText drops letters but not separators", sanitizeWholeText("4a5,5"), "45,5");
  eq("parseWholeText refuses 45,5", parseWholeText("45,5"), null);
  eq("parseWholeText refuses 1.500", parseWholeText("1.500"), null);
  eq("parseWholeText refuses 1,500", parseWholeText("1,500"), null);
  eq("parseWholeText reads 1500", parseWholeText("1500"), 1500);
  eq("parseWholeText refuses an empty box", parseWholeText(""), null);
  ok("hasDecimalSeparator sees the Arabic mark", hasDecimalSeparator("5٫5"));
  // the other whole-number fields
  const gis = src("components/GlucoseInputSheet.tsx");
  ok("the glucose sheet keeps the separator visible and refuses it", gis.includes("const wholeBad = !mmol && hasDecimalSeparator(value);") && gis.includes("pasteBad ? null : mmol ? parseDecimalText(value) : parseWholeText(value)") && gis.includes('t("numeric.integerOnly")'));
  const rng = src("components/RangeInput.tsx");
  ok("range ends hand the parent an EMPTY end while the text is malformed", rng.includes('onChangeMin(bad ? "" : s)') && rng.includes('onChangeMax(bad ? "" : s)') && rng.includes("hasDecimalSeparator(s)"));
  ok("range ends show the text as typed with the error", rng.includes("const shownMin = minBad ? (rawMin as string) : minText;") && rng.includes('t("numeric.integerOnly")'));
  const af = src("app/add-food.tsx");
  ok("add-food GI and preset grams are parsed strictly", af.includes("parseWholeText(gi)") && af.includes("parseWholeText(r.grams)") && !/parseInt\(gi/.test(af) && !/parseInt\(r\.grams/.test(af));
  ok("add-food shuts Save on a separator", af.includes("!wholeFieldsOk") && af.includes('t("numeric.integerOnly")'));
  eq("integerOnly exists in all nine languages", ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"].every((l) => /\n    integerOnly: "[^"]+"/.test(src(`lib/i18n/locales/${l}.ts`))), true);
  eq("tr text", src("lib/i18n/locales/tr.ts").includes('integerOnly: "Tam sayı girin"'), true);
}

section("17. dose limits: a meal dose 0-100, an injection 0-200, edits never below the record");
{
  const meal = { min: DOSE_BOUNDS.min, max: DOSE_BOUNDS.max, decimals: DOSE_BOUNDS.decimals };
  const inj = { min: INJECTION_DOSE_BOUNDS.min, max: INJECTION_DOSE_BOUNDS.max, decimals: INJECTION_DOSE_BOUNDS.decimals };
  eq("meal dose 100 accepted", readNumeric("100", meal).value, 100);
  eq("meal dose 101 refused", readNumeric("101", meal).kind, "above");
  eq("injection 200 accepted", readNumeric("200", inj).value, 200);
  eq("injection 201 refused", readNumeric("201", inj).kind, "above");
  eq("a user with 120 U daily basal can save the filled-in injection", readNumeric("120", inj).value, 120);
  eq("injection max covers the daily basal max (autofill)", INJECTION_DOSE_BOUNDS.max >= BASAL_DAILY_BOUNDS.max, true);
  eq("the injection step and decimals match the calculator's", `${INJECTION_DOSE_BOUNDS.step}/${INJECTION_DOSE_BOUNDS.decimals}`, `${DOSE_BOUNDS.step}/${DOSE_BOUNDS.decimals}`);
  eq("editing a 130 U injection: the limit stays 200", editableMax(INJECTION_DOSE_BOUNDS.max, 130), 200);
  eq("editing a 230 U record: the limit rises to 230", editableMax(INJECTION_DOSE_BOUNDS.max, 230), 230);
  eq("editing a 130 U meal dose: the limit rises to 130", editableMax(DOSE_BOUNDS.max, 130), 130);
  eq("... and 130 reads as a good value", readNumeric("130", { ...meal, max: editableMax(DOSE_BOUNDS.max, 130) }).value, 130);
  eq("... while a NEW meal dose of 130 is still refused", readNumeric("130", meal).value, null);
  eq("a record without a dose keeps the plain limit", editableMax(100, null), 100);
  eq("an unreadable original keeps the plain limit", editableMax(100, Number.NaN), 100);
  eq("daily basal bound is 0-200 for Profile and onboarding", `${BASAL_DAILY_BOUNDS.min}-${BASAL_DAILY_BOUNDS.max}`, "0-200");
  eq("a 200 U daily basal reads, 201 does not", `${readNumeric("200", { min: 0, max: 200, decimals: 1 }).value}/${readNumeric("201", { min: 0, max: 200, decimals: 1 }).value}`, "200/null");
  const ies = src("components/InjectionEditSheet.tsx");
  ok("the injection editor lifts its limit to the stored dose", ies.includes("max={editableMax(INJECTION_DOSE_BOUNDS.max, injection?.dose_units)}"));
  const calc = src("app/calculator.tsx");
  ok("the calculator's edit screen lifts its limit to the stored dose", calc.includes("max={editableMax(DOSE_BOUNDS.max, originalDose)}") && calc.includes("setOriginalDose(openedDose)"));
  ok("a new meal dose keeps 0-100", !calc.includes("INJECTION_DOSE_BOUNDS"));
  for (const rel of ["app/(tabs)/injection.tsx", "app/basal-confirm.tsx"]) {
    ok(`${rel}: 0-200`, src(rel).includes("INJECTION_DOSE_BOUNDS.max"));
  }
}

section("18. the confirm box can not be pressed twice");
{
  const calc = src("app/calculator.tsx");
  ok("the sheet box ignores a second press while a write runs", calc.includes("if (!ratioFieldsComplete(fields) || confirming) return;"));
  const prof = src("app/settings/profile.tsx");
  ok("Profile's box goes through the one-press gate", prof.includes("confirmGateRef.current?.press(checked)"));
}

section("19. a tapped offer whose reading was deleted is not linked");
{
  const calc = src("app/calculator.tsx");
  ok("the save checks the row still exists before linking", /let boundId: string \| null = boundOffer\?\.id \?\? null;\s*if \(boundId && !\(await getSugarLog\(boundId\)\)\) boundId = null;/.test(calc));
  ok("a vanished row falls back to the normal flow (match or write a new reading)", /boundId\s*\?\s*\{ id: boundId \}\s*:\s*await findMatchingSugarLog\(activeProfile\.id, glucoseMgdl, at\)/.test(calc));
  ok("typing the same value by hand never binds (the binding is set only by the tap)", (calc.match(/setOfferBinding\(/g) ?? []).length === 1 && /function useOfferedGlucose\(\)[\s\S]{0,400}setOfferBinding\(\{ id: offer\.id, mgdl: offer\.mgdl \}\)/.test(calc));
}

section("20. the glucose sheet refuses a bad paste like every other box");
{
  const mg = { decimals: 0 };
  const mm = { decimals: 1 };
  eq("pasting -45 into mg/dL is refused, not 45", readNumericInput("-45", "", mg).kind, "malformed");
  eq("... no value", readNumericInput("-45", "", mg).value, null);
  eq("... the text stays visible", readNumericInput("-45", "", mg).text, "45");
  eq("pasting 1e2 into mmol/L is refused, not 12", readNumericInput("1e2", "", mm).kind, "malformed");
  eq("... no value", readNumericInput("1e2", "", mm).value, null);
  eq("a plain pasted 110 is fine", readNumericInput("110", "", mg).value, 110);
  eq("a plain pasted 6,5 is fine in mmol/L", readNumericInput("6,5", "", mm).value, 6.5);
  eq("a stray key typed on the end stays lenient", readNumericInput("11a", "11", mg).kind, "ok");
  const gis = src("components/GlucoseInputSheet.tsx");
  ok(
    "the sheet reads text through readNumericInput (via readGlucoseSheetInput)",
    gis.includes("readGlucoseSheetInput(s, value, mmol)") &&
      src("lib/glucoseSheetInput.ts").includes("readNumericInput(raw, prev, { decimals })")
  );
  ok("a malformed paste leaves no value (Save stays shut)", gis.includes("const typed = pasteBad ? null :"));
  ok("and says so", gis.includes('t("numeric.range"') && gis.includes("wholeBad || pasteBad"));
  ok("a reopened sheet starts clean", (gis.match(/setPasteBad\(false\)/g) ?? []).length === 2);
  const prof = src("app/settings/profile.tsx");
  ok("Profile only goes back while it is the screen on top", prof.includes("canNavigate: () => !leftRef.current && latestRef.current.navigation.isFocused()"));
  const hook = src("lib/useRatioWriter.ts");
  ok("a failed write re-reads the database, not the context copy", hook.includes("reload: async () => (await getProfile(p.id)) ?? profileRef.current"));
  const calc = src("app/calculator.tsx");
  ok("the sheet checks the screen's numbers after the write", calc.includes("confirmStillCurrent(ok, sent, fieldsRef.current)"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
