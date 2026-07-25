import AsyncStorage from "@react-native-async-storage/async-storage";

import { addSugarLog, listSugarLogs, deleteSugarLog } from "./logs";
import { addMealLog, listMealLogs, deleteMealLog } from "./logs";
import { logInjection, getInjections, deleteInjection } from "./injections";
import { updateProfile } from "./profiles";
import { SELECTABLE_SITES, SITE_POINTS } from "./types";
import type { InsulinType, Lang, PeriodTag, SitePoint } from "./types";
import { setProOverride } from "../services/purchases";
import i18n from "../i18n";

/**
 * Store-screenshot seed. Populates ONE profile with a realistic, consistent
 * story so the marketing shots look like a real, in-use account (App Store 2.3.3
 * requires real UI). Only ever called behind isScreenshotMode() (dev + env
 * double lock) - it can never run in a release.
 *
 * LANGUAGE PURITY: the marker records the language the profile is seeded in. When
 * the capture pipeline switches language (scLang) and cold-relaunches, the seed
 * re-runs and re-materialises everything that carries visible language: the
 * profile NAME (-> profiles.defaultName for that locale) and the MEAL names
 * (custom_food_name). Glucose (numeric) and injections (site/point CODES,
 * localised at display) are language-neutral, so they are seeded once on the
 * first pass and left intact on later language switches. This guarantees one
 * language per shot (no Turkish profile name / food names leaking into the EN
 * frame, etc.).
 *
 * The story (numbers render per the active locale through the display layer):
 *  - 30 days of glucose, TIR ~78% (target-weighted, a few lows/highs), with a
 *    one-day gap 12 days ago so the "days in a row" streak reads 12; today's
 *    last reading is 112 mg/dL, in target;
 *  - today's three meals (localized emoji foods) + an ACTIVE post-meal timer
 *    (~1h12m left) so the dashboard shows the live countdown;
 *  - injections across every selectable site/point over the window, one point
 *    left longest-unused;
 *  - Pro on; range targets filled; profile named for the active locale.
 */
// Bump the version suffix whenever the seeded STORY changes (reading spread,
// colours, etc.) so an already-seeded screenshot build re-materialises cleanly on
// next cold launch instead of keeping stale data.
const SEEDED_LANG_KEY = "zerospike.screenshotSeededLang.v7";
const POSTMEAL_TIMER_END_KEY = "zerospike.postMealTimerEnd";

