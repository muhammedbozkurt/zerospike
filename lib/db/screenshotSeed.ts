import AsyncStorage from "@react-native-async-storage/async-storage";

import { createReminder, listReminders, updateReminder } from "./reminders";
import { addCustomFood, updateFood } from "./foods";
import { isFavorite, toggleFavorite } from "./favorites";
import { getProfile, updateProfile } from "./profiles";
import { getDb, SCREENSHOT_TRACKING_PROFILE_ID } from "./index";
import { SELECTABLE_SITES, SITE_POINTS } from "./types";
import type { InjectionSite, InsulinType, Lang, MealSlot, ReminderType, SitePoint } from "./types";
import type { FoodCategory } from "./categories";
import { buildGlucoseSchedule, rng } from "./screenshotGlucose";
import {
  replaceSeedMeals,
  replaceSeedStory,
  replaceSeedTemplates,
  runSeedTransaction,
  type SeedStory,
} from "./screenshotSeedRows";
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
 * that carries visible language: the MEAL names (custom_food_name). Glucose (numeric) and
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
 *  - BOTH variants: three meal templates and five favorited foods (04-food
 *    panel), so its "no templates yet" / "Favorites 0" empty states never show;
 *  - Pro on; range targets filled; profile named for the active locale.
 */
// Bump the version suffix whenever the seeded STORY changes (reading spread,
// colours, etc.) so an already-seeded screenshot build re-materialises cleanly on
// next cold launch instead of keeping stale data.
const SEEDED_LANG_KEY = "zerospike.screenshotSeededLang.v16";

// The front-view body map shows every heat tier (0, 1, 2, 3, 4+ entries in the 30
// day window). The grid below gives each region four entries, so these entries
// (by their index in the grid) move to another region/point. Only site and point
// change: times, doses and types stay, so the journal, the counts and the insights
// read as before. Entries from the last three days keep their sites (they open the
// journal). Resulting counts: abdomen_left 5, thigh_left 6, abdomen_right 3,
// thigh_right 2, arm_left 1, arm_right 0, both buttocks 8 (back view).
const MAP_TIER_LAYOUT: Record<number, readonly [InjectionSite, SitePoint]> = {
  7: ["buttock_left", 1],
  14: ["thigh_left", 3],
  15: ["thigh_left", 4],
  16: ["buttock_left", 2],
  17: ["buttock_left", 3],
  19: ["buttock_left", 4],
  20: ["buttock_right", 1],
  21: ["buttock_right", 2],
  22: ["buttock_right", 3],
  23: ["buttock_right", 4],
};

/** Per-profile marker key: v8 assumed a single seeded profile, so one global key
 *  was enough. With the tracking profile added, each profile needs its own
 *  "seeded in language X" marker - otherwise seeding one profile would read as
 *  "done" for the other and skip its first pass entirely. */
function seedMarkerKey(profileId: string): string {
  return `${SEEDED_LANG_KEY}.${profileId}`;
}

const POSTMEAL_TIMER_END_KEY = "zerospike.postMealTimerEnd";
const POSTMEAL_TIMER_PROFILE_KEY = "zerospike.postMealTimerProfile";
const POSTMEAL_TIMER_START_KEY = "zerospike.postMealTimerStart";
// Mirrors app/(tabs)/index.tsx: the dashboard's "finish setting up" row is a
// nudge for a real user and has no place in a store frame.
const FINISH_SETUP_DISMISSED_KEY = "zerospike.finishSetupDismissed";

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

/** Re-materialise the meals in `lang`: every meal row of the profile is
 *  replaced in one transaction (see ./screenshotSeedRows for why).
 *  Tracking variant carries no dose: insulin_mode "none" has no insulin UI,
 *  so a nonzero dose here would show up as a stray "N units" on a profile
 *  that never touches insulin. */
