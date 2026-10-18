import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PortionLabelKey } from "./db/types";
import {
  LAST_PORTION_KEY,
  parseLastPortions,
  withLastPortion,
} from "./lastPortionMap";

/**
 * Per-food last picked serving preset, device-wide (not per profile): it is a
 * habit about the food, not health data. Storage failure only means the chip
 * is not pre-selected next time.
 */
export async function getLastPortion(foodId: string): Promise<PortionLabelKey | undefined> {
  try {
    return parseLastPortions(await AsyncStorage.getItem(LAST_PORTION_KEY))[foodId];
  } catch {
    return undefined;
  }
}

export async function setLastPortion(foodId: string, label: PortionLabelKey): Promise<void> {
  try {
    const map = parseLastPortions(await AsyncStorage.getItem(LAST_PORTION_KEY));
    await AsyncStorage.setItem(
      LAST_PORTION_KEY,
      JSON.stringify(withLastPortion(map, foodId, label))
    );
  } catch {
    // see above
  }
}
