import "../global.css";
import "../lib/services/healthBackground";
import "../lib/healthRecords";
import React, { useEffect, useRef, useState } from "react";
import { AppState, I18nManager, Linking, LogBox, View } from "react-native";
import { Redirect, Stack, useRouter, useSegments, useGlobalSearchParams, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";

import * as FileSystem from "expo-file-system/legacy";

import {
  ensureAndroidChannel,
  ensureNotificationCategories,
  getNotificationPermission,
  parseAlarmIdentifier,
  parseReminderIdentifier,
  reportTrialNudgeIfDelivered,
  BASAL_DONE_ACTION_ID,
  type NotificationRoute,
} from "../lib/services/notifications";
import { getNotificationPrefs } from "../lib/services/notificationPrefs";
import { isScreenshotMode, setScreenshotPlatform } from "../lib/screenshotMode";
import { seedScreenshotData, ensureTrackingProfile } from "../lib/db/screenshotSeed";
import { DEFAULT_PROFILE_ID, SCREENSHOT_TRACKING_PROFILE_ID } from "../lib/db/index";
import { exportLogsPdf } from "../lib/services/report";
import { SUPPORTED_LANGS, isRTLLang } from "../lib/i18n";
import type { Lang } from "../lib/db/types";

import {
  AppProvider,
  useApp,
  setRTLConfirmHandler,
  reloadForDirectionChange,
} from "../lib/store/AppContext";
import { FeedbackProvider, FeedbackHost, useFeedback } from "../components/Feedback";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ThemeProvider, ThemeRemount, useTheme } from "../lib/theme/ThemeProvider";
import { THEME } from "../lib/theme/tokens";
import { logCrash, logEvent } from "../lib/analytics";
import { initSupabaseSink, setAnalyticsIsPro } from "../lib/analytics/supabaseSink";
import { watchEntitlement, winbackHasRealDiscount } from "../lib/services/purchases";
import { clearPaywallTrial, refreshPaywallTrialOnce } from "../lib/proCta";
import { winbackAlreadyShown, markWinbackShown } from "../lib/services/downsell";
import { holdSurvey } from "../lib/feedbackSurvey";
import { CancelSurveyHost } from "../components/feedback/CancelSurveyHost";
import { WhatsNewHost } from "../components/WhatsNewSheet";
import { hasSeenAlarmTour, markAlarmTourSeen } from "../lib/services/alarmTour";
import { shouldOpenAlarmTour } from "../lib/alarmSelect";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
  takePendingAlarmContext,
} from "../modules/zerospike-alarmkit";
import { listReminders } from "../lib/db/reminders";
import { widgetRouteForUrl, type WidgetRoute } from "../lib/widgetRoute";
import { registerHealthBackground } from "../lib/services/healthBackground";
import {
  hasHealthProvider,
  setHealthBackgroundEntitled,
  subscribeHealthBackgroundImport,
} from "../lib/services/health";

// One-shot guard for the startup RTL auto-reload below, persisted (not just an
// in-memory ref) because Updates.reloadAsync() throws away the whole JS
// context - an in-memory flag would not survive the very reload it is meant to
// gate, and a mismatch that reload never actually fixes (a rare native/env
// edge case) would otherwise retry forever on every cold start.
const RTL_AUTO_RELOAD_KEY = "zerospike.rtlAutoReloadDone";

// Keep the single native splash visible until the app is ready AND routing has
// settled on the correct screen (see RootNavigator), so there is no dashboard
// flash before onboarding and no intermediate blank/spinner screen.
SplashScreen.preventAutoHideAsync().catch(() => {});

// J5a: silence the RN dev warning overlay (LogBox) ONLY in store-screenshot mode,
// so the red warning pill can never sit over the UI (or intercept the automated
// nav taps) during captures. Double-locked; a normal dev build keeps LogBox.
if (isScreenshotMode()) LogBox.ignoreAllLogs(true);

// Schema v1 events to Supabase (outbox + batched POST). Self-gating
// (off in dev, in screenshot mode, without extra.trackFnUrl, and when opted out).
initSupabaseSink();

// Register the Android reminders channel on every cold start, unconditionally -
// no permission check, no onboarding check, before any reminder is ever
// scheduled. applyNotificationPrefs() (called later, from AppContext's launch
// effect) only reaches ensureAndroidChannel() when permission is already
// granted, so a user who denied the prompt (or never reached it) never got a
// channel created at all: system Settings > App > Notifications showed no entry
// to turn on, which read as the app having nothing to configure there. No-op on
// iOS (see ensureAndroidChannel).
void ensureAndroidChannel();

