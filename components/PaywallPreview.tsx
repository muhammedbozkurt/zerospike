import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { GlassCard } from "./rich/GlassCard";
import { TIRDonut, tirSegments } from "./rich";
import { THEME } from "../lib/theme/tokens";
import { pctParts } from "../lib/format";
import { upper } from "../lib/upper";

const SAMPLE = { low: 4, target: 72, high: 20, veryHigh: 4 };

/** Static sample of what Pro produces: fixed numbers, never the user's data. */
export function PaywallPreview({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const parts = pctParts(SAMPLE.target);
  return (
    <GlassCard
      style={{ paddingVertical: compact ? 12 : 14, marginBottom: 12 }}
    >
      <View
        pointerEvents="none"
        accessible
        accessibilityLabel={`${t("paywall.previewLabel")}. ${t("insights.inRange")}. ${t("paywall.featureShortPdf")}`}
      >
        <Text style={{ color: THEME.textMuted, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }}>
          {upper(t("paywall.previewLabel"))}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
          <TIRDonut
            segments={tirSegments(SAMPLE)}
            centerValue={parts.number}
            centerSuffix={parts.sign}
            centerSuffixFirst={parts.signFirst}
            size={96}
          />
          <View style={{ flex: 1, marginStart: 16 }}>
            <Text style={{ color: THEME.text, fontSize: 13, fontWeight: "700" }}>
              {t("insights.inRange")}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
              <Ionicons name="document-text-outline" size={16} color={THEME.accent} />
              <Text style={{ color: THEME.textMuted, fontSize: 12, flex: 1, marginStart: 8 }}>
                {t("paywall.featureShortPdf")}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </GlassCard>
  );
}
