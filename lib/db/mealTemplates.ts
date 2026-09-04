import { getDb } from "./index";
import { uuid } from "../uuid";
import { addMealLog } from "./logs";
import type { Lang, MealLog, MealSlot, MealTemplate, MealTemplateItem } from "./types";
import type { ItemFood, ResolvedTemplateItem } from "../mealTemplates";
import {
  resolveTemplateItem,
  templateCarbs,
  templatePortionG,
} from "../mealTemplates";

/**
 * Meal templates: storage side (schema v13, see ./v13Sql for the shape).
 *
 * A template is a recipe, not a record. Nothing in here writes, suggests or
 * evaluates one: it stores what the user wrote, keeps their order, and repeats it
 * when they ask. All of the arithmetic lives in ../mealTemplates (pure, tested
 * under node); this file only reads rows and hands them over.
 */

/** An item row plus the catalogue columns its food_id resolves to, if any. */
interface ItemJoinRow extends MealTemplateItem {
  f_id: string | null;
  f_carb_100g: number | null;
  f_category: string | null;
  f_name_tr: string | null;
  f_name_en: string | null;
  f_name_de: string | null;
  f_name_es: string | null;
  f_name_fr: string | null;
  f_name_it: string | null;
  f_name_pt: string | null;
  f_name_ar: string | null;
  f_name_ja: string | null;
}

/** A stored item with its live food attached (null when the food is gone). */
type ItemWithFood = MealTemplateItem & { food: ItemFood | null };

function mapItem(r: ItemJoinRow): ItemWithFood {
  const food: ItemFood | null =
    r.f_id == null
      ? null
      : {
          carb_100g: r.f_carb_100g ?? 0,
          category: r.f_category,
          name_tr: r.f_name_tr ?? "",
          name_en: r.f_name_en ?? "",
          name_de: r.f_name_de ?? "",
          name_es: r.f_name_es ?? "",
          name_fr: r.f_name_fr ?? "",
          name_it: r.f_name_it,
          name_pt: r.f_name_pt,
          name_ar: r.f_name_ar,
          name_ja: r.f_name_ja,
        };
  return {
    id: r.id,
    template_id: r.template_id,
    food_id: r.food_id,
    name_snapshot: r.name_snapshot,
    carb_100g_snapshot: r.carb_100g_snapshot,
    portion_g: r.portion_g,
    carbs_g_fixed: r.carbs_g_fixed,
    sort_order: r.sort_order,
    food,
  };
}

/**
 * One template's items with their LIVE catalogue values joined on. The join is a
 * LEFT JOIN and `f_id` is what says whether it matched: a deleted food nulls
 * food_id, and a food_id that no longer resolves has to read as a gap rather than
 * as a zero-carb food.
 */
async function readItems(templateId: string): Promise<ItemWithFood[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ItemJoinRow>(
    `SELECT i.*, f.id AS f_id, f.carb_100g AS f_carb_100g, f.category AS f_category,
            f.name_tr AS f_name_tr, f.name_en AS f_name_en, f.name_de AS f_name_de,
            f.name_es AS f_name_es, f.name_fr AS f_name_fr,
            f.name_it AS f_name_it, f.name_pt AS f_name_pt,
            f.name_ar AS f_name_ar, f.name_ja AS f_name_ja
       FROM meal_template_items i
       LEFT JOIN foods f ON f.id = i.food_id
      WHERE i.template_id = ?
      ORDER BY i.sort_order ASC, i.rowid ASC;`,
    [templateId]
  );
  return rows.map(mapItem);
}

/**
 * Every item of every template of one profile, in TWO queries rather than one per
 * template: the food tab lists all of them with their totals, and a per-template
 * read there meant 1 + N round trips on a screen that already runs several.
 *
 * Grouped in JS and totalled by the shared pure rule, so the list and the editor
 * put the same number on the same template.
 */
