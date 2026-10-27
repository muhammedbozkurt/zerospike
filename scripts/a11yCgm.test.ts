/**
 * 2.5.0 accessibility contract for the CGM surfaces and their neighbours.
 * Run: npx tsx scripts/a11yCgm.test.ts
 *
 * Source scan: the screen-reader contract (role, label, state, grouping,
 * hidden decoration, Dynamic Type) lives in JSX, so each new component is
 * pinned by the props it must carry. Locale part: every new spoken string
 * exists in all nine languages.
 */
declare const require: (m: string) => any;
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let failed = 0;
let checks = 0;
const src = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

function must(rel: string, needle: string | RegExp, why: string, within?: string) {
  checks++;
  const text = within ?? src(rel);
  const ok = typeof needle === "string" ? text.includes(needle) : needle.test(text);
  if (!ok) {
    failed++;
    console.log(`FAIL ${rel}: ${why}`);
  }
}
function mustNot(rel: string, needle: string | RegExp, why: string) {
  checks++;
  const text = src(rel);
  const bad = typeof needle === "string" ? text.includes(needle) : needle.test(text);
  if (bad) {
    failed++;
    console.log(`FAIL ${rel}: ${why}`);
  }
}
/** The text between the first `start` and the next `end` after it. */
function slice(rel: string, start: string, end: string): string {
  const text = src(rel);
  const i = text.indexOf(start);
  if (i < 0) return "";
  const j = text.indexOf(end, i + start.length);
  return text.slice(i, j < 0 ? undefined : j);
}