async function seedMeals(profileId: string, lang: Lang, variant?: "tracking"): Promise<void> {
  const meals = MEALS[lang] ?? MEALS.en;
  const mealHours = [8, 13, 19];
  const rows = meals.map((m, i) => ({
    name: m.name,
    carbs: m.carbs,
    portionG: 200,
    dose: variant === "tracking" ? 0 : Math.round((m.carbs / 10) * 2) / 2,
    loggedAt: at(0, mealHours[i], 15),
  }));
  await runSeedTransaction(await getDb(), (txn) => replaceSeedMeals(txn, profileId, rows));
}

/**
 * Store-screenshot only (04-food panel): three meal templates so the
 * "Meal templates" row never shows its empty state. Each template pairs one
 * of the MEALS entries above with a slot matching its usual time of day, and
 * carries it as a single typed-name item (carbs_g_fixed, no catalogue link) -
 * the template feature never requires a catalogue food, and this avoids
 * inventing item names with no i18n key behind them. Re-materialised (wiped
 * and re-created, in one transaction) on every seed pass, same shape as
 * seedMeals just above, because both the template name and its item's
 * name_snapshot are localized.
 */
async function seedMealTemplates(profileId: string, lang: Lang): Promise<void> {
  const meals = MEALS[lang] ?? MEALS.en;
  const templates: { key: string; slot: MealSlot; mealIndex: number }[] = [
    { key: "templates.demoName1", slot: "breakfast", mealIndex: 0 },
    { key: "templates.demoName2", slot: "lunch", mealIndex: 1 },
    { key: "templates.demoName3", slot: "dinner", mealIndex: 2 },
  ];
  const rows = templates.map((t) => ({
    name: i18n.t(t.key, { lng: lang }) as string,
    slot: t.slot,
    itemName: meals[t.mealIndex].name,
    carbs: meals[t.mealIndex].carbs,
    portionG: 200,
  }));
  await runSeedTransaction(await getDb(), (txn) =>
    replaceSeedTemplates(txn, profileId, rows, Date.now())
  );
}

/** The five demo favorites (04-food panel): a custom food per row, plus the
 *  emoji it is filed under. carb/GI/portion figures mirror the closest
 *  catalog entries (lib/db/seed.ts) for plausibility. */
const FAVORITE_FOODS: {
  key: string;
  emoji: string;
  category: FoodCategory;
  carb_100g: number;
  glycemic_index: number;
  portion_size_g: number;
}[] = [
  { key: "food.demoFavorite1", emoji: "🥣", category: "dairy", carb_100g: 4, glycemic_index: 11, portion_size_g: 200 },
  { key: "food.demoFavorite2", emoji: "🍞", category: "bakery", carb_100g: 41, glycemic_index: 53, portion_size_g: 50 },
  { key: "food.demoFavorite3", emoji: "🍏", category: "fruits", carb_100g: 14, glycemic_index: 36, portion_size_g: 150 },
  { key: "food.demoFavorite4", emoji: "🌰", category: "nuts", carb_100g: 14, glycemic_index: 15, portion_size_g: 30 },
  { key: "food.demoFavorite5", emoji: "🥚", category: "protein", carb_100g: 1.1, glycemic_index: 0, portion_size_g: 55 },
];

/** GLOBAL marker for the five demo favorites' food ids (not per-profile).
 *  Unlike a meal or a template, foods.* is NOT profile-scoped (a custom food
 *  is a single global row; only `favorites` links it to a profile) - both the
 *  default and tracking variant call seedFavoriteFoods, and a per-profile key
 *  here made each variant create its OWN five rows on its own first pass,
 *  leaving ten foods.* rows behind for the same five demo items. The five ids
 *  are stashed globally on the very first call from EITHER profile; every
 *  later call (a language switch, or the other profile's first pass) reuses
 *  those same five rows instead of creating a fresh five. */
const FAVORITE_FOOD_IDS_KEY = "zerospike.screenshotSeededFavoriteFoodIds";
/** GLOBAL marker for which language the five rows above are currently named
 *  in, so a rename (i18n.t + updateFood, five writes) runs at most ONCE per
 *  language change - not once per profile that happens to call
 *  seedFavoriteFoods in that same language (both variants call it on every
 *  seed pass). */
