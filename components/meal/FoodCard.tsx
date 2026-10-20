import React, { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { decimalInputText, num } from "../../lib/format";
import { useCarbChoiceText } from "../../lib/carbDisplayPref";
import {
  chipFromGrams,
  composeItemCarbs,
  parseGramsInput,
  type ComposeItem,
  type PortionChip,
} from "../../lib/mealCompose";
import { ozFromGrams, parseOzInput } from "../../lib/portionUnits";
import { HIT_TARGET, INPUT_TEXT, TABULAR, THEME } from "../../lib/theme/tokens";
import { MealCardShell } from "./MealCardShell";
import { PortionSegment } from "./PortionSegment";
import { cardPortionState, type ChipUnits } from "./mealCards";

/**
 * One food in the meal: plate, name, this food's carbohydrates as the big
 * figure on the right, and either the serving chips or (after "grams…") the
 * gram field. Never both at once. Presentational: the parent owns portion_g,
 * the selected chip and gramOpen.
 */
export function FoodCard({
  item,
  chips,
  selectedChipId,
  gramOpen,
  onChip,
  onGrams,
  onGramsClose,
  onRemove,
  entryUnit = "g",
  units,
}: {
  item: ComposeItem;
  chips: readonly PortionChip[];
  /** Overrides the chip derived from item.portion_g; null/undefined derives it. */
  selectedChipId?: string | null;
  gramOpen: boolean;
  /** A chip was tapped. The grams chip means "open the gram field": the parent
   *  sets gramOpen true; any other chip sets portion_g and gramOpen false. */
  onChip: (chip: PortionChip) => void;
  /** Typed grams (already parsed; 0 for an empty or invalid field). */
  onGrams: (grams: number) => void;
  /** The check next to the gram field: back to the chip row, grams kept. When
   *  omitted the card re-selects the chip that matches the typed grams. */
  onGramsClose?: () => void;
  onRemove: () => void;
  /** Unit of the open entry field: "oz" is the US "oz…" chip. The typed ounces
   *  are converted to grams before onGrams, so portion_g stays grams. */
  entryUnit?: "g" | "oz";
  /** US / UK chip wording (lib/portionUnits); undefined = the plain chips. */
  units?: ChipUnits;
}) {
  const { t } = useTranslation();
  const choiceText = useCarbChoiceText();
  const state = cardPortionState(chips, item.portion_g, gramOpen, entryUnit);
  const selectedId = selectedChipId ?? state.selectedChipId;
  const inOz = entryUnit === "oz";
  const parseEntry = inOz ? parseOzInput : parseGramsInput;
  const entryText = (grams: number) =>
    inOz ? decimalInputText(ozFromGrams(grams)) : String(grams);
  const [text, setText] = useState(entryText(item.portion_g));

  useEffect(() => {
    if (parseEntry(text) !== item.portion_g) setText(entryText(item.portion_g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.portion_g, inOz]);

  const carbs = composeItemCarbs(item);
  const choices = choiceText(carbs);
  const removeLabel = `${t("mealCompose.remove")}: ${item.name}`;

  return (
    <MealCardShell
      category={item.category}
      removeLabel={removeLabel}
      onRemove={onRemove}
      title={
        <Text
          numberOfLines={2}
          style={{ color: THEME.text, fontSize: 15, fontWeight: "700" }}
        >
          {item.name}
        </Text>
      }
      figure={
        <View style={{ alignItems: "flex-end" }}>
          <Text
            accessibilityLabel={`${num(carbs)} ${t("common.grams")}${choices ? `, ${choices}` : ""}`}
            style={[TABULAR, { color: THEME.text, fontSize: 22, fontWeight: "800" }]}
          >
            {num(carbs)}
            <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "600" }}>
              {t("common.grams")}
            </Text>
          </Text>
          {choices ? (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[TABULAR, { color: THEME.textMuted, fontSize: 11, fontWeight: "600" }]}
            >
              {choices}
            </Text>
          ) : null}
        </View>
      }
    >
      {state.showGramField ? (
        <View style={{ flexDirection: "row", alignItems: "center", columnGap: 10 }}>
          <TextInput
            value={text}
            onChangeText={(next) => {
              setText(next);
              onGrams(parseEntry(next));
            }}
            keyboardType="decimal-pad"
            selectTextOnFocus
            autoFocus
            maxLength={7}
            accessibilityLabel={`${t(inOz ? "mealCompose.amountOz" : "mealCompose.amount")}: ${item.name}`}
            style={[
              INPUT_TEXT,
              TABULAR,
              {
                minWidth: 88,
                minHeight: HIT_TARGET,
                textAlign: "center",
                color: THEME.text,
                fontSize: 17,
                fontWeight: "700",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: THEME.accent,
                backgroundColor: THEME.surface,
                paddingHorizontal: 10,
              },
            ]}
          />
          <Text style={{ color: THEME.textMuted, fontSize: 13 }}>
            {t(inOz ? "common.oz" : "common.grams")}
          </Text>
          <Pressable
            onPress={() => {
              if (onGramsClose) onGramsClose();
              else {
                const hit = chipFromGrams(chips, item.portion_g);
                if (hit) onChip(hit);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={t("common.done")}
            style={{
              marginStart: "auto",
              minWidth: HIT_TARGET,
              minHeight: HIT_TARGET,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="checkmark-circle" size={28} color={THEME.accent} />
          </Pressable>
        </View>
      ) : (
        <PortionSegment chips={chips} selectedId={selectedId} onSelect={onChip} units={units} />
      )}
    </MealCardShell>
  );
}
