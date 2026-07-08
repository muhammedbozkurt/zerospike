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

// Keep the single native splash visible until the app is ready, then fade it
// out — no intermediate blank/spinner screen (which looked like a 2nd splash).
SplashScreen.preventAutoHideAsync().catch(() => {});

// Attach Firebase (Analytics + Crashlytics) as the analytics sink once, before
// any screen renders. No-op in dev; every event still mirrors to the console.
initAnalyticsSink();

function RootNavigator() {
  const { ready, onboarded, isProUser } = useApp();
  const segments = useSegments();
  const router = useRouter();
  const prevProRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

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
    } else if (onboarded && inOnboarding) {
      router.replace("/");
    }
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