const FAVORITE_FOOD_LANG_KEY = "zerospike.screenshotSeededFavoriteFoodLang";

/**
 * Store-screenshot only (04-food panel): five favorited custom foods so the
 * "Favorites" empty state never shows, for EVERY screenshot profile. The five
 * underlying foods.* rows are created exactly once (globally, by whichever
 * profile calls this first); every later call - a language switch, or the
 * OTHER profile's first pass - reuses those same ids, only adding this
 * profile's own `favorites` link (via isFavorite, so a repeat call never
 * double-toggles a link back off) and, if the active language actually
 * changed since the last rename, relabelling the shared rows once.
 */
async function seedFavoriteFoods(profileId: string, lang: Lang): Promise<void> {
  const stored = await AsyncStorage.getItem(FAVORITE_FOOD_IDS_KEY);
  const ids: string[] = stored ? JSON.parse(stored) : [];

  if (ids.length === FAVORITE_FOODS.length) {
    const lastLang = await AsyncStorage.getItem(FAVORITE_FOOD_LANG_KEY);
    if (lastLang !== lang) {
      for (let i = 0; i < FAVORITE_FOODS.length; i++) {
        const name = i18n.t(FAVORITE_FOODS[i].key, { lng: lang }) as string;
        await updateFood(ids[i], { name });
      }
      await AsyncStorage.setItem(FAVORITE_FOOD_LANG_KEY, lang);
    }
    for (const id of ids) {
      if (!(await isFavorite(profileId, id))) await toggleFavorite(profileId, id);
    }
    return;
  }

  const newIds: string[] = [];
  for (const spec of FAVORITE_FOODS) {
    const name = i18n.t(spec.key, { lng: lang }) as string;
    const food = await addCustomFood({
      name,
      carb_100g: spec.carb_100g,
      glycemic_index: spec.glycemic_index,
      portion_size_g: spec.portion_size_g,
      category: spec.category,
      emoji: spec.emoji,
    });
    await toggleFavorite(profileId, food.id);
    newIds.push(food.id);
  }
  await AsyncStorage.setItem(FAVORITE_FOOD_IDS_KEY, JSON.stringify(newIds));
  await AsyncStorage.setItem(FAVORITE_FOOD_LANG_KEY, lang);
}

/**
 * Store-screenshot only (09-reminders panel): nine rows so the Reminders
 * settings screen shows a full, lived-in list instead of the empty state -
 * three glucose checks (two unlabeled, one a labeled post-meal check), three
 * medications (one named, one left unlabeled so the generic localized
 * "Medication" name is what renders, exercising that fallback - and that
 * unlabeled one is also the only row kept on the notification side, so both
 * delivery badges appear in the list - and one a labeled evening vitamin),
 * one basal, and two custom rows for neutral, non-medical routines (a morning
 * and an evening walk). Idempotent per (type, time) pair - checked against
 * whatever the profile already has - so a re-run (language switch, cold
 * relaunch) never duplicates a row, and a profile that already carries one of
 * these (e.g. from the legacy-prefs bridge) is left alone rather than getting
 * a second. Nine, not ten (MAX_REMINDERS): the list still has room for one
 * more, so "Add reminder" stays visibly usable in the screenshot rather than
 * reading as a maxed-out list.
 *
 * Every labeled row's text is fetched via i18n.t at the CALLER's `lang` (see
 * relabelDemoReminders below for how it stays correct across later language
 * switches, since creation only ever happens once per profile).
 *
 * Basal is skipped on the insulin-free tracking profile (variant "tracking"),
 * which has no basal UI at all - the same gating the injection seed above
 * already applies for that variant - so that variant's list is eight rows,
 * still well under MAX_REMINDERS (10).
 *
 * Each row is created through `tryCreate` rather than a bare `createReminder`
 * call: a profile that already carries rows from elsewhere (the legacy-prefs
 * bridge, a prior partial seed) can be sitting close to MAX_REMINDERS before
 * this even runs, and `createReminder` THROWS once that cap is hit. A bare
 * throw here used to abort the rest of this function AND the rest of
 * seedScreenshotDataLocked's first-pass block (meals, templates, favorites,
 * the marker write) - leaving the profile stuck re-attempting the same full
 * first pass, and failing the same way, on every future relaunch. Swallowing
 * a single row's failure lets the remaining rows (and the caller's marker)
 * still land normally.
 */
