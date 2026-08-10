/**
 * Insulin product catalog: typical pharmacokinetic figures (peak, duration) as
 * printed on product leaflets. They vary person to person and are used ONLY to
 * shape the app's "active insulin" estimate; this module gives no dose, no
 * warning and no diagnosis. Dependency-free (no DB, no i18n) so it can be
 * imported from either side.
 */

export type InsulinCategory = "bolus" | "basal";

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
  // Bolus (mealtime)
  { id: "faster_aspart", category: "bolus", label: "Fiasp", peakHours: 0.75, durationHours: 4 },
  { id: "aspart", category: "bolus", label: "NovoRapid / Novolog", peakHours: 1.25, durationHours: 4.5 },
  { id: "lispro", category: "bolus", label: "Humalog", peakHours: 1.25, durationHours: 4.5 },
  { id: "lispro_aabc", category: "bolus", label: "Lyumjev", peakHours: 0.75, durationHours: 4 },
  { id: "glulisine", category: "bolus", label: "Apidra", peakHours: 1.0, durationHours: 4.5 },
  { id: "regular_human", category: "bolus", label: "Actrapid / Humulin R", peakHours: 2.5, durationHours: 6.5 },
  // Basal (long-acting)
  { id: "nph", category: "basal", label: "Insulatard / Humulin N", peakHours: 5, durationHours: 14 },
  { id: "detemir", category: "basal", label: "Levemir", peakHours: 6, durationHours: 20 },
  { id: "glargine_u100", category: "basal", label: "Lantus / Basaglar", peakHours: null, durationHours: 24 },
  { id: "glargine_u300", category: "basal", label: "Toujeo", peakHours: null, durationHours: 30 },
  { id: "degludec", category: "basal", label: "Tresiba", peakHours: null, durationHours: 42 },
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

export function insulinProductById(
  id: string | null | undefined
): InsulinProduct | null {
  if (!id) return null;
  return INSULIN_PRODUCTS.find((p) => p.id === id) ?? null;
}

export function bolusProfileFor(id: string | null | undefined): InsulinProduct {
  const product = insulinProductById(id);
  return product && product.category === "bolus" ? product : DEFAULT_BOLUS_PROFILE;
}

export function basalProfileFor(id: string | null | undefined): InsulinProduct {
  const product = insulinProductById(id);
  return product && product.category === "basal" ? product : DEFAULT_BASAL_PROFILE;
}

export function productsByCategory(
  category: InsulinCategory
): readonly InsulinProduct[] {
  return INSULIN_PRODUCTS.filter((p) => p.category === category);
}
