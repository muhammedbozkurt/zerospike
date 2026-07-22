import "../global.css";
import React, { useEffect, useRef } from "react";
import { Stack, useRouter, useSegments } from "expo-router";

import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";

import { AppProvider, useApp } from "../lib/store/AppContext";
import { FeedbackProvider, FeedbackHost } from "../components/Feedback";
import { initAnalyticsSink } from "../lib/analytics/firebaseSink";
import { winbackHasRealDiscount } from "../lib/services/purchases";
import { winbackAlreadyShown, markWinbackShown } from "../lib/services/downsell";

// Keep the single native splash visible until the app is ready AND routing has
// settled on the correct screen (see RootNavigator), so there is no dashboard
// flash before onboarding and no intermediate blank/spinner screen.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Attach Firebase (Analytics + Crashlytics) as the analytics sink once, before
// any screen renders. No-op in dev; every event still mirrors to the console.
initAnalyticsSink();

function RootNavigator() {
  const { ready, onboarded, isProUser, activeProfile, completeOnboarding, bumpData } = useApp();
  const segments = useSegments();
  const router = useRouter();

  const prevProRef = useRef<boolean | null>(null);
  // Distinguishes a genuine re-entry (an already-onboarded user reaching
  // /onboarding) from the in-place completion (the flag flips to true while the
  // reveal is showing, just before the paywall). prevOnboardedRef starts null so
  // the first settled render is only a baseline, never counted as a completion;
  // completedRef then latches once we see a false→true flip in-session and stays
  // latched across any spurious effect re-runs so the reveal is never bounced.
  const prevOnboardedRef = useRef<boolean | null>(null);
  const completedRef = useRef(false);

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
      router.replace("/onboarding");
      return; // splash stays up through the redirect (no dashboard flash)
    }
    // Block an already-onboarded user from re-entering /onboarding, but leave the
    // active reveal alone (it completed in-place this session, before the paywall).
    if (onboarded && inOnboarding && !completedRef.current) {
      router.replace("/");
      return; // splash stays up until the app screen is active
    }
    // Settled on the correct screen: safe to reveal.
    SplashScreen.hideAsync().catch(() => {});
  }, [ready, onboarded, segments, router]);

  // While loading, render nothing so the native splash stays on screen.
  if (!ready) return null;

  return (
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
    </Stack>
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