async function seedReminders(profileId: string, lang: Lang, variant?: "tracking"): Promise<void> {
  const existing = await listReminders(profileId);
  const has = (t: ReminderType, time: string) =>
    existing.some((r) => r.type === t && r.time === time);
  const tryCreate = async (input: Parameters<typeof createReminder>[0]) => {
    try {
      await createReminder(input);
    } catch {
      // Best-effort: a full reminder list on this profile means one demo row
      // simply does not fit - not a reason to fail the rest of the seed.
    }
  };

  if (!has("glucose", "08:00")) {
    await tryCreate({ type: "glucose", time: "08:00", enabled: true, profileId });
  }
  if (!has("glucose", "18:00")) {
    await tryCreate({ type: "glucose", time: "18:00", enabled: true, profileId });
  }
  if (!has("glucose", "13:00")) {
    await tryCreate({
      type: "glucose",
      label: i18n.t("reminders.demoGlucoseLabel", { lng: lang }) as string,
      time: "13:00",
      enabled: true,
      profileId,
    });
  }
  if (!has("med", "20:10")) {
    await tryCreate({
      type: "med",
      label: "Metformin",
      time: "20:10",
      enabled: true,
      alarmEnabled: true,
      profileId,
    });
  }
  if (!has("med", "12:00")) {
    // The one row deliberately left on the notification side, so the panel
    // shows BOTH delivery badges (see modeOf in app/settings/reminders.tsx)
    // instead of a column of identical ones.
    await tryCreate({
      type: "med",
      time: "12:00",
      enabled: true,
      alarmEnabled: false,
      profileId,
    });
  }
  if (!has("med", "20:00")) {
    await tryCreate({
      type: "med",
      label: i18n.t("reminders.demoMedLabel", { lng: lang }) as string,
      time: "20:00",
      enabled: true,
      alarmEnabled: true,
      profileId,
    });
  }
  if (variant !== "tracking" && !has("basal", "22:00")) {
    await tryCreate({ type: "basal", time: "22:00", enabled: true, profileId });
  }
  if (!has("custom", "19:00")) {
    await tryCreate({
      type: "custom",
      label: i18n.t("reminders.demoCustomLabel", { lng: lang }) as string,
      time: "19:00",
      enabled: true,
      profileId,
    });
  }
  if (!has("custom", "07:30")) {
    await tryCreate({
      type: "custom",
      label: i18n.t("reminders.demoCustomLabel2", { lng: lang }) as string,
      time: "07:30",
      enabled: true,
      profileId,
    });
  }
}

/** (type, time) -> the i18n key behind that row's demo label. seedReminders
 *  above only ever CREATES its rows once, on a profile's first pass, so
 *  without a re-apply step every labeled row would freeze on whichever
 *  language happened to be active that first time - wrong in the other 8 on
 *  every later scLang relaunch. */
const DEMO_REMINDER_LABELS: { type: ReminderType; time: string; key: string }[] = [
  { type: "glucose", time: "13:00", key: "reminders.demoGlucoseLabel" },
  { type: "med", time: "20:00", key: "reminders.demoMedLabel" },
  { type: "custom", time: "07:30", key: "reminders.demoCustomLabel2" },
  { type: "custom", time: "19:00", key: "reminders.demoCustomLabel" },
];

/**
 * Store-screenshot only: keeps every labeled demo reminder's text in the
 * ACTIVE locale on every seed pass, matched by (type, time) rather than by
 * position - seedReminders is idempotent per that same pair, so it is the
 * stable key across languages. Mirrors seedMeals just below (also called
 * unconditionally, every pass): this just updates in place instead of
 * delete+recreate, since seedReminders itself never duplicates a row. A
 * no-op once a row's label already matches.
 */
