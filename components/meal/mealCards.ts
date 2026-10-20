/**
 * The pure half of components/meal: no React and no react-native, so
 * scripts/mealCards.test.ts runs it under node.
 */

import {
  PORTION_CHIPS_MAX,
  chipFromGrams,
  type PortionChip,
} from "../../lib/mealCompose";
import { portionLabelI18nKey } from "../../lib/db/seedPortionState";
import { formatPortionChip, type PortionUnitSystem } from "../../lib/portionUnits";

type Translate = (key: string) => string;
type FormatNumber = (n: number) => string;

/** The chips a segment draws: unique ids, the free-entry chips ("oz…" then
 *  "grams…") last, at most PORTION_CHIPS_MAX measure-and-grams chips (the "oz…"
 *  chip rides on top of that). buildPortionChips already guarantees this; a
 *  list that came from elsewhere (a stale cache, a test) is normalised the
 *  same way. */
export function visibleChips(chips: readonly PortionChip[]): PortionChip[] {
  const seen = new Set<string>();
  const measures: PortionChip[] = [];
  let grams: PortionChip | null = null;
  let oz: PortionChip | null = null;
  for (const chip of chips) {
    if (seen.has(chip.id)) continue;
    seen.add(chip.id);
    if (chip.kind === "grams") grams = chip;
    else if (chip.kind === "oz") oz = chip;
    else measures.push(chip);
  }
  const room = grams ? PORTION_CHIPS_MAX - 1 : PORTION_CHIPS_MAX;
  const out = measures.slice(0, room);
  if (oz) out.push(oz);
  if (grams) out.push(grams);
  return out;
}

/** How a device words its chips (lib/portionUnits): the unit system and, for a
 *  liquid, the USDA grams of one fluid ounce. Undefined / "metric" = the
 *  translated "1 × Slice" chips. */
export interface ChipUnits {
  system: PortionUnitSystem;
  gPerFlOz?: number | null;
}

export interface ChipLabel {
  text: string;
  /** The gram equivalent under the text ("28 g"); null on the plain chips. */
  caption: string | null;
}

/** What a chip prints. A measure chip is "1 × Slice" (existing portion.*
 *  labels, no plural forms) unless the device is US / UK English, where it is
 *  "1 slice (1 oz)" with the grams under it; the grams and oz chips are the
 *  generic "grams…" / "oz…". A cup of a food with a cooked / dry state carries
 *  it: "1 cup, cooked" / "1 × Su bardağı, pişmiş". */
export function chipLabel(
  chip: PortionChip,
  t: Translate,
  fmt: FormatNumber,
  units?: ChipUnits
): ChipLabel {
  if (chip.kind === "grams") return { text: t("mealCompose.gramChip"), caption: null };
  if (chip.kind === "oz") return { text: t("mealCompose.ozChip"), caption: null };
  if (!chip.label_key) return { text: t("mealCompose.gramChip"), caption: null };
  if (units && units.system !== "metric") {
    const local = formatPortionChip(
      {
        label_key: chip.label_key,
        multiplier: chip.multiplier,
        unit_g: chip.unit_g,
        state: chip.state,
      },
      units.system,
      units.gPerFlOz,
      fmt
    );
    if (local) return local;
  }
  return {
    text: `${fmt(chip.multiplier)} × ${t(portionLabelI18nKey(chip.label_key, chip.state))}`,
    caption: null,
  };
}

/** The text of a chip (see chipLabel). */
export function chipText(
  chip: PortionChip,
  t: Translate,
  fmt: FormatNumber,
  units?: ChipUnits
): string {
  return chipLabel(chip, t, fmt, units).text;
}

/** Spoken label: the chip text plus the grams it stands for. */
export function chipA11yLabel(
  chip: PortionChip,
  t: Translate,
  fmt: FormatNumber,
  units?: ChipUnits
): string {
  const text = chipText(chip, t, fmt, units);
  if (chip.kind !== "measure") return text;
  const grams = Math.round(chip.unit_g * chip.multiplier * 10) / 10;
  return `${text}, ${fmt(grams)} ${t("common.grams")}`;
}

