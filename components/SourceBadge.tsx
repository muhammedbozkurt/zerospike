import React from "react";
import { Platform, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  SOURCE_LABEL_KEY,
  healthStoreLabelKey,
  sourceBadgeKind,
} from "../lib/cgm/sourceLabel";
import { RADIUS, SPACE, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";

export interface SourceBadgeProps {
  source: string | null | undefined;
  isCgm?: boolean | number | null;
  /** Appends the health store this device reads from ("CGM · Apple Health"). */
  withStore?: boolean;
}

/** A small pill naming where a reading came from. A generic kind only: CGM,
 *  Nightscout or Health, never a device or app brand. Manual readings get none. */
export function SourceBadge({ source, isCgm, withStore }: SourceBadgeProps) {
  const { t } = useTranslation();
  const kind = sourceBadgeKind(source, isCgm);
  if (!kind) return null;
  const kindLabel = t(SOURCE_LABEL_KEY[kind]);
  const label =
    withStore && kind !== "nightscout"
      ? t("cgmSource.badge", { kind: kindLabel, store: t(healthStoreLabelKey(Platform.OS)) })
      : kindLabel;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: SPACE.sm,
        paddingVertical: 2,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: withAlpha(THEME.accent, 0.35),
        backgroundColor: withAlpha(THEME.accent, 0.1),
      }}
    >
      <Txt kind="micro" tone="muted" numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}
