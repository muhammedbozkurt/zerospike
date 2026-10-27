import React, { useState } from "react";
import { AccessibilityInfo, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { Txt } from "./ui";
import { CGM_BRANDS, cgmBrandMessageKeys, type CgmBrand } from "../lib/cgm/brand";
import { hapticSelect } from "../lib/haptics";
import { RADIUS, SPACE, THEME } from "../lib/theme/tokens";

/**
 * "Which sensor do you use?" and the honest note for the answer. Shared by
 * Settings > Data sources and onboarding. The question is open while nothing is
 * chosen; with a choice it collapses to one line plus the note.
 */
export function CgmBrandNote({
  brand,
  onChange,
  store,
  nightscout,
}: {
  brand: CgmBrand | null;
  onChange: (next: CgmBrand) => void;
  store: string;
  nightscout: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const open = brand == null || editing;

  return (
    <View style={{ marginTop: SPACE.md }}>
      {open ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t("cgmBrand.question")}>
          <Txt kind="body" style={{ fontWeight: "600", marginBottom: SPACE.sm }}>
            {t("cgmBrand.question")}
          </Txt>
          {CGM_BRANDS.map((b) => {
            const selected = brand === b;
            return (
              <Pressable
                key={b}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`cgmBrand.${b}`)}
                onPress={() => {
                  hapticSelect();
                  setEditing(false);
                  if (b !== brand) {
                    onChange(b);
                    if (Platform.OS === "ios") {
                      AccessibilityInfo.announceForAccessibility(
                        cgmBrandMessageKeys(b, nightscout)
                          .map((key) => t(key, { store }))
                          .join(" ")
                      );
                    }
                  }
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 44,
                  paddingHorizontal: SPACE.md,
                  marginBottom: SPACE.xs,
                  borderRadius: RADIUS.lg,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? THEME.accent : THEME.border,
                  backgroundColor: THEME.surface,
                }}
              >
                <Txt kind="body" style={{ flex: 1, minWidth: 0 }}>
                  {t(`cgmBrand.${b}`)}
                </Txt>
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={22}
                  color={selected ? THEME.accent : THEME.textMuted}
                  style={{ marginStart: SPACE.md }}
                />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Txt kind="body" style={{ flex: 1, minWidth: 0, fontWeight: "600" }}>
            {t("cgmBrand.current", { brand: t(`cgmBrand.${brand}`) })}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("cgmBrand.change")}: ${t(`cgmBrand.${brand}`)}`}
            onPress={() => setEditing(true)}
            hitSlop={8}
            style={{ minHeight: 44, justifyContent: "center", marginStart: SPACE.md }}
          >
            <Txt kind="body" tone="accent" style={{ fontWeight: "600" }}>
              {t("cgmBrand.change")}
            </Txt>
          </Pressable>
        </View>
      )}
      <View accessibilityLiveRegion="polite">
        {brand != null && !open
          ? cgmBrandMessageKeys(brand, nightscout).map((key) => (
              <Txt key={key} kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
                {t(key, { store })}
              </Txt>
            ))
          : null}
      </View>
    </View>
  );
}
