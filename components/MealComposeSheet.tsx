import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import {
  composeCanSave,
  composeItemCarbs,
  composeTotals,
  parseGramsInput,
  removeComposeItem,
  setComposePortion,
  type ComposeItem,
} from "../lib/mealCompose";
import { num } from "../lib/format";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { HIT_TARGET, INPUT_TEXT, TABULAR, THEME } from "../lib/theme/tokens";
import { upper } from "../lib/upper";
import { FoodPlate } from "./FoodPlate";
import { PortionPresetChips } from "./PortionPresetChips";
import { GradientCTA } from "./rich";

function ComposeRow({
  item,
  onPortion,
  onRemove,
}: {
  item: ComposeItem;
  onPortion: (grams: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(String(item.portion_g));

  useEffect(() => {
    if (parseGramsInput(text) !== item.portion_g) setText(String(item.portion_g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.portion_g]);

  return (
    <View className="rounded-2xl bg-glass border border-hair px-3 py-2.5 mb-2">
      <View className="flex-row items-center">
        <FoodPlate category={item.category} size={32} radius={12} style={{ marginRight: 10 }} />
        <Text
          style={{ color: THEME.text, fontSize: 13, fontWeight: "700", flex: 1, paddingRight: 8 }}
        >
          {item.name}
        </Text>
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${t("mealCompose.remove")}: ${item.name}`}
          style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="close-circle" size={20} color={THEME.textMuted} />
        </Pressable>
      </View>

      <View className="flex-row items-center" style={{ marginTop: 8, columnGap: 10 }}>
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            onPortion(parseGramsInput(next));
          }}
          keyboardType="decimal-pad"
          selectTextOnFocus
          maxLength={7}
          accessibilityLabel={`${t("mealCompose.amount")}: ${item.name}`}
          style={[
            INPUT_TEXT,
            TABULAR,
            {
              minWidth: 64,
              minHeight: 40,
              textAlign: "center",
              color: THEME.text,
              fontSize: 15,
              fontWeight: "700",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: THEME.border,
              backgroundColor: THEME.surface,
              paddingHorizontal: 8,
            },
          ]}
        />
        <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("common.grams")}</Text>
        <Text
          style={[
            TABULAR,
            { color: THEME.text, fontSize: 13, fontWeight: "800", marginLeft: "auto" },
          ]}
        >
          {num(composeItemCarbs(item))}
          <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: "600" }}>
            {t("common.grams")}
          </Text>
        </Text>
      </View>

      <PortionPresetChips
        foodId={item.food_id}
        value={item.portion_g}
        onPick={onPortion}
        autoSelect
        style={{ marginTop: 8 }}
      />
    </View>
  );
}

/**
 * The "Meal" sheet: several foods picked from the food list, each with its own
 * amount, and ONE carbohydrate total underneath. Presentational: the caller
 * writes the meal (food.tsx) so the post-save effects stay in one place.
 * Same absolute-overlay presentation as food.tsx's TemplateConfirmSheet.
 */
export function MealComposeSheet({
  items,
  onChange,
  saving,
  templateNameTaken,
  onClose,
  onSave,
  onSaveTemplate,
  onEstimate,
}: {
  items: ComposeItem[];
  onChange: (items: ComposeItem[]) => void;
  saving: boolean;
  /** Whether a template already carries this name (checked by the caller). */
  templateNameTaken: (name: string) => boolean;
  onClose: () => void;
  onSave: () => void;
  onSaveTemplate: (name: string) => void;
  /** Opens the text estimate; the button shows only when the caller offers it. */
  onEstimate?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const [namingTemplate, setNamingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const totals = composeTotals(items);
  const canSave = composeCanSave(items) && !saving;
  const trimmedName = templateName.trim();
  const nameTaken = trimmedName.length > 0 && templateNameTaken(trimmedName);
  const canSaveTemplate = canSave && trimmedName.length > 0 && !nameTaken;

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 200 }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      onAccessibilityEscape={onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.7)" }]} // theme-ok
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />
      </Animated.View>
      <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
        <Animated.View
          style={{
            maxHeight: "92%",
            transform: [
              {
                translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }),
              },
            ],
          }}
        >
          <Pressable
            className="rounded-t-3xl border-t border-x border-hair px-4 pt-3"
            style={{ backgroundColor: THEME.bg.g1, paddingBottom: insets.bottom + 20 }}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <View className="items-center mb-2">
              <View className="w-10 h-1 rounded-full bg-hair" />
            </View>

            <Text
              accessibilityRole="header"
              style={{ color: THEME.text, fontSize: 17, fontWeight: "800", marginBottom: 12 }}
            >
              {t("mealCompose.title")}
            </Text>

            {items.length === 0 ? (
              <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5 mb-3">
                <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
                  {t("mealCompose.empty")}
                </Text>
              </View>
            ) : (
              <ScrollView
                {...keyboardAwareScrollProps}
                style={{ flexShrink: 1 }}
                showsVerticalScrollIndicator={false}
              >
                {items.map((item) => (
                  <ComposeRow
                    key={item.key}
                    item={item}
                    onPortion={(grams) => onChange(setComposePortion(items, item.key, grams))}
                    onRemove={() => onChange(removeComposeItem(items, item.key))}
                  />
                ))}
              </ScrollView>
            )}

            {onEstimate ? (
              <Pressable
                onPress={onEstimate}
                accessibilityRole="button"
                accessibilityLabel={t("carbEstimate.entryButton")}
                className="flex-row items-center self-start rounded-full border border-hair mt-1"
                style={{ minHeight: 36, paddingHorizontal: 12, columnGap: 6, maxWidth: "100%" }}
              >
                <Ionicons name="sparkles-outline" size={16} color={THEME.accent} />
                <Text style={{ color: THEME.accent, fontSize: 13, fontWeight: "700", flexShrink: 1 }}>
                  {t("carbEstimate.entryButton")}
                </Text>
              </Pressable>
            ) : null}

            <View
              className="flex-row items-center justify-between rounded-2xl bg-glass border border-hair px-3.5 py-3 mb-3 mt-1"
              accessible
              accessibilityLabel={`${t("mealCompose.total")}: ${num(totals.carbs_g)} ${t("common.grams")}`}
            >
              <Text
                className="text-xs font-semibold tracking-wider text-mut"
                style={{ flexShrink: 1, paddingRight: 8 }}
              >
                {upper(t("mealCompose.total"))}
              </Text>
              <Text style={[TABULAR, { color: THEME.accent, fontSize: 20, fontWeight: "800" }]}>
                {num(totals.carbs_g)}
                <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "600" }}>
                  {t("common.grams")}
                </Text>
              </Text>
            </View>

            {namingTemplate ? (
              <View style={{ marginBottom: 12 }}>
                <TextInput
                  value={templateName}
                  onChangeText={setTemplateName}
                  placeholder={t("mealCompose.templateName")}
                  placeholderTextColor={THEME.textMuted}
                  maxLength={60}
                  returnKeyType="done"
                  accessibilityLabel={t("mealCompose.templateName")}
                  style={[
                    INPUT_TEXT,
                    {
                      minHeight: HIT_TARGET,
                      color: THEME.text,
                      fontSize: 14,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      backgroundColor: THEME.surface,
                      paddingHorizontal: 14,
                    },
                  ]}
                />
                {nameTaken ? (
                  <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 6 }}>
                    {t("mealCompose.templateNameTaken")}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => canSaveTemplate && onSaveTemplate(trimmedName)}
                  disabled={!canSaveTemplate}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSaveTemplate }}
                  accessibilityLabel={t("mealCompose.saveTemplate")}
                  className="items-center justify-center rounded-2xl border border-hair"
                  style={{ minHeight: HIT_TARGET, marginTop: 8, opacity: canSaveTemplate ? 1 : 0.5 }}
                >
                  <Text style={{ color: THEME.accent, fontSize: 14, fontWeight: "700" }}>
                    {t("mealCompose.saveTemplate")}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setNamingTemplate(true)}
                disabled={!canSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave }}
                accessibilityLabel={t("mealCompose.saveTemplate")}
                className="items-center justify-center rounded-2xl border border-hair mb-3"
                style={{ minHeight: HIT_TARGET, opacity: canSave ? 1 : 0.5 }}
              >
                <Text
                  style={{ color: THEME.accent, fontSize: 14, fontWeight: "700", textAlign: "center" }}
                >
                  {t("mealCompose.saveTemplate")}
                </Text>
              </Pressable>
            )}

            <GradientCTA label={t("mealCompose.save")} disabled={!canSave} onPress={onSave} />
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
