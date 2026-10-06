/**
 * Standalone harness: every literal logEvent("name", { ... }) call in app/,
 * components/ and lib/ is checked against analytics schema v1
 * (lib/analytics/eventSchema.ts), statically, with no React Native and no jest.
 *
 *   npx tsc scripts/eventCallsites.test.ts lib/analytics/eventSchema.ts \
 *     --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution node --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/eventCallsites.test.js
 *
 * Run from the repo root. What it enforces:
 * - the event name is in the schema (or in the Firebase-only list, whose fields
 *   are not checked), and is not one of the retired names;
 * - the literal field names of the call are a subset of the schema's fields, and
 *   literal values fit their field type (enum member, identifier string, int,
 *   a real boolean);
 * - a call with a plain object literal carries every field of its event;
 * - every schema event the app is meant to emit has a call site somewhere;
 * - every log_added call site also calls noteFirstLog.
 *
 * Calls it cannot read (a name or a params object that is not a literal) are
 * listed at the end and never fail the run.
 */

// Minimal ambient decls so we need no @types/node / dom lib.
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import {
  EVENT_SCHEMA,
  FIREBASE_ONLY_EVENTS,
  sanitizeEvent,
  type EventSpec,
} from "../lib/analytics/eventSchema";

interface Dirent {
  name: string;
  isDirectory: () => boolean;
}
const fs = require("fs") as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
  readdirSync: (p: string, opts: { withFileTypes: true }) => Dirent[];
};
const nodePath = require("path") as {
  join: (...parts: string[]) => string;
  dirname: (p: string) => string;
};

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const ROOT = (() => {
  const isRoot = (dir: string) =>
    fs.existsSync(nodePath.join(dir, "package.json")) &&
    fs.existsSync(nodePath.join(dir, "lib", "db", "index.ts"));
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (isRoot(dir)) return dir;
    dir = nodePath.dirname(dir);
  }
  if (isRoot(process.cwd())) return process.cwd();
  throw new Error("could not locate the repo root from " + __dirname);
})();

const SCHEMA = EVENT_SCHEMA as Record<string, EventSpec>;
const FIREBASE_ONLY = FIREBASE_ONLY_EVENTS as readonly string[];
// Names the app used to send under another shape; a call site using one has
// missed its rename.
const RETIRED = ["report_generated", "review_prompted"];
// The Supabase sink writes these two itself, so no call site is expected.
const SINK_PRODUCED = ["app_open", "analytics_opt_out"];
const SCAN_DIRS = ["app", "components", "lib"];

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

// ---------------------------------------------------------------- the scanner

/** Index just past the string or template literal that opens at `i`. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (quote === "`" && c === "$" && text[j + 1] === "{") {
      j = skipBalanced(text, j + 1) + 1;
      continue;
    }
    if (c === quote) return j + 1;
    j++;
  }
  return text.length;
}

/** Index of the bracket that closes the one opening at `i`, skipping strings and comments. */
function skipBalanced(text: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'" || c === "`") {
      j = skipString(text, j);
      continue;
    }
    if (c === "/" && text[j + 1] === "/") {
      const nl = text.indexOf("\n", j);
      j = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === "/" && text[j + 1] === "*") {
      const end = text.indexOf("*/", j + 2);
      j = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return text.length - 1;
}

/** Splits at top-level commas; comments are dropped, strings and nesting kept whole. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let j = 0;
  while (j < body.length) {
    const c = body[j];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(body, j);
      cur += body.slice(j, end);
      j = end;
      continue;
    }
    if (c === "/" && body[j + 1] === "/") {
      const nl = body.indexOf("\n", j);
      j = nl === -1 ? body.length : nl;
      continue;
    }
    if (c === "/" && body[j + 1] === "*") {
      const end = body.indexOf("*/", j + 2);
      j = end === -1 ? body.length : end + 2;
      cur += " ";
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      j++;
      continue;
    }
    cur += c;
    j++;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter((p) => p.length > 0);
}

interface Entry {
  /** null for a spread, a computed key or anything else the scanner cannot read. */
  key: string | null;
  value: string;
}

function parseEntry(entry: string): Entry {
  if (entry.startsWith("...")) return { key: null, value: entry.slice(3) };
  let m = /^(?:"([^"]+)"|'([^']+)')\s*:\s*([\s\S]*)$/.exec(entry);
  if (m) return { key: m[1] !== undefined ? m[1] : m[2], value: m[3] };
  m = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(entry);
  if (m) return { key: m[1], value: m[2] };
  m = /^([A-Za-z_$][\w$]*)$/.exec(entry);
  if (m) return { key: m[1], value: m[1] };
  return { key: null, value: entry };
}

interface Call {
  file: string;
  line: number;
  /** null when the first argument is not a plain string literal. */
  name: string | null;
  /** "object": a literal { ... } the scanner read; "dynamic": anything else. */
  params: "none" | "object" | "dynamic";
  entries: Entry[];
}

