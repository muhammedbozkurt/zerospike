/** One import path for the meal sheet bodies. When the shared UI kit (B1)
 *  renames a primitive, only the imports inside these files change. */
export { LiveTotalHeader } from "./LiveTotalHeader";
export { PortionSegment } from "./PortionSegment";
export { FoodCard } from "./FoodCard";
export { FoodSearchBlock } from "./FoodSearchBlock";
export { EstimateResultCard } from "./EstimateResultCard";
export { MealCardShell } from "./MealCardShell";
export {
  invalidateFoodPortions,
  loadFoodPortions,
  rememberPortion,
  useFoodPortions,
  useFoodPortionsMap,
  type FoodPortionsView,
} from "./useFoodPortions";
export { usePortionUnitSystem } from "./usePortionUnitSystem";
export {
  cardPortionState,
  chipA11yLabel,
  chipLabel,
  chipText,
  entryUnitAfterChip,
  estimateAmountText,
  gramOpenAfterChip,
  searchBlockGroups,
  splitTotalLine,
  targetSharePct,
  visibleChips,
  type ChipLabel,
  type ChipUnits,
} from "./mealCards";
