/**
 * lib/widgetRoute.ts correctness harness. No jest, same standalone style as
 * scripts/postMealTimer.test.ts.
 *
 * Also reads targets/widget/DeepLinks.swift and lib/services/androidWidget.ts
 * and feeds every `zerospike:///...` string literal found there through
 * widgetRouteForUrl, so a future widget URL that is added there but forgotten
 * here breaks this test instead of silently 404-ing on a real device.
 *
 * Run: npx tsx scripts/widgetRoute.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { widgetRouteForUrl, type WidgetRoute } from "../lib/widgetRoute";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function deepEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(name, a === b, `got ${a}, want ${b}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike widgetRoute test");

section("A. the nine documented widget URLs each resolve correctly");
{
  const cases: [string, WidgetRoute][] = [
    ["zerospike:///", { kind: "path", pathname: "/(tabs)" }],
    ["zerospike:///?sheet=glucose", { kind: "sheet", sheet: "glucose" }],
    ["zerospike:///?sheet=med", { kind: "sheet", sheet: "med" }],
    ["zerospike:///?sheet=post_meal_2h", { kind: "sheet", sheet: "post_meal_2h" }],
    ["zerospike:///?sheet=post_meal_start", { kind: "sheet", sheet: "post_meal_start" }],
    ["zerospike:///food", { kind: "path", pathname: "/(tabs)/food" }],
    [
      "zerospike:///injection?segment=map",
      { kind: "path", pathname: "/(tabs)/injection", params: { segment: "map" } },
    ],
    [
      "zerospike:///injection?compose=1",
      { kind: "path", pathname: "/(tabs)/injection", params: { compose: "1" } },
    ],
    ["zerospike:///settings/reminders", { kind: "path", pathname: "/settings/reminders" }],
  ];
  for (const [url, expected] of cases) {
    deepEq(url, widgetRouteForUrl(url), expected);
  }
}

section("B. unrecognised input resolves to null, never throws");
{
  eq("a foreign scheme", widgetRouteForUrl("https://example.com"), null);
  eq("an unknown sheet name", widgetRouteForUrl("zerospike:///?sheet=bilinmeyen"), null);
  eq("an unknown path", widgetRouteForUrl("zerospike:///bilinmeyen/rota"), null);
  eq("empty string", widgetRouteForUrl(""), null);
  eq("scheme with no path at all", widgetRouteForUrl("zerospike://"), null);
  eq(
    "a malformed percent-escape in the query does not throw",
    (() => {
      try {
        return widgetRouteForUrl("zerospike:///?sheet=%");
      } catch {
        return "THREW";
      }
    })(),
    null
  );
  eq(
    "a malformed percent-escape in the path does not throw",
    (() => {
      try {
        return widgetRouteForUrl("zerospike:///food%");
      } catch {
        return "THREW";
      }
    })(),
    null
  );
}

section("C. trailing-slash tolerance");
{
  deepEq(
    "zerospike:///food/ resolves the same as zerospike:///food",
    widgetRouteForUrl("zerospike:///food/"),
    widgetRouteForUrl("zerospike:///food")
  );
  deepEq(
    "zerospike:///settings/reminders/ resolves the same as without the trailing slash",
    widgetRouteForUrl("zerospike:///settings/reminders/"),
    widgetRouteForUrl("zerospike:///settings/reminders")
  );
}

section("D. extra/multiple query parameters");
{
  deepEq(
    "an unrelated extra param is ignored, segment still resolves",
    widgetRouteForUrl("zerospike:///injection?segment=map&x=1"),
    { kind: "path", pathname: "/(tabs)/injection", params: { segment: "map" } }
  );
}

section("E. case sensitivity");
{
  eq(
    "an uppercase sheet value is not the same as the known lowercase one",
    widgetRouteForUrl("zerospike:///?sheet=Glucose"),
    null
  );
  eq(
    "an uppercase path segment does not match the lowercase route",
    widgetRouteForUrl("zerospike:///Food"),
    null
  );
}

section("F. every URL literal in the native/JS widget sources resolves to a non-null route");
{
  // Extracts every `"zerospike:///..."` string literal from the two files that
  // actually construct these links, so adding a widget URL there without
  // teaching widgetRouteForUrl about it breaks this test.
  const repoRoot = join(__dirname, "..");
  const sources = [
    join(repoRoot, "targets/widget/DeepLinks.swift"),
    join(repoRoot, "lib/services/androidWidget.ts"),
  ];
  const found: { file: string; url: string }[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const matches = text.match(/"zerospike:\/\/\/[^"]*"/g) ?? [];
    for (const m of matches) {
      found.push({ file, url: m.slice(1, -1) });
    }
  }
  ok("at least one URL literal was found in each source file", found.length >= 5, `found ${found.length}`);
  const seen = new Set<string>();
  for (const { file, url } of found) {
    if (seen.has(url)) continue;
    seen.add(url);
    const route = widgetRouteForUrl(url);
    ok(`${url} (from ${file.replace(repoRoot + "/", "")}) resolves to a non-null route`, route !== null);
  }
  console.log(`  (${seen.size} distinct URL literal(s) checked)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
