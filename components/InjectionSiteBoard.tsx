import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { OverlayModal as Modal } from "./OverlayModal";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";

import type { Injection, InjectionSite, SitePoint } from "../lib/db/types";
import { SELECTABLE_SITES, SITE_POINTS, canonicalSite } from "../lib/db/types";
import type { PointUsage, SiteUsage } from "../lib/db/injections";
import { HIT_TARGET, RADIUS, SPACE, THEME, glow } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { withAlpha } from "./rich";
import { Button, Card, Txt } from "./ui";
import { SCRIM } from "./SheetShell";
import {
  bodyStops,
  INK_DARK,
  absorptionKey,
  daysSince,
  heatFill,
  recencyWeight,
  type PointSelection,
} from "./InjectionBodyMap";
import { hapticSelect } from "../lib/haptics";
import { formatDate, formatTime, num, relativeDay } from "../lib/format";
import { upper } from "../lib/upper";

/**
 * Region-first injection surface (replaces the full-body silhouette on the tab):
 * a grid of eight region cards, each showing the region's four rotation points
 * in the same heat language as the old map, plus a purely DESCRIPTIVE status
 * line (which region has gone unused the longest). Tapping a card opens a
 * detail sheet with full-size (44pt+) point rows, a small illustration of just
 * that region, and the region's own recent entries.
 *
 * Everything here is a picture of the user's OWN history: nothing tells the
 * user where to inject, a repeat point is annotated but never blocked, and the
 * "new cycle" stamp only changes what feeds the colours, never the log rows.
 */

/** The last stored injection, for the repeat-point annotation. */
export interface LastPointRecord {
  site: InjectionSite;
  point: SitePoint;
  loggedAt: string;
}

interface HeatModel {
  bySite: Map<InjectionSite, SiteUsage>;
  maxPointCount: number;
  total: number;
  /** Selectable region untouched the longest (never-used wins, canonical order). */
  longestUnused: InjectionSite | null;
}

function buildHeatModel(usage: SiteUsage[] | undefined): HeatModel {
  const bySite = new Map<InjectionSite, SiteUsage>();
  (usage ?? []).forEach((u) => bySite.set(u.site, u));
  const selectable = SELECTABLE_SITES.map((s) => bySite.get(s)).filter(
    (u): u is SiteUsage => u != null
  );
  const maxPointCount = Math.max(
    1,
    ...selectable.flatMap((u) => u.points.map((p) => p.count))
  );
  const total = selectable.reduce((sum, u) => sum + u.count, 0);

  // For "gone unused the longest", a retired quadrant counts as use of the region
  // that replaced it: both describe the same side of the navel, so a side injected
  // yesterday under its old name must not be reported as untouched. The region
  // cards keep showing their own entries only.
  const lastUsedFor = (site: InjectionSite): string | null => {
    let last = bySite.get(site)?.lastUsedAt ?? null;
    for (const u of usage ?? []) {
      if (u.site === site || canonicalSite(u.site) !== site) continue;
      if (u.lastUsedAt != null && (last == null || u.lastUsedAt > last)) {
        last = u.lastUsedAt;
      }
    }
    return last;
  };

  let longestUnused: InjectionSite | null = null;
  let oldest = "";
  for (const site of SELECTABLE_SITES) {
    const last = lastUsedFor(site);
    if (last == null) {
      longestUnused = site;
      break;
    }
    if (longestUnused == null || last < oldest) {
      longestUnused = site;
      oldest = last;
    }
  }
  return { bySite, maxPointCount, total, longestUnused };
}

/** Combined frequency + recency intensity, same weights as the old map. */
function pointIntensity(p: PointUsage | undefined, maxPointCount: number, now: number): number {
  if (!p || p.count === 0) return 0;
  const freq = p.count / maxPointCount;
  const recent = recencyWeight(p.lastUsedAt, now);
  return Math.min(1, freq * 0.65 + recent * 0.35);
}

