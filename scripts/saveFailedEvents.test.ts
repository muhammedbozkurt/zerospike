/**
 * G29 + K4: every failed save reports save_failed {kind, step} (never a value,
 * a message or an error text), and an insulin log_added carries insulin_kind
 * (bolus|basal) and no dose.
 * Run: npx -y tsx scripts/saveFailedEvents.test.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

let failed = 0;
let passed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const ROOT = join(__dirname, "..");
const src = (f: string): string => readFileSync(join(ROOT, f), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const KINDS = ["glucose", "meal", "injection", "med", "reminder", "profile", "other"];
const STEPS = ["write", "side", "schedule"];

async function main(): Promise<void> {
  const { setAnalyticsSink } = await import("../lib/analytics");
  const { trackSaveFailed } = await import("../lib/analytics/saveFailed");
  const { sanitizeEvent } = await import("../lib/analytics/eventSchema");
  const { runGuardedSave } = await import("../lib/injectionSave");
  const { saveMedGuarded } = await import("../lib/medSave");
  const { saveReminderGuarded } = await import("../lib/reminderSave");
  const { attemptGlucoseWrite, settleSheetSubmit } = await import("../lib/glucoseSheetFlow");

  const seen: Array<{ name: string; params?: Record<string, unknown> }> = [];
  setAnalyticsSink((name, params) => void seen.push({ name, params }), "saveFailedTest");
  const take = () => seen.splice(0).filter((e) => e.name === "save_failed").map((e) => e.params);

  console.log("A. the helper");
  trackSaveFailed("glucose", "write");
  eq("emits exactly kind and step", take(), [{ kind: "glucose", step: "write" }]);
  for (const kind of KINDS) {
    for (const step of STEPS) {
      const res = sanitizeEvent("save_failed", { kind, step });
      ok(`schema accepts ${kind}/${step}`, res.ok && res.issues.length === 0);
    }
  }

  console.log("B. injection save path");
  const lock = { current: false };
  const base = {
    lock,
    setBusy: () => {},
    confirm: async () => true,
    onSaved: async () => {},
    onError: () => {},
  };
  take();
  await runGuardedSave({ ...base, write: async () => 1 });
  eq("a saved injection reports nothing", take(), []);
  await runGuardedSave({ ...base, write: async () => { throw new Error("db locked 12 U"); } });
  eq("a failed write -> injection/write", take(), [{ kind: "injection", step: "write" }]);
  await runGuardedSave({ ...base, write: async () => 1, onSaved: async () => { throw new Error("nav"); } });
  eq("an error after the row -> injection/side", take(), [{ kind: "injection", step: "side" }]);
  await runGuardedSave({ ...base, write: async () => 1, confirm: async () => { throw new Error("read"); } });
  eq("a confirm read error -> injection/side", take(), [{ kind: "injection", step: "side" }]);
  await runGuardedSave({ ...base, write: async () => 1, confirm: async () => false });
  eq("a cancelled save reports nothing", take(), []);

  console.log("C. medication");
  eq("ok", await saveMedGuarded({ write: async () => {}, rememberName: async () => {} }), "ok");
  eq("ok emits nothing", take(), []);
  await saveMedGuarded({ write: async () => { throw new Error("x"); }, rememberName: async () => {} });
  eq("write failed -> med/write", take(), [{ kind: "med", step: "write" }]);
  await saveMedGuarded({ write: async () => {}, rememberName: async () => { throw new Error("x"); } });
  eq("remember name failed -> med/side", take(), [{ kind: "med", step: "side" }]);

  console.log("D. reminder");
  eq("ok", await saveReminderGuarded({ write: async () => {}, afterWrite: async () => {}, isCreate: true }), "ok");
  eq("ok emits nothing", take(), []);
  await saveReminderGuarded({ write: async () => { throw new Error("x"); }, afterWrite: async () => {}, isCreate: true });
  eq("write failed -> reminder/write", take(), [{ kind: "reminder", step: "write" }]);
  await saveReminderGuarded({ write: async () => {}, afterWrite: async () => { throw new Error("x"); }, isCreate: true });
  eq("schedule failed -> reminder/schedule", take(), [{ kind: "reminder", step: "schedule" }]);
  await saveReminderGuarded({ write: async () => { throw new Error("reminders reached 10"); }, afterWrite: async () => {}, isCreate: true });
  eq("the plain limit is not a failure", take(), []);

  console.log("E. glucose sheet");
  await attemptGlucoseWrite(async () => 1, () => {});
  eq("a landed write emits nothing", take(), []);
  await attemptGlucoseWrite(async () => { throw new Error("x"); }, () => {});
  eq("failed write -> glucose/write", take(), [{ kind: "glucose", step: "write" }]);
  eq("a submit that returns false adds nothing (already counted)", await settleSheetSubmit(async () => false), false);
  eq("no second event", take(), []);
  eq("a submit that throws", await settleSheetSubmit(async () => { throw new Error("x"); }), false);
  eq("throw -> glucose/side", take(), [{ kind: "glucose", step: "side" }]);

  setAnalyticsSink(null, "saveFailedTest");

  console.log("F. call sites");
  const files = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => !f.startsWith("lib/analytics/saveFailed"));
  const calls: Array<{ file: string; text: string; kind: string | null; step: string | null }> = [];
  for (const f of files) {
    const text = src(f);
    const re = /trackSaveFailed\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const args = m[1].split(",").map((a) => a.trim());
      const lit = (a: string | undefined) => (a && /^"[a-z]+"$/.test(a) ? a.slice(1, -1) : null);
      calls.push({ file: f, text: m[0], kind: lit(args[0]), step: lit(args[1]) });
    }
  }
  ok("call sites exist", calls.length >= 20, `found ${calls.length}`);
  for (const c of calls) {
    ok(`${c.file}: ${c.text} has literal enum arguments only`, c.kind !== null && KINDS.includes(c.kind) && c.step !== null && STEPS.includes(c.step));
  }
  for (const kind of KINDS) {
    ok(`kind ${kind} has a call site`, calls.some((c) => c.kind === kind));
  }
  ok("a schedule step exists", calls.some((c) => c.step === "schedule"));
  ok("a side step exists", calls.some((c) => c.step === "side"));
  const where = (kind: string) => calls.filter((c) => c.kind === kind).map((c) => c.file);
  const has = (kind: string, file: string) => where(kind).some((f) => f === file);
  ok("injection: lib/injectionSave.ts", has("injection", "lib/injectionSave.ts"));
  ok("injection: calculator bolus", has("injection", "app/calculator.tsx"));
  ok("injection: basal confirm", has("injection", "app/basal-confirm.tsx"));
  ok("meal: calculator", has("meal", "app/calculator.tsx"));
  ok("meal: food", has("meal", "app/(tabs)/food.tsx"));
  ok("meal: meal-template", has("meal", "app/meal-template.tsx"));
  ok("glucose: lib/glucoseSheetFlow.ts", has("glucose", "lib/glucoseSheetFlow.ts"));
  ok("glucose: dashboard side step", has("glucose", "app/(tabs)/index.tsx"));
  ok("med: lib/medSave.ts", has("med", "lib/medSave.ts"));
  ok("reminder: lib/reminderSave.ts", has("reminder", "lib/reminderSave.ts"));
  ok("profile: profile-setup", has("profile", "app/profile-setup.tsx"));
  ok("profile: settings/profile", has("profile", "app/settings/profile.tsx"));
  ok("other: undo restore", has("other", "components/useUndoBatch.ts"));

  // No call site builds save_failed by hand (always through the helper), and the
  // helper passes nothing but the two enums.
  const direct = files.filter((f) => /logEvent\(\s*"save_failed"/.test(src(f)));
  eq("save_failed is only emitted by the helper", direct, []);
  const helper = src("lib/analytics/saveFailed.ts");
  ok("the helper sends kind and step only", /logEvent\("save_failed", \{ kind, step \}\)/.test(helper));
  ok("the helper takes no error argument", /trackSaveFailed\(kind: SaveFailedKind, step: SaveFailedStep\): void/.test(helper));

  console.log("G. the call-site checker no longer waits for save_failed");
  const pending = /const CALL_SITE_PENDING = \[([^\]]*)\]/.exec(src("scripts/eventCallsites.test.ts"));
  ok("CALL_SITE_PENDING no longer lists save_failed", pending !== null && !pending[1].includes("save_failed"));

  console.log("H. K4: log_added carries the insulin kind, never a dose");
  const inj = src("app/(tabs)/injection.tsx");
  ok("injection form: insulin_kind from the insulin type", /logEvent\("log_added",\s*\{\s*kind,\s*insulin_kind:\s*insulinType === "basal" \? "basal" : "bolus"\s*\}\)/.test(inj));
  ok("basal confirm: insulin_kind basal", /logEvent\("log_added",\s*\{\s*kind:\s*"basal",\s*insulin_kind:\s*"basal"\s*\}\)/.test(src("app/basal-confirm.tsx")));
  const calc = src("app/calculator.tsx");
  ok("calculator: insulin_kind bolus only when a dose was wanted", /logEvent\("log_added",\s*\{\s*kind:\s*"meal",\s*insulin_kind:\s*doseWanted \? "bolus" : undefined\s*\}\)/.test(calc));
  for (const f of ["app/(tabs)/injection.tsx", "app/basal-confirm.tsx", "app/calculator.tsx"]) {
    const s = src(f);
    const m = [...s.matchAll(/logEvent\("log_added",\s*\{[^}]*\}\)/g)].map((x) => x[0]);
    ok(`${f}: no dose or unit in log_added`, m.length > 0 && m.every((x) => !/dose_?units|\bunits?\s*:|\bdose\s*:/i.test(x)));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
