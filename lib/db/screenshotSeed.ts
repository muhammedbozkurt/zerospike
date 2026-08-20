import AsyncStorage from "@react-native-async-storage/async-storage";

import { addSugarLog, listSugarLogs, deleteSugarLog } from "./logs";
import { addMealLog, listMealLogs, deleteMealLog } from "./logs";
import { logInjection, getInjections, deleteInjection } from "./injections";
import { logMed, listMeds, deleteMed } from "./meds";
import { createReminder, listReminders, updateReminder } from "./reminders";
import { getProfile, updateProfile } from "./profiles";
import { getDb, defaultProfileName, SCREENSHOT_TRACKING_PROFILE_ID } from "./index";
import { SELECTABLE_SITES, SITE_POINTS } from "./types";
import type { InsulinType, Lang, PeriodTag, ReminderType, SitePoint } from "./types";
import { setProOverride } from "../services/purchases";
import i18n from "../i18n";

/**
 * Store-screenshot seed. Populates a profile with a realistic, consistent story
 * so the marketing shots look like a real, in-use account (App Store 2.3.3
 * requires real UI). Only ever called behind isScreenshotMode() (dev + env
 * double lock) - it can never run in a release.
 *
 * Two variants share this same story:
 *  - default (no `variant`): the usual insulin-using account, on DEFAULT_PROFILE_ID.
 *  - "tracking" (08-takip panel): a SECOND profile (SCREENSHOT_TRACKING_PROFILE_ID,
 *    see ensureTrackingProfile below) with insulin_mode "none" / diabetes_type
 *    "none" and no insulin UI, so it never carries an injection seed.
 *
 * LANGUAGE PURITY: the marker records the language the PROFILE is seeded in
 * (keyed per profile - see seedMarkerKey - so the two variants never read or
 * clobber each other's marker). When the capture pipeline switches language
 * (scLang) and cold-relaunches, the seed re-runs and re-materialises everything
 * that carries visible language: the profile NAME (-> profiles.defaultName for
 * that locale) and the MEAL names (custom_food_name). Glucose (numeric) and
 * injections (site/point CODES, localised at display) are language-neutral, so
 * they are seeded once on the first pass and left intact on later language
 * switches. This guarantees one language per shot (no Turkish profile name /
 * food names leaking into the EN frame, etc.).
 *
 * The story (numbers render per the active locale through the display layer):
 *  - 30 days of glucose, TIR ~78% (target-weighted, a few lows/highs), with a
 *    one-day gap 12 days ago so the "days in a row" streak reads 12; today's
 *    last reading is 112 mg/dL, in target;
 *  - today's three meals (localized emoji foods) + an ACTIVE post-meal timer
 *    (~1h12m left) so the dashboard shows the live countdown;
 *  - default variant only: injections across every selectable site/point over
 *    the window, one point left longest-unused;
 *  - BOTH variants: oral meds on, with today's entry logged after the evening
 *    meal so the journal opens on it (the medication row is what the 01 panel's
 *    journal leads with; the tracking profile keeps it for realism);
 *  - Pro on; range targets filled; profile named for the active locale.
 */
// Bump the version suffix whenever the seeded STORY changes (reading spread,
// colours, etc.) so an already-seeded screenshot build re-materialises cleanly on
// next cold launch instead of keeping stale data.
const SEEDED_LANG_KEY = "zerospike.screenshotSeededLang.v14";

/** Per-profile marker key: v8 assumed a single seeded profile, so one global key
 *  was enough. With the tracking profile added, each profile needs its own
 *  "seeded in language X" marker - otherwise seeding one profile would read as
 *  "done" for the other and skip its first pass entirely. */
function seedMarkerKey(profileId: string): string {
  return `${SEEDED_LANG_KEY}.${profileId}`;
}

const POSTMEAL_TIMER_END_KEY = "zerospike.postMealTimerEnd";
const POSTMEAL_TIMER_START_KEY = "zerospike.postMealTimerStart";
// Mirrors app/(tabs)/index.tsx: the dashboard's "finish setting up" row is a
// nudge for a real user and has no place in a store frame.
const FINISH_SETUP_DISMISSED_KEY = "zerospike.finishSetupDismissed";

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
  it: [
    { name: "🥣 Porridge d'avena", carbs: 38 },
    { name: "🥗 Zuppa di lenticchie", carbs: 45 },
    { name: "🍲 Pollo con verdure", carbs: 52 },
  ],
  pt: [
    { name: "🥣 Aveia", carbs: 38 },
    { name: "🥗 Sopa de lentilha", carbs: 45 },
    { name: "🍲 Frango com legumes", carbs: 52 },
  ],
  ar: [
    { name: "🥣 شوفان", carbs: 38 },
    { name: "🥗 شوربة عدس", carbs: 45 },
    { name: "🍲 دجاج مع خضار", carbs: 52 },
  ],
  ja: [
    { name: "🥣 オートミール", carbs: 38 },
    { name: "🥗 レンズ豆のスープ", carbs: 45 },
    { name: "🍲 鶏肉と野菜", carbs: 52 },
  ],
};

