import React, { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
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
import { WelcomePreview } from "./WelcomePreview";
import { RADIUS, THEME, glow } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";
import { useLayout } from "../../lib/useLayout";
import { useFontScale } from "../../lib/useFontScale";
import { STACK_AT_SCALE, wordFitMultiplier } from "../../lib/layoutForFontScale";

const AUTO_ADVANCE_MS = 3500;

/** Cap for the centred column on a tablet, matching the quiz card's width so
 *  the welcome and the first question read as the same page. */
const COLUMN_MAX_WIDTH = 520;
/** The body copy never runs the full column: a measure this short is what keeps
 *  the three slides reading as one poster rather than a paragraph. */
const BODY_MAX_WIDTH = 320;

const SLIDES: { key: string }[] = [{ key: "slide1" }, { key: "slide2" }, { key: "slide3" }];

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
  // Large text: the carousel pages scroll on their own, the decorative sample
  // card goes away and each heading stops growing before its longest word
  // would break mid-glyph. None of this applies at the default size.
  const fontScale = useFontScale();
  const large = fontScale > STACK_AT_SCALE;
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
            {SLIDES.map((slide, i) => {
              const titleSize = dense ? 28 : 34;
              const title = t(`onboarding.${slide.key}Title`);
              const body = t(`onboarding.${slide.key}Body`);
              const pageWidth = width - 32;
              const content = (
                <>
                  <FadeSlideIn style={{ alignItems: "center" }}>
                    {large ? null : (
                      <View
                        style={{
                          height: dense ? 156 : 164,
                          width: "100%",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <WelcomePreview slide={i as 0 | 1 | 2} active={i === index} />
                      </View>
                    )}
                    <Text
                      maxFontSizeMultiplier={wordFitMultiplier(title, titleSize, pageWidth, fontScale)}
                      style={{
                        color: THEME.text,
                        fontSize: titleSize,
                        lineHeight: dense ? 34 : 40,
                        fontWeight: "800",
                        textAlign: "center",
                        marginTop: large ? 12 : dense ? 14 : 24,
                      }}
                    >
                      {title}
                    </Text>
                  </FadeSlideIn>
                  <FadeSlideIn delay={ENTRANCE_STAGGER_MS}>
                    <Text
                      maxFontSizeMultiplier={wordFitMultiplier(body, 16, pageWidth, fontScale)}
                      style={{
                        color: THEME.textMuted,
                        fontSize: 16,
                        lineHeight: 23,
                        textAlign: "center",
                        marginTop: 14,
                        maxWidth: large ? undefined : BODY_MAX_WIDTH,
                        flexShrink: 1,
                      }}
                    >
                      {body}
                    </Text>
                  </FadeSlideIn>
                </>
              );
              return (
                <View
                  key={slide.key}
                  style={{ width, paddingHorizontal: 16, paddingBottom: large ? 0 : 24 }}
                  className="items-center justify-start"
                >
                  {large ? (
                    <ScrollView
                      style={{ flex: 1, width: "100%" }}
                      contentContainerStyle={{ alignItems: "center", paddingBottom: 16 }}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                    >
                      {content}
                    </ScrollView>
                  ) : (
                    content
                  )}
                </View>
              );
            })}
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
