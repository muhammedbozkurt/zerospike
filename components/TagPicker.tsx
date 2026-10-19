import React from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";

import { LOG_TAGS } from "../lib/db/types";
import type { LogTag } from "../lib/db/types";
import { hapticSelect } from "../lib/haptics";
import { SPACE, THEME } from "../lib/theme/tokens";
import { CHIP_VISUAL_HEIGHT, RIPPLE_ALPHA, hitSlopFor } from "../lib/theme/uiPrimitives";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";

/**
 * Optional multi-select context tags (Exercise, Illness, Stress…). Shared by the
 * glucose / meal / injection logging screens. Descriptive context only.
 */
export function TagPicker({
  value,
  onChange,
  className = "",
}: {
  value: LogTag[];
  onChange: (tags: LogTag[]) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  const slop = hitSlopFor(CHIP_VISUAL_HEIGHT);

  const toggle = (tag: LogTag) => {
    hapticSelect();
    onChange(
      value.includes(tag) ? value.filter((x) => x !== tag) : [...value, tag]
    );
  };

  return (
    <View className={className}>
      <Txt kind="caption" tone="muted" style={{ fontWeight: "600", marginBottom: SPACE.sm }}>
        {t("tags.label")}
      </Txt>
      <View className="flex-row flex-wrap gap-2">
        {LOG_TAGS.map((tag) => {
          const active = value.includes(tag);
          return (
            <Pressable
              key={tag}
              onPress={() => toggle(tag)}
              hitSlop={{ top: slop, bottom: slop, left: 4, right: 4 }}
              android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
              // A chip's selected state was carried by its border and text colour
              // only, so a screen reader read every tag identically whether it was
              // on or off. `selected` is what actually announces it.
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              accessibilityLabel={t(`tags.${tag}`)}
              className={`rounded-full border px-3.5 items-center justify-center active:opacity-80 ${
                active
                  ? "border-brand bg-brand/10"
                  : "border-hair bg-glass"
              }`}
              style={{ minHeight: CHIP_VISUAL_HEIGHT }}
            >
              <Txt
                kind="caption"
                tone={active ? "accent" : "muted"}
                style={{ fontWeight: active ? "600" : "400", flexShrink: 1 }}
              >
                {t(`tags.${tag}`)}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
