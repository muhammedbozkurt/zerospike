import React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { hapticSelect } from "../lib/haptics";
import {
  activePalette,
  GLUCOSE_RICH,
  INPUT_TEXT,
  SPACE,
  TABULAR,
  THEME,
} from "../lib/theme/tokens";
import {
  RIPPLE_ALPHA,
  ROW_MIN_HEIGHT,
  ROW_PLATE,
  TEXT_KIND_STYLE,
  buttonClassName,
  buttonHitSlop,
  buttonTextClassName,
  chipClassName,
  chipTextClassName,
  hitSlopFor,
  isCanonicalVariant,
  resolveVariantColors,
  toneColor,
  CHIP_VISUAL_HEIGHT,
  type ButtonSize,
  type ButtonVariant,
  type TextKind,
  type TextTone,
} from "../lib/theme/uiPrimitives";
import { GlassCard, withAlpha } from "./rich/GlassCard";
import type { GlassCardProps } from "./rich/GlassCard";
import { upper } from "../lib/upper";
import { DirIcon } from "./DirIcon";
import { STACK_AT_SCALE, linesFor } from "../lib/layoutForFontScale";
import { useFontScale } from "../lib/useFontScale";

interface ButtonProps {
  label: string;
  onPress?: () => void;
  /** Canonical names: primary, outlined (framed secondary), tertiary,
   *  destructive. Legacy secondary/danger/ghost render exactly as before. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
  /** Lift the touch area to 44 pt without changing the painted size. Defaults
   *  on for the canonical names outlined/tertiary/destructive, off for legacy. */
  minHit?: boolean;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  icon,
  className = "",
  minHit,
}: ButtonProps) {
  const isOff = disabled || loading;
  const fontScale = useFontScale();
  const modern = isCanonicalVariant(variant);
  const wantHit = minHit ?? modern;
  return (
    <Pressable
      onPress={isOff ? undefined : onPress}
      // Passed to Pressable, not just used for styling: a screen reader announced
      // a greyed-out button as fully available, and the "dimmed" cue is invisible
      // to it. `disabled` also stops the press ripple/highlight from firing.
      disabled={isOff}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isOff, busy: !!loading }}
      hitSlop={wantHit ? buttonHitSlop(size) : undefined}
      android_ripple={
        modern
          ? {
              color: withAlpha(resolveVariantColors(variant, activePalette()).ripple, RIPPLE_ALPHA),
              foreground: true,
            }
          : undefined
      }
      className={buttonClassName(variant, size, !!isOff, className)}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? THEME.accentOnFill : THEME.textMuted} />
      ) : (
        <>
          {icon ? <View className="mr-2">{icon}</View> : null}
          {/* No adjustsFontSizeToFit: inside a scale-in dialog iOS measures the
              first (tiny) width and the shrunken font sticks. Long labels
              ellipsize instead; at large text they wrap onto more lines. */}
          <Text
            className={buttonTextClassName(variant, size)}
            style={{ flexShrink: 1 }}
            numberOfLines={linesFor(fontScale, 1)}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The one card: GlassCard body with SPACE.lg padding and RADIUS.lg. (GlassCard
 * itself keeps its legacy padding 12 for its existing 54 call sites.)
 */
export function Card({ style, children, ...rest }: GlassCardProps) {
  return (
    <GlassCard style={[{ padding: SPACE.lg }, style]} {...rest}>
      {children}
    </GlassCard>
  );
}

/** Typography step with the 5-kind scale (title, subtitle, body, caption, micro). */
export function Txt({
  kind = "body",
  tone = "text",
  tabular,
  style,
  ...rest
}: TextProps & { kind?: TextKind; tone?: TextTone; tabular?: boolean }) {
  return (
    <Text
      {...rest}
      style={[
        TEXT_KIND_STYLE[kind],
        { color: toneColor(tone, activePalette()) },
        tabular ? TABULAR : undefined,
        style,
      ]}
    />
  );
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

/** Selectable pill. Painted 36 pt, touch area lifted to 44 pt via hitSlop;
 *  long labels wrap instead of clipping. */
export function Chip({ label, selected = false, onPress, icon, className = "" }: ChipProps) {
  const slop = hitSlopFor(CHIP_VISUAL_HEIGHT);
  return (
    <Pressable
      onPress={() => {
        if (!selected) hapticSelect();
        onPress?.();
      }}
      hitSlop={slop > 0 ? { top: slop, bottom: slop, left: 4, right: 4 } : undefined}
      android_ripple={{
        color: withAlpha(selected ? activePalette().accentOnFill : activePalette().text, RIPPLE_ALPHA),
        foreground: true,
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className={`${chipClassName(selected)} active:opacity-80 ${className}`}
    >
      {icon ? <View className="mr-1.5">{icon}</View> : null}
      <Text className={chipTextClassName(selected)} style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** One quiet line under the label. */
  sub?: string;
  value?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  danger?: boolean;
}

/**
 * The list row: 36 pt icon plate, label (up to 2 lines), one sub line, right
 * item vertically centered, chevron when tappable. minHeight is a floor so a
 * long DE/FR label wraps instead of clipping. Same look as settingsUi.Row;
 * the settings batch switches to this one.
 */
export function Row({ icon, label, sub, value, right, onPress, onLongPress, danger }: RowProps) {
  const fontScale = useFontScale();
  // Large text: the value drops under the label instead of squeezing it.
  const stackValue = fontScale > STACK_AT_SCALE;
  const tone = danger ? THEME.danger : THEME.accent;
  const interactive = !!(onPress || onLongPress);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!interactive}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      android_ripple={
        interactive ? { color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true } : undefined
      }
      className={`flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2 ${
        interactive ? "active:opacity-80" : ""
      }`}
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      <View
        className="rounded-xl items-center justify-center"
        style={{ width: ROW_PLATE, height: ROW_PLATE, backgroundColor: withAlpha(tone, 0.14) }}
      >
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <View className="flex-1 mx-3">
        <Text
          className="text-[15px] font-semibold"
          style={{ color: danger ? THEME.danger : THEME.text }}
          numberOfLines={linesFor(fontScale, 2)}
        >
          {label}
        </Text>
        {sub ? (
          <Text className="text-mut text-[12px] mt-0.5" numberOfLines={linesFor(fontScale, 1)}>
            {sub}
          </Text>
        ) : null}
        {value && stackValue ? (
          <Text className="text-mut text-[13px] mt-0.5 font-medium">{value}</Text>
        ) : null}
      </View>
      {value && !stackValue ? (
        <Text className="text-mut text-[13px] mr-1 font-medium" numberOfLines={2}>
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} /> : null)}
    </Pressable>
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
  { label, hint, className = "", style, ...rest },
  ref
) {
  return (
    <View className="mb-3">
      {label ? (
        <Text className="text-sm font-medium text-mut mb-1.5">{label}</Text>
      ) : null}
      {/* The size comes from INPUT_TEXT, never from a `text-*` class: that class
          would also set a lineHeight, which iOS clips the glyphs against. */}
      <TextInput
        ref={ref}
        placeholderTextColor={THEME.textMuted}
        className={`rounded-xl bg-glass border border-hair px-4 py-3 text-ink ${className}`}
        {...rest}
        style={[INPUT_TEXT, style]}
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
                active ? "text-onAccent" : "text-mut"
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
  const fontScale = useFontScale();
  const stackValue = fontScale > STACK_AT_SCALE && !right && !!value;
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
          style={{ color: destructive ? GLUCOSE_RICH.low : THEME.text }}>
          {label}
        </Text>
        {sublabel ? <Text className="text-mut text-xs mt-0.5">{sublabel}</Text> : null}
        {stackValue ? (
          <Text style={TABULAR} className="text-mut font-semibold mt-0.5">
            {value}
          </Text>
        ) : null}
      </View>
      {right ? (
        right
      ) : value && !stackValue ? (
        <Text style={TABULAR} className="text-mut font-semibold mr-1">
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} />
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
 * A compact horizontal strip of 2-4 mini stats (label + value) separated by
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
  const fontScale = useFontScale();
  // Large text: a 3-4 column strip cannot hold the labels, so each stat becomes
  // its own full-width line (label left, value right) with a top hairline.
  const stacked = fontScale > STACK_AT_SCALE;
  return (
    <View
      className={`${stacked ? "" : "flex-row "}rounded-2xl bg-glass border border-hair py-3 ${className}`}
    >
      {items.map((item, i) => (
        <View
          key={item.label}
          className={stacked ? "flex-row items-center justify-between px-3 py-1.5" : "flex-1 items-center px-1"}
          style={
            i === 0
              ? undefined
              : stacked
                ? { borderTopWidth: 1, borderTopColor: THEME.border }
                : { borderLeftWidth: 1, borderLeftColor: THEME.border }
          }
        >
          {stacked ? (
            <>
              <Text className="text-[10px] font-semibold tracking-wide text-mut flex-1 mr-3">
                {upper(item.label)}
              </Text>
              <Text style={[{ color: item.accent ?? THEME.text }, TABULAR]} className="text-lg font-extrabold">
                {item.value}
              </Text>
            </>
          ) : (
            <>
              {/* German and French labels are 1.5-2x the English ones in the same
                  fixed-width column, so both lines must be allowed to shrink instead
                  of being clipped mid-word. */}
              <Text
                style={[{ color: item.accent ?? THEME.text }, TABULAR]}
                className="text-lg font-extrabold"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {item.value}
              </Text>
              <Text
                className="text-[10px] font-semibold tracking-wide text-mut mt-0.5 text-center"
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {upper(item.label)}
              </Text>
            </>
          )}
        </View>
      ))}
    </View>
  );
}
