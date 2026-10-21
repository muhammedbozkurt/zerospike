import React, { useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SheetShell } from "./SheetShell";
import { Button } from "./ui";
import { RADIUS, THEME } from "../lib/theme/tokens";
import { clearLastFatalReports } from "../lib/fatalCapture";
import { formatReportText, type FatalReport } from "../lib/fatalReport";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * Settings > About > Last error report. Shows what the device kept of the last
 * fatal error (nothing leaves the device from here). "Copy or share" opens the
 * system share sheet, which has Copy on both platforms, so no clipboard module
 * is needed.
 */
export function FatalReportSheet({
  visible,
  report,
  onClose,
  onCleared,
}: {
  visible: boolean;
  report: FatalReport | null;
  onClose: () => void;
  onCleared: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const text = report ? formatReportText(report) : "";

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await clearLastFatalReports();
    } finally {
      setBusy(false);
    }
    onCleared();
    onClose();
  }

  function share() {
    Share.share({ message: text }).catch(() => {});
  }

  const footer = report ? (
    <View style={{ gap: 4 }}>
      <Button label={t("fatalReport.share")} onPress={share} />
      <Button label={t("fatalReport.clear")} variant="ghost" onPress={clear} loading={busy} />
    </View>
  ) : (
    <Button label={t("common.close")} onPress={onClose} />
  );

  return (
    <SheetShell
      scrollHintId="fatal-report"
      visible={visible}
      onClose={onClose}
      title={t("fatalReport.row")}
      closeLabel={t("common.close")}
      maxHeightRatio={0.92}
      footer={footer}
    >
      <View style={{ gap: 12, paddingTop: 4, paddingBottom: 8 }}>
        {report ? (
          <>
            <Text style={{ color: THEME.textMuted, fontSize: 13 }}>{t("fatalReport.intro")}</Text>
            <View
              style={{
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
                padding: 12,
              }}
            >
              <Text
                selectable
                style={{ color: THEME.text, fontSize: 12, lineHeight: 17, fontFamily: MONO, textAlign: "left" }}
              >
                {text}
              </Text>
            </View>
          </>
        ) : (
          <Text style={{ color: THEME.textMuted, fontSize: 15, paddingVertical: 16, textAlign: "center" }}>
            {t("fatalReport.empty")}
          </Text>
        )}
      </View>
    </SheetShell>
  );
}
