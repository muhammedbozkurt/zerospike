import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { THEME, RADIUS } from "../lib/theme/tokens";
import { IconTile } from "./rich";
import { hapticSelect } from "../lib/haptics";

interface QuickAddSheetProps {
  visible: boolean;
  onClose: () => void;
  onGlucose: () => void;
  onFood: () => void;
  onInjection: () => void;
  /** Hide the injection card for a profile that takes no insulin. */
  showInjection?: boolean;
}

/**
 * The dashboard's "add record" entry. Instead of always opening the glucose
 * sheet (a dead end for a meal or an injection), it offers the three log kinds
 * as big icon cards so each is one tap from the dashboard. The dashboard is a
 * tab (root view controller), so a plain absolute overlay presents cleanly here
 * without the RN-Modal-over-modal problem the Feedback host works around.
 */
export function QuickAddSheet({
  visible,
  onClose,
  onGlucose,
  onFood,
  onInjection,
  showInjection = true,
}: QuickAddSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  if (!visible) return null;

  const options: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
  }[] = [
    { key: "glucose", icon: "water", label: t("dashboard.quickAddGlucose"), onPress: onGlucose },
    { key: "food", icon: "restaurant", label: t("dashboard.quickAddFood"), onPress: onFood },
    ...(showInjection
      ? [
          {
            key: "injection",
            icon: "medkit" as keyof typeof Ionicons.glyphMap,
            label: t("dashboard.quickAddInjection"),
            onPress: onInjection,
          },
        ]
      : []),
  ];

  const select = (fn: () => void) => {
    hapticSelect();
    onClose();
    fn();
  };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 200 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.7)" }]}
          onPress={onClose}
          accessibilityLabel={t("common.close")}
        />
      </Animated.View>
      <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
        <Animated.View
          style={{
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [40, 0],
                }),
              },
            ],
          }}
        >
          <View
            style={{
              backgroundColor: THEME.bg.g1,
              borderTopLeftRadius: RADIUS["2xl"],
              borderTopRightRadius: RADIUS["2xl"],
              borderTopWidth: 1,
              borderColor: THEME.border,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom + 20,
            }}
          >
            <View style={{ alignItems: "center", marginBottom: 8 }}>
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: THEME.border,
                }}
              />
            </View>
            <Text
              style={{
                color: THEME.muted,
                textAlign: "center",
                fontSize: 13,
                paddingVertical: 6,
              }}
            >
              {t("dashboard.quickAddTitle")}
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
              {options.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => select(opt.onPress)}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: THEME.glass,
                    borderWidth: 1,
                    borderColor: THEME.border,
                    borderRadius: RADIUS.lg,
                    paddingVertical: 18,
                    gap: 10,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                >
                  <IconTile icon={opt.icon} size={48} radius={14} hero />
                  <Text
                    style={{ color: THEME.ink, fontWeight: "700", fontSize: 13 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