async function readItemsByTemplate(
  profileId: string
): Promise<Map<string, ItemWithFood[]>> {
  const db = await getDb();
  const rows = await db.getAllAsync<ItemJoinRow>(
    `SELECT i.*, f.id AS f_id, f.carb_100g AS f_carb_100g, f.category AS f_category,
            f.name_tr AS f_name_tr, f.name_en AS f_name_en, f.name_de AS f_name_de,
            f.name_es AS f_name_es, f.name_fr AS f_name_fr,
            f.name_it AS f_name_it, f.name_pt AS f_name_pt,
            f.name_ar AS f_name_ar, f.name_ja AS f_name_ja
       FROM meal_template_items i
       JOIN meal_templates t ON t.id = i.template_id
       LEFT JOIN foods f ON f.id = i.food_id
      WHERE t.profile_id = ?
      ORDER BY i.template_id ASC, i.sort_order ASC, i.rowid ASC;`,
    [profileId]
  );
  const byTemplate = new Map<string, ItemWithFood[]>();
  for (const row of rows) {
    const list = byTemplate.get(row.template_id);
    if (list) list.push(mapItem(row));
    else byTemplate.set(row.template_id, [mapItem(row)]);
  }
  return byTemplate;
}

/**
 * The profile's templates in their stored order. DISPLAY order is a separate
 * question (the active slot first - see rankTemplates in ../mealTemplates), kept
 * out of SQL because it depends on the current time, not on the rows.
 */
export async function listTemplates(profileId: string): Promise<MealTemplate[]> {
  const db = await getDb();
  return db.getAllAsync<MealTemplate>(
    `SELECT * FROM meal_templates WHERE profile_id = ?
      ORDER BY sort_order ASC, created_at ASC;`,
    [profileId]
  );
}

export async function getTemplate(id: string): Promise<MealTemplate | null> {
  const db = await getDb();
  return db.getFirstAsync<MealTemplate>(
    "SELECT * FROM meal_templates WHERE id = ?;",
    [id]
  );
}

export interface TemplateWithItems {
  template: MealTemplate;
  items: ResolvedTemplateItem[];
  /** Total carbs (g): exactly what logging this template would write. */
  carbs_g: number;
  /** Total portion (g): the sum of the item portions. */
  portion_g: number;
}

/**
 * A template ready to show: items resolved to the active language, carbs and
 * portion totalled by the shared rule. The totals are computed here rather than
 * stored, so a corrected food carb value is reflected the next time the template
 * is opened instead of being frozen at whatever it was when it was written.
 */
export async function getTemplateWithItems(
  id: string,
  lang: Lang
): Promise<TemplateWithItems | null> {
  const template = await getTemplate(id);
  if (!template) return null;
  const items = await readItems(id);
  return {
    template,
    items: items.map((item) => resolveTemplateItem(item, lang)),
    carbs_g: templateCarbs(items),
    portion_g: templatePortionG(items),
  };
}

/**
 * The whole profile's templates with their items and totals, in STORED order.
 * Display order is a separate, time-dependent question (rankTemplates).
 */
export async function listTemplatesWithItems(
  profileId: string,
  lang: Lang
): Promise<TemplateWithItems[]> {
  const [templates, byTemplate] = await Promise.all([
    listTemplates(profileId),
    readItemsByTemplate(profileId),
  ]);
  return templates.map((template) => {
    const items = byTemplate.get(template.id) ?? [];
    return {
      template,
      items: items.map((item) => resolveTemplateItem(item, lang)),
      carbs_g: templateCarbs(items),
      portion_g: templatePortionG(items),
    };
  });
}

/** One item as the caller describes it; sort_order comes from its position. */
export interface NewTemplateItemInput {
  /** The catalogue food, when there is one. */
  food_id?: string | null;
  /** Required: what to call the item if the catalogue row ever goes away. An item
   *  with neither a food_id nor a name is rejected by the table's CHECK. */
  name_snapshot: string;
  carb_100g_snapshot?: number;
  portion_g?: number;
  /** A carb total stored outright, for an item with no carb_100g to derive from. */
  carbs_g_fixed?: number | null;
}

