import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
              <Ionicons name={icon} size={13} color="#22d3ee" />
            </View>
          ) : null}
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {title}
          </Text>
        </View>
      ) : null}
      <View className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
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
            color="#71717a"
            style={{ marginRight: 12 }}
          />
        ) : null}
        <View className="flex-1 pr-3">
          <Text className={`${large ? "text-base" : "text-[15px]"} text-zinc-100`}>
            {label}
          </Text>
          {hint ? (
            <Text className="text-xs text-zinc-500 mt-0.5">{hint}</Text>
          ) : null}
        </View>
        <View className="flex-row items-center">
          <TextInput
            placeholderTextColor="#52525b"
            className={`text-right ${
              large ? "text-[19px]" : "text-[16px]"
            } font-semibold text-zinc-50 min-w-[56px] max-w-[150px] py-1`}
            {...input}
          />
          {suffix ? (
            <Text className="text-zinc-500 text-sm ml-1.5">{suffix}</Text>
          ) : null}
        </View>
      </View>
      {!last ? <View className="h-px bg-zinc-800 ml-4" /> : null}
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
}: {
  icon?: IconName;
  label: string;
  value: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <View>
      <Pressable onPress={onPress} className="flex-row items-center px-4 py-3.5">
        {icon ? (
          <Ionicons name={icon} size={18} color="#71717a" style={{ marginRight: 12 }} />
        ) : null}
        <Text className="flex-1 text-[15px] text-zinc-100">{label}</Text>
        <Text className="text-zinc-50 font-semibold mr-1.5">{value}</Text>
        <Ionicons name="chevron-forward" size={16} color="#52525b" />
      </Pressable>
      {!last ? <View className="h-px bg-zinc-800 ml-4" /> : null}
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
      className={`flex-row items-center rounded-2xl border px-4 py-3.5 ${
        checked
          ? "bg-brand/10 border-brand/40"
          : "bg-zinc-900 border-zinc-800"
      }`}
    >
      <View
        className={`w-6 h-6 rounded-md items-center justify-center mr-3 border-2 ${
          checked ? "bg-brand border-brand" : "border-zinc-600"
        }`}
      >
        <Animated.View
          style={{ opacity: anim, transform: [{ scale: anim }] }}
        >
          <Ionicons name="checkmark" size={15} color="#000" />
        </Animated.View>
      </View>
      <Text
        className={`flex-1 text-sm ${checked ? "text-brand" : "text-zinc-300"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
