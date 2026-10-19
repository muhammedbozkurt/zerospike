import React from "react";
import { Pressable, ScrollView, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { logEvent } from "../../lib/analytics";
import { num } from "../../lib/format";
import { hapticSelect } from "../../lib/haptics";
import type { PortionChip } from "../../lib/mealCompose";
import { HIT_TARGET, TABULAR, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../rich";
import { chipA11yLabel, chipText, visibleChips } from "./mealCards";

/**
 * One food's serving chips ("1 × Slice", "2 × Slice", "grams…") as a
 * horizontally scrolling row. Presentational: the selection lives in the
 * parent, the grams are the parent's too.
 */
export function PortionSegment({
  chips,
  selectedId,
  onSelect,
  style,
}: {
  chips: readonly PortionChip[];
  selectedId: string | null;
  onSelect: (chip: PortionChip) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const list = visibleChips(chips);
  if (list.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={{ gap: 8, alignItems: "center", paddingEnd: 4 }}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="radiogroup"
    >
      {list.map((chip) => {
        const active = chip.id === selectedId;
        const tr = (key: string) => t(key);
        const label = chipText(chip, tr, num);
        return (
          <Pressable
            key={chip.id}
            onPress={() => {
              if (!active) {
                hapticSelect();
                logEvent("portion_chip_used", { kind: chip.kind });
              }
              onSelect(chip);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, checked: active }}
            accessibilityLabel={chipA11yLabel(chip, tr, num)}
            style={{
              minHeight: HIT_TARGET,
              minWidth: HIT_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: active ? THEME.accent : THEME.border,
              backgroundColor: active ? withAlpha(THEME.accent, 0.16) : THEME.surface,
            }}
          >
            <Text
              numberOfLines={1}
              style={[
                TABULAR,
                {
                  fontSize: 14,
                  fontWeight: active ? "700" : "500",
                  color: active ? THEME.accent : THEME.text,
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
