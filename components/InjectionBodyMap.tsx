import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Circle, Ellipse, G, Rect, Text as SvgText } from "react-native-svg";

import type { InjectionSite } from "../lib/db/types";
import type { SiteUsage } from "../lib/db/injections";
import { COLORS } from "../lib/theme/tokens";
import { hapticSelect } from "../lib/haptics";

/**
 * Injection-site heat map: a stylized front body silhouette with the eight
 * logging sites. Each region is shaded by how often it was used in the window
 * (faint = rarely, saturated = often), and the least-used region carries a
 * neutral dashed marker. Tapping a region selects it for the log form.
 *
 * Neutral by design: this visualizes the user's own usage ("last 30 days",
 * "least used"). It is not a dosing or placement recommendation.
 */

interface Region {
  site: InjectionSite;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

// Coordinates in the 200 × 360 viewBox. Left/right are the viewer's left/right;
// the text label resolves the anatomical side, so there is no ambiguity.
const REGIONS: Region[] = [
  { site: "arm_left", cx: 49, cy: 118, rx: 11, ry: 22 },
  { site: "arm_right", cx: 151, cy: 118, rx: 11, ry: 22 },
  { site: "abdomen_left", cx: 86, cy: 168, rx: 15, ry: 20 },
  { site: "abdomen_right", cx: 114, cy: 168, rx: 15, ry: 20 },
  { site: "buttock_left", cx: 85, cy: 205, rx: 14, ry: 13 },
  { site: "buttock_right", cx: 115, cy: 205, rx: 14, ry: 13 },
  { site: "thigh_left", cx: 85, cy: 258, rx: 14, ry: 30 },
  { site: "thigh_right", cx: 115, cy: 258, rx: 14, ry: 30 },
];

/** Brand cyan at an intensity-scaled opacity (usage heat, not a glucose color). */
function heatFill(intensity: number): string {
  const a = 0.1 + Math.min(1, Math.max(0, intensity)) * 0.72;
  return `rgba(34,211,238,${a.toFixed(2)})`;
}

export function InjectionBodyMap({
  usage,
  selected,
  onSelect,
  windowDays = 30,
}: {
  usage: SiteUsage[];
  selected: InjectionSite | null;
  onSelect: (site: InjectionSite) => void;
  windowDays?: number;
}) {
  const { t } = useTranslation();

  const { countBySite, maxCount, leastUsed, total } = useMemo(() => {
    const map = new Map<InjectionSite, number>();
    usage.forEach((u) => map.set(u.site, u.count));
    const counts = REGIONS.map((r) => map.get(r.site) ?? 0);
    const max = Math.max(1, ...counts);
    const sum = counts.reduce((a, b) => a + b, 0);
    // Least-used = the lowest count, earliest in canonical order on a tie.
    let least: InjectionSite = REGIONS[0].site;
    let leastN = Infinity;
    for (const r of REGIONS) {
      const c = map.get(r.site) ?? 0;
      if (c < leastN) {
        leastN = c;
        least = r.site;
      }
    }
    return { countBySite: map, maxCount: max, leastUsed: least, total: sum };
  }, [usage]);

  const bodyFill = COLORS.surfaceAlt;
  const bodyStroke = COLORS.border;

  function handlePress(site: InjectionSite) {
    hapticSelect();
    onSelect(site);
  }

  return (
    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-zinc-300 font-semibold">{t("injection.bodyMapTitle")}</Text>
        <Text className="text-zinc-500 text-xs">
          {t("injection.usageWindow", { n: windowDays })}
        </Text>
      </View>

      <View className="items-center py-1">
        <Svg width={190} height={342} viewBox="0 0 200 360">
          {/* Base silhouette (muted) */}
          <G>
            <Circle cx={100} cy={38} r={24} fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
            <Rect x={94} y={58} width={12} height={12} fill={bodyFill} />
            {/* torso */}
            <Rect x={64} y={64} width={72} height={130} rx={26} fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
            {/* arms */}
            <Rect x={38} y={70} width={22} height={96} rx={11} fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
            <Rect x={140} y={70} width={22} height={96} rx={11} fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
            {/* hips */}
            <Rect x={68} y={188} width={64} height={34} rx={16} fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
            {/* legs */}
            <Rect x={70} y={214} width={26} height={124} rx={13} fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
            <Rect x={104} y={214} width={26} height={124} rx={13} fill={bodyFill} stroke={bodyStroke} strokeWidth={1.5} />
          </G>

          {/* Heat regions */}
          {REGIONS.map((r) => {
            const count = countBySite.get(r.site) ?? 0;
            const isSelected = selected === r.site;
            const isLeast = leastUsed === r.site;
            return (
              <G key={r.site} onPress={() => handlePress(r.site)}>
                <Ellipse
                  cx={r.cx}
                  cy={r.cy}
                  rx={r.rx}
                  ry={r.ry}
                  fill={heatFill(count / maxCount)}
                  stroke={isSelected ? COLORS.brand : isLeast ? COLORS.brand : bodyStroke}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={isLeast && !isSelected ? "3 3" : undefined}
                />
                {count > 0 ? (
                  <SvgText
                    x={r.cx}
                    y={r.cy + 4}
                    fontSize={12}
                    fontWeight="bold"
                    fill={COLORS.textPrimary}
                    textAnchor="middle"
                  >
                    {String(count)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
      </View>

      {/* Selected site + least-used legend (neutral language) */}
      <View className="mt-1">
        <Text className="text-zinc-100 font-semibold text-center">
          {selected ? t(`injectionSite.${selected}`) : t("injection.tapRegion")}
        </Text>
        <View className="flex-row items-center justify-center mt-2 gap-4">
          <View className="flex-row items-center">
            <View className="w-3 h-3 rounded-full mr-1.5" style={{ backgroundColor: heatFill(1) }} />
            <Text className="text-zinc-500 text-[11px]">{t("injection.mostUsed")}</Text>
          </View>
          <View className="flex-row items-center">
            <View
              className="w-3 h-3 rounded-full mr-1.5 border border-dashed"
              style={{ borderColor: COLORS.brand }}
            />
            <Text className="text-zinc-500 text-[11px]">{t("injection.leastUsed")}</Text>
          </View>
        </View>
        {total === 0 ? (
          <Text className="text-zinc-600 text-[11px] text-center mt-2">
            {t("injection.empty")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
