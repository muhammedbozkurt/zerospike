import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { EditableItem } from "../../lib/ai/carbEstimateClient";
import { num } from "../../lib/format";
import { useCarbChoiceText } from "../../lib/carbDisplayPref";
import { parseGramsInput } from "../../lib/mealCompose";
import { HIT_TARGET, INPUT_TEXT, TABULAR, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../rich";
import { MealCardShell } from "./MealCardShell";
import { estimateAmountText } from "./mealCards";

const inputBase = {
  minHeight: HIT_TARGET,
  borderRadius: 12,
  borderWidth: 1,
  paddingHorizontal: 10,
  fontSize: 16,
} as const;

/**
 * One line of a text estimate (Spike) in the card shell: the food name, an
 * amount chip ("2 × slice") that opens quantity and unit in place, and the
 * estimated carbohydrates on the right as an editable "≈ 12 g". The "≈" and
 * the "approx." spoken label keep it clear this is an estimate, not a measured
 * figure. No dose anywhere.
 */
export function EstimateResultCard({
  line,
  onChange,
  onRemove,
}: {
  line: EditableItem;
  onChange: (next: EditableItem) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const choiceText = useCarbChoiceText();
  const [editing, setEditing] = useState(false);
  const amount = estimateAmountText(parseGramsInput(line.quantityText), line.unit, num);
  const name = line.name.trim();
  const choices = choiceText(parseGramsInput(line.gramsText));

  return (
    <MealCardShell
      category=""
      removeLabel={`${t("mealCompose.remove")}: ${name || "-"}`}
      onRemove={onRemove}
      title={
        <TextInput
          value={line.name}
          onChangeText={(next) => onChange({ ...line, name: next })}
          maxLength={80}
          accessibilityLabel={t("carbEstimate.itemName")}
          style={[
            INPUT_TEXT,
            { color: THEME.text, fontSize: 15, fontWeight: "700", paddingVertical: 4 },
          ]}
        />
      }
      figure={
        <View style={{ alignItems: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: THEME.textMuted, fontSize: 18, fontWeight: "700" }}>≈ </Text>
          <TextInput
            value={line.gramsText}
            onChangeText={(next) => onChange({ ...line, gramsText: next })}
            keyboardType="decimal-pad"
            selectTextOnFocus
            maxLength={6}
            accessibilityLabel={`${t("carbEstimate.approx")} ${t("carbEstimate.itemCarbs")}: ${name}`}
            style={[
              INPUT_TEXT,
              TABULAR,
              inputBase,
              {
                minWidth: 56,
                textAlign: "center",
                fontSize: 20,
                fontWeight: "800",
                color: THEME.text,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
              },
            ]}
          />
          <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "600", marginStart: 3 }}>
            {t("common.grams")}
          </Text>
        </View>
        {choices ? (
          <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 11, fontWeight: "600" }]}>
            {choices}
          </Text>
        ) : null}
        </View>
      }
    >
      {editing ? (
        <View style={{ flexDirection: "row", alignItems: "center", columnGap: 8 }}>
          <TextInput
            value={line.quantityText}
            onChangeText={(next) => onChange({ ...line, quantityText: next })}
            keyboardType="decimal-pad"
            selectTextOnFocus
            autoFocus
            maxLength={6}
            accessibilityLabel={t("carbEstimate.itemQuantity")}
            style={[
              INPUT_TEXT,
              TABULAR,
              inputBase,
              {
                width: 72,
                textAlign: "center",
                color: THEME.text,
                borderColor: THEME.accent,
                backgroundColor: THEME.surface,
              },
            ]}
          />
          <TextInput
            value={line.unit}
            onChangeText={(next) => onChange({ ...line, unit: next })}
            maxLength={24}
            accessibilityLabel={t("carbEstimate.itemUnit")}
            style={[
              INPUT_TEXT,
              inputBase,
              {
                flex: 1,
                color: THEME.text,
                borderColor: THEME.accent,
                backgroundColor: THEME.surface,
              },
            ]}
          />
          <Pressable
            onPress={() => setEditing(false)}
            accessibilityRole="button"
            accessibilityLabel={t("common.done")}
            style={{
              minHeight: HIT_TARGET,
              minWidth: HIT_TARGET,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: THEME.accent, fontSize: 14, fontWeight: "700" }}>
              {t("common.done")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: "row" }}>
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t("carbEstimate.edit")}: ${amount}`}
            style={{
              minHeight: HIT_TARGET,
              justifyContent: "center",
              borderRadius: 999,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: THEME.border,
              backgroundColor: withAlpha(THEME.accent, 0.1),
            }}
          >
            <Text numberOfLines={1} style={[TABULAR, { color: THEME.text, fontSize: 14, fontWeight: "600" }]}>
              {amount}
            </Text>
          </Pressable>
        </View>
      )}
    </MealCardShell>
  );
}
