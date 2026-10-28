/**
 * Standalone, dependency-free harness for onboarding's step list
 * (lib/onboardingSteps.ts) and the calculator's first-use number sheet
 * (lib/calcSetup.ts). No jest, compile + run with node, same pattern as
 * scripts/calc.test.ts (TypeScript 6 needs the two extra flags below once files
 * are named on the command line):
 *
 *   npx tsc scripts/onboardingSteps.test.ts lib/onboardingSteps.ts \
 *     lib/calcSetup.ts lib/ratioWriter.ts lib/insulin.ts lib/glucose.ts lib/insulinMode.ts lib/db/types.ts \
 *     lib/analytics/eventSchema.ts \
 *     --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution node --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/onboardingSteps.test.js
 *
 * Run it from the repo root; the screen pins read app/*.tsx relative to it.
 *
 * The properties under test:
 *  - how many screens each path costs, in what order, and that the screens
 *    that were cut (carb ratio, ISF, basal time, widget preview, the stand-alone
 *    notification prompt) are really gone from the quiz;
 *  - the OS permission is raised only by an action the user takes on the
 *    reminder step or the medication step, never by finishing onboarding;
 *  - the two analytics payloads;
 *  - the calculator asks for its numbers once, on a new record, for a profile
 *    that uses mealtime insulin and has none of its own.
 * The screen wiring has no pure function to call, so it is pinned by reading
 * the source, the way calc.test.ts pins its own screen fixes.
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import {
  BASE_STEPS,
  DIABETES_OPTIONS,
  OPTIONAL_STEPS,
  TREATMENT_OPTIONS,
  basalReminderOnAtFinish,
  buildOnboardingSteps,
  diabetesTypeOf,
  onboardingDoneEvent,
  onboardingFlags,
  onboardingStepEvent,
  planSetupDecision,
  requiredScreenCount,
  DEFAULT_MEASURE,
  MEASURE_OPTIONS,
  measureAfterPermission,
  measureModeToWrite,
  nightscoutHandoff,
  skipsMeasurementReminders,
  type DiabetesOption,
  type OnboardingAnswers,
  type OnboardingPath,
  type OnboardingStepId,
  type TreatmentOption,
} from "../lib/onboardingSteps";
import {
  LEGACY_CALC_SETUP_DISMISSED_KEY,
  RATIOS_CONFIRM_PROMPTED_KEY,
  calcFiguresAllowed,
  calcSetupNeeded,
  calcSetupPrefilled,
  confirmStillCurrent,
  RATIOS_ENTERED,
  ratioConfirmPatch,
  ratioDraftDiffers,
  ratioDraftPatch,
  ratioFieldsInitial,
  ratioSetMatchesStored,
  shouldAutoOpenCalcSetup,
  unenteredGroups,
  type CalcSetupProfile,
  type RatioFields,
} from "../lib/calcSetup";
import { createConfirmGate, createRatioWriter, type RatioPatch, type StoredRatios } from "../lib/ratioWriter";
import { carbsForPortion, estimateInsulin, estimateInsulinConfirmed } from "../lib/insulin";
import { sanitizeEvent } from "../lib/analytics/eventSchema";

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
function eqList(name: string, actual: readonly string[], expected: readonly string[]): void {
  eq(name, actual.join(","), expected.join(","));
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};
const nodePath = require("path") as {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};

const ROOT = (() => {
  const isRoot = (dir: string) =>
    fs.existsSync(nodePath.join(dir, "package.json")) &&
    fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"));
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (isRoot(dir)) return dir;
    dir = nodePath.dirname(dir);
  }
  if (isRoot(process.cwd())) return process.cwd();
  throw new Error("could not locate the repo root from " + __dirname);
})();

function src(rel: string): string {
  return fs.readFileSync(nodePath.join(ROOT, rel), "utf8");
}

/** Text from the first `from` marker up to the next `to` marker after it. */
function between(source: string, from: string, to: string): string {
  const a = source.indexOf(from);
  if (a === -1) return "";
  const b = source.indexOf(to, a + from.length);
  return b === -1 ? source.slice(a) : source.slice(a, b);
}

/** Source with line comments dropped, so a pin on code is not fooled by prose
 *  that happens to name the same identifiers. */
