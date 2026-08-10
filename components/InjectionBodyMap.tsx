import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { InjectionSite, SitePoint } from "../lib/db/types";
import { SITE_POINTS, pointGrid } from "../lib/db/types";
import type { PointUsage, SiteUsage } from "../lib/db/injections";
import { RADIUS, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { formatDate } from "../lib/format";
import { hapticSelect } from "../lib/haptics";
import { isScreenshotMode } from "../lib/screenshotMode";

/**
 * Injection-site usage map (schema v9), at ROTATION-POINT resolution.
 *
 * ONE silhouette, divided into the eight selectable regions by a near-black
 * outline. A region's fill is a single-hue sequential ramp driven by FREQUENCY
 * alone (count / busiest count): untouched regions stay pale, the busiest one
 * goes deep teal. Tapping a region zooms the SVG onto it and reveals its four
 * rotation points at full touch size.
 *
 * Colour is a picture of the user's OWN history: nothing says where to inject,
 * and every colour is paired with a count, so it reads without hue.
 */

interface Region {
  site: InjectionSite;
  /** Point layout inside the box: 2x2 grid, or a single top-to-bottom column. */
  layout: "grid" | "column";
  /** Region container [x, y, w, h] in viewBox units. */
  box: readonly [number, number, number, number];
  /** Corner radius; w/2 turns the box into a capsule (limbs). */
  rx: number;
}

// A smooth, WIDE anatomical body outline on the 0 0 240 380 viewBox (symmetric about
// x=120): a stockier torso so the belly regions sit comfortably, and shorter legs
// (ending near the knee) so the whole figure can be shown large. Head is separate.
const BODY_PATH =
  "M 111 60 C 103.8 66 93.2 86.3 86 96 C 78.8 105.7 72.3 109 68 118 C 63.7 127 61.5 138.3 60 150 " +
  "C 58.5 161.7 59.3 175.3 59 188 C 58.7 200.7 57 217.7 58 226 C 59 234.3 62.7 237.7 65 238 " +
  "C 67.3 238.3 70.7 235.7 72 228 C 73.3 220.3 71.2 205.7 73 192 C 74.8 178.3 80.2 146.3 83 146 " +
  "C 85.8 145.7 90 176.7 90 190 C 90 203.3 83.7 210.7 83 226 C 82.3 241.3 84.3 263.7 86 282 " +
  "C 87.7 300.3 91.3 323 93 336 C 94.7 349 94.2 354.7 96 360 C 97.8 365.3 101.3 368 104 368 " +
  "C 106.7 368 110 372.3 112 360 C 114 347.7 114.8 311.7 116 294 C 117.2 276.3 118.3 261.7 119 254 " +
  "C 119.7 246.3 119.7 248 120 248 C 120.3 248 120.3 246.3 121 254 C 121.7 261.7 122.8 276.3 124 294 " +
  "C 125.2 311.7 126 347.7 128 360 C 130 372.3 133.3 368 136 368 C 138.7 368 142.2 365.3 144 360 " +
  "C 145.8 354.7 145.3 349 147 336 C 148.7 323 152.3 300.3 154 282 C 155.7 263.7 157.7 241.3 157 226 " +
  "C 156.3 210.7 150 203.3 150 190 C 150 176.7 154.2 145.7 157 146 C 159.8 146.3 165.2 178.3 167 192 " +
  "C 168.8 205.7 166.7 220.3 168 228 C 169.3 235.7 172.7 238.3 175 238 C 177.3 237.7 181 234.3 182 226 " +
  "C 183 217.7 181.3 200.7 181 188 C 180.7 175.3 181.5 161.7 180 150 C 178.5 138.3 176.3 127 172 118 " +
  "C 167.7 109 161.2 105.7 154 96 C 146.8 86.3 136.2 66 129 60 C 121.8 54 118.2 54 111 60 Z";

const VB_W = 240;
const VB_H = 380;
const VB_ASPECT = VB_W / VB_H;

/**
 * The eight regions, hand-fitted to BODY_PATH so no box crosses the silhouette
 * edge and no two boxes touch. Left/right are the VIEWER's; the label resolves
 * the anatomical side. Buttocks are drawn on the hip line of the single
 * silhouette, the usual simplification on a one-face injection diagram.
 */
const REGIONS: readonly Region[] = [
  { site: "abdomen_left", layout: "grid", box: [92, 192, 26, 36], rx: 6 },
  { site: "abdomen_right", layout: "grid", box: [122, 192, 26, 36], rx: 6 },
  { site: "thigh_left", layout: "column", box: [92, 264, 18, 58], rx: 9 },
  { site: "thigh_right", layout: "column", box: [130, 264, 18, 58], rx: 9 },
  { site: "arm_left", layout: "column", box: [60.5, 154, 12, 50], rx: 6 },
  { site: "arm_right", layout: "column", box: [167.5, 154, 12, 50], rx: 6 },
  { site: "buttock_left", layout: "grid", box: [85, 232, 24, 28], rx: 8 },
  { site: "buttock_right", layout: "grid", box: [131, 232, 24, 28], rx: 8 },
];

/**
 * Invisible touch-target padding for the two regions whose drawn width is
 * narrowest (arm ~12 units, thigh ~18 units - well under a 44pt target once
 * the silhouette is scaled down on a phone). Extends sideways only (their
 * height already clears 44pt at every supported screen width); LEFT/RIGHT are
 * viewBox-literal, not anatomical, and were chosen by hand against every
 * neighbouring region box in REGIONS so the padded rect never overlaps one:
 *
 *  - arm: 17 units each side stays clear of abdomen (a 2.5-unit gap at the
 *    narrowest point) while opening onto empty background on the other side.
 *  - thigh: only 9 units toward its mirror twin (2-unit gap across the groin
 *    gap of 20) but 17 outward, where nothing else sits below the ribcage.
 *
 * Not applied to abdomen/buttock: this is the fix the audit asked for
 * specifically for arm/thigh, and both of those already clear 44pt as drawn.
 */
const HIT_PAD: Partial<Record<InjectionSite, { left: number; right: number }>> = {
  arm_left: { left: 17, right: 17 },
  arm_right: { left: 17, right: 17 },
  thigh_left: { left: 17, right: 9 },
  thigh_right: { left: 9, right: 17 },
};

/** The region's box, widened by HIT_PAD if it has one; otherwise the box
 *  itself (the drawn Rect already IS the hit target for every other region). */
function hitBoxFor(r: Region): Region["box"] {
  const pad = HIT_PAD[r.site];
  if (!pad) return r.box;
  const [x, y, w, h] = r.box;
  return [x - pad.left, y, w + pad.left + pad.right, h];
}

interface PlacedPoint {
  point: SitePoint;
  x: number;
  y: number;
}

function placePoints(r: Region): PlacedPoint[] {
  const [bx, by, bw, bh] = r.box;
  if (r.layout === "grid") {
    return SITE_POINTS.map((point) => {
      const { row, col } = pointGrid(point);
      return {
        point,
        x: bx + bw * (col === 0 ? 0.28 : 0.72),
        y: by + bh * (row === 0 ? 0.27 : 0.73),
      };
    });
  }
  const fractions = [0.14, 0.38, 0.62, 0.86];
  return SITE_POINTS.map((point) => ({
    point,
    x: bx + bw / 2,
    y: by + bh * fractions[point - 1],
  }));
}

type ViewBox = readonly [number, number, number, number];

/** Padding around a zoomed region, in viewBox units. */
const ZOOM_PAD = 11;

function zoomViewBox(box: Region["box"]): ViewBox {
  let w = box[2] + ZOOM_PAD * 2;
  let h = box[3] + ZOOM_PAD * 2;
  if (w / h > VB_ASPECT) h = w / VB_ASPECT;
  else w = h * VB_ASPECT;
  let x = box[0] + box[2] / 2 - w / 2;
  let y = box[1] + box[3] / 2 - h / 2;
  if (w <= VB_W) x = Math.min(Math.max(x, 0), VB_W - w);
  if (h <= VB_H) y = Math.min(Math.max(y, 0), VB_H - h);
  return [x, y, w, h];
}

const FULL_VIEW: ViewBox = [0, 0, VB_W, VB_H];

interface Geometry {
  region: Region;
  points: PlacedPoint[];
  zoom: ViewBox;
  cx: number;
  cy: number;
}

const GEOMETRY: Map<InjectionSite, Geometry> = new Map(
  REGIONS.map((region) => [
    region.site,
    {
      region,
      points: placePoints(region),
      zoom: zoomViewBox(region.box),
      cx: region.box[0] + region.box[2] / 2,
      cy: region.box[1] + region.box[3] / 2,
    },
  ])
);

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

/**
 * Single-hue SEQUENTIAL ramp for the silhouette: pale at 0, deep teal at 1.
 * The body is drawn light, so "more often used" = darker ink on that light
 * ground, which stays legible on the dark app background at both ends.
 */
const FREQ_STOPS: readonly (readonly [number, number, number])[] = [
  [232, 245, 250],
  [166, 216, 232],
  [92, 172, 199],
  [38, 112, 146],
  [9, 48, 68],
];

export function frequencyFill(t: number): string {
  const v = Math.min(1, Math.max(0, t)) * (FREQ_STOPS.length - 1);
  const i = Math.min(FREQ_STOPS.length - 2, Math.floor(v));
  const f = v - i;
  const a = FREQ_STOPS[i];
  const b = FREQ_STOPS[i + 1];
  return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(
    lerp(a[1], b[1], f)
  )},${Math.round(lerp(a[2], b[2], f))})`;
}

/** Label colour that keeps its contrast at both ends of the ramp. */
function frequencyInk(t: number): string {
  return t >= 0.72 ? "#eaf6fa" : "#08161d";
}

/** Frequency share of one count against the busiest one. A used region never
 *  sits at the very pale end, so "once" cannot read as "never". */
function frequencyLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  return 0.16 + 0.84 * Math.min(1, count / Math.max(1, max));
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

/** Near-black region outline, derived from the darkest background token. */
const EDGE = withAlpha(THEME.bg.g1, 0.88);
const BODY_EDGE = withAlpha(THEME.bg.g1, 0.34);

/** Offset of the accent ring around a selected region. Kept small enough that the
 *  ring still clears the narrowest region (the upper arm) without crossing the
 *  silhouette edge. */
const HALO = 1.4;

/** Fade-out then fade-in around the instant viewBox swap (ms). */
const FADE_OUT = 110;
const FADE_IN = 170;

export function InjectionBodyMap({
  usage,
  noSiteCount = 0,
  selected,
  onSelect,
  windowDays = 30,
  initialZoom,
  cycleStart,
  onStartNewCycle,
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
}) {
  const { t } = useTranslation();
  const { width: winW, height: winH } = useWindowDimensions();
  // Silhouette scales with the screen width (capped) so it fills the card on both
  // a narrow phone and a wide tablet. Height follows the viewBox aspect, so it
  // never changes when data or zoom state does.
  const svgW = Math.min(Math.round(winW * 0.78), 384);
  const svgH = Math.round((svgW * VB_H) / VB_W);
  const legendH = Math.round(svgH * 0.44);

  const [openSite, setOpenSite] = useState<InjectionSite | null>(null);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const now = Date.now();

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
    if (GEOMETRY.has(initialZoom as InjectionSite)) setOpenSite(initialZoom as InjectionSite);
  }, [initialZoom]);

  const model = useMemo(() => {
    const bySite = new Map<InjectionSite, SiteUsage>();
    usage.forEach((u) => bySite.set(u.site, u));

    const regionSites = new Set(REGIONS.map((r) => r.site));
    const selectableUsage = usage.filter((u) => regionSites.has(u.site));
    const allPoints: PointUsage[] = selectableUsage.flatMap((u) => u.points);
    const maxPointCount = Math.max(1, ...allPoints.map((p) => p.count));
    const maxSiteCount = Math.max(1, ...selectableUsage.map((u) => u.count));
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

    return { bySite, maxPointCount, maxSiteCount, total, unassigned, legacyAbdomen, least };
  }, [usage]);

  const open = openSite ? GEOMETRY.get(openSite) ?? null : null;
  const [vx, vy, vw, vh] = open ? open.zoom : FULL_VIEW;
  // One screen point expressed in viewBox units, so strokes, dots and labels keep
  // the same physical size at every zoom level.
  const upx = vw / svgW;

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

  const selectedLabel = selected
    ? t("injection.siteWithPoint", {
        site: t(`injectionSite.${selected.site}`),
        n: selected.point,
      })
    : t("injection.tapRegion");

  const pointRadius = 23 * upx;
  const pointFont = 15 * upx;
  const countFont = 10 * upx;

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
      <Text className="text-mut text-[11px] leading-4">{t("injectionMap.sub")}</Text>

      {/* Fixed-height bar: the hint and the zoom header swap without moving the SVG. */}
      <View style={{ height: 36, flexDirection: "row", alignItems: "center" }}>
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
                backgroundColor: withAlpha("#ffffff", 0.06),
                marginRight: 10,
              }}
            >
              <Ionicons name="chevron-back" size={16} color={THEME.accent} />
            </Pressable>
            <Text
              numberOfLines={1}
              style={{ color: THEME.ink, fontWeight: "800", fontSize: 14, flex: 1 }}
            >
              {t(`injectionSite.${openSite}`)}
            </Text>
            <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "700" }}>
              {t("injectionMap.entries", { n: openCount })}
            </Text>
          </>
        ) : (
          <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 11, flex: 1 }}>
            {t("injectionMap.overviewHint")}
          </Text>
        )}
      </View>

      <View className="items-center" style={{ alignSelf: "stretch", position: "relative" }}>
        {/* Sequential legend, ABSOLUTE at the far left so the silhouette stays centred.
            It sits on a light plate so the dark end of the ramp reads on the dark card. */}
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 24,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text className="text-mut" style={{ fontSize: 10, marginBottom: 6 }}>
            {t("injection.heatHigh")}
          </Text>
          <Svg width={14} height={legendH}>
            <Defs>
              <LinearGradient id="freqLegend" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={frequencyFill(1)} />
                <Stop offset="0.5" stopColor={frequencyFill(0.5)} />
                <Stop offset="1" stopColor={frequencyFill(0)} />
              </LinearGradient>
            </Defs>
            <Rect
              x={1}
              y={1}
              width={12}
              height={legendH - 2}
              rx={6}
              fill="url(#freqLegend)"
              stroke={EDGE}
              strokeWidth={1.2}
            />
          </Svg>
          <Text className="text-mut" style={{ fontSize: 10, marginTop: 6 }}>
            {t("injection.heatLow")}
          </Text>
        </View>

        <Animated.View style={[{ width: svgW, height: svgH }, fadeStyle]}>
          <Svg width={svgW} height={svgH} viewBox={`${vx} ${vy} ${vw} ${vh}`}>
            <Defs>
              <LinearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#eef7fb" />
                <Stop offset="1" stopColor="#c2d5df" />
              </LinearGradient>
            </Defs>

            <G onPress={open ? () => goTo(null) : undefined}>
              <Ellipse
                cx={120}
                cy={38}
                rx={22}
                ry={25}
                fill="url(#bodyGrad)"
                stroke={BODY_EDGE}
                strokeWidth={1.2 * upx}
              />
              <Path
                d={BODY_PATH}
                fill="url(#bodyGrad)"
                stroke={BODY_EDGE}
                strokeWidth={1.2 * upx}
              />
              <Circle cx={120} cy={210} r={2} fill="rgba(10,20,26,0.28)" />
            </G>

            {REGIONS.map((r) => {
              const geo = GEOMETRY.get(r.site)!;
              const u = model.bySite.get(r.site);
              const count = u?.count ?? 0;
              const level = frequencyLevel(count, model.maxSiteCount);
              const isOpen = openSite === r.site;
              const isSelected = selected?.site === r.site;
              const holdsLeast = model.least?.site === r.site;
              const [bx, by, bw, bh] = r.box;
              const [hx, hy, hw, hh] = hitBoxFor(r);
              // While a region is zoomed, its neighbours are backdrop only. Their
              // padded hit rects reach into the zoomed viewBox (thigh_right's
              // starts at x=121, inside thigh_left's zoom which ends at 126.3) and,
              // drawn later, answered taps meant for the open region's edge or for
              // "back to body". Dropping the handler AND the invisible rect lets
              // those taps fall through to the silhouette, which returns to the
              // full view. Nothing overlaps in the full view, so it is unchanged.
              const inert = open != null && !isOpen;
              return (
                <G
                  key={r.site}
                  opacity={inert ? 0.32 : 1}
                  onPress={inert ? undefined : () => goTo(isOpen ? null : r.site)}
                  accessible={!inert}
                  accessibilityRole={inert ? undefined : "button"}
                  accessibilityLabel={
                    inert
                      ? undefined
                      : `${t(`injectionSite.${r.site}`)} · ${t("injectionMap.entries", {
                          n: count,
                        })}`
                  }
                >
                  {hw !== bw && !inert ? (
                    <Rect x={hx} y={hy} width={hw} height={hh} fill="transparent" />
                  ) : null}
                  {isSelected || holdsLeast ? (
                    <Rect
                      x={bx - HALO}
                      y={by - HALO}
                      width={bw + HALO * 2}
                      height={bh + HALO * 2}
                      rx={r.rx + HALO}
                      fill="none"
                      stroke={THEME.accent}
                      strokeWidth={1.6 * upx}
                      strokeDasharray={isSelected ? undefined : `${3 * upx} ${3 * upx}`}
                    />
                  ) : null}
                  <Rect
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    rx={r.rx}
                    fill={frequencyFill(level)}
                    stroke={EDGE}
                    strokeWidth={2.2 * upx}
                  />
                  {!open ? (
                    <SvgText
                      x={geo.cx}
                      y={geo.cy + countFont * 0.36}
                      fontSize={countFont}
                      fontWeight="bold"
                      fill={frequencyInk(level)}
                      textAnchor="middle"
                    >
                      {String(count)}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}

            {/* Zoom: the open region's four points, at full touch size. */}
            {open
              ? GEOMETRY.get(open.region.site)!.points.map((pp) => {
                  const p = openUsage?.points.find((x) => x.point === pp.point);
                  const count = p?.count ?? 0;
                  const level = frequencyLevel(count, model.maxPointCount);
                  const on = selected?.site === open.region.site && selected.point === pp.point;
                  const isLeast =
                    model.least?.site === open.region.site && model.least.point === pp.point;
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
                      {on || isLeast ? (
                        <Circle
                          cx={pp.x}
                          cy={pp.y}
                          r={pointRadius + 3.5 * upx}
                          fill="none"
                          stroke={THEME.accent}
                          strokeWidth={1.8 * upx}
                          strokeDasharray={on ? undefined : `${3 * upx} ${3 * upx}`}
                        />
                      ) : null}
                      <Circle
                        cx={pp.x}
                        cy={pp.y}
                        r={pointRadius}
                        fill={frequencyFill(level)}
                        stroke={EDGE}
                        strokeWidth={1.6 * upx}
                      />
                      <SvgText
                        x={pp.x}
                        y={pp.y + pointFont * 0.36}
                        fontSize={pointFont}
                        fontWeight="bold"
                        fill={frequencyInk(level)}
                        textAnchor="middle"
                      >
                        {String(pp.point)}
                      </SvgText>
                    </G>
                  );
                })
              : null}
          </Svg>
        </Animated.View>
      </View>

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
          <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 11, flex: 1 }}>
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
