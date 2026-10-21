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
}

for (const file of swiftFiles) {
  const code = codeOnly(readFileSync(file, "utf8"));
  for (const [re, label] of SWIFT_FORBIDDEN) {
    assert.ok(!re.test(code), `${file}: forbidden ${label}`);
  }
}
for (const file of kotlinFiles) {
  const code = codeOnly(readFileSync(file, "utf8"));
  assert.ok(!/!!/.test(code), `${file}: forbidden !! (non-null assertion)`);
  assert.ok(!/\berror\(\s*"/.test(code), `${file}: forbidden error("...")`);
}

// 2) Swift Function/AsyncFunction govdesinde duz `try` varsa do/catch icinde
let swiftBodies = 0;
for (const file of swiftFiles) {
  for (const { name, body } of functionBodies(readFileSync(file, "utf8"))) {
    swiftBodies++;
    if (PLAIN_TRY.test(body)) {
      assert.ok(
        /\bdo\s*\{/.test(body) && /\bcatch\b/.test(body),
        `${file}: ${name} uses plain try outside do/catch`
      );
    }
  }
}
assert.ok(swiftBodies >= 15, `expected the Swift function bodies, got ${swiftBodies}`);

// 3) A3: olumcul hata kancasi ve JS fonksiyonlari
const laSwift = readFileSync(
  join(MODULES, "zerospike-live-activity/ios/ZerospikeLiveActivityModule.swift"),
  "utf8"
);
assert.match(laSwift, /NSGetUncaughtExceptionHandler\(\)/, "iOS: previous handler kept");
assert.match(laSwift, /NSSetUncaughtExceptionHandler\s*\{/, "iOS: handler installed");
assert.match(laSwift, /previousUncaughtHandler\?\(exception\)/, "iOS: previous handler chained");
assert.match(laSwift, /OnCreate\s*\{\s*installFatalExceptionHandler\(\)\s*\}/, "iOS: installed on create");
assert.match(laSwift, /RCTUntruncatedMessageKey/, "iOS: full JS message kept");
assert.match(laSwift, /options: \.atomic/, "iOS: atomic write");
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

// Iki platform ayni JSON alanlarini yazar
for (const key of ["platform", "kind", "name", "reason", "stack", "build", "version", "at", "jsMessage"]) {
  assert.ok(laSwift.includes(`"${key}"`), `iOS report key ${key}`);
  assert.ok(store.includes(`"${key}"`), `Android report key ${key}`);
}

const laIndex = readFileSync(join(MODULES, "zerospike-live-activity/index.ts"), "utf8");
assert.match(laIndex, /export function getLastFatalReport\(\): FatalReport \| null/);
assert.match(laIndex, /export function clearLastFatalReport\(\): boolean/);

console.log("nativeSafety.test OK");
