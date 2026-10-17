import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import {
  OTHER_PRODUCT_ID,
  insulinProductById,
  productsByCategory,
} from "../lib/insulinCatalog";
import { ELEVATION, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { hapticSelect } from "../lib/haptics";
import { num } from "../lib/format";
import { useLayout } from "../lib/useLayout";

/** Cap for a centered, content-sized dialog card on a tablet (does not
 *  stretch edge to edge like a bottom sheet). */
const DIALOG_MAX_WIDTH = 520;

interface InsulinProductPickerProps {
  /** Modal header AND trigger accessibility label (the surrounding card
   *  usually already shows its own title, so the trigger itself stays
   *  unlabelled on screen). */
  label: string;
  /** A catalog product id, OTHER_PRODUCT_ID, or null (nothing picked). */
  value: string | null;
  /** Free-text name, only read/shown while value is OTHER_PRODUCT_ID. */
  otherValue?: string | null;
  onChange: (id: string | null) => void;
  onOtherChange?: (text: string | null) => void;
  /** Which single catalog category this picker lists: basal-only, bolus-only,
   *  or the premix row. Never mixed - P9 split each slot into its own list, so
   *  a bolus product can no longer render under a "Karisim" heading. */
  slot: "basal" | "bolus" | "mix";
  /** Shows a "Secilmedi" row the user can pick to clear back to null. Off by
   *  default: once a value is set, going back to "unset" is not a real choice
   *  (only onboarding/profile-migration state produces null, never a tap), so
   *  the row is only offered where clearing to null is legitimate (the
   *  per-entry pickers in injection.tsx / InjectionEditSheet.tsx). */
  allowNotSet?: boolean;
  notSetLabel?: string;
  hint?: string;
  /** Trigger-row size. "lg" is the onboarding step, where this row is one of
   *  only two things on the page; every other screen keeps the compact "md"
   *  row that sits in a settings list. Presentational only. */
  size?: "md" | "lg";
}

/**
 * Single-choice picker over the insulin product catalog. Same trigger-row +
 * modal-list shape as LanguagePicker, since a bottom-sheet library is not
 * part of this project. Shared by onboarding, Settings > Profile and the
 * injection log/edit screens so the four never drift into copies.
 */
export function InsulinProductPicker({
  label,
  value,
  otherValue,
  onChange,
  onOtherChange,
  slot,
  allowNotSet = false,
  notSetLabel,
  hint,
  size = "md",
}: InsulinProductPickerProps) {
  const { t } = useTranslation();
  const { isWide } = useLayout();
  const [open, setOpen] = useState(false);

  // Homogeneous, single-category list - no group headers, no cross-category
  // leakage. A premix profile's OTHER slot still carries the mix id (see
  // isMixSelection in lib/insulinCatalog.ts), so `value` can legitimately
  // point at a product not in this list; the trigger below resolves it via
  // insulinProductById directly rather than searching `products`.
  const products = productsByCategory(slot);

  const selectedProduct = insulinProductById(value);
  const isOther = value === OTHER_PRODUCT_ID;
  const fallbackNotSet = notSetLabel ?? t("settings.insulinProductNotSet");

  const displayText = isOther
    ? otherValue && otherValue.trim()
      ? otherValue
      : t("insulinPicker.other")
    : selectedProduct
      ? selectedProduct.label
      : fallbackNotSet;

  function select(id: string | null) {
    hapticSelect();
    onChange(id);
    setOpen(false);
  }

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: displayText }}
        className="flex-row items-center justify-between rounded-2xl border border-hair bg-glass"
        style={{
          minHeight: size === "lg" ? 56 : 44,
          paddingHorizontal: size === "lg" ? 18 : 14,
        }}
      >
        <Text
          className="flex-1 font-medium text-ink mr-2"
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: size === "lg" ? 16 : 15 }}
        >
          {displayText}
        </Text>
        <Ionicons name="chevron-down" size={16} color={THEME.textMuted} />
      </Pressable>

      {selectedProduct && !isOther ? (
        <Text className="text-mut text-xs mt-2 leading-4">
          {t("settings.insulinDurationLabel")}
          {": ~"}
          {t("settings.hours", { n: num(selectedProduct.durationHours) })}
        </Text>
      ) : null}
      {hint ? <Text className="text-mut text-xs mt-2 leading-4">{hint}</Text> : null}

      {isOther && onOtherChange ? (
        <View style={{ marginTop: 10 }}>
          <InsulinOtherField value={otherValue ?? null} onChange={onOtherChange} label={label} />
        </View>
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/70 justify-center px-6"
          onPress={() => setOpen(false)}
          onAccessibilityEscape={() => setOpen(false)}
          accessible={false}
          focusable={false}
        >
          <Pressable
            className="rounded-3xl border border-hair p-4"
            style={[
              {
                maxHeight: "80%",
                backgroundColor: THEME.surfaceRaised,
                ...ELEVATION.sheet,
              },
              isWide ? { maxWidth: DIALOG_MAX_WIDTH, alignSelf: "center" } : undefined,
            ]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <Text className="text-ink text-lg font-bold mb-3 px-1" numberOfLines={1}>
              {label}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {allowNotSet ? (
                <ProductRow
                  label={fallbackNotSet}
                  active={value === null}
                  onPress={() => select(null)}
                />
              ) : null}
              {products.map((p) => (
                <ProductRow
                  key={p.id}
                  label={p.label}
                  active={p.id === value}
                  onPress={() => select(p.id)}
                />
              ))}
              <ProductRow
                label={t("insulinPicker.other")}
                active={isOther}
                onPress={() => select(OTHER_PRODUCT_ID)}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Free-text product name, shown only while a picker's value is
 *  OTHER_PRODUCT_ID. One shared field so onboarding, Settings and the
 *  injection screens never grow three copies of the same input. */
export function InsulinOtherField({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (text: string | null) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const isEmpty = !value || !value.trim();
  return (
    <View>
      <TextInput
        value={value ?? ""}
        onChangeText={(text) => onChange(text.length > 0 ? text : null)}
        placeholder={t("insulinPicker.otherPlaceholder")}
        placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
        maxLength={40}
        returnKeyType="done"
        accessibilityLabel={label ?? t("insulinPicker.otherPlaceholder")}
        className="rounded-2xl border border-hair bg-glass px-3.5 text-ink"
        style={{ minHeight: 44, fontSize: 15 }}
      />
      {isEmpty ? (
        <Text className="text-mut text-xs mt-1.5 leading-4">
          {t("insulinPicker.otherEmpty")}
        </Text>
      ) : null}
    </View>
  );
}

function ProductRow({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`flex-row items-center rounded-2xl px-3 mb-1.5 border ${
        active ? "bg-brand/10 border-brand/40" : "bg-glass border-transparent"
      }`}
      style={{ minHeight: 44 }}
    >
      <Text
        className={`flex-1 font-medium ${active ? "text-brand" : "text-ink"}`}
        numberOfLines={2}
      >
        {label}
      </Text>
      {active ? (
        <Ionicons name="checkmark-circle" size={20} color={THEME.accent} />
      ) : null}
    </Pressable>
  );
}
