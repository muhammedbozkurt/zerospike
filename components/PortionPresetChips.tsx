import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { listPortions } from "../lib/db/foods";
import type { FoodPortion } from "../lib/db/types";
import { num } from "../lib/format";
import { getLastPortion, setLastPortion } from "../lib/lastPortion";
import { pickRememberedPortion } from "../lib/lastPortionMap";
import { hapticSelect } from "../lib/haptics";
import { THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich";

/**
 * Quick-pick chips for a food's preset serving sizes (food_portions). Renders
 * nothing while there is nothing to load or nothing came back - most of the
 * catalog carries no presets at all, which is the ordinary case, not an error.
 */
export function PortionPresetChips({
  foodId,
  value,
  onPick,
  autoSelect,
  style,
}: {
  foodId: string;
  /** Current portion in grams, so the matching preset (if any) reads selected. */
  value?: number;
  onPick: (grams: number) => void;
  /** Pick the food's remembered preset once the list loads. Off wherever the
   *  portion is already decided (editing a record, a re-log with a portion). */
  autoSelect?: boolean;
  style?: ViewStyle;
}) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<FoodPortion[]>([]);

  useEffect(() => {
    let alive = true;
    setPresets([]);
    if (!foodId) return;
    (async () => {
      const rows = await listPortions(foodId);
      if (!alive) return;
      setPresets(rows);
      if (autoSelect && rows.length > 0) {
        const hit = pickRememberedPortion(rows, await getLastPortion(foodId));
        if (hit && alive) onPick(hit.grams);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodId]);

  if (presets.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={{ gap: 8 }}
    >
      {presets.map((p) => {
        const active = value === p.grams;
        const label = `${num(1)} ${t(`portion.${p.label_key}`)} · ${num(p.grams)} ${t("common.grams")}`;
        return (
          <Pressable
            key={p.id}
            onPress={() => {
              if (!active) hapticSelect();
              onPick(p.grams);
              void setLastPortion(foodId, p.label_key);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderWidth: 1,
              borderColor: active ? THEME.accent : THEME.border,
              backgroundColor: active ? withAlpha(THEME.accent, 0.16) : THEME.surface,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12,
                fontWeight: active ? "700" : "500",
                color: active ? THEME.accent : THEME.text,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
