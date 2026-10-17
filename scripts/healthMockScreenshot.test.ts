/**
 * lib/services/healthMock.ts: screenshot mode must not generate samples
 * (they were imported as source=health rows on every launch and leaked into
 * the seeded dashboard); normal dev mode keeps producing them.
 *
 * Run: npx tsx scripts/healthMockScreenshot.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; env: Record<string, string | undefined> };

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const src = readFileSync(join(__dirname, "..", "lib/services/healthMock.ts"), "utf8");
const fn = src.slice(src.indexOf("export function readMockGlucose"), src.indexOf("export function mockHealthSummary"));
eq("guard imported", src.includes('import { isScreenshotMode } from "../screenshotMode";'), true);
eq("guard precedes generation", fn.indexOf("isScreenshotMode()") > -1 && fn.indexOf("isScreenshotMode()") < fn.indexOf("Math.random"), true);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
g.__DEV__ = true;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");
const origLoad = Module._load;
Module._load = (req: string, ...rest: unknown[]) =>
  req === "react-native" ? { Platform: { OS: "ios" } } : origLoad(req, ...rest);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mock = require("../lib/services/healthMock");

process.env.EXPO_PUBLIC_SCREENSHOT_MODE = "1";
eq("screenshot mode: no samples", mock.readMockGlucose().length, 0);

process.env.EXPO_PUBLIC_SCREENSHOT_MODE = "0";
eq("normal mode: 24 samples", mock.readMockGlucose().length, 24);

delete process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
eq("unset flag: 24 samples", mock.readMockGlucose().length, 24);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
