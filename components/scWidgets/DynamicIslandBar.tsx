import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../../lib/theme/tokens";
import type { LiveData } from "../../lib/services/liveData";
import { formatCountdown } from "./common";

/**
 * The Dynamic Island's EXPANDED presentation from targets/widget/
 * PostMealActivity.swift: leading hourglass, the countdown's own title, the
 * trailing timer, and the thin progress line standing in for the bottom
 * region. A fixed-size black capsule directly under the real status bar,
 * unlabeled, because it is device chrome rather than another content section.
 *
 * iPhone only. There is no Dynamic Island on any iPad, so the iPad scene
 * declares `island: null` (layout.ts) and never renders this - last round it
 * floated one over the middle of the iPad's two columns, which is hardware
 * that device does not have.
 *
 * Plain "row": RN's own forceRTL already mirrors a physical row under RTL, so
 * this never needs `isRTL ? "row-reverse" : "row"` on top of it.
 */
export function DynamicIslandBar({
  data,
  now,
  fraction,
  width,
  height,
}: {
  data: LiveData | null;
  now: number;
  fraction: number;
  width: number;
  height: number;
}) {
  const remainingMs = data?.postMealEndsAt != null ? data.postMealEndsAt - now : null;
  const countdown = remainingMs != null && remainingMs > 0 ? formatCountdown(remainingMs) : null;
  const title = data?.labels?.timerTitle ?? "";

  return (
    <View style={{ height, alignItems: "center" }}>
      <View
        style={{
          width,
          height,
          borderRadius: height / 2,
          paddingHorizontal: 16,
          justifyContent: "center",
          backgroundColor: "#000000",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Ionicons name="hourglass-outline" size={13} color={THEME.accent} />
          <Text
            style={{ flex: 1, fontSize: 11, fontWeight: "600", color: THEME.ink }}
            numberOfLines={1}
          >
            {countdown ? title : (data?.labels?.lastReading ?? "")}
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: THEME.accent }} numberOfLines={1}>
            {countdown ?? (data?.lastGlucoseDisplay ?? "-")}
          </Text>
        </View>
        {countdown ? (
          <View
            style={{
              marginTop: 5,
              height: 3,
              borderRadius: 2,
              overflow: "hidden",
              backgroundColor: "rgba(255,255,255,0.16)",
            }}
          >
            <View
              style={{
                width: `${Math.round(fraction * 100)}%`,
                height: 3,
                borderRadius: 2,
                backgroundColor: THEME.accent,
              }}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
