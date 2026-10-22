import type { AccessibilityRole } from "react-native";

/**
 * Pure accessibility prop builders. The role word ("switch", "button") is read
 * by the screen reader itself, so labels carry only the visible title.
 */

export interface SliderRange {
  min: number;
  max: number;
  now: number;
  /** Spoken value with its unit, e.g. "1.5 servings"; defaults to `now`. */
  text?: string;
}

function clean(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  return trimmed ? trimmed : undefined;
}

/** A Switch has no children to read, so it needs the same title as its row. */
export function switchProps(label: string) {
  const accessibilityLabel = clean(label);
  return accessibilityLabel
    ? { accessibilityRole: "switch" as const, accessibilityLabel }
    : { accessibilityRole: "switch" as const };
}

/** Role (and, only when the Pressable has no readable text child, a label). */
export function pressableProps(label?: string, role: AccessibilityRole = "button") {
  const accessibilityLabel = clean(label);
  return accessibilityLabel
    ? { accessibilityRole: role, accessibilityLabel }
    : { accessibilityRole: role };
}

export function sliderProps(label: string, range: SliderRange) {
  const min = Math.min(range.min, range.max);
  const max = Math.max(range.min, range.max);
  const now = Math.min(max, Math.max(min, range.now));
  return {
    accessibilityLabel: clean(label),
    accessibilityValue: { min, max, now, text: clean(range.text) ?? String(now) },
  };
}

/** Marks a decorative glyph so the screen reader skips it. */
export const HIDDEN_FROM_A11Y = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants" as const,
};
