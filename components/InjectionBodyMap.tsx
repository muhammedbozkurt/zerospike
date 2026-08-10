import React, { useMemo, useState } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { InjectionSite, SitePoint } from "../lib/db/types";
import { SITE_POINTS } from "../lib/db/types";
import type { PointUsage, SiteUsage } from "../lib/db/injections";
import { GLUCOSE_RICH, HIT_TARGET, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { hapticSelect } from "../lib/haptics";
import { isScreenshotMode } from "../lib/screenshotMode";

/**
 * Injection-site usage map (schema v9), at ROTATION-POINT resolution.
 *
 * R7.1: the silhouette is now a layered, anatomically proportioned body with a
 * FRONT / BACK toggle. The abdomen is split into four quadrants (FITTER model);
 * thighs and arms sit on the front, buttocks on the back. Selecting a region
 * auto-switches to the face it lives on. Legacy pre-v9 general-abdomen rows are
 * never rewritten and are shown as a small "abdomen (general)" total on the
 * front, so no logged data is hidden.
 *
 * Colour is a picture of the user's OWN history: how many times a point was used
 * in the window, weighted by how recently. Neutral by design - nothing says
 * where to inject; every colour is paired with a count, so it reads without hue.
 */

type BodyView = "front" | "back";

interface Region {
  site: InjectionSite;
  view: BodyView;
  /** Point layout: horizontal row (abdomen), vertical line (thigh / arm) or 2x2 grid (buttock). */
  orient: "h" | "v" | "g";
  /** Centre of the 4-point cluster + spacing between points. */
  cx: number;
  cy: number;
  sp: number;
  /** Rounded tap/selection container [x, y, w, h] behind the points. */
  box: [number, number, number, number];
}

// A smooth, WIDE anatomical body outline on the 0 0 240 380 viewBox (symmetric about
// x=120): a stockier torso so the 8 belly points sit comfortably, and shorter legs
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

// viewBox 0 0 240 380. Left/right are the viewer's; the label resolves the
// anatomical side, so there is no ambiguity.
const REGIONS: Region[] = [
  // FRONT: abdomen as a single horizontal row of 4 points on each side of the navel
  // (wide spacing, fits the wider belly), plus the outer thighs as a vertical line.
  { site: "abdomen_left", view: "front", orient: "h", cx: 101.75, cy: 202, sp: 7.5, box: [83, 194, 37, 16] },
  { site: "abdomen_right", view: "front", orient: "h", cx: 138.25, cy: 202, sp: 7.5, box: [120, 194, 37, 16] },
  { site: "thigh_left", view: "front", orient: "v", cx: 104, cy: 301, sp: 22, box: [96, 260, 16, 82] },
  { site: "thigh_right", view: "front", orient: "v", cx: 136, cy: 301, sp: 22, box: [128, 260, 16, 82] },
  // BACK: back-outer upper arms (vertical line) + the upper-outer buttocks (a small
  // 2x2 cluster each - a valid site even if lightly used).
  { site: "arm_left", view: "back", orient: "v", cx: 66, cy: 176, sp: 16, box: [58, 144, 16, 66] },
  { site: "arm_right", view: "back", orient: "v", cx: 174, cy: 176, sp: 16, box: [166, 144, 16, 66] },
  { site: "buttock_left", view: "back", orient: "g", cx: 103, cy: 242, sp: 6, box: [91, 230, 24, 24] },
  { site: "buttock_right", view: "back", orient: "g", cx: 137, cy: 242, sp: 6, box: [125, 230, 24, 24] },
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

/** A faint container tint for a region, keyed to how used it is (cool vs warm). */
function heatTint(intensity: number): string {
  const i = Math.min(1, Math.max(0, intensity));
  if (i <= 0) return "rgba(255,255,255,0.05)";
  return i < 0.5 ? "rgba(46,230,255,0.10)" : "rgba(255,160,42,0.11)";
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

/** A smooth anatomical silhouette for one face, on the 0 0 240 440 viewBox. */
function BodySilhouette({ view }: { view: BodyView }) {
  return (
    <G>
      <Ellipse cx={120} cy={38} rx={22} ry={25} fill="url(#bodyGrad)" stroke="rgba(255,255,255,0.22)" strokeWidth={1.4} />
      <Path d={BODY_PATH} fill="url(#bodyGrad)" stroke="rgba(255,255,255,0.22)" strokeWidth={1.4} />
      {view === "back" ? (
        // Back: a faint spine + shoulder-blade hint so the face reads as the back.
        <>
          <Path d="M120 94 L120 242" stroke="rgba(10,20,26,0.20)" strokeWidth={1} strokeDasharray="2 5" />
          <Ellipse cx={104} cy={146} rx={11} ry={15} fill="none" stroke="rgba(10,20,26,0.16)" strokeWidth={0.8} />
          <Ellipse cx={136} cy={146} rx={11} ry={15} fill="none" stroke="rgba(10,20,26,0.16)" strokeWidth={0.8} />
        </>
      ) : (
        // Front: a soft navel between the two abdomen rows.
        <Circle cx={120} cy={202} r={2} fill="rgba(10,20,26,0.30)" />
      )}
    </G>
  );
}

/** Regions laid out as a vertical 1x4 strip (arm/thigh) vs a 2x2 grid. */
function isVerticalRegion(site: InjectionSite): boolean {
  return site.startsWith("arm") || site.startsWith("thigh");
}

/** Neutral, educational absorption-speed note per region type (info, NOT advice;
 *  no insulin type is ever tied to a site). */
export function absorptionKey(site: InjectionSite): string {
  if (site.startsWith("abdomen")) return "injection.absorbFast";
  if (site.startsWith("arm")) return "injection.absorbMedFast";
  if (site.startsWith("thigh")) return "injection.absorbMedSlow";
  return "injection.absorbSlow"; // buttock / hip
}

export function InjectionBodyMap({
  usage,
  selected,
  onSelect,
  windowDays = 30,
  initialZoom,
}: {
  usage: SiteUsage[];
  selected: PointSelection | null;
  onSelect: (selection: PointSelection) => void;
  windowDays?: number;
  /** Store-screenshot only: open this region's zoom card on mount. */
  initialZoom?: string;
}) {
  const { t } = useTranslation();
  const { width: winW, height: winH } = useWindowDimensions();
  // Silhouette scales with the screen width (capped) so it fills the card on both
  // a narrow phone and a wide tablet, rather than sitting tiny on the iPad.
  const svgW = Math.min(Math.round(winW * 0.78), 384);
  const svgH = Math.round((svgW * 380) / 240);
  const legendH = Math.round(svgH * 0.46);
  const [openRegion, setOpenRegion] = useState<InjectionSite | null>(null);
  const [view, setView] = useState<BodyView>("front");

  // Screenshot navigation: open a region's zoom card (and its face) on mount.
  React.useEffect(() => {
    if (!initialZoom) return;
    const region = REGIONS.find((r) => r.site === initialZoom);
    if (region) {
      setView(region.view);
      setOpenRegion(region.site);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialZoom]);

  const now = Date.now();

  // Auto-switch to the face a freshly selected region lives on.
  const selectedView = selected
    ? REGIONS.find((r) => r.site === selected.site)?.view
    : undefined;
  React.useEffect(() => {
    if (selectedView && selectedView !== view) setView(selectedView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.site]);

  const model = useMemo(() => {
    const bySite = new Map<InjectionSite, SiteUsage>();
    usage.forEach((u) => bySite.set(u.site, u));

    // Only the selectable regions feed the heat scale / hottest / least logic.
    const regionSites = new Set(REGIONS.map((r) => r.site));
    const selectableUsage = usage.filter((u) => regionSites.has(u.site));
    const allPoints: PointUsage[] = selectableUsage.flatMap((u) => u.points);
    const maxPointCount = Math.max(1, ...allPoints.map((p) => p.count));
    const maxSiteCount = Math.max(1, ...selectableUsage.map((u) => u.count));
    const total = selectableUsage.reduce((sum, u) => sum + u.count, 0);
    const unassigned = usage.reduce((sum, u) => sum + u.unassignedCount, 0);

    // Data logged against the retired abdomen quadrants is not on the new map; surface
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

    let hottest: Region = REGIONS[0];
    let hottestCount = -1;
    for (const r of REGIONS) {
      const c = bySite.get(r.site)?.count ?? 0;
      if (c > hottestCount) {
        hottestCount = c;
        hottest = r;
      }
    }

    return { bySite, maxPointCount, maxSiteCount, total, unassigned, legacyAbdomen, least, hottest };
  }, [usage]);

  /** Combined frequency + recency intensity for one point. */
  function pointIntensity(p: PointUsage): number {
    if (p.count === 0) return 0;
    const freq = p.count / model.maxPointCount;
    const recent = recencyWeight(p.lastUsedAt, now);
    return Math.min(1, freq * 0.65 + recent * 0.35);
  }

  /** "used today" / "N days ago" / "never used" for the accessibility label. */
  function recencyPhrase(lastUsedAt: string | null): string {
    const d = daysSince(lastUsedAt, now);
    if (d == null) return t("injection.usedNever");
    if (d === 0) return t("injection.usedToday");
    return t("injection.daysAgo", { n: d });
  }

  const openUsage = openRegion ? model.bySite.get(openRegion) : undefined;
  const zoomVertical = openRegion ? isVerticalRegion(openRegion) : false;
  const visibleRegions = REGIONS.filter((r) => r.view === view);

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
      style={[
        // A floor only for very short screens; the big responsive silhouette already
        // makes the card tall enough to fill the phone viewport (rotation card mostly
        // off-screen) without leaving dead space under the notes on a taller tablet.
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
      <Text className="text-mut text-[11px] leading-4 mb-2">
        {t("injection.pointMapSub")}
      </Text>

      {/* Front / back toggle */}
      <View className="flex-row self-center rounded-full border border-hair mb-1" style={{ overflow: "hidden" }}>
        {(["front", "back"] as BodyView[]).map((v) => {
          const on = v === view;
          return (
            <Pressable
              key={v}
              onPress={() => {
                hapticSelect();
                setView(v);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={v === "front" ? t("injection.frontView") : t("injection.backView")}
              style={{
                paddingHorizontal: 18,
                paddingVertical: 7,
                backgroundColor: on ? THEME.accent : "transparent",
              }}
            >
              <Text style={{ color: on ? "#00171c" : THEME.muted, fontSize: 12, fontWeight: "800" }}>
                {v === "front" ? t("injection.frontView") : t("injection.backView")}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="items-center py-1" style={{ alignSelf: "stretch", position: "relative" }}>
        {/* Vertical heat legend, ABSOLUTE at the far left so the silhouette stays centred */}
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 24, alignItems: "center", justifyContent: "center" }}>
          <Text className="text-mut" style={{ fontSize: 10, marginBottom: 6 }}>{t("injection.heatHigh")}</Text>
          <Svg width={10} height={legendH}>
            <Defs>
              <LinearGradient id="legendGradV" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={heatFill(1)} />
                <Stop offset="0.5" stopColor={heatFill(0.5)} />
                <Stop offset="1" stopColor={heatFill(0.08)} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={10} height={legendH} rx={5} fill="url(#legendGradV)" />
          </Svg>
          <Text className="text-mut" style={{ fontSize: 10, marginTop: 6 }}>{t("injection.heatLow")}</Text>
        </View>
        <Svg width={svgW} height={svgH} viewBox="0 0 240 380">
          <Defs>
            <LinearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#eef7fb" />
              <Stop offset="1" stopColor="#c2d5df" />
            </LinearGradient>
            <RadialGradient id="hotspot">
              <Stop offset="0" stopColor={GLUCOSE_RICH.wellAbove} stopOpacity={0.5} />
              <Stop offset="1" stopColor={GLUCOSE_RICH.wellAbove} stopOpacity={0} />
            </RadialGradient>
          </Defs>

          {/* Warm hot-spot under the busiest region on the current face */}
          {model.total > 0 && model.hottest.view === view ? (
            <Circle cx={model.hottest.cx} cy={model.hottest.cy} r={30} fill="url(#hotspot)" />
          ) : null}

          <BodySilhouette view={view} />

          {/* Selectable regions on this face: a soft container + the 4 heat dots + count */}
          {visibleRegions.map((r) => {
            const u = model.bySite.get(r.site);
            const count = u?.count ?? 0;
            const isSelected = selected?.site === r.site;
            const holdsLeast = model.least?.site === r.site;
            const [bx, by, bw, bh] = r.box;
            const stroke = isSelected || holdsLeast ? THEME.accent : "rgba(255,255,255,0.32)";
            return (
              <G key={r.site} onPress={() => setOpenRegion(r.site)}>
                <Rect
                  x={bx}
                  y={by}
                  width={bw}
                  height={bh}
                  rx={Math.min(bw, bh) / 2}
                  fill={heatTint(count / model.maxSiteCount)}
                  stroke={stroke}
                  strokeWidth={isSelected ? 1.8 : 1.1}
                  strokeDasharray={holdsLeast && !isSelected ? "3 3" : undefined}
                />
                {SITE_POINTS.map((point) => {
                  const p = u?.points.find((x) => x.point === point);
                  let cx: number, cy: number;
                  if (r.orient === "g") {
                    cx = r.cx + ((point - 1) % 2 === 0 ? -r.sp : r.sp);
                    cy = r.cy + (point <= 2 ? -r.sp : r.sp);
                  } else {
                    const off = (point - 2.5) * r.sp;
                    cx = r.orient === "h" ? r.cx + off : r.cx;
                    cy = r.orient === "v" ? r.cy + off : r.cy;
                  }
                  const on = selected?.site === r.site && selected.point === point;
                  const c = p && p.count > 0 ? heatFill(pointIntensity(p)) : "rgba(255,255,255,0.14)";
                  return (
                    <G key={point}>
                      {p && p.count > 0 ? (
                        <Circle cx={cx} cy={cy} r={6.5} fill={c} opacity={0.16} />
                      ) : null}
                      <Circle
                        cx={cx}
                        cy={cy}
                        r={on ? 4.6 : 4.2}
                        fill={c}
                        stroke={on ? THEME.accent : "rgba(10,20,26,0.5)"}
                        strokeWidth={on ? 1.9 : 1.1}
                      />
                    </G>
                  );
                })}
                {count > 0 ? (
                  <G>
                    <Circle
                      cx={bx + bw / 2}
                      cy={by - 8}
                      r={8}
                      fill="rgba(8,16,22,0.82)"
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth={0.8}
                    />
                    <SvgText
                      x={bx + bw / 2}
                      y={by - 8 + 3.3}
                      fontSize={9}
                      fontWeight="bold"
                      fill={THEME.ink}
                      textAnchor="middle"
                    >
                      {String(count)}
                    </SvgText>
                  </G>
                ) : null}
              </G>
            );
          })}
        </Svg>
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
            {/* Header: region name + close */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: THEME.ink, fontSize: 18, fontWeight: "800" }}>
                  {openRegion ? t(`injectionSite.${openRegion}`) : ""}
                </Text>
                <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 2 }}>
                  {t("injection.selectPoint")}
                </Text>
              </View>
              <Pressable
                onPress={() => setOpenRegion(null)}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                hitSlop={10}
                style={{
                  width: 30, height: 30, borderRadius: 15,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: withAlpha("#ffffff", 0.06),
                  borderWidth: 1, borderColor: THEME.border,
                }}
              >
                <Text style={{ color: THEME.muted, fontSize: 15, fontWeight: "700", lineHeight: 17 }}>×</Text>
              </Pressable>
            </View>

            {/* Absorption note as a subtle chip */}
            {openRegion ? (
              <View
                style={{
                  alignSelf: "flex-start", marginTop: 12,
                  flexDirection: "row", alignItems: "center", gap: 6,
                  paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999,
                  backgroundColor: withAlpha(THEME.accent, 0.12),
                  borderWidth: 1, borderColor: withAlpha(THEME.accent, 0.3),
                }}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.accent }} />
                <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "700" }}>
                  {t(absorptionKey(openRegion))}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: 14, gap: 8 }}>
              {SITE_POINTS.map((point) => {
                const p = openUsage?.points.find((x) => x.point === point);
                const on = selected?.site === openRegion && selected.point === point;
                const isLeast = model.least?.site === openRegion && model.least.point === point;
                const intensity = p ? pointIntensity(p) : 0;
                const used = (p?.count ?? 0) > 0;
                return (
                  <Pressable
                    key={point}
                    onPress={() => openRegion && choose(openRegion, point)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${t("injection.siteWithPoint", {
                      site: openRegion ? t(`injectionSite.${openRegion}`) : "",
                      n: point,
                    })} · ${recencyPhrase(p?.lastUsedAt ?? null)}`}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 12,
                      minHeight: HIT_TARGET,
                      borderRadius: RADIUS.lg,
                      borderWidth: on ? 1.6 : 1,
                      borderColor: on || isLeast ? THEME.accent : THEME.border,
                      borderStyle: isLeast && !on ? "dashed" : "solid",
                      backgroundColor: withAlpha("#ffffff", on ? 0.06 : 0.03),
                      paddingVertical: 10, paddingHorizontal: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 34, height: 34, borderRadius: 17,
                        alignItems: "center", justifyContent: "center",
                        backgroundColor: used ? heatFill(intensity) : withAlpha("#ffffff", 0.06),
                        borderWidth: 1, borderColor: withAlpha("#0a141a", 0.35),
                      }}
                    >
                      <Text style={{ color: THEME.ink, fontWeight: "800", fontSize: 14 }}>{point}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: THEME.ink, fontWeight: "700", fontSize: 14 }}>
                        {t("injection.pointLabel", { n: point })}
                      </Text>
                      <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
                        {recencyPhrase(p?.lastUsedAt ?? null)}
                      </Text>
                    </View>
                    <Text style={{ color: used ? THEME.ink : THEME.muted, fontWeight: "800", fontSize: 17, minWidth: 22, textAlign: "right" }}>
                      {p?.count ?? 0}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ color: THEME.muted, fontSize: 11, textAlign: "center", lineHeight: 16, marginTop: 12 }}>
              {t("injection.pointNeutral")}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
