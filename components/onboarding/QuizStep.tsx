import React, { useEffect } from "react";
import { ScrollView, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { FadeSlideIn, ENTRANCE_STAGGER_MS, DURATION } from "./motion";
import { EASE_OUT } from "../../lib/theme/motion";
import { StepGlyph } from "./StepGlyph";
import { ELEVATION, RADIUS, SPACE, THEME, glow } from "../../lib/theme/tokens";
import { useLayout } from "../../lib/useLayout";
import { useFontScale } from "../../lib/useFontScale";
import { wordFitMultiplier } from "../../lib/layoutForFontScale";

/** Cap for the interactive column (option cards, inputs, footer) on wide
 *  screens; narrower than CONTENT_MAX_WIDTH so a tablet's option list and
 *  primary button never stretch edge to edge. Doubles as the width of the
 *  tablet dialog card, so the card's outer edge lands exactly where the option
 *  cards used to sit. */
const INTERACTIVE_MAX_WIDTH = 520;

/** Short-screen threshold: below this the step trims its own vertical rhythm
 *  (smaller title, tighter spacing) instead of relying on scrolling alone. */
const DENSE_HEIGHT = 700;

// QuizStep remounts per step, so the fill starts from where the last step left
// it: the bar then visibly grows instead of jumping to the new width.
let lastFill = 0;

function ProgressFill({ progress }: { progress: number }) {
  const reduced = useReducedMotion();
  const target = Math.min(1, Math.max(0, progress));
  const fill = useSharedValue(reduced ? target : lastFill);
  useEffect(() => {
    lastFill = target;
    if (reduced) {
      fill.value = target;
      return;
    }
    fill.value = withTiming(target, {
      duration: DURATION.base,
      easing: EASE_OUT,
      reduceMotion: ReduceMotion.System,
    });
  }, [target, reduced, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <Animated.View
      style={[
        {
          height: "100%",
          borderRadius: RADIUS.full,
          backgroundColor: THEME.accentFill,
        },
        glow(THEME.accent, 8, 0.8),
        style,
      ]}
    />
  );
}

/**
 * One quiz question frame, in the approved three-zone rhythm: the progress
 * hairline and the title sit at the top, the interaction block is CENTRED in
 * whatever room is left (with the step's glyph above it), and the CTA is
 * pinned at the bottom. Remount it with a `key` per step to replay the
 * entrance cascade.
 *
 * The title is outside the scroller on purpose: it is the question, so it must
 * stay put while a long answer list (six diabetes types on a small phone)
 * scrolls under it.
 *
 * Phone: the frame fills the screen, footer pinned to the bottom.
 * Tablet: the whole block becomes a centred dialog card that hugs its content,
 * so a short step no longer stretches into two dead bands (one above the title,
 * one between the last option and the footer). The card only starts to shrink,
 * and its scroller only starts to scroll, once the content is taller than the
 * screen.
 */
export function QuizStep({
  progress,
  title,
  hint,
  glyph,
  glyphTone,
  footer,
  compact = false,
  insetsBottom = 0,
  children,
}: {
  progress: number;
  title: string;
  hint?: string;
  /** The step's anchor glyph, drawn above the interaction block. Steps whose
   *  content already fills the frame pass nothing. */
  glyph?: keyof typeof Ionicons.glyphMap;
  glyphTone?: "accent" | "caution";
  footer?: React.ReactNode;
  /** Store-screenshot only (see scCompact in app/onboarding.tsx): render the
   *  short-screen rhythm and pin the interaction block under the question
   *  instead of centring it in the leftover room. Ignored on the wide layout,
   *  whose card hugs its content already. */
  compact?: boolean;
  /** Safe-area bottom inset, applied inside the pinned footer (or, when there
   *  is no footer, as extra scroll padding) so the caller's own wrapper never
   *  has to add it a second time. On a tablet the footer rides inside the
   *  floating card, so the inset moves to the card's outer container. */
  insetsBottom?: number;
  children: React.ReactNode;
}) {
  const { width, height, isWide } = useLayout();
  const fontScale = useFontScale();
  const tight = compact && !isWide;
  const dense = height < DENSE_HEIGHT || tight;
  const interactiveColumnStyle = isWide
    ? { maxWidth: INTERACTIVE_MAX_WIDTH, width: "100%" as const, alignSelf: "center" as const }
    : undefined;

  const progressBar = (extra?: ViewStyle) => (
    <View
      style={[
        {
          height: 4,
          borderRadius: RADIUS.full,
          backgroundColor: THEME.track,
          overflow: "hidden",
          marginTop: 6,
        },
        extra,
      ]}
    >
      <ProgressFill progress={progress} />
    </View>
  );

  // The question's longest word must stay on one line at large text: RN would
  // otherwise break it mid-word ("kullanıyorsunu/z"). Phone: the screen minus
  // the 16 + 24 padding on both sides; tablet: the card's inner width.
  const titleSize = dense ? 22 : 28;
  const titleWidth = isWide ? INTERACTIVE_MAX_WIDTH - 2 * SPACE.xl : width - 2 * (SPACE.lg + 24);
  const titleCap = wordFitMultiplier(title, titleSize, titleWidth, fontScale);

  const header = (
    <View style={{ marginTop: dense ? 18 : 26 }}>
      <FadeSlideIn>
        <Text
          maxFontSizeMultiplier={titleCap}
          style={{
            color: THEME.text,
            fontSize: titleSize,
            lineHeight: dense ? 28 : 34,
            fontWeight: "700",
          }}
        >
          {title}
        </Text>
      </FadeSlideIn>
      {hint ? (
        <FadeSlideIn delay={ENTRANCE_STAGGER_MS}>
          <Text
            style={{
              color: THEME.textMuted,
              fontSize: dense ? 15 : 16,
              lineHeight: dense ? 20 : 22,
              marginTop: 10,
            }}
          >
            {hint}
          </Text>
        </FadeSlideIn>
      ) : null}
    </View>
  );

  const scroller = (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        // The interaction block sits in the middle of the room left between the
        // question and the CTA. Once the content is taller than that room the
        // container grows to fit it and this centring becomes a no-op, so a
        // long step still scrolls from its own top.
        justifyContent: tight ? "flex-start" : "center",
        paddingTop: tight ? 0 : dense ? 12 : 20,
        paddingBottom: isWide || footer ? 16 : insetsBottom + 16,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={interactiveColumnStyle}>
        {/* Same delay the caller gives its first option, so the glyph and the
            block under it arrive as one beat of the entrance cascade. */}
        {glyph ? (
          <FadeSlideIn delay={ENTRANCE_STAGGER_MS * 2}>
            <StepGlyph icon={glyph} tone={glyphTone} dense={dense} />
          </FadeSlideIn>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );

  const footerBlock = footer ? (
    // No divider: the approved frame separates the CTA by space alone, so the
    // pinned action reads as part of the page rather than a toolbar on it.
    <View style={{ marginTop: dense ? 10 : 16, paddingBottom: isWide ? 0 : insetsBottom }}>
      <FadeSlideIn delay={ENTRANCE_STAGGER_MS * 3} style={interactiveColumnStyle}>
        {footer}
      </FadeSlideIn>
    </View>
  ) : null;

  if (isWide) {
    return (
      <View className="flex-1" style={{ justifyContent: "center", paddingBottom: insetsBottom }}>
        {/* Progress bar rides with the card, not with the screen edges, so the
            two read as one centred stack instead of a hairline stranded at the
            top of a mostly empty screen. */}
        <View
          style={{
            width: "100%",
            maxWidth: INTERACTIVE_MAX_WIDTH,
            alignSelf: "center",
            flexShrink: 1,
          }}
        >
          {progressBar({ marginBottom: 14 })}
          {/* flexShrink lets the card give up height (and its scroller start
              scrolling) on a step taller than the screen; with content that
              fits, the card hugs it. */}
          <View
            style={{
              flexShrink: 1,
              backgroundColor: THEME.surfaceRaised,
              borderRadius: RADIUS["2xl"],
              borderWidth: 1,
              borderColor: THEME.border,
              paddingHorizontal: SPACE.xl,
              paddingTop: SPACE.sm,
              paddingBottom: SPACE.xl,
              ...ELEVATION.card,
            }}
          >
            {header}
            {scroller}
            {footerBlock}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {progressBar()}
      {header}
      {scroller}
      {footerBlock}
    </View>
  );
}