/** The four points of a region as small heat dots (cards + selector grid). */
function RegionMiniDots({
  usage,
  maxPointCount,
  now,
}: {
  usage: SiteUsage | undefined;
  maxPointCount: number;
  now: number;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {SITE_POINTS.map((point) => {
        const p = usage?.points.find((x) => x.point === point);
        const used = (p?.count ?? 0) > 0;
        return (
          <View
            key={point}
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: used ? heatFill(pointIntensity(p, maxPointCount, now)) : THEME.track,
              borderWidth: 1,
              borderColor: withAlpha(INK_DARK, 0.5),
            }}
          />
        );
      })}
    </View>
  );
}

/* ── Region illustration ───────────────────────────────────────────────────
 *
 * A small, simple drawing of ONE region (no full body): enough shape to orient
 * the user, with the four points rendered in their heat colours. Decorative;
 * selection happens on the full-size rows below it. */

interface IlloSpec {
  w: number;
  h: number;
  shape: string;
  /** Extra hint strokes (navel + midline for the abdomen halves). */
  extras?: { navel: [number, number]; midline: [number, number, number] } | null;
  pts: { x: number; y: number }[];
}

function illoSpec(site: InjectionSite): IlloSpec {
  if (site === "abdomen_left") {
    return {
      w: 120,
      h: 84,
      shape: "M 112 8 C 62 8 20 24 14 42 C 20 60 62 76 112 76 L 112 8 Z",
      extras: { navel: [104, 42], midline: [112, 8, 76] },
      pts: [28, 50, 72, 94].map((x) => ({ x, y: 42 })),
    };
  }
  if (site === "abdomen_right") {
    return {
      w: 120,
      h: 84,
      shape: "M 8 8 C 58 8 100 24 106 42 C 100 60 58 76 8 76 L 8 8 Z",
      extras: { navel: [16, 42], midline: [8, 8, 76] },
      pts: [26, 48, 70, 92].map((x) => ({ x, y: 42 })),
    };
  }
  if (site.startsWith("thigh")) {
    return {
      w: 84,
      h: 120,
      shape:
        "M 26 10 C 18 42 20 82 32 112 C 40 118 52 118 58 110 C 66 78 64 38 56 10 C 46 4 34 4 26 10 Z",
      pts: [26, 50, 74, 98].map((y) => ({ x: 42, y })),
    };
  }
  if (site.startsWith("arm")) {
    return {
      w: 84,
      h: 120,
      shape:
        "M 28 12 C 30 4 54 4 58 14 C 60 40 58 78 52 106 C 48 114 38 114 34 106 C 28 76 26 40 28 12 Z",
      pts: [26, 50, 74, 98].map((y) => ({ x: 43, y })),
    };
  }
  // Buttock: one rounded mound, points in a single horizontal row (like the abdomen).
  return {
    w: 120,
    h: 84,
    shape:
      "M 14 36 C 14 16 36 8 60 8 C 84 8 106 16 106 36 C 106 60 84 76 60 76 C 36 76 14 60 14 36 Z",
    pts: [27, 49, 71, 93].map((x) => ({ x, y: 42 })),
  };
}

