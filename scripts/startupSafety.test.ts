// Calistir: npx tsx scripts/startupSafety.test.ts
//
// Build 90 regresyonu: lib/services/widgetTheme.ts acilista
// `await import("react-native")` cagiriyordu. Bu, RN index'inin tum tembel
// getter'larini gezer (Metro importAll); PushNotificationIOS getter'i native
// modulu olmadan atar ve async yolda Metro'nun guardedLoadModule'u bunu
// ErrorUtils.reportFatalError'a verir: release'te RCTFatal, try/catch korumaz.
// Bu test acilis import grafigini (index.js + app/ altindaki tum rotalar,
// goreli importlar ozyinelemeli) kaynak taramasiyla denetler.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SAFE_NATIVE = "lib/safeNative.ts";
const TOP_LEVEL_REQUIRE_ALLOW = new Set(["react", "react-native", "expo-router/entry"]);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const EXT = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const SPEC_RE = /(?:\bfrom\s+|\bimport\s+|\brequire\(\s*|(?<!typeof\s)\bimport\(\s*)"([^"]+)"/g;

function buildGraph(roots: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(SPEC_RE)) {
      const dep = resolveLocal(file, m[1]);
      if (dep && !seen.has(dep)) stack.push(dep);
    }
  }
  return [...seen];
}

/** Depth stack of `{` openers; true where the opener is a `try {`. */
function insideTry(src: string, index: number): boolean {
  const stack: boolean[] = [];
  for (let i = 0; i < index; i++) {
    const c = src[i];
    if (c === "{") stack.push(/\btry\s*$/.test(src.slice(Math.max(0, i - 12), i)));
    else if (c === "}") stack.pop();
  }
  return stack.includes(true);
}

export function checkSource(raw: string): string[] {
  const src = stripComments(raw);
  const out: string[] = [];
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+"react-native"/g))
    out.push(`L${lineOf(m.index!)}: import * as ... from "react-native" (importAll, PushNotificationIOS getter atar)`);
  for (const m of src.matchAll(/(?<!typeof\s)\bimport\(\s*"([^".@][^"]*|@[^"/]+\/[^"]+)"\s*\)/g))
    out.push(`L${lineOf(m.index!)}: dinamik import("${m[1]}"): paket yuklemesi safeRequire ile yapilir`);
  for (const m of src.matchAll(/\b(requireNativeModule|getEnforcing)\(/g))
    out.push(`L${lineOf(m.index!)}: ${m[1]}( atar; requireOptionalNativeModule veya safeRequire kullan`);
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var)\s+[^\n]*\bNativeModules\./gm))
    out.push(`L${lineOf(m.index!)}: modul duzeyi NativeModules erisimi`);
  for (const m of src.matchAll(/^(?=\S)[^\n]*?\brequire\(\s*"([^".][^"]*)"\s*\)/gm)) {
    if (!TOP_LEVEL_REQUIRE_ALLOW.has(m[1]))
      out.push(`L${lineOf(m.index!)}: modul duzeyi require("${m[1]}"): safeRequire ile sar`);
  }
  for (const m of src.matchAll(/\.(defineTask|registerTaskAsync)\(/g)) {
    if (!insideTry(src, m.index!)) out.push(`L${lineOf(m.index!)}: ${m[1]} try/catch disinda`);
  }
  return out;
}

// 1) Denetcinin kendisi: build 90'in hatali kodunu ve ornek ihlalleri yakalar.
assert.ok(checkSource('async function f() {\n  const { Platform } = await import("react-native");\n}').length === 1);
assert.ok(checkSource('import * as RN from "react-native";').length === 1);
assert.ok(checkSource('const m = requireNativeModule("X");').length === 1);
assert.ok(checkSource('const t = require("expo-task-manager");').length === 1);
assert.ok(checkSource("function f() {\n  TM.defineTask(N, async () => {});\n}").length === 1);
assert.deepEqual(checkSource("function f() {\n  try {\n    TM.defineTask(N, async () => {});\n  } catch {}\n}"), []);
assert.deepEqual(checkSource('type M = typeof import("expo-task-manager");'), []);
assert.deepEqual(checkSource('const x = await import("./androidWidget");'), []);
assert.deepEqual(checkSource('const m = requireOptionalNativeModule("X");'), []);

// 2) Acilis grafigi.
const roots = [join(ROOT, "index.js"), ...walk(join(ROOT, "app"))];
const graph = buildGraph(roots);
const rel = (p: string) => relative(ROOT, p);
for (const must of ["app/_layout.tsx", "lib/services/widgetTheme.ts", "lib/theme/ThemeProvider.tsx", "lib/services/healthBackground.ts", "lib/fatalCapture.ts", "modules/zerospike-live-activity/index.ts"]) {
  assert.ok(graph.map(rel).includes(must), `grafikte olmali: ${must}`);
}

const violations: string[] = [];
for (const file of graph) {
  const r = rel(file);
  if (r === SAFE_NATIVE || r.startsWith("node_modules")) continue;
  for (const v of checkSource(readFileSync(file, "utf8"))) violations.push(`${r} ${v}`);
}
assert.deepEqual(violations, [], `acilis guvenligi ihlalleri:\n${violations.join("\n")}`);

// 3) CGM-E: expo-secure-store native modulu eski ikilide yok. JS paketi import
// aninda atar, bu yuzden yalniz requireOptionalNativeModule ile dogrudan
// konusulur; modul yoksa Nightscout satiri gizlenir, guvensiz yedek yol yok.
{
  const graphRel = graph.map(rel);
  assert.ok(graphRel.includes("lib/secureStore.ts"), "lib/secureStore.ts acilis grafiginde olmali");
  const secure = stripComments(readFileSync(join(ROOT, "lib/secureStore.ts"), "utf8"));
  assert.ok(/requireOptionalNativeModule<[^>]*>\(\s*"ExpoSecureStore"\s*\)/.test(secure), "secureStore: requireOptionalNativeModule('ExpoSecureStore')");
  assert.ok(!/from\s+"expo-secure-store"|require\(\s*"expo-secure-store"\s*\)/.test(secure), "secureStore: JS paketi import edilmez");
  assert.ok(!/AsyncStorage|localStorage/.test(secure), "secureStore: guvensiz yedek depo yok");
  const ui = stripComments(readFileSync(join(ROOT, "app/settings/data-sources.tsx"), "utf8"));
  assert.ok(/const nsAvailable = nightscoutEnabled\(\) && nightscoutAvailable\(\)/.test(ui), "data-sources: bayrak ve secure store varligi sorgulanir");
  assert.ok(/\.\.\.\(nsAvailable\s*\?\s*\[/.test(ui), "data-sources: Nightscout secenegi nsAvailable arkasinda");
  assert.ok(/nsAvailable && \(mode === "nightscout" \|\| nsFormOpen\)/.test(ui), "data-sources: panel nsAvailable arkasinda");
  const sync = stripComments(readFileSync(join(ROOT, "lib/services/sourceSync.ts"), "utf8"));
  assert.ok(/secure:\s*secureStoreAvailable\(\)\s*\?/.test(sync), "sourceSync: modul yoksa secure null");
}

console.log(`startupSafety: OK (${graph.length} dosya tarandi)`);
