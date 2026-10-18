import type { SeedFood } from "./seed";

/**
 * Foods added from a documented source. Every row here must carry `src` (and
 * `srcId` where the source has one); scripts/seed.test.ts enforces it. Empty
 * until the data batch lands. Type-only import of ./seed: no cycle at runtime.
 */
export const SEED_CARB: SeedFood[] = [];
