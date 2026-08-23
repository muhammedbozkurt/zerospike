import "../global.css";
import React, { useEffect, useRef, useState } from "react";
import { I18nManager, LogBox, View } from "react-native";
import { Redirect, Stack, useRouter, useSegments, useGlobalSearchParams } from "expo-router";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";

import * as FileSystem from "expo-file-system/legacy";

import {
  ensureAndroidChannel,
  type NotificationRoute,
} from "../lib/services/notifications";
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
import { initAnalyticsSink } from "../lib/analytics/firebaseSink";
import { winbackHasRealDiscount } from "../lib/services/purchases";
import { winbackAlreadyShown, markWinbackShown } from "../lib/services/downsell";
import { hasSeenAlarmTour, markAlarmTourSeen } from "../lib/services/alarmTour";
import { shouldOpenAlarmTour } from "../lib/alarmSelect";
import { isAlarmKitAvailable } from "../modules/zerospike-alarmkit";
import { listReminders } from "../lib/db/reminders";

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

// Attach Firebase (Analytics + Crashlytics) as the analytics sink once, before
// any screen renders. No-op in dev; every event still mirrors to the console.
initAnalyticsSink();

// Register the Android reminders channel on every cold start, unconditionally -
// no permission check, no onboarding check, before any reminder is ever
// scheduled. applyNotificationPrefs() (called later, from AppContext's launch
// effect) only reaches ensureAndroidChannel() when permission is already
// granted, so a user who denied the prompt (or never reached it) never got a
// channel created at all: system Settings > App > Notifications showed no entry
// to turn on, which read as the app having nothing to configure there. No-op on
// iOS (see ensureAndroidChannel).
void ensureAndroidChannel();

/**
 * Where each reminder should land when tapped. Post-meal/glucose/low-followup all
 * open the dashboard with the right period sheet pre-armed (index.tsx reads the
 * `sheet` param); basal goes to the injection tab, weekly to Insights, trial to
 * the paywall. Called both from the live response listener and the cold-start
 * getLastNotificationResponseAsync path.
 */
function routeForNotification(
  route: NotificationRoute | undefined,
  router: ReturnType<typeof useRouter>
) {
  switch (route) {
    case "postMeal":
      router.navigate({ pathname: "/(tabs)", params: { sheet: "post_meal_2h" } });
      break;
    case "glucose":
    case "lowFollowup":
      router.navigate({ pathname: "/(tabs)", params: { sheet: "fasting" } });
      break;
    case "idle":
      router.navigate({ pathname: "/(tabs)", params: { sheet: "glucose" } });
      break;
    case "basal":
      router.navigate("/(tabs)/injection");
      break;
    case "med":
      router.navigate({ pathname: "/(tabs)", params: { sheet: "med" } });
      break;
    case "weekly":
      router.navigate("/insights");
      break;
    case "trial":
      router.navigate("/paywall");
      break;
    default:
      break;
  }
}

function RootNavigator() {
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
  const coldStartHandled = useRef(false);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!onboardedRef.current) return;
      const data = response.notification.request.content.data as {
        route?: NotificationRoute;
      };
      routeForNotification(data?.route, router);
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (!ready || !onboarded || coldStartHandled.current) return;
    coldStartHandled.current = true;
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!last) return;
        const data = last.notification.request.content.data as {
          route?: NotificationRoute;
        };
        routeForNotification(data?.route, router);
      } catch {
        // no launching notification, nothing to route
      }
    })();
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

  // One-time winback: when the Pro entitlement is lost, offer the discounted
  // annual once (only if a real discount is configured).
  useEffect(() => {
    if (!ready) return;
    const prev = prevProRef.current;
    prevProRef.current = isProUser;
    if (prev === true && isProUser === false) {
      (async () => {
        if (await winbackAlreadyShown()) return;
        if (await winbackHasRealDiscount()) {
          await markWinbackShown();
          router.push("/winback");
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
  // The onboarding flow hands off to the soft paywall (and its downsell) before
  // completing, so those routes are allowed while still not onboarded.
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
  // interrupted tour cannot come back. The two reads below are one AsyncStorage
  // get and one small query, once per launch, after routing has settled.
  const alarmTourHandled = useRef(false);
  useEffect(() => {
    if (!settled || !onboarded || alarmTourHandled.current) return;
    alarmTourHandled.current = true;
    (async () => {
      try {
        const open = shouldOpenAlarmTour({
          routeSettled: settled,
          onboarded,
          screenshotMode: isScreenshotMode(),
          alarmKitAvailable: isAlarmKitAvailable(),
          tourSeen: await hasSeenAlarmTour(),
          reminderCount: (await listReminders()).length,
        });
        if (!open) return;
        await markAlarmTourSeen();
        router.push("/alarm-tour");
      } catch {
        // best-effort; the feature works without ever being explained
      }
    })();
  }, [settled, onboarded, router]);

  // While loading, render nothing so the native splash stays on screen.
  if (!ready) return null;

  return (
    <>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0f1f29" },
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
          backgroundColor: "#04161d",
          zIndex: 10,
        }}
      />
    ) : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0f1f29" }}>
      <SafeAreaProvider>
        <AppProvider>
          <FeedbackProvider>
            <StatusBar style="light" />
            {/* Catches a render error anywhere in the routed screens: without it,
                React unmounts the whole failing subtree and only the dark
                AppBackground wash is left on screen (WP6 - reported as a totally
                blank page recoverable only by an app restart). */}
            <ErrorBoundary>
              <RootNavigator />
            </ErrorBoundary>
            {/* Serves the tabs and every non-modal route. Modal routes present a
                separate view controller this cannot reach, so each mounts its
                own host and takes over while it is on screen. */}
            <FeedbackHost />
          </FeedbackProvider>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
