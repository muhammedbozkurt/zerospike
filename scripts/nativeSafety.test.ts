// Calistir: npx tsx scripts/nativeSafety.test.ts
// Yerel native modullerin kaynak sozlesmesi (Swift/Kotlin burada derlenmez):
// cokme ureten desen yok, her Function/AsyncFunction govdesindeki throwing
// cagri do/catch icinde, A3 olumcul hata kancasi iki platformda da kurulu.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const MODULES = join(ROOT, "modules");

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Comments and string literal contents blanked, so patterns and braces are
 *  only matched in code. Line structure is kept for error messages. */
function codeOnly(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"') {
      out += '"';
      i++;
      while (i < src.length && src[i] !== '"' && src[i] !== "\n") {
        if (src[i] === "\\") i++;
        i++;
      }
      out += '"';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Bodies of every Function("x") / AsyncFunction("x") in the original source. */
function functionBodies(src: string): Array<{ name: string; body: string }> {
  const code = codeOnly(src);
  const re = /\b(?:Async)?Function\("([A-Za-z0-9_]+)"\)/g;
  const names = [...src.matchAll(re)].map((m) => m[1]);
  const starts = [...code.matchAll(/\b(?:Async)?Function\(""\)/g)].map((m) => m.index ?? 0);
  assert.equal(starts.length, names.length, "Function name / position count mismatch");
  return starts.map((start, k) => {
    const open = code.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    return { name: names[k], body: code.slice(open, end + 1) };
  });
}

const swiftFiles = walk(MODULES, ".swift").filter((p) => p.includes("/ios/"));
const kotlinFiles = walk(MODULES, ".kt").filter((p) => p.includes("/android/"));
assert.ok(swiftFiles.length >= 4, "expected the local Swift module sources");
assert.ok(kotlinFiles.length >= 3, "expected the local Kotlin module sources");

// 1) Cokme ureten desenler yok
const SWIFT_FORBIDDEN: Array<[RegExp, string]> = [
  [/\btry!/, "try!"],
  [/\bas!/, "as!"],
  [/suiteName:[^)]*\)!/, "UserDefaults(suiteName:)!"],
  [/\bfatalError\(/, "fatalError("],
  [/\bpreconditionFailure\(/, "preconditionFailure("],
  [/\.first!/, ".first!"],
];
const PLAIN_TRY = /\btry(?![?!])\b/;
const PLAIN_TRY_G = /\btry(?![?!])\b/g;

/** Generic force unwrap: `x!`, `f()!`, `a[i]!`, never `!=` or a prefix `!flag`.
 *  Run on codeOnly() text, so a `!` inside a string or comment never counts. */
const FORCE_UNWRAP: RegExp[] = [/\)!(?!=)/, /\]!(?!=)/, /[A-Za-z0-9_]!(?!=)/];

function forceUnwraps(code: string): string[] {
  const hits: string[] = [];
  const lines = code.split("\n");
  lines.forEach((line, i) => {
    if (FORCE_UNWRAP.some((re) => re.test(line))) hits.push(`${i + 1}: ${line.trim()}`);
  });
  return hits;
}

/** Position of every `{` with its matching `}` (codeOnly text). */
function bracePairs(code: string): Array<{ open: number; close: number }> {
  const pairs: Array<{ open: number; close: number }> = [];
  const stack: number[] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") stack.push(i);
    else if (code[i] === "}") {
      const open = stack.pop();
      if (open !== undefined) pairs.push({ open, close: i });
    }
  }
  return pairs;
}

/** A block that makes a plain `try` safe: a `do { } catch`, or a body declared
 *  `throws` (a func/init signature before the brace, or a closure whose
 *  `... throws ... in` header follows it). */
function isSafeBlock(code: string, open: number, close: number): boolean {
  const before = code.slice(Math.max(0, open - 400), open);
  if (/\bdo\s*$/.test(before)) return /^\s*catch\b/.test(code.slice(close + 1));
  const header = before.slice(Math.max(before.lastIndexOf("{"), before.lastIndexOf("}")) + 1);
  if (/\b(func|init)\b/.test(header) && /\b(re)?throws\b/.test(header)) return true;
  const closureHead = /^[^{}]*?\bin\b/.exec(code.slice(open + 1, open + 300));
  return closureHead != null && /\b(re)?throws\b/.test(closureHead[0]);
}

/** Every plain `try` that no enclosing block makes safe (1-based line numbers). */
function unguardedTries(code: string): number[] {
  const pairs = bracePairs(code);
  const out: number[] = [];
  for (const m of code.matchAll(PLAIN_TRY_G)) {
    const at = m.index ?? 0;
    const enclosing = pairs.filter((p) => p.open < at && at < p.close);
    if (!enclosing.some((p) => isSafeBlock(code, p.open, p.close))) {
      out.push(code.slice(0, at).split("\n").length);
    }
  }
  return out;
}

