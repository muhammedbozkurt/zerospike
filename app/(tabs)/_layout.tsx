import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { insulinModeUsesInsulin } from "../../lib/insulinMode";
import { THEME } from "../../lib/theme/tokens";

export default function TabsLayout() {
  const { t } = useTranslation();
  const { activeProfile } = useApp();

  // A profile that takes no insulin drops to three tabs. The route still exists
  // (deep links and the journal's edit flow keep working); it just stops being
  // advertised, so the app does not present dosing machinery to someone who does
  // not dose. Flipping the setting brings the tab straight back.
  const showsInjection = insulinModeUsesInsulin(activeProfile?.insulin_mode);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // A backgrounded tab stops paying for re-render/layout work it cannot
        // show; state is kept (unlike unmountOnBlur), so switching back is the
        // same screen where the user left it.
        freezeOnBlur: true,
        tabBarActiveTintColor: THEME.accent,
        tabBarInactiveTintColor: THEME.textMuted,
        tabBarStyle: {
          backgroundColor: THEME.bg.g1,
          borderTopColor: THEME.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.today"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pulse-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="food"
        options={{
          title: t("tabs.food"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="fast-food-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="injection"
        options={{
          title: t("tabs.injection"),
          href: showsInjection ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="medkit-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
