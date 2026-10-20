import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { withAlpha } from "../rich/GlassCard";
import type { LiveData } from "../../lib/services/liveData";
import { formatCountdown, unitLabel } from "./common";
import { ISLAND_COMPACT, ISLAND_EXPANDED, ISLAND_MINIMAL, ISLAND_TONES } from "./islandSpec";

/**
 * The Dynamic Island as targets/widget/PostMealActivity.swift draws it, in two
 * states stacked under the real status bar (device chrome, so unlabeled):
 *
 *   compact   "timer" glyph left, countdown right, camera gap between; the
 *             minimal presentation (glyph only) sits beside it. No title and
 *             no bar.
 *   expanded  leading 30x30 badge, center title, trailing countdown, bottom
 *             reading pill with the elapsed-share progress bar UNDER it (the
 *             lock-screen card has no bar). All values live in islandSpec.ts, which
 *             scripts/scWidgetsIsland.test.ts checks against the Swift source.
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
  compactGap,
}: {
  data: LiveData | null;
  now: number;
  compactGap: number;
}) {
  const remainingMs = data?.postMealEndsAt != null ? data.postMealEndsAt - now : null;
  const live = remainingMs != null && remainingMs > 0;
  const countdown = formatCountdown(live ? remainingMs : 0);
  const tone = live ? ISLAND_TONES.accent : ISLAND_TONES.muted;
  const title = data?.labels?.timerTitle ?? "";
  const reading = data?.lastGlucoseDisplay;
  const startedAt = data?.postMealStartedAt;
  const endsAt = data?.postMealEndsAt;
  const elapsed =
    startedAt != null && endsAt != null && endsAt > startedAt
      ? Math.min(1, Math.max(0, (now - startedAt) / (endsAt - startedAt)))
      : 0;
  const c = ISLAND_COMPACT;
  const m = ISLAND_MINIMAL;
  const e = ISLAND_EXPANDED;

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

      <View style={{ height: compactGap }} />

      <View
        style={{
          height: e.h,
          borderRadius: 40,
          paddingHorizontal: e.padX,
          paddingTop: e.padTop,
          paddingBottom: e.padBottom,
          backgroundColor: ISLAND_TONES.black, // theme-ok: the Dynamic Island is always black
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: e.badge,
              height: e.badge,
              borderRadius: e.badgeCorner,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: withAlpha(ISLAND_TONES.accent, e.badgeAlpha),
            }}
          >
            <Ionicons name="timer-outline" size={e.badgeGlyph} color={ISLAND_TONES.accent} />
          </View>
          <Text
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: e.titleSize,
              fontWeight: e.titleWeight,
              color: ISLAND_TONES.muted,
            }}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            style={{
              minWidth: e.timeMinW,
              textAlign: "right",
              fontSize: e.timeSize,
              fontWeight: e.timeWeight,
              fontVariant: ["tabular-nums"],
              color: tone,
            }}
            numberOfLines={1}
          >
            {countdown}
          </Text>
        </View>
        {reading ? (
          <View style={{ flexDirection: "row", marginTop: e.rowToPill }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                gap: e.pillGap,
                paddingHorizontal: e.pillPadX,
                paddingVertical: e.pillPadY,
                borderRadius: 999,
                backgroundColor: withAlpha(ISLAND_TONES.ink, e.pillFillAlpha),
                borderWidth: 1,
                borderColor: withAlpha(ISLAND_TONES.ink, e.pillStrokeAlpha),
              }}
            >
              <Text
                style={{
                  fontSize: e.pillValueSize,
                  fontWeight: e.pillValueWeight,
                  fontVariant: ["tabular-nums"],
                  color: ISLAND_TONES.ink,
                }}
                numberOfLines={1}
              >
                {reading}
              </Text>
              <Text
                style={{ fontSize: e.pillUnitSize, fontWeight: e.pillUnitWeight, color: ISLAND_TONES.muted }}
                numberOfLines={1}
              >
                {unitLabel(data?.unit)}
              </Text>
            </View>
          </View>
        ) : null}
        <View
          style={{
            marginTop: reading ? e.barGap : e.rowToPill,
            height: e.barH,
            borderRadius: e.barH / 2,
            overflow: "hidden",
            backgroundColor: withAlpha(ISLAND_TONES.ink, e.barTrackAlpha),
          }}
        >
          <View
            style={{
              width: `${elapsed * 100}%`,
              height: e.barH,
              borderRadius: e.barH / 2,
              backgroundColor: ISLAND_TONES.accent,
            }}
          />
        </View>
      </View>
    </View>
  );
}
