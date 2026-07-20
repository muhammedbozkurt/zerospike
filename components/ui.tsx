import React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { hapticSelect } from "../lib/haptics";
import { COLORS, TABULAR } from "../lib/theme/tokens";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "lg" | "md" | "sm";

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: "bg-brand active:bg-brandDark",
  secondary: "bg-zinc-800 active:bg-zinc-700",
  danger: "bg-rose-500/15 active:bg-rose-500/25 border border-rose-500/40",
  ghost: "bg-transparent active:bg-zinc-900",
};

const VARIANT_TEXT: Record<ButtonVariant, string> = {
  primary: "text-black",
  secondary: "text-zinc-100",
  danger: "text-rose-400",
  ghost: "text-zinc-300",
};

const SIZE_PAD: Record<ButtonSize, string> = {
  lg: "py-4 px-5",
  md: "py-3 px-4",
  sm: "py-2 px-3",
};

const SIZE_TEXT: Record<ButtonSize, string> = {
  lg: "text-base",
  md: "text-base",
  sm: "text-sm",
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  icon,
  className = "",
}: ButtonProps) {
  const isOff = disabled || loading;
  return (
    <Pressable
      onPress={isOff ? undefined : onPress}
      className={`flex-row items-center justify-center rounded-2xl ${SIZE_PAD[size]} ${VARIANT_BG[variant]} ${isOff ? "opacity-50" : ""} ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#000" : "#a1a1aa"} />
      ) : (
        <>
          {icon ? <View className="mr-2">{icon}</View> : null}
          <Text
            className={`font-semibold ${SIZE_TEXT[size]} ${VARIANT_TEXT[variant]}`}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-2xl bg-zinc-900 border border-zinc-800 p-4 ${className}`}
      {...rest}
    >
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2 mt-1">
      {children}
    </Text>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text className="text-3xl font-bold text-zinc-50">{children}</Text>;
}

export function Muted({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <Text className={`text-zinc-400 ${className}`}>{children}</Text>;
}

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
}

export function Field({ label, hint, className = "", ...rest }: FieldProps) {
  return (
    <View className="mb-3">
      {label ? (
        <Text className="text-sm font-medium text-zinc-300 mb-1.5">{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor="#52525b"
        className={`rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-base text-zinc-50 ${className}`}
        {...rest}
      />
      {hint ? <Text className="text-xs text-zinc-500 mt-1">{hint}</Text> : null}
    </View>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: SegmentedProps<T>) {
  return (
    <View
      className={`flex-row flex-wrap gap-2 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              if (!active) hapticSelect();
              onChange(opt.value);
            }}
            className={`rounded-full px-3.5 py-2 border ${
              active
                ? "bg-brand border-brand"
                : "bg-zinc-900 border-zinc-700"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                active ? "text-black" : "text-zinc-300"
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider() {
  return <View className="h-px bg-zinc-800 my-1" />;
}

interface IconRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  /** Right-hand value string (rendered with tabular figures). */
  value?: string;
  /** Custom right node (overrides `value`). */
  right?: React.ReactNode;
  onPress?: () => void;
  /** Tint for the leading icon circle (default brand). */
  tint?: string;
  destructive?: boolean;
}

/**
 * A tinted-icon list row: leading icon in a soft circle, label (+ optional
 * sublabel), and either a value, a custom right node, or a chevron when
 * tappable. The app's standard row for settings-style lists and summaries.
 */
export function IconRow({
  icon,
  label,
  sublabel,
  value,
  right,
  onPress,
  tint = COLORS.brand,
  destructive = false,
}: IconRowProps) {
  const body = (
    <>
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: destructive ? "rgba(244,63,94,0.12)" : COLORS.brandTint }}
      >
        <Ionicons name={icon} size={20} color={destructive ? "#fb7185" : tint} />
      </View>
      <View className="flex-1">
        <Text className={`font-semibold ${destructive ? "text-rose-400" : "text-zinc-100"}`}>
          {label}
        </Text>
        {sublabel ? <Text className="text-zinc-500 text-xs mt-0.5">{sublabel}</Text> : null}
      </View>
      {right ? (
        right
      ) : value ? (
        <Text style={TABULAR} className="text-zinc-300 font-semibold mr-1">
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color={COLORS.textFaint} />
      ) : null}
    </>
  );

  const className =
    "rounded-2xl bg-zinc-900 border border-zinc-800 p-3.5 flex-row items-center mb-2";
  if (!onPress) return <View className={className}>{body}</View>;
  return (
    <Pressable onPress={onPress} className={`${className} active:bg-zinc-800`}>
      {body}
    </Pressable>
  );
}

export interface SegmentedStatItem {
  label: string;
  value: string;
  accent?: string;
}

/**
 * A compact horizontal strip of 2–4 mini stats (label + value) separated by
 * hairline dividers - the "N-up" summary used on the dashboard and mirrored in
 * the doctor report. One row, one card, one visual language.
 */
export function SegmentedStat({
  items,
  className = "",
}: {
  items: SegmentedStatItem[];
  className?: string;
}) {
  return (
    <View
      className={`flex-row rounded-2xl bg-zinc-900 border border-zinc-800 py-3 ${className}`}
    >
      {items.map((item, i) => (
        <View
          key={item.label}
          className="flex-1 items-center px-1"
          style={
            i > 0 ? { borderLeftWidth: 1, borderLeftColor: COLORS.border } : undefined
          }
        >
          <Text
            style={[{ color: item.accent ?? COLORS.textPrimary }, TABULAR]}
            className="text-lg font-extrabold"
            numberOfLines={1}
          >
            {item.value}
          </Text>
          <Text
            className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mt-0.5 text-center"
            numberOfLines={1}
          >
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
