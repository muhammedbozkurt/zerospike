import React, { useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { InjectionSite, SitePoint } from "../lib/db/types";
import { SITE_POINTS, pointGrid } from "../lib/db/types";
import type { PointUsage, SiteUsage } from "../lib/db/injections";
import { GLUCOSE_RICH, HIT_TARGET, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { hapticSelect } from "../lib/haptics";

/**
 * Injection-site usage map, at ROTATION-POINT resolution.
 *
 * The model follows the quarter/rotation idea used in injection-technique
 * guidance (FITTER): a body region is not one spot, it is a small area you work
 * across. So each of the eight regions is split into four points, and the user
 * marks the point they actually used. The silhouette shows the region-level
 * picture; tapping a region opens its four points at full touch size (a 32-target
 * grid squeezed onto a 190pt silhouette could not be hit reliably, and the 44pt
 * minimum is not negotiable).
 *
 * Colour is a picture of the user's OWN history: how many times a point was used
 * in the window, weighted by how recently. Frequent and recent reads hot; long
 * untouched reads cool. The longest-unused point carries a dashed marker.
 *
 * Neutral by design. Nothing here says where to inject; it reports what was
 * logged. Every colour is paired with a count, so the map is readable without
 * relying on hue.
 */

interface Region {
  site: InjectionSite;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

// Coordinates in the 200 x 360 viewBox. Left/right are the viewer's left/right;
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

export interface PointSelection {
  site: InjectionSite;
  point: SitePoint;
}

/** Days after which a use no longer counts as "recent" for the heat weighting. */
const RECENCY_WINDOW_DAYS = 30;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The usage ramp: transparent (never used) -> cyan (occasional) -> warm orange
 * (frequent and recent). Two segments so a lightly used point is clearly
 * distinct from an untouched one without already reading as "hot".
 */
function heatFill(intensity: number): string {
  const i = Math.min(1, Math.max(0, intensity));
  if (i <= 0) return "rgba(255,255,255,0.05)";
  if (i < 0.5) {
    const t = i / 0.5;
    return `rgba(46,230,255,${lerp(0.14, 0.6, t).toFixed(2)})`;
  }
  const t = (i - 0.5) / 0.5;
  const r = Math.round(lerp(46, 255, t));
  const g = Math.round(lerp(230, 122, t));
  const b = Math.round(lerp(255, 60, t));
  return `rgba(${r},${g},${b},${lerp(0.6, 0.85, t).toFixed(2)})`;
}

/** How recently a point was used, 0 (never / long ago) to 1 (today). */
function recencyWeight(lastUsedAt: string | null, now: number): number {
  if (!lastUsedAt) return 0;
  const t = new Date(lastUsedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (now - t) / 86_400_000;
  if (days <= 0) return 1;
  if (days >= RECENCY_WINDOW_DAYS) return 0;
  return 1 - days / RECENCY_WINDOW_DAYS;
}

export function InjectionBodyMap({
  usage,
  selected,
  onSelect,
  windowDays = 30,
}: {
  usage: SiteUsage[];
  selected: PointSelection | null;
  onSelect: (selection: PointSelection) => void;
  windowDays?: number;
}) {
  const { t } = useTranslation();
  const [openRegion, setOpenRegion] = useState<InjectionSite | null>(null);

  const now = Date.now();

  const model = useMemo(() => {
    const bySite = new Map<InjectionSite, SiteUsage>();
    usage.forEach((u) => bySite.set(u.site, u));

    const allPoints: PointUsage[] = usage.flatMap((u) => u.points);
    const maxPointCount = Math.max(1, ...allPoints.map((p) => p.count));
    const maxSiteCount = Math.max(1, ...usage.map((u) => u.count));
    const total = usage.reduce((sum, u) => sum + u.count, 0);
    const unassigned = usage.reduce((sum, u) => sum + u.unassignedCount, 0);

    // The point untouched the longest: never-used wins, then oldest last use.
    let least: PointSelection | null = null;
    let leastScore = Infinity;
    for (const p of allPoints) {
      const score = p.lastUsedAt ? new Date(p.lastUsedAt).getTime() : -1;
      if (score < leastScore) {
        leastScore = score;
        least = { site: p.site, point: p.point };
      }
    }

    let hottest: Region = REGIONS[0];
    let hottestCount = -1;
    for (const r of REGIONS) {
      const c = bySite.get(r.site)?.count ?? 0;
      if (c > hottestCount) {
        hottestCount = c;
        hottest = r;
      }
    }

    return { bySite, maxPointCount, maxSiteCount, total, unassigned, least, hottest };
  }, [usage]);

  /** Combined frequency + recency intensity for one point. */
  function pointIntensity(p: PointUsage): number {
    if (p.count === 0) return 0;
    const freq = p.count / model.maxPointCount;
    const recent = recencyWeight(p.lastUsedAt, now);
    return Math.min(1, freq * 0.65 + recent * 0.35);
  }

  const openUsage = openRegion ? model.bySite.get(openRegion) : undefined;

  function choose(site: InjectionSite, point: SitePoint) {
    hapticSelect();
    onSelect({ site, point });
    setOpenRegion(null);
  }

  const selectedLabel = selected
    ? t("injection.siteWithPoint", {
        site: t(`injectionSite.${selected.site}`),
        n: selected.point,
      })
    : t("injection.tapRegion");

  return (
    <View
      className="rounded-2xl bg-glass border border-hair p-4"
      style={model.total > 0 ? glow(THEME.accent, 24, 0.3) : undefined}
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-ink font-semibold">{t("injection.pointMapTitle")}</Text>
        <Text className="text-mut text-xs">
          {t("injection.usageWindow", { n: windowDays })}
        </Text>
      </View>
      <Text className="text-mut text-[11px] leading-4 mb-1">
        {t("injection.pointMapSub")}
      </Text>

      <View className="items-center py-1">
        <Svg width={190} height={342} viewBox="0 0 200 360">
          <Defs>
            {/* Warm hot-spot radial under the busiest region (mockup B03). */}
            <RadialGradient id="hotspot">
              <Stop offset="0" stopColor={GLUCOSE_RICH.wellAbove} stopOpacity={0.55} />
              <Stop offset="1" stopColor={GLUCOSE_RICH.wellAbove} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {model.total > 0 ? (
            <Circle cx={model.hottest.cx} cy={model.hottest.cy} r={34} fill="url(#hotspot)" />
          ) : null}

          {/* Base silhouette (muted) */}
          <G>
            <Circle cx={100} cy={38} r={24} fill={THEME.glass} stroke={THEME.border} strokeWidth={1.5} />
            <Rect x={94} y={58} width={12} height={12} fill={THEME.glass} />
            <Rect x={64} y={64} width={72} height={130} rx={26} fill={THEME.glass} stroke={THEME.border} strokeWidth={1.5} />
            <Rect x={38} y={70} width={22} height={96} rx={11} fill={THEME.glass} stroke={THEME.border} strokeWidth={1.5} />
            <Rect x={140} y={70} width={22} height={96} rx={11} fill={THEME.glass} stroke={THEME.border} strokeWidth={1.5} />
            <Rect x={68} y={188} width={64} height={34} rx={16} fill={THEME.glass} stroke={THEME.border} strokeWidth={1.5} />
            <Rect x={70} y={214} width={26} height={124} rx={13} fill={THEME.glass} stroke={THEME.border} strokeWidth={1.5} />
            <Rect x={104} y={214} width={26} height={124} rx={13} fill={THEME.glass} stroke={THEME.border} strokeWidth={1.5} />
          </G>

          {/* Regions: shaded by their own total, each opening its four points */}
          {REGIONS.map((r) => {
            const u = model.bySite.get(r.site);
            const count = u?.count ?? 0;
            const isSelected = selected?.site === r.site;
            const holdsLeast = model.least?.site === r.site;
            return (
              <G key={r.site} onPress={() => setOpenRegion(r.site)}>
                <Ellipse
                  cx={r.cx}
                  cy={r.cy}
                  rx={r.rx}
                  ry={r.ry}
                  fill={heatFill(count / model.maxSiteCount)}
                  stroke={isSelected || holdsLeast ? THEME.accent : THEME.border}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={holdsLeast && !isSelected ? "3 3" : undefined}
                />
                {/* The four points as small dots inside the region, so the 2x2
                    structure is visible at a glance even before it is opened. */}
                {u
                  ? u.points.map((p) => {
                      const { row, col } = pointGrid(p.point);
                      const dx = (col === 0 ? -1 : 1) * r.rx * 0.42;
                      const dy = (row === 0 ? -1 : 1) * r.ry * 0.42;
                      const on =
                        selected?.site === r.site && selected.point === p.point;
                      return (
                        <Circle
                          key={p.point}
                          cx={r.cx + dx}
                          cy={r.cy + dy}
                          r={on ? 3.6 : 2.6}
                          fill={p.count > 0 ? heatFill(pointIntensity(p)) : "rgba(255,255,255,0.12)"}
                          stroke={on ? THEME.accent : "rgba(255,255,255,0.18)"}
                          strokeWidth={on ? 1.6 : 0.8}
                        />
                      );
                    })
                  : null}
                {count > 0 ? (
                  <SvgText
                    x={r.cx}
                    y={r.cy + 4}
                    fontSize={11}
                    fontWeight="bold"
                    fill={THEME.ink}
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

      <Text className="text-ink font-semibold text-center">{selectedLabel}</Text>

      <View className="flex-row items-center justify-center mt-2" style={{ gap: 14 }}>
        <View className="flex-row items-center">
          <View
            className="w-3 h-3 rounded-full mr-1.5"
            style={{ backgroundColor: heatFill(1) }}
          />
          <Text className="text-mut text-[11px]">{t("injection.mostUsedPoint")}</Text>
        </View>
        <View className="flex-row items-center">
          <View
            className="w-3 h-3 rounded-full mr-1.5"
            style={{ borderWidth: 1, borderStyle: "dashed", borderColor: THEME.accent }}
          />
          <Text className="text-mut text-[11px]">{t("injection.leastUsedPoint")}</Text>
        </View>
      </View>

      <Text className="text-mut text-[11px] text-center mt-2 leading-4">
        {t("injection.pointNeutral")}
      </Text>
      {model.unassigned > 0 ? (
        <Text className="text-mut text-[11px] text-center mt-1">
          {t("injection.noPointYet", { n: model.unassigned })}
        </Text>
      ) : null}
      {model.total === 0 ? (
        <Text className="text-mut text-[11px] text-center mt-2">
          {t("injection.empty")}
        </Text>
      ) : null}

      {/* Region zoom: the four points at full touch size */}
      <Modal
        visible={openRegion != null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenRegion(null)}
      >
        <Pressable
          style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.72)" }}
          onPress={() => setOpenRegion(null)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              {
                borderRadius: RADIUS["2xl"],
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.bg.g2,
                padding: 18,
              },
              glow(THEME.accent, 30, 0.35),
            ]}
          >
            <Text style={{ color: THEME.ink, fontSize: 16, fontWeight: "800", textAlign: "center" }}>
              {openRegion ? t(`injectionSite.${openRegion}`) : ""}
            </Text>
            <Text style={{ color: THEME.muted, fontSize: 11, textAlign: "center", marginTop: 4 }}>
              {t("injection.selectPoint")}
            </Text>

            <View className="flex-row flex-wrap justify-between mt-4">
              {SITE_POINTS.map((point) => {
                const p = openUsage?.points.find((x) => x.point === point);
                const on =
                  selected?.site === openRegion && selected.point === point;
                const isLeast =
                  model.least?.site === openRegion && model.least.point === point;
                const intensity = p ? pointIntensity(p) : 0;
                return (
                  <Pressable
                    key={point}
                    onPress={() => openRegion && choose(openRegion, point)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={t("injection.siteWithPoint", {
                      site: openRegion ? t(`injectionSite.${openRegion}`) : "",
                      n: point,
                    })}
                    style={{
                      width: "48%",
                      minHeight: HIT_TARGET * 1.6,
                      marginBottom: 10,
                      borderRadius: RADIUS.lg,
                      borderWidth: on ? 2 : 1,
                      borderColor: on || isLeast ? THEME.accent : THEME.border,
                      borderStyle: isLeast && !on ? "dashed" : "solid",
                      backgroundColor: heatFill(intensity),
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 10,
                    }}
                  >
                    <Text style={{ color: THEME.ink, fontWeight: "800", fontSize: 13 }}>
                      {t("injection.pointLabel", { n: point })}
                    </Text>
                    <Text style={{ color: THEME.muted, fontSize: 10, marginTop: 2 }}>
                      {t(`injection.point_${point}`)}
                    </Text>
                    <Text style={{ color: THEME.ink, fontSize: 11, marginTop: 4, opacity: 0.8 }}>
                      {p?.count ?? 0}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ color: THEME.muted, fontSize: 11, textAlign: "center", lineHeight: 16 }}>
              {t("injection.pointNeutral")}
            </Text>

            <Pressable
              onPress={() => setOpenRegion(null)}
              style={{
                marginTop: 12,
                borderRadius: RADIUS.lg,
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: withAlpha("#ffffff", 0.04),
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: THEME.muted, fontWeight: "700", textAlign: "center" }}>
                {t("common.close")}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
