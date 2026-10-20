import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I18nManager, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";

import type { InjectionSite, SitePoint } from "../lib/db/types";
import type { PointUsage, SiteUsage } from "../lib/db/injections";
import { HEAT_TIER_LABELS, heatTierForCount } from "../lib/injectionHeat";
import { PALETTES, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { formatDate } from "../lib/format";
import { hapticSelect } from "../lib/haptics";
import { isScreenshotMode } from "../lib/screenshotMode";
import {
  ARM_PATHS,
  FADE_FROM,
  FADE_TO,
  FULL_VIEW,
  GEOMETRY,
  NAVEL,
  REGIONS,
  SPINE_PATH,
  TORSO_PATH,
  VB_W,
  type Surface,
} from "./injectionMap/silhouette";
import { tierStroke, type Tier } from "./injectionMap/tiers";
import { BreathCircle, RegionShape, tierFill } from "./injectionMap/RegionShape";
import { inkFor, mixHex } from "./injectionMap/paint";
import {
  BADGE_H,
  BADGE_INNER_X,
  BADGE_MAX_W,
  BADGE_TOP_Y,
  dotFonts,
  dotMetrics,
  mapHeight,
  mapWidth,
} from "./injectionMap/layout";
import { SurfaceTabs } from "./injectionMap/SurfaceTabs";

/**
 * Injection-site usage map (schema v9), at ROTATION-POINT resolution.
 *
 * One silhouette with a Front | Back switch; the eight selectable regions sit
 * on the face they belong to. A region's plate is one of five tiers (never
 * used, then four used steps) driven by the region's or point's OWN COUNT on
 * the absolute scale in lib/injectionHeat (0, 1, 2, 3, 4+). Counts are hidden on the overview and shown on
 * the selected region and in the zoom. Tapping a region zooms onto it and
 * reveals its four rotation points at full touch size.
 *
 * Colour is a picture of the user's OWN history: nothing says where to inject.
 * The least-recently-used region carries the one emphasised outline.
 */

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
 * distinct from an untouched one without already reading as "hot". Used by the
 * region sheet, whose dots sit on the DARK card surface.
 */
export function heatFill(intensity: number): string {
  const i = Math.min(1, Math.max(0, intensity));
  if (i <= 0) return THEME.surfaceInset;
  if (i < 0.5) {
    const t = i / 0.5;
    return withAlpha(THEME.accentFill, Number(lerp(0.14, 0.6, t).toFixed(2)));
  }
  const t = (i - 0.5) / 0.5;
  const hot = mixHex(THEME.accentFill, THEME.glucose.veryHigh, t);
  return withAlpha(hot, Number(lerp(0.6, 0.85, t).toFixed(2)));
}

export const INK_DARK = PALETTES.dark.accentOnFill;
export const BODY_TOP = mixHex(PALETTES.dark.text, PALETTES.dark.textMuted, 0.05);
export const BODY_BOTTOM = mixHex(PALETTES.dark.text, PALETTES.dark.textMuted, 0.4);
const BODY_TOP_WARM = "#F1EBDF"; // theme-ok
const BODY_BOTTOM_WARM = "#DDD4C4"; // theme-ok

/** Silhouette gradient stops for InjectionSiteBoard: light theme draws a warm
 *  neutral figure, dark keeps the pale slate figure. */
export function bodyStops(): { top: string; bottom: string } {
  return THEME.scheme === "light"
    ? { top: BODY_TOP_WARM, bottom: BODY_BOTTOM_WARM }
    : { top: BODY_TOP, bottom: BODY_BOTTOM };
}

/** How recently a point was used, 0 (never / long ago) to 1 (today). */
export function recencyWeight(lastUsedAt: string | null, now: number): number {
  if (!lastUsedAt) return 0;
  const t = new Date(lastUsedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (now - t) / 86_400_000;
  if (days <= 0) return 1;
  if (days >= RECENCY_WINDOW_DAYS) return 0;
  return 1 - days / RECENCY_WINDOW_DAYS;
}

/** Whole days since a timestamp (for the accessibility recency phrase). */
export function daysSince(lastUsedAt: string | null, now: number): number | null {
  if (!lastUsedAt) return null;
  const t = new Date(lastUsedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Neutral, educational absorption-speed note per region type (info, NOT advice;
 *  no insulin type is ever tied to a site). */
export function absorptionKey(site: InjectionSite): string {
  if (site.startsWith("abdomen")) return "injection.absorbFast";
  if (site.startsWith("arm")) return "injection.absorbMedFast";
  if (site.startsWith("thigh")) return "injection.absorbMedSlow";
  return "injection.absorbSlow"; // buttock / hip
}

/** Fade-out then fade-in around the instant viewBox swap (ms). */
const FADE_OUT = 110;
const FADE_IN = 170;

/** Half of the 3.2 s breathing loop (ms) and its opacity floor. */
const BREATH_HALF = 1600;
const BREATH_MIN = 0.55;

/** Offset of the selection ring around a zoomed point, and its inner twin used
 *  when the point is also the next-up one. */
const POINT_RING_OUTER = 3.5;
const POINT_RING_INNER = 1.3;

export function InjectionBodyMap({
  usage,
  noSiteCount = 0,
  selected,
  onSelect,
  windowDays = 30,
  initialZoom,
  cycleStart,
  onStartNewCycle,
  showRotationHint = false,
}: {
  usage: SiteUsage[];
  /** Injections with NO region recorded at all (e.g. a calculator mealtime
   *  bolus, RotationUsage.noSiteCount from lib/db/injections). These never
   *  show on the silhouette itself - surfaced as a count below it instead, so
   *  a profile that only ever uses the calculator does not read as having no
   *  history at all. */
  noSiteCount?: number;
  selected: PointSelection | null;
  onSelect: (selection: PointSelection) => void;
  windowDays?: number;
  /** Store-screenshot only: open this region's zoom on mount. */
  initialZoom?: string;
  /** Profile's rotation-cycle stamp (lib/rotationCycle), if one was started. */
  cycleStart?: string | null;
  /** Opens the parent's confirm dialog and stamps a new cycle. */
  onStartNewCycle?: () => void;
  /** Rotation ("least-recently-used") is a Pro feature - callers pass their
   *  own isProUser here. Defaults to false so a caller that forgets this prop
   *  fails closed (no outline, no legend chip, no accessibility suffix). */
  showRotationHint?: boolean;
}) {
  const { t } = useTranslation();
  // RTL EXEMPTION: this card is an anatomical body diagram. Left/right badges
  // and the zoom header below are pinned to the SVG's fixed (never-mirrored)
  // artwork, so every physical left/right style here is swapped back by hand
  // to render byte-identical to LTR instead of following RN's automatic
  // swapLeftAndRightInRTL flip.
  const rtl = I18nManager.isRTL;
  const { width: winW, height: winH } = useWindowDimensions();
  const svgW = mapWidth(winW, winH);
  const svgH = mapHeight(svgW);

  const badges = useMemo(() => {
    const scale = svgW / VB_W;
    const base = {
      position: "absolute" as const,
      top: BADGE_TOP_Y * scale,
      height: BADGE_H,
      maxWidth: BADGE_MAX_W,
      minWidth: 28,
      paddingHorizontal: 4,
      borderRadius: BADGE_H / 2,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 1,
      borderColor: THEME.border,
      backgroundColor: THEME.surfaceInset,
    };
    // OBSERVER VIEW: sideLeft names the user's own left side, drawn on the
    // RIGHT of the picture (see the SIDE CONVENTION note in silhouette.ts).
    // The opposite physical key cancels RN's automatic RTL flip.
    return [
      {
        key: "sideLeft" as const,
        style: { ...base, [rtl ? "right" : "left"]: (VB_W - BADGE_INNER_X) * scale },
      },
      {
        key: "sideRight" as const,
        style: { ...base, [rtl ? "left" : "right"]: svgW - BADGE_INNER_X * scale },
      },
    ];
  }, [svgW, rtl]);

  const [openSite, setOpenSite] = useState<InjectionSite | null>(null);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const now = Date.now();

  const model = useMemo(() => {
    const bySite = new Map<InjectionSite, SiteUsage>();
    usage.forEach((u) => bySite.set(u.site, u));

    const regionSites = new Set(REGIONS.map((r) => r.site));
    const selectableUsage = usage.filter((u) => regionSites.has(u.site));
    const allPoints: PointUsage[] = selectableUsage.flatMap((u) => u.points);
    const total = selectableUsage.reduce((sum, u) => sum + u.count, 0);
    const unassigned = usage.reduce((sum, u) => sum + u.unassignedCount, 0);

    // Data logged against the retired abdomen quadrants is not on the map; surface
    // it as an aggregate note so no history is ever hidden.
    const legacyAbdomen =
      (bySite.get("abdomen_left_upper")?.count ?? 0) +
      (bySite.get("abdomen_right_upper")?.count ?? 0) +
      (bySite.get("abdomen_left_lower")?.count ?? 0) +
      (bySite.get("abdomen_right_lower")?.count ?? 0);

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

    return { bySite, total, unassigned, legacyAbdomen, least };
  }, [usage]);

  const nextSurface: Surface | null =
    showRotationHint && model.least ? GEOMETRY.get(model.least.site)?.region.surface ?? null : null;

  // The tab starts on the face that holds the next-up region and never moves
  // on its own after that: the person stays in control of what they look at.
  const [tab, setTab] = useState<Surface>(
    () =>
      GEOMETRY.get(initialZoom as InjectionSite)?.region.surface ??
      nextSurface ??
      (selected ? GEOMETRY.get(selected.site)?.region.surface : undefined) ??
      "front"
  );
  const tabLocked = useRef(Boolean(initialZoom));
  useEffect(() => {
    if (tabLocked.current || !nextSurface) return;
    tabLocked.current = true;
    setTab(nextSurface);
  }, [nextSurface]);

  const reduced = useReducedMotion();
  const breath = useSharedValue(1);
  const hasNext = nextSurface != null;
  useEffect(() => {
    cancelAnimation(breath);
    breath.value = 1;
    if (reduced || !hasNext) return;
    breath.value = withRepeat(
      withSequence(
        withTiming(BREATH_MIN, { duration: BREATH_HALF }),
        withTiming(1, { duration: BREATH_HALF })
      ),
      -1,
      false
    );
    return () => cancelAnimation(breath);
  }, [reduced, hasNext, breath]);

  const applyZoom = useCallback(
    (site: InjectionSite | null) => {
      setOpenSite(site);
      fade.value = withTiming(1, { duration: FADE_IN });
    },
    [fade]
  );

  // The zoom is an instant viewBox swap wrapped in an opacity dip: the SVG is
  // re-rasterised sharp at the new scale, and no frame is driven by setState.
  const goTo = useCallback(
    (site: InjectionSite | null) => {
      hapticSelect();
      fade.value = withTiming(0, { duration: FADE_OUT }, (finished) => {
        if (finished) runOnJS(applyZoom)(site);
      });
    },
    [applyZoom, fade]
  );

  useEffect(() => {
    if (!initialZoom) return;
    const geo = GEOMETRY.get(initialZoom as InjectionSite);
    if (!geo) return;
    setTab(geo.region.surface);
    setOpenSite(initialZoom as InjectionSite);
  }, [initialZoom]);

  const open = openSite ? GEOMETRY.get(openSite) ?? null : null;
  const [vx, vy, vw, vh] = open ? open.zoom : FULL_VIEW;
  // One screen point expressed in viewBox units, so strokes, dots and labels keep
  // the same physical size at every zoom level.
  const upx = vw / svgW;
  const shown: Surface = open ? open.region.surface : tab;

  const openUsage = openSite ? model.bySite.get(openSite) : undefined;
  const openCount = openUsage?.count ?? 0;

  function recencyPhrase(lastUsedAt: string | null): string {
    const d = daysSince(lastUsedAt, now);
    if (d == null) return t("injection.usedNever");
    if (d === 0) return t("injection.usedToday");
    return t("injection.daysAgo", { n: d });
  }

  function choose(site: InjectionSite, point: SitePoint) {
    hapticSelect();
    setOpenSite(null);
    fade.value = 1;
    onSelect({ site, point });
  }

  function pickTab(next: Surface) {
    tabLocked.current = true;
    if (next !== tab) hapticSelect();
    setTab(next);
  }

  const selectedLabel = selected
    ? t("injection.siteWithPoint", {
        site: t(`injectionSite.${selected.site}`),
        n: selected.point,
      })
    : t("injection.tapRegion");

  const bodyFill = mixHex(THEME.surfaceRaised, THEME.text, 0.05);
  const plateFill = mixHex(THEME.surfaceRaised, THEME.text, 0.02);
  // The dot shrinks below 23 pt on a narrow screen so the zoom keeps 8 pt clear
  // between dots and to the plate edge; its digits scale with it.
  const dot = open ? dotMetrics(open, svgW) : null;
  const pointRadius = (dot?.r ?? 0) * upx;
  const pointFont = dotFonts(dot?.r ?? 0).point * upx;
  const countFont = dotFonts(dot?.r ?? 0).count * upx;
  const dotNudge = (dot?.r ?? 0) * (1.5 / 23) * upx;

  return (
    <View
      className="rounded-2xl bg-glass border border-hair p-4"
      style={[
        { minHeight: Math.round(winH * 0.5) },
        model.total > 0 ? glow(THEME.accent, 24, 0.3) : null,
      ]}
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-ink font-semibold">{t("injection.pointMapTitle")}</Text>
        <Text className="text-mut text-xs">
          {t("injection.usageWindow", { n: windowDays })}
        </Text>
      </View>
      <Text className="text-mut text-xs leading-4">{t("injectionMap.sub")}</Text>

      {/* Fixed-height bar: the hint and the zoom header swap without moving the SVG.
          RTL EXEMPTION: flexDirection is pre-reversed and the chevron stays a
          plain (non-DirIcon) glyph so this row renders byte-identical to LTR,
          matching the frozen silhouette below it instead of mirroring. */}
      <View style={{ height: 36, flexDirection: rtl ? "row-reverse" : "row", alignItems: "center" }}>
        {open ? (
          <>
            <Pressable
              onPress={() => goTo(null)}
              accessibilityRole="button"
              accessibilityLabel={t("injectionMap.backToBody")}
              hitSlop={10}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surfaceInset,
                [rtl ? "marginLeft" : "marginRight"]: 10,
              }}
            >
              <Ionicons name="chevron-back" size={16} color={THEME.accent} />
            </Pressable>
            <Text
              numberOfLines={1}
              style={{ color: THEME.text, fontWeight: "800", fontSize: 14, flex: 1 }}
            >
              {t(`injectionSite.${openSite}`)}
            </Text>
            <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: "700" }}>
              {t("injectionMap.entries", { n: openCount })}
            </Text>
          </>
        ) : (
          <Text numberOfLines={1} style={{ color: THEME.textMuted, fontSize: 11, flex: 1 }}>
            {t("injectionMap.overviewHint")}
          </Text>
        )}
      </View>

      {/* Front | Back. Kept in the layout while zoomed (hidden, inert) so the
          figure below never moves. */}
      <View
        pointerEvents={open ? "none" : "auto"}
        accessibilityElementsHidden={open != null}
        importantForAccessibility={open ? "no-hide-descendants" : "auto"}
        style={{ opacity: open ? 0 : 1, marginTop: 4, marginBottom: 8 }}
      >
        <SurfaceTabs
          value={tab}
          onChange={pickTab}
          labels={{ front: t("injectionMap.front"), back: t("injectionMap.back") }}
          dotOn={nextSurface}
          breath={breath}
        />
      </View>

      <View className="items-center" style={{ alignSelf: "stretch", position: "relative" }}>
        <Animated.View style={[{ width: svgW, height: svgH }, fadeStyle]}>
          <Svg width={svgW} height={svgH} viewBox={`${vx} ${vy} ${vw} ${vh}`}>
            <Defs>
              <LinearGradient
                id="figFill"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={FADE_FROM}
                x2="0"
                y2={FADE_TO}
              >
                <Stop offset="0" stopColor={bodyFill} stopOpacity={1} />
                <Stop offset="1" stopColor={bodyFill} stopOpacity={0} />
              </LinearGradient>
              <LinearGradient
                id="figEdge"
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={FADE_FROM}
                x2="0"
                y2={FADE_TO}
              >
                <Stop offset="0" stopColor={THEME.borderStrong} stopOpacity={1} />
                <Stop offset="1" stopColor={THEME.borderStrong} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            <G onPress={open ? () => goTo(null) : undefined}>
              {open ? (
                <Rect
                  x={vx}
                  y={vy}
                  width={vw}
                  height={vh}
                  rx={18 * upx}
                  fill={plateFill}
                  stroke={THEME.heatEdge}
                  strokeWidth={1 * upx}
                />
              ) : (
                <>
                  <Path d={TORSO_PATH} fill="url(#figFill)" stroke="url(#figEdge)" strokeWidth={1.1 * upx} />
                  {ARM_PATHS.map((d) => (
                    <Path
                      key={d}
                      d={d}
                      fill="url(#figFill)"
                      stroke="url(#figEdge)"
                      strokeWidth={1.1 * upx}
                    />
                  ))}
                </>
              )}
              {open ? null : shown === "front" ? (
                <Circle cx={NAVEL.x} cy={NAVEL.y} r={NAVEL.r} fill={THEME.borderStrong} opacity={0.5} />
              ) : (
                <Path
                  d={SPINE_PATH}
                  stroke={THEME.borderStrong}
                  strokeOpacity={0.4}
                  strokeWidth={1 * upx}
                  strokeLinecap="round"
                />
              )}
            </G>

            {REGIONS.filter((r) => r.surface === shown).map((r) => {
              const count = model.bySite.get(r.site)?.count ?? 0;
              const tier = heatTierForCount(count);
              const isOpen = openSite === r.site;
              const holdsLeast = showRotationHint && model.least?.site === r.site;
              // While a region is zoomed, its neighbours are backdrop only: no
              // handler and no invisible touch rect, so taps near the open
              // region's edge fall through to the silhouette ("back to body").
              const inert = open != null && !isOpen;
              return (
                <RegionShape
                  key={r.site}
                  region={r}
                  tier={tier}
                  count={count}
                  upx={upx}
                  selected={selected?.site === r.site}
                  next={holdsLeast}
                  inert={inert}
                  breath={breath}
                  label={`${t(`injectionSite.${r.site}`)} · ${t("injectionMap.entries", {
                    n: count,
                  })}${holdsLeast ? ` · ${t("injection.leastUsedPoint")}` : ""}`}
                  onPress={() => goTo(isOpen ? null : r.site)}
                />
              );
            })}

            {/* Zoom: the open region's four points, at full touch size. */}
            {open
              ? open.points.map((pp) => {
                  const p = openUsage?.points.find((x) => x.point === pp.point);
                  const count = p?.count ?? 0;
                  const tier = heatTierForCount(count);
                  const fill = tierFill(tier);
                  const ink = inkFor(fill);
                  const on = selected?.site === open.region.site && selected.point === pp.point;
                  const isLeast =
                    showRotationHint &&
                    model.least?.site === open.region.site &&
                    model.least.point === pp.point;
                  return (
                    <G
                      key={pp.point}
                      onPress={() => choose(open.region.site, pp.point)}
                      accessible
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${t("injection.siteWithPoint", {
                        site: t(`injectionSite.${open.region.site}`),
                        n: pp.point,
                      })} · ${t("injectionMap.entries", { n: count })} · ${recencyPhrase(
                        p?.lastUsedAt ?? null
                      )}${isLeast ? ` · ${t("injection.leastUsedPoint")}` : ""}`}
                    >
                      {on ? (
                        <Circle
                          cx={pp.x}
                          cy={pp.y}
                          r={pointRadius + POINT_RING_OUTER * upx}
                          fill="none"
                          stroke={THEME.accent}
                          strokeWidth={1.8 * upx}
                        />
                      ) : null}
                      {isLeast ? (
                        <BreathCircle
                          cx={pp.x}
                          cy={pp.y}
                          r={pointRadius + (on ? POINT_RING_INNER : POINT_RING_OUTER) * upx}
                          breath={breath}
                          strokeWidth={2.4 * upx}
                        />
                      ) : null}
                      <Circle
                        cx={pp.x}
                        cy={pp.y}
                        r={pointRadius}
                        fill={fill}
                        stroke={THEME.heatEdge}
                        strokeWidth={tierStroke(tier) * 1.2 * upx}
                      />
                      <SvgText
                        x={pp.x}
                        y={pp.y - dotNudge + pointFont * 0.36}
                        fontSize={pointFont}
                        fontWeight="bold"
                        fill={ink}
                        textAnchor="middle"
                      >
                        {String(pp.point)}
                      </SvgText>
                      <SvgText
                        x={pp.x}
                        y={pp.y + pointRadius * 0.62}
                        fontSize={countFont}
                        fontWeight="bold"
                        fill={ink}
                        textAnchor="middle"
                      >
                        {String(count)}
                      </SvgText>
                    </G>
                  );
                })
              : null}
          </Svg>

          {/* Side badges, pinned beside the shoulders. Decorative: every region's
              own label already names the side, so the screen reader is told to
              skip them. Each pill is its own absolute child rather than a
              full-size overlay, so nothing ever lies across the map's taps. */}
          {!open
            ? badges.map((b) => (
                <View
                  key={b.key}
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={b.style}
                >
                  <Text
                    numberOfLines={1}
                    style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "800" }}
                  >
                    {t(`injectionMap.${b.key}`)}
                  </Text>
                </View>
              ))
            : null}
        </Animated.View>
      </View>

      {/* Compact key: the five tiers between "less" and "more", plus the next-up
          outline sample. Wraps instead of clipping, so the longest translation
          drops to a second line. */}
      <View
        pointerEvents="none"
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          columnGap: 12,
          rowGap: 6,
          marginTop: 10,
        }}
      >
        {THEME.heatScale.map((c, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Svg width={16} height={12}>
              <Rect
                x={0.5}
                y={0.5}
                width={15}
                height={11}
                rx={4}
                fill={c}
                stroke={THEME.heatEdge}
                strokeWidth={tierStroke(i as Tier)}
              />
            </Svg>
            <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: "700" }}>
              {HEAT_TIER_LABELS[i]}
            </Text>
          </View>
        ))}
        {showRotationHint ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%" }}>
            <Svg width={20} height={12}>
              <Rect
                x={1}
                y={1}
                width={18}
                height={10}
                rx={4}
                fill="none"
                stroke={THEME.accentStrong}
                strokeWidth={1.75}
              />
            </Svg>
            <Text
              numberOfLines={1}
              style={{ color: THEME.textMuted, fontSize: 10, fontWeight: "700", flexShrink: 1 }}
            >
              {t("injectionMap.rotationHint")}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="text-mut text-[11px] text-center mt-2 leading-4">
        {t("injectionMap.selfViewNote")}
      </Text>

      {/* Fixed slot: the absorption chip appears on zoom without moving anything below. */}
      <View style={{ height: 30, alignItems: "center", justifyContent: "center" }}>
        {open ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: RADIUS.full,
              backgroundColor: withAlpha(THEME.accent, 0.12),
              borderWidth: 1,
              borderColor: withAlpha(THEME.accent, 0.3),
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.accent }} />
            <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "700" }}>
              {t(absorptionKey(open.region.site))}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="text-ink font-semibold text-center mt-1">{selectedLabel}</Text>

      <Text className="text-mut text-[11px] text-center mt-2 leading-4">
        {t("injection.pointNeutral")}
      </Text>
      {!isScreenshotMode() && model.legacyAbdomen > 0 ? (
        <Text className="text-mut text-[11px] text-center mt-1">
          {t("injection.abdomenGeneral", { n: model.legacyAbdomen })}
        </Text>
      ) : null}
      {!isScreenshotMode() && model.unassigned > 0 ? (
        <Text className="text-mut text-[11px] text-center mt-1">
          {t("injection.noPointYet", { n: model.unassigned })}
        </Text>
      ) : null}
      {!isScreenshotMode() && noSiteCount > 0 ? (
        <Text className="text-mut text-[11px] text-center mt-1">
          {t("injection.noRegionCount", { n: noSiteCount })}
        </Text>
      ) : null}
      {/* A profile that only ever logs through the calculator has every dose
          in noSiteCount and none on the silhouette - "no injections yet" would
          be wrong there, so the truly-empty text only shows when there is
          really nothing recorded anywhere. */}
      {model.total === 0 && noSiteCount === 0 ? (
        <Text className="text-mut text-[11px] text-center mt-2">{t("injection.empty")}</Text>
      ) : null}

      {onStartNewCycle ? (
        <View className="flex-row items-center justify-between mt-3">
          <Text numberOfLines={1} style={{ color: THEME.textMuted, fontSize: 11, flex: 1 }}>
            {cycleStart ? t("injection.cycleSince", { date: formatDate(cycleStart) }) : ""}
          </Text>
          <Pressable
            onPress={onStartNewCycle}
            accessibilityRole="button"
            accessibilityLabel={t("injection.newCycle")}
            hitSlop={8}
            className="flex-row items-center rounded-full px-3 py-1.5 active:opacity-80"
            style={{
              borderWidth: 1,
              borderColor: withAlpha(THEME.accent, 0.3),
              backgroundColor: withAlpha(THEME.accent, 0.12),
            }}
          >
            <Ionicons name="refresh-outline" size={13} color={THEME.accent} />
            <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "800", marginLeft: 6 }}>
              {t("injection.newCycle")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