// Registers the basal reminder's quick-action category (app/basal-confirm.tsx's
// site step) the same way - eagerly, unconditionally, before any reminder is
// scheduled. Re-registered on a language change too (rescheduleForLanguageChange).
void ensureNotificationCategories();

/**
 * The routeForNotification context an "Open"ed alarm deserves: the reminder row
 * the alarm belongs to, recovered from the identity string the native side hands
 * back beside the route (takePendingAlarmContext in modules/zerospike-alarmkit)
 * - the alarm counterpart of parseReminderIdentifier on the notification path.
 *
 * Undefined, never a guess, when the alarm carried no identity: an alarm armed
 * by a build older than that payload, or one whose id the intent could not
 * write. That case keeps the previous behaviour exactly - /basal-confirm opens
 * with no reminderId and resolveBasalConfirmEntry (lib/services/basalConfirm.ts)
 * matches by time - so time matching is the fallback rather than the rule.
 */
function alarmReminderContext(
  alarmId: string | null | undefined
): { reminderId: string } | undefined {
  const reminderId = parseAlarmIdentifier(alarmId);
  return reminderId ? { reminderId } : undefined;
}

/**
 * Where each reminder should land when tapped. Post-meal/glucose/low-followup all
 * open the dashboard with the right period sheet pre-armed (index.tsx reads the
 * `sheet` param); basal opens app/basal-confirm.tsx (task B), weekly to Insights,
 * the trial reminder to Insights, the day-1 Health nudge to the dashboard's
 * Health connect flow. Called both from the live response listener and the
 * cold-start getLastNotificationResponseAsync path.
 *
 * `context` carries the two fields only a basal notification's own response
 * needs: the notification's OWN identifier (to recover which reminder row this
 * was, via parseReminderIdentifier) and which actionIdentifier was tapped (the
 * quick action vs. the notification body itself) - see
 * ensureNotificationCategories in lib/services/notifications.ts.
 */
function routeForNotification(
  route: NotificationRoute | undefined,
  router: ReturnType<typeof useRouter>,
  context?: {
    identifier?: string | null;
    actionIdentifier?: string;
    /** Already-resolved row id, for a caller whose payload carries the reminder
     *  directly rather than a notification identifier to decode - an alarm's
     *  "Open" button (alarmReminderContext below). */
    reminderId?: string | null;
  }
) {
  switch (route) {
    case "postMeal":
      router.navigate({ pathname: "/(tabs)", params: { sheet: "post_meal_2h" } });
      break;
    case "glucose":
    case "lowFollowup":
      router.navigate({ pathname: "/(tabs)", params: { sheet: "fasting" } });
      break;
    // The empty-journal nudge and a user's own custom reminder both open the
    // dashboard and NOTHING else (2.3.0's K2-B). "Your journal is empty" is
    // about anything the user might record - a reading, a meal, a medication -
    // so pre-opening the fasting-glucose form, as this used to, answered a
    // question the nudge never asked; a custom reminder the app never saw the
    // text of has even less to go on.
    case "idle":
    case "custom":
      router.navigate("/(tabs)");
      break;
    case "basal": {
      // The quick action ("I already did it") skips straight to the
      // site-picking step; a tap on the notification body itself asks first.
      const step = context?.actionIdentifier === BASAL_DONE_ACTION_ID ? "site" : "ask";
      const reminderId =
        context?.reminderId ?? parseReminderIdentifier(context?.identifier);
      router.navigate({
        pathname: "/basal-confirm",
        params: reminderId ? { step, reminderId } : { step },
      });
      break;
    }
    case "med":
      router.navigate({ pathname: "/(tabs)", params: { sheet: "med" } });
      break;
    case "weekly":
      router.navigate("/insights");
      break;
    case "trial":
      // The reminder speaks about what carries on with Pro, so it opens the
      // place that shows it: Insights. The way out of a trial lives in the
      // paywall timeline and Settings > App, not behind this tap.
      logEvent("trial_reminder_opened");
      router.navigate("/insights");
      break;
    case "trialNudge":
      // The day-1 nudge offers to bring the Health history in: it opens the
      // dashboard, which runs the existing Health connect flow.
      router.navigate({ pathname: "/(tabs)", params: { health: "connect" } });
      break;
    default:
      break;
  }
}

