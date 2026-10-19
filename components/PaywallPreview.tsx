import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { Card, Txt } from "./ui";
import { TIRDonut, tirSegments } from "./rich";
import { SPACE, THEME } from "../lib/theme/tokens";
import { pctParts } from "../lib/format";
import { upper } from "../lib/upper";

const SAMPLE = { low: 4, target: 72, high: 20, veryHigh: 4 };

/** Static sample of what Pro produces: fixed numbers, never the user's data. */
export function PaywallPreview({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const parts = pctParts(SAMPLE.target);
  return (
    <Card style={{ paddingVertical: compact ? SPACE.md : SPACE.lg, marginBottom: SPACE.md }}>
      <View
        pointerEvents="none"
        accessible
        accessibilityLabel={`${t("paywall.previewLabel")}. ${t("insights.inRange")}. ${t("paywall.featureShortPdf")}`}
      >
        <Txt kind="micro" tone="muted" style={{ letterSpacing: 1.2 }}>
          {upper(t("paywall.previewLabel"))}
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: SPACE.sm }}>
          <TIRDonut
            segments={tirSegments(SAMPLE)}
            centerValue={parts.number}
            centerSuffix={parts.sign}
            centerSuffixFirst={parts.signFirst}
            size={96}
          />
          <View style={{ flex: 1, marginStart: SPACE.lg }}>
            <Txt kind="caption" style={{ fontWeight: "700" }}>
              {t("insights.inRange")}
            </Txt>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: SPACE.md }}>
              <Ionicons name="document-text-outline" size={16} color={THEME.accent} />
              <Txt kind="caption" tone="muted" style={{ flex: 1, marginStart: SPACE.sm }}>
                {t("paywall.featureShortPdf")}
              </Txt>
            </View>
          </View>
        </View>
      </View>
    </Card>
  );
}
