import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { RADIUS, SPACE, THEME } from "../lib/theme/tokens";
import type { RatioStateCardKind } from "../lib/ratioConfirmCard";
import { Txt } from "./ui";

/**
 * The calculator's card while no figure is allowed: either "enter your ratios"
 * (none entered) or "confirm your ratios" (entered, not confirmed). It shows no
 * number; its button opens the ratios sheet.
 */
export function RatioStateCard({
  kind,
  onPress,
}: {
  kind: RatioStateCardKind;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const enter = kind === "enter";
  const title = t(enter ? "ratioConfirm.enterTitle" : "ratioConfirm.confirmTitle");
  const action = t(enter ? "ratio.enter" : "ratioConfirm.confirmAction");
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: THEME.accent,
        borderRadius: RADIUS.lg,
        backgroundColor: THEME.surface,
        padding: SPACE.lg,
        marginBottom: SPACE.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        <Ionicons
          name={enter ? "water-outline" : "checkmark-circle-outline"}
          size={20}
          color={THEME.accent}
        />
        <Txt style={{ flex: 1, fontWeight: "700" }}>{title}</Txt>
      </View>
      <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
        {t(enter ? "ratioConfirm.enterBody" : "ratioConfirm.confirmBody")}
      </Txt>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={action}
        style={{
          marginTop: SPACE.md,
          minHeight: 44,
          borderRadius: RADIUS.md,
          backgroundColor: THEME.accentFill,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: SPACE.lg,
          paddingVertical: SPACE.sm,
        }}
      >
        <Txt style={{ color: THEME.accentOnFill, fontWeight: "700", textAlign: "center" }}>
          {action}
        </Txt>
      </Pressable>
    </View>
  );
}
