import React from "react";
import { ScrollView, Text, View } from "react-native";

import { FadeSlideIn, ENTRANCE_STAGGER_MS } from "./motion";
import { THEME, glow } from "../../lib/theme/tokens";

/**
 * One quiz question frame: a slim progress bar, a staggered title/subtitle, a
 * scrollable content slot (the caller staggers its own options), and an
 * optional pinned footer. Remount it with a `key` per step to replay the
 * entrance cascade.
 */
export function QuizStep({
  progress,
  title,
  hint,
  footer,
  children,
}: {
  progress: number;
  title: string;
  hint?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-1">
      <View className="h-1.5 rounded-full bg-hair overflow-hidden mb-6">
        <View
          className="h-full rounded-full bg-brand"
          style={[
            { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` },
            glow(THEME.accent, 8, 0.8),
          ]}
        />
      </View>

      {/* No automaticallyAdjustKeyboardInsets here: the footer is pinned outside
          this ScrollView, so onboarding lifts the whole screen with a
          KeyboardAvoidingView instead. Doing both would compensate twice. */}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeSlideIn>
          <Text className="text-zinc-50 text-2xl font-bold">{title}</Text>
        </FadeSlideIn>
        {hint ? (
          <FadeSlideIn delay={ENTRANCE_STAGGER_MS}>
            <Text className="text-zinc-400 mt-2 leading-5">{hint}</Text>
          </FadeSlideIn>
        ) : null}
        <View className="mt-6">{children}</View>
      </ScrollView>

      {footer ? (
        <FadeSlideIn delay={ENTRANCE_STAGGER_MS * 3} style={{ marginTop: 12 }}>
          {footer}
        </FadeSlideIn>
      ) : null}
    </View>
  );
}
