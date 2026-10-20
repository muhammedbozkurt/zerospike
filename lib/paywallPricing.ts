export interface PlanPrice {
  price: number;
  currencyCode: string;
}

/**
 * What the one-off lifetime price is worth in years of the NORMAL annual plan,
 * from the store's own two prices (never a written-down number: both move per
 * country and per promotion). One decimal, so 2399.99 / 699.99 reads 3.4 and not
 * a rounded-up 3.5. Null when either plan is missing, a price is not a positive
 * number, the currencies differ, or the lifetime is not dearer than a year, so
 * the line disappears instead of anchoring against nothing.
 */
export function lifetimeYearsOfAnnual(
  lifetime: PlanPrice | null | undefined,
  annual: PlanPrice | null | undefined
): number | null {
  if (!lifetime || !annual) return null;
  if (!(lifetime.price > 0) || !(annual.price > 0)) return null;
  if (!Number.isFinite(lifetime.price) || !Number.isFinite(annual.price)) return null;
  if (!lifetime.currencyCode || lifetime.currencyCode !== annual.currencyCode) return null;
  const years = Math.round((lifetime.price / annual.price) * 10) / 10;
  return years > 1 ? years : null;
}
