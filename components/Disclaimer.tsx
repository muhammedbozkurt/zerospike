import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { RADIUS, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";

/**
 * Permanent, visible medical disclaimer banner (Settings + onboarding).
 *
 * The hue is THEME.caution, not a raw amber: this is the one "read this"
 * surface in the app and it has to come from the same token as every other
 * caution, so it can never drift into an alarm red.
 */
export function DisclaimerBanner({ full = false }: { full?: boolean }) {
  const { t } = useTranslation();
  return (
    <View
      style={{
        padding: 20,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: withAlpha(THEME.caution, 0.35),
        backgroundColor: withAlpha(THEME.caution, 0.08),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="medical-outline" size={18} color={THEME.caution} />
        <Text
          style={{
            color: THEME.caution,
            fontSize: 16,
            lineHeight: 22,
            fontWeight: "600",
            flex: 1,
          }}
        >
          {t("disclaimer.title")}
        </Text>
      </View>
      {/* The body is INK, not a dimmed amber: it is the text a user is being
          asked to accept, so it has to be the most readable line on the card. */}
      <Text style={{ color: THEME.ink, fontSize: 15, lineHeight: 22, marginTop: 10 }}>
        {full ? t("disclaimer.body") : t("disclaimer.short")}
      </Text>
    </View>
  );
}
