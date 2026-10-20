import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../../lib/theme/tokens";
import type { LiveData } from "../../lib/services/liveData";
import { withAlpha } from "../rich/GlassCard";
import { activityAccent, formatCountdown, inkA, unitLabel } from "./common";

/**
 * Replica of the lock-screen HStack in targets/widget/PostMealActivity.swift:
 * the timer badge, the activity's own title over its countdown with the
 * elapsed bar under it, and the last reading as a trailing pill. One fixed-
 * height card the width of its column; the Dynamic Island half of that same
 * Swift file is its own capsule under the status bar (DynamicIslandBar.tsx),
 * because the island reads as device chrome rather than a labeled section.
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
  fraction,
}: {
  data: LiveData | null;
  now: number;
  height: number;
  fraction: number;
}) {
  const remainingMs = data?.postMealEndsAt != null ? data.postMealEndsAt - now : null;
  const countdown = remainingMs != null && remainingMs > 0 ? formatCountdown(remainingMs) : null;
  const title = data?.labels?.timerTitle ?? "";
  const reading = data?.lastGlucoseDisplay;
  const accent = activityAccent();

  // At least 14: the card's own breathing room is a fixed floor now, not a
  // pure ratio, because the iPhone card is only 68 pt tall.
  const pad = Math.max(14, Math.round(height * 0.18));
  const badge = Math.round(height * 0.44);
  const titleSize = Math.round(height * 0.125);
  const valueSize = Math.round(height * 0.27);

  return (
    <View
      style={{
        height,
        flexDirection: "row",
        alignItems: "center",
        gap: pad,
        borderRadius: Math.round(height * 0.22),
        paddingHorizontal: pad,
        backgroundColor: THEME.scheme === "light" ? THEME.surface : THEME.bg.g1,
        borderWidth: 1,
        borderColor: THEME.scheme === "light" ? THEME.border : inkA(0.06),
      }}
    >
      <View
        style={{
          width: badge,
          height: badge,
          borderRadius: Math.round(badge * 0.32),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(accent, 0.18),
        }}
      >
        <Ionicons name={countdown ? "hourglass-outline" : "water"} size={Math.round(badge * 0.46)} color={accent} />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: titleSize, lineHeight: Math.round(titleSize * 1.25), fontWeight: "700", color: THEME.muted }}
          numberOfLines={1}
        >
          {countdown ? title : "zerospike"}
        </Text>
        <Text
          style={{ fontSize: valueSize, lineHeight: Math.round(valueSize * 1.2), fontWeight: "700", color: accent }}
          numberOfLines={1}
        >
          {countdown ?? (data?.avgGlucoseDisplay ?? data?.lastGlucoseDisplay ?? "-")}
        </Text>
        {countdown ? (
          <View
            style={{
              marginTop: Math.round(height * 0.06),
              height: 4,
              borderRadius: 2,
              overflow: "hidden",
              backgroundColor: inkA(0.12),
            }}
          >
            <View
              style={{ width: `${Math.round(fraction * 100)}%`, height: 4, borderRadius: 2, backgroundColor: accent }}
            />
          </View>
        ) : null}
      </View>

      {reading ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 4,
            paddingHorizontal: Math.round(height * 0.1),
            paddingVertical: Math.round(height * 0.06),
            borderRadius: 999,
            backgroundColor: inkA(0.06),
            borderWidth: 1,
            borderColor: inkA(0.1),
          }}
        >
          <Text style={{ fontSize: Math.round(height * 0.17), fontWeight: "700", color: THEME.ink }}>{reading}</Text>
          <Text style={{ fontSize: Math.round(height * 0.115), color: THEME.muted, marginBottom: 1 }}>
            {unitLabel(data?.unit)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