function literalString(arg: string): string | null {
  const m = /^(["'])([^"'\\]*)\1$/.exec(arg) || /^`([^`$\\]*)`$/.exec(arg);
  if (!m) return null;
  return m.length === 3 ? m[2] : m[1];
}

function scanSource(file: string, text: string): Call[] {
  const calls: Call[] = [];
  const re = /(?<![.\w$])logEvent\s*\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
    const before = text.slice(lineStart, m.index);
    if (before.includes("//") || /^\s*(\*|\/\*)/.test(before)) continue;
    if (/\bfunction\s+$/.test(before)) continue;
    const open = m.index + m[0].length - 1;
    const close = skipBalanced(text, open);
    const args = splitTopLevel(text.slice(open + 1, close));
    const line = text.slice(0, m.index).split("\n").length;
    const name = args.length > 0 ? literalString(args[0]) : null;
    let params: Call["params"] = "none";
    let entries: Entry[] = [];
    if (args.length > 1) {
      const second = args[1];
      if (second.startsWith("{") && skipBalanced(second, 0) === second.length - 1) {
        params = "object";
        entries = splitTopLevel(second.slice(1, -1)).map(parseEntry);
      } else {
        params = "dynamic";
      }
    }
    calls.push({ file, line, name, params, entries });
  }
  return calls;
}

type Literal = { kind: "string" | "number" | "bool"; value: string | number | boolean };

function literalOf(value: string): Literal | null {
  const text = value.trim();
  const str = literalString(text);
  if (str !== null) return { kind: "string", value: str };
  if (text === "true" || text === "false") return { kind: "bool", value: text === "true" };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: "number", value: Number(text) };
  return null;
}

/** The string literals a ternary hands out: `c ? "a" : "b"` gives a and b. */
function ternaryBranches(value: string): string[] {
  const m = /\?\s*(["'])([^"']*)\1\s*:\s*(["'])([^"']*)\3\s*$/.exec(value.trim());
  return m ? [m[2], m[4]] : [];
}

// ------------------------------------------------------- A. scanner self-test

section("A. the scanner reads what it claims to");
{
  const sample = [
    "export function logEvent(name: string): void {}",
    '// logEvent("commented_out", { a: 1 });',
    ' * logEvent("in_block_comment");',
    "analytics().logEvent(name, params);",
    'logEvent("plain");',
    'logEvent("shorthand", { kind, done: status === "done", n: 1 });',
    'logEvent("multi", {\n  // it\'s a comment, with a comma\n  a: foo(1, 2),\n  b: { c: 1, d: 2 },\n  e: x ? "p" : "q",\n});',
    'logEvent("spread", { ...base, a: 1 });',
    'logEvent("dyn_params", params);',
    "logEvent(name, { a: 1 });",
    "logEvent(`tpl`, { a: `x${y}`, 'quoted-key': 2 });",
  ].join("\n");
  const found = scanSource("sample.tsx", sample);
  eq(
    "finds only real calls",
    found.map((c) => c.name),
    ["plain", "shorthand", "multi", "spread", "dyn_params", null, "tpl"]
  );
  eq("a bare call has no params", found[0].params, "none");
  eq(
    "shorthand and keyed fields",
    found[1].entries.map((e) => e.key),
    ["kind", "done", "n"]
  );
  eq(
    "comments, calls and nested objects do not leak fields",
    found[2].entries.map((e) => e.key),
    ["a", "b", "e"]
  );
  eq(
    "a spread is unreadable, not a field",
    found[3].entries.map((e) => e.key),
    [null, "a"]
  );
  eq("an identifier as params is dynamic", found[4].params, "dynamic");
  eq("a non-literal name is dynamic", found[5].name, null);
  eq(
    "a template literal and a quoted key",
    found[6].entries.map((e) => e.key),
    ["a", "quoted-key"]
  );
  eq("ternary branches are read", ternaryBranches('x ? "p" : "q"'), ["p", "q"]);
  eq("a literal string is read", literalOf('"template"'), { kind: "string", value: "template" });
}

// ----------------------------------------------------------- B. the repository

function listFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(nodePath.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") listFiles(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(rel);
    }
  }
}

const files: string[] = [];
for (const dir of SCAN_DIRS) listFiles(dir, files);
const sources = new Map<string, string>();
const allCalls: Call[] = [];
for (const file of files) {
  const text = fs.readFileSync(nodePath.join(ROOT, file), "utf8");
  sources.set(file, text);
  allCalls.push(...scanSource(file, text));
}
const named = allCalls.filter((c) => c.name !== null);
const where = (c: Call) => `${c.file}:${c.line}`;

