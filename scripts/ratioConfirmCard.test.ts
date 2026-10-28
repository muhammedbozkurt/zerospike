/**
 * The ratio confirmation card (lib/ratioConfirmCard.ts and the three screens
 * that show it). Run with: npx tsx scripts/ratioConfirmCard.test.ts
 *
 * The properties under test: which card the calculator picks for each of the
 * three states (no ratios, entered but unconfirmed, confirmed), that a figure is
 * visible only in the confirmed state, that the confirmation never starts
 * ticked, that the unconfirmed copy does not disappear behind the figure gate,
 * and that the ratios sheet opens with the emphasis flag.
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import { calcFiguresAllowed, confirmStillCurrent, RATIOS_ENTERED, type CalcSetupProfile, type RatioFields } from "../lib/calcSetup";
import { createRatioWriter, type RatioPatch, type StoredRatios } from "../lib/ratioWriter";
import {
  ratioCardChecked,
  confirmCardEmphasized,
  ratioConfirmState,
  ratioFiguresVisible,
  ratioSetupOpenOptions,
  ratioStateCardKind,
  saveNeedsConfirmReminder,
  showUntilConfirmNote,
} from "../lib/ratioConfirmCard";

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

const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };
const nodePath = require("path") as { join: (...p: string[]) => string };
const ROOT = nodePath.join(__dirname, "..");
const src = (rel: string) => fs.readFileSync(nodePath.join(ROOT, rel), "utf8");

const base: CalcSetupProfile = {
  insulin_mode: "bolus",
  carb_ratio_breakfast: 0,
  carb_ratio_lunch: 0,
  carb_ratio_dinner: 0,
  insulin_sensitivity_factor: 0,
  ratios_confirmed: 0,
};
const entered: CalcSetupProfile = {
  ...base,
  carb_ratio_breakfast: 8,
  carb_ratio_lunch: 9,
  carb_ratio_dinner: 11,
  insulin_sensitivity_factor: 45,
  ratios_confirmed: RATIOS_ENTERED,
};
const confirmed: CalcSetupProfile = { ...entered, ratios_confirmed: 1 };

console.log("1. the state and its card");
eq("no profile: none", ratioConfirmState(null), "none");
eq("nothing entered: none", ratioConfirmState(base), "none");
eq("older build defaults only: none", ratioConfirmState({ ...base, carb_ratio_breakfast: 10, carb_ratio_lunch: 12, carb_ratio_dinner: 12, insulin_sensitivity_factor: 40 }), "none");
eq("three of four entered: none", ratioConfirmState({ ...entered, insulin_sensitivity_factor: 0 }), "none");
eq("all four entered, no confirmation: unconfirmed", ratioConfirmState(entered), "unconfirmed");
eq("entered but flag 0 (typed back): unconfirmed or none, never confirmed", ratioConfirmState({ ...entered, ratios_confirmed: 0 }) === "confirmed", false);
eq("all four entered and confirmed: confirmed", ratioConfirmState(confirmed), "confirmed");
eq("confirmed flag but a zero ISF: not confirmed", ratioConfirmState({ ...confirmed, insulin_sensitivity_factor: 0 }) === "confirmed", false);
eq("none shows the enter card", ratioStateCardKind("none"), "enter");
eq("unconfirmed shows the confirm card", ratioStateCardKind("unconfirmed"), "confirm");
eq("confirmed shows no card", ratioStateCardKind("confirmed"), null);

console.log("2. a figure is visible only when confirmed");
eq("none: no figure", ratioFiguresVisible("none"), false);
eq("unconfirmed: no figure", ratioFiguresVisible("unconfirmed"), false);
eq("confirmed: figure", ratioFiguresVisible("confirmed"), true);
for (const p of [null, base, entered, { ...entered, ratios_confirmed: 0 as const }, confirmed, { ...confirmed, carb_ratio_lunch: 0 }]) {
  eq("the state and the original gate agree", ratioFiguresVisible(ratioConfirmState(p)), calcFiguresAllowed(p));
}

console.log("3. the confirmation is never given on the user's behalf");
const sheetSrc = src("app/calculator.tsx");
const full: RatioFields = { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 45 };
eq("a fresh unconfirmed profile is never ticked", ratioCardChecked(entered, full, "mgdl"), false);
eq("a never-entered profile is never ticked", ratioCardChecked(base, full, "mgdl"), false);
eq("null profile is never ticked", ratioCardChecked(null, full, "mgdl"), false);
eq("a stored confirmation with the same numbers is ticked", ratioCardChecked(confirmed, full, "mgdl"), true);
eq("a stored confirmation with other numbers on screen is not", ratioCardChecked(confirmed, { ...full, lunch: 10 }, "mgdl"), false);
ok("the sheet derives the tick from the stored profile, with no local flag", sheetSrc.includes("ratioCardChecked(profile, fields, unit)") && !/setConfirmed|useState<boolean>\(RATIO/.test(sheetSrc));
ok("the sheet confirms only through the writer and a successful write", /if \(next && confirmStillCurrent\(ok, sent, fieldsRef\.current\)\) hapticSuccess\(\)/.test(sheetSrc));
ok("the profile editor starts ticked only from a stored confirmation", src("app/profile-setup.tsx").includes("useState(activeProfile?.ratios_confirmed === 1)"));
ok("Profile and Targets shows the stored confirmation only", src("app/settings/profile.tsx").includes("checked={activeProfile?.ratios_confirmed === 1 && ratioDraftIsStored}"));
ok("no card component ticks itself", !/useState/.test(src("components/RatioConfirmCard.tsx")) && !/useState/.test(src("components/RatioStateCard.tsx")));
ok("the pure module writes nothing", !/updateProfile|ratios_confirmed:\s*1/.test(src("lib/ratioConfirmCard.ts")));

console.log("4. the sheet opens with the emphasis flag");
eq("unconfirmed opens emphasised", ratioSetupOpenOptions("unconfirmed").emphasizeConfirm, true);
eq("none opens plain", ratioSetupOpenOptions("none").emphasizeConfirm, false);
eq("confirmed opens plain", ratioSetupOpenOptions("confirmed").emphasizeConfirm, false);
const line = src("components/CarbRatioLine.tsx");
ok("the state card hands the options to the sheet", line.includes("onOpenSetup(opts)") && line.includes("ratioSetupOpenOptions(state)"));
ok("the calculator opens the sheet with them", /function openSetup\(opts: \{ emphasizeConfirm: boolean \}\)\s*\{\s*setSetupEmphasize\(opts\.emphasizeConfirm\);\s*setSetupOpen\(true\)/.test(sheetSrc) && sheetSrc.includes("emphasizeConfirm={setupEmphasize}"));
ok("the automatic first open is not emphasised", /setSetupEmphasize\(false\);\s*setSetupOpen\(true\)/.test(sheetSrc));
ok("Profile reads the highlight param", src("app/settings/profile.tsx").includes('emphasized={highlight === "confirm"}'));

console.log("5. the card and its inline line");
eq("complete and unticked: the line shows", showUntilConfirmNote({ complete: true, checked: false }), true);
eq("complete and ticked: no line", showUntilConfirmNote({ complete: true, checked: true }), false);
eq("incomplete: no line", showUntilConfirmNote({ complete: false, checked: false }), false);
eq("complete and unticked: accent border", confirmCardEmphasized({ complete: true, checked: false, emphasized: false }), true);
eq("opened on purpose: accent border", confirmCardEmphasized({ complete: false, checked: false, emphasized: true }), true);
eq("incomplete and not asked: plain border", confirmCardEmphasized({ complete: false, checked: false, emphasized: false }), false);
eq("ticked: plain border", confirmCardEmphasized({ complete: true, checked: true, emphasized: true }), false);
const card = src("components/RatioConfirmCard.tsx");
ok("the whole card is the touch target", /<Pressable[\s\S]{0,200}accessibilityRole="checkbox"/.test(card));
ok("the accent comes from THEME", card.includes("THEME.accent") && !/#[0-9a-fA-F]{3,8}\b|rgba\(/.test(card));
ok("no auto-fit text", !/adjustsFontSizeToFit/.test(card + src("components/RatioStateCard.tsx")));

console.log("6. save behaviour is unchanged; only a reminder is added");
eq("complete, unconfirmed: remind", saveNeedsConfirmReminder({ complete: true, confirmed: false }), true);
eq("complete, confirmed: no reminder", saveNeedsConfirmReminder({ complete: true, confirmed: true }), false);
eq("incomplete: no reminder", saveNeedsConfirmReminder({ complete: false, confirmed: false }), false);
ok("Save still writes through flush and closes", /async function finishSetup\(info[^)]*\)\s*\{\s*setupErrorRef\.current = false;\s*await ratioWriters\.get\(\)\?\.flush\(\);\s*if \(setupErrorRef\.current\) return;\s*setSetupOpen\(false\)/.test(sheetSrc));
ok("the reminder is a toast after a successful save", sheetSrc.includes('if (info.needsConfirmReminder) toast(t("ratioConfirm.savedReminder"), "info")'));

console.log("6b. values are seen before the confirmation, and the sheet scrolls to the card");
ok("the card lists the four values read only", card.includes("fields: RatioFields") && card.includes('t("calculator.setup.isfLabel")') && card.includes("glucoseToDisplay("));
ok("every surface passes its values to the card", [sheetSrc, src("app/settings/profile.tsx"), src("app/profile-setup.tsx")].every((f) => /<RatioConfirmCard[\s\S]{0,400}fields=\{/.test(f)));
ok("the sheet scrolls to the card on an emphasised open", sheetSrc.includes("scrollTargetRef={confirmCardRef}") && sheetSrc.includes("scrollToActive={emphasizeConfirm}"));
ok("Profile scrolls to the card on highlight", src("app/settings/profile.tsx").includes('scrollToActive={highlight === "confirm"}'));
ok("the shells wire the scroll hook", src("components/SheetShell.tsx").includes("useScrollToTarget(") && src("components/settingsUi.tsx").includes("useScrollToTarget("));
ok("the big state card is calculator only", (sheetSrc.match(/variant="card"/g) ?? []).length === 2);
ok("the compact line is gated by region", line.includes("calculatorHiddenForRegion()"));

console.log("7. the copy exists in all nine languages, no banned roots");
const keys = ["until", "enterTitle", "enterBody", "confirmTitle", "confirmBody", "confirmAction", "savedReminder"];
for (const l of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  const s = src(`lib/i18n/locales/${l}.ts`);
  const block = s.slice(s.indexOf("\n  ratioConfirm: {"), s.indexOf("\n  },\n", s.indexOf("\n  ratioConfirm: {")));
  for (const k of keys) ok(`${l}: ratioConfirm.${k}`, new RegExp(`\\n    ${k}: "[^"]+"`).test(block));
  ok(`${l}: no em dash`, !block.includes(String.fromCharCode(8212)));
}
const tr = src("lib/i18n/locales/tr.ts");
ok("tr confirm title and action are the agreed ones", tr.includes('confirmTitle: "Hesaplama için onayınız gerekiyor"') && tr.includes('confirmAction: "Oranları onaylayın"'));
ok("the agreed confirmation text is untouched", tr.includes('confirm: "Bu oranları diyabet ekibimle belirledim"'));

for (const k of ["until", "enterTitle", "enterBody", "confirmTitle", "confirmBody", "confirmAction", "savedReminder"]) {
  const m = tr.match(new RegExp(`\\n    ${k}: "([^"]+)"`));
  const text = m ? m[1].replace(/belirlediyseniz|girin|onaylayın/g, "") : "";
  ok(`tr ${k}: polite plural, no singular imperative`, !!m && !/\b(onayla|gir|belirle)\b/.test(text));
}

console.log("8. carb ratio labels name the unit; de never says KE-Faktor or BE-Faktor");
const unitWord: Record<string, string> = { en: "unit", tr: "ünite", de: "Einheit", fr: "unité", es: "unidad", it: "unità", pt: "unidade", ar: "وحدة", ja: "単位" };
for (const l of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  const s = src(`lib/i18n/locales/${l}.ts`);
  const pairs: [string, RegExp][] = [
    ["onboarding.qCarbRatio", /\n    qCarbRatio: "([^"]+)"/],
    ["calculator.setup.carbLabel", /\n      carbLabel: "([^"]+)"/],
  ];
  for (const [name, re] of pairs) {
    const m = s.match(re);
    ok(`${l}: ${name} names the unit`, !!m && /\(.*\)/.test(m[1]) && m[1].includes(unitWord[l]) && /g\b|غرام/.test(m[1]), m ? m[1] : "missing");
  }
}
const de = src("lib/i18n/locales/de.ts");
ok("de: no KE-Faktor, BE-Faktor, KH-Faktor or KE-Verhältnis anywhere", !/KE-Faktor|BE-Faktor|KH-Faktor|KE-Verhältnis|BE-Verhältnis/.test(de));
ok("de: the carb ratio is one term, KH-Verhältnis", (de.match(/KH-Verhältnis/g) ?? []).length >= 6);
ok("es: the carb ratio says ratio, not proporción", !/proporci/i.test(src("lib/i18n/locales/es.ts")));

async function untick(): Promise<void> {
  console.log("9. tick, untick and re-type against the stored profile");
  let db: StoredRatios = { carb_ratio_breakfast: 8, carb_ratio_lunch: 9, carb_ratio_dinner: 11, insulin_sensitivity_factor: 45, ratios_confirmed: RATIOS_ENTERED };
  const w = createRatioWriter({
    stored: { ...db },
    persist: async (p: RatioPatch) => {
      db = { ...db, ...p };
    },
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const prof = (): CalcSetupProfile => ({ ...base, ...db });
  let fields: RatioFields = { ...full };
  const checked = () => ratioCardChecked(prof(), fields, "mgdl");
  eq("starts unticked", checked(), false);
  const sent = fields;
  const ok1 = await w.confirm(true);
  ok("the tick write reached the profile", confirmStillCurrent(ok1, sent, fields));
  eq("after the tick the box shows ticked and the DB holds 1", checked() && db.ratios_confirmed === 1, true);
  eq("figures are allowed", calcFiguresAllowed(prof()), true);
  await w.confirm(false);
  eq("after the untick the DB holds no confirmation", db.ratios_confirmed === 1, false);
  eq("after the untick the box shows unticked", checked(), false);
  eq("and figures are gone", calcFiguresAllowed(prof()), false);
  await w.confirm(true);
  eq("ticked again", checked(), true);
  fields = { ...fields, breakfast: 8 };
  eq("typing the same value again (8, over 8) keeps the tick", checked(), true);
  fields = { ...fields, breakfast: 9 };
  w.update(fields);
  await w.flush();
  eq("an edit withdraws the confirmation and the box with it", checked(), false);
  eq("the DB agrees", db.ratios_confirmed === 1, false);
}

untick().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