function RegionIllustration({
  site,
  usage,
  maxPointCount,
  now,
  selected,
  lastRecord,
}: {
  site: InjectionSite;
  usage: SiteUsage | undefined;
  maxPointCount: number;
  now: number;
  selected: PointSelection | null;
  lastRecord?: LastPointRecord | null;
}) {
  const spec = illoSpec(site);
  const gradId = `illoGrad_${site}`;
  const scale = spec.h > spec.w ? 108 / spec.h : 132 / spec.w;
  return (
    <Svg
      width={Math.round(spec.w * scale)}
      height={Math.round(spec.h * scale)}
      viewBox={`0 0 ${spec.w} ${spec.h}`}
    >
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bodyStops().top} />
          <Stop offset="1" stopColor={bodyStops().bottom} />
        </LinearGradient>
      </Defs>
      <Path
        d={spec.shape}
        fill={`url(#${gradId})`}
        stroke={THEME.border}
        strokeWidth={1.4}
      />
      {spec.extras ? (
        <>
          <Path
            d={`M ${spec.extras.midline[0]} ${spec.extras.midline[1]} L ${spec.extras.midline[0]} ${spec.extras.midline[2]}`}
            stroke={withAlpha(INK_DARK, 0.18)}
            strokeWidth={1}
            strokeDasharray="2 5"
          />
          <Circle
            cx={spec.extras.navel[0]}
            cy={spec.extras.navel[1]}
            r={2.4}
            fill={withAlpha(INK_DARK, 0.3)}
          />
        </>
      ) : null}
      {SITE_POINTS.map((point, i) => {
        const p = usage?.points.find((x) => x.point === point);
        const used = (p?.count ?? 0) > 0;
        const on = selected?.site === site && selected.point === point;
        const isLast = lastRecord?.site === site && lastRecord.point === point;
        const { x, y } = spec.pts[i];
        return (
          <React.Fragment key={point}>
            {isLast ? (
              <Circle
                cx={x}
                cy={y}
                r={11}
                fill="none"
                stroke={THEME.accent}
                strokeWidth={1.2}
                strokeDasharray="3 3"
              />
            ) : null}
            <Circle
              cx={x}
              cy={y}
              r={8}
              fill={used ? heatFill(pointIntensity(p, maxPointCount, now)) : THEME.track}
              stroke={on ? THEME.accent : withAlpha(INK_DARK, 0.5)}
              strokeWidth={on ? 1.9 : 1.1}
            />
            <SvgText
              x={x}
              y={y + 3}
              fontSize={8}
              fontWeight="bold"
              fill={INK_DARK}
              textAnchor="middle"
            >
              {String(point)}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

/* ── Full-size point rows (44pt+ touch targets) ───────────────────────────── */

function PointRows({
  site,
  usage,
  maxPointCount,
  now,
  selectedPoint,
  lastRecord,
  onPick,
}: {
  site: InjectionSite;
  usage: SiteUsage | undefined;
  maxPointCount: number;
  now: number;
  selectedPoint: SitePoint | null;
  lastRecord?: LastPointRecord | null;
  onPick: (point: SitePoint) => void;
}) {
  const { t } = useTranslation();
  function recencyPhrase(lastUsedAt: string | null): string {
    const d = daysSince(lastUsedAt, now);
    if (d == null) return t("injection.usedNever");
    if (d === 0) return t("injection.usedToday");
    return t("injection.daysAgo", { n: d });
  }
  return (
    <View style={{ gap: SPACE.sm }}>
      {SITE_POINTS.map((point) => {
        const p = usage?.points.find((x) => x.point === point);
        const on = selectedPoint === point;
        const isLast = lastRecord?.site === site && lastRecord.point === point;
        const used = (p?.count ?? 0) > 0;
        return (
          <Pressable
            key={point}
            onPress={() => onPick(point)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${t("injection.siteWithPoint", {
              site: t(`injectionSite.${site}`),
              n: point,
            })} · ${recencyPhrase(p?.lastUsedAt ?? null)}`}
            android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACE.md,
              minHeight: HIT_TARGET,
              borderRadius: RADIUS.lg,
              borderWidth: on ? 1.6 : 1,
              borderColor: on ? THEME.accent : THEME.border,
              backgroundColor: on ? THEME.surfaceInset : THEME.surface,
              paddingVertical: SPACE.md,
              paddingHorizontal: SPACE.md,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: used
                  ? heatFill(pointIntensity(p, maxPointCount, now))
                  : THEME.surfaceInset,
                borderWidth: 1,
                borderColor: withAlpha(INK_DARK, 0.35),
              }}
            >
              <Txt kind="caption" tabular style={{ fontWeight: "800" }}>
                {point}
              </Txt>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
                <Txt numberOfLines={1} style={{ fontWeight: "700", flexShrink: 1, minWidth: 0 }}>
                  {t("injection.pointLabel", { n: point })}
                </Txt>
                {isLast ? (
                  <View
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: SPACE.sm,
                      paddingVertical: SPACE.xs / 2,
                      backgroundColor: withAlpha(THEME.accent, 0.14),
                      borderWidth: 1,
                      borderColor: withAlpha(THEME.accent, 0.35),
                    }}
                  >
                    <Txt kind="micro" tone="accent" style={{ fontWeight: "800" }}>
                      {t("injection.lastPointBadge")}
                    </Txt>
                  </View>
                ) : null}
              </View>
              <Txt
                kind="micro"
                tone="muted"
                numberOfLines={1}
                style={{ marginTop: SPACE.xs / 2 }}
              >
                {recencyPhrase(p?.lastUsedAt ?? null)}
              </Txt>
            </View>
            <Txt
              kind="subtitle"
              tone={used ? "text" : "muted"}
              tabular
              style={{ fontWeight: "800", minWidth: 22, textAlign: "right" }}
            >
              {p?.count ?? 0}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── The main tab surface ─────────────────────────────────────────────────── */

export function InjectionSiteBoard({
  usage,
  selected,
  onSelect,
  windowDays = 30,
  cycleStart,
  onStartNewCycle,
  lastRecord,
  recent,
  legacyCount = 0,
  legacyLastUsedAt = null,
  noSiteCount = 0,
}: {
  usage: SiteUsage[];
  selected: PointSelection | null;
  onSelect: (selection: PointSelection) => void;
  windowDays?: number;
  /** Profile's rotation-cycle stamp (lib/rotationCycle), if one was started. */
  cycleStart?: string | null;
  /** Opens the parent's confirm dialog and stamps a new cycle. */
  onStartNewCycle?: () => void;
  /** The newest stored injection with a point, for the repeat annotation. */
  lastRecord?: LastPointRecord | null;
  /** Recent history (any region); the detail sheet filters its own region. */
  recent?: Injection[];
  /** Entries in the retired abdomen quadrants: no card of their own (the map does
   *  not offer those regions any more) but still the user's own history, so they
   *  are reported as one legacy total instead of disappearing. */
  legacyCount?: number;
  legacyLastUsedAt?: string | null;
  /** Entries logged with no region at all (a calculator mealtime bolus). */
  noSiteCount?: number;
}) {
  const { t } = useTranslation();
  const { height: winH } = useWindowDimensions();
  const [openRegion, setOpenRegion] = useState<InjectionSite | null>(null);
  const now = Date.now();

  const model = useMemo(() => buildHeatModel(usage), [usage]);

  const dateLabels = useMemo(
    () => ({ today: t("common.today"), yesterday: t("common.yesterday") }),
    [t]
  );

  function recencyPhrase(lastUsedAt: string | null): string {
    const d = daysSince(lastUsedAt, now);
    if (d == null) return t("injection.usedNever");
    if (d === 0) return t("injection.usedToday");
    return t("injection.daysAgo", { n: d });
  }

  function choose(site: InjectionSite, point: SitePoint) {
    hapticSelect();
    onSelect({ site, point });
    setOpenRegion(null);
  }

  const openUsage = openRegion ? model.bySite.get(openRegion) : undefined;
  const recentForOpen =
    openRegion && recent ? recent.filter((r) => r.site === openRegion).slice(0, 5) : [];
  const unitLetter = t("common.unitsShort");

  // Everything logged in the window, including the entries no region card shows:
  // with only legacy-quadrant or region-less rows the board used to claim the
  // history was empty.
  const loggedTotal = model.total + legacyCount + noSiteCount;

  const stripText =
    loggedTotal > 0 && model.longestUnused
      ? t("injection.longestUnusedRegion", {
          site: t(`injectionSite.${model.longestUnused}`),
        })
      : t("injection.mapEmptyPrompt");

  return (
    <View>
      {/* Status strip: one purely descriptive line, no instruction. */}
      <Card style={{ marginBottom: SPACE.md, flexDirection: "row", alignItems: "center" }}>
        <Ionicons name="time-outline" size={15} color={THEME.accent} />
        <Txt
          kind="caption"
          numberOfLines={2}
          style={{ fontWeight: "700", marginLeft: SPACE.sm, flex: 1, minWidth: 0 }}
        >
          {stripText}
        </Txt>
      </Card>

      {/* Eight region cards, two per row. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.md }}>
        {SELECTABLE_SITES.map((site) => {
          const u = model.bySite.get(site);
          const count = u?.count ?? 0;
          const isSelected = selected?.site === site;
          const isLongestUnused = loggedTotal > 0 && model.longestUnused === site;
          return (
            <Pressable
              key={site}
              onPress={() => {
                hapticSelect();
                setOpenRegion(site);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t(`injectionSite.${site}`)} · ${
                count > 0 ? recencyPhrase(u?.lastUsedAt ?? null) : t("injection.usedNever")
              }`}
              className="active:opacity-80"
              style={{ flexBasis: "47%", flexGrow: 1 }}
            >
              <Card
                style={[
                  { minHeight: 92 },
                  isSelected
                    ? { borderColor: withAlpha(THEME.accent, 0.6) }
                    : isLongestUnused
                      ? { borderColor: withAlpha(THEME.accent, 0.45), borderStyle: "dashed" }
                      : null,
                  isSelected ? glow(THEME.accent, 14, 0.3) : null,
                ]}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Txt
                    kind="caption"
                    numberOfLines={1}
                    style={{ fontWeight: "700", flex: 1, minWidth: 0 }}
                  >
                    {t(`injectionSite.${site}`)}
                  </Txt>
                  {count > 0 ? (
                    <Txt kind="micro" tone="muted" tabular style={{ fontWeight: "800" }}>
                      {count}
                    </Txt>
                  ) : null}
                </View>
                <View style={{ marginTop: SPACE.md }}>
                  <RegionMiniDots usage={u} maxPointCount={model.maxPointCount} now={now} />
                </View>
                {/* Before any log exists every card would repeat the same "never
                    used" line eight times; the status strip above already says
                    it once, so the per-card caption only appears once real usage
                    exists. */}
                {loggedTotal > 0 ? (
                  <Txt kind="micro" tone="muted" numberOfLines={1} style={{ marginTop: SPACE.sm }}>
                    {count > 0 ? recencyPhrase(u?.lastUsedAt ?? null) : t("injection.usedNever")}
                  </Txt>
                ) : null}
              </Card>
            </Pressable>
          );
        })}
      </View>

      {/* Cycle row: window / cycle stamp on the left, "new cycle" on the right. */}
      <Card style={{ marginTop: SPACE.md, flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, minWidth: 0, marginRight: SPACE.sm }}>
          <Txt kind="micro" tone="muted" numberOfLines={2}>
            {cycleStart
              ? t("injection.cycleSince", { date: formatDate(cycleStart) })
              : t("injection.usageWindow", { n: windowDays })}
          </Txt>
        </View>
        {onStartNewCycle ? (
          <Button
            label={t("injection.newCycle")}
            variant="outlined"
            size="sm"
            onPress={onStartNewCycle}
            icon={<Ionicons name="refresh-outline" size={13} color={THEME.accent} />}
            className="flex-shrink"
          />
        ) : null}
      </Card>

      {/* History that belongs to no card above: retired regions as one legacy
          total, and doses recorded without a region. Descriptive counts only. */}
      {legacyCount > 0 || noSiteCount > 0 ? (
        <Card style={{ marginTop: SPACE.md, gap: SPACE.xs }}>
          {legacyCount > 0 ? (
            <Txt kind="micro" tone="muted">
              {t("injection.legacyRegions", { n: legacyCount })}
              {legacyLastUsedAt ? ` · ${recencyPhrase(legacyLastUsedAt)}` : ""}
            </Txt>
          ) : null}
          {noSiteCount > 0 ? (
            <Txt kind="micro" tone="muted">
              {t("injection.noRegionCount", { n: noSiteCount })}
            </Txt>
          ) : null}
        </Card>
      ) : null}

      {/* Same card language as every block above it, so the screen doesn't end
          on a bare line floating over the background. */}
      <Card style={{ marginTop: SPACE.md }}>
        <Txt kind="micro" tone="muted" style={{ textAlign: "center" }}>
          {t("injection.pointNeutral")}
        </Txt>
      </Card>

      {/* Region detail: illustration + full-size point rows + the region's log. */}
      <Modal
        visible={openRegion != null}
        transparent
        animationType="slide"
        onRequestClose={() => setOpenRegion(null)}
      >
        <Pressable
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: SCRIM }}
          onPress={() => setOpenRegion(null)}
          accessible={false}
          focusable={false}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
            style={[
              {
                maxHeight: Math.round(winH * 0.86),
                borderTopLeftRadius: 26,
                borderTopRightRadius: 26,
                borderTopWidth: 1,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.bg.g1,
                paddingHorizontal: SPACE.lg,
                paddingTop: 8,
              },
              glow(THEME.accent, 30, 0.3),
            ]}
          >
            <View className="items-center mb-1.5">
              <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt kind="subtitle">{openRegion ? t(`injectionSite.${openRegion}`) : ""}</Txt>
                <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs / 2 }}>
                  {t("injection.selectPoint")}
                </Txt>
              </View>
              <Pressable
                onPress={() => setOpenRegion(null)}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                hitSlop={12}
                className="p-1"
              >
                <Ionicons name="close" size={22} color={THEME.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 28 }}
            >
              {openRegion ? (
                <View
                  style={{
                    alignSelf: "flex-start",
                    marginTop: SPACE.sm,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACE.sm,
                    paddingVertical: SPACE.xs,
                    paddingHorizontal: SPACE.md,
                    borderRadius: 999,
                    backgroundColor: withAlpha(THEME.accent, 0.12),
                    borderWidth: 1,
                    borderColor: withAlpha(THEME.accent, 0.3),
                  }}
                >
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.accent }} />
                  <Txt kind="micro" tone="accent" style={{ flexShrink: 1, minWidth: 0 }}>
                    {t(absorptionKey(openRegion))}
                  </Txt>
                </View>
              ) : null}

              {openRegion ? (
                <View style={{ alignItems: "center", marginTop: SPACE.md }}>
                  <RegionIllustration
                    site={openRegion}
                    usage={openUsage}
                    maxPointCount={model.maxPointCount}
                    now={now}
                    selected={selected}
                    lastRecord={lastRecord}
                  />
                </View>
              ) : null}

              <View style={{ marginTop: SPACE.lg }}>
                {openRegion ? (
                  <PointRows
                    site={openRegion}
                    usage={openUsage}
                    maxPointCount={model.maxPointCount}
                    now={now}
                    selectedPoint={selected?.site === openRegion ? selected.point : null}
                    lastRecord={lastRecord}
                    onPick={(point) => openRegion && choose(openRegion, point)}
                  />
                ) : null}
              </View>

              {/* The region's own recent entries: log excerpt, nothing more. */}
              <Txt
                kind="micro"
                tone="muted"
                style={{ letterSpacing: 1.1, fontWeight: "800", marginTop: SPACE.xl, marginBottom: SPACE.sm }}
              >
                {upper(t("injection.regionRecent"))}
              </Txt>
              {recentForOpen.length === 0 ? (
                <Txt kind="caption" tone="muted">
                  {t("injection.regionNoRecords")}
                </Txt>
              ) : (
                <View style={{ gap: SPACE.sm }}>
                  {recentForOpen.map((inj) => (
                    <View
                      key={inj.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        borderRadius: RADIUS.md,
                        borderWidth: 1,
                        borderColor: THEME.border,
                        backgroundColor: THEME.surface,
                        paddingHorizontal: SPACE.md,
                        paddingVertical: SPACE.sm,
                      }}
                    >
                      <Txt kind="micro" tone="muted" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                        {relativeDay(inj.logged_at, dateLabels)} · {formatTime(inj.logged_at)}
                      </Txt>
                      <Txt kind="caption" tabular style={{ fontWeight: "700", flexShrink: 1, textAlign: "right" }}>
                        {inj.dose_units != null ? `${num(inj.dose_units)} ${unitLetter}` : "-"}
                        {inj.site_point != null
                          ? ` · ${t("injection.pointLabel", { n: inj.site_point })}`
                          : ""}
                      </Txt>
                    </View>
                  ))}
                </View>
              )}

              <Txt kind="micro" tone="muted" style={{ textAlign: "center", marginTop: SPACE.lg }}>
                {t("injection.pointNeutral")}
              </Txt>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ── Inline region + point selector (edit sheet) ──────────────────────────── */

