// Calistir: npx tsx scripts/fatalReport.test.ts
import assert from "node:assert/strict";
import { FATAL_JS_MESSAGE_LIMIT, isFatalJsError, parseFatalReport } from "../lib/fatalReport";

// Bos ve bozuk girdi
for (const raw of [null, undefined, "", "not json", "[]", "null", "42", '{"platform":"web"}']) {
  assert.equal(parseFatalReport(raw as string | null | undefined), null, String(raw));
}

// iOS: RCTFatal ile gelen olumcul JS hatasi
const ios = parseFatalReport(
  JSON.stringify({
    platform: "ios",
    kind: "NSException",
    name: "RCTFatalException: Unhandled JS Exception: TypeError: x is not a function",
    reason: "TypeError: x is not a function, js engine: hermes",
    jsMessage: "TypeError: x is not a function\nstack:\nrender@1:2",
    stack: ["0 CoreFoundation", 7, "1 libobjc"],
    build: "90",
    version: "2.4.0",
    at: "2026-10-21T01:30:00Z",
  })
);
assert.ok(ios);
assert.equal(ios.platform, "ios");
assert.equal(ios.build, "90");
assert.deepEqual(ios.stack, ["0 CoreFoundation", "1 libobjc"]);
assert.ok(isFatalJsError(ios));

// Android: JavascriptException, eksik alanlar bos dizgeye dusulur
const android = parseFatalReport(
  JSON.stringify({
    platform: "android",
    kind: "com.facebook.react.common.JavascriptException",
    name: "com.facebook.react.common.JavascriptException",
    reason: "Error: boom",
    thread: "mqt_v_native",
  })
);
assert.ok(android);
assert.equal(android.version, "");
assert.deepEqual(android.stack, []);
assert.equal(android.thread, "mqt_v_native");
assert.equal(android.jsMessage, undefined);
assert.ok(isFatalJsError(android));

// Native (JS disi) cokme
const native = parseFatalReport(
  JSON.stringify({ platform: "ios", kind: "NSException", name: "NSInvalidArgumentException", reason: "nil key" })
);
assert.ok(native);
assert.equal(isFatalJsError(native), false);
assert.equal(native.at, "");

// at: native epoch ms -> ISO; eski ISO dizgesi korunur; gecersiz -> ""
const atMs = parseFatalReport(JSON.stringify({ platform: "ios", at: 1792566795068 }));
assert.equal(atMs?.at, new Date(1792566795068).toISOString());
assert.equal(atMs?.at, "2026-10-21T07:13:15.068Z");
const iso = parseFatalReport(JSON.stringify({ platform: "ios", at: "2026-10-21T01:30:00Z" }));
assert.equal(iso?.at, "2026-10-21T01:30:00Z");
for (const bad of [0, -5, null, true, 1e20]) {
  assert.equal(parseFatalReport(JSON.stringify({ platform: "android", at: bad }))?.at, "", String(bad));
}

// jsMessage 2000 karakterle sinirli (native ile ayni sinir)
const long = parseFatalReport(JSON.stringify({ platform: "ios", jsMessage: "a".repeat(2600) }));
assert.equal(long?.jsMessage?.length, FATAL_JS_MESSAGE_LIMIT);
assert.equal(FATAL_JS_MESSAGE_LIMIT, 2000);

console.log("fatalReport.test OK");
