import React, { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Row, SettingsScaffold } from "../../components/settingsUi";
import { Button, Field, Txt } from "../../components/ui";
import { logCrash, logEvent } from "../../lib/analytics";
import { healthStoreLabelKey } from "../../lib/cgm/sourceLabel";
import { subscribeCgmChanges } from "../../lib/cgm/importEvents";
import { nightscoutAllowed } from "../../lib/cgm/pro";
import {
  getCgmMode,
  isCgmModeActive,
  setCgmMode,
  type CgmMode,
} from "../../lib/cgm/state";
import { cgmDetected, countCgmReadingsLast24h } from "../../lib/db/cgmSql";
import { nightscoutAvailable as nightscoutEnabled } from "../../lib/cgm/sourceAvailability";
import { formatDate, formatTime, num } from "../../lib/format";
import { statusKey, testDetailKey } from "../../lib/nightscout/messages";
import { countNightscoutReadings } from "../../lib/nightscout/localData";
import { safeNightscoutError } from "../../lib/nightscout/safeError";
import type { NsState, NsTestDetail } from "../../lib/nightscout/sync";
import { parseNightscoutUrl } from "../../lib/nightscout/url";
import { hasHealthProvider } from "../../lib/services/health";
import { registerHealthBackground } from "../../lib/services/healthBackground";
import {
  connectNightscoutFor,
  disconnectNightscoutFor,
  getNightscoutState,
  nightscoutAvailable,
  syncNightscoutForeground,
  testNightscout,
} from "../../lib/services/sourceSync";
import { useApp } from "../../lib/store/AppContext";
import { RADIUS, SPACE, THEME } from "../../lib/theme/tokens";
import { hapticSelect, hapticWarning } from "../../lib/haptics";
import { useFeedback } from "../../components/Feedback";

