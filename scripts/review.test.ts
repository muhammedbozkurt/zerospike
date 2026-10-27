/**
 * lib/services/review.ts harness: the gates apply to every trigger (free users
 * included), the log counter rises per saved log, streak_7 fires once.
 *
 * Run: npx tsx scripts/review.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const store = new Map<string, string>();
const events: { name: string; params?: any }[] = [];
let requests = 0;
let storeUrl: string | null = "https://apps.apple.com/app/id1";
let pkg: string | undefined = "com.example.app";

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string) {
  if (request === "@react-native-async-storage/async-storage") {
    return {
      __esModule: true,
      default: {
        getItem: async (k: string) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: async (k: string, v: string) => void store.set(k, String(v)),
      },
    };
  }
  if (request === "expo-store-review") {
    return {
      isAvailableAsync: () => new Promise((r) => setTimeout(() => r(true), 2)),
      requestReview: async () => void requests++,
      storeUrl: () => storeUrl,
    };
  }
  if (request === "expo-constants") {
    return { __esModule: true, default: { expoConfig: { version: "1.0.0", android: { package: pkg } } } };
  }
  if (/(^|\/)analytics$/.test(request)) {
    return { logEvent: (name: string, params?: any) => void events.push({ name, params }) };
  }
  if (/screenshotMode$/.test(request)) return { isScreenshotMode: () => false };
  return realLoad.apply(this, arguments);
};
let svc: any;
try {
  svc = require("../lib/services/review");
} finally {
  Module._load = realLoad;
}

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  console.log("zerospike review test");

  for (let i = 0; i < 4; i++) await svc.noteLogAndMaybeReview();
  eq("counter rises per saved log", store.get("zerospike.reviewLogCount"), "4");
  eq("no prompt before 3 days / 5 logs", requests, 0);

  store.set("zerospike.reviewFirstSeenAt", String(Date.now() - 4 * DAY));
  await svc.noteLogAndMaybeReview();
  eq("5th log after 3 days prompts (no Pro check anywhere)", requests, 1);
  eq("event carries trigger", events.find((e) => e.name === "store_review_prompt")?.params, { trigger: "log_saved" });

  await svc.noteLogAndMaybeReview();
  eq("same version: no second prompt", requests, 1);

  store.set("zerospike.reviewLastPromptVersion", "0.9.0");
  await svc.maybeRequestReview("pdf_export_success");
  eq("new version but inside 30 days: blocked", requests, 1);

  store.set("zerospike.reviewLastPromptAt", String(Date.now() - 31 * DAY));
  await svc.noteStreakAndMaybeReview(6);
  eq("streak below 7 does nothing", requests, 1);
  await svc.noteStreakAndMaybeReview(7);
  eq("streak 7 prompts through the same gates", requests, 2);
  eq("streak event trigger", events[events.length - 1].params, { trigger: "streak_7" });
  eq("streak flag set", store.get("zerospike.reviewStreak7Done"), "1");
  store.set("zerospike.reviewLastPromptAt", String(Date.now() - 31 * DAY));
  store.set("zerospike.reviewLastPromptVersion", "0.9.0");
  await svc.noteStreakAndMaybeReview(8);
  eq("streak 7 fires once", requests, 2);

  store.clear();
  store.set("zerospike.reviewFirstSeenAt", String(Date.now() - 4 * DAY));
  await svc.noteStreakAndMaybeReview(7);
  eq("blocked streak does not spend the flag", store.get("zerospike.reviewStreak7Done"), undefined);

  eq("crossing 6 to 7", svc.crossedStreak7(6, 7), true);
  eq("no crossing 7 to 7", svc.crossedStreak7(7, 7), false);
  eq("no crossing 3 to 4", svc.crossedStreak7(3, 4), false);
  eq("no crossing 0 to 1", svc.crossedStreak7(0, 1), false);
  eq("crossing via gap fill 2 to 9", svc.crossedStreak7(2, 9), true);
  eq("no crossing 8 to 9", svc.crossedStreak7(8, 9), false);

  eq("ios url", svc.writeReviewUrl("ios"), "https://apps.apple.com/app/id1?action=write-review");
  storeUrl = null;
  eq("ios without store id is null (about row hidden)", svc.writeReviewUrl("ios"), null);
  eq("android url from package", svc.writeReviewUrl("android"), "https://play.google.com/store/apps/details?id=com.example.app");

  store.clear();
  store.set("zerospike.reviewFirstSeenAt", String(Date.now() - 4 * DAY));
  store.set("zerospike.reviewLogCount", "10");
  const before = requests;
  await Promise.all([
    svc.noteLogAndMaybeReview(),
    new Promise((r) => setTimeout(r, 1)).then(() => svc.noteStreakAndMaybeReview(7)),
  ]);
  eq("concurrent triggers prompt once", requests - before, 1);

  // trial_converted: its own moment, gated by 365 days on the shared stamp.
  store.clear();
  events.length = 0;
  let r0 = requests;
  eq("trial_converted: fresh install (no baseline, no stamp) asks", await svc.maybeRequestReview("trial_converted"), true);
  eq("trial_converted: native request made", requests - r0, 1);
  eq("trial_converted: event carries the trigger", events[events.length - 1].params, { trigger: "trial_converted" });
  ok("trial_converted: writes the shared last-prompt stamp", Math.abs(Number(store.get("zerospike.reviewLastPromptAt")) - Date.now()) < 5000);
  eq("trial_converted: writes the shared last-prompt version", store.get("zerospike.reviewLastPromptVersion"), "1.0.0");

  r0 = requests;
  eq("trial_converted: a second ask right away is blocked", await svc.maybeRequestReview("trial_converted"), false);
  store.set("zerospike.reviewLastPromptAt", String(Date.now() - 364 * DAY));
  store.set("zerospike.reviewLastPromptVersion", "0.9.0");
  eq("trial_converted: 364 days after the last prompt is blocked", await svc.maybeRequestReview("trial_converted"), false);
  store.set("zerospike.reviewLastPromptAt", String(Date.now() - 366 * DAY));
  eq("trial_converted: 366 days after the last prompt asks", await svc.maybeRequestReview("trial_converted"), true);
  eq("trial_converted: and re-stamps the shared version", store.get("zerospike.reviewLastPromptVersion"), "1.0.0");
  eq("trial_converted: only the allowed asks reached the OS", requests - r0, 1);

  // Any earlier prompt counts, whichever trigger made it (shared stamp).
  store.clear();
  store.set("zerospike.reviewFirstSeenAt", String(Date.now() - 4 * DAY));
  store.set("zerospike.reviewLogCount", "10");
  await svc.maybeRequestReview("log_saved");
  r0 = requests;
  eq("trial_converted: a log_saved prompt just made blocks it", await svc.maybeRequestReview("trial_converted"), false);
  eq("trial_converted: nothing reached the OS", requests - r0, 0);

  // ...and a conversion prompt counts for the existing rule.
  store.clear();
  store.set("zerospike.reviewFirstSeenAt", String(Date.now() - 4 * DAY));
  store.set("zerospike.reviewLogCount", "10");
  await svc.maybeRequestReview("trial_converted");
  r0 = requests;
  eq("existing triggers: blocked after a conversion prompt (same version)", await svc.maybeRequestReview("log_saved"), false);
  store.set("zerospike.reviewLastPromptVersion", "0.9.0");
  eq("existing triggers: still blocked inside 30 days", await svc.maybeRequestReview("pdf_export_success"), false);
  store.set("zerospike.reviewLastPromptAt", String(Date.now() - 31 * DAY));
  eq("existing triggers: reopen on their own 30-day rule", await svc.maybeRequestReview("pdf_export_success"), true);
  eq("existing triggers: OS asked once", requests - r0, 1);

  // Existing triggers keep their baseline: a fresh install still waits.
  store.clear();
  r0 = requests;
  eq("existing triggers: no baseline, no prompt", await svc.maybeRequestReview("log_saved"), false);
  eq("existing triggers: baseline unchanged by the new trigger", requests - r0, 0);

  // A damaged or future stamp never opens the conversion prompt.
  store.clear();
  store.set("zerospike.reviewLastPromptAt", "not-a-number");
  eq("trial_converted: garbage stamp blocks", await svc.maybeRequestReview("trial_converted"), false);
  store.set("zerospike.reviewLastPromptAt", String(Date.now() + 10 * DAY));
  eq("trial_converted: future-dated stamp (clock moved) blocks", await svc.maybeRequestReview("trial_converted"), false);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
