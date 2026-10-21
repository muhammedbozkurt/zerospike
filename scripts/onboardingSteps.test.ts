/**
 * Standalone, dependency-free harness for onboarding's step list
 * (lib/onboardingSteps.ts) and the calculator's first-use number sheet
 * (lib/calcSetup.ts). No jest, compile + run with node, same pattern as
 * scripts/calc.test.ts (TypeScript 6 needs the two extra flags below once files
 * are named on the command line):
 *
 *   npx tsc scripts/onboardingSteps.test.ts lib/onboardingSteps.ts \
 *     lib/calcSetup.ts lib/insulin.ts lib/glucose.ts lib/insulinMode.ts lib/db/types.ts \
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
  calcSetupInitial,
  calcSetupNeeded,
  calcSetupPatch,
  isLegacyUnentered,
  ratioConfirmPatch,
  ratioFieldsInitial,
  ratioSetMatchesStored,
  ratioSetPatch,
  shouldAutoOpenCalcSetup,
  type CalcSetupProfile,
} from "../lib/calcSetup";
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
    expected: ["analytics", "name", "unit", "diabetes", "insulin", "targets", "insulinProducts", "reminderPlan"],
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
    expected: ["analytics", "name", "unit", "diabetes", "insulin", "targets", "medReminder", "reminderPlan"],
    before: 10,
  },
  {
    label: "no medication (type 2)",
    answers: { diabetes: "type2", treatment: "none", pillsOnly: null },
    path: "none",
    expected: ["analytics", "name", "unit", "diabetes", "insulin", "targets", "reminderPlan"],
    before: 9,
  },
  {
    label: "no diagnosis, pills",
    answers: { diabetes: "none", treatment: null, pillsOnly: true },
    path: "pills",
    expected: ["analytics", "name", "unit", "diabetes", "pillsOnly", "targets", "medReminder", "reminderPlan"],
    before: 10,
  },
  {
    label: "prediabetes, no pills",
    answers: { diabetes: "prediabetes", treatment: null, pillsOnly: false },
    path: "none",
    expected: ["analytics", "name", "unit", "diabetes", "pillsOnly", "targets", "reminderPlan"],
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
    eq(`${c.label}: seven required screens`, requiredScreenCount(steps), 7);
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
  ok("eight screens at most, optional product screen included", insulin.length <= 8, `got ${insulin.length}`);
  eq("seven without the optional product screen", requiredScreenCount(insulin), 7);
  eqList(
    "required screens are exactly the agreed seven",
    insulin.filter((s) => !OPTIONAL_STEPS.includes(s)),
    ["analytics", "name", "unit", "diabetes", "insulin", "targets", "reminderPlan"]
  );
  eqList("the only optional screens are the two that stayed optional", OPTIONAL_STEPS, [
    "insulinProducts",
    "medReminder",
  ]);
  const both = buildOnboardingSteps(
    onboardingFlags({ diabetes: "type2", treatment: "both", pillsOnly: null })
  );
  ok("insulin and pills stays at seven required screens", requiredScreenCount(both) <= 7);
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
    'onboarding_step {"step":"targets","index":6}',
    'onboarding_step {"step":"reminderPlan","index":7}',
    'onboarding_step {"step":"reveal","index":8}',
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
  const own: CalcSetupProfile = {
    ...legacy,
    carb_ratio_breakfast: 8,
    carb_ratio_lunch: 9,
    carb_ratio_dinner: 11,
    insulin_sensitivity_factor: 35,
  };
  const confirmed: CalcSetupProfile = { ...own, ratios_confirmed: 1 };

  // The gate
  eq("no confirmation: no figure", calcFiguresAllowed(own), false);
  eq("legacy values, unconfirmed: no figure", calcFiguresAllowed(legacy), false);
  eq("confirmed: figure allowed", calcFiguresAllowed(confirmed), true);
  eq("no profile: no figure", calcFiguresAllowed(null), false);
  eq("a flag other than 1 is not a confirmation", calcFiguresAllowed({ ratios_confirmed: 2 }), false);

  // Who is asked
  eq("a fresh insulin profile is asked", calcSetupNeeded(legacy), true);
  eq("ratios present but unconfirmed: still asked", calcSetupNeeded(own), true);
  eq("mealtime-only is asked too", calcSetupNeeded({ ...legacy, insulin_mode: "bolus" }), true);
  eq("basal-only has no dose section: not asked", calcSetupNeeded({ ...legacy, insulin_mode: "basal" }), false);
  eq("no insulin: not asked", calcSetupNeeded({ ...legacy, insulin_mode: "none" }), false);
  eq("no profile yet: not asked", calcSetupNeeded(null), false);
  eq("a confirmed profile is left alone", calcSetupNeeded(confirmed), false);
  eq("a confirmed profile with a zero ratio is asked again", calcSetupNeeded({ ...confirmed, carb_ratio_lunch: 0 }), true);
  eq("a confirmed profile with no ISF is asked again", calcSetupNeeded({ ...confirmed, insulin_sensitivity_factor: 0 }), true);
  eq("a non-finite ratio counts as missing", calcSetupNeeded({ ...confirmed, carb_ratio_dinner: Number.NaN }), true);

  // Legacy values count as "never entered"
  eq("legacy signature is recognised", isLegacyUnentered(legacy), true);
  eq("one changed number is the user's own entry", isLegacyUnentered({ ...legacy, insulin_sensitivity_factor: 41 }), false);
  eq("a confirmed 10/12/12/40 is the user's own", isLegacyUnentered({ ...legacy, ratios_confirmed: 1 }), false);
  const li = ratioFieldsInitial(legacy);
  ok(
    "legacy values open EMPTY",
    li.breakfast === null && li.lunch === null && li.dinner === null && li.isfMgdl === null
  );
  const oi = ratioFieldsInitial(own);
  ok("the user's own unconfirmed numbers are shown", oi.breakfast === 8 && oi.lunch === 9 && oi.dinner === 11 && oi.isfMgdl === 35);
  const ci = ratioFieldsInitial({ ...legacy, ratios_confirmed: 1 });
  ok("a confirmed 10/12/12/40 stays shown", ci.breakfast === 10 && ci.isfMgdl === 40);
  eq("a stored zero opens empty", ratioFieldsInitial({ ...own, carb_ratio_lunch: 0 }).lunch, null);
  eq("no profile opens empty", ratioFieldsInitial(null).breakfast, null);
  eq("the sheet opens empty for legacy values", calcSetupInitial(legacy).carbRatio, null);
  eq("and for the ISF", calcSetupInitial(legacy).isfMgdl, null);
  eq("the sheet shows the user's own carb ratio", calcSetupInitial(own).carbRatio, 8);
  eq("no profile: empty sheet", calcSetupInitial(null).carbRatio, null);

  // One-time prompt
  eq("opens on a new record", shouldAutoOpenCalcSetup({ needed: true, isEdit: false, prompted: false }), true);
  eq("not while editing a past meal", shouldAutoOpenCalcSetup({ needed: true, isEdit: true, prompted: false }), false);
  eq("not again once offered", shouldAutoOpenCalcSetup({ needed: true, isEdit: false, prompted: true }), false);
  eq("not when nothing is missing", shouldAutoOpenCalcSetup({ needed: false, isEdit: false, prompted: false }), false);
  eq("the one-time flag base", RATIOS_CONFIRM_PROMPTED_KEY, "zerospike.ratiosConfirmPrompted");

  // Sheet save: confirmation only with the tick
  const ticked = calcSetupPatch({ carbRatio: 8.5, isfMgdl: 45, confirmed: true });
  ok("a good entry produces a patch", ticked != null);
  eq("one ratio for breakfast", ticked?.carb_ratio_breakfast, 8.5);
  eq("and lunch", ticked?.carb_ratio_lunch, 8.5);
  eq("and dinner", ticked?.carb_ratio_dinner, 8.5);
  eq("ISF is stored in mg/dL as given", ticked?.insulin_sensitivity_factor, 45);
  eq("ticked: confirmed", ticked?.ratios_confirmed, 1);
  const unticked = calcSetupPatch({ carbRatio: 8.5, isfMgdl: 45, confirmed: false });
  eq("not ticked: numbers saved but NOT confirmed", unticked?.ratios_confirmed, 0);
  eq("not ticked: the numbers are still written", unticked?.carb_ratio_lunch, 8.5);
  eq("a zero ratio is refused", calcSetupPatch({ carbRatio: 0, isfMgdl: 45, confirmed: true }), null);
  eq("a missing ISF is refused", calcSetupPatch({ carbRatio: 8, isfMgdl: Number.NaN, confirmed: true }), null);
  eq("a negative ISF is refused", calcSetupPatch({ carbRatio: 8, isfMgdl: -3, confirmed: true }), null);
  eq("a ticked save is no longer asked", calcSetupNeeded({ ...legacy, ...(ticked as NonNullable<typeof ticked>) }), false);
  eq("an unticked save is still asked", calcSetupNeeded({ ...legacy, ...(unticked as NonNullable<typeof unticked>) }), true);
  eq("an unticked save shows no figure", calcFiguresAllowed({ ...legacy, ...(unticked as NonNullable<typeof unticked>) }), false);

  // Profile and Targets: a changed set withdraws the confirmation
  const sameSet = ratioSetPatch(confirmed, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 });
  eq("typing the same numbers back changes nothing", sameSet, null);
  const changed = ratioSetPatch(confirmed, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 36 });
  eq("a changed ISF resets the confirmation", changed?.ratios_confirmed, 0);
  eq("and writes the new value", changed?.insulin_sensitivity_factor, 36);
  const changedRatio = ratioSetPatch(confirmed, { breakfast: 7.5, lunch: 9, dinner: 11, isfMgdl: 35 });
  eq("a changed carb ratio resets the confirmation", changedRatio?.ratios_confirmed, 0);
  eq("an incomplete set is not saved", ratioSetPatch(confirmed, { breakfast: 7, lunch: null, dinner: 11, isfMgdl: 35 }), null);
  eq("an unusable value is not saved", ratioSetPatch(confirmed, { breakfast: 0, lunch: 9, dinner: 11, isfMgdl: 35 }), null);
  const fromLegacy = ratioSetPatch(legacy, { breakfast: 8, lunch: 9, dinner: 11, isfMgdl: 35 });
  eq("first entry over legacy values is saved unconfirmed", fromLegacy?.ratios_confirmed, 0);
  eq("legacy values typed back verbatim write nothing", ratioSetPatch(legacy, { breakfast: 10, lunch: 12, dinner: 12, isfMgdl: 40 }), null);
  eq("the box confirms a stored set", ratioConfirmPatch(own, true)?.ratios_confirmed, 1);
  eq("the box cannot confirm an unusable set", ratioConfirmPatch({ ...own, carb_ratio_dinner: 0 }, true), null);
  eq("unticking withdraws it", ratioConfirmPatch(confirmed, false)?.ratios_confirmed, 0);
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
  const closed = estimateInsulinConfirmed(food, 100, { ...prof, ratios_confirmed: 0 }, { slot: "lunch" });
  eq("no confirmation: no estimate at all", closed, null);
  const closedWithGlucose = estimateInsulinConfirmed(
    food,
    100,
    { ...prof, ratios_confirmed: 0 },
    { slot: "lunch", currentGlucose: 220 }
  );
  eq("no confirmation, with a reading: still none", closedWithGlucose, null);
  const open = estimateInsulinConfirmed(food, 100, { ...prof, ratios_confirmed: 1 }, { slot: "lunch" });
  const direct = estimateInsulin(food, 100, prof, { slot: "lunch" });
  ok("confirmed: an estimate", open != null);
  eq("confirmed: the old result, total", open?.totalDose, direct.totalDose);
  eq("confirmed: the old result, meal dose", open?.mealDose, direct.mealDose);
  eq("confirmed: 50 g at 1:10 is 5 U", open?.totalDose, 5);
  eq("carbs need no ratio", carbsForPortion(food, 100), 50);
  eq("carbs round to one decimal", carbsForPortion({ carb_100g: 33.333 }, 100), 33.3);
}

section("J. the calculator screen wires the gate");
{
  const calc = src("app/calculator.tsx");

  ok("asks through the shared predicate", calc.includes("calcSetupNeeded("));
  ok("opens by itself only through the shared rule", calc.includes("shouldAutoOpenCalcSetup("));
  ok("saves through the shared patch", calc.includes("calcSetupPatch("));
  ok("the patch carries the tick", /confirmed:\s*values\.confirmed/.test(calc));
  ok("the patch goes to the profile", /updateProfile\(\s*activeProfile\.id,\s*patch/.test(calc));
  ok("and the app is told the profile changed", /updateProfile\([\s\S]{0,200}bumpData\(\)/.test(calc));
  ok("uses the shared bottom sheet", calc.includes("SheetShell"));
  ok("the one-time flag is per profile", calc.includes("RATIOS_CONFIRM_PROMPTED_KEY"));
  ok("the sheet has the confirm checkbox", calc.includes("ConfirmCheckbox") && calc.includes("calculator.setup.confirm"));
  ok("the sheet fields are RatioInput (empty start)", calc.includes("<RatioInput"));
  ok("the sheet no longer uses a pre-filled Stepper for the ratios", !/CalcSetupSheet[\s\S]{0,6000}<Stepper[\s\S]{0,40}carbRatio/.test(calc));
  ok("a profile with no mealtime insulin never reaches the sheet", /showsDose/.test(calc));
  ok("no default-ratios notice", !calc.includes("defaultRatios"));
  ok("the unit estimate comes only from the gated entry point", calc.includes("estimateInsulinConfirmed(") && !/\bestimateInsulin\(/.test(calc));
  ok("carbs are read without a ratio", calc.includes("carbsForPortion("));
  ok("the hero and breakdown sit behind the gated estimate", /\{doseEst \? \(\s*<>\s*\{\/\* Hero/.test(calc));
  ok("the hero number is not rendered outside that block", calc.split("{heroDose}").length === 2);
  ok("the skeleton hero is hidden without confirmed ratios", calc.includes("!calcFiguresAllowed(activeProfile) ? null"));
  ok("the dose field still starts blank", /useState\(""\)/.test(calc) || /doseText/.test(calc));
  ok("the typed dose is what is saved", calc.includes("dose = typedDose"));

  const line = src("components/CarbRatioLine.tsx");
  ok("the ratio line quotes a number only when confirmed", line.includes("calcFiguresAllowed(activeProfile)"));
  ok("the ratio line otherwise says 'enter your ratios'", line.includes('t("ratio.enter")'));

  const keys = src("lib/profileScopedKeys.ts");
  ok("the one-time flag is swept with the profile", keys.includes(RATIOS_CONFIRM_PROMPTED_KEY));
  ok("the old flag is still swept", keys.includes(LEGACY_CALC_SETUP_DISMISSED_KEY));
}

section("K. no default-ratio constants anywhere");
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
  const setup = src("lib/calcSetup.ts");
  ok("calcSetup supplies no starting number to the sheet", !/\?\s*cr\s*:\s*\d/.test(setup));
  const ps = src("app/profile-setup.tsx");
  ok("profile-setup no longer seeds 10 / 12 / 40", !/useState\(activeProfile\?\.carb_ratio/.test(ps) && !/insulin_sensitivity_factor \?\? 40/.test(ps));
  ok("profile-setup confirms only with the tick", ps.includes("ratiosTick") && ps.includes("ratios_confirmed"));
  const prof = src("lib/db/profiles.ts");
  ok("new profiles carry no ratio numbers", !/carb_ratio_breakfast \?\? 10/.test(prof) && !/insulin_sensitivity_factor \?\? 40/.test(prof));
  const sp = src("app/settings/profile.tsx");
  ok("Profile and Targets saves through the set rule", sp.includes("ratioSetPatch(") && sp.includes("ratioConfirmPatch("));
  ok("it no longer confirms on every stepper change", !sp.includes("persistRatio"));
  ok("the box is in Profile and Targets", sp.includes("ConfirmCheckbox"));
}

section("L. the new strings exist in all nine languages");
{
  const langs = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
  for (const l of langs) {
    const s = src(`lib/i18n/locales/${l}.ts`);
    ok(`${l}: ratio.enter`, /\n  ratio: \{[\s\S]*?\n    enter: "[^"]+"/.test(s));
    ok(`${l}: setup.teamNote`, /\n      teamNote: "[^"]+"/.test(s));
    ok(`${l}: setup.confirm`, /\n      confirm: "[^"]+"/.test(s));
    ok(`${l}: settings.ratiosReconfirmHint`, /\n    ratiosReconfirmHint: "[^"]+"/.test(s));
    ok(`${l}: no default-ratios notice left`, !s.includes("defaultRatiosTitle") && !s.includes("defaultRatiosBody"));
    ok(`${l}: the old not-set line is gone`, !/\n    notSet: /.test(s.slice(s.indexOf("\n  ratio: {"), s.indexOf("\n  ratio: {") + 400)));
  }
  ok("tr confirm text is the agreed one", src("lib/i18n/locales/tr.ts").includes('confirm: "Bu oranları diyabet ekibimle belirledim"'));
  ok("tr enter text is the agreed one", src("lib/i18n/locales/tr.ts").includes('enter: "Oranlarınızı girin"'));
  ok("tr note text is the agreed one", src("lib/i18n/locales/tr.ts").includes('teamNote: "Oranlarınızı diyabet ekibinizle belirleyin."'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