async function relabelDemoReminders(profileId: string, lang: Lang): Promise<void> {
  const rows = await listReminders(profileId);
  for (const spec of DEMO_REMINDER_LABELS) {
    const row = rows.find((r) => r.type === spec.type && r.time === spec.time);
    if (!row) continue;
    const label = i18n.t(spec.key, { lng: lang }) as string;
    if (row.label !== label) {
      await updateReminder(row.id, { label });
    }
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
     VALUES (?, ?, 0, 0, 0, 0, 80, 100, 80, 140, 70, 200, 160, ?);`,
    [SCREENSHOT_TRACKING_PROFILE_ID, "", now]
  );
  return SCREENSHOT_TRACKING_PROFILE_ID;
}

/**
 * Per-profile in-flight guard: serializes concurrent seed passes for the SAME
 * profile. On a cold launch via a scLang deep link, the launch URL resolves
 * ASYNCHRONOUSLY (Linking's initial-URL promise), so app/_layout.tsx's seed
 * effect can fire once with the fallback `lang` (scLang not parsed yet) and
 * again moments later with the real target language once the URL lands - two
 * DIFFERENT (profile, language) keys, so the effect's own ref guard (which
 * only catches a repeat of the SAME key) lets both through. Without this
 * queue those two passes interleave their delete-then-insert writes on
 * seedMeals/seedReminders (neither protected against concurrent access) and
 * the screenshot ends up with one row seeded in each language. Queuing the
 * second pass behind the first instead of racing it makes it re-read the
 * just-written marker and correctly fall into the "already seeded, only
 * re-materialize the localized bits" branch below.
 */
const inFlightByProfile = new Map<string, Promise<void>>();

export async function seedScreenshotData(
  profileId: string,
  lang: Lang,
  variant?: "tracking"
): Promise<void> {
  const prior = inFlightByProfile.get(profileId) ?? Promise.resolve();
  const run = prior.then(() => seedScreenshotDataLocked(profileId, lang, variant));
  inFlightByProfile.set(profileId, run);
  try {
    await run;
  } finally {
    if (inFlightByProfile.get(profileId) === run) inFlightByProfile.delete(profileId);
  }
}

async function seedScreenshotDataLocked(
  profileId: string,
  lang: Lang,
  variant?: "tracking"
): Promise<void> {
  try {
    // An ACTIVE post-meal timer, refreshed on EVERY cold launch (BEFORE the
    // already-seeded early-return) so each capture - even a same-language relaunch
    // - shows the same healthy ~72m remaining (a partially-filled bar) instead of
    // a stale countdown that has ticked down or expired. No OS permission needed.
    // The start is seeded too (120 min behind the end, so 48 min already
    // elapsed), because the bar and its "x min window" label are both drawn
    // from the timer's OWN start/end pair, not from POST_MEAL_WINDOW_MIN.
    const timerEnd = Date.now() + 72 * 60 * 1000;
    await AsyncStorage.multiSet([
      [POSTMEAL_TIMER_END_KEY, String(timerEnd)],
      [POSTMEAL_TIMER_START_KEY, String(timerEnd - 120 * 60 * 1000)],
    ]);
    // The owner key is CLEARED, never carried over: a seeded countdown belongs
    // to whichever profile the capture is pointing at, and an owner left behind
    // by an earlier seed (or by a real timer on the same simulator) would make
    // the profile lock hide the very card the frame is meant to show.
    await AsyncStorage.removeItem(POSTMEAL_TIMER_PROFILE_KEY);

    const markerKey = seedMarkerKey(profileId);
    const seededLang = await AsyncStorage.getItem(markerKey);
    if (seededLang === lang) return; // already fully seeded in this language

    await updateProfile(profileId, { name: "" });

    if (seededLang == null) {
      // FIRST pass: the language-neutral story below replaces whatever the
      // profile had (an older seed included) in one transaction, so a re-seed
      // can never duplicate; meals are replaced by seedMeals further down.
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
          // Explicit usable values, deliberately chosen for the store images:
          // the calculator panel only shows its figure for confirmed AND usable.
          insulin_sensitivity_factor: 40,
          carb_ratio_breakfast: 10,
          carb_ratio_lunch: 12,
          carb_ratio_dinner: 12,
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
          // Explicit usable values, deliberately chosen for the store images:
          // the calculator panel only shows its figure for confirmed AND usable.
          insulin_sensitivity_factor: 40,
          carb_ratio_breakfast: 10,
          carb_ratio_lunch: 12,
          carb_ratio_dinner: 12,
          ratios_confirmed: 1,
        });
      }

      // 30 days of glucose: see buildGlucoseSchedule (screenshotGlucose.ts).
      const story: SeedStory = {
        glucose: buildGlucoseSchedule(new Date()),
        injections: [],
        // Both variants: one oral medication taken today. Timed 20:10, AFTER the
        // 19:15 evening meal, so the feed (ordered by time, newest first) opens on
        // it - the medication row is what the journal panel leads with.
        // Language-neutral: the brand name is the same in every locale, so it
        // stays in the first-pass block and is never re-materialised.
        meds: [{ takenAt: new Date(at(0, 20, 10)).getTime(), name: "Metformin" }],
      };

      // Injections across every selectable site + point over the window; the first
      // (site, point) pair gets the OLDEST timestamp so it reads longest-unused.
      // Tracking variant: NO injection seed - insulin_mode "none" has no
      // injection UI, so a seeded row here would never be reachable in the app.
      if (variant !== "tracking") {
        const injections: SeedStory["injections"][number][] = [];
        let n = 0;
        for (const site of SELECTABLE_SITES) {
          for (const point of SITE_POINTS) {
            const type: InsulinType = n % 3 === 0 ? "basal" : "bolus";
            // Never place an injection on day 12: the glucose gap there is what
            // makes the "days in a row" streak read exactly 12 (streak counts ALL
            // journal kinds, so a stray injection would silently close the gap).
            let daysAgo = n === 0 ? 29 : (n * 3) % 26;
            if (daysAgo === 12) daysAgo = 13;
            const placed = MAP_TIER_LAYOUT[n] ?? [site, point as SitePoint];
            injections.push({
              site: placed[0],
              site_point: placed[1],
              dose_units: type === "basal" ? 14 : Math.round((4 + rng(n) * 6) * 2) / 2,
              insulin_type: type,
              logged_at: at(daysAgo, 9 + (n % 10)),
            });
            n++;
          }
        }

        // A basal dose logged today, close to the 22:00 basal reminder
        // seeded below (seedReminders), so the dashboard's basal status line
        // reads "done today" (see components/BasalStatusLine.tsx) rather
        // than "pending" in the screenshot.
        injections.push({
          site: "abdomen_left",
          site_point: 1,
          dose_units: 24,
          insulin_type: "basal",
          logged_at: at(0, 22, 30),
        });
        story.injections = injections;
      }

      await runSeedTransaction(await getDb(), (txn) =>
        replaceSeedStory(txn, profileId, story, Date.now())
      );

      // 09-reminders panel: glucose/med/basal/custom rows (see seedReminders
      // above; created once, first pass only).
      await seedReminders(profileId, lang, variant);
    }

    // Meals, templates and favorites all carry localized text -> always
    // (re)materialise them in `lang` (see each function's own doc comment for
    // why templates wipe+recreate while favorites rename in place).
    await seedMeals(profileId, lang, variant);
    await seedMealTemplates(profileId, lang);
    await seedFavoriteFoods(profileId, lang);
    // Same reasoning, one row instead of a full re-materialisation: every
    // labeled demo reminder's text must track `lang` on every pass too (see
    // relabelDemoReminders above).
    await relabelDemoReminders(profileId, lang);

    await AsyncStorage.setItem(markerKey, lang);
  } catch (err) {
    // The seed is best-effort marketing plumbing; never crash the app. Said out
    // loud, though: a dropped pass leaves the previous language on screen.
    console.warn("[screenshotSeed] pass failed", lang, err);
  }
}