function at(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Re-materialise the meals in `lang` (clears any existing meal rows first).
 *  Tracking variant carries no dose: insulin_mode "none" has no insulin UI,
 *  so a nonzero dose here would show up as a stray "N units" on a profile
 *  that never touches insulin. */
async function seedMeals(profileId: string, lang: Lang, variant?: "tracking"): Promise<void> {
  for (const m of await listMealLogs(profileId)) await deleteMealLog(m.id);
  const meals = MEALS[lang] ?? MEALS.en;
  const mealHours = [8, 13, 19];
  for (let i = 0; i < meals.length; i++) {
    await addMealLog({
      profile_id: profileId,
      custom_food_name: meals[i].name,
      portion_g: 200,
      calculated_carbs_g: meals[i].carbs,
      insulin_dose_units: variant === "tracking" ? 0 : Math.round((meals[i].carbs / 10) * 2) / 2,
      logged_at: at(0, mealHours[i], 15),
    });
  }
}

/**
 * Store-screenshot only (09-reminders panel): six rows so the Reminders
 * settings screen shows a full, lived-in list instead of the empty state -
 * two glucose checks, two medications (one named + alarm_enabled=1 for the
 * AlarmKit badge - see app/settings/reminders.tsx's alarm icon -, one left
 * unlabeled so the generic localized "Medication" name is what renders,
 * exercising that fallback), one basal, and one custom row for a neutral,
 * non-medical routine (an evening walk). Idempotent per (type, time) pair -
 * checked against whatever the profile already has - so a re-run (language
 * switch, cold relaunch) never duplicates a row, and a profile that already
 * carries one of these (e.g. from the legacy-prefs bridge) is left alone
 * rather than getting a second.
 *
 * The custom row's label is fetched via i18n.t at the CALLER's `lang` (see
 * relabelCustomReminder below for how it stays correct across later language
 * switches, since creation only ever happens once per profile).
 *
 * Basal is skipped on the insulin-free tracking profile (variant "tracking"),
 * which has no basal UI at all - the same gating the injection seed above
 * already applies for that variant - so that variant's list is five rows,
 * still well under MAX_REMINDERS (10).
 */
async function seedReminders(profileId: string, lang: Lang, variant?: "tracking"): Promise<void> {
  const existing = await listReminders(profileId);
  const has = (t: ReminderType, time: string) =>
    existing.some((r) => r.type === t && r.time === time);

  if (!has("glucose", "08:00")) {
    await createReminder({ type: "glucose", time: "08:00", enabled: true, profileId });
  }
  if (!has("glucose", "18:00")) {
    await createReminder({ type: "glucose", time: "18:00", enabled: true, profileId });
  }
  if (!has("med", "20:10")) {
    await createReminder({
      type: "med",
      label: "Metformin",
      time: "20:10",
      enabled: true,
      alarmEnabled: true,
      profileId,
    });
  }
  if (!has("med", "12:00")) {
    await createReminder({ type: "med", time: "12:00", enabled: true, profileId });
  }
  if (variant !== "tracking" && !has("basal", "22:00")) {
    await createReminder({ type: "basal", time: "22:00", enabled: true, profileId });
  }
  if (!has("custom", "19:00")) {
    await createReminder({
      type: "custom",
      label: i18n.t("reminders.demoCustomLabel", { lng: lang }) as string,
      time: "19:00",
      enabled: true,
      profileId,
    });
  }
}

/**
 * Store-screenshot only: keeps the custom reminder's label in the ACTIVE
 * locale on every seed pass. seedReminders (above) only ever CREATES its rows
 * once, on the profile's first pass, so without this the custom row would
 * freeze on whichever language happened to be active that first time - wrong
 * in the other 8 on every later scLang relaunch. Mirrors seedMeals just below
 * (also called unconditionally, every pass): meal names carry the same
 * per-language re-materialisation, this just updates in place instead of
 * delete+recreate since there is exactly one custom row (seedReminders is
 * idempotent per (type, time)). A no-op once the label already matches.
 */
async function relabelCustomReminder(profileId: string, lang: Lang): Promise<void> {
  const rows = await listReminders(profileId);
  const custom = rows.find((r) => r.type === "custom");
  if (!custom) return;
  const label = i18n.t("reminders.demoCustomLabel", { lng: lang }) as string;
  if (custom.label !== label) {
    await updateReminder(custom.id, { label });
  }
}

/**
 * Get-or-create for the screenshot "tracking" profile (08-takip panel): a
 * SECOND account at the stable SCREENSHOT_TRACKING_PROFILE_ID, so app/_layout.tsx
 * can find and switch back to it across cold relaunches. Row shape mirrors
 * ensureDefaultProfile in ./index; diabetes_type/insulin_mode/range targets are
 * set by seedScreenshotData's "tracking" variant below, not here.
 */
export async function ensureTrackingProfile(): Promise<string> {
  const existing = await getProfile(SCREENSHOT_TRACKING_PROFILE_ID);
  if (existing) return existing.id;

  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO user_profiles
       (id, name, insulin_sensitivity_factor, carb_ratio_breakfast,
        carb_ratio_lunch, carb_ratio_dinner, target_fasting_min,
        target_fasting_max, target_postmeal_min, target_postmeal_max,
        hypo_threshold_mgdl, daily_carb_target_g, daily_carb_target_min_g,
        created_at)
     VALUES (?, ?, 40, 10, 12, 12, 80, 100, 80, 140, 70, 200, 160, ?);`,
    [SCREENSHOT_TRACKING_PROFILE_ID, defaultProfileName(), now]
  );
  return SCREENSHOT_TRACKING_PROFILE_ID;
}

export async function seedScreenshotData(
  profileId: string,
  lang: Lang,
  variant?: "tracking"
): Promise<void> {
  try {
    // An ACTIVE post-meal timer, refreshed on EVERY cold launch (BEFORE the
    // already-seeded early-return) so each capture - even a same-language relaunch
    // - shows the same healthy ~72m remaining (a partially-filled bar) instead of
    // a stale countdown that has ticked down or expired. No OS permission needed.
    // The start is seeded too (48 min behind), so the elapsed bar is drawn from
    // the timer's own window rather than from whatever delay is configured.
    const timerEnd = Date.now() + 72 * 60 * 1000;
    await AsyncStorage.multiSet([
      [POSTMEAL_TIMER_END_KEY, String(timerEnd)],
      [POSTMEAL_TIMER_START_KEY, String(timerEnd - 120 * 60 * 1000)],
    ]);

    const markerKey = seedMarkerKey(profileId);
    const seededLang = await AsyncStorage.getItem(markerKey);
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
      for (const m of await listMeds(profileId)) await deleteMed(m.id);

      await AsyncStorage.setItem(FINISH_SETUP_DISMISSED_KEY, "true");

      // Pro + explicit range targets for a full-featured account.
      await setProOverride(true);
      if (variant === "tracking") {
        // Insulin-free tracking account: no diabetes type, no insulin mode, and
        // oral meds ON - a pills-only profile is what this variant portrays, so
        // the medication surfaces (the med row in the journal, the quick-add
        // option) belong on it even though the 08 panel now shoots onboarding
        // rather than this profile's dashboard.
        await updateProfile(profileId, {
          diabetes_type: "none",
          insulin_mode: "none",
          oral_meds_enabled: 1,
          target_fasting_min: 70,
          target_fasting_max: 100,
          target_postmeal_min: 70,
          target_postmeal_max: 140,
          hypo_threshold_mgdl: 70,
          ratios_confirmed: 1,
        });
      } else {
        await updateProfile(profileId, {
          // Oral meds on here too: the insulin account also takes a pill, which
          // is what puts the medication row at the top of the 01 panel's journal.
          oral_meds_enabled: 1,
          target_fasting_min: 80,
          target_fasting_max: 120,
          target_postmeal_min: 80,
          target_postmeal_max: 160,
          hypo_threshold_mgdl: 70,
          ratios_confirmed: 1,
        });
      }

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
      // Tracking variant: NO injection seed - insulin_mode "none" has no
      // injection UI, so a seeded row here would never be reachable in the app.
      if (variant !== "tracking") {
        let n = 0;
        for (const site of SELECTABLE_SITES) {
          for (const point of SITE_POINTS) {
            const type: InsulinType = n % 3 === 0 ? "basal" : "bolus";
            // Never place an injection on day 12: the glucose gap there is what
            // makes the "days in a row" streak read exactly 12 (streak counts ALL
            // journal kinds, so a stray injection would silently close the gap).
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

      // Both variants: one oral medication taken today. Timed 20:10, AFTER the
      // 19:15 evening meal, so the feed (ordered by time, newest first) opens on
      // it - the medication row is what the journal panel leads with.
      // Language-neutral: the brand name is the same in every locale, so it
      // stays in the first-pass block and is never re-materialised.
      await logMed({
        profileId,
        takenAt: new Date(at(0, 20, 10)).getTime(),
        name: "Metformin",
        note: null,
      });

      // 09-reminders panel: glucose/med/basal/custom rows (see seedReminders
      // above; created once, first pass only).
      await seedReminders(profileId, lang, variant);
    }

    // Meals carry localized names -> always (re)materialise them in `lang`.
    await seedMeals(profileId, lang, variant);
    // Same reasoning, one row instead of a full re-materialisation: the custom
    // reminder's label must track `lang` on every pass too (see
    // relabelCustomReminder above).
    await relabelCustomReminder(profileId, lang);

    await AsyncStorage.setItem(markerKey, lang);
  } catch {
    // The seed is best-effort marketing plumbing; never crash the app.
  }
}
