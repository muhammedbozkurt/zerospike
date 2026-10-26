/** J6: the list clears the floating "add record" bar by its MEASURED height
 *  (a wrapped label at AX5 is taller than the one-line formula), J2: each tablet
 *  column is its own VoiceOver group.
 *  Run: npx -y tsx scripts/ctaClearance.test.ts */
import { readFileSync } from "node:fs";
import { ctaFootprintPx } from "../lib/layoutForFontScale";

let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

eq("not measured yet: formula", ctaFootprintPx(0, 90), 90);
eq("measured taller (wrapped label): measured", ctaFootprintPx(210, 90), 210);
eq("measured shorter never shrinks the formula", ctaFootprintPx(60, 90), 90);
eq("garbage ignored", ctaFootprintPx(Number.NaN, 90), 90);

const idx = src("app/(tabs)/index.tsx");
eq("index measures the CTA bar", /onLayout=\{\(e\) => setCtaHeight\(/.test(idx), true);
const left = idx.indexOf("movableBlocks.slice(0, columnSplit?.leftCount ?? 0)");
const right = idx.indexOf("movableBlocks.slice(columnSplit?.leftCount ?? 0)");
eq("left column renders before right column", left > 0 && right > left, true);
const fabric = src("node_modules/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm");
eq(
  "Fabric views group their children natively",
  /shouldGroupAccessibilityChildren\s*\{\s*return YES;/.test(fabric),
  true
);

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("ctaClearance ok");
