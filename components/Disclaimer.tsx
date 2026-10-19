import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { RADIUS, SPACE, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";

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
        padding: compact ? SPACE.md : SPACE.lg,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: withAlpha(THEME.warning, 0.35),
        backgroundColor: withAlpha(THEME.warning, 0.08),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        <Ionicons name="medical-outline" size={18} color={THEME.warning} />
        <Txt
          kind={compact ? "caption" : "body"}
          style={{ color: THEME.warning, fontWeight: "600", flex: 1 }}
        >
          {t("disclaimer.title")}
        </Txt>
      </View>
      {/* The body is INK, not a dimmed amber: it is the text a user is being
          asked to accept, so it has to be the most readable line on the card. */}
      <Txt
        kind={compact ? "caption" : "body"}
        style={{ marginTop: compact ? SPACE.sm : SPACE.md }}
      >
        {full ? t("disclaimer.body") : t("disclaimer.short")}
      </Txt>
    </View>
  );
}
