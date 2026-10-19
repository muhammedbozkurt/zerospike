import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { GlassCard, IconTile } from "./rich";
import { THEME } from "../lib/theme/tokens";
import { Button } from "./ui";
import { useStoreStatus } from "../lib/services/purchases";

/**
 * Shown only while the last store read failed (see purchases.ts storeStatus):
 * says plainly that the subscription could not be checked, that Pro access stays
 * as last known, and puts "Restore purchases" in reach as a real button. The
 * plain restore link stays where it always was; this is the louder version for
 * the moment it matters. Text wraps freely, so the longest translation never clips.
 */
export function StoreStatusNotice({
  onRestore,
  busy = false,
}: {
  onRestore: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const status = useStoreStatus();
  if (status !== "error") return null;
  return (
    <GlassCard style={{ marginBottom: 12 }}>
      <View className="flex-row items-start" style={{ gap: 10 }}>
        <IconTile icon="cloud-offline-outline" size={32} radius={10} tint={THEME.textMuted} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: THEME.text, fontSize: 13, fontWeight: "800", lineHeight: 18 }}>
            {t("trial.storeErrorTitle")}
          </Text>
          <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 }}>
            {t("trial.storeErrorBody")}
          </Text>
        </View>
      </View>
      <Button
        variant="outlined"
        size="sm"
        onPress={onRestore}
        disabled={busy}
        label={t("settings.restorePurchases")}
        className="mt-2.5"
      />
    </GlassCard>
  );
}
