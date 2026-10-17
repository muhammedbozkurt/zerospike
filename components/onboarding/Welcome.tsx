import React, { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";

import { Logo } from "../Logo";
import { GradientCTA } from "../rich/GradientCTA";
import { FadeSlideIn, ENTRANCE_STAGGER_MS } from "./motion";
import { RADIUS, THEME, glow } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";
import { useLayout } from "../../lib/useLayout";

const AUTO_ADVANCE_MS = 3500;

/** Cap for the centred column on a tablet, matching the quiz card's width so
 *  the welcome and the first question read as the same page. */
const COLUMN_MAX_WIDTH = 520;
/** The body copy never runs the full column: a measure this short is what keeps
 *  the three slides reading as one poster rather than a paragraph. */
const BODY_MAX_WIDTH = 320;

type IconName = keyof typeof Ionicons.glyphMap;

const SLIDES: { key: string; icon: IconName }[] = [
  { key: "slide1", icon: "flash-outline" },
  { key: "slide2", icon: "bar-chart-outline" },
  { key: "slide3", icon: "document-text-outline" },
];

function Dot({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => {
    const width = active ? 22 : 6;
    return {
      width: reduced
        ? width
        : withTiming(width, { duration: 300, reduceMotion: ReduceMotion.System }),
    };
  });
  return (
    <Animated.View
      style={[
        style,
        {
          height: 6,
          borderRadius: RADIUS.full,
          marginHorizontal: 4,
          backgroundColor: active ? THEME.accentFill : THEME.track,
        },
      ]}
    />
  );
}

/** Welcome screen body: the mark, three value slides, and the CTA. The CTA
 *  walks the slides ("Next") and only starts the quiz from the last one, so the
 *  three pages are a deliberate read rather than something to swipe past. */
export function Welcome({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  const { height, isWide } = useLayout();
  const dense = height < 700;
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reduced = useReducedMotion();
  const last = SLIDES.length - 1;

  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = () => {
    stop();
    if (reduced || width === 0) return;
    timerRef.current = setInterval(() => {
      setIndex((current) => {
        const next = current + 1;
        if (next >= SLIDES.length) {
          stop();
          return current;
        }
        scrollRef.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
  };

  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, reduced]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width === 0) return;
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
    start();
  };

  /** The CTA on the first two slides is "Next": it moves the carousel, and the
   *  auto-advance re-arms from there so a tap never fights the timer. */
  const onCta = () => {
    if (index >= last) {
      onStart();
      return;
    }
    // Before the first layout there is nothing to scroll to, and moving the
    // index alone would leave the dots claiming a page the carousel is not on.
    if (width === 0) return;
    const next = index + 1;
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
    start();
  };

  const columnStyle = isWide
    ? { maxWidth: COLUMN_MAX_WIDTH, width: "100%" as const, alignSelf: "center" as const }
    : undefined;

  return (
    <View className="flex-1">
      <FadeSlideIn style={{ alignItems: "center", marginTop: dense ? 16 : 34 }}>
        <View
          style={[
            {
              width: 84,
              height: 84,
              borderRadius: RADIUS["2xl"],
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: THEME.surface,
              borderWidth: 1,
              borderColor: withAlpha(THEME.accent, 0.35),
            },
            glow(THEME.accent, 42, 0.5),
          ]}
        >
          <Logo size={52} />
        </View>
      </FadeSlideIn>

      <View className="flex-1" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={stop}
            onMomentumScrollEnd={onMomentumEnd}
          >
            {SLIDES.map((slide) => (
              <View
                key={slide.key}
                style={{ width, paddingHorizontal: 16, paddingBottom: 24 }}
                className="items-center justify-center"
              >
                <FadeSlideIn style={{ alignItems: "center" }}>
                  <View
                    style={{
                      width: dense ? 84 : 108,
                      height: dense ? 84 : 108,
                      borderRadius: RADIUS.full,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: withAlpha(THEME.accent, 0.08),
                      borderWidth: 1,
                      borderColor: withAlpha(THEME.accent, 0.22),
                    }}
                  >
                    <Ionicons name={slide.icon} size={dense ? 36 : 44} color={THEME.accent} />
                  </View>
                  <Text
                    style={{
                      color: THEME.text,
                      fontSize: dense ? 28 : 34,
                      lineHeight: dense ? 34 : 40,
                      fontWeight: "800",
                      textAlign: "center",
                      marginTop: dense ? 20 : 30,
                    }}
                  >
                    {t(`onboarding.${slide.key}Title`)}
                  </Text>
                </FadeSlideIn>
                <FadeSlideIn delay={ENTRANCE_STAGGER_MS}>
                  <Text
                    style={{
                      color: THEME.textMuted,
                      fontSize: 16,
                      lineHeight: 23,
                      textAlign: "center",
                      marginTop: 14,
                      maxWidth: BODY_MAX_WIDTH,
                      flexShrink: 1,
                    }}
                  >
                    {t(`onboarding.${slide.key}Body`)}
                  </Text>
                </FadeSlideIn>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View className="flex-row items-center justify-center" style={{ paddingBottom: 22 }}>
        {SLIDES.map((slide, i) => (
          <Dot key={slide.key} active={i === index} />
        ))}
      </View>

      <FadeSlideIn delay={ENTRANCE_STAGGER_MS * 2} style={columnStyle}>
        <GradientCTA
          label={t(index >= last ? "onboarding.getStarted" : "onboarding.next")}
          size="lg"
          style={{ borderRadius: RADIUS.full }}
          onPress={onCta}
        />
      </FadeSlideIn>
    </View>
  );
}