// Dedektorlerin kendisi: sentetik ornekler yakalanmali
{
  const bad = functionBodies('Function("x") { () -> Int in\n  let a = try foo()\n  return a\n}\n');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].name, "x");
  assert.ok(PLAIN_TRY.test(bad[0].body));
  assert.ok(!/\bdo\s*\{/.test(bad[0].body));
  const good = functionBodies(
    'AsyncFunction("y") { () -> Bool in\n  do { try foo(); return true } catch { return false }\n}\nFunction("z") { "}" }\n'
  );
  assert.deepEqual(good.map((g) => g.name), ["y", "z"]);
  assert.ok(/\bcatch\b/.test(good[0].body));
  assert.ok(!PLAIN_TRY.test(good[1].body));
  assert.ok(!PLAIN_TRY.test("let v = try? foo()"));
  assert.ok(SWIFT_FORBIDDEN[0][0].test(codeOnly("let x = try! foo()")));
  assert.ok(!SWIFT_FORBIDDEN[0][0].test(codeOnly("// try! only in a comment")));
  assert.ok(SWIFT_FORBIDDEN[2][0].test(codeOnly('UserDefaults(suiteName: "g")!')));

  // Genel force unwrap dedektoru
  for (const pos of ["let u = URL(string: s)!", "let l = arr.last!", 'let v = dict["k"]!', "var x: String!", "f()!.g"]) {
    assert.equal(forceUnwraps(codeOnly(pos)).length, 1, `should flag: ${pos}`);
  }
  for (const neg of [
    "if a != b { }",
    "if a!=b { }",
    "if f() != nil { }",
    "if arr[0] != x { }",
    "guard !flag else { return }",
    "if x && !y { }",
    'let s = "wow!"',
    "// done!",
  ]) {
    assert.deepEqual(forceUnwraps(codeOnly(neg)), [], `should not flag: ${neg}`);
  }

  // Duz try: en yakin guvenli blok parantez derinligiyle bulunur
  const unsafeTry = codeOnly("func a() {\n  let x = try foo()\n}\n");
  assert.deepEqual(unguardedTries(unsafeTry), [2]);
  const doNoCatch = codeOnly("func a() {\n  do {\n    try foo()\n  }\n}\n");
  assert.deepEqual(unguardedTries(doNoCatch), [3]);
  const afterDo = codeOnly("func a() {\n  do { try foo() } catch { }\n  try bar()\n}\n");
  assert.deepEqual(unguardedTries(afterDo), [3]);
  const nested = codeOnly("func a() {\n  do {\n    if ok {\n      try foo()\n    }\n  } catch {\n  }\n}\n");
  assert.deepEqual(unguardedTries(nested), []);
  const throwingFunc = codeOnly("func a() async throws -> Int {\n  return try foo()\n}\n");
  assert.deepEqual(unguardedTries(throwingFunc), []);
  const throwingClosure = codeOnly('AsyncFunction("x") { (id: String) async throws -> Bool in\n  try foo()\n  return true\n}\n');
  assert.deepEqual(unguardedTries(throwingClosure), []);
  assert.deepEqual(unguardedTries(codeOnly("func a() {\n  let v = try? foo()\n}\n")), []);
}