function code(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

/** The quiz as it was before this change, frozen, so the before/after table
 *  below is computed rather than quoted. */
function legacySteps(f: { isTwoWayTreatment: boolean; hasInsulin: boolean; hasOralMeds: boolean }): string[] {
  return [
    "name",
    "unit",
    "diabetes",
    f.isTwoWayTreatment ? "pillsOnly" : "insulin",
    "targets",
    ...(f.hasInsulin ? ["insulinProducts", "carbRatio", "isf", "basal"] : []),
    "widget",
    "notify",
    ...(f.hasOralMeds ? ["medReminder"] : []),
    "reminderPlan",
    "disclaimer",
  ];
}

interface PathCase {
  label: string;
  answers: OnboardingAnswers;
  path: OnboardingPath;
  expected: OnboardingStepId[];
  before: number;
}

const CASES: PathCase[] = [
  {
    label: "insulin only (type 1)",
    answers: { diabetes: "type1", treatment: "insulin", pillsOnly: null },
    path: "insulin",
    expected: ["analytics", "name", "unit", "diabetes", "insulin", "measure", "targets", "insulinProducts", "reminderPlan"],
    before: 13,
  },
  {
    label: "insulin and pills",
    answers: { diabetes: "type2", treatment: "both", pillsOnly: null },
    path: "insulin",
    expected: [
      "analytics",
      "name",
      "unit",
      "diabetes",
      "insulin",
      "measure",
      "targets",
      "insulinProducts",
      "medReminder",
      "reminderPlan",
    ],
    before: 14,
  },
  {
    label: "pills only (type 2)",
    answers: { diabetes: "type2", treatment: "pills", pillsOnly: null },
    path: "pills",
    expected: ["analytics", "name", "unit", "diabetes", "insulin", "measure", "targets", "medReminder", "reminderPlan"],
    before: 10,
  },
  {
    label: "no medication (type 2)",
    answers: { diabetes: "type2", treatment: "none", pillsOnly: null },
    path: "none",
    expected: ["analytics", "name", "unit", "diabetes", "insulin", "measure", "targets", "reminderPlan"],
    before: 9,
  },
  {
    label: "no diagnosis, pills",
    answers: { diabetes: "none", treatment: null, pillsOnly: true },
    path: "pills",
    expected: ["analytics", "name", "unit", "diabetes", "pillsOnly", "measure", "targets", "medReminder", "reminderPlan"],
    before: 10,
  },
  {
    label: "prediabetes, no pills",
    answers: { diabetes: "prediabetes", treatment: null, pillsOnly: false },
    path: "none",
    expected: ["analytics", "name", "unit", "diabetes", "pillsOnly", "measure", "targets", "reminderPlan"],
    before: 9,
  },
];

console.log("zerospike onboarding steps test");

section("A. every path: order, length, and what is no longer there");
{
  const REMOVED = ["carbRatio", "isf", "basal", "widget", "notify"];
  for (const c of CASES) {
    const flags = onboardingFlags(c.answers);
    const steps = buildOnboardingSteps(flags);
    eqList(`${c.label}: step order`, steps, c.expected);
    eq(`${c.label}: path`, flags.path, c.path);
    for (const gone of REMOVED) {
      ok(`${c.label}: no ${gone} screen`, !(steps as string[]).includes(gone));
    }
    eq(`${c.label}: eight required screens`, requiredScreenCount(steps), 8);
    ok(`${c.label}: reminderPlan is last`, steps[steps.length - 1] === "reminderPlan");
    ok(`${c.label}: the disclaimer is not a step`, !(steps as string[]).includes("disclaimer"));
    eqList(`${c.label}: the head never changes`, steps.slice(0, BASE_STEPS.length), BASE_STEPS);
  }
}

section("B. the insulin path is within the target");
{
  const insulin = buildOnboardingSteps(
    onboardingFlags({ diabetes: "type1", treatment: "insulin", pillsOnly: null })
  );
  ok("nine screens at most, optional product screen included", insulin.length <= 9, `got ${insulin.length}`);
  eq("eight without the optional product screen", requiredScreenCount(insulin), 8);
  eqList(
    "required screens are exactly the agreed eight",
    insulin.filter((s) => !OPTIONAL_STEPS.includes(s)),
    ["analytics", "name", "unit", "diabetes", "insulin", "measure", "targets", "reminderPlan"]
  );
  eqList("the only optional screens are the two that stayed optional", OPTIONAL_STEPS, [
    "insulinProducts",
    "medReminder",
  ]);
  const both = buildOnboardingSteps(
    onboardingFlags({ diabetes: "type2", treatment: "both", pillsOnly: null })
  );
  ok("insulin and pills stays at eight required screens", requiredScreenCount(both) <= 8);
  const pills = buildOnboardingSteps(
    onboardingFlags({ diabetes: "type2", treatment: "pills", pillsOnly: null })
  );
  ok("the pill path is shorter than the insulin-and-pills path", pills.length < both.length);
}

section("C. before and after, per path (screens in the quiz)");
{
  console.log("  path                     before  after  required");
  for (const c of CASES) {
    const flags = onboardingFlags(c.answers);
    const after = buildOnboardingSteps(flags);
    const before = legacySteps(flags);
    eq(`${c.label}: the frozen old list is ${c.before} screens`, before.length, c.before);
    ok(`${c.label}: strictly shorter than before`, after.length < before.length);
    console.log(
      `  ${c.label.padEnd(24)} ${String(before.length).padStart(6)}  ${String(after.length).padStart(5)}  ${String(
        requiredScreenCount(after)
      ).padStart(8)}`
    );
  }
}

section("D. the answers decide the path, and a stale answer cannot leak");
{
  const f = (diabetes: DiabetesOption | null, treatment: TreatmentOption | null, pillsOnly: boolean | null) =>
    onboardingFlags({ diabetes, treatment, pillsOnly });

  eq("insulin answer is insulin", f("type1", "insulin", null).path, "insulin");
  eq("both is the insulin path", f("type2", "both", null).path, "insulin");
  eq("pills answer is pills", f("type2", "pills", null).path, "pills");
  eq("neither is none", f("type2", "none", null).path, "none");
  eq("nothing answered yet is none", f(null, null, null).path, "none");

  // Backing up from "type 1 + insulin" and picking "no diagnosis": the insulin
  // answer is still in state but must not reach the profile or the step list.
  const leaked = f("none", "insulin", null);
  eq("a stale insulin answer is ignored on the two-way path", leaked.hasInsulin, false);
  eq("and the effective treatment is none", leaked.effectiveTreatment, "none");
  ok(
    "and the insulin product screen is not shown",
    !buildOnboardingSteps(leaked).includes("insulinProducts")
  );
  eq("a stale pill answer is ignored off the two-way path", f("type1", "none", true).hasOralMeds, false);
  eq("prediabetes is two-way too", f("prediabetes", "both", true).hasInsulin, false);
  eq("the two-way pill answer is the pill path", f("prediabetes", "both", true).path, "pills");
  eq("gestational keeps the four-way question", f("gestational", null, null).isTwoWayTreatment, false);

  eq("prefer not to say lands on unknown", diabetesTypeOf("other"), "unknown");
  eq("a skipped question lands on unknown", diabetesTypeOf(null), "unknown");
  for (const opt of DIABETES_OPTIONS) {
    if (opt === "other") continue;
    eq(`${opt} is stored as itself`, diabetesTypeOf(opt), opt);
  }
  eq("four treatment answers", TREATMENT_OPTIONS.length, 4);
}

section("E. analytics payloads: no path can be told from another");
{
  const flags = onboardingFlags({ diabetes: "type1", treatment: "insulin", pillsOnly: null });
  const steps = buildOnboardingSteps(flags);

  const welcome = onboardingStepEvent("welcome", "name", steps);
  eq("welcome is step 'welcome'", welcome.step, "welcome");
  eq("at index 0", welcome.index, 0);

  const consent = onboardingStepEvent("quiz", "analytics", steps);
  eq("the consent screen comes right after welcome, index 1", consent.index, 1);
  eq("and keeps its own name", consent.step, "analytics");
  const first = onboardingStepEvent("quiz", "name", steps);
  eq("the first question is index 2", first.index, 2);
  eq("and keeps its own name", first.step, "name");
  const last = onboardingStepEvent("quiz", "reminderPlan", steps);
  eq("the last question is index = required screens", last.index, requiredScreenCount(steps));
  eq("reveal follows it", onboardingStepEvent("reveal", "reminderPlan", steps).index, requiredScreenCount(steps) + 1);
  eq("reveal is step 'reveal'", onboardingStepEvent("reveal", "reminderPlan", steps).step, "reveal");
  ok(
    "indices never go back along the funnel and grow by one at every required screen",
    steps.every((s, i) => {
      const here = onboardingStepEvent("quiz", s, steps).index;
      if (i === 0) return here === 1;
      const before = onboardingStepEvent("quiz", steps[i - 1], steps).index;
      return here === before + (OPTIONAL_STEPS.includes(s) ? 0 : 1);
    })
  );
  ok(
    "index is an integer",
    steps.every((s) => Number.isInteger(onboardingStepEvent("quiz", s, steps).index))
  );
  eq("a step outside the list does not produce a negative index", onboardingStepEvent("quiz", "isf" as never, steps).index, 0);
  eqList("step has exactly the two agreed fields", Object.keys(first).sort(), ["index", "step"]);

  // Which treatment someone uses is health information. The two screens that
  // only some paths show report as the screen before them, so neither a name
  // nor a count of the screens seen says what was answered.
  const targets = JSON.stringify(onboardingStepEvent("quiz", "targets", steps));
  eq("the product screen reports as the screen before it", JSON.stringify(onboardingStepEvent("quiz", "insulinProducts", steps)), targets);
  const bothSteps = buildOnboardingSteps(onboardingFlags({ diabetes: "type2", treatment: "both", pillsOnly: null }));
  eq("so does the medication reminder", JSON.stringify(onboardingStepEvent("quiz", "medReminder", bothSteps)), targets);
  const pillsOnlySteps = buildOnboardingSteps(onboardingFlags({ diabetes: "prediabetes", treatment: null, pillsOnly: true }));
  eq(
    "the insulin question and the pills-only question share one name",
    onboardingStepEvent("quiz", "pillsOnly", pillsOnlySteps).step,
    onboardingStepEvent("quiz", "insulin", steps).step
  );

  /** What the wizard sends: it logs whenever the (step, index) pair changes, so a screen that reports as the one before it adds nothing. */
  function stream(answers: OnboardingAnswers): string[] {
    const path = buildOnboardingSteps(onboardingFlags(answers));
    const sent: string[] = [];
    const send = (name: string, params: Record<string, unknown>) => {
      const res = sanitizeEvent(name, params);
      sent.push(`${name} ${JSON.stringify(res.ok ? res.props : res.issues)}`);
    };
    send("onboarding_step", onboardingStepEvent("welcome", path[0], path));
    let shown = "";
    for (const s of path) {
      const event = onboardingStepEvent("quiz", s, path);
      const key = `${event.step}|${event.index}`;
      if (key === shown) continue;
      shown = key;
      send("onboarding_step", event);
    }
    send("onboarding_step", onboardingStepEvent("reveal", path[0], path));
    send("onboarding_done", onboardingDoneEvent(path));
    return sent;
  }

  const reference = stream({ diabetes: "type1", treatment: "insulin", pillsOnly: null });
  eqList("the one stream every path sends", reference, [
    'onboarding_step {"step":"welcome","index":0}',
    'onboarding_step {"step":"analytics","index":1}',
    'onboarding_step {"step":"name","index":2}',
    'onboarding_step {"step":"unit","index":3}',
    'onboarding_step {"step":"diabetes","index":4}',
    'onboarding_step {"step":"treatment","index":5}',
    'onboarding_step {"step":"measure","index":6}',
    'onboarding_step {"step":"targets","index":7}',
    'onboarding_step {"step":"reminderPlan","index":8}',
    'onboarding_step {"step":"reveal","index":9}',
    "onboarding_done {}",
  ]);
  const differing: string[] = [];
  let combos = 0;
  for (const diabetes of [...DIABETES_OPTIONS, null]) {
    for (const treatment of [...TREATMENT_OPTIONS, null]) {
      for (const pillsOnly of [true, false, null]) {
        combos++;
        if (stream({ diabetes, treatment, pillsOnly }).join("\n") !== reference.join("\n")) {
          differing.push(`${diabetes}/${treatment}/${pillsOnly}`);
        }
      }
    }
  }
  eq("every combination of answers was tried", combos, 7 * 5 * 3);
  eqList("and none of them sends anything different", differing, []);

  const done = onboardingDoneEvent(steps);
  eqList("done has no field: the screen count was the path again", Object.keys(done), []);
  eq("and it is accepted as it is", JSON.stringify(sanitizeEvent("onboarding_done", done)), '{"ok":true,"props":{},"issues":[]}');
  ok(
    "no treatment path rides along on any path",
    ["type1", "type2", "none"].every((d) => {
      const f = onboardingFlags({ diabetes: d as DiabetesOption, treatment: "insulin", pillsOnly: true });
      return !("path" in onboardingDoneEvent(buildOnboardingSteps(f)));
    })
  );
}

section("F. the reminder step decides what 'Set up this plan' writes");
{
  const d = (glucoseRows: number, hasInsulin: boolean, basalSelected: boolean, basalInstalled: boolean) =>
    planSetupDecision({ glucoseRows, hasInsulin, basalSelected, basalInstalled });

  eq("lines left: there is something to set up", d(3, false, false, false).canSetUp, true);
  eq("every line removed and no basal: nothing to set up", d(0, true, false, false).canSetUp, false);
  eq("every line removed but basal picked: still something", d(0, true, true, false).canSetUp, true);
  eq("basal picked on a path without insulin is ignored", d(0, false, true, false).canSetUp, false);
  eq("and does not turn into a basal write", d(2, false, true, false).basal, "keep");
  eq("picked: the basal row is enabled", d(3, true, true, false).basal, "enable");
  eq("not picked, never written: left alone", d(3, true, false, false).basal, "keep");
  eq("written earlier, then un-picked: switched off", d(3, true, false, true).basal, "disable");
  eq("written earlier, then insulin dropped: switched off", d(3, false, true, true).basal, "disable");
  eq("wantBasal follows insulin and the pick", d(3, true, true, false).wantBasal, true);
  eq("wantBasal is false without insulin", d(3, false, true, false).wantBasal, false);

  const on = (hasInsulin: boolean, basalSelected: boolean, basalInstalled: boolean) =>
    basalReminderOnAtFinish({ hasInsulin, basalSelected, basalInstalled });
  eq("picked and written: the reminder stands", on(true, true, true), true);
  eq("picked but walked past with 'Not now': never created", on(true, true, false), false);
  eq("written, then un-picked: switched off", on(true, false, true), false);
  eq("written, then the insulin answer dropped: switched off", on(false, true, true), false);
  eq("never touched: no basal reminder at all", on(true, false, false), false);
}

section("G. the screen: no stray permission prompt, nothing cut left behind");
{
  const onb = src("app/onboarding.tsx");

  ok(
    "finishToReveal reads the basal write through a ref, not a stale render",
    /basalInstalled:\s*basalInstalledRef\.current/.test(onb) &&
      /basalInstalledRef\.current\s*=\s*basalWritten;\s*setBasalInstalled\(basalWritten\)/.test(onb) &&
      !/basalReminderOnAtFinish\(\{[^}]*basalInstalled\s*\}/.test(onb)
  );
  ok("goToDashboard has a ref double-tap guard", /doneRef\.current\) return;\s*doneRef\.current = true/.test(onb));

  ok("imports its steps from the shared module", onb.includes('from "../lib/onboardingSteps"'));
  for (const gone of [
    '"notify"',
    "nextFromNotify",
    "notifyResult",
    'case "widget"',
    'case "carbRatio"',
    'case "isf"',
    'case "basal"',
    "carbRatioTouched",
    "isfTouched",
  ]) {
    ok(`no ${gone} left in the screen`, !onb.includes(gone));
  }

  const finish = code(between(onb, "async function finishToReveal", "function goToDashboard"));
  ok("finishToReveal exists", finish.length > 0);
  ok("the consent question is not asked at the end any more", !/setAnalyticsConsent|markAnalyticsConsentPrompted/.test(finish));
  ok('"analytics" is the first quiz step, right after welcome', BASE_STEPS[0] === "analytics");
  ok('the analytics step has a content case and its own footer', onb.includes('case "analytics":') && onb.includes('if (step === "analytics") {'));
  ok(
    "finishing never raises an OS prompt",
    !/requestNotificationPermission|ensureAlarmAuthorizationOnce|requestAlarmAuthorization/.test(finish)
  );
  ok(
    "finishing no longer writes the calculator's numbers",
    !/carb_ratio_|insulin_sensitivity_factor|ratios_confirmed/.test(finish)
  );
  const done = code(between(onb, "async function goToDashboard", "router.replace"));
  ok("done event is built by the shared helper, once the disclaimer is accepted", done.includes("onboardingDoneEvent(") && done.includes("!accepted"));
  ok("and nothing is marked done before that", !finish.includes("completeOnboarding()") && !finish.includes("onboarding_done"));
  ok(
    "and the helper is handed the steps only, never the answers",
    done.includes("onboardingDoneEvent(steps)")
  );
  ok(
    "the basal reminder follows what the plan step wrote, not the insulin answer alone",
    /syncBasalReminderRow\(\s*basalOn/.test(finish) || /syncBasalReminderRow\(hasInsulin && basalInstalled/.test(finish)
  );

  const med = code(between(onb, "async function setupMedReminder", "async function setupReminderPlan"));
  const plan = code(between(onb, "async function setupReminderPlan", "const optDelay"));
  ok("both action bodies were found", med.length > 0 && plan.length > 0);
  const calls = onb.split("requestNotificationPermission(").length - 1;
  const inMed = med.split("requestNotificationPermission(").length - 1;
  const inPlan = plan.split("requestNotificationPermission(").length - 1;
  ok(
    "the OS notification prompt is raised only by those two user actions",
    calls === inMed + inPlan && calls >= 2,
    `calls ${calls}, med ${inMed}, plan ${inPlan}`
  );
  ok(
    "the plan step reuses the shared AlarmKit once-guard",
    plan.includes("ensureAlarmAuthorizationOnce") && plan.includes("setUpReminderPlan")
  );
  ok(
    "the plan step decides through the shared helper",
    onb.includes("planSetupDecision(") && plan.includes("planDecision.")
  );
  ok(
    "a basal row is written before the shared plan write, so one prompt chain covers both",
    plan.indexOf("syncBasalReminderRow") !== -1 &&
      plan.indexOf("syncBasalReminderRow") < plan.indexOf("setUpReminderPlan(")
  );
  ok("the step event carries an index", onb.includes("onboardingStepEvent("));
  ok(
    "the wizard logs it only when the step or the index changes, which is what keeps the optional screens silent",
    /logEvent\("onboarding_step", stepEvent\);[\s\S]{0,120}\}, \[stepEvent\.step, stepEvent\.index\]\);/.test(onb)
  );
}

