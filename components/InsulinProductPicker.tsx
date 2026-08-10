import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { InsulinProduct } from "../lib/insulinCatalog";
import { THEME } from "../lib/theme/tokens";
import { hapticSelect } from "../lib/haptics";
import { num } from "../lib/format";

/**
 * Single-choice picker over the insulin product catalog (11 items, too many for
 * Segmented). Same trigger-row + modal-list shape as LanguagePicker, since a
 * bottom-sheet library is not part of this project. Shared by the basal and
 * bolus cards in Settings > Profile so the two never drift into copies.
 */
export function InsulinProductPicker({
  title,
  value,
  products,
  onChange,
  notSetLabel,
  durationLabel,
}: {
  /** Modal header AND trigger accessibility label (the surrounding FormCard
   *  already shows its own title, so the trigger itself stays unlabelled). */
  title: string;
  value: string | null;
  products: readonly InsulinProduct[];
  onChange: (id: string | null) => void;
  notSetLabel: string;
  durationLabel: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value) ?? null;

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
        accessibilityLabel={title}
        accessibilityValue={{ text: selected ? selected.label : notSetLabel }}
        className="flex-row items-center justify-between rounded-2xl border border-hair bg-glass px-3.5"
        style={{ minHeight: 44 }}
      >
        <Text
          className="flex-1 text-[15px] font-medium text-ink mr-2"
          numberOfLines={2}
        >
          {selected ? selected.label : notSetLabel}
        </Text>
        <Ionicons name="chevron-down" size={16} color={THEME.muted} />
      </Pressable>

      {selected ? (
        <Text className="text-mut text-xs mt-2 leading-4">
          {durationLabel}
          {": ~"}
          {t("settings.hours", { n: num(selected.durationHours) })}
        </Text>
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
        >
          <Pressable
            className="rounded-3xl border border-hair p-4"
            style={{
              maxHeight: "80%",
              backgroundColor: THEME.sheet,
              shadowColor: "#000",
              shadowOpacity: 0.5,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 12 },
              elevation: 16,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-ink text-lg font-bold mb-3 px-1">
              {title}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              <ProductRow
                label={notSetLabel}
                active={value === null}
                onPress={() => select(null)}
              />
              {products.map((p) => (
                <ProductRow
                  key={p.id}
                  label={p.label}
                  active={p.id === value}
                  onPress={() => select(p.id)}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
