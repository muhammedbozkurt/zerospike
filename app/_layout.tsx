import "../global.css";
import React, { useEffect, useRef, useState } from "react";
import { LogBox, View } from "react-native";
import { Stack, useRouter, useSegments, useGlobalSearchParams } from "expo-router";
import * as Notifications from "expo-notifications";

import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";

import * as FileSystem from "expo-file-system/legacy";

import type { NotificationRoute } from "../lib/services/notifications";
import { isScreenshotMode } from "../lib/screenshotMode";
import { seedScreenshotData } from "../lib/db/screenshotSeed";
import { exportLogsPdf } from "../lib/services/report";
import { SUPPORTED_LANGS } from "../lib/i18n";
import type { Lang } from "../lib/db/types";

import { AppProvider, useApp } from "../lib/store/AppContext";
import { FeedbackProvider, FeedbackHost } from "../components/Feedback";
import { initAnalyticsSink } from "../lib/analytics/firebaseSink";
import { winbackHasRealDiscount } from "../lib/services/purchases";
import { winbackAlreadyShown, markWinbackShown } from "../lib/services/downsell";

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
    case "basal":
      router.navigate("/(tabs)/injection");
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
  const { ready, onboarded, isProUser, activeProfile, completeOnboarding, bumpData, lang, setLanguage, refreshPro } = useApp();
  const segments = useSegments();
  const router = useRouter();
  const globalParams = useGlobalSearchParams<{ scLang?: string; scReport?: string }>();

  // Store-screenshot: any deep-link may carry ?scLang=xx to switch the in-app
  // language before a capture pass. Double-locked; ignored in a normal build.
  useEffect(() => {
    const sc = globalParams.scLang;
    if (!isScreenshotMode() || !sc) return;
    if ((SUPPORTED_LANGS as string[]).includes(sc) && sc !== lang) {
      void setLanguage(sc as Lang);
    }
  }, [globalParams.scLang, lang, setLanguage]);

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
  // mount, and the meal names must re-materialise in the new locale. Keyed on the
  // seeded language so a data refresh (same lang) never re-seeds, but a language
  // switch always does. seedScreenshotData itself early-returns when the DB marker
  // already matches, so a redundant call is cheap.
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
    if (seededLangRef.current === seedLang) return;
    seededLangRef.current = seedLang;
    (async () => {
      await seedScreenshotData(activeProfile.id, seedLang);
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
        // no launching notification — nothing to route
      }
    })();
  }, [ready, onboarded, router]);

  const prevProRef = useRef<boolean | null>(null);
  // Distinguishes a genuine re-entry (an already-onboarded user reaching
  // /onboarding) from the in-place completion (the flag flips to true while the
  // reveal is showing, just before the paywall). prevOnboardedRef starts null so
  // the first settled render is only a baseline, never counted as a completion;
  // completedRef then latches once we see a false→true flip in-session and stays
  // latched across any spurious effect re-runs so the reveal is never bounced.
  const prevOnboardedRef = useRef<boolean | null>(null);
  const completedRef = useRef(false);
  // Until routing has SETTLED on the correct first screen, a full-bleed cover (in
  // the splash colour) sits over the navigator so the tab bar / dashboard can
  // never paint for even one frame before the onboarding redirect (A6).
  const [routeSettled, setRouteSettled] = useState(false);

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

  // Route gate AND splash control in one place: keep the native splash up until
  // routing has settled on the correct screen, so a fresh (not-onboarded) launch
  // never reveals the dashboard for even one frame before redirecting.
  useEffect(() => {
    if (!ready) return;
    const root = segments[0];
    const inOnboarding = root === "onboarding";
    // The onboarding flow hands off to the soft paywall (and its downsell) before
    // completing, so those routes are allowed while still not onboarded.
    const inOnboardingPaywall =
      root === "paywall" || root === "downsell" || root === "winback";
    // Latch "completed this session" on the false→true flip (the reveal calling
    // completeOnboarding). The first settled render only sets the baseline.
    const prev = prevOnboardedRef.current;
    prevOnboardedRef.current = onboarded;
    if (prev === false && onboarded === true) completedRef.current = true;
    if (!onboarded && !inOnboarding && !inOnboardingPaywall) {
      // Screenshot mode's own effect completes onboarding asynchronously (an
      // AsyncStorage write before the state flip), so on a genuinely fresh
      // install this gate can still see onboarded=false on the same commit and
      // fire first. Don't redirect away from the deep-link target in that case -
      // just wait; the completion effect flips `onboarded` a beat later and this
      // gate re-runs. Without this, a fresh screenshot-mode launch got bounced to
      // /onboarding and then stuck there (the re-entry guard below treats the
      // in-flight completion as an already-onboarded user re-entering onboarding).
      if (isScreenshotMode()) return;
      router.replace("/onboarding");
      return; // splash stays up through the redirect (no dashboard flash)
    }
    // Block an already-onboarded user from re-entering /onboarding, but leave the
    // active reveal alone (it completed in-place this session, before the paywall).
    if (onboarded && inOnboarding && !completedRef.current) {
      router.replace("/");
      return; // splash stays up until the app screen is active
    }
    // Settled on the correct screen: safe to reveal (drop both the native splash
    // and the JS cover together, so no wrong screen is ever seen).
    SplashScreen.hideAsync().catch(() => {});
    setRouteSettled(true);
  }, [ready, onboarded, segments, router]);

  // While loading, render nothing so the native splash stays on screen.
  if (!ready) return null;

  return (
    <>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#000000" },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
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
    {!routeSettled ? (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "#04161d",
        }}
      />
    ) : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000000" }}>
      <SafeAreaProvider>
        <AppProvider>
          <FeedbackProvider>
            <StatusBar style="light" />
            <RootNavigator />
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