section("H. ratios: who is asked, what opens empty, what confirms");
{
  // What older builds wrote into a profile nobody filled in.
  const legacy: CalcSetupProfile = {
    insulin_mode: "both",
    carb_ratio_breakfast: 10,
    carb_ratio_lunch: 12,
    carb_ratio_dinner: 12,
    insulin_sensitivity_factor: 40,
    ratios_confirmed: 0,
  };
  const oldSheetSave: CalcSetupProfile = { ...legacy, carb_ratio_lunch: 10, carb_ratio_dinner: 10 };
  const own: CalcSetupProfile = {
    ...legacy,
    carb_ratio_breakfast: 8,
    carb_ratio_lunch: 9,
    carb_ratio_dinner: 11,
    insulin_sensitivity_factor: 35,
  };
  const partial: CalcSetupProfile = { ...own, insulin_sensitivity_factor: 40 };
  const confirmed: CalcSetupProfile = { ...own, ratios_confirmed: 1 };

  // The gate: confirmed AND all four usable
  eq("no confirmation: no figure", calcFiguresAllowed(own), false);
  eq("legacy values, unconfirmed: no figure", calcFiguresAllowed(legacy), false);
  eq("confirmed: figure allowed", calcFiguresAllowed(confirmed), true);
  eq("no profile: no figure", calcFiguresAllowed(null), false);
  eq("a flag other than 1 is not a confirmation", calcFiguresAllowed({ ...own, ratios_confirmed: 2 }), false);
  eq("confirmed but a zero breakfast ratio: no figure", calcFiguresAllowed({ ...confirmed, carb_ratio_breakfast: 0 }), false);
  eq("confirmed but a zero lunch ratio: no figure", calcFiguresAllowed({ ...confirmed, carb_ratio_lunch: 0 }), false);
  eq("confirmed but a zero ISF: no figure", calcFiguresAllowed({ ...confirmed, insulin_sensitivity_factor: 0 }), false);
  eq("confirmed but a NaN ratio: no figure", calcFiguresAllowed({ ...confirmed, carb_ratio_dinner: Number.NaN }), false);

  // Who is asked
  eq("a fresh insulin profile is asked", calcSetupNeeded(legacy), true);
  eq("ratios present but unconfirmed: still asked", calcSetupNeeded(own), true);
  eq("mealtime-only is asked too", calcSetupNeeded({ ...legacy, insulin_mode: "bolus" }), true);
  eq("basal-only has no dose section: not asked", calcSetupNeeded({ ...legacy, insulin_mode: "basal" }), false);
  eq("no insulin: not asked", calcSetupNeeded({ ...legacy, insulin_mode: "none" }), false);
  eq("no profile yet: not asked", calcSetupNeeded(null), false);
  eq("a confirmed profile is left alone", calcSetupNeeded(confirmed), false);
  eq("a confirmed profile with a zero ratio is asked again", calcSetupNeeded({ ...confirmed, carb_ratio_lunch: 0 }), true);

  // Default signatures are judged per field GROUP
  const gl = unenteredGroups(legacy);
  ok("10/12/12 and 40 are both 'never entered'", gl.carbs && gl.isf);
  const gs = unenteredGroups(oldSheetSave);
  ok("the old sheet's 10/10/10 and 40 are 'never entered' too", gs.carbs && gs.isf);
  const gp = unenteredGroups(partial);
  ok("the user's own 8/9/11 is kept while a stored 40 is blank", !gp.carbs && gp.isf);
  const go = unenteredGroups({ ...own, carb_ratio_breakfast: 10, carb_ratio_lunch: 12, carb_ratio_dinner: 12 });
  ok("10/12/12 with the user's own ISF: only the ratios are blank", go.carbs && !go.isf);
  const gm = unenteredGroups({ ...legacy, carb_ratio_lunch: 11 });
  ok("a changed meal ratio makes the whole triplet the user's own", !gm.carbs && gm.isf);
  const gc = unenteredGroups({ ...legacy, ratios_confirmed: 1 });
  ok("a confirmed set is never treated as defaults", !gc.carbs && !gc.isf);

  const li = ratioFieldsInitial(legacy);
  ok("legacy values open EMPTY", li.breakfast === null && li.lunch === null && li.dinner === null && li.isfMgdl === null);
  const si = ratioFieldsInitial(oldSheetSave);
  ok("the old sheet's 10/10/10 + 40 open EMPTY", si.breakfast === null && si.dinner === null && si.isfMgdl === null);
  const pi = ratioFieldsInitial(partial);
  ok("partial: ratios 8/9/11 shown, ISF empty", pi.breakfast === 8 && pi.lunch === 9 && pi.dinner === 11 && pi.isfMgdl === null);
  const oi = ratioFieldsInitial(own);
  ok("the user's own unconfirmed numbers are shown", oi.breakfast === 8 && oi.lunch === 9 && oi.dinner === 11 && oi.isfMgdl === 35);
  const ci = ratioFieldsInitial({ ...legacy, ratios_confirmed: 1 });
  ok("a confirmed 10/12/12/40 stays shown", ci.breakfast === 10 && ci.lunch === 12 && ci.isfMgdl === 40);
  eq("a stored zero opens empty", ratioFieldsInitial({ ...own, carb_ratio_lunch: 0 }).lunch, null);
  eq("no profile opens empty", ratioFieldsInitial(null).breakfast, null);
  eq("the sheet is 'prefilled' only when all four are the user's own", calcSetupPrefilled(own), true);
  eq("partial is not prefilled", calcSetupPrefilled(partial), false);
  eq("legacy is not prefilled", calcSetupPrefilled(legacy), false);

  // One-time prompt
  eq("opens on a new record", shouldAutoOpenCalcSetup({ needed: true, isEdit: false, prompted: false }), true);
  eq("not while editing a past meal", shouldAutoOpenCalcSetup({ needed: true, isEdit: true, prompted: false }), false);
  eq("not again once offered", shouldAutoOpenCalcSetup({ needed: true, isEdit: false, prompted: true }), false);
  eq("not when nothing is missing", shouldAutoOpenCalcSetup({ needed: false, isEdit: false, prompted: false }), false);
  eq("the one-time flag base", RATIOS_CONFIRM_PROMPTED_KEY, "zerospike.ratiosConfirmPrompted");

  // The shared draft write (sheet and Profile): every filled value is kept
  const shown = ratioFieldsInitial(own);
  const three = ratioDraftPatch(legacy, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: null });
  ok("three ratios without an ISF are still written", three != null);
  eq("the three ratios are kept (8)", three?.carb_ratio_breakfast, 8);
  eq("the three ratios are kept (9)", three?.carb_ratio_lunch, 9);
  eq("the three ratios are kept (11)", three?.carb_ratio_dinner, 11);
  eq("the missing ISF is stored as 'not entered' (0)", three?.insulin_sensitivity_factor, 0);
  eq("a partial set is marked as the user's own, not confirmed", three?.ratios_confirmed, RATIOS_ENTERED);
  eq("a partial set shows no figure", calcFiguresAllowed({ ...legacy, ...(three as NonNullable<typeof three>) }), false);
  const back = ratioFieldsInitial({ ...legacy, ...(three as NonNullable<typeof three>) });
  ok("and the three ratios are what Profile opens with", back.breakfast === 8 && back.lunch === 9 && back.dinner === 11 && back.isfMgdl === null);
  const tens = ratioDraftPatch(legacy, { breakfast: 10, lunch: 10, dinner: 10, isfMgdl: 40 });
  eq("a deliberate 10/10/10 + 40 is marked as entered, not left looking like old defaults", tens?.ratios_confirmed, RATIOS_ENTERED);
  const tensStored = { ...legacy, ...(tens as NonNullable<typeof tens>) };
  const tensBack = ratioFieldsInitial(tensStored);
  ok("and it opens filled, not blank", tensBack.breakfast === 10 && tensBack.lunch === 10 && tensBack.isfMgdl === 40);
  ok("an entered set is never read as defaults", !unenteredGroups(tensStored).carbs && !unenteredGroups(tensStored).isf);
  eq("an empty draft over a stored set clears it (0 = not entered)", ratioDraftPatch(own, { breakfast: null, lunch: null, dinner: null, isfMgdl: null })?.carb_ratio_lunch, 0);
  eq("an empty draft over a stored set is flagged 0", ratioDraftPatch(own, { breakfast: null, lunch: null, dinner: null, isfMgdl: null })?.ratios_confirmed, 0);
  eq("no profile: nothing", ratioDraftPatch(null, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 }), null);
  const unticked = three as NonNullable<typeof three>;
  eq("an unticked save is still asked", calcSetupNeeded({ ...legacy, ...unticked }), true);
  const fullEntry = ratioDraftPatch(legacy, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 });
  eq("a full entry is not yet a confirmation", fullEntry?.ratios_confirmed, RATIOS_ENTERED);
  eq("ticking the stored full entry confirms it", ratioConfirmPatch({ ...legacy, ...(fullEntry as NonNullable<typeof fullEntry>) }, true)?.ratios_confirmed, 1);
  eq("a confirmed full entry is no longer asked", calcSetupNeeded({ ...legacy, ...(fullEntry as NonNullable<typeof fullEntry>), ratios_confirmed: 1 }), false);

  // Profile and Targets: a changed set withdraws the confirmation
  eq("typing the same numbers back changes nothing", ratioDraftPatch(confirmed, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 }), null);
  const changed = ratioDraftPatch(confirmed, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 36 });
  eq("a changed ISF withdraws the confirmation", changed?.ratios_confirmed, RATIOS_ENTERED);
  eq("and writes the new value", changed?.insulin_sensitivity_factor, 36);
  eq("a changed carb ratio withdraws the confirmation", ratioDraftPatch(confirmed, { breakfast: 7.5, lunch: 9, dinner: 11, isfMgdl: 35 })?.ratios_confirmed, RATIOS_ENTERED);
  eq("an unusable value is stored as 0", ratioDraftPatch(confirmed, { breakfast: 0, lunch: 9, dinner: 11, isfMgdl: 35 })?.carb_ratio_breakfast, 0);
  eq("legacy values typed back verbatim are marked as entered", ratioDraftPatch(legacy, { breakfast: 10, lunch: 12, dinner: 12, isfMgdl: 40 })?.ratios_confirmed, RATIOS_ENTERED);
  eq("an entered set typed back verbatim writes nothing", ratioDraftPatch({ ...own, ratios_confirmed: RATIOS_ENTERED }, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 }), null);
  eq("the draft differs from a confirmed set", ratioDraftDiffers(confirmed, { breakfast: 7, lunch: 9, dinner: 11, isfMgdl: 35 }), true);
  eq("an identical draft does not differ", ratioDraftDiffers(confirmed, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 }), false);

  // mmol/L screens: a rounded display value is not a change
  const confirmedMmol: CalcSetupProfile = { ...confirmed, insulin_sensitivity_factor: 42 };
  eq("mmol: 42 mg/dL shows 2.3, and 41 (also 2.3) is the same value", ratioDraftPatch(confirmedMmol, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 41 }, "mmol"), null);
  eq("mg/dL: 42 and 41 are different", ratioDraftPatch(confirmedMmol, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 41 }, "mgdl")?.insulin_sensitivity_factor, 41);
  eq("mmol: one tenth up (2.4 = 43 mg/dL) is a change", ratioDraftPatch(confirmedMmol, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 43 }, "mmol")?.insulin_sensitivity_factor, 43);
  eq("mmol: the stored set still matches the shown draft", ratioSetMatchesStored(confirmedMmol, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 41 }, "mmol"), true);
  eq("mg/dL: it does not", ratioSetMatchesStored(confirmedMmol, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 41 }, "mgdl"), false);

  eq("the box confirms a stored set", ratioConfirmPatch(own, true)?.ratios_confirmed, 1);
  eq("the box cannot confirm an unusable set", ratioConfirmPatch({ ...own, carb_ratio_dinner: 0 }, true), null);
  eq("unticking withdraws it but keeps the numbers marked as the user's own", ratioConfirmPatch(confirmed, false)?.ratios_confirmed, RATIOS_ENTERED);
  eq("unticking an empty profile leaves it at 0", ratioConfirmPatch({ ...legacy, carb_ratio_breakfast: 0, carb_ratio_lunch: 0, carb_ratio_dinner: 0, insulin_sensitivity_factor: 0 }, false)?.ratios_confirmed, 0);
  eq("the draft matches the stored set", ratioSetMatchesStored(own, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 }), true);
  eq("a different draft does not", ratioSetMatchesStored(own, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 36 }), false);
  eq("an empty draft does not", ratioSetMatchesStored(own, { breakfast: null, lunch: null, dinner: null, isfMgdl: null }), false);
}

