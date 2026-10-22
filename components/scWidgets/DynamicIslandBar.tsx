import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { LiveData } from "../../lib/services/liveData";
import { formatCountdown } from "./common";
import { SectionHeading } from "./SectionHeading";
import { ISLAND_COMPACT, ISLAND_MINIMAL, ISLAND_TONES } from "./islandSpec";

/**
 * The Dynamic Island as targets/widget/PostMealActivity.swift draws it while
 * idle: the compact pill ("timer" glyph left, countdown right, camera gap
 * between) with the minimal circle (glyph only) beside it, and a small caption
 * under them. The expanded card is NOT drawn: it only opens on a long press,
 * so a store frame showing it as the resting state would misstate the product.
 * All values live in islandSpec.ts (ISLAND_EXPANDED stays there because
 * scripts/scWidgetsIsland.test.ts still pins it to the Swift source).
 *
 * The SF Symbol "timer" has no hourglass in it; Ionicons "timer-outline" is its
 * closest twin. SF Rounded is not available to RN, so digits use tabular-nums.
 *
 * iPhone only. There is no Dynamic Island on any iPad, so the iPad scene
 * declares `island: null` (layout.ts) and never renders this.
 *
 * Plain "row": RN's own forceRTL already mirrors a physical row under RTL.
 */
export function DynamicIslandBar({
  data,
  now,
  captionGap,
  caption,
  captionSize,
  captionH,
}: {
  data: LiveData | null;
  now: number;
  captionGap: number;
  caption: string;
  captionSize: number;
  captionH: number;
}) {
  const remainingMs = data?.postMealEndsAt != null ? data.postMealEndsAt - now : null;
  const live = remainingMs != null && remainingMs > 0;
  const countdown = formatCountdown(live ? remainingMs : 0);
  const tone = live ? ISLAND_TONES.accent : ISLAND_TONES.muted;
  const c = ISLAND_COMPACT;
  const m = ISLAND_MINIMAL;

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: c.w,
            height: c.h,
            borderRadius: c.h / 2,
            paddingHorizontal: c.padX,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: ISLAND_TONES.black, // theme-ok: the Dynamic Island is always black
          }}
        >
          <Ionicons name="timer-outline" size={c.iconSize} color={tone} />
          <Text
            style={{
              maxWidth: c.timeMaxW,
              fontSize: c.timeSize,
              fontWeight: c.timeWeight,
              fontVariant: ["tabular-nums"],
              color: tone,
            }}
            numberOfLines={1}
          >
            {countdown}
          </Text>
        </View>
        <View
          style={{
            width: m.size,
            height: m.size,
            borderRadius: m.size / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: ISLAND_TONES.black, // theme-ok: the Dynamic Island is always black
          }}
        >
          <Ionicons name="timer-outline" size={m.iconSize} color={tone} />
        </View>
      </View>

      <View style={{ height: captionGap }} />
      <SectionHeading size={captionSize} height={captionH} center>
        {caption}
      </SectionHeading>
    </View>
  );
}
