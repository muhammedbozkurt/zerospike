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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
