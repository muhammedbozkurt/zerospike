import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../../lib/theme/tokens";
import { WIDGET_DARK, WIDGET_LIGHT } from "../../lib/services/widgetColors";
import type { LiveData } from "../../lib/services/liveData";
import { withAlpha } from "../rich/GlassCard";
import { activityAccent, formatCountdown, unitLabel } from "./common";
import { LIVE_CARD } from "./islandSpec";

/**
 * Replica of the lock-screen HStack in targets/widget/PostMealActivity.swift:
 * the timer badge, the activity's own title over its countdown, and the last
 * reading as a trailing pill, on WidgetBackground. No progress bar: the Swift
 * card has none. One fixed-height card the width of its column; the Dynamic
 * Island half of that same Swift file is DynamicIslandBar.tsx.
 *
 * Sizes are LIVE_CARD (islandSpec.ts, the Swift values at scale 1) times
 * height / LIVE_CARD.naturalH, so the iPad column can run it larger.
 *
 * The title is `labels.timerTitle` verbatim - the same string
 * `context.attributes.title` prints - and carries NO meal name: PostMealAttributes
 * has no such field (startPostMealActivity in lib/services/notifications.ts),
 * so a scene that invented one would be showing a widget that does not exist.
 *
 * Plain "row" everywhere: RN's own forceRTL already mirrors a physical row.
 */
export function LiveActivityScene({
  data,
  now,
  height,
  maxScale = 1.4,
}: {
  data: LiveData | null;
  now: number;
  height: number;
  maxScale?: number;
}) {
  const remainingMs = data?.postMealEndsAt != null ? data.postMealEndsAt - now : null;
  const countdown = remainingMs != null && remainingMs > 0 ? formatCountdown(remainingMs) : null;
  const title = data?.labels?.timerTitle ?? "";
  const reading = data?.lastGlucoseDisplay;
  const accent = activityAccent();
  const pal = THEME.scheme === "dark" ? WIDGET_DARK : WIDGET_LIGHT;
  const k = LIVE_CARD;
  const s = Math.min(height / k.naturalH, maxScale);
  const px = (n: number) => Math.round(n * s);

  return (
    <View
      style={{
        height,
        flexDirection: "row",
        alignItems: "center",
        gap: px(k.gap),
        borderRadius: px(22),
        paddingHorizontal: px(k.padX),
        backgroundColor: pal.bgTo,
        // The Swift card has no edge because iOS draws it over a wallpaper; here the page
        // is the same #F5EFE6, so a hairline keeps the card readable as a card.
        borderWidth: 1,
        borderColor: withAlpha(pal.ink, 0.1),
      }}
    >
      <View
        style={{
          width: px(k.badge),
          height: px(k.badge),
          borderRadius: px(k.badgeCorner),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(accent, k.badgeAlpha),
        }}
      >
        <Ionicons name={countdown ? "timer-outline" : "water"} size={px(k.badgeGlyph)} color={accent} />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: px(k.titleSize), fontWeight: k.titleWeight, color: pal.muted }}
          numberOfLines={1}
          // iOS-only scene (Android renders AndroidScene): the longest titles (de, it) need to
          // shrink a little at this scale instead of ending in an ellipsis.
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {countdown ? title : "zerospike"}
        </Text>
        <Text
          style={{
            maxWidth: px(k.timeMaxW),
            fontSize: px(k.timeSize),
            fontWeight: k.timeWeight,
            fontVariant: ["tabular-nums"],
            color: accent,
          }}
          numberOfLines={1}
        >
          {countdown ?? (data?.avgGlucoseDisplay ?? data?.lastGlucoseDisplay ?? "-")}
        </Text>
      </View>

      {reading ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            gap: px(4),
            paddingHorizontal: px(9),
            paddingVertical: px(5),
            borderRadius: 999,
            backgroundColor: withAlpha(pal.ink, 0.06),
            borderWidth: 1,
            borderColor: withAlpha(pal.ink, 0.1),
          }}
        >
          <Text style={{ fontSize: px(14), fontWeight: "700", fontVariant: ["tabular-nums"], color: pal.ink }}>
            {reading}
          </Text>
          <Text style={{ fontSize: px(10), fontWeight: "500", color: pal.muted }}>{unitLabel(data?.unit)}</Text>
        </View>
      ) : null}
    </View>
  );
}
