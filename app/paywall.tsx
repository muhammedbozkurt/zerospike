import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AppBackground,
  GlassCard,
  GradientCTA,
  IconTile,
} from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { GLUCOSE_RICH, MODAL_TOP_PAD, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { isolateLtr, money, num, pct } from "../lib/format";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  purchasePro,
  restore,
  loadOfferings,
  getDownsellOffer,
  getTrialStatus,
  trialAfterPurchase,
  type OfferingsResult,
  type PurchaseOutcome,
  PlanId,
} from "../lib/services/purchases";
import {
  canShowDownsell,
  recordDownsellShown,
  recordPaywallDismissed,
  type DownsellTrigger,
} from "../lib/services/downsell";
import { purchaseToastFor } from "../lib/services/purchaseFlow";
import {
  cancelTrialReminder,
  getNotificationPermission,
  scheduleTrialDay1Nudge,
  scheduleTrialEndingReminder,
} from "../lib/services/notifications";
import { getNotificationPrefs } from "../lib/services/notificationPrefs";
import { FREE_CUSTOM_FOOD_LIMIT } from "../lib/guardrails";
import { useHealthAvailable } from "../lib/services/healthAvailability";
import { privacyUrl, termsUrl } from "../lib/legal";
import { logCrash, logEvent, type PaywallViewSource } from "../lib/analytics";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { useLayout } from "../lib/useLayout";
import { StoreStatusNotice } from "../components/StoreStatusNotice";
import { listManualSugarLogs } from "../lib/db/logs";
import { rangeFromWindow } from "../lib/insights";
import { targetBandFor } from "../lib/agpChart";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import { clearPaywallTrial, getPaywallTrialGen, primePaywallTrial, resetPaywallTrialCache } from "../lib/proCta";
import { PaywallPreview } from "../components/PaywallPreview";
import {
  DEFAULT_TRIAL_DAYS,
  PERSONAL_WINDOW_DAYS,
  buildTrialTimeline,
  perMonthPrice,
  personalSummary,
  shouldScheduleTrialNudge,
  trialReminderDeliverable,
  type PersonalSummary,
} from "../lib/trialTimeline";
import { trialSettleAction, type TrialSettleAction } from "../lib/trialSettle";
import { shouldAutoOpenWelcome, withHealthMirror } from "../lib/proWelcome";
import { getProWelcomeState } from "../lib/services/proWelcome";
import { getHealthSyncEnabled } from "../lib/services/health";

// RevenueCat's offering id is not exposed by loadOfferings, so there is one fixed variant.
const PAYWALL_VARIANT = "default";

/**
 * A plan row in the mockup's 08 composition: the plan name and its terms on the
 * left, and the BILLED AMOUNT as the dominant figure on the right. The selected
 * plan is lit with an accent border, an accent wash and a glow; selection is
 * also carried by the radio, so it never rests on colour alone.
 */
function PlanCard({
  selected,
  onSelect,
  name,
  desc,
  foot,
  price,
  period,
  badge,
  save,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  desc?: string;
  foot?: string;
  price: string | null;
  period: string;
  badge?: string;
  save?: string;
}) {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="rounded-2xl p-4 flex-row items-center mb-3"
      style={[
        {
          borderWidth: 1,
          borderColor: selected ? THEME.accent : THEME.border,
          backgroundColor: selected ? withAlpha(THEME.accent, 0.12) : THEME.glass,
        },
        selected ? glow(THEME.accent, 24, 0.45) : undefined,
      ]}
    >
      <View
        className="w-5 h-5 rounded-full items-center justify-center mr-3"
        style={{ borderWidth: 2, borderColor: selected ? THEME.accent : THEME.border }}
      >
        {selected ? (
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: THEME.accent }}
          />
        ) : null}
      </View>

      <View className="flex-1">
        <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
          <Text style={{ color: THEME.ink, fontWeight: "800", fontSize: 15 }}>{name}</Text>
          {badge ? (
            <View className="rounded-full bg-brand px-2 py-0.5">
              <Text className="text-black text-[10px] font-bold">{badge}</Text>
            </View>
          ) : null}
          {save ? (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: withAlpha(GLUCOSE_RICH.target, 0.16) }}
            >
              {/* Bidi: pct() already orders the number and sign correctly for
                  the language ("50%"); pin it LTR so an RTL base paragraph
                  direction cannot reorder the sign to the front. */}
              <Text
                style={{
                  color: GLUCOSE_RICH.target,
                  fontSize: 10,
                  fontWeight: "800",
                  writingDirection: "ltr",
                }}
              >
                {save}
              </Text>
            </View>
          ) : null}
        </View>
        {desc ? (
          <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }} numberOfLines={2}>
            {desc}
          </Text>
        ) : null}
        {foot ? (
          <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 1 }}>{foot}</Text>
        ) : null}
      </View>

      {/* The billed amount, dominant. A plan whose store price is missing shows a
          placeholder bar instead of an empty slot in the loudest spot on the row. */}
      <View className="items-end ml-2">
        {price ? (
          <Text style={[TABULAR, { color: THEME.ink, fontSize: 20, fontWeight: "800" }]}>
            {price}
          </Text>
        ) : (
          <View
            style={{
              width: 56,
              height: 20,
              borderRadius: 6,
              backgroundColor: THEME.track,
            }}
          />
        )}
        <Text style={{ color: THEME.muted, fontSize: 11 }}>{period}</Text>
      </View>
    </Pressable>
  );
}

