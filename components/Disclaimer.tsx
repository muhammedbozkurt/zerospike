import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { RADIUS, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";

/**
 * Permanent, visible medical disclaimer banner (Settings + onboarding).
 *
 * The hue is THEME.warning, not a raw amber: this is the one "read this"
 * surface in the app and it has to come from the same token as every other
 * caution, so it can never drift into an alarm red.
 */
export function DisclaimerBanner({
  full = false,
  compact = false,
}: {
  full?: boolean;
  /** Tighter padding and type for a card that shares a screen (the reveal);
   *  the words are the same as the full banner's. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={{
        padding: compact ? 14 : 20,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: withAlpha(THEME.warning, 0.35),
        backgroundColor: withAlpha(THEME.warning, 0.08),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="medical-outline" size={18} color={THEME.warning} />
        <Text
          style={{
            color: THEME.warning,
            fontSize: compact ? 14 : 16,
            lineHeight: compact ? 20 : 22,
            fontWeight: "600",
            flex: 1,
          }}
        >
          {t("disclaimer.title")}
        </Text>
      </View>
      {/* The body is INK, not a dimmed amber: it is the text a user is being
          asked to accept, so it has to be the most readable line on the card. */}
      <Text
        style={{
          color: THEME.text,
          fontSize: compact ? 13 : 15,
          lineHeight: compact ? 19 : 22,
          marginTop: compact ? 8 : 10,
        }}
      >
        {full ? t("disclaimer.body") : t("disclaimer.short")}
      </Text>
    </View>
  );
}
