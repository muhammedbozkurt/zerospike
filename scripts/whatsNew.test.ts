/**
 * Standalone harness for the "What's new" sheet's pure rules (lib/whatsNew.ts):
 * updater vs fresh install, the once-only flag, the route/ordering gate and the
 * survey hand-off. No jest; compile + run with node (repo root):
 *
 *   npx tsc scripts/whatsNew.test.ts lib/whatsNew.ts lib/feedbackSurvey.ts --ignoreConfig \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution bundler --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/whatsNew.test.js
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  WHATS_NEW_ITEMS,
  WHATS_NEW_SEEN_KEY,
  isWhatsNewRoute,
  markWhatsNewSeen,
  parseRelease,
  surveyInTheWay,
  takeWhatsNew,
  whatsNewDue,
  whatsNewMayPresent,
  type WhatsNewGate,
} from "../lib/whatsNew";
import { SURVEY_ASKED_KEY, SURVEY_PENDING_KEY, type KeyValueStore } from "../lib/feedbackSurvey";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}
function eq<T>(name: string, got: T, want: T): void {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function memoryKv(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: async (k) => (k in data ? data[k] : null),
    set: async (k, v) => {
      data[k] = v;
    },
  };
}

const brokenKv: KeyValueStore = {
  get: async () => {
    throw new Error("storage down");
  },
  set: async () => {
    throw new Error("storage down");
  },
};

async function main(): Promise<void> {
  console.log("A. version parsing");
  eq("2.4.0", parseRelease("2.4.0"), [2, 4]);
  eq("2.4", parseRelease("2.4"), [2, 4]);
  eq("2.10.3", parseRelease("2.10.3"), [2, 10]);
  eq("pre-release suffix", parseRelease("2.4.0-beta.1"), [2, 4]);
  eq("empty", parseRelease(""), null);
  eq("null", parseRelease(null), null);
  eq("garbage", parseRelease("abc"), null);
  eq("one part", parseRelease("2"), null);

  console.log("B. who is owed the sheet");
  ok("updater from 2.3.x (flag absent)", whatsNewDue({ onboarded: true, appVersion: "2.4.0", seen: null }));
  ok("updater to 2.4.2", whatsNewDue({ onboarded: true, appVersion: "2.4.2", seen: null }));
  ok("fresh install stamped on 2.4.0", !whatsNewDue({ onboarded: true, appVersion: "2.4.0", seen: "2.4.0" }));
  ok("already seen", !whatsNewDue({ onboarded: true, appVersion: "2.4.1", seen: "2.4.0" }));
  ok("2.3.x install stamped 2.3.7, updates to 2.4", whatsNewDue({ onboarded: true, appVersion: "2.4.0", seen: "2.3.7" }));
  ok("not onboarded", !whatsNewDue({ onboarded: false, appVersion: "2.4.0", seen: null }));
  ok("still on 2.3.x", !whatsNewDue({ onboarded: true, appVersion: "2.3.7", seen: null }));
  ok("unreadable version", !whatsNewDue({ onboarded: true, appVersion: "", seen: null }));
  ok("unreadable flag counts as seen", !whatsNewDue({ onboarded: true, appVersion: "2.4.0", seen: "x" }));
  ok("next major is still due when unseen", whatsNewDue({ onboarded: true, appVersion: "3.0.0", seen: null }));

  console.log("C. once-only flag");
  {
    const kv = memoryKv();
    ok("first take", await takeWhatsNew(kv, { onboarded: true, appVersion: "2.4.0" }));
    eq("flag written", kv.data[WHATS_NEW_SEEN_KEY], "2.4.0");
    ok("second take is empty", !(await takeWhatsNew(kv, { onboarded: true, appVersion: "2.4.0" })));
  }
  {
    const kv = memoryKv();
    ok("not onboarded takes nothing", !(await takeWhatsNew(kv, { onboarded: false, appVersion: "2.4.0" })));
    eq("and writes nothing", Object.keys(kv.data).length, 0);
  }
  {
    const kv = memoryKv();
    await markWhatsNewSeen(kv, "2.4.0");
    ok("fresh install: onboarding stamp means never shown", !(await takeWhatsNew(kv, { onboarded: true, appVersion: "2.4.0" })));
  }
  {
    const kv = memoryKv();
    await markWhatsNewSeen(kv, "");
    eq("unreadable version stamps the release", kv.data[WHATS_NEW_SEEN_KEY], "2.4");
  }
  ok("storage failure shows nothing", !(await takeWhatsNew(brokenKv, { onboarded: true, appVersion: "2.4.0" })));
  await markWhatsNewSeen(brokenKv, "2.4.0");
  ok("stamp failure does not throw", true);

  console.log("D. gate");
  const open: WhatsNewGate = {
    ready: true,
    onboarded: true,
    screenshotMode: false,
    root: "(tabs)",
    winbackHold: false,
    surveyBusy: false,
  };
  ok("open", whatsNewMayPresent(open));
  ok("not ready", !whatsNewMayPresent({ ...open, ready: false }));
  ok("not onboarded", !whatsNewMayPresent({ ...open, onboarded: false }));
  ok("screenshot mode", !whatsNewMayPresent({ ...open, screenshotMode: true }));
  ok("winback deciding", !whatsNewMayPresent({ ...open, winbackHold: true }));
  ok("survey busy", !whatsNewMayPresent({ ...open, surveyBusy: true }));
  for (const root of ["onboarding", "paywall", "downsell", "winback", "sos", "spike", "alarm-tour", undefined]) {
    ok(`blocked on ${String(root)}`, !whatsNewMayPresent({ ...open, root }));
  }
  ok("tabs route", isWhatsNewRoute("(tabs)"));

  console.log("E. survey hand-off");
  const keys = { pending: SURVEY_PENDING_KEY, asked: SURVEY_ASKED_KEY };
  ok("nothing armed", !(await surveyInTheWay(memoryKv(), false, keys)));
  ok("armed and waiting", await surveyInTheWay(memoryKv({ [SURVEY_PENDING_KEY]: "true" }), false, keys));
  ok(
    "survey shown this session",
    await surveyInTheWay(memoryKv({ [SURVEY_ASKED_KEY]: "true", [SURVEY_PENDING_KEY]: "false" }), false, keys)
  );
  ok(
    "survey asked in an earlier session does not block",
    !(await surveyInTheWay(memoryKv({ [SURVEY_ASKED_KEY]: "true", [SURVEY_PENDING_KEY]: "false" }), true, keys))
  );
  ok("storage failure holds the sheet back", await surveyInTheWay(brokenKv, false, keys));

  console.log("F. copy");
  eq("four lines", WHATS_NEW_ITEMS.length, 4);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("crashed", e);
  process.exit(1);
});