section("I. the unit figure exists only behind the gate");
{
  const food = { carb_100g: 50 };
  const prof = {
    carb_ratio_breakfast: 10,
    carb_ratio_lunch: 10,
    carb_ratio_dinner: 10,
    insulin_sensitivity_factor: 40,
    target_postmeal_min: 80,
    target_postmeal_max: 140,
  };
  eq("no confirmation: no estimate at all", estimateInsulinConfirmed(food, 100, { ...prof, ratios_confirmed: 0 }, { slot: "lunch" }), null);
  eq(
    "no confirmation, with a reading: still none",
    estimateInsulinConfirmed(food, 100, { ...prof, ratios_confirmed: 0 }, { slot: "lunch", currentGlucose: 220 }),
    null
  );
  eq("confirmed but a zero ISF: none (the division is never reached)", estimateInsulinConfirmed(food, 100, { ...prof, insulin_sensitivity_factor: 0, ratios_confirmed: 1 }, { slot: "lunch" }), null);
  eq("confirmed but a zero ratio: none", estimateInsulinConfirmed(food, 100, { ...prof, carb_ratio_lunch: 0, ratios_confirmed: 1 }, { slot: "lunch" }), null);
  const open = estimateInsulinConfirmed(food, 100, { ...prof, ratios_confirmed: 1 }, { slot: "lunch" });
  const direct = estimateInsulin(food, 100, prof, { slot: "lunch" });
  ok("confirmed: an estimate", open != null);
  eq("confirmed: the old result, total", open?.totalDose, direct.totalDose);
  eq("confirmed: the old result, meal dose", open?.mealDose, direct.mealDose);
  eq("confirmed: 50 g at 1:10 is 5 U", open?.totalDose, 5);
  eq("carbs need no ratio", carbsForPortion(food, 100), 50);
  eq("carbs round to one decimal", carbsForPortion({ carb_100g: 33.333 }, 100), 33.3);

  // A zero ratio never reaches the arithmetic (it used to be floored at 0.1 = 500 U)
  const zero = estimateInsulin(food, 100, { ...prof, carb_ratio_lunch: 0 }, { slot: "lunch" });
  eq("a zero ratio yields no dose, not 500 U", zero.totalDose, 0);
  eq("and no meal dose", zero.mealDose, 0);
  ok("and says the ratio is out of range", zero.warnings.includes("carb_ratio_out_of_range"));
  eq("a NaN ratio yields no dose", estimateInsulin(food, 100, { ...prof, carb_ratio_lunch: Number.NaN }, { slot: "lunch" }).totalDose, 0);
  eq("a negative ratio yields no dose", estimateInsulin(food, 100, { ...prof, carb_ratio_lunch: -4 }, { slot: "lunch" }).totalDose, 0);
  eq("a zero ratio still reports the carbs", zero.carbs, 50);
}

