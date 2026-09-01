import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  I18nManager,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { INPUT_TEXT, RADIUS, THEME } from "../lib/theme/tokens";
import { upper } from "../lib/upper";
import { DirIcon } from "./DirIcon";
import { withAlpha } from "./rich/GlassCard";

type IconName = keyof typeof Ionicons.glyphMap;

/** A titled, icon-headed section card that groups InputRows. */
export function FormCard({
  icon,
  title,
  children,
  className = "",
}: {
  icon?: IconName;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`mb-4 ${className}`}>
      {title ? (
        <View className="flex-row items-center mb-2 ml-1">
          {icon ? (
            <View className="w-6 h-6 rounded-lg bg-brand/15 items-center justify-center mr-2">
              <Ionicons name={icon} size={13} color="#2ee6ff" />
            </View>
          ) : null}
          <Text className="text-xs font-semibold tracking-wider text-mut">
            {upper(title)}
          </Text>
        </View>
      ) : null}
      <View className="rounded-2xl bg-glass border border-hair overflow-hidden">
        {children}
      </View>
    </View>
  );
}

interface InputRowProps extends Omit<TextInputProps, "style"> {
  icon?: IconName;
  label: string;
  hint?: string;
  suffix?: string;
  last?: boolean;
  /** Roomier row + value, for the full-screen onboarding steps. */
  large?: boolean;
}

/** A single label + right-aligned input row, with a divider unless `last`. */
export function InputRow({
  icon,
  label,
  hint,
  suffix,
  last,
  large,
  ...input
}: InputRowProps) {
  return (
    <View>
      <View className={`flex-row items-center px-4 ${large ? "py-4" : "py-3"}`}>
        {icon ? (
          <Ionicons
            name={icon}
            size={large ? 20 : 18}
            color={THEME.muted}
            style={{ marginRight: 12 }}
          />
        ) : null}
        <View className="flex-1 pr-3">
          <Text className={`${large ? "text-base" : "text-[15px]"} text-ink`}>
            {label}
          </Text>
          {hint ? (
            <Text className="text-xs text-mut mt-0.5">{hint}</Text>
          ) : null}
        </View>
        <View className="flex-row items-center">
          {/* The row's caption and its unit are SIBLINGS of the field, so the
              field itself announced as an unlabelled text box holding a number.
              A caller can still override either. */}
          {/* RTL: textAlign never auto-swaps (only Yoga's own left/right/margin
              props do), so without this the field would stay right-aligned even
              after the row itself mirrors, leaving the number stranded away
              from its unit. Flipped by hand to stay flush against `suffix`;
              writingDirection is pinned LTR too since this field only ever
              holds digits and a decimal separator. */}
          <TextInput
            placeholderTextColor={THEME.muted}
            accessibilityLabel={suffix ? `${label}, ${suffix}` : label}
            accessibilityHint={hint}
            className="font-semibold text-ink min-w-[56px] max-w-[150px] py-1"
            style={[
              INPUT_TEXT,
              { textAlign: I18nManager.isRTL ? "left" : "right", writingDirection: "ltr" },
              large ? { fontSize: 19 } : null,
            ]}
            {...input}
          />
          {suffix ? (
            <Text className="text-mut text-sm ml-1.5">{suffix}</Text>
          ) : null}
        </View>
      </View>
      {!last ? <View className="h-px bg-glass ml-4" /> : null}
    </View>
  );
}

/** A pressable row that opens a value picker (e.g. time), styled like InputRow. */
export function ActionRow({
  icon,
  label,
  value,
  onPress,
  last,
  accessibilityLabel,
}: {
  icon?: IconName;
  label: string;
  value: string;
  onPress?: () => void;
  last?: boolean;
  /** Defaults to "label: value" so a caller never has to repeat both by hand. */
  accessibilityLabel?: string;
}) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
        className="flex-row items-center px-4 py-3.5"
      >
        {icon ? (
          <Ionicons name={icon} size={18} color={THEME.muted} style={{ marginRight: 12 }} />
        ) : null}
        <Text className="flex-1 text-[15px] text-ink">{label}</Text>
        <Text className="text-ink font-semibold mr-1.5">{value}</Text>
        <DirIcon name="chevron-forward" size={16} color={THEME.muted} />
      </Pressable>
      {!last ? <View className="h-px bg-glass ml-4" /> : null}
    </View>
  );
}

/** Animated check used for the disclaimer acceptance. */
export function AcceptCheck({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  const anim = useRef(new Animated.Value(checked ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: checked ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [checked, anim]);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 60,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderRadius: RADIUS.lg,
        // 1.5 in both states so ticking the box never shifts the row.
        borderWidth: 1.5,
        borderColor: checked ? THEME.accent : THEME.border,
        backgroundColor: checked ? withAlpha(THEME.accent, 0.1) : THEME.glass,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: RADIUS.sm,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.5,
          borderColor: checked ? THEME.accent : "rgba(255,255,255,0.22)",
          backgroundColor: checked ? THEME.accent : "transparent",
        }}
      >
        <Animated.View style={{ opacity: anim, transform: [{ scale: anim }] }}>
          <Ionicons name="checkmark" size={15} color="#062126" />
        </Animated.View>
      </View>
      <Text
        style={{
          flex: 1,
          color: THEME.ink,
          fontSize: 16,
          lineHeight: 22,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
