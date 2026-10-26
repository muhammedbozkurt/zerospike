import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Row, SettingsScaffold } from "../../components/settingsUi";
import { finishDexcomConnect, type ConnectFailure } from "../../lib/dexcom/connect";
import { dexcomRowVisible } from "../../lib/dexcom/config";
import { THEME } from "../../lib/theme/tokens";

type Phase = "working" | "done" | ConnectFailure;

/**
 * zerospike://oauth/dexcom?code&state (site sayfasi https://greeneyeapp.com/zerospike/oauth/dexcom
 * adresinden yonlendirir). Bayrak kapaliyken hicbir sey yapmaz, ana ekrana doner.
 * TODO(acilis): ozel sema baska bir uygulamaca ele gecirilebilir; bayrak acilmadan
 * once Universal Link / App Link zorunlu (scratchpad/g250-cgm-f/acilis-kosullari.md).
 */
export default function DexcomCallback() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const enabled = dexcomRowVisible();
  const [phase, setPhase] = useState<Phase>("working");
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    finishDexcomConnect(params).then((r) => setPhase(r.ok ? "done" : r.reason));
  }, [enabled, params]);

  if (!enabled) return <Redirect href="/" />;

  const message =
    phase === "working"
      ? t("dexcom.connecting")
      : phase === "done"
        ? t("dexcom.connected")
        : phase === "denied"
          ? t("dexcom.denied")
          : phase === "state_invalid"
            ? t("dexcom.stateInvalid")
            : t("dexcom.failed");

  return (
    <SettingsScaffold title={t("dexcom.title")}>
      <View className="items-center py-6">
        {phase === "working" ? <ActivityIndicator color={THEME.accent} /> : null}
        <Text accessibilityLiveRegion="polite" className="text-ink text-sm leading-5 mt-3 text-center">
          {message}
        </Text>
      </View>
      {phase !== "working" ? (
        <Row icon="arrow-back-outline" label={t("dexcom.back")} onPress={() => router.replace("/settings/data")} />
      ) : null}
    </SettingsScaffold>
  );
}
