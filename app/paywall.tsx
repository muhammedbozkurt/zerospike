import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import {
  AppBackground,
  GlassCard,
  GradientCTA,
  IconTile,
} from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { GLUCOSE_RICH, MODAL_TOP_PAD, SPACE, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { useThemeRemountLock } from "../lib/theme/ThemeProvider";
import { STACK_AT_SCALE, linesFor } from "../lib/layoutForFontScale";
import { useFontScale } from "../lib/useFontScale";
import { isolateLtr, money, num, pct } from "../lib/format";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  purchasePro,
  restore,
  loadOfferings,
  getTrialStatus,
  trialAfterPurchase,
  type OfferingsResult,
  type PurchaseOutcome,
  PlanId,
} from "../lib/services/purchases";
import { newPaywallExitController, type DownsellTrigger } from "../lib/services/downsell";
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
import { Button, Txt } from "../components/ui";
import { LegalLink } from "../components/LegalLink";
import { listManualSugarLogs } from "../lib/db/logs";
import { rangeFromWindow } from "../lib/insights";
import { targetBandFor } from "../lib/agpChart";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import { clearPaywallTrial, getPaywallTrialGen, primePaywallTrial, resetPaywallTrialCache } from "../lib/proCta";
import { PaywallPreview } from "../components/PaywallPreview";
import { lifetimeYearsOfAnnual } from "../lib/paywallPricing";
import { PAYWALL_LAYOUT, paywallPreviewVisible } from "../lib/paywallLayout";
import {
  paywallCtaKind,
  purchaseUiBusy,
  shouldOpenWelcomeAfterPurchase,
  showTrialTimeline,
  type PurchaseUiState,
} from "../lib/paywallPurchase";
import { createPurchaseFlow, type PurchaseFlowDeps } from "../lib/paywallBuyFlow";
import { PAYWALL_VERSION } from "../lib/analytics/eventSchema";
import { logRestoreResult } from "../lib/analytics/restoreResult";
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
import { useScrollHint } from "../lib/useScrollHint";
import { hintBottomOffset } from "../lib/scrollHint";
import { ScrollHint } from "../components/ScrollHint";

type PurchaseFlowLive = Omit<
  PurchaseFlowDeps<PurchaseOutcome>,
  "isExiting" | "abandonPendingExit" | "purchase" | "onState"
>;

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
  // Large text: the billed amount drops under the plan terms instead of
  // taking a column the name and terms would have to wrap around.
  const fontScale = useFontScale();
  const stackPrice = fontScale > STACK_AT_SCALE;
  const priceBlock = (
    <View className={stackPrice ? "items-start mt-1" : "items-end ml-2"}>
      {price ? (
        <Text style={[TABULAR, { color: THEME.text, fontSize: 20, fontWeight: "800" }]}>
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
      <Text style={{ color: THEME.textMuted, fontSize: 11 }}>{period}</Text>
    </View>
  );
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="rounded-2xl px-4 flex-row items-center"
      style={[
        {
          paddingVertical: PAYWALL_LAYOUT.planPadV,
          marginBottom: PAYWALL_LAYOUT.planGap,
          borderWidth: 1,
          borderColor: selected ? THEME.accent : THEME.border,
          backgroundColor: selected ? withAlpha(THEME.accent, 0.12) : THEME.surface,
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
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: THEME.accentFill }}
          />
        ) : null}
      </View>

      <View className="flex-1">
        <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
          <Text style={{ color: THEME.text, fontWeight: "800", fontSize: 15 }}>{name}</Text>
          {badge ? (
            <View className="rounded-full bg-brand px-2 py-0.5">
              <Text className="text-onAccent text-[10px] font-bold">{badge}</Text>
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
                  color: THEME.scheme === "light" ? THEME.text : GLUCOSE_RICH.target,
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
          <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 2 }} numberOfLines={linesFor(fontScale, 2)}>
            {desc}
          </Text>
        ) : null}
        {foot ? (
          <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 1 }}>{foot}</Text>
        ) : null}
        {stackPrice ? priceBlock : null}
      </View>

      {/* The billed amount, dominant. A plan whose store price is missing shows a
          placeholder bar instead of an empty slot in the loudest spot on the row. */}
      {stackPrice ? null : priceBlock}
    </Pressable>
  );
}

