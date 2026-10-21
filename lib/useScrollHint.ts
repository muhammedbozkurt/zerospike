import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { SCROLL_HINT_SCROLLED_PT, hasScrolled, scrollHintKey, shouldShowHint } from "./scrollHint";

// Memory copy of the persisted flag: the hint stays once per screen even when
// AsyncStorage is unreadable.
const seenInMemory = new Set<string>();

async function readSeen(screenId: string): Promise<boolean> {
  if (seenInMemory.has(screenId)) return true;
  try {
    const v = await AsyncStorage.getItem(scrollHintKey(screenId));
    if (v === "1") {
      seenInMemory.add(screenId);
      return true;
    }
  } catch {
    // unreadable: memory only
  }
  return false;
}

function markSeen(screenId: string): void {
  seenInMemory.add(screenId);
  void AsyncStorage.setItem(scrollHintKey(screenId), "1").catch(() => {});
}

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(!!v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduce(!!v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * Wires a ScrollView/FlatList/SectionList to <ScrollHint/>. `enabled=false`
 * (a closed sheet) keeps it dormant and resets the measurements.
 */
export function useScrollHint(screenId: string, enabled = true) {
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [seen, setSeen] = useState<boolean | null>(null);
  const persisted = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setContentHeight(0);
      setViewportHeight(0);
      setScrolled(false);
      setSeen(null);
      persisted.current = false;
      return;
    }
    let alive = true;
    void readSeen(screenId).then((v) => {
      if (alive) setSeen(v);
    });
    return () => {
      alive = false;
    };
  }, [screenId, enabled]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (hasScrolled(e.nativeEvent.contentOffset.y)) setScrolled(true);
  }, []);
  const onContentSizeChange = useCallback((_w: number, h: number) => setContentHeight(h), []);
  const onLayout = useCallback((e: LayoutChangeEvent) => setViewportHeight(e.nativeEvent.layout.height), []);

  const visible =
    enabled &&
    seen === false &&
    shouldShowHint({
      contentHeight,
      viewportHeight,
      scrollY: scrolled ? SCROLL_HINT_SCROLLED_PT + 1 : 0,
      seen: false,
    });

  useEffect(() => {
    if (visible && !persisted.current) {
      persisted.current = true;
      markSeen(screenId);
    }
  }, [visible, screenId]);

  return { onScroll, onContentSizeChange, onLayout, visible, scrollEventThrottle: 16 as const };
}