section("B. every call names an event of the schema");
{
  ok("the scan reaches the app", files.length > 100, `${files.length} files`);
  ok("and finds the call sites", named.length >= 40, `${named.length} named calls`);
  for (const call of named) {
    const name = call.name as string;
    ok(
      `${where(call)} "${name}" is in schema v1 or the Firebase-only list`,
      hasOwn(SCHEMA, name) || FIREBASE_ONLY.includes(name)
    );
    ok(`${where(call)} "${name}" is not a retired name`, !RETIRED.includes(name));
  }
}

section("C. literal fields fit the event they are sent with");
{
  for (const call of named) {
    const name = call.name as string;
    if (!hasOwn(SCHEMA, name)) continue;
    const spec = SCHEMA[name];
    const keys = call.entries.map((e) => e.key);
    const readable = call.params !== "dynamic" && keys.every((k) => k !== null);

    for (const entry of call.entries) {
      if (entry.key === null) continue;
      ok(
        `${where(call)} ${name}.${entry.key} is a field of the event`,
        hasOwn(spec, entry.key),
        `schema fields: ${Object.keys(spec).join(", ") || "none"}`
      );
    }

    // Literal values go through the real sanitizer, so the type rules cannot drift.
    const literals: Record<string, string | number | boolean> = {};
    for (const entry of call.entries) {
      if (entry.key === null || !hasOwn(spec, entry.key)) continue;
      const lit = literalOf(entry.value);
      if (lit) literals[entry.key] = lit.value;
    }
    for (const issue of sanitizeEvent(name, literals).issues) {
      if (issue.startsWith("missing field")) continue;
      ok(`${where(call)} ${name}: ${issue}`, false);
    }

    for (const entry of call.entries) {
      if (entry.key === null || !hasOwn(spec, entry.key)) continue;
      const fieldSpec = spec[entry.key];
      if (typeof fieldSpec !== "string") {
        for (const branch of ternaryBranches(entry.value)) {
          ok(
            `${where(call)} ${name}.${entry.key} "${branch}" is one of ${fieldSpec.join("|")}`,
            fieldSpec.includes(branch)
          );
        }
      }
      if (fieldSpec === "bool") {
        ok(
          `${where(call)} ${name}.${entry.key} is a real boolean`,
          !/\?\s*(?:-?\d+|["'][^"']*["'])\s*:\s*(?:-?\d+|["'][^"']*["'])/.test(entry.value),
          entry.value
        );
      }
    }

    if (readable) {
      for (const field of Object.keys(spec)) {
        ok(
          `${where(call)} ${name} carries the field "${field}"`,
          keys.includes(field),
          `has: ${keys.join(", ") || "no params"}`
        );
      }
    }
  }
}

section("D. every event the app is meant to emit has a call site");
{
  const emitted = new Set(named.map((c) => c.name as string));
  for (const name of Object.keys(SCHEMA)) {
    if (SINK_PRODUCED.includes(name)) continue;
    ok(`${name} is emitted somewhere`, emitted.has(name));
  }
}

section("E. log_added call sites also note the first log");
{
  const added = named.filter((c) => c.name === "log_added");
  ok("there are log_added call sites", added.length >= 8, `${added.length}`);
  for (const call of added) {
    const kind = call.entries.find((e) => e.key === "kind");
    ok(`${where(call)} log_added carries a kind`, kind !== undefined);
    if (!kind) continue;
    const lit = literalOf(kind.value);
    // Imports from Health are not entries the user made, so they are not a first log.
    if (lit && lit.value === "health_import") continue;
    const text = sources.get(call.file) as string;
    if (lit && lit.kind === "string") {
      ok(
        `${where(call)} noteFirstLog("${lit.value}") is called in the same file`,
        text.includes(`noteFirstLog("${lit.value}")`)
      );
    } else {
      ok(`${where(call)} noteFirstLog is called in the same file`, /noteFirstLog\(/.test(text));
    }
  }
}

// ---------------------------------------------------------------- the report

section("Calls the scanner could not read (listed, not failed)");
{
  const unreadable = allCalls.filter(
    (c) => c.name === null || c.params === "dynamic" || c.entries.some((e) => e.key === null)
  );
  for (const call of unreadable) {
    const label = call.name === null ? "logEvent(<dynamic name>)" : `logEvent("${call.name}")`;
    const why = call.params === "dynamic" ? "params are not a literal" : "a spread or computed key";
    console.log(`  ${where(call)} ${label}: ${why}`);
  }
  if (unreadable.length === 0) console.log("  none");

  const legacy = named.filter((c) => FIREBASE_ONLY.includes(c.name as string));
  console.log(
    `\nFirebase-only calls (fields not checked): ${
      legacy.map((c) => `${c.name} @ ${where(c)}`).join(", ") || "none"
    }`
  );
}

console.log(
  `\n${passed} passed, ${failed} failed (${named.length} named calls in ${files.length} files)`
);
if (failed > 0) process.exit(1);