export interface NewTemplateInput {
  profile_id: string;
  name: string;
  /** Ordering signal only, and optional (see MealTemplate.slot). */
  slot?: MealSlot | null;
  items?: NewTemplateItemInput[];
}

async function insertItems(
  db: Awaited<ReturnType<typeof getDb>>,
  templateId: string,
  items: readonly NewTemplateItemInput[]
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await db.runAsync(
      `INSERT INTO meal_template_items
         (id, template_id, food_id, name_snapshot, carb_100g_snapshot,
          portion_g, carbs_g_fixed, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        uuid(),
        templateId,
        item.food_id ?? null,
        item.name_snapshot,
        item.carb_100g_snapshot ?? 0,
        item.portion_g ?? 0,
        item.carbs_g_fixed ?? null,
        i,
      ]
    );
  }
}

/**
 * Creates a template (with its items, when they are already known - the "make a
 * template out of this meal" path knows both at once). One transaction, so a
 * template never exists with half of its items.
 *
 * It lands at the END of the profile's list; where it belongs is the user's call
 * to make afterwards (reorderTemplates), not ours to guess.
 */
export async function createTemplate(
  input: NewTemplateInput
): Promise<MealTemplate> {
  const db = await getDb();
  const id = uuid();
  const createdAt = new Date().toISOString();
  const next = await db.getFirstAsync<{ next: number | null }>(
    "SELECT MAX(sort_order) + 1 AS next FROM meal_templates WHERE profile_id = ?;",
    [input.profile_id]
  );

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO meal_templates
         (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?);`,
      [id, input.profile_id, input.name, input.slot ?? null, next?.next ?? 0, createdAt]
    );
    if (input.items && input.items.length > 0) {
      await insertItems(db, id, input.items);
    }
  });

  return (await getTemplate(id))!;
}

export type TemplateUpdate = Partial<Pick<MealTemplate, "name" | "slot">>;

/** Renames a template / changes its slot. Returns the fresh row, or null if gone. */
export async function updateTemplate(
  id: string,
  patch: TemplateUpdate
): Promise<MealTemplate | null> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }
  if (patch.slot !== undefined) {
    fields.push("slot = ?");
    values.push(patch.slot);
  }
  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE meal_templates SET ${fields.join(", ")} WHERE id = ?;`,
      values
    );
  }
  return getTemplate(id);
}

/**
 * Replaces a template's items wholesale: DELETE then re-INSERT, in ONE
 * transaction. Editing a list of items is one action from the user's side, and a
 * per-item diff would leave a half-edited template behind if it were interrupted.
 * sort_order is the array position, so the order shown is the order stored.
 */
export async function replaceTemplateItems(
  templateId: string,
  items: readonly NewTemplateItemInput[]
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM meal_template_items WHERE template_id = ?;", [
      templateId,
    ]);
    await insertItems(db, templateId, items);
  });
}

/**
 * Deletes a template and nothing else. Its items go with it (ON DELETE CASCADE);
 * every meal ever logged from it STAYS, keeping its stored name, portion and
 * carbs. A template is a recipe, so throwing it away means "I stopped eating
 * this", never "that never happened" - and meal_logs.meal_template_id carries no
 * foreign key precisely so those records cannot be dragged along.
 */
export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM meal_templates WHERE id = ?;", [id]);
}

/**
 * Writes the user's own arrangement: sort_order becomes the position in
 * `orderedIds`. One transaction, and every statement is scoped to the profile, so
 * an id from another profile cannot be renumbered through this call.
 */
export async function reorderTemplates(
  profileId: string,
  orderedIds: readonly string[]
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync(
        "UPDATE meal_templates SET sort_order = ? WHERE id = ? AND profile_id = ?;",
        [i, orderedIds[i], profileId]
      );
    }
  });
}

/**
 * Records that a template was used: one more use, and the time of it.
 *
 * last_used_at only ever moves FORWARD. Logging a template for last night's
 * dinner is a backdated entry, and letting it rewrite last_used_at would make a
 * template the user just reached for read as untouched since yesterday.
 */
export async function touchTemplate(
  id: string,
  at: string = new Date().toISOString()
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE meal_templates
        SET use_count = use_count + 1,
            last_used_at = CASE
              WHEN last_used_at IS NULL OR last_used_at < ? THEN ?
              ELSE last_used_at END
      WHERE id = ?;`,
    [at, at, id]
  );
}

