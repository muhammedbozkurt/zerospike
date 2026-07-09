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

import { Button } from "../ui";
import { Logo } from "../Logo";
import { FadeSlideIn, ENTRANCE_STAGGER_MS } from "./motion";

const AUTO_ADVANCE_MS = 3500;

type IconName = keyof typeof Ionicons.glyphMap;

const SLIDES: { key: string; icon: IconName }[] = [
  { key: "slide1", icon: "flash-outline" },
  { key: "slide2", icon: "pulse-outline" },
  { key: "slide3", icon: "document-text-outline" },
];

function Dot({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => {
    const width = active ? 22 : 8;
    return {
      width: reduced
        ? width
        : withTiming(width, { duration: 300, reduceMotion: ReduceMotion.System }),
    };
  });
  return (
    <Animated.View
      style={style}
      className={`h-2 rounded-full mx-1 ${active ? "bg-brand" : "bg-zinc-700"}`}
    />
  );
}

/** Welcome screen body: the mark, three auto-advancing value slides, and CTA. */
export function Welcome({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reduced = useReducedMotion();

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

  return (
    <View className="flex-1">
      <FadeSlideIn style={{ alignItems: "center", marginTop: 8 }}>
        <View className="w-20 h-20 rounded-3xl bg-brand/10 border border-brand/20 items-center justify-center">
          <Logo size={52} />
        </View>
      </FadeSlideIn>

      <View
        className="flex-1"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
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
                style={{ width }}
                className="items-center justify-center px-4"
              >
                <FadeSlideIn style={{ alignItems: "center" }}>
                  <View className="w-24 h-24 rounded-full bg-brand/10 items-center justify-center mb-8">
                    <Ionicons name={slide.icon} size={44} color="#22d3ee" />
                  </View>
                  <Text className="text-zinc-50 text-center text-2xl font-extrabold">
                    {t(`onboarding.${slide.key}Title`)}
                  </Text>
                </FadeSlideIn>
                <FadeSlideIn delay={ENTRANCE_STAGGER_MS}>
                  <Text className="text-zinc-400 mt-3 text-center text-base leading-6">
                    {t(`onboarding.${slide.key}Body`)}
                  </Text>
                </FadeSlideIn>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View className="flex-row items-center justify-center py-3">
        {SLIDES.map((slide, i) => (
          <Dot key={slide.key} active={i === index} />
        ))}
      </View>

      <FadeSlideIn delay={ENTRANCE_STAGGER_MS * 2}>
        <Button label={t("onboarding.getStarted")} size="lg" onPress={onStart} />
      </FadeSlideIn>
    </View>
  );
}
