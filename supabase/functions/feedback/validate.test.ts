import { cleanText, installIdFrom, parseFeedback, validEmail } from "./validate.ts";

function assertEq(a: unknown, b: unknown) {
  if (a !== b) throw new Error(`expected ${String(b)} got ${String(a)}`);
}

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function err(body: unknown): string {
  const r = parseFeedback(body);
  return r.ok ? "ok" : r.error;
}

Deno.test("kind whitelist", () => {
  assertEq(err({ kind: "other", message: "hi" }), "ok");
  assertEq(err({ kind: "suggestion", message: "hi" }), "ok");
  assertEq(err({ kind: "bug", message: "hi" }), "ok");
  assertEq(err({ kind: "nope", message: "hi" }), "bad_kind");
  assertEq(err({ message: "hi" }), "bad_kind");
  assertEq(err("text"), "bad_request");
  assertEq(err([]), "bad_request");
  assertEq(err(null), "bad_request");
});

Deno.test("reason_code whitelist, cancel_survey only", () => {
  assertEq(err({ kind: "cancel_survey", reason_code: "expensive" }), "ok");
  assertEq(err({ kind: "cancel_survey", reason_code: "bogus" }), "bad_reason_code");
  assertEq(err({ kind: "other", message: "x", reason_code: "expensive" }), "bad_reason_code");
  assertEq(err({ kind: "cancel_survey" }), "empty_feedback");
  assertEq(err({ kind: "cancel_survey", message: "too dear" }), "ok");
});

Deno.test("message required for non-survey kinds, trimmed and cut", () => {
  assertEq(err({ kind: "other" }), "empty_feedback");
  assertEq(err({ kind: "other", message: "   \n " }), "empty_feedback");
  assertEq(err({ kind: "other", message: 5 }), "bad_message");
  const long = parseFeedback({ kind: "other", message: "a".repeat(2500) });
  if (!long.ok) throw new Error("expected ok");
  assertEq(long.value.message?.length, 2000);
});

Deno.test("cleanText strips control characters, keeps newline and tab", () => {
  assertEq(cleanText("a\u0000b\u0007c\u007fd\u0085e", 100), "abcde");
  assertEq(cleanText("a\r\nb\rc\td", 100), "a\nb\nc\td");
  assertEq(cleanText("  hi  ", 100), "hi");
});

Deno.test("cleanText counts code points, not UTF-16 units", () => {
  const out = cleanText("\u{1F600}".repeat(5), 3);
  assertEq(Array.from(out).length, 3);
  assertEq(cleanText("ğüşiı".repeat(3), 4), "ğüşi");
});

Deno.test("email format", () => {
  assertEq(validEmail("a@b.co"), true);
  assertEq(validEmail("a b@c.de"), false);
  assertEq(validEmail("no-at.example.com"), false);
  assertEq(validEmail("a@b"), false);
  assertEq(validEmail("a@@b.com"), false);
  assertEq(validEmail("a".repeat(250) + "@b.co"), false);
  assertEq(err({ kind: "other", message: "x", contact_email: "bad" }), "bad_contact_email");
  assertEq(err({ kind: "other", message: "x", contact_email: 3 }), "bad_contact_email");
  const ok = parseFeedback({ kind: "other", message: "x", contact_email: "  a@b.co " });
  if (!ok.ok) throw new Error("expected ok");
  assertEq(ok.value.contact_email, "a@b.co");
  const blank = parseFeedback({ kind: "other", message: "x", contact_email: "  " });
  if (!blank.ok) throw new Error("expected ok");
  assertEq(blank.value.contact_email, null);
});

Deno.test("platform whitelist; version and locale sanitized to null", () => {
  assertEq(err({ kind: "other", message: "x", platform: "web" }), "bad_platform");
  const r = parseFeedback({
    kind: "other",
    message: "x",
    platform: "ios",
    app_version: "2.3.8",
    locale: "pt-BR",
  });
  if (!r.ok) throw new Error("expected ok");
  assertEq(r.value.platform, "ios");
  assertEq(r.value.app_version, "2.3.8");
  assertEq(r.value.locale, "pt-BR");
  const bad = parseFeedback({ kind: "other", message: "x", app_version: "<script>", locale: "not a locale" });
  if (!bad.ok) throw new Error("expected ok");
  assertEq(bad.value.app_version, null);
  assertEq(bad.value.locale, null);
});

Deno.test("install id: header wins, body fallback, uuid only", () => {
  assertEq(installIdFrom(ID.toUpperCase(), {}), ID);
  assertEq(installIdFrom(null, { install_id: ID }), ID);
  assertEq(installIdFrom("", { install_id: ID }), ID);
  assertEq(installIdFrom("not-a-uuid", { install_id: ID }), null);
  assertEq(installIdFrom(null, { install_id: "x" }), null);
  assertEq(installIdFrom(null, {}), null);
  assertEq(installIdFrom(null, "str"), null);
});
