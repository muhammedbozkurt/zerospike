/**
 * Prints the contrast ratio of every semantic token pair (both palettes) and
 * exits 1 when any pair is below its threshold (4.5 text, 3 large text/icon/graphic).
 * Run: node scripts/theme-contrast.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = spawnSync("npx", ["tsx", "scripts/theme.test.ts", "--report"], {
  cwd: root,
  encoding: "utf8",
});
const lines = (run.stdout || "").split("\n").filter((l) => /^(LOW |    )(light|dark )/.test(l));
for (const l of lines) console.log(l);
const low = lines.filter((l) => l.startsWith("LOW ")).length;
console.log(`\n${lines.length} pairs, ${low} below threshold`);
if (run.error || (lines.length === 0 && run.status !== 0)) {
  console.error(run.stderr || String(run.error));
  process.exit(1);
}
process.exit(low > 0 ? 1 : 0);