/** Deterministic pseudo-random in [0,1) so the seed is stable across runs. */
function rng(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A plausible reading (mg/dL) for a given day/slot, weighted toward target. */
function reading(day: number, slot: number): number {
  const r = rng(day * 7 + slot);
  // ~78% target (80-140), ~5% low, ~17% high.
  if (r < 0.05) return Math.round(58 + rng(day + slot) * 20); // low
  if (r < 0.22) return Math.round(150 + rng(day * 3 + slot) * 70); // high
  return Math.round(88 + rng(day * 5 + slot) * 48); // target band
}

const PERIODS: PeriodTag[] = ["fasting", "pre_meal", "post_meal_2h", "bedtime", "manual"];

const MEALS: Record<Lang, { name: string; carbs: number }[]> = {
  tr: [
    { name: "🥣 Yulaf ezmesi", carbs: 38 },
    { name: "🥗 Mercimek çorbası", carbs: 45 },
    { name: "🍲 Sebzeli tavuk", carbs: 52 },
  ],
  en: [
    { name: "🥣 Oatmeal", carbs: 38 },
    { name: "🥗 Lentil soup", carbs: 45 },
    { name: "🍲 Chicken & veg", carbs: 52 },
  ],
  de: [
    { name: "🥣 Haferbrei", carbs: 38 },
    { name: "🥗 Linsensuppe", carbs: 45 },
    { name: "🍲 Hähnchen & Gemüse", carbs: 52 },
  ],
  es: [
    { name: "🥣 Avena", carbs: 38 },
    { name: "🥗 Sopa de lentejas", carbs: 45 },
    { name: "🍲 Pollo con verduras", carbs: 52 },
  ],
  fr: [
    { name: "🥣 Flocons d'avoine", carbs: 38 },
    { name: "🥗 Soupe de lentilles", carbs: 45 },
    { name: "🍲 Poulet et légumes", carbs: 52 },
  ],
};

function at(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Re-materialise the meals in `lang` (clears any existing meal rows first). */
async function seedMeals(profileId: string, lang: Lang): Promise<void> {
  for (const m of await listMealLogs(profileId)) await deleteMealLog(m.id);
  const meals = MEALS[lang] ?? MEALS.en;
  const mealHours = [8, 13, 19];
  for (let i = 0; i < meals.length; i++) {
    await addMealLog({
      profile_id: profileId,
      custom_food_name: meals[i].name,
      portion_g: 200,
      calculated_carbs_g: meals[i].carbs,
      insulin_dose_units: Math.round((meals[i].carbs / 10) * 2) / 2,
      logged_at: at(0, mealHours[i], 15),
    });
  }
}

export async function seedScreenshotData(profileId: string, lang: Lang): Promise<void> {
  try {
    // An ACTIVE post-meal timer, refreshed on EVERY cold launch (BEFORE the
    // already-seeded early-return) so each capture - even a same-language relaunch
    // - shows the same healthy ~72m remaining (a partially-filled bar) instead of
    // a stale countdown that has ticked down or expired. No OS permission needed.
    await AsyncStorage.setItem(
      POSTMEAL_TIMER_END_KEY,
      String(Date.now() + 72 * 60 * 1000)
    );

    const seededLang = await AsyncStorage.getItem(SEEDED_LANG_KEY);
    if (seededLang === lang) return; // already fully seeded in this language

    // Profile NAME follows the active locale on every language pass.
    const defaultName = i18n.t("profiles.defaultName", { lng: lang }) as string;
    await updateProfile(profileId, { name: defaultName });

    if (seededLang == null) {
      // FIRST pass: wipe any stale data (e.g. an older single-language seed) so a
      // re-seed can never duplicate, then lay down the language-neutral story.
      for (const s of await listSugarLogs(profileId, 5000)) await deleteSugarLog(s.id);
      for (const inj of await getInjections(profileId)) await deleteInjection(inj.id);
      for (const m of await listMealLogs(profileId)) await deleteMealLog(m.id);

      // Pro + explicit range targets for a full-featured account.
      await setProOverride(true);
      await updateProfile(profileId, {
        target_fasting_min: 80,
        target_fasting_max: 120,
        target_postmeal_min: 80,
        target_postmeal_max: 160,
        hypo_threshold_mgdl: 70,
        ratios_confirmed: 1,
      });

      // 30 days of glucose. Skip day 12 so the recent streak is exactly 12.
      // Readings span the whole CLOCK so the AGP median covers 00-24 with no empty
      // edge: fasting 07, post-breakfast 09, lunch 13, afternoon 17, post-dinner 20,
      // bedtime ~23:40 every day, plus a post-midnight ~00:30 reading every other
      // day for the 00:00 edge.
      const hoursBySlot = [7, 9, 13, 17, 20, 23];
      const periodBySlot: PeriodTag[] = [
        PERIODS[0], PERIODS[2], PERIODS[1], PERIODS[4], PERIODS[2], PERIODS[3],
      ];
      for (let day = 0; day < 30; day++) {
        if (day === 12) continue;
        const slots = day === 0 ? 4 : hoursBySlot.length; // today: up to the ~evening hero
        for (let slot = 0; slot < slots; slot++) {
          const isTodayHero = day === 0 && slot === 3;
          // Today's hero is an in-target post-meal check at ~18:22; the last slot
          // is a bedtime reading at ~23:40 so the curve reaches the right edge.
          const hour = isTodayHero ? 18 : hoursBySlot[slot];
          const minute = isTodayHero
            ? 22
            : slot === 5
              ? 40 + Math.round(rng(day + slot) * 8)
              : Math.round(rng(day + slot) * 40);
          await addSugarLog({
            profile_id: profileId,
            glucose_level_mgdl: isTodayHero ? 112 : reading(day, slot),
            period_tag: isTodayHero ? "post_meal_2h" : periodBySlot[slot],
            logged_at: at(day, hour, minute),
          });
        }
        // Post-midnight (~00:30) reading every other day so the median reaches 00:00.
        if (day !== 0 && day % 2 === 0) {
          await addSugarLog({
            profile_id: profileId,
            glucose_level_mgdl: reading(day, 6),
            period_tag: PERIODS[0],
            logged_at: at(day, 0, 25 + Math.round(rng(day) * 10)),
          });
        }
      }

      // Injections across every selectable site + point over the window; the first
      // (site, point) pair gets the OLDEST timestamp so it reads longest-unused.
      let n = 0;
      for (const site of SELECTABLE_SITES) {
        for (const point of SITE_POINTS) {
          const type: InsulinType = n % 3 === 0 ? "basal" : "bolus";
          // Never place an injection on day 12: the glucose gap there is what makes
          // the "days in a row" streak read exactly 12 (streak counts ALL journal
          // kinds, so a stray injection would silently close the gap).
          let daysAgo = n === 0 ? 29 : (n * 3) % 26;
          if (daysAgo === 12) daysAgo = 13;
          await logInjection({
            profile_id: profileId,
            site,
            site_point: point as SitePoint,
            dose_units: type === "basal" ? 14 : Math.round((4 + rng(n) * 6) * 2) / 2,
            insulin_type: type,
            logged_at: at(daysAgo, 9 + (n % 10)),
          });
          n++;
        }
      }

    }

    // Meals carry localized names -> always (re)materialise them in `lang`.
    await seedMeals(profileId, lang);

    await AsyncStorage.setItem(SEEDED_LANG_KEY, lang);
  } catch {
    // The seed is best-effort marketing plumbing; never crash the app.
  }
}
