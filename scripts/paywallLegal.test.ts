/**
 * Purchase-screen legal links: source-reading guard. The links to the privacy
 * policy and terms are a store requirement on every screen that sells, and the
 * purchase / restore buttons must stay locked while a request is in flight.
 * Neither is a value a pure function returns, so the source text is pinned.
 *
 * Run: npx tsx scripts/paywallLegal.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;

import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(__dirname, "..", rel), "utf8");
}

console.log("zerospike paywall legal links test");

const screens = ["app/paywall.tsx", "app/downsell.tsx", "app/winback.tsx"];

for (const file of screens) {
  const src = read(file);
  ok(`${file}: privacy link opens privacyUrl()`, /<LegalLink\s+label=\{t\("settings\.privacy"\)\}\s+onPress=\{\(\) => Linking\.openURL\(privacyUrl\(\)\)\}/.test(src));
  ok(`${file}: terms link opens termsUrl()`, /<LegalLink\s+label=\{t\("settings\.terms"\)\}\s+onPress=\{\(\) => Linking\.openURL\(termsUrl\(\)\)\}/.test(src));
  ok(`${file}: no tertiary Button left for the legal links`, !/<Button[^>]*label=\{t\("settings\.(privacy|terms)"\)\}/.test(src));
  ok(`${file}: imports LegalLink`, /import \{ LegalLink \} from "\.\.\/components\/LegalLink"/.test(src));
}

ok("paywall: buy CTA locked while busy", /<GradientCTA label=\{ctaLabel\} disabled=\{busy\} onPress=\{buy\}/.test(read("app/paywall.tsx")));
ok("paywall: restore locked while busy", /onPress=\{onRestore\}\s+disabled=\{busy\}/.test(read("app/paywall.tsx")));
ok("downsell: accept locked while busy", /disabled=\{busy\}\s+onPress=\{accept\}/.test(read("app/downsell.tsx")));
ok("downsell: decline locked while busy", /onPress=\{decline\}\s+disabled=\{busy\}/.test(read("app/downsell.tsx")));
ok("winback: accept locked while busy", /disabled=\{busy\}\s+onPress=\{accept\}/.test(read("app/winback.tsx")));
ok("winback: decline locked while busy", /onPress=\{decline\}\s+disabled=\{busy\}/.test(read("app/winback.tsx")));

const link = read("components/LegalLink.tsx");
ok("LegalLink: link role", /accessibilityRole="link"/.test(link));
ok("LegalLink: underlined", /textDecorationLine: "underline"/.test(link));
ok("LegalLink: HIT_TARGET floor", /minHeight: HIT_TARGET/.test(link));
ok("LegalLink: label may wrap", !/numberOfLines/.test(link));

for (const file of ["app/winback.tsx", "app/downsell.tsx"]) {
  ok(`${file}: legal row wraps`, /flex-row flex-wrap items-center justify-center">\s+<LegalLink/.test(read(file)));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
