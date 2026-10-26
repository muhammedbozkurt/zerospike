/**
 * Home empty state, ring meaning and the example badge.
 * Run: npx tsx scripts/homeEmpty.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  bosDurumKarari,
  cgmHomeState,
  cgmHomeVisible,
  todayRangeShare,
  usesTwoColumn,
  welcomePreviewMode,
  welcomeRoomForPreview,
  WELCOME_HEIGHTS,
} from "../lib/homeEmpty";
import { pct } from "../lib/format";
import { setActiveLang } from "../lib/lang";
import tr from "../lib/i18n/locales/tr";
import en from "../lib/i18n/locales/en";
import de from "../lib/i18n/locales/de";
import fr from "../lib/i18n/locales/fr";
import es from "../lib/i18n/locales/es";
import it from "../lib/i18n/locales/it";
import pt from "../lib/i18n/locales/pt";
import ar from "../lib/i18n/locales/ar";
import ja from "../lib/i18n/locales/ja";

let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

check("bosDurumKarari: feed not read yet is loading, never welcome", () => {
  assert.equal(bosDurumKarari({ loaded: false, entries: 0 }), "loading");
  assert.equal(bosDurumKarari({ loaded: false, entries: 12 }), "loading");
});

check("bosDurumKarari: loaded with no record is welcome", () => {
  assert.equal(bosDurumKarari({ loaded: true, entries: 0 }), "welcome");
});

check("bosDurumKarari: first record switches to the normal layout", () => {
  const before = bosDurumKarari({ loaded: true, entries: 0 });
  const after = bosDurumKarari({ loaded: true, entries: 1 });
  assert.equal(before, "welcome");
  assert.equal(after, "normal");
  assert.equal(bosDurumKarari({ loaded: true, entries: 40 }), "normal");
});

check("two-column branch: tablet normal and loading yes, welcome never, phone never", () => {
  assert.equal(usesTwoColumn("normal", true), true);
  assert.equal(usesTwoColumn("loading", true), true);
  assert.equal(usesTwoColumn("welcome", true), false);
  assert.equal(usesTwoColumn("normal", false), false);
  assert.equal(usesTwoColumn("welcome", false), false);
});

check("todayRangeShare: ring fill is the in-range share", () => {
  assert.equal(todayRangeShare(0, 0), null);
  assert.equal(todayRangeShare(4, 3), 75);
  assert.equal(todayRangeShare(3, 3), 100);
  assert.equal(todayRangeShare(3, 0), 0);
  assert.equal(todayRangeShare(3, 1), 33);
  assert.equal(todayRangeShare(2, 9), 100);
  assert.equal(todayRangeShare(Number.NaN, 1), null);
});

// iPhone SE 3 (667), iPhone Pro Max (932).
const SE = { screenHeight: 667, topInset: 20, bottomInset: 0 };
const PRO_MAX = { screenHeight: 932, topInset: 59, bottomInset: 34 };

check("layout: Pro Max fits cards + steps + full preview on the first screen", () => {
  const room = welcomeRoomForPreview(PRO_MAX);
  console.log(`     Pro Max room under the steps: ${room}pt (full needs ${WELCOME_HEIGHTS.previewFull})`);
  assert.equal(welcomePreviewMode(PRO_MAX), "full");
});

check("layout: SE fits cards + steps, preview shortens (scroll accepted)", () => {
  const room = welcomeRoomForPreview(SE);
  console.log(`     SE room under the steps: ${room}pt (compact needs ${WELCOME_HEIGHTS.previewCompact}, full ${WELCOME_HEIGHTS.previewFull})`);
  assert.ok(room > 0);
  assert.equal(welcomePreviewMode(SE), "compact");
});

check("layout: a very short screen hides the preview, keeps the cards", () => {
  assert.equal(welcomePreviewMode({ screenHeight: 568, topInset: 20, bottomInset: 0 }), "hidden");
});

const locales = { tr, en, de, fr, es, it, pt, ar, ja } as const;
const EXPECT_EXAMPLE: Record<string, string> = {
  tr: "Örnek",
  en: "Example",
  de: "Beispiel",
  fr: "Exemple",
  es: "Ejemplo",
  it: "Esempio",
  pt: "Exemplo",
  ar: "مثال",
  ja: "例",
};

check("example badge: present and exact in all 9 languages", () => {
  for (const [code, l] of Object.entries(locales)) {
    assert.equal((l as typeof tr).onboarding.exampleBadge, EXPECT_EXAMPLE[code], code);
  }
});

check("ring line + welcome strings: all 9 languages, ring line carries {{share}} and no literal percent", () => {
  for (const [code, l] of Object.entries(locales)) {
    const d = (l as typeof tr).dashboard;
    assert.ok(d.ringShareLine.includes("{{share}}"), `${code} ringShareLine placeholder`);
    assert.ok(!d.ringShareLine.includes("%"), `${code} ringShareLine must not hand-write a percent sign`);
    for (const k of ["welcomeTitle", "welcomeBody", "welcomeStep1", "welcomeStep2", "welcomeStep3", "previewTitle"] as const) {
      assert.ok(d[k].trim().length > 0, `${code} ${k}`);
    }
  }
});

check("ring line value comes from pct(): tr %92, en 92%, de 92 %", () => {
  setActiveLang("tr");
  assert.equal(pct(92), "%92");
  setActiveLang("en");
  assert.equal(pct(92), "92%");
  setActiveLang("de");
  assert.equal(pct(92), "92 %");
});

check("source contract: index.tsx builds the share with pct() and uses the pure helpers", () => {
  const src = read("app/(tabs)/index.tsx");
  assert.match(src, /ringShareLine", \{ share: isolateLtr\(pct\(todayShare\)\) \}/);
  assert.match(src, /bosDurumKarari\(\{ loaded, entries: entries\.length \}\)/);
  assert.match(src, /usesTwoColumn\(homeState, isTwoCol\)/);
  assert.match(src, /fraction=\{todayShare != null \? todayShare \/ 100 : 0\}/);
  assert.match(src, /<WelcomeCard/);
});

check("source contract: onboarding preview carries the example badge on the ring scene", () => {
  const src = read("components/onboarding/WelcomePreview.tsx");
  assert.match(src, /onboarding\.exampleBadge/);
  assert.match(src, /slide !== 2 \? <ExampleBadge \/>/);
});

check("source contract: WelcomeCard has no hard-coded colours or adjustsFontSizeToFit", () => {
  const src = read("components/WelcomeCard.tsx");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src));
  assert.ok(!/rgba\(/.test(src));
  assert.ok(!/adjustsFontSizeToFit/.test(src));
});

check("CGM bekleniyor: a sensor profile with no record is never the welcome card", () => {
  assert.equal(bosDurumKarari({ loaded: true, entries: 0, cgm: true }), "normal");
  assert.equal(bosDurumKarari({ loaded: false, entries: 0, cgm: true }), "loading");
  assert.equal(bosDurumKarari({ loaded: true, entries: 0, cgm: false }), "welcome");
  assert.equal(bosDurumKarari({ loaded: true, entries: 0 }), "welcome");
});

check("CGM bekleniyor: the home state tells waiting, gap and data apart", () => {
  assert.equal(cgmHomeState({ loaded: false, latestAtMs: null, windowPoints: 0 }), "loading");
  assert.equal(cgmHomeState({ loaded: true, latestAtMs: null, windowPoints: 0 }), "waiting");
  assert.equal(cgmHomeState({ loaded: true, latestAtMs: 1, windowPoints: 0 }), "gap");
  assert.equal(cgmHomeState({ loaded: true, latestAtMs: 1, windowPoints: 12 }), "data");
});

check("CGM items exist for any mode but manual", () => {
  assert.equal(cgmHomeVisible("manual"), false);
  assert.equal(cgmHomeVisible("cgm"), true);
  assert.equal(cgmHomeVisible("nightscout"), true);
});

check("CGM bekleniyor: the waiting copy exists in all nine languages", () => {
  const all = { tr, en, de, fr, es, it, pt, ar, ja } as const;
  for (const [lang, bundle] of Object.entries(all)) {
    const home = (bundle as unknown as { cgmHome: Record<string, string> }).cgmHome;
    for (const key of ["waiting", "waitingBody", "watching"]) {
      assert.ok(home[key] && home[key].length > 0, `${lang}.cgmHome.${key}`);
    }
  }
  assert.equal(tr.cgmHome.waiting, "CGM bekleniyor");
  assert.equal(tr.cgmHome.watching, "CGM izliyor");
});

if (failed > 0) {
  console.log(`\n${failed} FAIL`);
  process.exit(1);
}
console.log("\nall ok");
