/**
 * Scroll hint: pure rules (lib/scrollHint.ts) plus the source contract that
 * wires it into the shared sheet shell, the paywall, settings and the sheets.
 * Run: npx tsx scripts/scrollHint.test.ts
 */
declare const require: (m: string) => any;
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  SCROLL_HINT_GAP_PT,
  SCROLL_HINT_KEY_PREFIX,
  SCROLL_HINT_OVERFLOW_PT,
  SCROLL_HINT_SCROLLED_PT,
  hasOverflow,
  hintBottomOffset,
  scrollHintKey,
  scrollHintMotion,
  shouldShowHint,
} from "../lib/scrollHint";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
}
const read = (p: string): string => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const base = { contentHeight: 1200, viewportHeight: 700, scrollY: 0, seen: false };

// Visibility
ok("tasan + kaydirilmamis -> gosterilir", shouldShowHint(base));
ok("sigiyor -> gosterilmez", !shouldShowHint({ ...base, contentHeight: 600 }));
ok("tam sigiyor -> gosterilmez", !shouldShowHint({ ...base, contentHeight: 700 }));
ok("esik icinde tasma (24 pt) -> gosterilmez", !shouldShowHint({ ...base, contentHeight: 700 + SCROLL_HINT_OVERFLOW_PT }));
ok("esigi asan tasma -> gosterilir", shouldShowHint({ ...base, contentHeight: 700 + SCROLL_HINT_OVERFLOW_PT + 1 }));
ok("scrollY esik icinde -> gosterilir", shouldShowHint({ ...base, scrollY: SCROLL_HINT_SCROLLED_PT }));
ok("scrollY > esik -> gizlenir", !shouldShowHint({ ...base, scrollY: SCROLL_HINT_SCROLLED_PT + 1 }));
ok("daha once gosterildi -> bir daha gosterilmez", !shouldShowHint({ ...base, seen: true }));
ok("olculmemis (0) -> gosterilmez", !shouldShowHint({ ...base, contentHeight: 0 }) && !shouldShowHint({ ...base, viewportHeight: 0 }));
ok("hasOverflow NaN guvenli", !hasOverflow(NaN, 700) && !hasOverflow(1000, NaN));

// Reduce motion
const full = scrollHintMotion(false);
const still = scrollHintMotion(true);
ok("normal: animasyon + fade, 2 dongu", full.animate && full.fade && full.loops === 2);
ok("reduce motion: animasyon yok, fade yok, tek kare", !still.animate && !still.fade && still.loops === 0);

// Bottom offset
ok("sabit CTA yuksekligi ustunde", hintBottomOffset({ pinnedHeight: 96, insetBottom: 34 }) === 96 + SCROLL_HINT_GAP_PT);
ok("CTA yoksa alt inset ustunde", hintBottomOffset({ insetBottom: 34 }) === 34 + SCROLL_HINT_GAP_PT);
ok("hicbiri yoksa yalniz bosluk", hintBottomOffset({}) === SCROLL_HINT_GAP_PT);
ok("negatif girdi sifira kenetlenir", hintBottomOffset({ pinnedHeight: -5, insetBottom: -3 }) === SCROLL_HINT_GAP_PT);

// Persistent key
ok("kalici anahtar adi", scrollHintKey("paywall") === "zerospike.scrollHintSeen.paywall");
ok("anahtar oneki", SCROLL_HINT_KEY_PREFIX === "zerospike.scrollHintSeen.");

// Source contract
{
  const hook = read("lib/useScrollHint.ts");
  ok("hook: AsyncStorage try/catch + bellek ici", hook.includes("seenInMemory") && hook.includes("catch"));
  ok("hook: reduceMotionChanged dinler", hook.includes("reduceMotionChanged") && hook.includes("isReduceMotionEnabled"));
  ok("hook: ilk gosterimde kalici isaretler", hook.includes("markSeen(screenId)"));
  ok("hook: onScroll/onContentSizeChange/onLayout/visible doner", /return \{ onScroll, onContentSizeChange, onLayout, visible/.test(hook));

  const comp = read("components/ScrollHint.tsx");
  ok("bilesen: dokunmayi engellemez", comp.includes('pointerEvents="none"'));
  ok("bilesen: ekran okuyucudan gizli", comp.includes("accessibilityElementsHidden") && comp.includes("no-hide-descendants"));
  ok("bilesen: chevron-down", comp.includes('"chevron-down"'));
  ok("bilesen: sabit renk yok", !/#[0-9a-fA-F]{3,8}\b/.test(comp) && !comp.includes("rgba("));
  ok("bilesen: adjustsFontSizeToFit yok", !comp.includes("adjustsFontSizeToFit"));
  ok("bilesen: reduce motion dali scrollHintMotion'dan", comp.includes("scrollHintMotion(reduce)") && comp.includes("motion.animate") && comp.includes("motion.fade"));
  ok("bilesen: ortalama sol/sag 0 + alignItems center (RTL guvenli)", comp.includes("left: 0, right: 0") && comp.includes('alignItems: "center"'));

  const shell = read("components/SheetShell.tsx");
  ok("SheetShell: ScrollHint kullanir", shell.includes("<ScrollHint") && shell.includes("useScrollHint("));
  ok("SheetShell: ScrollView'a onScroll/onLayout baglar", shell.includes("onScroll={hint.onScroll}") && shell.includes("onLayout={hint.onLayout}"));
  ok("SheetShell: ipucu ScrollView'dan sonra, footer'dan once",
    shell.indexOf("</ScrollView>") < shell.indexOf("<ScrollHint") && shell.indexOf("<ScrollHint") < shell.indexOf("{footer ?"));
  ok("SheetShell: klavye kabugu korunur", shell.includes("automaticallyAdjustKeyboardInsets={false}") && shell.includes("useSheetKeyboard(visible)"));

  const pay = read("app/paywall.tsx");
  ok("paywall: ScrollHint kullanir", pay.includes("<ScrollHint") && pay.includes('useScrollHint("paywall")'));
  ok("paywall: ipucu ScrollView ile CTA bandi arasinda",
    pay.indexOf("</ScrollView>") < pay.indexOf("<ScrollHint") && pay.indexOf("<ScrollHint") < pay.indexOf("Pinned CTA band"));

  const set = read("components/settingsUi.tsx");
  ok("SettingsScaffold: scrollHintId ile ScrollHint", set.includes("scrollHintId") && set.includes("<ScrollHint"));
  for (const f of ["app/settings/app.tsx", "app/settings/data.tsx", "app/settings/profile.tsx"]) {
    ok(`${f}: scrollHintId verir`, read(f).includes("scrollHintId="));
  }
  ok("settings hub: ScrollHint", read("app/(tabs)/settings.tsx").includes("<ScrollHint"));
  ok("MealCompose: ScrollHint", read("components/MealComposeSheet.tsx").includes("<ScrollHint"));
  ok("CarbEstimate: ScrollHint", read("components/CarbEstimateSheet.tsx").includes("<ScrollHint"));
  ok("InjectionSiteSheet: SheetShell uzerinden kimlikli", read("components/InjectionSiteSheet.tsx").includes('scrollHintId="injection-site"'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
