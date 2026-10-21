/**
 * Empty states (Build 93 ek I): the pure "is this tab empty" decisions, the
 * 9-language copy, and the source contract that each tab's empty path goes
 * through the one shared EmptyState.
 *
 * Run: npx tsx scripts/emptyStates.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
declare const require: (id: string) => any;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  foodIsEmpty,
  injectionMapIsEmpty,
  injectionUsageTotal,
  insightsNeedsData,
} from "../lib/emptyStates";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, extra = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL ${label} ${extra}`);
  }
}

const LANGS = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"] as const;
const KEYS = [
  "example",
  "foodTitle",
  "foodBody",
  "foodPreview",
  "foodCta",
  "injectionTitle",
  "injectionBody",
  "insightsTitle",
  "insightsBody",
] as const;

// Food: wait for every load, then require no meal today, none ever, no template.
const foodBase = {
  todayLoaded: true,
  recentLoaded: true,
  templatesLoaded: true,
  todayMealCount: 0,
  recentMealCount: 0,
  templateCount: 0,
};
ok("food empty", foodIsEmpty(foodBase));
ok("food today unloaded", !foodIsEmpty({ ...foodBase, todayLoaded: false }));
ok("food recent unloaded", !foodIsEmpty({ ...foodBase, recentLoaded: false }));
ok("food templates unloaded", !foodIsEmpty({ ...foodBase, templatesLoaded: false }));
ok("food meal today", !foodIsEmpty({ ...foodBase, todayMealCount: 1 }));
ok("food past meals only", !foodIsEmpty({ ...foodBase, recentMealCount: 3 }));
ok("food template only", !foodIsEmpty({ ...foodBase, templateCount: 1 }));

// Injection map.
ok("map empty", injectionMapIsEmpty({ historyLoaded: true, historyCount: 0, usageCount: 0 }));
ok("map not loaded", !injectionMapIsEmpty({ historyLoaded: false, historyCount: 0, usageCount: 0 }));
ok("map history", !injectionMapIsEmpty({ historyLoaded: true, historyCount: 2, usageCount: 0 }));
ok("map usage", !injectionMapIsEmpty({ historyLoaded: true, historyCount: 0, usageCount: 1 }));
ok(
  "usage total sums sites, unassigned and legacy",
  injectionUsageTotal({
    sites: [{ count: 2 }, { count: 0 }, { count: 1 }],
    noSiteCount: 4,
    legacyCount: 5,
  }) === 12
);
ok("usage total zero", injectionUsageTotal({ sites: [], noSiteCount: 0, legacyCount: 0 }) === 0);

// Insights.
ok("insights empty", insightsNeedsData({ readings: 0, injectionCount: 0, meals: 0 }));
ok("insights readings", !insightsNeedsData({ readings: 1, injectionCount: 0, meals: 0 }));
ok("insights injections", !insightsNeedsData({ readings: 0, injectionCount: 1, meals: 0 }));
ok("insights meals", !insightsNeedsData({ readings: 0, injectionCount: 0, meals: 1 }));

// Copy: every key in every language, non-empty, no em-dash, no banned words.
const BANNED = /alarm|diagnos|treatment|tedavi|teşhis|\btanı\b|uyarır|recommended dose|önerilen doz/i;
const en = require("../lib/i18n/locales/en").default.emptyStates as Record<string, string>;
for (const lang of LANGS) {
  const es = require(`../lib/i18n/locales/${lang}`).default.emptyStates as Record<string, string>;
  ok(`${lang} namespace`, !!es);
  for (const k of KEYS) {
    const v = es?.[k];
    ok(`${lang}.${k} present`, typeof v === "string" && v.trim().length > 0);
    ok(`${lang}.${k} no em-dash`, !String(v).includes("—"));
    ok(`${lang}.${k} no banned term`, !BANNED.test(String(v)));
    if (lang !== "en" && k !== "example") {
      ok(`${lang}.${k} is translated`, v !== en[k]);
    }
  }
  ok(`${lang} no extra keys`, Object.keys(es).length === KEYS.length);
}
ok("tr diacritics", /ö|ü|ş|ğ|ı|İ/.test(require("../lib/i18n/locales/tr").default.emptyStates.foodCta));

// Source contract: every empty path uses the shared component.
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const food = read("app/(tabs)/food.tsx");
const injection = read("app/(tabs)/injection.tsx");
const insights = read("app/insights.tsx");
const emptyState = read("components/EmptyState.tsx");

ok("food uses foodIsEmpty", food.includes("foodIsEmpty({"));
ok(
  "food first-meal card is an EmptyState",
  /firstMealEmpty \? \(\s*<EmptyState[\s\S]*?emptyStates\.foodCta/.test(food)
);
ok("food cta opens the compose sheet", /emptyStates\.foodCta[\s\S]{0,200}setComposeOpen\(true\)/.test(food));
ok("injection uses injectionMapIsEmpty", injection.includes("injectionMapIsEmpty({"));
ok(
  "injection map card is an EmptyState",
  /mapEmpty \? \(\s*<EmptyState[\s\S]*?emptyStates\.injectionBody/.test(injection)
);
ok("injection cta switches to the save segment", /onAction=\{twoCol \? undefined : \(\) => setSegment\("save"\)\}/.test(injection));
ok("injection map stays rendered", /<InjectionBodyMap[\s\S]*?\{mapEmpty \? \(/.test(injection));
ok("insights uses insightsNeedsData", insights.includes("insightsNeedsData(data)"));
ok(
  "insights empty path is an EmptyState with an example",
  /isEmpty \? \(\s*<EmptyState[\s\S]*?<EmptyExample[\s\S]*?emptyStates\.example/.test(insights)
);
ok("EmptyState has no hard-coded colors", !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(emptyState));
ok("EmptyState has no adjustsFontSizeToFit", !emptyState.includes("adjustsFontSizeToFit"));
ok("EmptyState has no bare toUpperCase", !emptyState.includes("toUpperCase"));

if (failed) {
  console.log(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ok ${passed} cases`);
