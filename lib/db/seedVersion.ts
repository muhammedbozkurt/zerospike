/**
 * The catalog's own version number, kept OUT of ./seed.ts on purpose.
 *
 * lib/db/index.ts has to answer "does this install already have the current
 * catalog?" on every cold start, and ./seed.ts is a 1000-plus element literal it
 * deliberately does not parse unless it is about to insert from it. So the
 * question is answered from this two-constant module instead: the number is read
 * on every launch, the data behind it almost never.
 *
 * BUMP THIS whenever SEED_FOODS gains rows. Nothing else triggers the top-up,
 * and without a bump the new foods only ever reach fresh installs.
 *
 *   1  the original 562-food catalog (implicit: installs that predate the
 *      marker report 0, which is treated the same as 1 for our purposes since
 *      the top-up is keyed on names, not on the number)
 *   2  the expansion to 1152 foods
 */

// A type-only import: erased at build time, so reading this module never pulls
// the catalog itself into memory. That is the whole point of the split.
import type { SeedFood } from "./seed";

export const SEED_CATALOG_VERSION = 2;

/** The app_meta key the number above is stored under (schema v14). */
export const SEED_CATALOG_VERSION_KEY = "seed_catalog_version";

/**
 * How a food name is compared. Case-insensitive because "Ekmek" and "ekmek" are
 * the same food to the person reading the list, and trimmed because a stray
 * space is not a different food either.
 *
 * Invariant lowercasing, NOT the Turkish one the rest of the app uses for
 * display. This key is matched against name_en, and Turkish casing turns an
 * uppercase "I" into "ı": a user who typed a food in capitals would stop
 * matching the catalog entry with the same name and get a second, duplicate row.
 * The identity of a stored string is not a language question.
 */
export function seedNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Which catalog foods a database does not have yet: the top-up's entire
 * decision, kept pure so it can be tested against a real database without the
 * native SQLite module (scripts/migration.test.ts).
 *
 * `existingNames` is EVERY name_en in the foods table, not just the seeded ones.
 * Matching against the user's own rows too is deliberate: someone who long ago
 * typed in a food we are only now shipping should keep theirs and should not end
 * up looking at two rows with the same name. Nothing here decides to overwrite
 * anything; the caller only ever INSERTs what comes back.
 */
export function selectMissingFoods(
  catalog: readonly SeedFood[],
  existingNames: Iterable<string | null | undefined>
): SeedFood[] {
  const known = new Set<string>();
  for (const name of existingNames) {
    const key = seedNameKey(name ?? "");
    if (key) known.add(key);
  }
  return catalog.filter((f) => !known.has(seedNameKey(f.en)));
}