for (const file of swiftFiles) {
  const code = codeOnly(readFileSync(file, "utf8"));
  for (const [re, label] of SWIFT_FORBIDDEN) {
    assert.ok(!re.test(code), `${file}: forbidden ${label}`);
  }
  assert.deepEqual(forceUnwraps(code), [], `${file}: force unwrap`);
  assert.deepEqual(unguardedTries(code), [], `${file}: plain try outside do/catch or throws`);
}
for (const file of kotlinFiles) {
  const code = codeOnly(readFileSync(file, "utf8"));
  assert.ok(!/!!/.test(code), `${file}: forbidden !! (non-null assertion)`);
  assert.ok(!/\berror\(\s*"/.test(code), `${file}: forbidden error("...")`);
}

// 2) Duz `try` kurali yukarida dosya duzeyinde (her try icin en yakin guvenli
// blok). Burada yalniz govdelerin gercekten bulundugu dogrulanir.
let swiftBodies = 0;
let plainTries = 0;
for (const file of swiftFiles) {
  const src = readFileSync(file, "utf8");
  swiftBodies += functionBodies(src).length;
  plainTries += [...codeOnly(src).matchAll(PLAIN_TRY_G)].length;
}
// AlarmKit schedule/cancel/requestAuthorization and clearFatalReport: the rule
// above has real cases to judge, not an empty set.
assert.ok(plainTries >= 5, `expected plain try sites, got ${plainTries}`);
assert.ok(swiftBodies >= 15, `expected the Swift function bodies, got ${swiftBodies}`);

// 3) A3: olumcul hata kancasi ve JS fonksiyonlari
const laSwift = readFileSync(
  join(MODULES, "zerospike-live-activity/ios/ZerospikeLiveActivityModule.swift"),
  "utf8"
);
assert.match(laSwift, /NSGetUncaughtExceptionHandler\(\)/, "iOS: previous handler kept");
assert.match(laSwift, /NSSetUncaughtExceptionHandler\s*\{/, "iOS: handler installed");
assert.match(laSwift, /previousUncaughtHandler\?\(exception\)/, "iOS: previous handler chained");
assert.match(
  laSwift,
  /OnCreate\s*\{\s*logPreviousFatalReport\(\)\s*installFatalExceptionHandler\(\)\s*\}/,
  "iOS: previous report logged, then handler installed on create"
);
assert.match(laSwift, /NSLog\("%@", line\)/, "iOS: previous report to the unified log");
assert.match(laSwift, /"zerospike last fatal: /, "iOS: log line prefix");
assert.match(laSwift, /RCTUntruncatedMessageKey/, "iOS: full JS message kept");
assert.match(laSwift, /options: \.atomic/, "iOS: atomic write");
assert.match(laSwift, /isExcludedFromBackup = true/, "iOS: report kept out of backups");
assert.match(laSwift, /fatalJsMessageLimit = 2000/, "iOS: jsMessage cap");
// The crash path does no JSONSerialization and no date formatting.
const recordBody = laSwift.slice(
  laSwift.indexOf("private func recordFatalException"),
  laSwift.indexOf("private func logPreviousFatalReport")
);
assert.ok(recordBody.length > 0);
assert.ok(!/JSONSerialization|DateFormatter|Bundle\.main/.test(recordBody), "iOS: minimal crash path");
const laSwiftNames = functionBodies(laSwift).map((f) => f.name);
assert.ok(laSwiftNames.includes("getLastFatalReport"), "iOS getLastFatalReport");
assert.ok(laSwiftNames.includes("clearLastFatalReport"), "iOS clearLastFatalReport");

const laKtDir = join(
  MODULES,
  "zerospike-live-activity/android/src/main/java/expo/modules/zerospikeliveactivity"
);
const laKt = readFileSync(join(laKtDir, "ZerospikeLiveActivityModule.kt"), "utf8");
const store = readFileSync(join(laKtDir, "FatalReportStore.kt"), "utf8");
assert.match(laKt, /OnCreate\s*\{\s*appContext\.reactContext\?\.let \{ FatalReportStore\.install\(it\) \}/);
assert.match(laKt, /Function\("getLastFatalReport"\)/);
assert.match(laKt, /Function\("clearLastFatalReport"\)/);
assert.match(store, /Thread\.getDefaultUncaughtExceptionHandler\(\)/, "Android: previous handler kept");
assert.match(store, /Thread\.setDefaultUncaughtExceptionHandler/, "Android: handler installed");
assert.match(store, /previous\.uncaughtException\(thread, error\)/, "Android: previous handler chained");
assert.match(store, /\.putString\(KEY, report\.toString\(\)\)\s*\.commit\(\)/, "Android: synchronous commit");
assert.match(store, /logPrevious\(app\)[\s\S]*Thread\.setDefaultUncaughtExceptionHandler/, "Android: log before install");
assert.match(store, /Log\.e\("zerospike", /, "Android: previous report to logcat");
assert.match(store, /"zerospike last fatal: /, "Android: log line prefix");
assert.match(store, /JS_MESSAGE_LIMIT = 2000/, "Android: jsMessage cap");
assert.match(store, /report\.put\("at", System\.currentTimeMillis\(\)\)/, "Android: epoch ms");
assert.match(laSwift, /\\"at\\":" \+ String\(atMs\)/, "iOS: epoch ms");

// Iki platform ayni JSON alanlarini yazar (iOS elle birlestirir: \"key\")
for (const key of ["platform", "kind", "name", "reason", "stack", "build", "version", "at", "jsMessage"]) {
  assert.ok(laSwift.includes(`\\"${key}\\"`), `iOS report key ${key}`);
  assert.ok(store.includes(`"${key}"`), `Android report key ${key}`);
}

const laIndex = readFileSync(join(MODULES, "zerospike-live-activity/index.ts"), "utf8");
assert.match(laIndex, /export function getLastFatalReport\(\): FatalReport \| null/);
assert.match(laIndex, /export function clearLastFatalReport\(\): boolean/);

console.log("nativeSafety.test OK");
