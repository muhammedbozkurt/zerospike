import React from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { Card, Txt } from "./ui";
import { DirIcon } from "./DirIcon";
import { GradientCTA, IconTile, arcPath, withAlpha } from "./rich";
import { HIT_TARGET, RADIUS, SPACE, THEME } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { upper } from "../lib/upper";
import { welcomePreviewMode } from "../lib/homeEmpty";

interface WelcomeCardProps {
  onAddFirst: () => void;
  onAddFood: () => void;
  onSetReminder: () => void;
}

const ILLUSTRATION = 64;

/** Small open ring with a drop in it: the same gauge the first reading will
 *  fill, drawn at a size that does not take over the first screen. */
function Illustration() {
  const size = ILLUSTRATION;
  const stroke = 6;
  const r = (size - stroke) / 2 - 1;
  const c = size / 2;
  const start = 135;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Path
          d={arcPath(c, c, r, start, start + 270)}
          stroke={THEME.track}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={arcPath(c, c, r, start, start + 90)}
          stroke={THEME.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <Ionicons name="water" size={24} color={THEME.accent} />
    </View>
  );
}

function Silhouette({ w, h, radius = RADIUS.sm }: { w: number | `${number}%`; h: number; radius?: number }) {
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        backgroundColor: withAlpha(THEME.textMuted, 0.35),
      }}
    />
  );
}

/**
 * Faded outline of what the home screen fills in after the first reading
 * (ring, week boxes, daily flow). Sample shapes only, so it is hidden from
 * touch and screen readers and carries the "Example" badge.
 */
function PreviewRow({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ opacity: 0.5 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: SPACE.sm,
          gap: SPACE.sm,
        }}
      >
        <Txt kind="caption" tone="muted" style={{ fontWeight: "700", flex: 1, minWidth: 0 }}>
          {t("dashboard.previewTitle")}
        </Txt>
        <View
          style={{
            borderRadius: RADIUS.full,
            borderWidth: 1,
            borderColor: THEME.border,
            paddingHorizontal: SPACE.sm,
            paddingVertical: 2,
          }}
        >
          <Txt kind="micro" tone="muted" style={{ fontWeight: "700", letterSpacing: 1 }}>
            {upper(t("onboarding.exampleBadge"))}
          </Txt>
        </View>
      </View>
      <View
        style={{
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: THEME.border,
          padding: SPACE.md,
          gap: SPACE.md,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              borderWidth: 6,
              borderColor: withAlpha(THEME.textMuted, 0.35),
            }}
          />
          <View style={{ flex: 1, gap: SPACE.sm }}>
            <Silhouette w="70%" h={10} />
            <Silhouette w="45%" h={10} />
          </View>
        </View>
        {compact ? null : (
          <>
            <View style={{ flexDirection: "row", gap: SPACE.sm }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ flex: 1 }}>
                  <Silhouette w="100%" h={28} radius={RADIUS.md} />
                </View>
              ))}
            </View>
            <View style={{ gap: SPACE.sm }}>
              <Silhouette w="100%" h={12} />
              <Silhouette w="85%" h={12} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Home screen for a profile with nothing logged yet: a compact welcome with
 * the one primary action, three short steps that open the existing screens,
 * and a faded outline of what appears after the first reading. Replaces the
 * large empty ring; the normal layout takes over with the first record.
 */
export function WelcomeCard({ onAddFirst, onAddFood, onSetReminder }: WelcomeCardProps) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const previewMode = welcomePreviewMode({
    screenHeight: height,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });
  const steps: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    { key: "log", icon: "water", label: t("dashboard.welcomeStep1"), onPress: onAddFirst },
    { key: "meal", icon: "restaurant", label: t("dashboard.welcomeStep2"), onPress: onAddFood },
    { key: "reminder", icon: "alarm-outline", label: t("dashboard.welcomeStep3"), onPress: onSetReminder },
  ];
  return (
    <>
      <Card accent style={{ marginBottom: SPACE.md, gap: SPACE.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
          <Illustration />
          <View style={{ flex: 1, minWidth: 0, gap: SPACE.xs }}>
            <Txt kind="subtitle" style={{ fontWeight: "800" }}>
              {t("dashboard.welcomeTitle")}
            </Txt>
            <Txt kind="caption" tone="muted">
              {t("dashboard.welcomeBody")}
            </Txt>
          </View>
        </View>
        <GradientCTA label={t("dashboard.firstCta")} onPress={onAddFirst} />
      </Card>

      <Card style={{ marginBottom: SPACE.md, gap: SPACE.xs }}>
        {steps.map((step, i) => (
          <Pressable
            key={step.key}
            onPress={step.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1}. ${step.label}`}
            android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
            className="flex-row items-center active:opacity-80"
            style={{ gap: SPACE.md, minHeight: HIT_TARGET }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
              }}
            >
              <Txt kind="micro" tone="accent" tabular style={{ fontWeight: "800" }}>
                {i + 1}
              </Txt>
            </View>
            <IconTile icon={step.icon} size={34} radius={11} hero />
            <Txt kind="caption" style={{ fontWeight: "700", flex: 1, minWidth: 0 }}>
              {step.label}
            </Txt>
            <DirIcon name="chevron-forward" size={16} color={THEME.textMuted} />
          </Pressable>
        ))}
      </Card>

      {previewMode === "hidden" ? null : (
        <View style={{ marginBottom: SPACE.md }}>
          <PreviewRow compact={previewMode === "compact"} />
        </View>
      )}
    </>
  );
}