interface ModeOption {
  mode: CgmMode;
  label: string;
  hint: string;
  badge?: string;
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
      accessibilityLabel={option.badge ? `${option.label}, ${option.badge}` : option.label}
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
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
          <Txt kind="body" style={{ fontWeight: "600" }}>
            {option.label}
          </Txt>
          {option.badge ? (
            <Txt kind="caption" tone="accent" style={{ marginStart: SPACE.sm, fontWeight: "600" }}>
              {option.badge}
            </Txt>
          ) : null}
        </View>
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

type NsBusy = "test" | "connect" | "sync" | null;

/** The Nightscout connection: a form while unconnected, a status card once connected. */
function NightscoutPanel({
  profileId,
  connected,
  isPro,
  onConnected,
  onDisconnect,
}: {
  profileId: string;
  connected: boolean;
  isPro: boolean;
  onConnected: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast } = useFeedback();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<NsBusy>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [state, setState] = useState<NsState | null>(null);

  // The line under the form is a live region on Android only; iOS needs the announcement.
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message.text);
  }, [message]);

  const refresh = useCallback(async () => {
    try {
      setState(await getNightscoutState(profileId));
    } catch (err) {
      logCrash(safeNightscoutError("readState", err), { screen: "dataSources", op: "nsState" });
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
    return subscribeCgmChanges((change) => {
      if (change.profileId === profileId) void refresh();
    });
  }, [profileId, refresh, connected]);

  const timeText = (ms: number): string => {
    const iso = new Date(ms).toISOString();
    return `${formatDate(iso)} ${formatTime(iso)}`;
  };

  const describe = (detail: NsTestDetail, latestMs: number | null): string => {
    const key = testDetailKey(detail);
    return latestMs != null && detail === "ok" ? t(key, { time: timeText(latestMs) }) : t(key);
  };

  // A token pasted inside the address moves into its own field, out of the address.
  const splitPastedToken = (): { url: string; token: string } => {
    const parsed = parseNightscoutUrl(url);
    if (parsed.ok && parsed.token) {
      const moved = token.trim().length > 0 ? token : parsed.token;
      setUrl(parsed.base);
      setToken(moved);
      return { url: parsed.base, token: moved };
    }
    return { url, token };
  };

  async function onTest() {
    if (busy) return;
    setBusy("test");
    setMessage(null);
    try {
      const input = splitPastedToken();
      const res = await testNightscout(input);
      logEvent("nightscout_connect", { result: res.result });
      setMessage({ text: describe(res.detail, res.latestMs), ok: res.result === "ok" });
    } catch (err) {
      logCrash(safeNightscoutError("test", err), { screen: "dataSources", op: "nsTest" });
      setMessage({ text: t("nightscout.errUnreachable"), ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function onConnect() {
    if (busy) return;
    setBusy("connect");
    setMessage(null);
    try {
      const input = splitPastedToken();
      const res = await connectNightscoutFor(profileId, input);
      logEvent("nightscout_connect", { result: res.result });
      if (!res.ok) {
        hapticWarning();
        setMessage({ text: describe(res.detail, null), ok: false });
        return;
      }
      await setCgmMode(profileId, "nightscout");
      logEvent("cgm_mode_set", { mode: "nightscout" });
      setUrl("");
      setToken("");
      toast(t("nightscout.connectedToast"), "success");
      onConnected();
      void registerHealthBackground();
      // The first pull (30 days) starts at once instead of at the next tick.
      void syncNightscoutForeground(profileId, isPro).then(refresh);
    } catch (err) {
      logCrash(safeNightscoutError("connect", err), { screen: "dataSources", op: "nsConnect" });
      toast(t("common.saveFailed"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function onSyncNow() {
    if (busy) return;
    setBusy("sync");
    try {
      const out = await syncNightscoutForeground(profileId, isPro);
      if (out.status === "ok") toast(t("nightscout.synced", { n: num(out.inserted) }), "success");
      else if (out.status === "skipped") toast(t("nightscout.syncWait"), "info");
      else toast(t("nightscout.errUnreachable"), "error");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const platformNote = Platform.OS === "ios" ? t("nightscout.iosNote") : t("nightscout.androidNote");

  if (connected) {
    const failure = state ? statusKey(state.status) : null;
    return (
      <View style={{ marginTop: SPACE.sm, marginBottom: SPACE.md }}>
        <Txt kind="body" style={{ fontWeight: "600" }}>
          {state?.lastSyncAt != null
            ? t("nightscout.connected", { time: timeText(state.lastSyncAt) })
            : t("nightscout.connectedNever")}
        </Txt>
        {failure ? (
          <Txt kind="caption" tone="danger" style={{ marginTop: SPACE.xs }}>
            {t(failure)}
          </Txt>
        ) : null}
        <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
          {t("cgmSource.delayNote")}
        </Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
          {platformNote}
        </Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
          {t("nightscout.privacy")}
        </Txt>
        {!isPro ? (
          <View style={{ marginTop: SPACE.md }}>
            <Row
              icon="sparkles-outline"
              label={t("nightscout.modeLabel")}
              value={t("nightscout.proTag")}
              onPress={() => router.push({ pathname: "/paywall", params: { reason: "health" } })}
            />
          </View>
        ) : null}
        <View style={{ marginTop: SPACE.md, gap: SPACE.sm }}>
          <Button
            label={busy === "sync" ? t("nightscout.syncing") : t("nightscout.syncNow")}
            variant="outlined"
            loading={busy === "sync"}
            onPress={() => void onSyncNow()}
          />
          <Button label={t("nightscout.disconnect")} variant="destructive" onPress={onDisconnect} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginTop: SPACE.sm, marginBottom: SPACE.md }}>
      <Txt kind="caption" tone="muted" style={{ marginBottom: SPACE.md }}>
        {t("nightscout.intro")}
      </Txt>
      <Field
        label={t("nightscout.urlLabel")}
        hint={t("nightscout.urlHint")}
        value={url}
        onChangeText={(v) => {
          setUrl(v);
          setMessage(null);
        }}
        placeholder="https://"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        textContentType="URL"
        spellCheck={false}
        returnKeyType="next"
        maxLength={2048}
      />
      <Field
        label={t("nightscout.tokenLabel")}
        hint={t("nightscout.tokenHint")}
        value={token}
        onChangeText={(v) => {
          setToken(v);
          setMessage(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        importantForAutofill="no"
        returnKeyType="done"
        maxLength={200}
      />
      {message ? (
        <Txt
          kind="caption"
          tone={message.ok ? "success" : "danger"}
          style={{ marginBottom: SPACE.md }}
          accessibilityLiveRegion="polite"
        >
          {message.text}
        </Txt>
      ) : null}
      <View style={{ gap: SPACE.sm }}>
        <Button
          label={busy === "test" ? t("nightscout.testing") : t("nightscout.test")}
          variant="outlined"
          loading={busy === "test"}
          disabled={url.trim().length === 0 || busy === "connect"}
          onPress={() => void onTest()}
        />
        <Button
          label={busy === "connect" ? t("nightscout.connecting") : t("nightscout.connect")}
          loading={busy === "connect"}
          disabled={url.trim().length === 0 || busy === "test"}
          onPress={() => void onConnect()}
        />
      </View>
      <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.md }}>
        {platformNote}
      </Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
        {t("nightscout.privacy")}
      </Txt>
    </View>
  );
}

export default function DataSourcesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const { activeProfile, isProUser } = useApp();
  const profileId = activeProfile?.id;

  const [mode, setMode] = useState<CgmMode>("manual");
  const [detected, setDetected] = useState<boolean | null>(null);
  const [nsFormOpen, setNsFormOpen] = useState(false);
  const nsAvailable = nightscoutEnabled() && nightscoutAvailable();

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
    // Without the build flag or the secure store (an older binary) the row is not offered at all.
    ...(nsAvailable
      ? [
          {
            mode: "nightscout" as const,
            label: t("nightscout.modeLabel"),
            hint: t("nightscout.modeHint"),
            badge: nightscoutAllowed(isProUser) ? undefined : t("nightscout.proTag"),
          },
        ]
      : []),
  ];

  async function switchTo(next: CgmMode) {
    if (!profileId) return;
    try {
      await setCgmMode(profileId, next);
      setMode(next);
      logEvent("cgm_mode_set", { mode: next });
    } catch (err) {
      logCrash(err, { screen: "dataSources", op: "setMode" });
      toast(t("common.saveFailed"), "error");
    }
  }

  // Turning Nightscout off stops the pulls and removes the stored address and
  // token. The readings it brought stay unless the user asks, after a second
  // confirmation that names how many would go.
  async function leaveNightscout(next: CgmMode) {
    if (!profileId) return;
    const proceed = await confirm({
      title: t("nightscout.disconnectTitle"),
      message: t("nightscout.disconnectMessage"),
      confirmLabel: t("nightscout.disconnect"),
      icon: "unlink-outline",
    });
    if (!proceed) return;
    let count = 0;
    try {
      count = await countNightscoutReadings(profileId);
    } catch (err) {
      logCrash(safeNightscoutError("count", err), { screen: "dataSources", op: "nsCount" });
    }
    const deleteReadings =
      count > 0 &&
      (await confirm({
        title: t("nightscout.deleteConfirmTitle"),
        message: t("nightscout.deleteConfirmMessage", { n: num(count) }),
        confirmLabel: t("nightscout.disconnectDelete", { n: num(count) }),
        cancelLabel: t("nightscout.disconnectKeep"),
        destructive: true,
        icon: "trash-outline",
      }));
    try {
      const out = await disconnectNightscoutFor(profileId, { deleteReadings });
      await switchTo(next);
      setNsFormOpen(false);
      void registerHealthBackground();
      toast(
        out.removed > 0
          ? t("nightscout.disconnectedDeleted", { n: num(out.removed) })
          : t("nightscout.disconnected"),
        "success"
      );
    } catch (err) {
      logCrash(safeNightscoutError("disconnect", err), { screen: "dataSources", op: "nsDisconnect" });
      toast(t("common.saveFailed"), "error");
    }
  }

  async function choose(next: CgmMode) {
    if (!profileId) return;
    hapticSelect();
    if (next === "nightscout") {
      if (!nightscoutAllowed(isProUser)) {
        hapticWarning();
        router.push({ pathname: "/paywall", params: { reason: "health" } });
        return;
      }
      if (mode !== "nightscout") setNsFormOpen(true);
      return;
    }
    setNsFormOpen(false);
    if (mode === "nightscout") {
      await leaveNightscout(next);
      return;
    }
    if (next === mode) return;
    await switchTo(next);
  }

  const shownMode: CgmMode = nsFormOpen ? "nightscout" : mode;

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
            selected={shownMode === option.mode}
            onPress={() => void choose(option.mode)}
          />
        ))}
      </View>

      {profileId && nsAvailable && (mode === "nightscout" || nsFormOpen) ? (
        <NightscoutPanel
          profileId={profileId}
          connected={mode === "nightscout"}
          isPro={isProUser}
          onConnected={() => {
            setNsFormOpen(false);
            void refresh();
          }}
          onDisconnect={() => void leaveNightscout("manual")}
        />
      ) : null}

      {isCgmModeActive(mode) ? (
        <View style={{ marginTop: SPACE.sm, marginBottom: SPACE.md }}>
          {detected != null ? (
            <Txt kind="body" style={{ fontWeight: "600", marginBottom: SPACE.xs }}>
              {t(detected ? "dataSources.stateActive" : "dataSources.stateInactive")}
            </Txt>
          ) : null}
          {mode === "cgm" ? (
            <>
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
            </>
          ) : null}
        </View>
      ) : null}

      <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
        {t("dataSources.keepsData")}
      </Txt>
    </SettingsScaffold>
  );
}