/**
 * Puts the usage counters back exactly as they were, for the undo behind a
 * one-tap log. touchTemplate is deliberately not reversible by another
 * touchTemplate: it only moves last_used_at forward, so "undo" has to restore the
 * stored pair rather than try to compute its way back to it.
 */
export async function setTemplateUsage(
  id: string,
  useCount: number,
  lastUsedAt: string | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE meal_templates SET use_count = ?, last_used_at = ? WHERE id = ?;",
    [useCount, lastUsedAt, id]
  );
}

export interface LogTemplateOptions {
  /** The dose the user is taking with it, if any (estimated on the calculator
   *  from the total carbs, never here). */
  insulin_dose_units?: number;
  sugar_log_id?: string | null;
  personal_note?: string | null;
  photo_uri_local?: string | null;
  tags?: string[];
  logged_at?: string;
}

/**
 * Logs a template as ONE meal row: custom_food_name = the template name,
 * portion_g = the summed item portions, calculated_carbs_g = the summed carbs,
 * meal_template_id = where it came from.
 *
 * One row, not one per item, because the rest of the app attributes a dose to a
 * single meal (injection_logs.meal_log_id) and undoes a save in a single step.
 * Both would break against N rows: the dose would attach to one arbitrary item
 * and undo would leave the others behind.
 *
 * The template's profile is checked BEFORE anything is written. A template id
 * from another profile is a mix-up, and silently filing one person's meal on
 * another person's day is the same class of damage as the unfiltered clearAllLogs:
 * it corrupts a record whose owner never asked for it. So it throws instead.
 *
 * The carbs are read LIVE at this moment (see resolveItemCarbs), so a template
 * logged today uses today's carb values, not the ones stored when it was written.
 */
export async function logTemplate(
  profileId: string,
  templateId: string,
  opts: LogTemplateOptions = {}
): Promise<MealLog> {
  const db = await getDb();
  const owner = await db.getFirstAsync<{ profile_id: string; name: string }>(
    "SELECT profile_id, name FROM meal_templates WHERE id = ?;",
    [templateId]
  );
  if (!owner) {
    throw new Error(`logTemplate: meal template ${templateId} does not exist`);
  }
  if (owner.profile_id !== profileId) {
    throw new Error(
      `logTemplate: meal template ${templateId} belongs to another profile`
    );
  }

  const items = await readItems(templateId);
  const loggedAt = opts.logged_at ?? new Date().toISOString();

  const meal = await addMealLog({
    profile_id: profileId,
    food_id: null,
    custom_food_name: owner.name,
    portion_g: templatePortionG(items),
    calculated_carbs_g: templateCarbs(items),
    insulin_dose_units: opts.insulin_dose_units ?? 0,
    sugar_log_id: opts.sugar_log_id ?? null,
    photo_uri_local: opts.photo_uri_local ?? null,
    personal_note: opts.personal_note ?? null,
    tags: opts.tags,
    logged_at: loggedAt,
    meal_template_id: templateId,
  });

  // After the meal, and not in the same transaction: the record is the thing that
  // matters, and a failed counter must not take the logged meal down with it.
  await touchTemplate(templateId, loggedAt);
  return meal;
}
