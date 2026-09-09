import React, { useEffect, useState } from "react";
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
import { isolateLtr, money, pct } from "../lib/format";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  purchasePro,
  restore,
  loadOfferings,
  getDownsellOffer,
  type OfferingsResult,
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
  scheduleTrialEndingReminder,
} from "../lib/services/notifications";
import { FREE_CUSTOM_FOOD_LIMIT } from "../lib/guardrails";
import { useHealthAvailable } from "../lib/services/healthAvailability";
import { privacyUrl, termsUrl } from "../lib/legal";
import { logEvent, type PaywallViewSource } from "../lib/analytics";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { insulinModeUsesInsulin } from "../lib/insulinMode";
import { useLayout } from "../lib/useLayout";

/** Used only if the annual plan's own offering data has no trial length. */
const FALLBACK_TRIAL_DAYS = 7;

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

  // Real localized store prices + trial state. In release, a failed fetch
  // yields status 'unavailable' (never a hardcoded fallback) → retry state.
  useEffect(() => {
    let alive = true;
    setOffer(null);
    loadOfferings()
      .then((r) => alive && setOffer(r))
      .catch(() => alive && setOffer({ status: "unavailable", isDevFallback: false, plans: {} }));
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const plans = offer?.plans ?? {};
  const annualTrial = plans.annual?.hasFreeTrial ?? false;
  // Store-reported trial length (RC intro offer), so an A/B on the trial
  // length never needs a code change; falls back to the shipped default.
  const trialDays = plans.annual?.freeTrialDays || FALLBACK_TRIAL_DAYS;

  useEffect(() => {
    if (!offer) return;
    logEvent("paywall_view", {
      source: reason ?? "direct",
      trial_eligible: annualTrial,
      context,
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
  const annualPerMonth =
    annual && annual.price > 0
      ? money(annual.price / 12, annual.currencyCode)
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

  async function buy() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await purchasePro(plan);
      await refreshPro();
      const feedback = purchaseToastFor(res);
      if (res.ok) {
        logEvent("purchase_completed", { tier: plan, source: reason ?? "direct" });
        if (plan === "annual" && annualTrial) {
          // A fresh trial starts: schedule its own ending reminder. Scheduling
          // uses the same fixed identifier as cancelTrialReminder, so it already
          // replaces any stale one on its own - calling cancel here too would
          // race the two un-awaited calls and risk cancelling the one just armed.
          logEvent("trial_started", { tier: "annual", source: reason ?? "direct" });
          scheduleTrialEndingReminder(trialDays).catch(() => {});
        } else {
          // No trial in this purchase (lifetime, monthly, or a non-trial annual):
          // any trial-ending reminder left over from an earlier trial must not
          // survive a completed purchase.
          cancelTrialReminder().catch(() => {});
        }
        hapticSuccess();
        // Success, or an already-owned recovery ("this is already yours").
        if (feedback) toast(t(feedback.key), feedback.kind);
        await exit();
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
        // A restored entitlement is already paid (lifetime or subscription): any
        // trial-ending reminder from an earlier trial no longer applies.
        cancelTrialReminder().catch(() => {});
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
  // scheduleTrialEndingReminder skips scheduling entirely once trialDays leaves
  // no room before its 2-day lead (trialDays <= 2), so the "we'll remind you"
  // note must not promise a reminder that is never actually armed.
  const trialReminderArmed = trialDays > 2;
  const ctaLabel = ctaTrial
    ? t("paywall.ctaTrial", { days: trialDays })
    : t("paywall.cta");

  const loading = offer === null;
  const unavailable = offer?.status === "unavailable";

  const shortFeatures = [
    ...(healthAvailable
      ? [t("paywall.featureShortHealth", { health: healthName })]
      : []),
    t("paywall.featureShortInsights"),
    t("paywall.featureShortFamily"),
    t("paywall.featureShortPdf"),
    ...(insulinModeUsesInsulin(activeProfile?.insulin_mode)
      ? [t("paywall.featureShortInjection")]
      : []),
  ];
  const featureGrid = shortFeatures.slice(0, 4);

  // One 22pt headline, one 13pt subline. A limit context (health/foods/...)
  // takes over both slots with its own title/body instead of sitting in a
  // second box underneath - the generic offer headline is not the point when
  // the visitor already hit a specific wall.
  const heroHeadline = limit
    ? limit.title
    : annualTrial
      ? t("paywall.headlineTrial", { days: trialDays })
      : t("paywall.headline");
  const heroSubline = limit ? limit.body : t("paywall.heroValue");

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
          {/* Hero: one headline, one subline underneath. A limit context
              (health/foods/...) takes over both slots with its own
              title/body instead of a second box below - the offer has to be
              stated in the visitor's own terms when they already hit a wall.
              Neither line is a health claim: both describe where things are
              kept, not what they will do for anyone. */}
          <GlassCard glow style={{ alignItems: "center", paddingVertical: 20, marginBottom: 14 }}>
            <Text
              style={{
                color: THEME.ink,
                fontSize: 22,
                fontWeight: "800",
                lineHeight: 28,
                textAlign: "center",
              }}
            >
              {heroHeadline}
            </Text>
            {heroSubline ? (
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 13,
                  lineHeight: 18,
                  textAlign: "center",
                  marginTop: 6,
                }}
              >
                {heroSubline}
              </Text>
            ) : null}
          </GlassCard>

          {/* Benefits: a 2x2 grid of short labels instead of four full
              sentences, so the four benefits read at a glance in every
              language. Health sync now shows on both platforms (HealthKit /
              Health Connect), so a profile that also doses can push the
              injection label off the 4-slot cap - that label itself only
              applies to a profile that actually doses, so an insulin-free /
              undiagnosed user never loses a slot to it. */}
          <GlassCard style={{ paddingVertical: 16, marginBottom: 16 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {featureGrid.map((text, i) => (
                <View
                  key={i}
                  style={{
                    width: "50%",
                    flexDirection: "row",
                    alignItems: "center",
                    paddingRight: i % 2 === 0 ? 8 : 0,
                    paddingLeft: i % 2 === 1 ? 8 : 0,
                    marginTop: i >= 2 ? 12 : 0,
                  }}
                >
                  <Ionicons name="checkmark-circle" size={14} color={THEME.accent} />
                  {/* numberOfLines: outcome-phrased labels (2.3.5) run longer
                      in German/French than the old single-word ones; two
                      lines keeps a long translation from being clipped
                      instead of shrinking the whole row. */}
                  <Text
                    style={{ color: THEME.ink, flex: 1, marginLeft: 8, fontSize: 12 }}
                    numberOfLines={2}
                  >
                    {text}
                  </Text>
                </View>
              ))}
            </View>
          </GlassCard>

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
                        years: isolateLtr(String(lifetimeYears)),
                      })
                    : undefined
                }
                price={priceStr("lifetime")}
                period={t("paywall.perOnce")}
                badge={t("paywall.lifetimeBadge")}
              />
            </>
          )}

          {/* Bottom band: restore + privacy + terms, one 11pt row. */}
          <View
            className="flex-row items-center justify-center flex-wrap mt-4"
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

          <Text
            style={{
              color: THEME.muted,
              fontSize: 11,
              textAlign: "center",
              paddingHorizontal: 8,
              lineHeight: 16,
              marginTop: 10,
            }}
          >
            {t("paywall.legalNote")}
          </Text>
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
            {ctaTrial && trialReminderArmed ? (
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 11,
                  textAlign: "center",
                  marginTop: 8,
                  lineHeight: 16,
                  paddingHorizontal: 8,
                }}
              >
                {t("paywall.trialNote")}
              </Text>
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
