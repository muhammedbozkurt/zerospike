import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { TOAST_MAX_WIDTH } from "../lib/toastQueue";
import { ELEVATION, HIT_TARGET, RADIUS, THEME, TYPE } from "../lib/theme/tokens";

export type ToastKind = "success" | "info" | "error";

export interface ToastCardAction {
  label: string;
  onPress: () => void;
  secondary?: { label: string; onPress: () => void };
}

/** The kind is carried by the icon shape as well as its color, so it survives Increase Contrast and color-blindness. */
function kindStyle(kind: ToastKind): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  switch (kind) {
    case "success":
      return { icon: "checkmark-circle", color: THEME.success };
    case "info":
      return { icon: "information-circle", color: THEME.accent };
    default:
      return { icon: "alert-circle", color: THEME.danger };
  }
}

/** Icon, message (wraps, never clipped) and an optional action on one raised card. */
export function ToastCard({
  message,
  kind,
  action,
}: {
  message: string;
  kind: ToastKind;
  action: ToastCardAction | null;
}) {
  const ks = kindStyle(kind);
  const two = action?.secondary != null;
  const primary = action ? (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={({ pressed }) => ({
        marginStart: two ? 0 : 8,
        minHeight: HIT_TARGET,
        minWidth: HIT_TARGET,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: THEME.accentFill,
        borderRadius: RADIUS.full,
        paddingHorizontal: 16,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: THEME.accentOnFill, fontWeight: "800", fontSize: 14 }}>
        {action.label}
      </Text>
    </Pressable>
  ) : null;
  const secondary = action?.secondary ? (
    <Pressable
      onPress={action.secondary.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.secondary.label}
      style={({ pressed }) => ({
        minHeight: HIT_TARGET,
        minWidth: HIT_TARGET,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: THEME.borderStrong,
        paddingHorizontal: 16,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: THEME.text, fontWeight: "700", fontSize: 14 }}>
        {action.secondary.label}
      </Text>
    </Pressable>
  ) : null;
  const messageRow = (
    <View style={{ flexDirection: "row", alignItems: "center", flex: two ? undefined : 1 }}>
      <Ionicons name={ks.icon} size={22} color={ks.color} />
      <Text
        accessible
        accessibilityRole="text"
        style={{
          ...TYPE.bodyStrong,
          fontSize: 15,
          lineHeight: 20,
          color: THEME.text,
          flex: 1,
          flexShrink: 1,
          marginStart: 10,
          paddingVertical: 4,
        }}
      >
        {message}
      </Text>
    </View>
  );
  return (
    <View
      style={{
        flexDirection: two ? "column" : "row",
        alignItems: two ? "stretch" : "center",
        backgroundColor: THEME.surfaceRaised,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: THEME.borderStrong,
        paddingVertical: 8,
        paddingStart: 14,
        paddingEnd: action ? 8 : 14,
        minHeight: HIT_TARGET + 16,
        width: "100%",
        maxWidth: TOAST_MAX_WIDTH,
        alignSelf: "center",
        ...ELEVATION.card,
      }}
    >
      {messageRow}
      {two ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", columnGap: 8, rowGap: 8 }}>
          {secondary}
          {primary}
        </View>
      ) : (
        primary
      )}
    </View>
  );
}
