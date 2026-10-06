/**
 * Standalone, dependency-free harness for onboarding's step list
 * (lib/onboardingSteps.ts) and the calculator's first-use number sheet
 * (lib/calcSetup.ts). No jest, compile + run with node, same pattern as
 * scripts/calc.test.ts (TypeScript 6 needs the two extra flags below once files
 * are named on the command line):
 *
 *   npx tsc scripts/onboardingSteps.test.ts lib/onboardingSteps.ts \
 *     lib/calcSetup.ts lib/insulinMode.ts lib/db/types.ts \
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
  CALC_SETUP_DISMISSED_KEY,
  DEFAULT_CARB_RATIO,
  DEFAULT_ISF_MGDL,
  calcSetupInitial,
  calcSetupNeeded,
  calcSetupPatch,
  shouldAutoOpenCalcSetup,
  type CalcSetupProfile,
} from "../lib/calcSetup";
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
    expected: ["name", "unit", "diabetes", "insulin", "targets", "insulinProducts", "reminderPlan", "disclaimer"],
    before: 13,
  },
  {
    label: "insulin and pills",
    answers: { diabetes: "type2", treatment: "both", pillsOnly: null },
    path: "insulin",
    expected: [
      "name",
      "unit",
      "diabetes",
      "insulin",
      "targets",
      "insulinProducts",
      "medReminder",
      "reminderPlan",
      "disclaimer",
    ],
    before: 14,
  },
  {
    label: "pills only (type 2)",
    answers: { diabetes: "type2", treatment: "pills", pillsOnly: null },
    path: "pills",
    expected: ["name", "unit", "diabetes", "insulin", "targets", "medReminder", "reminderPlan", "disclaimer"],
    before: 10,
  },
  {
    label: "no medication (type 2)",
    answers: { diabetes: "type2", treatment: "none", pillsOnly: null },
    path: "none",
    expected: ["name", "unit", "diabetes", "insulin", "targets", "reminderPlan", "disclaimer"],
    before: 9,
  },
  {
    label: "no diagnosis, pills",
    answers: { diabetes: "none", treatment: null, pillsOnly: true },
    path: "pills",
    expected: ["name", "unit", "diabetes", "pillsOnly", "targets", "medReminder", "reminderPlan", "disclaimer"],
    before: 10,
  },
  {
    label: "prediabetes, no pills",
    answers: { diabetes: "prediabetes", treatment: null, pillsOnly: false },
    path: "none",
    expected: ["name", "unit", "diabetes", "pillsOnly", "targets", "reminderPlan", "disclaimer"],
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
    ok(`${c.label}: disclaimer is last`, steps[steps.length - 1] === "disclaimer");
    ok(
      `${c.label}: reminderPlan is directly before the disclaimer`,
      steps[steps.length - 2] === "reminderPlan"
    );
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
    ["name", "unit", "diabetes", "insulin", "targets", "reminderPlan", "disclaimer"]
  );
  eqList("the only optional screens are the two that stayed optional", OPTIONAL_STEPS, [
    "insulinProducts",
    "medReminder",
  ]);
  const both = buildOnboardingSteps(
    onboardingFlags({ diabetes: "type2", treatment: "both", pillsOnly: null })
  );
  ok("insulin and pills stays at seven required screens", requiredScreenCount(both) <= 8);
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

  const first = onboardingStepEvent("quiz", "name", steps);
  eq("the first question is index 1", first.index, 1);
  eq("and keeps its own name", first.step, "name");
  const last = onboardingStepEvent("quiz", "disclaimer", steps);
  eq("the last question is index = required screens", last.index, requiredScreenCount(steps));
  eq("reveal follows it", onboardingStepEvent("reveal", "disclaimer", steps).index, requiredScreenCount(steps) + 1);
  eq("reveal is step 'reveal'", onboardingStepEvent("reveal", "disclaimer", steps).step, "reveal");
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
    'onboarding_step {"step":"name","index":1}',
    'onboarding_step {"step":"unit","index":2}',
    'onboarding_step {"step":"diabetes","index":3}',
    'onboarding_step {"step":"treatment","index":4}',
    'onboarding_step {"step":"targets","index":5}',
    'onboarding_step {"step":"reminderPlan","index":6}',
    'onboarding_step {"step":"disclaimer","index":7}',
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
  ok(
    "finishing never raises an OS prompt",
    !/requestNotificationPermission|ensureAlarmAuthorizationOnce|requestAlarmAuthorization/.test(finish)
  );
  ok(
    "finishing no longer writes the calculator's numbers",
    !/carb_ratio_|insulin_sensitivity_factor|ratios_confirmed/.test(finish)
  );
  ok("done event is built by the shared helper", finish.includes("onboardingDoneEvent("));
  ok(
    "and the helper is handed the steps only, never the answers",
    finish.includes("onboardingDoneEvent(steps)")
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

section("H. calculator first-use sheet: who is asked, and when");
{
  const base: CalcSetupProfile = {
    insulin_mode: "both",
    carb_ratio_breakfast: 10,
    carb_ratio_lunch: 12,
    carb_ratio_dinner: 12,
    insulin_sensitivity_factor: 40,
    ratios_confirmed: 0,
  };

  eq("a fresh insulin profile is asked", calcSetupNeeded(base), true);
  eq("mealtime-only is asked too", calcSetupNeeded({ ...base, insulin_mode: "bolus" }), true);
  eq("basal-only has no dose section: not asked", calcSetupNeeded({ ...base, insulin_mode: "basal" }), false);
  eq("no insulin: not asked", calcSetupNeeded({ ...base, insulin_mode: "none" }), false);
  eq("no profile yet: not asked", calcSetupNeeded(null), false);
  eq("an established install (confirmed) is left alone", calcSetupNeeded({ ...base, ratios_confirmed: 1 }), false);
  eq(
    "a confirmed profile with a zero ratio is asked again",
    calcSetupNeeded({ ...base, ratios_confirmed: 1, carb_ratio_lunch: 0 }),
    true
  );
  eq(
    "a confirmed profile with no ISF is asked again",
    calcSetupNeeded({ ...base, ratios_confirmed: 1, insulin_sensitivity_factor: 0 }),
    true
  );
  eq(
    "a non-finite ratio counts as missing",
    calcSetupNeeded({ ...base, ratios_confirmed: 1, carb_ratio_dinner: Number.NaN }),
    true
  );
  eq("an older profile that said 'not sure' is asked once", calcSetupNeeded({ ...base, carb_ratio_lunch: 10, carb_ratio_dinner: 10 }), true);

  eq("opens on a new record", shouldAutoOpenCalcSetup({ needed: true, isEdit: false, dismissed: false }), true);
  eq("not while editing a past meal", shouldAutoOpenCalcSetup({ needed: true, isEdit: true, dismissed: false }), false);
  eq("not again once put away", shouldAutoOpenCalcSetup({ needed: true, isEdit: false, dismissed: true }), false);
  eq("not when nothing is missing", shouldAutoOpenCalcSetup({ needed: false, isEdit: false, dismissed: false }), false);

  const init = calcSetupInitial(base);
  eq("starts on the stored carb ratio", init.carbRatio, 10);
  eq("starts on the stored ISF", init.isfMgdl, 40);
  const zero = calcSetupInitial({ ...base, carb_ratio_breakfast: 0, insulin_sensitivity_factor: 0 });
  eq("a zero ratio opens on the default", zero.carbRatio, DEFAULT_CARB_RATIO);
  eq("a zero ISF opens on the default", zero.isfMgdl, DEFAULT_ISF_MGDL);
  eq("no profile opens on the defaults", calcSetupInitial(null).carbRatio, DEFAULT_CARB_RATIO);
  eq("defaults are the ones onboarding used", DEFAULT_CARB_RATIO * 100 + DEFAULT_ISF_MGDL, 1040);

  const patch = calcSetupPatch({ carbRatio: 8.5, isfMgdl: 45 });
  ok("a good entry produces a patch", patch != null);
  eq("one ratio for breakfast", patch?.carb_ratio_breakfast, 8.5);
  eq("and lunch", patch?.carb_ratio_lunch, 8.5);
  eq("and dinner", patch?.carb_ratio_dinner, 8.5);
  eq("ISF is stored in mg/dL as given", patch?.insulin_sensitivity_factor, 45);
  eq("saving confirms the numbers", patch?.ratios_confirmed, 1);
  eq("a zero ratio is refused", calcSetupPatch({ carbRatio: 0, isfMgdl: 45 }), null);
  eq("a missing ISF is refused", calcSetupPatch({ carbRatio: 8, isfMgdl: Number.NaN }), null);
  eq("a negative ISF is refused", calcSetupPatch({ carbRatio: 8, isfMgdl: -3 }), null);
  eq(
    "a saved profile is no longer asked",
    calcSetupNeeded({ ...base, ...(patch as NonNullable<typeof patch>) }),
    false
  );
  eq("the dismissal flag base", CALC_SETUP_DISMISSED_KEY, "zerospike.calcSetupDismissed");
}

section("I. the calculator screen wires it");
{
  const calc = src("app/calculator.tsx");

  ok("asks through the shared predicate", calc.includes("calcSetupNeeded("));
  ok("opens by itself only through the shared rule", calc.includes("shouldAutoOpenCalcSetup("));
  ok("saves through the shared patch", calc.includes("calcSetupPatch("));
  ok("the patch goes to the profile", /updateProfile\(\s*activeProfile\.id,\s*patch/.test(calc));
  ok("and the app is told the profile changed", /updateProfile\([\s\S]{0,200}bumpData\(\)/.test(calc));
  ok("uses the shared bottom sheet", calc.includes("SheetShell"));
  ok("remembers a dismissal per profile", calc.includes("CALC_SETUP_DISMISSED_KEY"));
  ok("the default-ratios notice can reopen it", /setSetupOpen\(true\)/.test(calc));
  ok("a profile with no mealtime insulin never reaches the sheet", /showsDose/.test(calc));

  const keys = src("lib/profileScopedKeys.ts");
  ok("the dismissal flag is swept with the profile", keys.includes(CALC_SETUP_DISMISSED_KEY));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
