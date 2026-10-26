/** J43: the number inside a small ring is capped by what the ring can hold,
 *  and the glucose ring caption wraps inside the ring ("5 Messungen").
 *  Run: npx -y tsx scripts/ringTextFit.test.ts */
import { readFileSync } from "node:fs";
import { FONT_CAP, ringNumberCap } from "../lib/layoutForFontScale";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const compact = ringNumberCap({ size: 64, strokeWidth: 11, number: "72", suffix: "%" });
const full = ringNumberCap({ size: 96, strokeWidth: 11, number: "72", suffix: "%" });
ok("compact paywall ring is capped below the default", compact < FONT_CAP.ringNumber && compact >= 1);
ok("full ring keeps the default cap", full === FONT_CAP.ringNumber);
ok("a longer number caps lower", ringNumberCap({ size: 64, strokeWidth: 11, number: "100", suffix: "%" }) <= compact);
ok("never below 1", ringNumberCap({ size: 20, strokeWidth: 11, number: "100", suffix: "%" }) === 1);

const donut = src("components/rich/TIRDonut.tsx");
ok("donut uses the cap", donut.includes("ringNumberCap("));
const ring = src("components/rich/GlucoseRing.tsx");
ok("ring caption wraps inside the ring", /maxWidth:\s*size \* 0\.\d+/.test(ring) && /textAlign:\s*"center"/.test(ring));

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("ringTextFit ok");
