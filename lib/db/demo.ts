import { getDb } from "./index";
import { addSugarLog, addMealLog } from "./logs";
import type { PeriodTag } from "./types";

/**
 * Loads a small, realistic set of demo glucose + meal entries for a profile so
 * the dashboard/journal look populated in marketing screenshots. Dev-only
 * (Settings → Developer); bypasses the free-tier limits intentionally.
 */
export async function loadDemoData(profileId: string): Promise<void> {
  const now = Date.now();
  const H = 60 * 60 * 1000;

  const readings: { v: number; tag: PeriodTag; off: number }[] = [
    { v: 96, tag: "fasting", off: 26 * H },
    { v: 142, tag: "post_meal_2h", off: 23 * H },
    { v: 108, tag: "pre_meal", off: 20 * H },
    { v: 119, tag: "bedtime", off: 14 * H },
    { v: 88, tag: "fasting", off: 4 * H },
    { v: 167, tag: "post_meal_2h", off: 2 * H },
    { v: 124, tag: "manual", off: 1 * H },
  ];
  for (const r of readings) {
    await addSugarLog({
      profile_id: profileId,
      glucose_level_mgdl: r.v,
      period_tag: r.tag,
      logged_at: new Date(now - r.off).toISOString(),
    });
  }

  const db = await getDb();
  const meals: { name: string; portion: number; off: number; note?: string }[] = [
    { name: "Pilav", portion: 180, off: 23.5 * H, note: "Öğle yemeği" },
    { name: "Elma", portion: 150, off: 19 * H },
    { name: "Tavuk göğsü", portion: 150, off: 6.5 * H },
    { name: "Mercimek çorbası", portion: 300, off: 2.5 * H },
  ];
  for (const m of meals) {
    const f = await db.getFirstAsync<{ id: string; carb_100g: number }>(
      "SELECT id, carb_100g FROM foods WHERE name_tr = ? LIMIT 1;",
      [m.name]
    );
    if (!f) continue;
    const carbs = Math.round(((f.carb_100g * m.portion) / 100) * 10) / 10;
    const dose = Math.round((carbs / 10) * 2) / 2;
    await addMealLog({
      profile_id: profileId,
      food_id: f.id,
      portion_g: m.portion,
      calculated_carbs_g: carbs,
      insulin_dose_units: dose,
      personal_note: m.note ?? null,
      logged_at: new Date(now - m.off).toISOString(),
    });
  }
}