export interface CardPortionState {
  /** The chip that reads selected (null when the list has no match at all). */
  selectedChipId: string | null;
  /** The chip row is on screen. */
  showChips: boolean;
  /** The free entry field (grams or ounces) is on screen. */
  showGramField: boolean;
}

/** Chips and the gram field never share a card: the field replaces the chip
 *  row while it is open, and the chip row is the only thing shown otherwise.
 *  With the field open the grams chip is the selected one. */
export function cardPortionState(
  chips: readonly PortionChip[],
  portionG: number,
  gramOpen: boolean,
  entryUnit: "g" | "oz" = "g"
): CardPortionState {
  const gramsChip = chips.find((c) => c.kind === "grams") ?? null;
  const entryChip =
    (entryUnit === "oz" ? chips.find((c) => c.kind === "oz") : null) ?? gramsChip;
  const selected = gramOpen
    ? entryChip ?? chipFromGrams(chips, portionG)
    : chipFromGrams(chips, portionG);
  return {
    selectedChipId: selected ? selected.id : null,
    showChips: !gramOpen,
    showGramField: gramOpen,
  };
}

/** The entry field opens when the grams or oz chip is tapped; a measure chip
 *  closes it again (the parent calls this with the tapped chip). */
export function gramOpenAfterChip(chip: PortionChip): boolean {
  return chip.kind !== "measure";
}

/** Which unit the open entry field is in: the oz chip means ounces, anything
 *  else grams. */
export function entryUnitAfterChip(chip: PortionChip): "g" | "oz" {
  return chip.kind === "oz" ? "oz" : "g";
}

/** The share of the daily target one meal is, as a 0..100 figure for pct();
 *  null when there is no usable target. Not capped, not coloured: it is a
 *  neutral proportion. */
export function targetSharePct(totalG: number, targetG: number | null | undefined): number | null {
  if (typeof targetG !== "number" || !Number.isFinite(targetG) || targetG <= 0) return null;
  const total = Number.isFinite(totalG) && totalG > 0 ? totalG : 0;
  return Math.round((total / targetG) * 100);
}

/** A totalLine template split around its value slot, so the number can be the
 *  big animated figure and the rest small text. Languages put the unit before
 *  or after the number, so both sides are returned. */
export function splitTotalLine(template: string, slot: string): { before: string; after: string } {
  const at = template.indexOf(slot);
  if (at < 0) return { before: "", after: ` ${template}` };
  return { before: template.slice(0, at), after: template.slice(at + slot.length) };
}

/** "2 × slice" for an estimate line; either half alone when the other is empty. */
export function estimateAmountText(
  quantity: number,
  unit: string,
  fmt: FormatNumber
): string {
  const q = Number.isFinite(quantity) && quantity > 0 ? fmt(quantity) : "";
  const u = unit.trim();
  if (q && u) return `${q} × ${u}`;
  return q || u || "-";
}

export interface FoodGroupsInput<T extends { id: string }> {
  recents: readonly T[];
  favorites: readonly T[];
  starters: readonly T[];
}

export interface FoodGroups<T> {
  recents: T[];
  favorites: T[];
  starters: T[];
}

/** What the empty-query search block shows: recents and favorites (a food in
 *  both groups stays in recents only), and the starters ONLY when both are
 *  empty. */
export function searchBlockGroups<T extends { id: string }>(
  input: FoodGroupsInput<T>,
  limit = 12
): FoodGroups<T> {
  const recents = input.recents.slice(0, limit);
  const recentIds = new Set(recents.map((f) => f.id));
  const favorites = input.favorites.filter((f) => !recentIds.has(f.id)).slice(0, limit);
  const empty = recents.length === 0 && favorites.length === 0;
  return { recents, favorites, starters: empty ? input.starters.slice(0, 3) : [] };
}
