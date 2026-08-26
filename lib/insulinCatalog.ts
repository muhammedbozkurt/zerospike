/**
 * Insulin product catalog: typical pharmacokinetic figures (peak, duration) as
 * printed on product leaflets. They vary person to person and are used ONLY to
 * shape the app's "active insulin" estimate; this module gives no dose, no
 * warning and no diagnosis. Dependency-free (no DB, no i18n) so it can be
 * imported from either side.
 */

export type InsulinCategory = "bolus" | "basal" | "mix";

export interface InsulinProduct {
  /** stable id, stored in the DB */
  id: string;
  category: InsulinCategory;
  /** shown to the user as-is (brand names are not translated) */
  label: string;
  /** hours to peak effect; null for a peakless (peakless) basal */
  peakHours: number | null;
  /** total duration of action / DIA, in hours */
  durationHours: number;
}

export const INSULIN_PRODUCTS: readonly InsulinProduct[] = [
  // Basal (long-acting), in the order the picker offers them.
  { id: "glargine_u100", category: "basal", label: "Lantus", peakHours: null, durationHours: 24 },
  { id: "glargine_u300", category: "basal", label: "Toujeo", peakHours: null, durationHours: 30 },
  { id: "degludec", category: "basal", label: "Tresiba", peakHours: null, durationHours: 42 },
  { id: "detemir", category: "basal", label: "Levemir", peakHours: 6, durationHours: 20 },
  { id: "basaglar", category: "basal", label: "Basaglar", peakHours: null, durationHours: 24 },
  { id: "abasaglar", category: "basal", label: "Abasaglar", peakHours: null, durationHours: 24 },
  { id: "semglee", category: "basal", label: "Semglee", peakHours: null, durationHours: 24 },
  { id: "nph", category: "basal", label: "Insulatard / Humulin N", peakHours: 5, durationHours: 14 },

  // Bolus (mealtime), in the order the picker offers them.
  { id: "aspart", category: "bolus", label: "NovoRapid", peakHours: 1.25, durationHours: 4.5 },
  { id: "faster_aspart", category: "bolus", label: "Fiasp", peakHours: 0.75, durationHours: 4 },
  { id: "lispro", category: "bolus", label: "Humalog", peakHours: 1.25, durationHours: 4.5 },
  { id: "lispro_aabc", category: "bolus", label: "Lyumjev", peakHours: 0.75, durationHours: 4 },
  { id: "glulisine", category: "bolus", label: "Apidra", peakHours: 1.0, durationHours: 4.5 },
  { id: "regular_human", category: "bolus", label: "Actrapid", peakHours: 2.5, durationHours: 6.5 },
  { id: "humulin_r", category: "bolus", label: "Humulin R", peakHours: 2.5, durationHours: 6.5 },

  // Premixed, in the order the picker offers them. Its own third picker slot
  // (see components/InsulinProductPicker.tsx): a mix covers both a basal and
  // a bolus component in one injection, so picking one fills both DB fields
  // (see isMixSelection below) instead of living under either slot's list.
  { id: "mix_aspart", category: "mix", label: "NovoMix", peakHours: 1.5, durationHours: 16 },
  { id: "mix_degludec_aspart", category: "mix", label: "Ryzodeg", peakHours: 1.5, durationHours: 24 },
  { id: "mix_lispro", category: "mix", label: "Humalog Mix", peakHours: 1.5, durationHours: 16 },
  { id: "mix_human", category: "mix", label: "Mixtard", peakHours: 3, durationHours: 16 },
] as const;

/** Fallback used when the user has not picked a bolus product. Not listed in
 *  INSULIN_PRODUCTS / productsByCategory: it is never itself a selectable item. */
export const DEFAULT_BOLUS_PROFILE: InsulinProduct = {
  id: "generic_rapid",
  category: "bolus",
  label: "",
  peakHours: 1.25,
  durationHours: 4.5,
};

/** Fallback used when the user has not picked a basal product. */
export const DEFAULT_BASAL_PROFILE: InsulinProduct = {
  id: "generic_basal",
  category: "basal",
  label: "",
  peakHours: null,
  durationHours: 24,
};

/** The id a profile's basal_insulin_id / bolus_insulin_id carries when the
 *  product is not in the catalog and the user typed their own name instead
 *  (stored separately - see UserProfile.basal_insulin_other /
 *  bolus_insulin_other in lib/db/types.ts, schema v22). Never itself an entry
 *  in INSULIN_PRODUCTS. */
export const OTHER_PRODUCT_ID = "other";

export function insulinProductById(
  id: string | null | undefined
): InsulinProduct | null {
  if (!id) return null;
  return INSULIN_PRODUCTS.find((p) => p.id === id) ?? null;
}

/** A "mix" product carries both a basal and a bolus component, so it counts
 *  toward whichever slot's profile is asked for. */
export function bolusProfileFor(id: string | null | undefined): InsulinProduct {
  const product = insulinProductById(id);
  return product && (product.category === "bolus" || product.category === "mix")
    ? product
    : DEFAULT_BOLUS_PROFILE;
}

export function basalProfileFor(id: string | null | undefined): InsulinProduct {
  const product = insulinProductById(id);
  return product && (product.category === "basal" || product.category === "mix")
    ? product
    : DEFAULT_BASAL_PROFILE;
}

export function productsByCategory(
  category: InsulinCategory
): readonly InsulinProduct[] {
  return INSULIN_PRODUCTS.filter((p) => p.category === category);
}

/** True when a profile is on a premix: the basal and bolus fields carry the
 *  SAME id and that id is a "mix" product. Premix is never its own DB column
 *  (see UserProfile.basal_insulin_id / bolus_insulin_id) - one product simply
 *  fills both fields, and this is how every caller re-derives that fact. */
export function isMixSelection(
  basalId: string | null | undefined,
  bolusId: string | null | undefined
): boolean {
  if (!basalId || !bolusId || basalId !== bolusId) return false;
  return insulinProductById(basalId)?.category === "mix";
}