/**
 * Compact form of the same surface for the edit sheet: the region cards as a
 * selectable grid and the active region's four full-size point rows. Usage heat
 * is optional; without data the dots render neutral.
 */
export function SitePointSelector({
  usage,
  site,
  point,
  onChange,
  allowClearPoint = false,
  style,
}: {
  usage?: SiteUsage[];
  site: InjectionSite;
  point: SitePoint | null;
  onChange: (site: InjectionSite, point: SitePoint | null) => void;
  /** Tapping the active point clears it (pre-v8 rows genuinely have none). */
  allowClearPoint?: boolean;
  style?: object;
}) {
  const { t } = useTranslation();
  const now = Date.now();
  const model = useMemo(() => buildHeatModel(usage), [usage]);

  return (
    <View style={style}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
        {SELECTABLE_SITES.map((s) => {
          const on = site === s;
          return (
            <Pressable
              key={s}
              onPress={() => {
                hapticSelect();
                onChange(s, point);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t(`injectionSite.${s}`)}
              android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
              style={[
                {
                  minHeight: HIT_TARGET,
                  flexBasis: "48%",
                  flexGrow: 1,
                  borderRadius: RADIUS.md,
                  borderWidth: 1,
                  borderColor: on ? THEME.accent : THEME.border,
                  backgroundColor: on ? withAlpha(THEME.accent, 0.12) : THEME.surface,
                  paddingHorizontal: SPACE.md,
                  paddingVertical: SPACE.sm,
                },
                on ? glow(THEME.accent, 12, 0.35) : null,
              ]}
            >
              <Txt
                kind="caption"
                tone={on ? "accent" : "muted"}
                numberOfLines={1}
                style={{ fontWeight: on ? "800" : "600" }}
              >
                {t(`injectionSite.${s}`)}
              </Txt>
              <View style={{ marginTop: SPACE.sm }}>
                <RegionMiniDots
                  usage={model.bySite.get(s)}
                  maxPointCount={model.maxPointCount}
                  now={now}
                />
              </View>
            </Pressable>
          );
        })}
      </View>

      <Txt
        kind="caption"
        tone="muted"
        style={{ fontWeight: "700", marginTop: SPACE.md, marginBottom: SPACE.sm }}
      >
        {t("injection.selectPoint")}
      </Txt>
      <PointRows
        site={site}
        usage={model.bySite.get(site)}
        maxPointCount={model.maxPointCount}
        now={now}
        selectedPoint={point}
        onPick={(p) => {
          hapticSelect();
          onChange(site, allowClearPoint && point === p ? null : p);
        }}
      />
    </View>
  );
}
