/**
 * Standalone, dependency-free harness for the feedback host-stack rule. No jest;
 * compile + run with node:
 *
 *   npx tsc scripts/feedbackHost.test.ts lib/feedbackHost.ts --ignoreConfig \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution bundler --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/feedbackHost.test.js
 *
 * The rule this locks down: exactly one host paints, and it is always the
 * most recently registered one. A dialog painted by any other host would sit
 * underneath the screen the user is actually looking at (the R3 11.1 bug).
 */

// Minimal ambient decls so we need no @types/node / dom lib.
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { activeHostId, popHost, pushHost } from "../lib/feedbackHost";

let failures = 0;

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}: expected ${e}, got ${a}`);
  }
}

console.log("feedback host stack");

// Nothing mounted yet: no host, and no owner to attribute a dialog to.
eq("empty stack has no active host", activeHostId([]), null);

// The root layout's host serves the tabs and every non-modal route.
const root = pushHost([], 0);
eq("root host alone is active", activeHostId(root), 0);

// Opening a modal screen (e.g. scan) hands the overlays to that screen.
const withScan = pushHost(root, 1);
eq("stack after opening a modal screen", withScan, [0, 1]);
eq("newest host wins", activeHostId(withScan), 1);

// Stacking a second modal (e.g. paywall over add-food) hands them on again.
const withPaywall = pushHost(withScan, 2);
eq("topmost of three is active", activeHostId(withPaywall), 2);

// Closing the top screen returns the overlays to the one underneath.
eq("closing the top host falls back", activeHostId(popHost(withPaywall, 2)), 1);

// router.replace mounts the new screen before the old one unmounts, so the
// departing host is NOT on top. Removing it must not disturb the painter.
const replaced = popHost(withPaywall, 1);
eq("removing a middle host keeps the stack ordered", replaced, [0, 2]);
eq("removing a middle host does not change the painter", activeHostId(replaced), 2);

// Closing every modal screen returns to the root host, never to "no host".
eq("back to root", activeHostId(popHost(popHost(withPaywall, 2), 1)), 0);

// Unregistering an id that was never registered is a no-op, not a corruption.
eq("unknown id is a no-op", popHost(withScan, 99), [0, 1]);

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