/**
 * Turns a resolved WidgetRoute (lib/widgetRoute.ts) into a typed expo-router
 * Href, mirroring routeForNotification's own hardcoded-literal style so the
 * typed-routes generator (app.json's experiments.typedRoutes) can check every
 * branch. `route.pathname` itself is a plain string coming out of a pure
 * helper, so the switch below - not a cast - is what proves each branch is
 * actually one of the app's known routes.
 */
function hrefForWidgetRoute(route: WidgetRoute): Href | null {
  if (!route) return null;
  if (route.kind === "sheet") {
    return { pathname: "/(tabs)", params: { sheet: route.sheet } };
  }
  switch (route.pathname) {
    case "/(tabs)":
      return { pathname: "/(tabs)" };
    case "/(tabs)/food":
      return { pathname: "/(tabs)/food" };
    case "/(tabs)/injection":
      return { pathname: "/(tabs)/injection", params: route.params };
    case "/settings/reminders":
      return { pathname: "/settings/reminders" };
    default:
      return null;
  }
}

let coldStartHandled = false;

function RootNavigator() {
  const { scheme } = useTheme();
  const { ready, onboarded, isProUser, activeProfile, completeOnboarding, bumpData, lang, setLanguage, refreshPro, setActiveProfileId } = useApp();
  const segments = useSegments();
  const router = useRouter();
  const globalParams = useGlobalSearchParams<{
    scLang?: string;
    scReport?: string;
    scenario?: string;
    scPlatform?: string;
    scOnboarding?: string;
  }>();
  const { confirm } = useFeedback();

  // Entitlement for the analytics sink. Only once AppContext is ready: before
  // that isProUser is the pre-bootstrap default, not the user's real state.
  useEffect(() => {
    if (ready) setAnalyticsIsPro(isProUser);
  }, [ready, isProUser]);

  // Background health sync: a headless run cannot ask React for the Pro state,
  // so the foreground stores it; registration then follows the switches,
  // entitlement and permissions (also re-checked each time the app comes back,
  // since the user can change them in the system's Health settings).
  useEffect(() => {
    if (!ready || !hasHealthProvider()) return;
    const sync = () => {
      void setHealthBackgroundEntitled(isProUser).then(() => registerHealthBackground());
    };
    sync();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => sub.remove();
  }, [ready, isProUser, activeProfile?.id]);

  useEffect(() => {
    if (!ready || !hasHealthProvider()) return;
    return subscribeHealthBackgroundImport(bumpData);
  }, [ready, bumpData]);

  // AppContext.setLanguage lives in AppProvider, an ANCESTOR of FeedbackProvider
  // in the tree below, so it cannot call useFeedback() itself. RootNavigator is
  // a descendant of both, so it hands the live confirm function down through a
  // small module-level bridge (see setRTLConfirmHandler in AppContext.tsx).
  useEffect(() => {
    setRTLConfirmHandler(confirm);
    return () => setRTLConfirmHandler(null);
  }, [confirm]);

  // Startup RTL sync: the persisted language may not match I18nManager's
  // current writing direction (a user declined the immediate restart last
  // time setLanguage offered one, or the language was changed some other way).
  // Runs ONCE per launch (rtlSyncDone), right after `ready` first flips true -
  // never again later in the same session, so it never fights an in-session
  // setLanguage call, which owns its own confirm+reload flow.
  const rtlSyncDone = useRef(false);
  useEffect(() => {
    if (!ready || rtlSyncDone.current) return;
    rtlSyncDone.current = true;
    const targetRTL = isRTLLang(lang);
    if (targetRTL === I18nManager.isRTL) {
      // Matched: drop any stale attempt flag so a FUTURE mismatch (a new
      // language choice) still gets its own one-shot auto-reload.
      void AsyncStorage.removeItem(RTL_AUTO_RELOAD_KEY);
      return;
    }
    // Store-screenshot: the capture pipeline drives its own relaunches on a
    // deterministic schedule: an uninvited reload here would race that
    // sequence. Only the direction FLAG gets fixed; no reload.
    if (isScreenshotMode()) {
      I18nManager.allowRTL(targetRTL);
      I18nManager.forceRTL(targetRTL);
      return;
    }
    void (async () => {
      const already = await AsyncStorage.getItem(RTL_AUTO_RELOAD_KEY);
      // Already tried once for this exact target and it still does not match -
      // do not loop forever reloading; leave it for the next explicit language
      // change instead.
      if (already === String(targetRTL)) return;
      await AsyncStorage.setItem(RTL_AUTO_RELOAD_KEY, String(targetRTL));
      I18nManager.allowRTL(targetRTL);
      I18nManager.forceRTL(targetRTL);
      await reloadForDirectionChange();
    })();
  }, [ready, lang]);

  // Store-screenshot: ?scPlatform=android marks the shot as an ANDROID source
  // frame, so iOS-only chrome (the dashboard's Apple Health card) is left out of
  // it. Written on EVERY param change, not only when the value is present: the
  // helper clears the flag for scPlatform=ios and for a link with no param at
  // all, so the next frame of the pass is never captured in Android dress.
  // Double-locked inside the helper; ignored in a normal build.
  useEffect(() => {
    setScreenshotPlatform(globalParams.scPlatform);
  }, [globalParams.scPlatform]);

  // Store-screenshot: any deep-link may carry ?scLang=xx to switch the in-app
  // language before a capture pass. Double-locked; ignored in a normal build.
  useEffect(() => {
    const sc = globalParams.scLang;
    if (!isScreenshotMode() || !sc) return;
    if ((SUPPORTED_LANGS as string[]).includes(sc) && sc !== lang) {
      void setLanguage(sc as Lang);
    }
  }, [globalParams.scLang, lang, setLanguage]);

  // Store-screenshot: ?scenario=tracking switches the active profile to the
  // insulin-free "tracking" panel (08-takip), get-or-create at a stable id so
  // it survives the cold relaunch a language switch does. With no `scenario`,
  // hand back to the default profile whenever it is the one still active - the
  // NEXT deep-link in a capture pass carries no scenario, so without this it
  // would shoot straight over the tracking profile by accident. Double-locked;
  // ignored in a normal build.
  useEffect(() => {
    if (!isScreenshotMode() || !ready || !activeProfile) return;
    const scenario = globalParams.scenario;
    (async () => {
      if (scenario === "tracking") {
        const id = await ensureTrackingProfile();
        if (activeProfile.id !== id) await setActiveProfileId(id);
      } else if (activeProfile.id === SCREENSHOT_TRACKING_PROFILE_ID) {
        await setActiveProfileId(DEFAULT_PROFILE_ID);
      }
    })();
  }, [ready, activeProfile, globalParams.scenario, setActiveProfileId]);

  // Store-screenshot: skip onboarding so deep-links land straight on the real
  // tabs. A default profile always exists (getDefaultProfile bootstrap), so the
  // seed has a profile to fill. Double-locked; never runs in a normal build.
  useEffect(() => {
    if (!isScreenshotMode() || !ready || onboarded) return;
    void completeOnboarding();
  }, [ready, onboarded, completeOnboarding]);

  // Store-screenshot: ?scReport=1 renders the 30-day doctor PDF headlessly (no
  // share sheet) to a deterministic path the capture pipeline pulls from the sim
  // container. One-shot per app session, so each cold-relaunched language emits a
  // report in its own locale. Double-locked; never runs in a normal build.
  const reportDoneRef = useRef(false);
  useEffect(() => {
    if (
      !isScreenshotMode() ||
      globalParams.scReport !== "1" ||
      !ready ||
      !activeProfile ||
      reportDoneRef.current
    )
      return;
    reportDoneRef.current = true;
    void (async () => {
      try {
        const out = `${FileSystem.documentDirectory ?? ""}sc-report.pdf`;
        await exportLogsPdf(activeProfile, 30, undefined, { skipShare: true, copyTo: out });
      } catch {
        /* best-effort screenshot plumbing */
      }
    })();
  }, [globalParams.scReport, ready, activeProfile]);

  // Store-screenshot seed: fill the profile with the demo story ONCE, only when
  // the double lock (dev + env) is on. Idempotent (marker key) + a ran-ref so a
  // data refresh never re-triggers it.
  // Re-run per LANGUAGE (not once per session): scLang flips `lang` a beat AFTER
  // mount, and the meal names must re-materialise in the new locale. Keyed on
  // profile+language (not language alone - the scenario switch above can flip
  // `activeProfile` with no language change, and each profile needs its own
  // first-pass seed the ref must not mistake for already done) so a data refresh
  // never re-seeds, but a profile or language switch always does.
  // seedScreenshotData itself early-returns when the DB marker already matches,
  // so a redundant call is cheap.
  const seededLangRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !activeProfile || !isScreenshotMode()) return;
    // The scLang deep-link param is the capture's source of truth for the target
    // locale; the context `lang` lags a render behind it (setLanguage is async),
    // so seed straight off the param when it is present. Without this the meals
    // materialise in the PREVIOUS locale (Turkish UI, stale foreign food names).
    const sc = globalParams.scLang;
    const seedLang: Lang =
      sc && (SUPPORTED_LANGS as string[]).includes(sc) ? (sc as Lang) : lang;
    const seedKey = `${activeProfile.id}:${seedLang}`;
    if (seededLangRef.current === seedKey) return;
    seededLangRef.current = seedKey;
    (async () => {
      const variant =
        activeProfile.id === SCREENSHOT_TRACKING_PROFILE_ID ? "tracking" : undefined;
      await seedScreenshotData(activeProfile.id, seedLang, variant);
      // The seed flips the Pro override; refresh the context so Pro-only surfaces
      // (Insights) render unlocked in this same session, not just after a restart.
      await refreshPro();
      bumpData();
    })();
  }, [ready, activeProfile, lang, globalParams.scLang, bumpData, refreshPro]);

  // Notification deep-link: tapping a reminder opens the screen it is about,
  // instead of dropping the user wherever they last were. The live listener
  // handles taps while the app is running; getLastNotificationResponseAsync
  // handles a cold start (tap that launched the app). We only route once
  // onboarding is done, so a tap never fights the onboarding redirect.
  const onboardedRef = useRef(onboarded);
  onboardedRef.current = onboarded;

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!onboardedRef.current) return;
      const data = response.notification.request.content.data as {
        route?: NotificationRoute;
      };
      routeForNotification(data?.route, router, {
        identifier: response.notification.request.identifier,
        actionIdentifier: response.actionIdentifier,
      });
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (!ready || !onboarded || coldStartHandled) return;
    coldStartHandled = true;
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!last) return;
        const data = last.notification.request.content.data as {
          route?: NotificationRoute;
        };
        routeForNotification(data?.route, router, {
          identifier: last.notification.request.identifier,
          actionIdentifier: last.actionIdentifier,
        });
      } catch (err) {
        // no launching notification, nothing to route
        logCrash(err, { screen: "layout", op: "coldStartNotification" });
      }
    })();
  }, [ready, onboarded, router]);

  // The alarm counterpart of the two effects above (2.3.0's K2-B). An AlarmKit
  // alarm rings with the app not running and hands nothing to JS: its "Open"
  // button instead parks a route in the shared App Group
  // (ZerospikeAlarmOpenIntent) and brings the app forward, so the pickup point
  // is the foreground transition rather than a notification response. Read-once
  // on the native side, so a route can never be replayed on a later launch, and
  // routed through the SAME routeForNotification a tapped notification uses.
  // Checked on mount too: the transition that started the app can land before
  // this listener is attached.
  //
  // Each foreground transition also gets ONE delayed retry: the intent runs in
  // its own process and can still be writing the App Group value as the app
  // comes to the front, and a first read that finds nothing must not lose the
  // tap. Anything the retry finds is a route the immediate read missed, never a
  // second copy - the native read clears the key as it hands it over.
  useEffect(() => {
    if (!ready || !onboarded) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const consume = (): boolean => {
      const pending = takePendingAlarmContext();
      if (!pending) return false;
      // The alarm now carries the identity string it was scheduled under, so
      // this path resolves the reminder the same way the notification path just
      // above does - from the payload itself, not from the clock. An alarm with
      // no identity (an older build's) still routes, just without a reminderId,
      // which is what leaves resolveBasalConfirmEntry's time matching in place
      // as the fallback.
      routeForNotification(pending.route, router, alarmReminderContext(pending.alarmId));
      return true;
    };
    const consumeWithRetry = () => {
      if (retry) clearTimeout(retry);
      if (consume()) return;
      retry = setTimeout(() => {
        retry = null;
        consume();
      }, 1000);
    };
    consumeWithRetry();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") consumeWithRetry();
    });
    return () => {
      if (retry) clearTimeout(retry);
      sub.remove();
    };
  }, [ready, onboarded, router]);

  // DEFENSIVE hot-open hook for zerospike:// widget taps (P11). expo-router
  // already runs its own internal Linking "url" listener and, by all evidence
  // gathered so far, routes a hot tap correctly on its own - this app has
  // never registered a SECOND listener for that event, unlike the notification
  // and AlarmKit paths above, which both have an explicit one. A report of
  // "tapping a widget while the app is backgrounded reopens it on whatever
  // screen was last open" could not be reproduced or pinned to a root cause
  // (parameter stripping, freezeOnBlur and the onboarding gate were all ruled
  // out), so this closes a gap that may or may not exist: if expo-router is
  // already navigating correctly, calling router.navigate a second time with
  // the same target is a no-op on screen; if something upstream of its own
  // listener is swallowing the tap, this is what actually moves the app.
  // getInitialURL() is deliberately NOT read here - cold start already works
  // through expo-router's own linking config, and a second cold-start handler
  // would double-navigate on launch.
  const lastWidgetUrlRef = useRef<{ url: string; at: number } | null>(null);
  useEffect(() => {
    if (!ready || !onboarded) return;
    const sub = Linking.addEventListener("url", ({ url }) => {
      const last = lastWidgetUrlRef.current;
      const now = Date.now();
      // Same URL inside 1.5 s of the last one this hook itself handled: taken
      // as expo-router's own listener having already fired for this exact tap,
      // so a second navigate here is skipped rather than replayed.
      if (last && last.url === url && now - last.at < 1500) return;
      lastWidgetUrlRef.current = { url, at: now };
      const href = hrefForWidgetRoute(widgetRouteForUrl(url));
      if (!href) return;
      router.navigate(href);
    });
    return () => sub.remove();
  }, [ready, onboarded, router]);

  const prevProRef = useRef<boolean | null>(null);
  // Distinguishes a genuine re-entry (an already-onboarded user reaching
  // /onboarding) from the in-place completion (the flag flips to true while the
  // reveal is showing, just before the paywall). completedRef latches once we see
  // a false→true flip in-session and stays latched across any re-render, so the
  // reveal is never bounced.
  const prevOnboardedRef = useRef<boolean | null>(null);
  const completedRef = useRef(false);
  // Until routing has SETTLED on the correct first screen, a full-bleed cover (in
  // the splash colour) sits over the navigator so the tab bar / dashboard can
  // never paint for even one frame before the onboarding redirect (A6).
  const [revealed, setRevealed] = useState(false);

  // The entitlement is re-read when the app comes to the foreground and when
  // RevenueCat pushes an update (see watchEntitlement), so a trial that ended, a
  // renewal or a purchase made elsewhere shows up without a restart. refreshPro
  // leaves the flag alone when the store cannot answer, so an offline paying
  // user is never demoted here (and never handed the win-back below).
  useEffect(() => {
    if (!ready) return;
    return watchEntitlement(() => {
      void refreshPro();
    });
  }, [ready, refreshPro]);

  // The day-1 Health nudge is delivered by the OS with the app closed, so the
  // app can only notice that it fired: on launch and on every foreground.
  useEffect(() => {
    if (!ready || !onboarded) return;
    void reportTrialNudgeIfDelivered();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void reportTrialNudgeIfDelivered();
    });
    return () => sub.remove();
  }, [ready, onboarded]);

  useEffect(() => {
    if (!ready || !onboarded) return;
    if (isProUser) clearPaywallTrial();
    else void refreshPaywallTrialOnce();
  }, [ready, onboarded, isProUser]);

  // One-time winback: when the Pro entitlement is lost, offer the discounted
  // annual once (only if a real discount is configured).
  useEffect(() => {
    if (!ready) return;
    const prev = prevProRef.current;
    prevProRef.current = isProUser;
    if (prev === true && isProUser === false) {
      // The cancellation survey (components/feedback) follows the same loss; the
      // winback is a paid offer and goes first, so the survey waits until this
      // has decided whether to open it (and, if it does, until it is closed).
      const releaseSurvey = holdSurvey();
      (async () => {
        try {
          if (await winbackAlreadyShown()) return;
          if (await winbackHasRealDiscount()) {
            await markWinbackShown();
            router.push("/winback");
          }
        } finally {
          releaseSurvey();
        }
      })();
    }
  }, [ready, isProUser, router]);

  // ── Route gate: decided during RENDER, never in an effect ──────────────────
  // An effect-driven redirect can only run AFTER the wrong screen has already
  // been committed and handed to the native stack, which is how a fresh install
  // still got a look at the dashboard before onboarding appeared. Everything
  // below is derived from the current commit, so the cover and the redirect are
  // always decided on the same frame the route is known.
  const root = segments[0];
  const inOnboarding = root === "onboarding";
  // 2.3.4: onboarding no longer hands off to the paywall (it completes and
  // goes straight to the dashboard - app/onboarding.tsx), and completeOnboarding
  // already runs before that, so `onboarded` is true by the time any of these
  // three routes can be reached today. Left permissive rather than tightened:
  // not fully verified against every deep-link/notification path, and being
  // wrong here would misroute a fresh install.
  const inOnboardingPaywall =
    root === "paywall" || root === "downsell" || root === "winback";
  const needsOnboarding =
    ready && !onboarded && !inOnboarding && !inOnboardingPaywall;
  // Screenshot mode completes onboarding itself (an AsyncStorage write before the
  // state flip), so on a genuinely fresh launch this gate can still see
  // onboarded=false on the same commit. Don't redirect away from the deep-link
  // target in that case - just hold the cover; the completion effect flips
  // `onboarded` a beat later. Without this, a fresh screenshot-mode launch got
  // bounced to /onboarding and then stuck there (the re-entry guard below treats
  // the in-flight completion as an already-onboarded user re-entering).
  const screenshotPending = needsOnboarding && isScreenshotMode();

  // Latched during RENDER for the same reason the gate is: the re-entry guard
  // below has to know about the completion on the very commit `onboarded` flips,
  // and an effect-set latch would still read false there and bounce the in-place
  // reveal to the dashboard. prevOnboardedRef starts null so the first ready
  // render is only a baseline, never counted as a completion; the write is
  // guarded on an actual change so repeated renders stay a no-op.
  if (ready && prevOnboardedRef.current !== onboarded) {
    const prevOnboarded = prevOnboardedRef.current;
    prevOnboardedRef.current = onboarded;
    if (prevOnboarded === false && onboarded === true) completedRef.current = true;
  }
  // Store-screenshot: /onboarding?scOnboarding=<answer> captures a single quiz
  // question with that answer already highlighted (the 08 panel). Screenshot mode
  // completes onboarding on launch, so `onboarded` is true and the re-entry guard
  // below would bounce the deep-link straight back to the tabs - this is the one
  // param allowed past it. Derived from the LIVE param, so the very next link of
  // the pass (which carries no scOnboarding) restores the guard. The screen it
  // opens is render-only: onboarding.tsx seeds its own local state from the param
  // and writes nothing. Double-locked; a dead branch in any release build.
  const screenshotOnboarding = isScreenshotMode() && !!globalParams.scOnboarding;

  // Block an already-onboarded user from re-entering /onboarding, but leave the
  // active reveal alone (it completed in-place this session, before the paywall).
  const blockedReentry =
    ready &&
    onboarded &&
    inOnboarding &&
    !completedRef.current &&
    !screenshotOnboarding;

  const settled = ready && !needsOnboarding && !blockedReentry;

  // Drop the native splash and the JS cover together, one frame AFTER the correct
  // route is committed, so neither ever lifts while the navigator is still
  // swapping screens.
  useEffect(() => {
    if (!settled || revealed) return;
    const frame = requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch(() => {});
      setRevealed(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [settled, revealed]);

  // One-time alarm tour (2.3.0's D), for the UPGRADING user whose existing
  // reminders now ring as real alarms. Every condition lives in
  // shouldOpenAlarmTour (lib/alarmSelect.ts) rather than in a chain of early
  // returns here, so the gate is testable under plain Node.
  //
  // `onboarded` is part of it, and is the reason this is not driven by `settled`
  // alone: the route gate above reports settled the moment it has redirected
  // INTO /onboarding (needsOnboarding goes false because the user is now in the
  // flow), so an install whose onboarding was killed halfway used to get the
  // tour pushed on top of the onboarding it had not finished. The flag, not the
  // current route, is the only thing that says onboarding is actually done.
  // A completed one is covered by onboarding itself and stops at `tourSeen`,
  // because completeOnboarding marks the tour seen (lib/store/AppContext.tsx) -
  // which is also why no version comparison is needed here.
  //
  // Marked seen BEFORE the push, exactly like the winback above, so an
  // interrupted tour cannot come back - but ONLY on the launch that really
  // opens it. A gate that closed for a reason which can still change (the
  // master switch or the OS permission being off, see shouldOpenAlarmTour)
  // leaves the flag untouched, so the tour is still there for that user the
  // day they turn notifications on. The reads below are one AsyncStorage get,
  // one small query and the two delivery reads, after routing has settled.
  //
  // Re-evaluated on every foreground, not once per launch. The gate can close
  // for a reason that changes WITHIN a session - the user opens Settings, turns
  // notifications on, comes back - and a once-per-launch check meant they had
  // to quit and relaunch to be told about a feature they had just enabled.
  // Re-running is safe because `tourSeen` is what guarantees the tour opens
  // once ever: the ref below only stops two evaluations overlapping.
  const alarmTourRunning = useRef(false);
  useEffect(() => {
    if (!settled || !onboarded) return;
    const evaluate = async () => {
      if (alarmTourRunning.current) return;
      alarmTourRunning.current = true;
      try {
        const [tourSeen, rows, prefs, permission] = await Promise.all([
          hasSeenAlarmTour(),
          listReminders(),
          getNotificationPrefs(),
          getNotificationPermission(),
        ]);
        const alarmKit = isAlarmKitAvailable();
        const open = shouldOpenAlarmTour({
          routeSettled: settled,
          onboarded,
          screenshotMode: isScreenshotMode(),
          alarmKitAvailable: alarmKit,
          tourSeen,
          reminderCount: rows.length,
          notificationsEnabled: prefs.enabled,
          notificationPermission: permission === "granted",
          // K3-2: an alarm reaches the user through AlarmKit, not through the
          // notification system, so this alone is enough to make the tour true
          // for them.
          alarmAuthorized:
            alarmKit && getAlarmAuthorizationStatus() === "authorized",
        });
        if (!open) return;
        await markAlarmTourSeen();
        router.push("/alarm-tour");
      } catch {
        // best-effort; the feature works without ever being explained
      } finally {
        alarmTourRunning.current = false;
      }
    };
    void evaluate();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void evaluate();
    });
    return () => sub.remove();
  }, [settled, onboarded, router]);

  // While loading, render nothing so the native splash stays on screen.
  if (!ready) return null;

  return (
    <>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: THEME.bg.base },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="(tabs)" />
      {/* No transition: /onboarding is only ever reached from the gate below, and
          a cross-fade kept the outgoing dashboard on screen for the whole
          animation - visible the moment the cover lifted. */}
      <Stack.Screen name="onboarding" options={{ animation: "none" }} />
      <Stack.Screen
        name="paywall"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="downsell"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="winback"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="pro-welcome"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="alarm-tour"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="scan"
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="sos"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="emergency-contacts"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="calculator"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="basal-confirm"
        options={{
          presentation: "transparentModal",
          animation: "fade",
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
      <Stack.Screen
        name="add-food"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="meal-template"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="profile-setup"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="sources"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="injection-guide"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="spike"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="widget-guide"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
    </Stack>
    <CancelSurveyHost root={root} />
    <WhatsNewHost root={root} />
    {needsOnboarding && !screenshotPending ? (
      <Redirect href="/onboarding" />
    ) : null}
    {blockedReentry ? <Redirect href="/" /> : null}
    {!settled || !revealed ? (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: scheme === "light" ? THEME.bg.base : "#04161d", // theme-ok: matches the native splash
          zIndex: 10,
        }}
      />
    ) : null}
    </>
  );
}

function ThemedRoot() {
  const { scheme } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: THEME.bg.base }}>
      <SafeAreaProvider>
        <AppProvider>
          <ThemeRemount>
            <FeedbackProvider>
              <StatusBar style={scheme === "light" ? "dark" : "light"} />
              {/* Catches a render error anywhere in the routed screens: without it,
                  React unmounts the whole failing subtree and only the AppBackground
                  wash is left on screen (WP6 - reported as a totally blank page
                  recoverable only by an app restart). */}
              <ErrorBoundary>
                <RootNavigator />
              </ErrorBoundary>
              {/* Serves the tabs and every non-modal route. Modal routes present a
                  separate view controller this cannot reach, so each mounts its
                  own host and takes over while it is on screen. */}
              <FeedbackHost />
            </FeedbackProvider>
          </ThemeRemount>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedRoot />
    </ThemeProvider>
  );
}
