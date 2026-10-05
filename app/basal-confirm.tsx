import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { AppBackground, GradientCTA } from "../components/rich";
import { ScreenHeader } from "../components/ScreenHeader";
import { Skeleton } from "../components/Skeleton";
import { Stepper, useStepperValidity } from "../components/Stepper";
import { InlineDateTimePicker } from "../components/InlineDateTimePicker";
import { InjectionBodyMap } from "../components/InjectionBodyMap";
import { DirIcon } from "../components/DirIcon";
import { MODAL_TOP_PAD, RADIUS, THEME } from "../lib/theme/tokens";
import { formatTime, isolateLtr, num, relativeDay } from "../lib/format";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { logCrash, logEvent } from "../lib/analytics";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { useApp } from "../lib/store/AppContext";
import { SELECTABLE_SITES, type InjectionSite, type SitePoint } from "../lib/db/types";
import { getSiteUsageHistory, type RecentInjection, type SiteUsage } from "../lib/db/injections";
import {
  findDuplicateBasalInjection,
  resolveBasalConfirmContext,
  resolveBasalConfirmEntry,
  saveBasalConfirmation,
  type BasalConfirmContext,
  type BasalConfirmProfileOption,
} from "../lib/services/basalConfirm";

// Same heat window as the injection tab's own map surface (see
// components/InjectionEditSheet.tsx).
const USAGE_WINDOW_DAYS = 30;

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  /** Time matched more than one profile's own basal reminder (hub card B3:
   *  the AlarmKit "Open" path now carries a reminderId when the native
   *  payload has one - app/_layout.tsx's alarmReminderContext reads it from
   *  alarmId - so this only happens without one: an older build's alarm, or
   *  one the intent failed to write an id for. resolveBasalConfirmEntry then
   *  falls back to matching by TIME), and none of them is the active
   *  profile - the user picks by hand instead of a guess landing in the
   *  wrong profile's log. */
  | { kind: "chooseProfile"; candidates: BasalConfirmProfileOption[] }
  | { kind: "duplicate"; ctx: BasalConfirmContext; existing: RecentInjection }
  | { kind: "ready"; ctx: BasalConfirmContext };

const inputStyle = {
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.glass,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.ink,
} as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
      {children}
    </Text>
  );
}

/**
 * The basal insulin confirm flow (task card B): reached either from the
 * basal reminder itself (a plain tap opens the "ask" step, the reminder's
 * own "I already did it" quick action opens straight on "site" - see
 * ensureNotificationCategories / routeForNotification in app/_layout.tsx),
 * or from a "I did it" entry point elsewhere in the app with no reminderId
 * at all (task package A's dashboard button).
 *
 * Descriptive only: the two steps ask whether a dose was taken and let the
 * user record where and when, exactly like the rest of the injection log -
 * nothing here suggests a dose, a time or a site.
 */
function BasalConfirmScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, bumpData } = useApp();
  const params = useLocalSearchParams<{
    reminderId?: string;
    profileId?: string;
    step?: string;
  }>();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [step, setStep] = useState<"ask" | "site">(params.step === "site" ? "site" : "ask");
  const [dose, setDose] = useState(0);
  const [loggedAt, setLoggedAt] = useState(new Date());
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [site, setSite] = useState<InjectionSite>(SELECTABLE_SITES[0]);
  const [point, setPoint] = useState<SitePoint | null>(null);
  const [hasSite, setHasSite] = useState(false);
  const [picking, setPicking] = useState(false);
  const [usage, setUsage] = useState<SiteUsage[] | undefined>(undefined);
  const [noSiteCount, setNoSiteCount] = useState(0);
  const usageRequestedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const stepperFields = useStepperValidity();
  const [doseInvalidKind, setDoseInvalidKind] = useState<null | "empty" | "range">(null);
  // Synchronous double-tap guard: `saving` (state) only actually blocks a
  // second call to save() once React has re-rendered with it true, and a
  // rapid double-tap can fire twice before that happens. The ref is set
  // (and checked) synchronously at the top of save(), before any await.
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const initedRef = useRef(false);

  /** Shared tail of resolution: a reminderId (explicit, or picked off a
   *  chooseProfile candidate) -> profile+time context -> duplicate check ->
   *  "ready". `isAlive` lets the mount effect skip a stale state update
   *  after unmount; the chooseProfile chip handler passes a no-op check
   *  (it runs from a live user tap, never from an unmounted screen).
   *  `fallbackProfileIdOverride` is set only when a chooseProfile pick has
   *  no reminder of its own (the synthetic "this profile, right now" option
   *  - see BasalConfirmProfileOption) - reminderId is null in that case, so
   *  resolveBasalConfirmContext needs THAT profile as its fallback, not
   *  whatever the screen's own params/active profile happen to be. */
  async function resolveContextAndSet(
    reminderId: string | null,
    isAlive: () => boolean,
    fallbackProfileIdOverride?: string
  ): Promise<void> {
    try {
      const ctx = await resolveBasalConfirmContext({
        reminderId,
        fallbackProfileId:
          fallbackProfileIdOverride ?? params.profileId ?? activeProfile?.id ?? null,
      });
      if (!isAlive()) return;
      if (!ctx) {
        setLoad({ kind: "error" });
        return;
      }
      const existing = await findDuplicateBasalInjection(ctx.profile.id, ctx.targetTime);
      if (!isAlive()) return;
      if (existing) {
        setLoad({ kind: "duplicate", ctx, existing });
        return;
      }
      setLoad({ kind: "ready", ctx });
    } catch (err) {
      logCrash(err, { screen: "basalConfirm", step: "resolveContext" });
      if (isAlive()) setLoad({ kind: "error" });
    }
  }

  // Resolved once per screen instance, off the params that identify what
  // this confirm is ABOUT. A reminderId owns the profile outright (see
  // resolveBasalConfirmContext's own doc comment); with none (AlarmKit's
  // "Open" - see app/_layout.tsx's alarm consume() - or a parameterless "I
  // did it" entry point), resolveBasalConfirmEntry searches every profile's
  // own basal reminder by TIME instead (hub card B3) and either resolves
  // straight to one, or - two+ profiles' reminders both plausibly just rang,
  // neither the active one - asks which profile via "chooseProfile".
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const entry = await resolveBasalConfirmEntry({
          reminderId: params.reminderId ?? null,
          profileId: params.profileId ?? null,
          activeProfileId: activeProfile?.id ?? null,
        });
        if (!alive) return;
        if (entry.kind === "chooseProfile") {
          setLoad({ kind: "chooseProfile", candidates: entry.candidates });
          return;
        }
        await resolveContextAndSet(entry.reminderId, () => alive);
      } catch (err) {
        logCrash(err, { screen: "basalConfirm", step: "resolve" });
        if (alive) setLoad({ kind: "error" });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.reminderId, params.profileId]);

  /** A chooseProfile chip was tapped: a real candidate resolves exactly like
   *  a direct reminderId open would (profile, time, dose all come from its
   *  own reminder); the synthetic "this profile, right now" option
   *  (reminder null - see BasalConfirmProfileOption) resolves straight to
   *  that profile with no reminderId, same as the screen's own no-candidate
   *  fallback. Either way ends with the same duplicate check. */
  function selectProfileCandidate(option: BasalConfirmProfileOption) {
    hapticSelect();
    setLoad({ kind: "loading" });
    if (option.reminder) {
      void resolveContextAndSet(option.reminder.id, () => true);
    } else {
      void resolveContextAndSet(null, () => true, option.profile.id);
    }
  }

  // Seeds the editable working state exactly once, the moment resolution
  // lands on "ready" - never again, so an unrelated re-render never resets a
  // dose or time the user already changed.
  useEffect(() => {
    if (load.kind !== "ready" || initedRef.current) return;
    initedRef.current = true;
    setLoggedAt(load.ctx.targetTime);
    setDose(load.ctx.profile.basal_daily_units ?? 0);
  }, [load]);

  /** Site-usage history for the silhouette, fetched once - lazily, the first
   *  time the site step is actually reached, matching the same "only when
   *  needed" rule components/InjectionEditSheet.tsx follows for the same
   *  query. */
  async function ensureUsageLoaded(profileId: string) {
    if (usageRequestedRef.current) return;
    usageRequestedRef.current = true;
    try {
      const u = await getSiteUsageHistory(profileId, USAGE_WINDOW_DAYS);
      setUsage(u.sites);
      setNoSiteCount(u.noSiteCount);
    } catch (err) {
      logCrash(err, { screen: "basalConfirm", step: "siteUsage" });
      setUsage([]);
    }
  }

  useEffect(() => {
    if (load.kind === "ready" && step === "site") void ensureUsageLoaded(load.ctx.profile.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, step]);

  function dismiss() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/injection");
  }

  async function save() {
    // dose > 0 is also what disables the button (see the Save CTA below);
    // checked again here so a stray call can never write a doseless row.
    if (load.kind !== "ready" || savingRef.current || !(dose > 0) || !stepperFields.allValid) return;
    const ctx = load.ctx;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await saveBasalConfirmation({
        profileId: ctx.profile.id,
        doseUnits: dose,
        site: hasSite ? site : null,
        sitePoint: hasSite ? point : null,
        loggedAt,
        glucoseUnit: ctx.profile.glucose_unit,
        currentBasalDailyUnits: ctx.profile.basal_daily_units,
      });
      // The service-side backstop for the same dose>0 rule the Save button's
      // own disabled state already enforces (see the button below) - never
      // actually reachable through the UI, but a stray call must not fall
      // through to the success path. The "doseRequired" hint is already
      // visible whenever dose is not > 0, so there is nothing else to show.
      if (result.kind === "invalidDose") return;
      // The time this actually saves against is editable (the site step's
      // own time picker) and can drift back into another basal row's window
      // AFTER the open-time check already cleared it - saveBasalConfirmation
      // re-checks right before writing and reports it back here instead of
      // writing a second entry.
      if (result.kind === "duplicate") {
        setLoad({ kind: "duplicate", ctx, existing: result.existing });
        return;
      }
      logEvent("log_added", { source: "reminder" });
      hapticSuccess();
      bumpData();
      dismiss();
    } catch (err) {
      logCrash(err, { screen: "basalConfirm", step: "save" });
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const ctx = load.kind === "ready" || load.kind === "duplicate" ? load.ctx : null;
  const differentProfile =
    ctx != null && activeProfile != null && activeProfile.id !== ctx.profile.id;

  const headerTitle = t("basalConfirm.title");
  const headerBackIcon = picking ? "chevron-back" : "close";
  const onHeaderBack = () => {
    if (picking) {
      setPicking(false);
      return;
    }
    dismiss();
  };

  const siteSummaryLabel = hasSite
    ? point != null
      ? t("injection.siteWithPoint", { site: t(`injectionSite.${site}`), n: point })
      : t(`injectionSite.${site}`)
    : t("injection.chooseSitePoint");

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        <ScreenHeader
          title={picking ? t("injection.selectSite") : headerTitle}
          onBack={onHeaderBack}
          backIcon={headerBackIcon}
        />

        {differentProfile ? (
          <Text
            numberOfLines={1}
            style={{ color: THEME.muted, fontSize: 12, paddingHorizontal: 20, marginTop: -4, marginBottom: 6 }}
          >
            {t("basalConfirm.forProfile", { name: ctx?.profile.name })}
          </Text>
        ) : null}

        {load.kind === "loading" ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 12 }}>
            <Skeleton width="100%" height={22} />
            <Skeleton width="60%" height={16} />
            <Skeleton width="100%" height={48} radius={RADIUS.md} />
          </View>
        ) : load.kind === "error" ? (
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 24 }}>
            <Text style={{ color: THEME.ink, fontSize: 15, marginBottom: 16 }}>
              {t("basalConfirm.loadError")}
            </Text>
            <GradientCTA label={t("common.close")} onPress={dismiss} />
          </View>
        ) : load.kind === "chooseProfile" ? (
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12 }}>
            <Text style={{ color: THEME.ink, fontSize: 20, fontWeight: "800", marginBottom: 16 }}>
              {t("basalConfirm.chooseProfile")}
            </Text>
            <View style={{ gap: 10 }}>
              {load.candidates.map((c) => (
                <Pressable
                  key={c.reminder?.id ?? c.profile.id}
                  onPress={() => selectProfileCandidate(c)}
                  accessibilityRole="button"
                  className="flex-row items-center justify-between"
                  style={inputStyle}
                >
                  <Text
                    numberOfLines={1}
                    style={{ color: THEME.ink, fontSize: 14, fontWeight: "700", flexShrink: 1 }}
                  >
                    {c.profile.name}
                  </Text>
                  <DirIcon name="chevron-forward" size={16} color={THEME.muted} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : load.kind === "duplicate" ? (
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 24 }}>
            <Text style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", marginBottom: 8 }}>
              {t("basalConfirm.duplicateTitle")}
            </Text>
            <Text style={{ color: THEME.muted, fontSize: 14, marginBottom: 24 }}>
              {/* time/n stay separate params (not merged into one, unlike
                  CarbRatioLine): tr and ja embed them non-adjacently inside
                  their own sentence ("{{time}} saatinde {{n}} Ü olarak..."),
                  so each is isolated on its own (lib/format's LRI/PDI wrap)
                  rather than forcing every language into one fixed order. */}
              {load.existing.dose_units != null
                ? t("basalConfirm.duplicateBody", {
                    time: isolateLtr(formatTime(load.existing.logged_at)),
                    n: isolateLtr(num(load.existing.dose_units)),
                  })
                : t("basalConfirm.duplicateBodyNoDose", {
                    time: isolateLtr(formatTime(load.existing.logged_at)),
                  })}
            </Text>
            <GradientCTA label={t("common.close")} onPress={dismiss} />
          </View>
        ) : picking ? (
          <ScrollView
            style={{ flex: 1 }}
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          >
            {usage === undefined ? (
              <Skeleton width="100%" height={360} radius={20} />
            ) : (
              <InjectionBodyMap
                usage={usage}
                noSiteCount={noSiteCount}
                selected={hasSite && point != null ? { site, point } : null}
                onSelect={(selection) => {
                  setSite(selection.site);
                  setPoint(selection.point);
                  setHasSite(true);
                  setPicking(false);
                }}
                windowDays={USAGE_WINDOW_DAYS}
                showRotationHint={isProUser}
              />
            )}
          </ScrollView>
        ) : step === "ask" ? (
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12 }}>
            <Text style={{ color: THEME.ink, fontSize: 20, fontWeight: "800", marginBottom: 10 }}>
              {t("basalConfirm.askTitle")}
            </Text>
            <Text style={{ color: THEME.muted, fontSize: 14, marginBottom: 28 }}>
              {/* Not a t() template - built straight from three pieces, so the
                  fix is in code, not a locale file: the dose and the time are
                  each their own isolated LTR run (lib/format's LRI/PDI wrap);
                  "today"/"yesterday" is a real translated word and stays
                  untouched, never isolated as LTR. */}
              {dose > 0 ? `${isolateLtr(`${num(dose)} ${t("common.unitsShort")}`)} · ` : ""}
              {relativeDay(loggedAt.toISOString(), {
                today: t("common.today"),
                yesterday: t("common.yesterday"),
              })}
              {" · "}
              {isolateLtr(formatTime(loggedAt.toISOString()))}
            </Text>
            <View style={{ flex: 1 }} />
            {/* Full-width, stacked (not a two-up half-width row): the longest
                translation (pt "Sim, já apliquei") clipped under
                GradientCTA's own adjustsFontSizeToFit at half width on
                Android, which downscales silently there instead of wrapping -
                see CLAUDE.md's own warning about that API. Full width gives
                every language room without depending on it. */}
            <View style={{ gap: 10, marginBottom: 8 }}>
              <GradientCTA
                label={t("basalConfirm.yes")}
                onPress={() => {
                  hapticSelect();
                  setStep("site");
                }}
              />
              <GradientCTA
                label={t("basalConfirm.no")}
                variant="sub"
                onPress={() => {
                  hapticSelect();
                  dismiss();
                }}
              />
            </View>
          </View>
        ) : (
          <ScrollView
            {...keyboardAwareScrollProps}
            style={{ flex: 1 }}
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          >
            <FieldLabel>{t("injection.time")}</FieldLabel>
            <Pressable
              onPress={() => setTimePickerOpen((v) => !v)}
              className="flex-row items-center mb-5"
              style={inputStyle}
            >
              <Ionicons name="time-outline" size={16} color={THEME.muted} />
              <Text style={{ color: THEME.ink, marginLeft: 8, fontSize: 13 }}>
                {relativeDay(loggedAt.toISOString(), {
                  today: t("common.today"),
                  yesterday: t("common.yesterday"),
                })}
                {" · "}
                {formatTime(loggedAt.toISOString())}
              </Text>
            </Pressable>
            <InlineDateTimePicker
              visible={timePickerOpen}
              value={loggedAt}
              max={new Date()}
              locale={i18n.language}
              onChange={setLoggedAt}
              onClose={() => setTimePickerOpen(false)}
            />

            <FieldLabel>{t("injection.dose")}</FieldLabel>
            <Stepper
              value={dose}
              onChange={setDose}
              onValidityChange={stepperFields.reporter("dose")}
              onInvalidKindChange={setDoseInvalidKind}
              step={0.5}
              longStep={1}
              min={0}
              max={150}
              decimals={1}
              suffix={t("common.units")}
              accessibilityLabel={t("injection.dose")}
              style={{ marginBottom: 16 }}
            />

            <FieldLabel>{t("injection.selectSite")}</FieldLabel>
            <Pressable
              onPress={() => setPicking(true)}
              className="flex-row items-center justify-between mb-6"
              style={inputStyle}
            >
              <Text numberOfLines={1} style={{ color: THEME.ink, fontSize: 13, flexShrink: 1 }}>
                {siteSummaryLabel}
              </Text>
              <DirIcon name="chevron-forward" size={16} color={THEME.muted} />
            </Pressable>

            {dose > 0 && stepperFields.allValid ? null : (
              <Text style={{ color: THEME.muted, fontSize: 12, marginBottom: 8 }}>
                {doseInvalidKind === "range"
                  ? t("settings.rangeOutOfBounds", { min: num(0), max: num(150) })
                  : t("basalConfirm.doseRequired")}
              </Text>
            )}
            {saveError ? (
              <Text style={{ color: THEME.caution, fontSize: 12, marginBottom: 8 }}>
                {t("common.saveFailed")}
              </Text>
            ) : null}
            <GradientCTA
              label={t("common.save")}
              onPress={save}
              loading={saving}
              disabled={saving || !(dose > 0) || !stepperFields.allValid}
            />
          </ScrollView>
        )}
      </View>
    </AppBackground>
  );
}

export default function BasalConfirmRoute() {
  return (
    <SafeAreaProvider>
      <BasalConfirmScreen />
    </SafeAreaProvider>
  );
}