/**
 * One row of the trial timeline: a dot, a bold when-label and a body in a single
 * wrapping paragraph (no fixed column, no line cap), so the longest translation
 * just takes a second line.
 */
function TimelineRow({
  row,
  first,
}: {
  row: { kind: string; label: string; body: string };
  first: boolean;
}) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-start", marginTop: first ? 0 : 5 }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          marginTop: 4,
          marginEnd: 8,
          backgroundColor: row.kind === "charge" ? THEME.textMuted : THEME.accentFill,
        }}
      />
      <Text
        style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 16, flex: 1 }}
      >
        <Text style={{ color: THEME.text, fontWeight: "800" }}>{row.label}</Text>
        {"  "}
        {row.body}
      </Text>
    </View>
  );
}

function PaywallScreen() {
  const { t } = useTranslation();
  const paywallFontScale = useFontScale();
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
  const scrollHint = useScrollHint("paywall");
  const { columnPad, height: windowHeight } = useLayout();
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
  useThemeRemountLock();
  const { refreshPro, activeProfile, isProUser } = useApp();
  const { toast } = useFeedback();
  // The purchase button's state machine lives in the flow (lib/paywallBuyFlow,
  // tested with mock deps); the screen mirrors its state for rendering. The flow
  // reads its own state synchronously, so a second tap in the same tick (before
  // React re-renders the disabled button) never reaches the store.
  const [ui, setUi] = useState<PurchaseUiState>("idle");
  // An exit decision (X, or a cancelled sheet that is leaving) holds the lock:
  // the button is disabled for the whole lookup, not only the store call.
  const [exitingUi, setExitingUi] = useState(false);
  const busy = purchaseUiBusy(ui) || exitingUi;
  const purchasing = ui === "purchasing" || ui === "done";
  const failed = ui === "failed";
  const pendingApproval = ui === "pending";
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
      paywall_version: PAYWALL_VERSION,
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
  const lifetime = plans.lifetime;
  const lifetimeYears = lifetimeYearsOfAnnual(lifetime, annual);

  function selectPlan(p: PlanId) {
    hapticSelect();
    logEvent("paywall_tier_selected", { tier: p, paywall_version: PAYWALL_VERSION });
    // A failed purchase leaves "try again" on the button; choosing another plan
    // gives that plan's own label back.
    flowRef.current!.planChanged();
    setPlan(p);
  }

  // Leaving the paywall. usePreventRemove holds EVERY removal of this screen
  // (X, Android back, iOS swipe-down; with it set, native-stack also disables
  // the native dismiss gesture) until a navigation of our own has set
  // allowLeave. That is STATE, not a ref: the navigation only runs from the
  // effect below, after the re-render that lifted the hold. navStartedRef makes
  // the whole thing single-shot, so overlapping exits cannot navigate twice.
  const navigation = useNavigation();
  const [allowLeave, setAllowLeave] = useState(false);
  const navStartedRef = useRef(false);
  const afterAllowRef = useRef<(() => void) | null>(null);

  function leaveWith(go: () => void) {
    if (navStartedRef.current) return;
    navStartedRef.current = true;
    afterAllowRef.current = go;
    setAllowLeave(true);
  }

  useEffect(() => {
    if (!allowLeave) return;
    const go = afterAllowRef.current;
    afterAllowRef.current = null;
    go?.();
  }, [allowLeave]);

  // Downsell trigger, shared by an explicit dismiss and a cancelled purchase.
  // 2.4: with the ANNUAL plan selected, the exit opens the discounted offer in
  // the SAME session, once, when a real store discount is confirmed; afterwards
  // the 7-day cool-off and the two-show lifetime cap apply (lib/downsellGate).
  // Pro users and screenshot mode just leave. The controller serialises
  // overlapping exits and reserves the session slot before any await; the
  // lifetime show itself is recorded by the downsell screen.
  const exitCtlRef = useRef<ReturnType<typeof newPaywallExitController> | null>(null);
  if (exitCtlRef.current === null) {
    exitCtlRef.current = newPaywallExitController(
      {
        closePaywall: () => exit(),
        openDownsell: () =>
          leaveWith(() =>
            router.replace({ pathname: "/downsell", params: { trigger: context } })
          ),
      },
      () => flowRef.current!.isBusy()
    );
  }

  const flowRef = useRef<ReturnType<typeof createPurchaseFlow<PurchaseOutcome>> | null>(null);
  if (flowRef.current === null) {
    flowRef.current = createPurchaseFlow<PurchaseOutcome>({
      isExiting: () => exitCtlRef.current!.isExiting(),
      abandonPendingExit: () => exitCtlRef.current!.abandonPendingExit(),
      purchase: (p) => purchasePro(p),
      refreshPro: () => liveRef.current!.refreshPro(),
      onPress: (p) => liveRef.current!.onPress(p),
      onResult: (p, r) => liveRef.current!.onResult(p, r),
      onSuccess: (p, r) => liveRef.current!.onSuccess(p, r),
      onCancelled: (p) => liveRef.current!.onCancelled(p),
      onPending: (p, r) => liveRef.current!.onPending(p, r),
      onFailed: (p, r, e) => liveRef.current!.onFailed(p, r, e),
      onPostPurchaseError: (e) => liveRef.current!.onPostPurchaseError(e),
      onState: setUi,
    });
  }

  // Pro arriving while the paywall is open and nothing here caused it (an Ask to
  // Buy approval, a restore that finished late, another device) ends the sale:
  // the paywall closes and the app root opens the welcome. A purchase or restore
  // of this screen is busy and leaves through its own path.
  const arrivedFreeRef = useRef(!isProUser);
  useEffect(() => {
    if (!isProUser) {
      arrivedFreeRef.current = true;
      return;
    }
    if (!arrivedFreeRef.current) return;
    arrivedFreeRef.current = false;
    if (flowRef.current!.isBusy() || exitCtlRef.current!.isExiting()) return;
    exit();
  }, [isProUser]);

  // Leaves the paywall.
  function exit() {
    resetPaywallTrialCache();
    leaveWith(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)");
      }
    });
  }

  // A cancelled store sheet. The paywall is NOT closed by it: only a "downsell"
  // decision (annual selected, a verified discount, an open gate) leaves; any
  // other decision releases the lock and the button simply returns to normal.
  async function afterCancel() {
    const ctl = exitCtlRef.current!;
    await ctl.requestAfterCancel({ plan: planRef.current, isPro: isProRef.current });
    if (ctl.isExiting()) setExitingUi(true);
  }

  // User-initiated close (X, back, swipe): ignored while a purchase or restore
  // is being processed. While the decision is pending the button is locked.
  async function dismiss() {
    const ctl = exitCtlRef.current!;
    await ctl.requestUserClose({ plan: planRef.current, isPro: isProRef.current }, () => {
      logEvent("paywall_dismiss", {
        source: reason ?? "direct",
        paywall_version: PAYWALL_VERSION,
      });
      setExitingUi(true);
    });
    // A decision that ended without leaving (a purchase took over) unlocks.
    if (!ctl.isExiting()) setExitingUi(false);
  }

  const planRef = useRef(plan);
  planRef.current = plan;
  const isProRef = useRef(isProUser);
  if (isProUser) isProRef.current = true;
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  usePreventRemove(!allowLeave, ({ data }) => {
    const type = data.action.type;
    if (type === "GO_BACK" || type === "POP") {
      void dismissRef.current();
      return;
    }
    // Anything else (notification tap, deep link, a layout redirect) is not a
    // dismissal: let it reach its target.
    leaveWith(() => navigation.dispatch(data.action));
  });

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
                  : reason === "nightscout"
                    ? {
                        title: t("paywallReason.nightscoutTitle"),
                        body: t("paywallReason.nightscoutBody"),
                      }
                    : reason === "carbEstimate"
                      ? {
                          title: t("paywallReason.carbEstimateTitle"),
                          body: t("paywallReason.carbEstimateBody"),
                        }
                      : reason === "cgmHistory"
                        ? {
                            title: t("paywallReason.cgmHistoryTitle"),
                            body: t("paywallReason.cgmHistoryBody"),
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

  // A new trial or purchase always lands on the Pro welcome (one page, three
  // steps, one button). `replace`, so back never returns to the paywall. Only an
  // already-owned recovery keeps the older rule: the welcome opens for it just
  // while a step is still open.
  async function leaveAfterPurchase(recovered: boolean) {
    let stepsLeft = false;
    if (recovered) {
      const steps = withHealthMirror(
        await getProWelcomeState(),
        await getHealthSyncEnabled(profileId)
      );
      stepsLeft = shouldAutoOpenWelcome(steps, healthAvailable);
    }
    if (shouldOpenWelcomeAfterPurchase({ recovered, stepsLeft })) {
      resetPaywallTrialCache();
      leaveWith(() => router.replace("/pro-welcome"));
      return;
    }
    await exit();
  }

  // The flow's side effects. Re-assigned every render so they read the current
  // plan, translations and toast; the flow itself is created once.
  const liveRef = useRef<PurchaseFlowLive | null>(null);
  liveRef.current = {
    refreshPro,
    onPress: (p) => logEvent("paywall_cta", { tier: p, paywall_version: PAYWALL_VERSION }),
    onResult: (p, res) => {
      // A payment held for approval is neither a result nor an error: nothing
      // is reported until it is approved (purchase_completed at that point).
      if (res.error === "pending") return;
      logEvent("purchase_result", {
        result: res.ok ? "success" : res.cancelled ? "cancelled" : "error",
        product: p,
        reason: reason ?? "direct",
        variant: PAYWALL_VARIANT,
        trial: p === "annual" && eventTrial,
        detail:
          res.ok || res.cancelled ? "none" : res.error === "alreadyOwned" ? "already_owned" : "store_error",
        paywall_version: PAYWALL_VERSION,
        source: "paywall",
      });
    },
    onSuccess: async (p, res) => {
      clearPaywallTrial();
      isProRef.current = true;
      logEvent("purchase_completed", {
        tier: p,
        source: reason ?? "direct",
        paywall_version: PAYWALL_VERSION,
      });
      await settleTrial(res);
      hapticSuccess();
      // Success, or an already-owned recovery ("this is already yours").
      const feedback = purchaseToastFor(res);
      if (feedback) toast(t(feedback.key), feedback.kind);
      await leaveAfterPurchase(res.ok && res.recovered === true);
    },
    onCancelled: afterCancel,
    onPending: (_p, res) => {
      const feedback = purchaseToastFor(res);
      if (feedback) toast(t(feedback.key), feedback.kind);
    },
    onFailed: (_p, res, err) => {
      if (err) logCrash(err, { screen: "paywall", op: "purchase" });
      // Real store error (or a thrown one): one short message; the button then
      // offers "try again" on the same selected plan.
      const feedback = res ? purchaseToastFor(res) : null;
      if (feedback) toast(t(feedback.key), feedback.kind);
      else toast(t("paywall.purchaseError"), "error");
    },
    onPostPurchaseError: (err) => {
      logCrash(err, { screen: "paywall", op: "afterPurchase" });
      // The store answered; if the follow-up could not navigate, fall back to
      // simply leaving (a no-op when a navigation is already under way).
      void exit();
    },
  };

  async function buy() {
    await flowRef.current!.buy(planRef.current);
  }

  async function onRestore() {
    await flowRef.current!.restore(async () => {
      const result = await restore();
      logRestoreResult(result);
      await refreshPro();
      if (result === "restored") {
        clearPaywallTrial();
        isProRef.current = true;
        await settleRestoredTrial();
        hapticSuccess();
        toast(t("paywall.restored"), "success");
        await exit();
      } else if (result === "none") {
        toast(t("paywall.nothingToRestore"), "info");
      } else if (result === "slow") {
        toast(t("purchasePending.restoreSlow"), "info");
      } else {
        toast(t("paywall.restoreFailed"), "error");
      }
    });
  }

  const ctaTrial = showTrialTimeline(plan, annualTrial);

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
  // The CTA follows the SELECTED plan. The price is the store's own localized
  // string from the offering (never written down here), isolated LTR so a
  // right-to-left sentence cannot reorder it.
  const selectedPrice = priceStr(plan);
  const ctaKind = paywallCtaKind({
    plan,
    annualTrial,
    hasPrice: selectedPrice !== null,
    failed,
    pending: pendingApproval,
  });
  const ctaLabel =
    ctaKind === "pending"
      ? t("purchasePending.cta")
      : ctaKind === "retry"
      ? t("paywall.retry")
      : ctaKind === "trial"
        ? t("paywall.ctaTrial", { days: trialDays })
        : ctaKind === "monthly"
          ? t("paywall.ctaMonthly", { price: isolateLtr(selectedPrice ?? "") })
          : ctaKind === "annual"
            ? t("paywall.ctaAnnual", { price: isolateLtr(selectedPrice ?? "") })
            : ctaKind === "lifetime"
              ? t("paywall.ctaLifetime", { price: isolateLtr(selectedPrice ?? "") })
              : t("paywall.cta");
  const chargeRow = timelineRows.find((row) => row.kind === "charge") ?? null;
  const previewVisible = paywallPreviewVisible(windowHeight);

  const loading = offer === null;
  const unavailable = offer?.status === "unavailable";

  // Two-column chips: short labels (a long benefit sentence is not a chip). The
  // Health chip only where Health is really reachable on this device.
  const chips = [
    ...(healthAvailable
      ? [
          {
            icon: "heart-outline" as const,
            text: t("paywall.featureShortHealth", { health: healthName }),
          },
        ]
      : []),
    { icon: "sparkles-outline" as const, text: t("paywall.chipSpike") },
    { icon: "pulse-outline" as const, text: t("paywall.chipCgm") },
    { icon: "analytics-outline" as const, text: t("paywall.benefitTrends") },
    { icon: "document-text-outline" as const, text: t("paywall.featureShortPdf") },
    { icon: "people-outline" as const, text: t("paywall.featureShortFamily") },
  ];

  // A limit context (health/foods/...) takes over the headline with its own
  // title: the generic offer is not the point when the visitor hit a wall.
  // The trial headline only while the selected plan is the annual one with a
  // trial: a "try free" line over a selected monthly or lifetime plan is a mixed
  // message about what the button charges (App Store 3.1.2).
  const heroHeadline = limit
    ? limit.title
    : showTrialTimeline(plan, annualTrial)
      ? t("paywall.headlineTrial", { days: trialDays })
      : t("paywall.headline");
  const heroSubline = limit ? limit.body : t("paywall.promise");

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
              color: THEME.text,
              fontSize: 16,
              fontWeight: "800",
              flexShrink: 1,
              minWidth: 0,
              marginHorizontal: 8,
            }}
            numberOfLines={linesFor(paywallFontScale, 1)}
          >
            {t("paywall.title")}
          </Text>
          <View className="flex-row items-center" style={{ flexShrink: 0 }}>
            <Pressable
              onPress={dismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <IconTile icon="close" size={30} radius={10} tint={THEME.textMuted} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[
            // No pinned CTA band while loading/unavailable (see the band's own
            // guard below), so nothing needs clearing beyond the flat 24; once
            // real plans render, the band is pinned outside the scroll.
            {
              paddingTop: PAYWALL_LAYOUT.scrollTop,
              paddingBottom: loading || unavailable ? insets.bottom + 24 : 24,
            },
            columnPad(20),
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={scrollHint.onScroll}
          onContentSizeChange={scrollHint.onContentSizeChange}
          onLayout={scrollHint.onLayout}
          scrollEventThrottle={scrollHint.scrollEventThrottle}
        >
          {/* Order (lib/paywallLayout): headline, short promise, three plans,
              [pinned CTA below the scroll], trial timeline, small sample
              preview, two-column benefit chips, then the legal text and links.
              A limit context (health/foods/...) puts its own title/body in the
              headline slots. Neither line is a health claim. */}
          <View style={{ alignItems: "center", marginBottom: PAYWALL_LAYOUT.gapAfterHero }}>
            <Txt kind="title" accessibilityRole="header" style={{ textAlign: "center" }}>
              {heroHeadline}
            </Txt>
            {heroSubline ? (
              <Txt kind="caption" tone="muted" style={{ textAlign: "center", marginTop: SPACE.xs }}>
                {heroSubline}
              </Txt>
            ) : null}
          </View>

          {/* Only while the last store read failed: says so and puts a real
              "Restore purchases" button within reach (the small link at the
              bottom stays as it was). */}
          {!loading ? <StoreStatusNotice onRestore={onRestore} busy={busy} /> : null}

          {loading ? (
            // Same waiting composition as downsell / winback: a spinner carries
            // the wait so the plan slot never reads as a broken empty band.
            <GlassCard style={{ alignItems: "center", paddingVertical: 28 }}>
              <ActivityIndicator color={THEME.accent} />
              <Txt tone="muted" style={{ marginTop: SPACE.md }}>
                {t("common.loading")}
              </Txt>
            </GlassCard>
          ) : unavailable ? (
            // Release-only: prices could not be loaded. Never show fake prices;
            // offer a retry instead.
            <GlassCard style={{ alignItems: "center", paddingVertical: 20 }}>
              <IconTile icon="cloud-offline-outline" size={44} radius={14} tint={THEME.textMuted} />
              <Text
                style={{ color: THEME.textMuted, textAlign: "center", marginTop: 12, marginBottom: 14 }}
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

          {/* The trial's today / reminder rows, only for the annual plan with a
              trial. The first-charge row and its price sit in the pinned band
              next to the button. */}
          {!loading && !unavailable && timelineRows.length > 0 ? (
            <View style={{ marginTop: SPACE.xs, marginBottom: SPACE.md, paddingHorizontal: 4 }}>
              {timelineRows
                .filter((row) => row.kind !== "charge")
                .map((row, i) => (
                  <TimelineRow key={row.kind} row={row} first={i === 0} />
                ))}
              <Text
                        style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 15, marginTop: 8 }}
              >
                {cancelLine}
              </Text>
            </View>
          ) : null}

          {/* Sample preview: small, below the plans, and not drawn at all on a
              short window (SE class), where the plans and the CTA come first. */}
          {previewVisible ? <PaywallPreview compact /> : null}

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
              <Text style={{ color: THEME.text, fontSize: 12, fontWeight: "700", marginBottom: 2 }}>
                {t("paywall.timeline.personalLabel")}
              </Text>
              <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
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

          {/* Benefits: short two-column chips. Text wraps (no line cap, no font
              shrinking), so the longest translation just takes a second line. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            {chips.map((chip) => (
              <View
                key={chip.icon}
                style={{
                  width: "48.5%",
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: PAYWALL_LAYOUT.chipPadV,
                  paddingHorizontal: 10,
                  marginBottom: PAYWALL_LAYOUT.chipRowGap,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  backgroundColor: THEME.surface,
                }}
              >
                <Ionicons name={chip.icon} size={14} color={THEME.accent} />
                <Text
                            style={{
                    flex: 1,
                    marginStart: 8,
                    color: THEME.text,
                    fontSize: 12,
                    lineHeight: PAYWALL_LAYOUT.chipLineHeight,
                  }}
                >
                  {chip.text}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={{
              color: THEME.textMuted,
              fontSize: 11,
              textAlign: "center",
              paddingHorizontal: 8,
              lineHeight: 16,
              marginTop: 8,
            }}
          >
            {t("paywall.legalNote")}
          </Text>
          {/* Bottom band: restore + privacy + terms. No separator glyph: after a
              wrap it would dangle at a line end, the links tell themselves apart
              by underline and role. */}
          <View className="flex-row items-center justify-center flex-wrap mt-2" style={{ columnGap: SPACE.xs }}>
            <Button
              variant="tertiary"
              size="sm"
              label={t("paywall.restore")}
              onPress={onRestore}
              disabled={busy}
            />
            <LegalLink
              label={t("settings.privacy")}
              onPress={() => Linking.openURL(privacyUrl())}
            />
            <LegalLink
              label={t("settings.terms")}
              onPress={() => Linking.openURL(termsUrl())}
            />
          </View>

        </ScrollView>
        {/* The ScrollView ends where the pinned CTA band begins, so the hint
            (anchored at the ScrollView's bottom edge) sits above the CTA. */}
        <ScrollHint
          visible={scrollHint.visible}
          bottomOffset={hintBottomOffset({ insetBottom: loading || unavailable ? insets.bottom : 0 })}
        />

        {/* Pinned CTA band: only once real plans are on screen (loading /
            unavailable keep their own in-scroll composition, no CTA to pin).
            The label follows the selected plan; the first-charge line shows
            only for the annual trial. */}
        {!loading && !unavailable ? (
          <View
            style={[
              {
                borderTopWidth: 1,
                borderTopColor: THEME.border,
                backgroundColor: THEME.bg.g1,
                paddingTop: PAYWALL_LAYOUT.bandPadTop,
                paddingBottom: insets.bottom + PAYWALL_LAYOUT.bandPadBottom,
              },
              columnPad(20),
            ]}
          >
            <GradientCTA
              label={ctaLabel}
              loading={purchasing}
              allowTwoLines
              disabled={busy || pendingApproval}
              onPress={buy}
            />
            {chargeRow ? (
              <View style={{ marginTop: PAYWALL_LAYOUT.bandDisclosureMargin, paddingHorizontal: 4 }}>
                <TimelineRow row={chargeRow} first />
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
