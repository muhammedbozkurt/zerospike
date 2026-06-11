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
            onPress={() => onChange(opt.value)}
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
