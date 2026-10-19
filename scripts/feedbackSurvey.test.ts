/**
 * Standalone harness for the feedback sheet's pure rules (lib/feedbackSurvey.ts):
 * the request body and its client-side validation, how answers are read, the
 * analytics payload, the cancellation detection and the ask-once flag. No jest;
 * compile + run with node (repo root):
 *
 *   npx tsc scripts/feedbackSurvey.test.ts lib/feedbackSurvey.ts --ignoreConfig \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution bundler --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/feedbackSurvey.test.js
 *
 * (scripts/feedback.test.ts is the older harness for the toast/dialog host rules.)
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare function require(id: string): any;

import {
  CANCEL_REASONS,
  FEEDBACK_UUID,
  MAX_MESSAGE_CHARS,
  SURVEY_ASKED_KEY,
  SURVEY_PENDING_KEY,
  buildFeedbackBody,
  buildFeedbackRequest,
  canSend,
  classifyFeedbackStatus,
  cleanMessage,
  detectProLoss,
  draftProblem,
  failureMessageKey,
  feedbackEventProps,
  holdSurvey,
  isSurveyRoute,
  isValidEmail,
  noteProState,
  onSurveyRelease,
  surveyHeld,
  surveyMayPresent,
  BAD_CHARS,
  createSendSlot,
  markSurveyAsked,
  mayCloseByButton,
  mayCloseByGesture,
  overlayOpen,
  peekPendingSurvey,
  registerOverlay,
  type FeedbackDraft,
  type KeyValueStore,
  type SurveyGate,
} from "../lib/feedbackSurvey";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

function memoryKv(): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    async get(k) {
      return k in data ? data[k] : null;
    },
    async set(k, v) {
      data[k] = v;
    },
  };
}

const ctx = { appVersion: "2.3.8", platform: "ios", locale: "tr" };
const draft = (over: Partial<FeedbackDraft>): FeedbackDraft => ({
  kind: "suggestion",
  reasonCode: null,
  message: "",
  email: "",
  ...over,
});

async function main(): Promise<void> {
  section("A. validation");
  eq("suggestion needs text", draftProblem(draft({})), "empty");
  eq("spaces only is empty", draftProblem(draft({ message: "  \n " })), "empty");
  eq("bug with text ok", draftProblem(draft({ kind: "bug", message: "x" })), null);
  eq("survey empty", draftProblem(draft({ kind: "cancel_survey" })), "empty");
  eq("survey with reason only ok", draftProblem(draft({ kind: "cancel_survey", reasonCode: "expensive" })), null);
  eq("survey with text only ok", draftProblem(draft({ kind: "cancel_survey", message: "pahali" })), null);
  eq("typed bad email", draftProblem(draft({ message: "x", email: "abc" })), "bad_email");
  eq("good email", draftProblem(draft({ message: "x", email: " a@b.co " })), null);
  ok("email without dot", !isValidEmail("a@b"));
  ok("email with space", !isValidEmail("a b@c.de"));
  ok("email too long", !isValidEmail("a".repeat(250) + "@b.co"));
  ok("canSend ignores a typo in the email", canSend(draft({ message: "x", email: "zz" })));
  ok("canSend false when empty", !canSend(draft({})));
  eq("cleanMessage trims and unifies breaks", cleanMessage("  a\r\nb \r"), "a\nb");
  eq("cleanMessage cuts to the limit", Array.from(cleanMessage("x".repeat(MAX_MESSAGE_CHARS + 50))).length, MAX_MESSAGE_CHARS);

  section("B. request body");
  eq(
    "suggestion body",
    buildFeedbackBody(draft({ message: " Merhaba ", email: " a@b.co " }), ctx),
    { kind: "suggestion", message: "Merhaba", contact_email: "a@b.co", app_version: "2.3.8", platform: "ios", locale: "tr" }
  );
  eq(
    "survey body carries the reason",
    buildFeedbackBody(draft({ kind: "cancel_survey", reasonCode: "not_used" }), ctx),
    { kind: "cancel_survey", reason_code: "not_used", app_version: "2.3.8", platform: "ios", locale: "tr" }
  );
  ok("reason is dropped for a suggestion", !("reason_code" in buildFeedbackBody(draft({ message: "x", reasonCode: "bug" }), ctx)));
  ok("empty email is left out", !("contact_email" in buildFeedbackBody(draft({ message: "x" }), ctx)));
  eq(
    "unusable context is dropped, not sent",
    buildFeedbackBody(draft({ message: "x" }), { appVersion: "", platform: "web", locale: "??" }),
    { kind: "suggestion", message: "x" }
  );
  const req = buildFeedbackRequest("0b6f0c0e-1111-4222-8333-444455556666", { kind: "other", message: "m" });
  eq("method", req.method, "POST");
  eq("device header", req.headers["x-device-id"], "0b6f0c0e-1111-4222-8333-444455556666");
  eq("json header", req.headers["Content-Type"], "application/json");
  eq("body is the json", JSON.parse(req.body), { kind: "other", message: "m" });
  ok("uuid check accepts a v4", FEEDBACK_UUID.test("0b6f0c0e-1111-4222-8333-444455556666"));
  ok("uuid check rejects the fallback", !FEEDBACK_UUID.test("unknown-device"));
  for (const r of CANCEL_REASONS) {
    ok(`reason ${r} is a server reason`, ["expensive", "not_used", "missing_feature", "bug", "other_app", "other"].includes(r));
  }

  section("C. answers");
  eq("200", classifyFeedbackStatus(200), { ok: true });
  eq("429", classifyFeedbackStatus(429), { ok: false, reason: "rate_limited" });
  eq("400", classifyFeedbackStatus(400), { ok: false, reason: "rejected" });
  eq("413", classifyFeedbackStatus(413), { ok: false, reason: "rejected" });
  eq("500", classifyFeedbackStatus(500), { ok: false, reason: "unavailable" });
  eq("503", classifyFeedbackStatus(503), { ok: false, reason: "unavailable" });
  eq("rate limit text key", failureMessageKey("rate_limited"), "feedback.errorRateLimited");
  eq("rejected text key", failureMessageKey("rejected"), "feedback.errorRejected");
  eq("network text key", failureMessageKey("unavailable"), "feedback.errorNetwork");
  eq("unconfigured is a generic error", failureMessageKey("not_configured"), "feedback.errorGeneric");
  eq("no installation id is a generic error", failureMessageKey("no_device_id"), "feedback.errorGeneric");

  section("D. analytics carries kind and reason only");
  eq("survey props", feedbackEventProps(draft({ kind: "cancel_survey", reasonCode: "expensive", message: "SECRET", email: "a@b.co" })), {
    kind: "cancel_survey",
    reason_code: "expensive",
  });
  eq("survey without a reason", feedbackEventProps(draft({ kind: "cancel_survey", message: "x" })), { kind: "cancel_survey", reason_code: "none" });
  eq("bug props", feedbackEventProps(draft({ kind: "bug", reasonCode: "bug", message: "x" })), { kind: "bug", reason_code: "none" });
  ok("no text key", !JSON.stringify(feedbackEventProps(draft({ message: "SECRET", email: "a@b.co" }))).includes("SECRET"));

  section("E. cancellation detection");
  ok("true to false is a loss", detectProLoss(true, false));
  ok("first look is a baseline", !detectProLoss(null, false));
  ok("false to false is not", !detectProLoss(false, false));
  ok("still pro is not", !detectProLoss(true, true));
  ok("gaining pro is not", !detectProLoss(false, true));

  section("F. ask-once flag");
  {
    const kv = memoryKv();
    ok("first look while free arms nothing", !(await noteProState(kv, false)));
    ok("nothing pending", !(await peekPendingSurvey(kv)));
    ok("pro seen: nothing armed", !(await noteProState(kv, true)));
    ok("loss arms", await noteProState(kv, false));
    eq("pending written", kv.data[SURVEY_PENDING_KEY], "true");
    ok("a second look keeps it armed", await noteProState(kv, false));
    ok("peek says due", await peekPendingSurvey(kv));
    ok("peek writes nothing: a sheet that never appeared leaves it armed", !(SURVEY_ASKED_KEY in kv.data) && (await peekPendingSurvey(kv)));
    await markSurveyAsked(kv);
    eq("asked written once the sheet is shown", kv.data[SURVEY_ASKED_KEY], "true");
    eq("pending cleared", kv.data[SURVEY_PENDING_KEY], "false");
    ok("never again", !(await peekPendingSurvey(kv)));
    await noteProState(kv, true);
    ok("a second loss does not re-arm", !(await noteProState(kv, false)));
    ok("and is not due", !(await peekPendingSurvey(kv)));
  }
  {
    const kv = memoryKv();
    await noteProState(kv, true);
    await noteProState(kv, false);
    ok("regaining pro disarms an unshown survey", !(await noteProState(kv, true)));
    eq("pending cleared on regain", kv.data[SURVEY_PENDING_KEY], "false");
    ok("nothing due after regain", !(await peekPendingSurvey(kv)));
  }
  {
    const broken: KeyValueStore = {
      get: async () => {
        throw new Error("storage");
      },
      set: async () => {
        throw new Error("storage");
      },
    };
    ok("storage failure never arms", !(await noteProState(broken, false)));
    ok("storage failure never shows", !(await peekPendingSurvey(broken)));
    await markSurveyAsked(broken);
    ok("storage failure on mark does not throw", true);
  }

  section("G. when the survey may open");
  const gate: SurveyGate = { ready: true, onboarded: true, isPro: false, screenshotMode: false, root: "(tabs)", winbackHold: false, overlayOpen: false };
  ok("open on the tabs", surveyMayPresent(gate));
  ok("open on the bare root", surveyMayPresent({ ...gate, root: undefined }));
  ok("not while the winback decides", !surveyMayPresent({ ...gate, winbackHold: true }));
  ok("not while another Modal is open", !surveyMayPresent({ ...gate, overlayOpen: true }));
  ok("not over the winback",!surveyMayPresent({ ...gate, root: "winback" }));
  ok("not over the paywall", !surveyMayPresent({ ...gate, root: "paywall" }));
  ok("not over the downsell", !surveyMayPresent({ ...gate, root: "downsell" }));
  ok("not over onboarding", !surveyMayPresent({ ...gate, root: "onboarding" }));
  ok("not over SOS", !surveyMayPresent({ ...gate, root: "sos" }));
  ok("not over the calculator", !surveyMayPresent({ ...gate, root: "calculator" }));
  ok("not over settings", !surveyMayPresent({ ...gate, root: "settings" }));
  ok("not when pro again", !surveyMayPresent({ ...gate, isPro: true }));
  ok("not before ready", !surveyMayPresent({ ...gate, ready: false }));
  ok("not before onboarding", !surveyMayPresent({ ...gate, onboarded: false }));
  ok("not in screenshot mode", !surveyMayPresent({ ...gate, screenshotMode: true }));
  ok("route helper", isSurveyRoute("(tabs)") && !isSurveyRoute("paywall"));

  section("H. winback goes first");
  {
    let released = 0;
    const off = onSurveyRelease(() => {
      released++;
    });
    ok("free at start", !surveyHeld());
    const a = holdSurvey();
    const b = holdSurvey();
    ok("held", surveyHeld());
    a();
    a();
    ok("still held by the second", surveyHeld());
    eq("no release yet", released, 0);
    b();
    ok("released", !surveyHeld());
    eq("listener told once", released, 1);
    off();
    holdSurvey()();
    eq("unsubscribed listener stays quiet", released, 1);
  }

  section("I. another Modal on screen keeps the survey out");
  {
    let released = 0;
    const off = onSurveyRelease(() => {
      released++;
    });
    ok("no overlay at start", !overlayOpen());
    const sheet = registerOverlay();
    const dialog = registerOverlay();
    ok("overlay open", overlayOpen());
    ok("the gate closes with it", !surveyMayPresent({ ...gate, overlayOpen: overlayOpen() }));
    sheet();
    sheet();
    ok("one still open", overlayOpen());
    eq("not told yet", released, 0);
    dialog();
    ok("all closed", !overlayOpen());
    ok("the gate reopens", surveyMayPresent({ ...gate, overlayOpen: overlayOpen() }));
    eq("told once when the last closes", released, 1);
    const hold = holdSurvey();
    const o = registerOverlay();
    hold();
    eq("a hold released under an open overlay does not tell", released, 1);
    o();
    eq("the overlay closing does", released, 2);
    off();
  }

  section("J. sending and closing");
  {
    const slot = createSendSlot();
    ok("first press wins the slot", slot.tryAcquire());
    ok("a second press before the answer is refused", !slot.tryAcquire());
    slot.release();
    ok("after the answer it can send again", slot.tryAcquire());
    slot.release();
    ok("gesture close while sending is refused", !mayCloseByGesture({ busy: true, survey: false, hasText: false }));
    ok("button close while sending is refused", !mayCloseByButton({ busy: true }));
    ok("survey with text: scrim and back stay shut", !mayCloseByGesture({ busy: false, survey: true, hasText: true }));
    ok("survey without text closes by gesture", mayCloseByGesture({ busy: false, survey: true, hasText: false }));
    ok("general sheet closes by gesture even with text (the draft is kept)", mayCloseByGesture({ busy: false, survey: false, hasText: true }));
    ok("the button works when idle", mayCloseByButton({ busy: false }));
  }

  section("K. client text rules are the server's");
  {
    const fs = require("fs");
    const nodePath = require("path");
    const server: string = fs.readFileSync(nodePath.join(process.cwd(), "supabase/functions/feedback/validate.ts"), "utf8");
    const bad = /const BAD = "([^"]*)";/.exec(server);
    ok("server BAD set found", bad !== null);
    eq("client email character set equals the server's", BAD_CHARS, bad ? bad[1].replace(/\\\\/g, "\\") : "");
    const strip = (name: string) => {
      const m = new RegExp("const " + name + " = (/.*/[a-z]*);").exec(server);
      return m ? m[1] : "";
    };
    const client: string = fs.readFileSync(nodePath.join(process.cwd(), "lib/feedbackSurvey.ts"), "utf8");
    for (const name of ["CONTROL", "LONE_SURROGATE", "INVISIBLE"]) {
      const s = strip(name);
      ok(`server ${name} found`, s !== "");
      ok(`client ${name} is the server's`, s !== "" && client.includes(`const ${name} = ${s};`));
    }
    eq("only zero-width characters count as empty", draftProblem(draft({ message: "\u200b\u200e\u202e" })), "empty");
    eq("control characters count as empty", draftProblem(draft({ message: "\u0001\u0007\u007f" })), "empty");
    eq("a lone surrogate counts as empty", draftProblem(draft({ message: "\ud800" })), "empty");
    eq("tab and newline are not stripped from inside", cleanMessage("a\tb\nc"), "a\tb\nc");
    eq("zero-width inside text is dropped", cleanMessage("a\u200bb"), "ab");
    eq("an e-mail with a zero-width character is bad", draftProblem(draft({ message: "x", email: "a\u200b@b.co" })), "bad_email");
    eq("an e-mail with a bidi override is bad", draftProblem(draft({ message: "x", email: "a@b\u202e.co" })), "bad_email");
    eq("a normal e-mail is fine", draftProblem(draft({ message: "x", email: "ali@örnek.com.tr" })), null);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("crashed", e);
  process.exit(1);
});
