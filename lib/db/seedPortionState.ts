/**
 * Which catalog foods have a household cup that only means something with its
 * state: "1 cup" of rice is 158 g cooked and about 185 g dry, so the chip says
 * "1 cup, cooked". The state is read off the USDA household measure the gram
 * figure in ./seedPortions came from (FDC id and description in `ref`), never
 * guessed. A food whose USDA measure does not say cooked or dry (canned,
 * "prepared", a dish) has NO entry here and keeps the plain label.
 *
 * Display only: a code constant keyed by the catalog's English name, nothing is
 * stored, so there is no migration and no catalog version bump. Only the cup is
 * ever stated (STATE_PORTION_LABEL); every food listed here carries nothing but
 * a cup in ./seedPortions, which scripts/carbPortions.test.ts enforces.
 *
 * "dry" is the USDA "raw" record of a dry cereal (the catalog names it "dry").
 * Pure: imported by the chip text code and by the tests under node.
 */
import type { PortionLabelKey } from "./types";
import { seedNameKey } from "./seedVersion";

export type PortionState = "cooked" | "dry";

export interface PortionStateEntry {
  state: PortionState;
  /** USDA FoodData Central record the measure comes from: "SR<id> description". */
  ref: string;
}

/** The only measure whose label carries a state. */
export const STATE_PORTION_LABEL: PortionLabelKey = "cup";

const cooked = (ref: string): PortionStateEntry => ({ state: "cooked", ref });
const dry = (ref: string): PortionStateEntry => ({ state: "dry", ref });

export const PORTION_STATE: Readonly<Record<string, PortionStateEntry>> = {
  // rice
  "White rice": cooked("SR168878 Rice, white, long-grain, regular, enriched, cooked"),
  "Brown rice": cooked("SR168875 Rice, brown, medium-grain, cooked"),
  "Basmati rice": cooked("FN2708403 Rice, white, cooked, NS as to fat"),
  "Sticky rice (cooked)": cooked("SR169711 Rice, white, glutinous, unenriched, cooked"),

  // pasta and noodles
  Pasta: cooked("FN2708357 Pasta, cooked"),
  Spaghetti: cooked("FN2708357 Pasta, cooked"),
  "Penne pasta": cooked("SR168928 Pasta, cooked, unenriched, without added salt (1 cup penne)"),
  "Whole wheat pasta": cooked("SR168910 Pasta, whole-wheat, cooked"),
  "Macaroni (cooked)": cooked("SR168928 Pasta, cooked, unenriched, without added salt (1 cup elbows)"),
  "Fusilli (cooked)": cooked("SR168928 Pasta, cooked, unenriched, without added salt (1 cup rotini)"),
  "Farfalle (cooked)": cooked("SR169737 Pasta, cooked, enriched, without added salt (1 cup farfalle)"),
  Noodles: cooked("SR169732 Noodles, egg, enriched, cooked"),
  "Egg noodles (cooked)": cooked("SR169732 Noodles, egg, enriched, cooked"),
  "Soba noodles": cooked("SR168907 Noodles, japanese, soba, cooked"),
  "Rice noodles": cooked("SR168914 Rice noodles, cooked"),

  // grains
  Quinoa: cooked("SR168917 Quinoa, cooked"),
  Couscous: cooked("SR169700 Couscous, cooked"),
  Bulgur: cooked("SR170287 Bulgur, cooked"),
  Barley: cooked("SR170285 Barley, pearled, cooked"),
  "Pearl barley (cooked)": cooked("SR170285 Barley, pearled, cooked"),
  Buckwheat: cooked("SR170686 Buckwheat groats, roasted, cooked"),
  Millet: cooked("SR168871 Millet, cooked"),
  "Cooked millet": cooked("SR168871 Millet, cooked"),
  "Spelt berries (cooked)": cooked("SR169746 Spelt, cooked"),
  "Teff (cooked)": cooked("SR168918 Teff, cooked"),
  Oatmeal: cooked("SR173905 Cereals, oats, regular and quick, unenriched, cooked with water"),
  Polenta: cooked("FN2708374 Cornmeal mush, no added fat (1 cup, cooked)"),
  "Oat bran (dry)": dry("SR168872 Oat bran, raw"),

  // legumes
  "White beans": cooked("SR175203 Beans, white, mature seeds, cooked, boiled, without salt"),
  Chickpeas: cooked("SR173757 Chickpeas, mature seeds, cooked, boiled, without salt"),
  Lentils: cooked("SR172421 Lentils, mature seeds, cooked, boiled, without salt"),
  "Red lentils": cooked("SR172421 Lentils, mature seeds, cooked, boiled, without salt"),
  "Green lentils": cooked("SR172421 Lentils, mature seeds, cooked, boiled, without salt"),
  "Yellow lentils": cooked("SR172421 Lentils, mature seeds, cooked, boiled, without salt"),
  "Kidney beans": cooked("SR173740 Beans, kidney, all types, mature seeds, cooked, boiled, without salt"),
  "Black beans": cooked("SR173735 Beans, black, mature seeds, cooked, boiled, without salt"),
  "Pinto beans": cooked("SR175200 Beans, pinto, mature seeds, cooked, boiled, without salt"),
  "Black-eyed peas": cooked("SR173759 Cowpeas, common, mature seeds, cooked, boiled, without salt"),
  "Split peas": cooked("SR172429 Peas, split, mature seeds, cooked, boiled, without salt"),
  "Mung beans": cooked("SR174257 Mung beans, mature seeds, cooked, boiled, without salt"),
  "Green peas": cooked("SR170420 Peas, green, cooked, boiled, drained, without salt"),
  Soybeans: cooked("SR174271 Soybeans, mature cooked, boiled, without salt"),
};

const STATE_BY_KEY: ReadonlyMap<string, PortionState> = new Map(
  Object.entries(PORTION_STATE).map(([en, entry]) => [seedNameKey(en), entry.state])
);

/** The minimal food shape the lookup needs (a lib/db Food satisfies it). */
export interface PortionStateFood {
  name_en?: string | null;
  is_custom?: number | null;
  source?: string | null;
}

/**
 * The state of a food's cup, or null. Only an untouched catalog row qualifies:
 * a food the user renamed, edited or typed in themselves (is_custom = 1) or
 * that came from Open Food Facts keeps whatever grams the person gave it, and
 * nothing here knows what state those are.
 */
export function portionStateFor(food: PortionStateFood | null | undefined): PortionState | null {
  if (!food) return null;
  if (food.is_custom !== 0 || (food.source ?? null) !== null) return null;
  return STATE_BY_KEY.get(seedNameKey(food.name_en ?? "")) ?? null;
}

/** The state a chip of this measure carries: only the cup is ever stated. */
export function statedFor(
  label: PortionLabelKey | null | undefined,
  state: PortionState | null | undefined
): PortionState | null {
  return label === STATE_PORTION_LABEL && state ? state : null;
}

/** The locale key of a measure's label: "portion.cup", or "portion.cupCooked" /
 *  "portion.cupDry" for a stated cup. One combined key per state (not a joined
 *  "label, state") so each language agrees the state word with the measure. */
export function portionLabelI18nKey(
  label: PortionLabelKey,
  state?: PortionState | null
): string {
  const stated = statedFor(label, state);
  if (!stated) return `portion.${label}`;
  return stated === "cooked" ? "portion.cupCooked" : "portion.cupDry";
}
