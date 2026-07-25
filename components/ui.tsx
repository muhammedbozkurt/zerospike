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
import { GLUCOSE_RICH, TABULAR, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { upper } from "../lib/upper";

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
  secondary: "bg-glass active:opacity-80",
  danger: "bg-low/15 active:opacity-80 border border-low/40",
  ghost: "bg-transparent active:opacity-80",
};

const VARIANT_TEXT: Record<ButtonVariant, string> = {
  primary: "text-black",
  secondary: "text-ink",
  danger: "text-low",
  ghost: "text-mut",
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
        <ActivityIndicator color={variant === "primary" ? "#000" : THEME.muted} />
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
      className={`rounded-2xl bg-glass border border-hair p-4 ${className}`}
      {...rest}
    >
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  // Locale-correct uppercasing (drops CSS textTransform, which mangles Turkish
  // 'i'). Non-string children are passed through untouched.
  const content = typeof children === "string" ? upper(children) : children;
  return (
    <Text className="text-xs font-semibold tracking-wider text-mut mb-2 mt-1">
      {content}
    </Text>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text className="text-3xl font-bold text-ink">{children}</Text>;
}

export function Muted({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <Text className={`text-mut ${className}`}>{children}</Text>;
}

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
}

export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, className = "", ...rest },
  ref
) {
  return (
    <View className="mb-3">
      {label ? (
        <Text className="text-sm font-medium text-mut mb-1.5">{label}</Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={THEME.muted}
        className={`rounded-xl bg-glass border border-hair px-4 py-3 text-base text-ink ${className}`}
        {...rest}
      />
      {hint ? <Text className="text-xs text-mut mt-1">{hint}</Text> : null}
    </View>
  );
});

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
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
            className={`rounded-full px-3.5 py-2 border ${
              active
                ? "bg-brand border-brand"
                : "bg-glass border-hair"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                active ? "text-black" : "text-mut"
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
  return <View className="h-px bg-glass my-1" />;
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
  tint = THEME.accent,
  destructive = false,
}: IconRowProps) {
  const body = (
    <>
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{
          backgroundColor: withAlpha(destructive ? GLUCOSE_RICH.low : THEME.accent, 0.12),
        }}
      >
        <Ionicons name={icon} size={20} color={destructive ? GLUCOSE_RICH.low : tint} />
      </View>
      <View className="flex-1">
        <Text className="font-semibold"
          style={{ color: destructive ? GLUCOSE_RICH.low : THEME.ink }}>
          {label}
        </Text>
        {sublabel ? <Text className="text-mut text-xs mt-0.5">{sublabel}</Text> : null}
      </View>
      {right ? (
        right
      ) : value ? (
        <Text style={TABULAR} className="text-mut font-semibold mr-1">
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color={THEME.muted} />
      ) : null}
    </>
  );

  const className =
    "rounded-2xl bg-glass border border-hair p-3.5 flex-row items-center mb-2";
  if (!onPress) return <View className={className}>{body}</View>;
  return (
    <Pressable onPress={onPress} className={`${className} active:opacity-80`}>
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
      className={`flex-row rounded-2xl bg-glass border border-hair py-3 ${className}`}
    >
      {items.map((item, i) => (
        <View
          key={item.label}
          className="flex-1 items-center px-1"
          style={
            i > 0 ? { borderLeftWidth: 1, borderLeftColor: THEME.border } : undefined
          }
        >
          <Text
            style={[{ color: item.accent ?? THEME.ink }, TABULAR]}
            className="text-lg font-extrabold"
            numberOfLines={1}
          >
            {item.value}
          </Text>
          <Text
            className="text-[10px] font-semibold tracking-wide text-mut mt-0.5 text-center"
            numberOfLines={1}
          >
            {upper(item.label)}
          </Text>
        </View>
      ))}
    </View>
  );
}
