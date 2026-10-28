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

ok("paywall: buy CTA shows a spinner while purchasing and is locked while busy", /<GradientCTA\s+label=\{ctaLabel\}\s+loading=\{purchasing\}\s+allowTwoLines\s+disabled=\{busy \|\| pendingApproval\}\s+onPress=\{buy\}/.test(read("app/paywall.tsx")));
{
  const pw = read("app/paywall.tsx");
  const buyBody = pw.slice(pw.indexOf("async function buy()"));
  ok("paywall: buy() hands straight to the tested flow (its first statement is the double-tap guard)", /^async function buy\(\) \{\s*await flowRef\.current!\.buy\(planRef\.current\);/.test(buyBody));
  ok("paywall: the flow's first statement refuses a press while an exit decision holds the lock", /async buy\(plan: PaywallPlan\)[^{]*\{\s*(\/\/[^\n]*\s*)*if \(deps\.isExiting\(\) \|\| !purchaseUiAcceptsPress\(state\)\) return "ignored";/.test(read("lib/paywallBuyFlow.ts")));
  ok("paywall: a cancelled sheet goes through requestAfterCancel (stay unless downsell)", /requestAfterCancel\(/.test(pw) && !/requestExit\(/.test(pw));
  ok("paywall: the headline follows the selected plan", /showTrialTimeline\(plan, annualTrial\)\s*\? t\("paywall\.headlineTrial"/.test(pw));
  ok("paywall: the priced CTA may wrap, nothing shrinks it", /allowTwoLines/.test(pw) && /adjustsFontSizeToFit=\{!allowTwoLines\}/.test(read("components/rich/GradientCTA.tsx")));
  ok("downsell and winback open the Pro welcome after a new purchase", ["app/downsell.tsx", "app/winback.tsx"].every((f) => /shouldOpenWelcomeAfterPurchase\(\{ recovered: res\.recovered === true, stepsLeft: false \}\)[^}]*router\.replace\("\/pro-welcome"\)/s.test(read(f))));
  ok("paywall: a user close is still blocked while busy (the flow feeds the exit controller)", /\(\) => flowRef\.current!\.isBusy\(\)/.test(pw));
  ok("paywall: the funnel events carry paywall_version", ["paywall_view", "paywall_cta", "paywall_dismiss", "paywall_tier_selected", "purchase_result", "purchase_completed"].every((e) => new RegExp('logEvent\\("' + e + '",[^;]*paywall_version: PAYWALL_VERSION', "s").test(pw)));
}
ok("paywall: restore locked while busy", /onPress=\{onRestore\}\s+disabled=\{busy\}/.test(read("app/paywall.tsx")));
ok("downsell: accept locked while busy", /disabled=\{busy( \|\| awaitingApproval)?\}\s+onPress=\{accept\}/.test(read("app/downsell.tsx")));
ok("downsell: decline locked while busy", /onPress=\{decline\}\s+disabled=\{busy\}/.test(read("app/downsell.tsx")));
ok("winback: accept locked while busy", /disabled=\{busy( \|\| awaitingApproval)?\}\s+onPress=\{accept\}/.test(read("app/winback.tsx")));
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
