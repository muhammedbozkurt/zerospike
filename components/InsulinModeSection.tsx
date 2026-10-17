import React from "react";
import { Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { DiabetesType, InsulinMode } from "../lib/db/types";
import { isNoInsulinDiabetesType } from "../lib/diabetesDefaults";
import { THEME, switchColors } from "../lib/theme/tokens";
import { FormCard } from "./form";
import { Segmented } from "./ui";

const MODE_LABEL_KEYS: Record<InsulinMode, string> = {
  none: "modeNone",
  basal: "modeBasal",
  bolus: "modeBolus",
  both: "modeBoth",
};

/**
 * Insulin-use section, shared by Settings > Profile and the new-profile setup
 * screen so the two never drift (2.1.0 Wave 2a). Its FORMAT follows the
 * diabetes type: prediabetes/none never ask about insulin, so they collapse
 * to a single card with just the oral-medication toggle; every other type
 * gets the full 4-way insulin segment plus its own oral toggle card, since a
 * type 1/2 or gestational profile can use both insulin and pills at once.
 */
export function InsulinModeSection({
  diabetesType,
  insulinMode,
  onChangeInsulinMode,
  oralMeds,
  onChangeOralMeds,
}: {
  diabetesType: DiabetesType;
  insulinMode: InsulinMode;
  onChangeInsulinMode: (mode: InsulinMode) => void;
  oralMeds: boolean;
  onChangeOralMeds: (on: boolean) => void;
}) {
  const { t } = useTranslation();

  const oralCard = (
    <FormCard icon="medical-outline" title={t("meds.toggleLabel")}>
      <View className="px-4 py-3.5 flex-row items-center">
        <View className="flex-1 pr-3">
          <Text className="text-mut text-xs leading-4">{t("meds.toggleHint")}</Text>
        </View>
        <Switch
          value={oralMeds}
          onValueChange={onChangeOralMeds}
          {...switchColors()}
        />
      </View>
    </FormCard>
  );

  if (isNoInsulinDiabetesType(diabetesType)) return oralCard;

  return (
    <>
      <FormCard icon="layers-outline" title={t("settings.insulinMode")}>
        <View className="px-4 py-3.5">
          <Segmented
            options={(["none", "basal", "bolus", "both"] as InsulinMode[]).map((m) => ({
              value: m,
              label: t(`settings.${MODE_LABEL_KEYS[m]}`),
            }))}
            value={insulinMode}
            onChange={onChangeInsulinMode}
          />
          {/* Nudges an unset mode once the section is actually showing insulin
              controls (e.g. right after switching in from prediabetes/none),
              without ever writing a mode the user has not chosen themselves. */}
          {insulinMode === "none" ? (
            <Text className="text-mut text-xs mt-2 leading-4">
              {t("settings.chooseInsulinHint")}
            </Text>
          ) : null}
        </View>
      </FormCard>
      {oralCard}
    </>
  );
}
