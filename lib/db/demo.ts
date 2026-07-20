import { getDb } from "./index";
import { addSugarLog, addMealLog } from "./logs";
import { logInjection } from "./injections";
import { INJECTION_SITES } from "./types";
import type { LogTag, PeriodTag } from "./types";

/**
 * Loads a rich, realistic demo dataset for marketing screenshots: ~21 days of
 * glucose readings, meals, injections (site-rotated, basal + bolus), and
 * scattered context tags - so the dashboard weekly card, Insights metrics, the
 * injection tab (history + rotation + distribution) and journal tag badges all
 * look populated.
 *
 * Dev-only (Settings → Developer), bypasses free-tier limits, and is idempotent:
 * it clears this profile's logs first so re-running never duplicates. All values
 * are fictional but plausible. No Math.random, for reproducibility.
 */
/**
 * Wipes ALL of a profile's logs (sugar/meal/injection). Used both as the
 * idempotent reset before re-seeding the demo and to fully revert the first-run
 * "sample data" preview so the user starts clean.
 */
export async function clearProfileData(profileId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM injection_logs WHERE profile_id = ?;", [profileId]);
  await db.runAsync("DELETE FROM meal_logs WHERE profile_id = ?;", [profileId]);
  await db.runAsync("DELETE FROM sugar_logs WHERE profile_id = ?;", [profileId]);
}

export async function loadDemoData(profileId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // Idempotent reset for this profile.
  await clearProfileData(profileId);

  const DAYS = 21;
  const TAGS: LogTag[] = ["sport", "illness", "stress", "travel", "alcohol"];

  /** Local-day-aligned timestamp; null if it would fall in the future. */
  const ts = (daysAgo: number, hour: number, minute = 0): string | null => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d.getTime() > now ? null : d.toISOString();
  };

  // Sites rotate across all eight so distribution + recommendation look real.
  let siteIdx = 0;
  const nextSite = () => INJECTION_SITES[siteIdx++ % INJECTION_SITES.length];

  // ── Foods for meals (real seed food_ids → localize correctly) ───────────
  const foods = await db.getAllAsync<{ id: string; carb_100g: number }>(
    `SELECT id, carb_100g FROM foods
       WHERE is_custom = 0 AND carb_100g BETWEEN 8 AND 80
       ORDER BY carb_100g DESC LIMIT 18;`
  );

  // ── Glucose: ~3/day over 21 days, varied times + a few lows/highs ───────
  const gSlots: { hour: number; minute: number; tag: PeriodTag }[] = [
    { hour: 7, minute: 20, tag: "fasting" },
    { hour: 13, minute: 10, tag: "post_meal_2h" },
    { hour: 19, minute: 30, tag: "post_meal_2h" },
    { hour: 22, minute: 45, tag: "bedtime" },
  ];
  for (let day = DAYS; day >= 0; day--) {
    for (let si = 0; si < gSlots.length; si++) {
      if (si === 3 && day % 2 !== 0) continue; // bedtime only on even days
      const slot = gSlots[si];
      const when = ts(day, slot.hour, slot.minute);
      if (!when) continue;
      const base =
        slot.tag === "fasting" ? 98 : slot.tag === "bedtime" ? 112 : 145;
      let v = base + (((day * 13 + si * 29) % 46) - 22);
      if (day % 9 === 3 && slot.tag === "fasting") v = 62; // hypo
      if (day % 7 === 2 && slot.tag === "post_meal_2h") v = 196; // high
      if (day % 11 === 5 && si === 2) v = 58; // hypo
      v = Math.max(45, Math.min(320, Math.round(v)));
      const tags: LogTag[] = day % 6 === 0 && si === 0 ? ["stress"] : [];
      await addSugarLog({
        profile_id: profileId,
        glucose_level_mgdl: v,
        period_tag: slot.tag,
        logged_at: when,
        tags,
      });
    }
  }

  // ── Meals + linked bolus injections ────────────────────────────────────
  const mSlots: { hour: number; minute: number }[] = [
    { hour: 8, minute: 0 },
    { hour: 12, minute: 30 },
    { hour: 19, minute: 0 },
  ];
  let mealIdx = 0;
  for (let day = DAYS; day >= 0; day--) {
    for (let mi = 0; mi < mSlots.length; mi++) {
      if (mi === 1 && day % 2 === 1) continue; // lunch every other day
      const slot = mSlots[mi];
      const when = ts(day, slot.hour, slot.minute);
      if (!when) continue;
      const food = foods.length ? foods[mealIdx % foods.length] : null;
      mealIdx++;
      const portion = 120 + ((day + mi) % 5) * 30; // 120..240 g
      const carbs = food
        ? Math.round(((food.carb_100g * portion) / 100) * 10) / 10
        : 40;
      const dose = Math.max(1, Math.round((carbs / 10) * 2) / 2);
      const tags: LogTag[] =
        (day + mi) % 7 === 3 ? [TAGS[(day + mi) % TAGS.length]] : [];
      const meal = await addMealLog({
        profile_id: profileId,
        food_id: food?.id ?? null,
        portion_g: portion,
        calculated_carbs_g: carbs,
        insulin_dose_units: dose,
        logged_at: when,
        tags,
      });
      const injWhen = ts(day, slot.hour, Math.max(0, slot.minute - 5));
      if (injWhen) {
        await logInjection({
          profile_id: profileId,
          site: nextSite(),
          dose_units: dose,
          insulin_type: "bolus",
          meal_log_id: meal.id,
          logged_at: injWhen,
          tags,
        });
      }
    }
  }

  // ── Nightly basal injection ────────────────────────────────────────────
  for (let day = DAYS; day >= 0; day--) {
    const when = ts(day, 22, 30);
    if (!when) continue;
    await logInjection({
      profile_id: profileId,
      site: nextSite(),
      dose_units: 18 + (day % 4), // 18..21 units
      insulin_type: "basal",
      logged_at: when,
    });
  }
}
