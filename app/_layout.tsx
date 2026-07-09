import "../global.css";
import React, { useEffect, useRef } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";

import { AppProvider, useApp } from "../lib/store/AppContext";
import { FeedbackProvider } from "../components/Feedback";
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
  const { ready, onboarded, isProUser } = useApp();
  const segments = useSegments();
  const router = useRouter();
  const prevProRef = useRef<boolean | null>(null);

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
    if (!onboarded && !inOnboarding && !inOnboardingPaywall) {
      router.replace("/onboarding");
      return; // splash stays up through the redirect (no dashboard flash)
    }
    if (onboarded && inOnboarding) {
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
        name="pens"
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
          </FeedbackProvider>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