// Dynamic Type: nothing new switches scaling off or lifts the global cap.
const NEW_FILES = [
  "components/charts/CgmCurve.tsx",
  "components/CgmHomeCard.tsx",
  "components/CgmSwitchOffer.tsx",
  "components/CgmDaySheet.tsx",
  "components/CgmDayRow.tsx",
  "components/SourceBadge.tsx",
  "components/ToastCard.tsx",
  "components/WhatsNewSheet.tsx",
  "app/settings/data-sources.tsx",
];
for (const f of NEW_FILES) {
  mustNot(f, "allowFontScaling={false}", "must not switch off Dynamic Type");
  mustNot(f, /maxFontSizeMultiplier=\{?(?:[3-9]|2\.[1-9])/, "must not exceed MAX_FONT_SCALE 2.0");
}

// The curve: one summary label for the whole graphic, children not focusable.
const curve = "components/charts/CgmCurve.tsx";
must(curve, /accessible\s+accessibilityRole="image"\s+accessibilityLabel=\{summary\}/,"curve is one image element labelled by its summary");

// Home card: window in the summary, hours choice, trend text, loading state.
const home = "components/CgmHomeCard.tsx";
must(home, 't("cgmCurve.windowSummary"', "chart summary names its window (last N hours)");
must(home, 't("cgmCurve.hoursA11y", { n: h })', "hours chips speak 'last N hours'");
must(home, /a11yLabel: `\$\{t\("cgmCurve\.hours", \{ n: h \}\)\}, /, "chip's spoken label starts with its visible text (Voice Control)");
must(home, "accessibilityLabel={label}", "trend arrow has a text equivalent");
must(home, "t(`cgmCurve.trend.${trend}`)", "trend text comes from cgmCurve.trend.*");
must(home, /accessibilityState=\{\{ busy: true \}\}/, "loading placeholder announces busy");
must("components/ui.tsx", "opt.a11yLabel ?? opt.label", "Segmented honours a spoken label per option");

// Source badge.
must("components/SourceBadge.tsx", "accessibilityLabel={label}", "badge speaks its label");
must("components/SourceBadge.tsx", 'accessibilityRole="text"', "badge is plain text");

// Day row and sheet.
must("components/CgmDayRow.tsx", 'accessibilityRole="button"', "day row is a button");
must("components/CgmDayRow.tsx", "accessibilityLabel={`${count}. ${sub}`}", "day row reads count and summary");
must("components/CgmDayRow.tsx", "accessibilityHint={t(\"cgmCurve.dayRowHint\")}", "day row hint");
must("components/CgmDaySheet.tsx", "closeLabel={t(\"common.close\")}", "sheet close is labelled");
must("components/CgmDaySheet.tsx", "summary={summary}", "day curve carries a summary");

// Switch offer: both answers are real buttons and lock while busy.
const offer = "components/CgmSwitchOffer.tsx";
must(offer, "disabled={busy}", "offer buttons lock while the answer saves");
must(offer, 'accessibilityRole="header"', "offer title is a header");

// Toast.
const toast = "components/ToastCard.tsx";
must(toast, "accessible", "toast message is one element");
must(toast, 'accessibilityRole="button"', "toast action is a button");
must(toast, "accessibilityLabel={action.label}", "toast action is labelled");
must("components/Feedback.tsx", "announceForAccessibility", "toast is announced");

// Data sources screen and Nightscout form.
const ds = "app/settings/data-sources.tsx";
must(ds, 'accessibilityRole="radio"', "mode cards are radios");
must(ds, "accessibilityState={{ selected }}", "mode card state");
must(ds, "accessibilityHint={option.hint}", "mode card hint");
must(ds, 'accessibilityRole="radiogroup"', "mode cards are grouped");
must(ds, "announceForAccessibility(message.text)", "test and connect result is announced on iOS too");
const field = slice("components/ui.tsx", "export const Field", "interface SegmentedProps");
must("components/ui.tsx", "accessibilityLabel={label}", "Field passes its label to the input", field);
must("components/ui.tsx", "accessibilityHint={hint}", "Field passes its hint to the input", field);

// Onboarding measure step: the card's description is spoken.
must("components/onboarding/OptionCard.tsx", "accessibilityHint={description}", "option card speaks its description");

// Reminders hub: the row reads time, day and the CGM pause, and the toggle is reachable.
const rem = slice("app/settings/reminders.tsx", "function ReminderRow", "export default function RemindersScreen");
must("app/settings/reminders.tsx", "t(\"cgmReminders.pausedRow\")", "pause text exists", rem);
must("app/settings/reminders.tsx", "row.time", "row label carries the time", slice("app/settings/reminders.tsx", "const spoken", "return ("));
must("app/settings/reminders.tsx", "pausedRow", "row label carries the CGM pause", slice("app/settings/reminders.tsx", "const spoken", "return ("));
must("app/settings/reminders.tsx", 'name: "toggle"', "row offers a toggle action", rem);
must("app/settings/reminders.tsx", "onAccessibilityAction", "row handles the toggle action", rem);
must("app/settings/reminders.tsx", "accessibilityValue", "row speaks on or off", rem);

// Insights coverage tile reads as one sentence.
must("components/StatCard.tsx", "a11yLabel", "StatCard accepts a spoken label");
must("app/insights.tsx", "a11yLabel={coverageLine(t, data.days, data.cgmCoverage)}", "coverage tile speaks days and share");

// Injection stale-time dialog: the overlay owns focus and both answers are buttons.
const fb = "components/Feedback.tsx";
must(fb, "accessibilityViewIsModal", "dialogs own accessibility focus");
must(fb, "accessibilityLabel={cancelLabel}", "dialog cancel labelled");
must(fb, "accessibilityLabel={confirmLabel}", "dialog confirm labelled");

// Calculator region info (K5).
const region = slice("app/calculator.tsx", "function CalculatorRegionInfo", "export default function CalculatorRoute");
must("app/calculator.tsx", 'accessibilityRole="button"', "close is a button", region);
must("app/calculator.tsx", 't("common.close")', "close is labelled", region);
must("app/calculator.tsx", 'accessibilityRole="header"', "title is a header", region);

// What's New.
must("components/WhatsNewSheet.tsx", "closeLabel={t(\"common.close\")}", "sheet close is labelled");
must("components/WhatsNewSheet.tsx", "HIDDEN_FROM_A11Y", "bullet dots are decoration");

// Locales: spoken strings exist in all nine languages, no em dash, trend text complete.
const LANGS = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
const TREND = ["up2", "up", "up45", "flat", "down45", "down", "down2"];
for (const l of LANGS) {
  const mod = require(`../lib/i18n/locales/${l}`);
  const dict = mod.default ?? mod;
  const get = (p: string): unknown => p.split(".").reduce((o: any, k) => (o == null ? o : o[k]), dict);
  const needed = [
    "cgmCurve.windowSummary",
    "cgmCurve.hoursA11y",
    "reminders.a11yOn",
    "reminders.a11yOff",
    "reminders.a11yToggle",
    ...TREND.map((k) => `cgmCurve.trend.${k}`),
  ];
  for (const key of needed) {
    checks++;
    const v = get(key);
    if (typeof v !== "string" || v.trim() === "") {
      failed++;
      console.log(`FAIL locale ${l}: ${key} missing`);
    } else if (v.includes(String.fromCharCode(0x2014))) {
      failed++;
      console.log(`FAIL locale ${l}: ${key} has an em dash`);
    }
  }
  for (const key of ["cgmCurve.windowSummary", "cgmCurve.hoursA11y"]) {
    checks++;
    const v = String(get(key) ?? "");
    const slot = key.endsWith("windowSummary") ? "{{summary}}" : "{{n}}";
    if (!v.includes(slot)) {
      failed++;
      console.log(`FAIL locale ${l}: ${key} lacks ${slot}`);
    }
  }
}

console.log(failed === 0 ? `a11yCgm: all passed (${checks} checks)` : `a11yCgm: ${failed} failed of ${checks}`);
if (failed) process.exit(1);