function PaywallScreen() {
  const { t } = useTranslation();
  // Same brand-name pick as app/settings/data.tsx: iOS's is localized under
  // settings.healthSection, Android's ("Health Connect") is not per-language
  // and lives right next to it as settings.healthSectionAndroid.
  const healthName = t(
    Platform.OS === "ios" ? "settings.healthSection" : "settings.healthSectionAndroid"
  );
  // Same device-level gate as the dashboard's quick-access Health card: on
  // Android with no usable Health Connect (not installed / needs a Play
  // update), the sync feature is not actually reachable, so the paywall must
  // not sell it either.
  const healthAvailable = useHealthAvailable();
  const insets = useSafeAreaInsets();
  const { columnPad } = useLayout();
  const router = useRouter();
  const { reason } = useLocalSearchParams<{
    reason?: PaywallViewSource;
  }>();
  // 2.3.4: onboarding no longer hands off to the paywall (app/onboarding.tsx
  // goes straight to the dashboard), so every entry point is "inapp" now -
  // the "onboarding" DownsellTrigger, the `context` route param and the
  // `focus` param it drove (which insulin/tracking line led the feature
  // grid) were dropped with it. Kept as a DownsellTrigger rather than a bare
  // string literal in case a future entry point needs its own value again.
  const context: DownsellTrigger = "inapp";
  const { refreshPro, activeProfile, isProUser } = useApp();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanId>("annual");
  const [offer, setOffer] = useState<OfferingsResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [personal, setPersonal] = useState<PersonalSummary | null>(null);
  const profileId = activeProfile?.id;
  const glucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const band = useMemo(() => {
    const b = targetBandFor(activeProfile ?? {});
    return { low: b.low, high: b.high };
  }, [activeProfile]);

  // The personal line: the user's own manual readings of the last two weeks,
  // through the same computeInsights Insights uses. Hidden until there are
  // enough readings to say something. The own-readings filter and the span are
  // in the query itself: a row cap on the newest readings let a Health import
  // crowd the user's own out of the window.
  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    (async () => {
      try {
        const now = Date.now();
        const logs = await listManualSugarLogs(
          profileId,
          rangeFromWindow(PERSONAL_WINDOW_DAYS, now)
        );
        if (alive) setPersonal(personalSummary(logs, band, now));
      } catch (err) {
        logCrash(err, { screen: "paywall", load: "personal" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [profileId, band]);

  // Whether an ending reminder can be promised: the app's own notification
  // switch and what the OS says. False until both are read, so the timeline row
  // never shows and then disappears for someone who muted notifications.
  const [reminderOk, setReminderOk] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [prefs, permission] = await Promise.all([
          getNotificationPrefs(),
          getNotificationPermission(),
        ]);
        if (alive) {
          setReminderOk(
            trialReminderDeliverable({ notificationsEnabled: prefs.enabled, permission })
          );
        }
      } catch (err) {
        logCrash(err, { screen: "paywall", load: "reminderState" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Real localized store prices + trial state. In release, a failed fetch
  // yields status 'unavailable' (never a hardcoded fallback) → retry state.
  useEffect(() => {
    let alive = true;
    setOffer(null);
    const trialGen = getPaywallTrialGen();
    loadOfferings()
      .then((r) => {
        if (trialGen === getPaywallTrialGen()) primePaywallTrial(r);
        if (alive) setOffer(r);
      })
      .catch((err) => {
        logCrash(err, { screen: "paywall", load: "offerings" });
        if (alive) setOffer({ status: "unavailable", isDevFallback: false, plans: {} });
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const plans = offer?.plans ?? {};
  const annualTrial = plans.annual?.hasFreeTrial ?? false;
  const eventTrial = annualTrial;
  // Store-reported trial length (RC intro offer), so an A/B on the trial
  // length never needs a code change; falls back to the shipped default.
  const trialDays = plans.annual?.freeTrialDays || DEFAULT_TRIAL_DAYS;

  useEffect(() => {
    if (!offer) return;
    logEvent("paywall_view", {
      source: reason ?? "direct",
      trial_eligible: annualTrial,
      context,
      variant: PAYWALL_VARIANT,
    });
  }, [offer, reason, annualTrial, context]);

  // null, not "": a missing store price must never render as an empty gap where
  // the billed amount belongs.
  const priceStr = (p: PlanId) => plans[p]?.priceString ?? null;

  // Derived, currency-correct: annual per-month and savings vs 12 months.
  const monthly = plans.monthly;
  const annual = plans.annual;
  const savePct =
    monthly && annual && monthly.price > 0
      ? Math.round((1 - annual.price / (monthly.price * 12)) * 100)
      : 0;
  const annualPerMonthValue = perMonthPrice(annual?.price);
  const annualPerMonth =
    annual && annualPerMonthValue != null
      ? money(annualPerMonthValue, annual.currencyCode)
      : null;
  // What the one-off costs in years of the annual plan, from the STORE's own
  // two prices - never a written-down number, because both move per country,
  // per currency and per promotion. Rounded to a half year (2, 2.5, 3), which
  // is as precise as an anchor should be. Absent whenever either price is
  // missing, so the line disappears rather than anchoring against nothing.
  const lifetime = plans.lifetime;
  const lifetimeYears =
    lifetime && annual && annual.price > 0 && lifetime.price > 0
      ? Math.round((lifetime.price / annual.price) * 2) / 2
      : null;

  function selectPlan(p: PlanId) {
    hapticSelect();
    logEvent("paywall_tier_selected", { tier: p });
    setPlan(p);
  }

  // Leaves the paywall.
  async function exit() {
    resetPaywallTrialCache();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }

  // Downsell trigger, shared by an explicit dismiss and a cancelled purchase:
  // the paywall must be closed at least twice, 24h apart from the first close,
  // before a downsell can show at all (2.3.4 - the first close alone used to
  // convert 0/16); after that gate, the existing single 7-day re-armed retry,
  // capped at 2 lifetime shows, applies unchanged. An active Pro/trial user is
  // never shown a discount on their own subscription, and a lifetime show is
  // only spent once a REAL discount is confirmed to exist - never on an empty
  // offering. Falls back to exit otherwise.
  async function triggerDownsell() {
    if (isProUser) {
      await exit();
      return;
    }
    const now = Date.now();
    const state = await recordPaywallDismissed(now);
    if (!canShowDownsell(state, now)) {
      await exit();
      return;
    }
    const offer = await getDownsellOffer();
    if (!offer.hasRealDiscount) {
      await exit();
      return;
    }
    await recordDownsellShown(context, now);
    router.replace({ pathname: "/downsell", params: { trigger: context } });
  }

  async function dismiss() {
    logEvent("paywall_dismiss", { source: reason ?? "direct" });
    await triggerDownsell();
  }

  // Title-only reasons (insights, export) have no matching limitBody* copy: the
  // nudge from those screens is a one-line "this is part of Pro", not a full
  // limit explanation, so `body` stays optional and the card below only renders
  // it when present.
  const limit: { title: string; body?: string } | null =
    reason === "after_logs"
      ? {
          title: t("paywall.limitTitleAfterLogs"),
          body: t("paywall.limitBodyAfterLogs", { health: healthName }),
        }
      : reason === "health"
        ? { title: t("paywall.limitTitleHealth"), body: t("paywall.limitBodyHealth", { health: healthName }) }
        : reason === "foods"
          ? {
              title: t("paywall.limitTitleFoods"),
              body: t("paywall.limitBodyFoods", { limit: FREE_CUSTOM_FOOD_LIMIT }),
            }
          : reason === "profiles"
            ? { title: t("paywall.limitTitleProfiles"), body: t("paywall.limitBodyProfiles") }
            : reason === "rotation"
              ? { title: t("paywall.limitTitleRotation"), body: t("paywall.limitBodyRotation") }
              : reason === "mealResponse"
                ? { title: t("paywall.limitTitleMealResponse"), body: t("paywall.limitBodyMealResponse") }
                : reason === "spike"
                  ? {
                      title: t("paywall.limitTitleSpike"),
                      body: t("paywall.limitBodySpike"),
                    }
                  : reason === "insights"
                    ? { title: t("paywall.limitTitleInsights") }
                    : reason === "export"
                      ? { title: t("paywall.limitTitleExport") }
                      : null;

  // The day-1 Health nudge, armed only where it can pay off: Health usable on
  // this device and not connected yet (see shouldScheduleTrialNudge).
  async function armTrialNudge(days: number) {
    try {
      const connected = await getHealthSyncEnabled(profileId);
      if (!shouldScheduleTrialNudge({ trialDays: days, healthAvailable, healthConnected: connected })) {
        return;
      }
      await scheduleTrialDay1Nudge();
    } catch (err) {
      logCrash(err, { screen: "paywall", op: "trialNudge" });
    }
  }

  // What a completed purchase or restore did to the trial is read from the
  // STORE, not from the offer the screen showed: the same package starts a trial
  // for one account and a paid period for another (the intro offer was already
  // used elsewhere), and an already-owned recovery is not a new trial at all.
  // What the store's answer means (the event, the reminder and the day it is
  // timed from, taking a stale one down) is decided in lib/trialSettle; this
  // only carries the action out.
  function applyTrialAction(action: TrialSettleAction) {
    if (action.logTrialStarted) logEvent("trial_started", { tier: plan });
    if (action.scheduleReminderAt !== null) {
      const endsAt = action.scheduleReminderAt;
      const days = action.trialDays ?? trialDays;
      // The nudge goes second: the reminder is what may raise the
      // notification permission prompt, and the nudge never prompts.
      scheduleTrialEndingReminder(endsAt)
        .catch((err) => logCrash(err, { screen: "paywall", op: "trialReminder" }))
        .then(() => armTrialNudge(days));
    }
    if (action.cancelReminder) {
      cancelTrialReminder().catch((err) =>
        logCrash(err, { screen: "paywall", op: "cancelTrialReminder" })
      );
    }
  }

  async function settleTrial(res: PurchaseOutcome) {
    try {
      applyTrialAction(
        trialSettleAction({
          restored: false,
          trial: await trialAfterPurchase(res),
          offerDays: trialDays,
          now: Date.now(),
        })
      );
    } catch (err) {
      // The purchase already went through: nothing here may hold up its success.
      logCrash(err, { screen: "paywall", op: "settleTrial" });
    }
  }

  async function settleRestoredTrial() {
    try {
      applyTrialAction(
        trialSettleAction({ restored: true, trialStatus: await getTrialStatus() })
      );
    } catch (err) {
      logCrash(err, { screen: "paywall", op: "settleTrial" });
    }
  }

  // A new trial or purchase lands on the Pro welcome. `replace`, so back never
  // returns to the paywall; skipped when every step is already done.
  async function leaveAfterPurchase() {
    const steps = withHealthMirror(
      await getProWelcomeState(),
      await getHealthSyncEnabled(profileId)
    );
    if (shouldAutoOpenWelcome(steps, healthAvailable)) {
      resetPaywallTrialCache();
      router.replace("/pro-welcome");
      return;
    }
    await exit();
  }

  async function buy() {
    if (busy) return;
    setBusy(true);
    try {
      logEvent("paywall_cta", { tier: plan });
      const res = await purchasePro(plan);
      await refreshPro();
      const feedback = purchaseToastFor(res);
      logEvent("purchase_result", {
        result: res.ok ? "success" : res.cancelled ? "cancelled" : "error",
        product: plan,
        reason: reason ?? "direct",
        variant: PAYWALL_VARIANT,
        trial: plan === "annual" && eventTrial,
        detail:
          res.ok || res.cancelled ? "none" : res.error === "alreadyOwned" ? "already_owned" : "store_error",
      });
      if (res.ok) {
        clearPaywallTrial();
        logEvent("purchase_completed", { tier: plan, source: reason ?? "direct" });
        await settleTrial(res);
        hapticSuccess();
        // Success, or an already-owned recovery ("this is already yours").
        if (feedback) toast(t(feedback.key), feedback.kind);
        await leaveAfterPurchase();
      } else if (res.cancelled) {
        // A cancelled purchase is a downsell trigger too (same lifetime cap).
        await triggerDownsell();
      } else if (feedback) {
        // Real store error: an honest message instead of a silent stay.
        toast(t(feedback.key), feedback.kind);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRestore() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await restore();
      await refreshPro();
      if (result === "restored") {
        clearPaywallTrial();
        await settleRestoredTrial();
        hapticSuccess();
        toast(t("paywall.restored"), "success");
        await exit();
      } else if (result === "none") {
        toast(t("paywall.nothingToRestore"), "info");
      } else {
        toast(t("paywall.restoreFailed"), "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const ctaTrial = plan === "annual" && annualTrial;

  // The timeline under the CTA: today, the reminder (only when one is really
  // armed, buildTrialTimeline drops it for a trial too short to leave room) and
  // the first charge with the yearly total and its monthly equivalent. Prices
  // are isolated LTR so a right-to-left sentence cannot reorder them.
  const annualTotal = isolateLtr(priceStr("annual") ?? "");
  const chargeBody = annualPerMonth
    ? t("paywall.timeline.chargeBody", {
        price: annualTotal,
        perMonth: isolateLtr(annualPerMonth),
      })
    : t("paywall.timeline.chargeBodyPlain", { price: annualTotal });
  const timelineRows = ctaTrial
    ? buildTrialTimeline(trialDays, reminderOk).map((row) => ({
        kind: row.kind,
        label:
          row.kind === "today"
            ? t("paywall.timeline.today")
            : t("paywall.timeline.day", { day: row.day }),
        body:
          row.kind === "today"
            ? t("paywall.timeline.todayBody")
            : row.kind === "reminder"
              ? t("paywall.timeline.reminderBody")
              : chargeBody,
      }))
    : [];
  const cancelLine =
    Platform.OS === "ios"
      ? t("paywall.timeline.cancelIos")
      : t("paywall.timeline.cancelAndroid");
  const ctaLabel = ctaTrial
    ? t("paywall.ctaTrial", { days: trialDays })
    : t("paywall.cta");

  const loading = offer === null;
  const unavailable = offer?.status === "unavailable";

  const benefits = [
    { icon: "document-text-outline" as const, text: t("paywall.benefitPdf") },
    { icon: "analytics-outline" as const, text: t("paywall.benefitTrends") },
    ...(healthAvailable
      ? [
          {
            icon: "heart-outline" as const,
            text: t(Platform.OS === "ios" ? "paywall.benefitImportIos" : "paywall.benefitImportAndroid"),
          },
        ]
      : []),
  ];

  // A limit context (health/foods/...) takes over the headline with its own
  // title: the generic offer is not the point when the visitor hit a wall.
  const heroHeadline = limit
    ? limit.title
    : annualTrial
      ? t("paywall.headlineTrial", { days: trialDays })
      : t("paywall.headline");

  return (
    <AppBackground>
      <View
        className="flex-1"
        style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}
      >
        {/* Header (mockup 08 originally had a free-text exit on the left too;
            2.3.5 drops it - the App Store rule only requires a visible close
            control, not two of them, and the second exit read as confusing.
            A left spacer matching the close tile's width keeps the title
            centred exactly as before.) */}
        <View className="flex-row items-center justify-between px-4 py-2">
          <View style={{ width: 30 }} />
          <Text
            style={{
              color: THEME.ink,
              fontSize: 16,
              fontWeight: "800",
              flexShrink: 1,
              minWidth: 0,
              marginHorizontal: 8,
            }}
            numberOfLines={1}
          >
            {t("paywall.title")}
          </Text>
          <View className="flex-row items-center" style={{ flexShrink: 0 }}>
            <Pressable
              onPress={dismiss}
              hitSlop={10}
              accessibilityLabel={t("common.close")}
            >
              <IconTile icon="close" size={30} radius={10} tint={THEME.muted} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[
            // No pinned CTA band while loading/unavailable (see the band's own
            // guard below), so nothing needs clearing beyond the flat 24; once
            // real plans render, the band is pinned outside the scroll and the
            // scroll's own bottom padding has to clear it plus the safe area.
            {
              paddingTop: 20,
              paddingBottom: loading || unavailable ? insets.bottom + 24 : 24,
            },
            columnPad(20),
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Compact headline; a limit context (health/foods/...) puts its own
              title/body in the same slots. Neither line is a health claim. */}
          <View style={{ alignItems: "center", marginBottom: 12 }}>
            <Text
              style={{
                color: THEME.ink,
                fontSize: 20,
                fontWeight: "800",
                lineHeight: 26,
                textAlign: "center",
              }}
            >
              {heroHeadline}
            </Text>
            {limit ? (
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 13,
                  lineHeight: 18,
                  textAlign: "center",
                  marginTop: 4,
                }}
              >
                {limit.body}
              </Text>
            ) : null}
          </View>

          <PaywallPreview compact />

          <View style={{ marginBottom: 6, paddingHorizontal: 4 }}>
            {benefits.map((b) => (
              <View
                key={b.icon}
                style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}
              >
                <Ionicons name={b.icon} size={16} color={THEME.accent} />
                <Text
                  style={{ color: THEME.ink, flex: 1, marginStart: 10, fontSize: 13, lineHeight: 18 }}
                >
                  {b.text}
                </Text>
              </View>
            ))}
            <Text style={{ color: THEME.muted, fontSize: 12, marginStart: 26, marginBottom: 6 }}>
              {t("paywall.featureShortFamily")}
            </Text>
          </View>

          {personal ? (
            <View
              style={{
                borderStartWidth: 2,
                borderStartColor: THEME.border,
                paddingStart: 10,
                marginHorizontal: 4,
                marginBottom: 12,
              }}
            >
              <Text style={{ color: THEME.ink, fontSize: 12, fontWeight: "700", marginBottom: 2 }}>
                {t("paywall.timeline.personalLabel")}
              </Text>
              <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17 }}>
                {t("paywall.timeline.personal", {
                  n: personal.readings,
                  avg: isolateLtr(
                    `${formatGlucose(personal.avgMgdl, glucoseUnit)} ${glucoseUnitLabel(glucoseUnit)}`
                  ),
                  inRange: isolateLtr(pct(personal.inRangePct)),
                })}
              </Text>
            </View>
          ) : null}

          {/* Only while the last store read failed: says so and puts a real
              "Restore purchases" button within reach (the small link at the
              bottom stays as it was). */}
          {!loading ? <StoreStatusNotice onRestore={onRestore} busy={busy} /> : null}

          {loading ? (
            // Same waiting composition as downsell / winback: a spinner carries
            // the wait so the plan slot never reads as a broken empty band.
            <GlassCard style={{ alignItems: "center", paddingVertical: 28 }}>
              <ActivityIndicator color={THEME.accent} />
              <Text style={{ color: THEME.muted, marginTop: 10 }}>
                {t("common.loading")}
              </Text>
            </GlassCard>
          ) : unavailable ? (
            // Release-only: prices could not be loaded. Never show fake prices;
            // offer a retry instead.
            <GlassCard style={{ alignItems: "center", paddingVertical: 20 }}>
              <IconTile icon="cloud-offline-outline" size={44} radius={14} tint={THEME.muted} />
              <Text
                style={{ color: THEME.muted, textAlign: "center", marginTop: 12, marginBottom: 14 }}
              >
                {t("paywall.pricesUnavailable")}
              </Text>
              <GradientCTA
                label={t("paywall.retry")}
                onPress={() => setReloadToken((n) => n + 1)}
                style={{ alignSelf: "stretch" }}
              />
            </GlassCard>
          ) : (
            <>
              {/* Plans */}
              <PlanCard
                selected={plan === "monthly"}
                onSelect={() => selectPlan("monthly")}
                name={t("paywall.planMonthly")}
                price={priceStr("monthly")}
                period={t("paywall.perMonth")}
              />
              <PlanCard
                selected={plan === "annual"}
                onSelect={() => selectPlan("annual")}
                name={t("paywall.planAnnual")}
                desc={
                  annualTrial
                    ? t("paywall.annualTrialDesc", { days: trialDays })
                    : t("paywall.annualDesc")
                }
                foot={
                  annualPerMonth
                    ? t("paywall.perMonthApprox", { price: annualPerMonth })
                    : undefined
                }
                price={priceStr("annual")}
                period={t("paywall.perYear")}
                badge={t("paywall.mostPopular")}
                // Bidi: "50%" still got the sign glued onto the translated
                // word instead of the number under RTL (writingDirection on
                // the badge Text alone was verified NOT enough on-device);
                // isolating just the number+sign pair holds it as one block.
                save={
                  savePct > 0
                    ? t("paywall.savePercent", { percent: isolateLtr(pct(savePct)) })
                    : undefined
                }
              />
              <PlanCard
                selected={plan === "lifetime"}
                onSelect={() => selectPlan("lifetime")}
                name={t("paywall.planLifetime")}
                foot={
                  lifetimeYears != null
                    ? t("paywall.lifetimeAnchor", {
                        years: isolateLtr(num(lifetimeYears)),
                      })
                    : undefined
                }
                price={priceStr("lifetime")}
                period={t("paywall.perOnce")}
                badge={t("paywall.lifetimeBadge")}
              />
            </>
          )}

          <Text
            style={{
              color: THEME.muted,
              fontSize: 11,
              textAlign: "center",
              paddingHorizontal: 8,
              lineHeight: 16,
              marginTop: 16,
            }}
          >
            {t("paywall.legalNote")}
          </Text>
          {/* Bottom band: restore + privacy + terms, one 11pt row. */}
          <View
            className="flex-row items-center justify-center flex-wrap mt-2"
            style={{ gap: 6 }}
          >
            <Pressable onPress={onRestore} disabled={busy}>
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 11,
                  fontWeight: "600",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {t("paywall.restore")}
              </Text>
            </Pressable>
            <Text style={{ color: THEME.muted, fontSize: 11 }}>·</Text>
            <Pressable onPress={() => Linking.openURL(privacyUrl())}>
              <Text
                style={{ color: THEME.muted, fontSize: 11, textDecorationLine: "underline" }}
              >
                {t("settings.privacy")}
              </Text>
            </Pressable>
            <Text style={{ color: THEME.muted, fontSize: 11 }}>·</Text>
            <Pressable onPress={() => Linking.openURL(termsUrl())}>
              <Text
                style={{ color: THEME.muted, fontSize: 11, textDecorationLine: "underline" }}
              >
                {t("settings.terms")}
              </Text>
            </Pressable>
          </View>

        </ScrollView>

        {/* Pinned CTA band: only once real plans are on screen (loading /
            unavailable keep their own in-scroll composition, no CTA to pin). */}
        {!loading && !unavailable ? (
          <View
            style={[
              {
                borderTopWidth: 1,
                borderTopColor: THEME.border,
                backgroundColor: THEME.bg.g1,
                paddingTop: 12,
                paddingBottom: insets.bottom + 12,
              },
              columnPad(20),
            ]}
          >
            <GradientCTA label={ctaLabel} disabled={busy} onPress={buy} />
            {timelineRows.length > 0 ? (
              <View style={{ marginTop: 10, paddingHorizontal: 4 }}>
                {timelineRows.map((row, i) => (
                  <View
                    key={row.kind}
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      marginTop: i === 0 ? 0 : 5,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        marginTop: 4,
                        marginEnd: 8,
                        backgroundColor: row.kind === "charge" ? THEME.muted : THEME.accent,
                      }}
                    />
                    {/* Label and body are one wrapping paragraph (no fixed
                        column, no single-line clip), so the longest translation
                        just takes a second line. */}
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{ color: THEME.muted, fontSize: 12, lineHeight: 16, flex: 1 }}
                    >
                      <Text style={{ color: THEME.ink, fontWeight: "800" }}>{row.label}</Text>
                      {"  "}
                      {row.body}
                    </Text>
                  </View>
                ))}
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{ color: THEME.muted, fontSize: 11, lineHeight: 15, marginTop: 8 }}
                >
                  {cancelLine}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function PaywallRoute() {
  return (
    <SafeAreaProvider>
      <PaywallScreen />
    </SafeAreaProvider>
  );
}
