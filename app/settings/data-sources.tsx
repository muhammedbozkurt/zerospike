import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Row, SettingsScaffold } from "../../components/settingsUi";
import { Txt } from "../../components/ui";
import { logCrash, logEvent } from "../../lib/analytics";
import { healthStoreLabelKey } from "../../lib/cgm/sourceLabel";
import { subscribeCgmChanges } from "../../lib/cgm/importEvents";
import {
  getCgmMode,
  isCgmModeActive,
  setCgmMode,
  type CgmMode,
} from "../../lib/cgm/state";
import { cgmDetected, countCgmReadingsLast24h } from "../../lib/db/cgmSql";
import { hasHealthProvider } from "../../lib/services/health";
import { useApp } from "../../lib/store/AppContext";
import { RADIUS, SPACE, THEME } from "../../lib/theme/tokens";
import { hapticSelect } from "../../lib/haptics";
import { useFeedback } from "../../components/Feedback";

interface ModeOption {
  mode: CgmMode;
  label: string;
  hint: string;
}

function ModeCard({
  option,
  selected,
  onPress,
}: {
  option: ModeOption;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={option.label}
      accessibilityHint={option.hint}
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: SPACE.md,
        marginBottom: SPACE.sm,
        borderRadius: RADIUS.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? THEME.accent : THEME.border,
        backgroundColor: THEME.surface,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt kind="body" style={{ fontWeight: "600" }}>
          {option.label}
        </Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: 2 }}>
          {option.hint}
        </Txt>
      </View>
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={22}
        color={selected ? THEME.accent : THEME.textMuted}
        style={{ marginStart: SPACE.md }}
      />
    </Pressable>
  );
}

export default function DataSourcesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast } = useFeedback();
  const { activeProfile } = useApp();
  const profileId = activeProfile?.id;

  const [mode, setMode] = useState<CgmMode>("manual");
  const [detected, setDetected] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!profileId) return;
    setMode(await getCgmMode(profileId));
    try {
      setDetected(cgmDetected(await countCgmReadingsLast24h(profileId)));
    } catch (err) {
      logCrash(err, { screen: "dataSources", op: "count" });
      setDetected(null);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
    return subscribeCgmChanges((change) => {
      if (change.profileId === profileId) void refresh();
    });
  }, [profileId, refresh]);

  const store = t(healthStoreLabelKey(Platform.OS));
  const options: ModeOption[] = [
    { mode: "manual", label: t("dataSources.modeManual"), hint: t("dataSources.modeManualHint") },
    ...(hasHealthProvider()
      ? [
          {
            mode: "cgm" as const,
            label: t("dataSources.modeCgm", { store }),
            hint: t("dataSources.modeCgmHint", { store }),
          },
        ]
      : []),
  ];

  async function choose(next: CgmMode) {
    if (!profileId || next === mode) return;
    hapticSelect();
    try {
      await setCgmMode(profileId, next);
      setMode(next);
      logEvent("cgm_mode_set", { mode: next });
    } catch (err) {
      logCrash(err, { screen: "dataSources", op: "setMode" });
      toast(t("common.saveFailed"), "error");
    }
  }

  return (
    <SettingsScaffold title={t("dataSources.title")}>
      <Txt kind="body" tone="muted" style={{ marginBottom: SPACE.md }}>
        {t("dataSources.intro")}
      </Txt>

      <View accessibilityRole="radiogroup">
        {options.map((option) => (
          <ModeCard
            key={option.mode}
            option={option}
            selected={mode === option.mode}
            onPress={() => void choose(option.mode)}
          />
        ))}
      </View>

      {isCgmModeActive(mode) ? (
        <View style={{ marginTop: SPACE.sm, marginBottom: SPACE.md }}>
          {detected != null ? (
            <Txt kind="body" style={{ fontWeight: "600", marginBottom: SPACE.xs }}>
              {t(detected ? "dataSources.stateActive" : "dataSources.stateInactive")}
            </Txt>
          ) : null}
          <Txt kind="caption" tone="muted">
            {t("dataSources.needsHealth", { store })}
          </Txt>
          <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
            {t("cgmSource.delayNote")}
          </Txt>
          <View style={{ marginTop: SPACE.md }}>
            <Row
              icon="settings-outline"
              label={t("dataSources.openData")}
              onPress={() => router.push("/settings/data")}
            />
          </View>
        </View>
      ) : null}

      <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
        {t("dataSources.keepsData")}
      </Txt>
    </SettingsScaffold>
  );
}
