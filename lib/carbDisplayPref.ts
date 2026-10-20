import { useCallback, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";

import { carbChoiceText, isCarbDisplayMode, type CarbDisplayMode } from "./carbDisplay";

/**
 * App-wide (not per profile) carbohydrate display preference, same pattern as
 * the haptics switch: a synchronous module cache so every gram figure can read
 * it during render, AsyncStorage as the durable copy, and a subscriber list so
 * changing it in Settings re-renders open screens. Grams stay the default.
 */
export const CARB_DISPLAY_KEY = "zerospike.carbDisplay";

let mode: CarbDisplayMode = "gram";
let touched = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

void AsyncStorage.getItem(CARB_DISPLAY_KEY)
  .then((v) => {
    if (touched || !isCarbDisplayMode(v) || v === mode) return;
    mode = v;
    emit();
  })
  .catch(() => {});

export function getCarbDisplayMode(): CarbDisplayMode {
  return mode;
}

export async function setCarbDisplayMode(next: CarbDisplayMode): Promise<void> {
  touched = true;
  if (next !== mode) {
    mode = next;
    emit();
  }
  try {
    await AsyncStorage.setItem(CARB_DISPLAY_KEY, next);
  } catch {
    // the cache still holds for this run
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useCarbDisplayMode(): CarbDisplayMode {
  return useSyncExternalStore(subscribe, getCarbDisplayMode, getCarbDisplayMode);
}

/** `(grams) => "≈ 4 × 15 g" | null`; null in gram mode and for 0 g. Rebuilt when
 *  the mode or the language changes so memoised rows pick it up. */
export function useCarbChoiceText(): (grams: number) => string | null {
  const { t, i18n } = useTranslation();
  const m = useCarbDisplayMode();
  const lang = i18n.language;
  return useCallback(
    (grams: number) =>
      carbChoiceText(grams, m, {
        unit: lang.slice(0, 2) === "ar" ? "غ" : t("common.grams"),
        approx: (v) => t("carbDisplay.approx", v),
        less: (v) => t("carbDisplay.less", v),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, lang]
  );
}