section("J. the calculator screen wires the gate");
{
  const calc = src("app/calculator.tsx");

  ok("asks through the shared predicate", calc.includes("calcSetupNeeded("));
  ok("opens by itself only through the shared rule", calc.includes("shouldAutoOpenCalcSetup("));
  ok("the sheet writes through the shared hook, the same one Profile uses", calc.includes("useRatioWriter(") && src("app/settings/profile.tsx").includes("useRatioWriter("));
  ok("every sheet edit goes to the writer", /function change\([^)]*\)\s*\{[\s\S]{0,200}getWriter\(\)\?\.update\(next\)/.test(calc));
  ok("the box confirms through the writer", /getWriter\(\)\?\.confirm\(next\)/.test(calc));
  ok("the sheet opens on a fresh writer", /getWriter\(\{ renew: true \}\)/.test(calc));
  ok("closing the sheet writes what is pending", /function closeSetup\(\)\s*\{[\s\S]{0,160}void ratioWriters\.get\(\)\?\.flush\(\)/.test(calc));
  ok("the sheet no longer writes the profile itself", !/updateProfile\(/.test(calc) && !calc.includes("calcSetupPatch"));
  ok("a ticked box that reached the profile ticks the card and leaves the sheet open for Save", /if \(next && confirmStillCurrent\(ok, sent, fieldsRef\.current\)\) hapticSuccess\(\)/.test(calc) && !calc.includes("onConfirmed"));
  ok("the confirmation is a card that says what ticking does", calc.includes("<RatioConfirmCard") && src("components/RatioConfirmCard.tsx").includes('t("ratioConfirm.until")'));
  ok("the unconfirmed state is a card with no number (the shared line)", !calc.includes("PendingDoseCard") && src("components/RatioStateCard.tsx").includes("ratioConfirm.confirmTitle") && !/(heroDose|totalDose|num\()/.test(src("components/RatioStateCard.tsx")));
  ok("the hero stays behind the original gate", calc.includes("!calcFiguresAllowed(activeProfile) ? null") && !calc.includes("ratios_confirmed !== 1"));
  ok("the ratio line returns here after a confirmation in Profile", calc.split("returnAfterConfirm").length === 3 && calc.split("onOpenSetup={openSetup}").length === 3);
  ok("uses the shared bottom sheet", calc.includes("SheetShell"));
  ok("the one-time flag is per profile", calc.includes("RATIOS_CONFIRM_PROMPTED_KEY"));
  ok("the sheet has the confirm card", calc.includes("RatioConfirmCard") && src("components/RatioConfirmCard.tsx").includes("calculator.setup.confirm"));
  ok("the sheet shows three meal fields", /\(\["breakfast", "lunch", "dinner"\] as const\)\.map\(\(slot\)/.test(calc));
  ok("the sheet fields are the shared ratio inputs (empty start)", calc.includes("<CarbRatioInput") && calc.includes("<IsfInput"));
  ok("the sheet has no single 'every meal' ratio", !calc.includes("perMealNote") && !/initialCarbRatio/.test(calc));
  ok("any change in the sheet un-ticks the box", /function change\([^)]*\)\s*\{[\s\S]{0,160}getWriter\(\)\?\.update\(next\)/.test(calc) && calc.includes("ratioCardChecked(profile, fields, unit)") && !calc.includes("setConfirmed"));
  ok("the intro differs when the values are already saved", calc.includes("calculator.setup.bodyFilled"));
  ok("a profile with no mealtime insulin never reaches the sheet", /showsDose/.test(calc));
  ok("no default-ratios notice", !calc.includes("defaultRatios"));
  ok("the unit estimate comes only from the gated entry point", calc.includes("estimateInsulinConfirmed(") && !/\bestimateInsulin\(/.test(calc));
  ok("carbs are read without a ratio", calc.includes("carbsForPortion("));
  ok("the hero and breakdown sit behind the gated estimate", /\{doseEst \? \(\s*<>\s*\{\/\* Hero/.test(calc));
  ok("the hero number is not rendered outside that block", calc.split("{heroDose}").length === 2);
  ok("the skeleton hero is hidden without confirmed ratios", calc.includes("!calcFiguresAllowed(activeProfile) ? null"));
  ok("the dose field starts blank", calc.includes('const [doseText, setDoseText] = useState("");'));
  const setCalls = calc.match(/setDoseText\([^;]*;/g) ?? [];
  ok(
    "the dose field is filled only from a saved record or the user's typing",
    setCalls.length === 2 &&
      setCalls.every((c) => /openedDose|v == null \? "" : String\(v\)/.test(c)),
    setCalls.join(" | ")
  );
  ok("the dose is typed or stepped in the shared field, never computed", /function onDoseChange\(v: number \| null\)/.test(calc) && calc.split("onChange={onDoseChange}").length === 2);
  ok("the dose field is the shared NumericField, 0-100 in steps of 0.5", calc.includes("DOSE_BOUNDS.step") && calc.includes("DOSE_BOUNDS.max") && calc.includes("<NumericField"));
  ok("the dose is never seeded from the estimate", !/setDoseText\([^;]*(totalDose|doseEst|estimate)/.test(calc));
  ok("the typed dose is what is saved", calc.includes("dose = typedDose"));

  const line = src("components/CarbRatioLine.tsx");
  ok("the ratio line quotes a number only when confirmed", line.includes("calcFiguresAllowed(activeProfile)"));
  ok("the ratio line otherwise shows the enter or confirm card", line.includes('t("ratio.enter")') && line.includes("<RatioStateCard") && src("components/RatioStateCard.tsx").includes("ratioConfirm.confirmAction"));

  const keys = src("lib/profileScopedKeys.ts");
  ok("the one-time flag is swept with the profile", keys.includes(RATIOS_CONFIRM_PROMPTED_KEY));
  ok("the old flag is still swept", keys.includes(LEGACY_CALC_SETUP_DISMISSED_KEY));
}

section("K. no default-ratio constants, and ratio maths only where allowed");
{
  const walk = (dir: string, out: string[]): string[] => {
    const nodeFs = require("fs") as {
      readdirSync: (p: string, o: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[];
    };
    for (const e of nodeFs.readdirSync(nodePath.join(ROOT, dir), { withFileTypes: true })) {
      const rel = nodePath.join(dir, e.name);
      if (e.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
    }
    return out;
  };
  const files = [...walk("app", []), ...walk("lib", []), ...walk("components", [])];
  const hits = files.filter((f) => /DEFAULT_CARB_RATIO|DEFAULT_ISF/.test(src(f)));
  eq("DEFAULT_CARB_RATIO / DEFAULT_ISF_MGDL are gone from app, lib, components", hits.join(","), "");

  const callers = (needle: RegExp) =>
    files.filter((f) => needle.test(src(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))).sort();
  eqList("estimateInsulin( is called only inside lib/insulin.ts", callers(/\bestimateInsulin\(/), ["lib/insulin.ts"]);
  eqList(
    "estimateInsulinConfirmed( is called only by the calculator",
    callers(/\bestimateInsulinConfirmed\(/).filter((f) => f !== "lib/insulin.ts"),
    ["app/calculator.tsx"]
  );
  eqList(
    "carbRatioForSlot( is read only by the insulin maths, the ratio line and the calculator",
    callers(/\bcarbRatioForSlot\(/),
    ["app/calculator.tsx", "components/CarbRatioLine.tsx", "lib/insulin.ts"]
  );
  const carbOnlyReads = files.filter((f) => /\.carb_ratio_(breakfast|lunch|dinner)\b|\.insulin_sensitivity_factor\b/.test(src(f))).sort();
  eqList(
    "no screen or component reads a stored ratio directly (only lib logic does)",
    carbOnlyReads.filter((f) => f.startsWith("app") || f.startsWith("components")),
    []
  );
  const setup = src("lib/calcSetup.ts");
  ok("calcSetup supplies no starting number to a sheet", !/calcSetupInitial/.test(setup));
  const ps = src("app/profile-setup.tsx");
  ok("profile-setup no longer seeds 10 / 12 / 40", !/useState\(activeProfile\?\.carb_ratio/.test(ps) && !/insulin_sensitivity_factor \?\? 40/.test(ps));
  ok("profile-setup confirms only with the tick", ps.includes("ratiosTick") && ps.includes("ratios_confirmed"));
  eq("profile-setup un-ticks on every value change", (ps.match(/setRatiosTick\(false\)/g) ?? []).length, 2);
  const prof = src("lib/db/profiles.ts");
  ok("new profiles carry no ratio numbers", !/carb_ratio_breakfast \?\? 10/.test(prof) && !/insulin_sensitivity_factor \?\? 40/.test(prof));
  ok("a new profile row carries 'not entered' (0), once", prof.split("VALUES (?, ?, 0, 0, 0, 0, 80").length === 2);
  const idx = src("lib/db/index.ts");
  ok("the default profile row carries 'not entered' (0)", idx.includes("VALUES (?, ?, 0, 0, 0, 0, 80"));
  const seed = src("lib/db/screenshotSeed.ts");
  ok("the tracking profile row carries 'not entered' (0)", seed.includes("VALUES (?, ?, 0, 0, 0, 0, 80"));
  ok(
    "the store-image profiles get explicit usable ratios beside ratios_confirmed 1",
    (seed.match(/carb_ratio_breakfast: 10,[\s\S]{0,200}ratios_confirmed: 1,/g) ?? []).length === 2
  );
  const sp = src("app/settings/profile.tsx");
  ok("Profile and Targets writes through the queued writer", sp.includes("useRatioWriter(") && sp.includes("ratioWriters.get()?.update("));
  ok("it no longer saves per keystroke or confirms on every change", !sp.includes("persistRatio") && !sp.includes("ratioSetPatch("));
  ok("the box is in Profile and Targets, the same card", sp.includes("<RatioConfirmCard") && ps.includes("<RatioConfirmCard"));
  ok("every ratio field flushes on blur (ISF and the three meal fields)", (sp.match(/onBlur=\{onRatioBlur\}/g) ?? []).length === 2);
}

section("L. the new strings exist in all nine languages");
{
  const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  for (const l of langs) {
    const s = src(`lib/i18n/locales/${l}.ts`);
    ok(`${l}: ratio.enter`, /\n  ratio: \{[\s\S]*?\n    enter: "[^"]+"/.test(s));
    ok(`${l}: setup.teamNote`, /\n      teamNote: "[^"]+"/.test(s));
    ok(`${l}: setup.confirm`, /\n      confirm: "[^"]+"/.test(s));
    ok(`${l}: setup.bodyFilled`, /\n      bodyFilled: "[^"]+"/.test(s));
    ok(`${l}: settings.ratiosReconfirmHint`, /\n    ratiosReconfirmHint: "[^"]+"/.test(s));
    ok(`${l}: whatsNew.itemCalc`, /\n    itemCalc: "[^"]+"/.test(s));
    ok(`${l}: no default-ratios notice left`, !s.includes("defaultRatiosTitle") && !s.includes("defaultRatiosBody"));
    ok(`${l}: the single-ratio note is gone`, !s.includes("perMealNote"));
    ok(`${l}: the old not-set line is gone`, !/\n    notSet: /.test(s.slice(s.indexOf("\n  ratio: {"), s.indexOf("\n  ratio: {") + 400)));
  }
  const tr = src("lib/i18n/locales/tr.ts");
  ok("tr confirm text is the agreed one", tr.includes('confirm: "Bu oranları diyabet ekibimle belirledim"'));
  ok("tr enter text is the agreed one", tr.includes('enter: "Oranlarınızı girin"'));
  ok("tr note text is the agreed one", tr.includes('teamNote: "Oranlarınızı diyabet ekibinizle belirleyin."'));
  ok("pt uses 'razoes' on the ratio line", src("lib/i18n/locales/pt.ts").includes('enter: "Informe suas razões"'));
}

section("N. the v27 reset and the sheet's reach");
{
  const mig = src("lib/db/migrations.ts");
  ok("the migration runs the flag reset and stamps 27 in one transaction", /migrateToV27[\s\S]{0,300}withTransactionAsync[\s\S]{0,200}V27_RESET_RATIO_CONFIRMATION[\s\S]{0,120}stampSchemaVersion\(db, 27\)/.test(mig));
  const v27 = src("lib/db/v27Sql.ts");
  ok("the SQL names only the flag", /UPDATE user_profiles SET ratios_confirmed = 0;/.test(v27) && !/carb_ratio|insulin_sensitivity|injection_logs/.test(v27.split("export const")[1] ?? ""));
}

section("O. how the person measures: step order, default, reminders skipped, denial falls back");
{
  const flagsOf = (answers: OnboardingAnswers) => onboardingFlags(answers);
  const insulinA: OnboardingAnswers = { diabetes: "type1", treatment: "insulin", pillsOnly: null };
  const pillsA: OnboardingAnswers = { diabetes: "type2", treatment: "pills", pillsOnly: null };
  const noneA: OnboardingAnswers = { diabetes: "type2", treatment: "none", pillsOnly: null };

  eqList("three options in the agreed order", MEASURE_OPTIONS, ["finger", "cgm", "nightscout"]);
  eq("the finger prick is the default", DEFAULT_MEASURE, "finger");

  for (const a of [insulinA, pillsA, noneA]) {
    const steps = buildOnboardingSteps({ ...flagsOf(a), measure: "finger" });
    const at = steps.indexOf("measure");
    ok("the measure step exists", at !== -1);
    eq("it sits right after the treatment question", steps[at - 1], flagsOf(a).isTwoWayTreatment ? "pillsOnly" : "insulin");
    eq("and right before the targets", steps[at + 1], "targets");
    eqList(
      "no measure answer is the same list as the finger prick",
      buildOnboardingSteps(flagsOf(a)),
      steps
    );
    ok("the finger prick keeps the reminder plan, last", steps[steps.length - 1] === "reminderPlan");
    ok("measure is a required screen", !OPTIONAL_STEPS.includes("measure"));
  }

  for (const m of ["cgm", "nightscout"] as const) {
    const noIns = buildOnboardingSteps({ ...flagsOf(noneA), measure: m });
    ok(`${m}: the measurement reminder plan is skipped without insulin`, !noIns.includes("reminderPlan"));
    const pills = buildOnboardingSteps({ ...flagsOf(pillsA), measure: m });
    ok(`${m}: the medication reminder step stays`, pills.includes("medReminder"));
    ok(`${m}: and the plan step is gone`, !pills.includes("reminderPlan"));
    const ins = buildOnboardingSteps({ ...flagsOf(insulinA), measure: m });
    ok(`${m}: an insulin user keeps the step that carries the night reminder`, ins.includes("reminderPlan"));
    eq(`${m}: reminders are skipped`, skipsMeasurementReminders(m), true);
  }
  eq("finger: reminders are not skipped", skipsMeasurementReminders("finger"), false);

  eq("finger writes manual (the last answer wins over an abandoned attempt)", measureModeToWrite("finger"), "manual");
  eq("cgm writes cgm", measureModeToWrite("cgm"), "cgm");
  eq("nightscout writes nightscout", measureModeToWrite("nightscout"), "nightscout");

  eq("cgm granted stays cgm", JSON.stringify(measureAfterPermission("cgm", true)), '{"measure":"cgm","fellBack":false}');
  eq("cgm denied drops to the finger prick", JSON.stringify(measureAfterPermission("cgm", false)), '{"measure":"finger","fellBack":true}');
  eq("nightscout never depends on the permission", JSON.stringify(measureAfterPermission("nightscout", false)), '{"measure":"nightscout","fellBack":false}');
  eq("finger never depends on it either", JSON.stringify(measureAfterPermission("finger", false)), '{"measure":"finger","fellBack":false}');
  eq("only nightscout is handed off to Data sources", nightscoutHandoff("nightscout"), true);
  eq("cgm is not", nightscoutHandoff("cgm"), false);

  const skipped = buildOnboardingSteps({ ...flagsOf(noneA), measure: "cgm" });
  const kept = buildOnboardingSteps({ ...flagsOf(insulinA), measure: "cgm" });
  eq(
    "the reveal index is the same whether or not the plan step was shown",
    onboardingStepEvent("reveal", "name", skipped).index,
    onboardingStepEvent("reveal", "name", kept).index
  );
  eq("and it is the finger prick's too", onboardingStepEvent("reveal", "name", skipped).index, 9);
  eq("measure reports under its own name", onboardingStepEvent("quiz", "measure", skipped).step, "measure");
  eq("at the index after the treatment question", onboardingStepEvent("quiz", "measure", skipped).index, 6);
  eq("targets follow it", onboardingStepEvent("quiz", "targets", skipped).index, 7);
  eq(
    "measure passes the event schema",
    JSON.stringify(sanitizeEvent("onboarding_step", onboardingStepEvent("quiz", "measure", skipped)).ok),
    "true"
  );
  eq(
    "and so does the mode event for each mode",
    ["manual", "cgm", "nightscout"].every((mode) => sanitizeEvent("cgm_mode_set", { mode }).ok),
    true
  );

  const onb = src("app/onboarding.tsx");
  const finish = code(between(onb, "async function finishToReveal", "async function goToDashboard"));
  ok("finish writes the mode through setCgmMode", finish.includes("setCgmMode(") && finish.includes("measureModeToWrite("));
  ok("and reports it as cgm_mode_set", /logEvent\("cgm_mode_set",\s*\{\s*mode/.test(finish));
  ok("the sensor event is sent only for a non-manual choice", /if \(cgmMode !== "manual"\) logEvent\("cgm_mode_set"/.test(finish));
  ok("the step list is built with the measure answer", /buildOnboardingSteps\(\{[^}]*measure/.test(onb));
  const pick = code(between(onb, "async function pickMeasure", "async function goToDashboard"));
  ok("the pick handler exists", pick.length > 0);
  ok("choosing CGM asks the Health permission right away", pick.includes("requestHealthPermissions("));
  ok("the answer is folded through the shared rule", pick.includes("measureAfterPermission("));
  ok(
    "the permission is requested nowhere but the pick handler",
    onb.split("requestHealthPermissions(").length - 1 === 1
  );
  ok(
    "a denial tells the person",
    pick.includes("setMeasureDenied(true)") && onb.includes('t("onboarding.measureDenied"')
  );
  ok("no plan rows are written for a sensor mode", /skipsMeasurementReminders\(/.test(onb));
  ok("the reveal is told the mode", /measure:\s*cgmMode|cgmMode:|cgmMode,/.test(finish) || /measure:\s*measureMode/.test(finish));
  ok("the Nightscout hand-off note is shown", onb.includes("measureNightscoutNote"));
  ok("the store name comes from the platform label key", onb.includes("healthStoreLabelKey("));
  ok("the CGM option is hidden where there is no Health provider", onb.includes("hasHealthProvider()"));
  ok("the finger prick is written as manual too, so an abandoned CGM attempt cannot linger", /setCgmMode\(activeProfile\.id, cgmMode, \{ keepOffer: true \}\)/.test(onb) && measureModeToWrite("finger") === "manual");

  const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  const keys = [
    "qMeasure",
    "qMeasureHint",
    "measure_finger",
    "measure_cgm",
    "measure_nightscout",
    "measureFingerHint",
    "measureCgmHint",
    "measureNightscoutHint",
    "measureNightscoutNote",
    "measureDenied",
    "planFirstSync",
    "planConnectSource",
  ];
  for (const l of langs) {
    const s = src(`lib/i18n/locales/${l}.ts`);
    const onboardingBlock = between(s, "\n  onboarding: {", "\n  tabs: {");
    for (const k of keys) {
      ok(`${l}: onboarding.${k}`, new RegExp(`\\n    ${k}:\\s*\\n?\\s*"[^"]+"`).test(onboardingBlock));
    }
    ok(`${l}: dashboard.stepSync`, /\n    stepSync: "[^"]+"/.test(s));
  }
  const trLoc = src("lib/i18n/locales/tr.ts");
  ok("tr: the agreed finger label", trLoc.includes('measure_finger: "Parmaktan ölçüm"'));
  ok("tr: the question", trLoc.includes('qMeasure: "Nasıl ölçüyorsunuz?"'));
  ok("tr: the first-sync step", trLoc.includes('stepSync: "İlk eşitleme"'));
  const en = src("lib/i18n/locales/en.ts");
  ok("the CGM label carries the store placeholder, not a brand", /measure_cgm: "CGM \(\{\{store\}\}\)"/.test(en));
  for (const l of langs) {
    const s = src(`lib/i18n/locales/${l}.ts`);
    const block =
      between(s, "    qMeasure:", "    qTargets:") + between(s, "    planFirstSync:", "    revealBasalTip:");
    ok(`${l}: no em-dash in the new strings`, !block.includes("—"));
    ok(`${l}: no real-time claim`, !/real.?time|gerçek zamanlı|en temps réel|Echtzeit|tiempo real|tempo reale|tempo real|リアルタイム|الوقت الفعلي|الزمن الحقيقي/i.test(block));
  }
}

async function writerTests(): Promise<void> {
  section("M. the queued writer: no half-typed value is left behind, order is kept");
  {
    const stored: StoredRatios = {
      carb_ratio_breakfast: 8,
      carb_ratio_lunch: 9,
      carb_ratio_dinner: 11,
      insulin_sensitivity_factor: 35,
      ratios_confirmed: 1,
    };
    type Timer = { fn: () => void; ms: number; live: boolean };
    function rig(opts: { slow?: boolean } = {}) {
      const timers: Timer[] = [];
      const patches: RatioPatch[] = [];
      const gates: (() => void)[] = [];
      let running = 0;
      let maxRunning = 0;
      const writer = createRatioWriter({
        stored,
        delayMs: 700,
        setTimer: (fn, ms) => {
          const t: Timer = { fn, ms, live: true };
          timers.push(t);
          return t;
        },
        clearTimer: (t) => {
          (t as Timer).live = false;
        },
        persist: async (patch) => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          patches.push(patch);
          if (opts.slow) await new Promise<void>((r) => gates.push(r));
          running--;
        },
      });
      const fire = () => {
        for (const t of timers) {
          if (t.live) {
            t.live = false;
            t.fn();
          }
        }
      };
      return { writer, timers, patches, gates, fire, maxRunning: () => maxRunning };
    }
    const draft = (b: number | null, isf = 35): RatioFields => ({ breakfast: b, lunch: 9, dinner: 11, isfMgdl: isf });
  
    const noNumbers = (ps: RatioPatch[]) => ps.filter((p) => p.carb_ratio_breakfast !== undefined);
    // "1" then "2" (12): the 1 is never written; the confirmation goes at once
    {
      const r = rig();
      r.writer.update(draft(1));
      r.writer.update(draft(12));
      for (let i = 0; i < 6; i++) await Promise.resolve();
      eq("typing writes no number before the pause", noNumbers(r.patches).length, 0);
      eq("but the first edit of a confirmed set withdraws the confirmation at once", JSON.stringify(r.patches[0]), JSON.stringify({ ratios_confirmed: RATIOS_ENTERED }));
      eq("and only once", r.patches.length, 1);
      ok("the pause is at least 600 ms", r.timers.every((t) => t.ms >= 600));
      r.fire();
      await r.writer.flush();
      eq("one number write after the pause", noNumbers(r.patches).length, 1);
      eq("it carries 12", noNumbers(r.patches)[0].carb_ratio_breakfast, 12);
      ok("the half-typed 1 never reached the database", !r.patches.some((p) => p.carb_ratio_breakfast === 1));
      eq("and it is not a confirmation", noNumbers(r.patches)[0].ratios_confirmed, RATIOS_ENTERED);
    }
    // blur flushes before the pause ends
    {
      const r = rig();
      r.writer.update(draft(12));
      await r.writer.flush();
      eq("a blur writes the number at once", noNumbers(r.patches).length, 1);
      r.fire();
      await r.writer.flush();
      eq("and the cancelled timer writes nothing more", noNumbers(r.patches).length, 1);
    }
    // compares against what was SENT, not the stale stored profile
    {
      const r = rig();
      r.writer.update(draft(12));
      await r.writer.flush();
      r.writer.update(draft(8));
      await r.writer.flush();
      eq("changing back to the original value is still written", noNumbers(r.patches).length, 2);
      eq("the second write restores 8", noNumbers(r.patches)[1].carb_ratio_breakfast, 8);
    }
    // the same numbers typed back change nothing
    {
      const r = rig();
      r.writer.update(draft(8));
      await r.writer.flush();
      eq("typing the stored numbers writes nothing", r.patches.length, 0);
    }
    // ISF goes through the same path
    {
      const r = rig();
      r.writer.update(draft(8, 3));
      r.writer.update(draft(8, 36));
      await r.writer.flush();
      eq("an ISF edit is one number write", noNumbers(r.patches).length, 1);
      eq("with the final ISF", noNumbers(r.patches)[0].insulin_sensitivity_factor, 36);
      ok("the half-typed 3 never reached the database", !r.patches.some((p) => p.insulin_sensitivity_factor === 3));
    }
    // writes are strictly sequential and in order
    {
      const r = rig({ slow: true });
      r.writer.update(draft(12));
      const first = r.writer.flush();
      r.writer.update(draft(13));
      const second = r.writer.flush();
      await Promise.resolve();
      await Promise.resolve();
      eq("the second write waits for the first", r.patches.length, 1);
      let opened = 0;
      let finished = false;
      const done = Promise.all([first, second]).then(() => {
        finished = true;
      });
      for (let i = 0; i < 40 && !finished; i++) {
        await Promise.resolve();
        while (opened < r.gates.length) r.gates[opened++]();
      }
      await done;
      eq("never two at once", r.maxRunning(), 1);
      eq("in the order they were made (12 then 13)", noNumbers(r.patches).map((p) => p.carb_ratio_breakfast).join(","), "12,13");
    }
    // emptying a field: the confirmation goes, the field is stored as 'not entered'
    {
      const r = rig();
      r.writer.update(draft(null));
      await r.writer.flush();
      eq("an emptied field withdraws the confirmation first", JSON.stringify(r.patches[0]), JSON.stringify({ ratios_confirmed: RATIOS_ENTERED }));
      eq("then stores the field as 0", r.patches[1].carb_ratio_breakfast, 0);
      eq("the others are kept", `${r.patches[1].carb_ratio_lunch},${r.patches[1].carb_ratio_dinner},${r.patches[1].insulin_sensitivity_factor}`, "9,11,35");
    }
    // three ratios typed over an empty profile survive leaving
    {
      const empty: StoredRatios = {
        carb_ratio_breakfast: 0,
        carb_ratio_lunch: 0,
        carb_ratio_dinner: 0,
        insulin_sensitivity_factor: 0,
        ratios_confirmed: 0,
      };
      const patches: RatioPatch[] = [];
      const w = createRatioWriter({ stored: empty, persist: async (p) => void patches.push(p) });
      w.update({ breakfast: 8, lunch: 9, dinner: 11, isfMgdl: null });
      await w.flush();
      eq("three ratios are written without waiting for the fourth", patches.length, 1);
      eq("as typed", `${patches[0].carb_ratio_breakfast},${patches[0].carb_ratio_lunch},${patches[0].carb_ratio_dinner},${patches[0].insulin_sensitivity_factor}`, "8,9,11,0");
      eq("marked as the user's own", patches[0].ratios_confirmed, RATIOS_ENTERED);
      w.update({ breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 });
      const ok1 = await w.confirm(true);
      eq("ticking writes the whole set and the confirmation as ONE patch", patches.length, 2);
      eq("the fourth completes the set", patches[1].insulin_sensitivity_factor, 35);
      eq("in that same patch the flag is 1", patches[1].ratios_confirmed, 1);
      eq("and reports that it did", ok1, true);
    }
    // ticking a set that cannot be divided by confirms nothing
    {
      const patches: RatioPatch[] = [];
      const part: StoredRatios = {
        carb_ratio_breakfast: 8,
        carb_ratio_lunch: 9,
        carb_ratio_dinner: 11,
        insulin_sensitivity_factor: 0,
        ratios_confirmed: 2,
      };
      const w = createRatioWriter({ stored: part, persist: async (p) => void patches.push(p) });
      const res = await w.confirm(true);
      eq("no confirmation is written for a partial set", patches.length, 0);
      eq("and confirm reports false", res, false);
    }
    // the unit decides what counts as a change
    {
      const patches: RatioPatch[] = [];
      const w = createRatioWriter({
        stored: { ...stored, insulin_sensitivity_factor: 42 },
        unit: () => "mmol",
        persist: async (p) => void patches.push(p),
      });
      w.update({ breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 41 });
      await w.flush();
      eq("mmol: typing back the displayed 2.3 changes nothing", patches.length, 0);
    }
    // the box: pending numbers first, then the flag
    {
      const r = rig();
      r.writer.update(draft(12));
      const ok2 = await r.writer.confirm(true);
      eq("ticking flushes the numbers, then the flag", noNumbers(r.patches).length, 1);
      eq("numbers first", noNumbers(r.patches)[0].carb_ratio_breakfast, 12);
      eq("the confirming patch is the last write", r.patches[r.patches.length - 1].ratios_confirmed, 1);
      eq("and it carries the numbers it vouches for", r.patches[r.patches.length - 1].carb_ratio_breakfast, 12);
      eq("confirm reports success", ok2, true);
      const res = await r.writer.confirm(false);
      eq("unticking withdraws to 'entered', never back to defaults", JSON.stringify(r.patches[r.patches.length - 1]), JSON.stringify({ ratios_confirmed: RATIOS_ENTERED }));
      eq("and reports false (nothing was confirmed)", res, false);
    }
    // SQLITE_BUSY: a confirmation can never land on numbers it does not vouch for
    {
      const base: StoredRatios = {
        carb_ratio_breakfast: 8,
        carb_ratio_lunch: 9,
        carb_ratio_dinner: 11,
        insulin_sensitivity_factor: 45,
        ratios_confirmed: RATIOS_ENTERED,
      };
      const mk = (failures: { n: number; always?: boolean }) => {
        const db: StoredRatios = { ...base };
        const timers: { fn: () => void; live: boolean }[] = [];
        const w = createRatioWriter({
          stored: { ...base },
          setTimer: (fn) => {
            const t = { fn, live: true };
            timers.push(t);
            return t;
          },
          clearTimer: (t) => {
            (t as { live: boolean }).live = false;
          },
          persist: async (p) => {
            if (failures.always || failures.n > 0) {
              failures.n--;
              throw new Error("SQLITE_BUSY");
            }
            Object.assign(db, p);
          },
          reload: () => ({ ...db }),
        });
        const fire = () => timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn()));
        return { db, w, fire };
      };
      const set12 = { breakfast: 12, lunch: 9, dinner: 11, isfMgdl: 45 };

      // Y1: the value write fails, the user ticks: nothing is stored, no figure
      {
        const m = mk({ n: 0, always: true });
        m.w.update(set12);
        m.fire();
        const ok1 = await m.w.confirm(true);
        eq("Y1: the tick reports failure", ok1, false);
        eq("Y1: the profile is exactly as it was", JSON.stringify(m.db), JSON.stringify(base));
        eq("Y1: no confirmation reached the old numbers", m.db.ratios_confirmed, RATIOS_ENTERED);
        eq("Y1: so the calculator shows no figure", calcFiguresAllowed({ insulin_mode: "both", ...m.db }), false);
      }
      // Y2: ticking before the 700 ms pause is over, with the write failing
      {
        const m = mk({ n: 1 });
        m.w.update(set12);
        const ok2 = await m.w.confirm(true);
        eq("Y2: the tick before the pause reports failure when the write fails", ok2, false);
        eq("Y2: the old numbers stay unconfirmed", `${m.db.carb_ratio_breakfast}/${m.db.ratios_confirmed}`, `8/${RATIOS_ENTERED}`);
        eq("Y2: no figure", calcFiguresAllowed({ insulin_mode: "both", ...m.db }), false);
        const ok3 = await m.w.confirm(true);
        eq("Y2: ticking again writes the numbers on screen and the flag together", `${ok3}/${m.db.carb_ratio_breakfast}/${m.db.ratios_confirmed}`, "true/12/1");
      }
      // an earlier queued value write fails, the tick still cannot confirm stale numbers
      {
        const m = mk({ n: 1 });
        m.w.update(set12);
        m.fire();
        const ok4 = await m.w.confirm(true);
        eq("a failed queued value write does not break the tick", ok4, true);
        eq("the stored numbers are the ones on screen", m.db.carb_ratio_breakfast, 12);
        eq("with the confirmation", m.db.ratios_confirmed, 1);
        eq("so the figure is for 12, not for the old 8", calcFiguresAllowed({ insulin_mode: "both", ...m.db }) && m.db.carb_ratio_breakfast === 12, true);
      }
      // a failed write puts the draft back for the next flush
      {
        const m = mk({ n: 1 });
        m.w.update(set12);
        await m.w.flush();
        eq("(c) the failed write left the profile alone", m.db.carb_ratio_breakfast, 8);
        await m.w.flush();
        eq("(c) the next flush writes the draft again", m.db.carb_ratio_breakfast, 12);
      }
      // a tick with an incomplete draft writes nothing
      {
        const m = mk({ n: 0 });
        m.w.update({ breakfast: 12, lunch: 9, dinner: 11, isfMgdl: null });
        const okp = await m.w.confirm(true);
        eq("an incomplete draft cannot be confirmed", okp, false);
        ok("and the flag is never 1", m.db.ratios_confirmed !== 1);
      }
    }
    // Ö2: an old value write that fails AFTER a newer confirmation was planned
    // must not bring its stale draft back over what the user confirmed
    {
      const base: StoredRatios = {
        carb_ratio_breakfast: 8,
        carb_ratio_lunch: 9,
        carb_ratio_dinner: 11,
        insulin_sensitivity_factor: 45,
        ratios_confirmed: 1,
      };
      const db: StoredRatios = { ...base };
      let ctx: StoredRatios = { ...base };
      const timers: { fn: () => void; live: boolean }[] = [];
      const gates: (() => void)[] = [];
      let failedOnce = false;
      const w = createRatioWriter({
        stored: { ...base },
        setTimer: (fn) => {
          const t = { fn, live: true };
          timers.push(t);
          return t;
        },
        clearTimer: (t) => {
          (t as { live: boolean }).live = false;
        },
        persist: async (p) => {
          await new Promise<void>((r) => gates.push(r));
          if (!failedOnce && p.carb_ratio_breakfast === 10) {
            failedOnce = true;
            throw new Error("SQLITE_BUSY");
          }
          Object.assign(db, p);
          ctx = { ...db };
        },
        reload: () => ({ ...ctx }),
      });
      const releaseAll = async () => {
        for (let i = 0; i < 60; i++) {
          await Promise.resolve();
          while (gates.length) gates.shift()!();
        }
      };
      w.update({ breakfast: 10, lunch: 9, dinner: 11, isfMgdl: 45 });
      timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn()));
      w.update({ breakfast: 12, lunch: 9, dinner: 11, isfMgdl: 45 });
      const confirmed = w.confirm(true);
      await releaseAll();
      eq("Ö2: the confirmation of 12 succeeds", await confirmed, true);
      await w.flush();
      await releaseAll();
      eq("Ö2: the profile keeps the confirmed 12", db.carb_ratio_breakfast, 12);
      eq("Ö2: and the confirmation", db.ratios_confirmed, 1);
      eq("Ö2: the late failure of the old 10 wrote nothing more", failedOnce, true);
    }
    // Ö2b: a failure that is the LATEST write still restores its draft and reports
    {
      const errors: unknown[] = [];
      let failing = true;
      const dbp: RatioPatch[] = [];
      const w = createRatioWriter({
        stored,
        persist: async (p) => {
          if (failing) throw new Error("SQLITE_BUSY");
          dbp.push(p);
        },
        reload: () => stored,
        onError: (e) => errors.push(e),
      });
      w.update(draft(12));
      await w.flush();
      eq("Ö2b: the newest write failing is reported once", errors.length, 1);
      failing = false;
      await w.flush();
      ok("Ö2b: and its draft is tried again", dbp.some((p) => p.carb_ratio_breakfast === 12));
    }
    // D1: one press at a time, and one trip back
    {
      const calls: string[] = [];
      let resolveNow: (v: boolean) => void = () => {};
      const gate = createConfirmGate({
        confirm: (c) => {
          calls.push(`confirm:${c}`);
          return new Promise<boolean>((r) => {
            resolveNow = r;
          });
        },
        onConfirmed: () => calls.push("back"),
        onBusy: (b) => calls.push(b ? "busy" : "idle"),
      });
      const first = gate.press(true);
      const second = gate.press(true);
      const third = gate.press(false);
      eq("D1: while the first write runs, the gate is busy", gate.isBusy(), true);
      resolveNow(true);
      await Promise.all([first, second, third]);
      eq("D1: a double tap runs ONE confirm and ONE back, the extra taps are swallowed", calls.join(","), "busy,confirm:true,back,idle");
      eq("D1: then the gate is free again", gate.isBusy(), false);
      const next = gate.press(true);
      resolveNow(true);
      await next;
      eq("D1: a later confirmation never goes back twice", calls.filter((c) => c === "back").length, 1);
      const failing = createConfirmGate({
        confirm: async () => false,
        onConfirmed: () => calls.push("WRONG"),
      });
      await failing.press(true);
      ok("D1: a failed confirmation does not go back", !calls.includes("WRONG"));
    }
    // third-check scenarios (H, I, J) against a database that answers reload()
    {
      const A = { carb_ratio_breakfast: 8, carb_ratio_lunch: 9, carb_ratio_dinner: 11, insulin_sensitivity_factor: 45 };
      const mk = (conf: number, failFn: (p: RatioPatch, n: number) => boolean, staleCtx = false) => {
        const st = {
          db: { ...A, ratios_confirmed: conf } as StoredRatios,
          ctx: { ...A, ratios_confirmed: conf } as StoredRatios,
          n: 0,
          errs: 0,
          w: null as unknown as ReturnType<typeof createRatioWriter>,
        };
        st.w = createRatioWriter({
          stored: { ...st.db },
          persist: async (patch) => {
            st.n++;
            await Promise.resolve();
            if (failFn(patch, st.n)) throw new Error("BUSY");
            st.db = { ...st.db, ...patch } as StoredRatios;
            if (!staleCtx) st.ctx = { ...st.db };
          },
          // the database itself, as lib/useRatioWriter reads it
          reload: async () => ({ ...st.db }),
          onError: () => {
            st.errs++;
          },
          setTimer: () => null,
          clearTimer: () => {},
        });
        return st;
      };
      const B = { breakfast: 12, lunch: 9, dinner: 11, isfMgdl: 45 };

      // H: the box is unticked while draft B's write fails; the unticking write is flag-only
      {
        let failing = true;
        const st = mk(1, (p) => failing && p.carb_ratio_breakfast === 12 && p.ratios_confirmed !== 1);
        st.w.update(B);
        const r = await st.w.confirm(false);
        eq("H: unticking reports nothing confirmed", r, false);
        ok("H: the failed draft is reported", st.errs >= 1);
        eq("H: the profile is not confirmed", calcFiguresAllowed({ insulin_mode: "both", ...st.db }), false);
        failing = false;
        await st.w.flush();
        eq("H: the draft is not lost: the next flush writes B", st.db.carb_ratio_breakfast, 12);
      }
      // I: a field edited while the confirmation runs
      {
        const st = mk(2, () => false);
        st.w.update(B);
        const sent = B;
        const p = st.w.confirm(true);
        const edited = { ...B, lunch: 15 };
        st.w.update(edited);
        const ok1 = await p;
        await st.w.flush();
        eq("I: the profile ends unconfirmed with the edit", `${st.db.carb_ratio_lunch}/${st.db.ratios_confirmed}`, "15/2");
        eq("I: so the sheet must neither tick nor close", confirmStillCurrent(ok1, sent, edited), false);
        eq("I: with nothing edited it ticks and closes", confirmStillCurrent(true, sent, { ...sent }), true);
        eq("I: a failed write never ticks", confirmStillCurrent(false, sent, { ...sent }), false);
        eq("I: an unknown result never ticks", confirmStillCurrent(undefined, sent, { ...sent }), false);
      }
      // J: the context lags (stale), the database is what reload() must read
      {
        const st = mk(1, (_p, n) => n === 3, true);
        st.w.update(B);
        await st.w.flush();
        st.w.update({ breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 45 });
        await st.w.flush();
        eq("J: the last write failed, the database still holds B", st.db.carb_ratio_breakfast, 12);
        await st.w.flush();
        eq("J: the screen's A is written by the next flush (not lost to a stale picture)", st.db.carb_ratio_breakfast, 8);
        eq("J: the failure was reported", st.errs, 1);
      }
      // K: a failed confirmation followed by an edit still reports the failure
      {
        const st = mk(2, (p) => p.ratios_confirmed === 1);
        st.w.update(B);
        const p = st.w.confirm(true);
        st.w.update({ ...B, lunch: 15 });
        const ok1 = await p;
        await st.w.flush();
        eq("K: the failed confirmation reports false", ok1, false);
        ok("K: and is reported", st.errs >= 1);
        eq("K: nothing is confirmed", calcFiguresAllowed({ insulin_mode: "both", ...st.db }), false);
      }
    }
    // D1b: the user went back while the write ran: no second pop
    {
      let focused = true;
      const calls: string[] = [];
      let resolveNow: (v: boolean) => void = () => {};
      const gate = createConfirmGate({
        confirm: () => new Promise<boolean>((r) => (resolveNow = r)),
        onConfirmed: () => calls.push("back"),
        canNavigate: () => focused,
      });
      const pr = gate.press(true);
      focused = false;
      resolveNow(true);
      await pr;
      eq("D1b: a screen that is no longer on top does not pop another one", calls.length, 0);
    }
    // a failed write hands the writer a fresh stored set
    {
      let fail = true;
      let reloaded = 0;
      const patches: RatioPatch[] = [];
      const w = createRatioWriter({
        stored,
        persist: async (p) => {
          if (fail) throw new Error("disk");
          patches.push(p);
        },
        reload: () => {
          reloaded++;
          return stored;
        },
      });
      w.update(draft(12));
      await w.flush();
      ok("a failed write reloads the stored set", reloaded >= 1);
      fail = false;
      w.update(draft(12));
      await w.flush();
      ok("and the same draft is tried again", patches.some((p) => p.carb_ratio_breakfast === 12));
      const bad = createRatioWriter({
        stored,
        persist: async () => {
          throw new Error("disk");
        },
        reload: () => stored,
      });
      bad.update(draft(12));
      eq("a failed confirm reports false", await bad.confirm(true), false);
    }
  }
}

writerTests()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((e) => {
    console.log("writer tests threw", e);
    process.exit(1);
  });
