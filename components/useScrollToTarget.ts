import { useEffect } from "react";
import type { RefObject } from "react";
import type { ScrollView, View } from "react-native";

/**
 * Scrolls a ScrollView to a child View once, when `active` turns true. The
 * delay lets a sheet finish sliding in and lay out before the offset is read.
 * Best-effort: a layout that cannot be measured leaves the scroll where it is.
 */
export function useScrollToTarget(
  scrollRef: RefObject<ScrollView | null>,
  targetRef: RefObject<View | null> | undefined,
  active: boolean
): void {
  useEffect(() => {
    if (!active || !targetRef) return;
    const id = setTimeout(() => {
      try {
        const scroll = scrollRef.current as
          | (ScrollView & { getInnerViewRef?: () => unknown })
          | null;
        const inner = scroll?.getInnerViewRef?.();
        const target = targetRef.current;
        if (!scroll || !inner || !target) return;
        target.measureLayout(
          inner as never,
          (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 16), animated: true }),
          () => {}
        );
      } catch {
        // staying where it is is the safe fallback
      }
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
