/**
 * The winback's dismissal count: every exit that is not a purchase (X, "not now",
 * Android back, iOS swipe down) is exactly one winback_dismiss, a purchase is
 * none, and an offer that was never shown is none. Run from the repo root:
 *
 *   npx tsx scripts/winbackExit.test.ts
 */
import { readFileSync } from "node:fs";

import { createWinbackExit } from "../lib/analytics/winbackExit";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function rig() {
  const logged: string[] = [];
  const exit = createWinbackExit((name) => void logged.push(name));
  return { logged, exit };
}
const dismisses = (l: string[]) => l.filter((n) => n === "winback_dismiss").length;

{
  const { logged, exit } = rig();
  exit.viewed();
  exit.closed();
  eq("X or Decline: one winback_dismiss", dismisses(logged), 1);
  eq("with the downsell mirror event", logged, ["winback_dismiss", "downsell_dismiss"]);
}
{
  const { logged, exit } = rig();
  exit.viewed();
  exit.closed();
  exit.closed();
  exit.closed();
  eq("Decline then the beforeRemove it causes: still one", dismisses(logged), 1);
}
{
  const { logged, exit } = rig();
  exit.viewed();
  exit.closed();
  eq("back or swipe down (only beforeRemove fires): one", dismisses(logged), 1);
}
{
  const { logged, exit } = rig();
  exit.viewed();
  exit.purchased();
  exit.closed();
  eq("a purchase closes the screen: no dismiss", dismisses(logged), 0);
}
{
  const { logged, exit } = rig();
  exit.closed();
  eq("never shown (redirected away): no dismiss", dismisses(logged), 0);
}

const src = readFileSync("app/winback.tsx", "utf8");
ok("the screen counts the system exits through beforeRemove", /addListener\("beforeRemove", \(\) => exit\.closed\(\)\)/.test(src));
ok("beforeRemove never blocks the exit", !/preventDefault/.test(src));
ok("the decline button goes through the same gate", /function decline\(\) \{\s*exit\.closed\(\);/.test(src));
ok("a successful purchase marks the exit as accepted", /if \(res\.ok\) \{\s*exit\.purchased\(\);/.test(src));
ok("the view marks it viewed only for a real discount", /hasRealDiscount\) \{\s*exit\.viewed\(\);\s*logEvent\("winback_view"\)/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
