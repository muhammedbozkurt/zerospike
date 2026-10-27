import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { UserProfile } from "../lib/db/types";
import { targetBandFor } from "../lib/agpChart";
import {
  CURVE_HOURS,
  buildCurveModel,
  cgmAgeLabel,
  type CurveHours,
} from "../lib/cgm/curve";
import { cgmTrend, type CgmTrend } from "../lib/cgm/trend";
import type { CgmMode } from "../lib/cgm/state";
import { cgmHomeState, todayRangeShare } from "../lib/homeEmpty";
import { useCgmHours, useCgmWindow } from "../lib/useCgmWindow";
import {
  classifyGlucose,
  formatGlucose,
  glucoseUnitLabel,
  statusLabelKey,
} from "../lib/glucose";
import { formatTime, isolateLtr, pct } from "../lib/format";
import { upper } from "../lib/upper";
import { RICH_BY_STATUS, SPACE, THEME } from "../lib/theme/tokens";
import { CgmCurve } from "./charts/CgmCurve";
import { GlucoseChip, GlucoseRing } from "./rich";
import { SourceBadge } from "./SourceBadge";
import { Card, Segmented, Txt } from "./ui";

const TREND_ROTATION: Record<CgmTrend, number> = {
  up2: -90,
  up: -90,
  up45: -45,
  flat: 0,
  down45: 45,
  down: 90,
  down2: 90,
};

/** The direction of the last readings as an arrow. Descriptive: one neutral
 *  colour for every direction, no level, no threshold. */
function TrendArrow({ trend, label }: { trend: CgmTrend; label: string }) {
  const count = trend === "up2" || trend === "down2" ? 2 : 1;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center" }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Ionicons
          key={i}
          name="arrow-forward"
          size={16}
          color={THEME.textMuted}
          style={{
            transform: [{ rotate: `${TREND_ROTATION[trend]}deg` }],
            marginStart: i === 0 ? 0 : -6,
          }}
        />
      ))}
    </View>
  );
}

/** "4 min ago", re-evaluated every minute inside this small leaf so the curve
 *  and the ring above it are not redrawn by the clock. */
function CgmAge({ atMs }: { atMs: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [atMs]);
  return (
    <>
      {cgmAgeLabel(atMs, now, {
        hourShort: t("widget.hourShort"),
        minuteShort: t("widget.minuteShort"),
        agoTemplate: t("widget.agoTemplate"),
      })}
    </>
  );
}

/**
 * The home hero for a profile that reads from a sensor: today's ring (the share
 * of today's sensor readings inside the target band), the curve with its 3 / 6
 * / 12 hour choice, the last reading with its age and direction, the source
 * badge, and the note that readings can arrive late. Rendered ONLY when the
 * profile's mode is not manual (see app/(tabs)/index.tsx); a manual profile's
 * home is unchanged.
 */
export function CgmHomeCard({
  profile,
  mode,
  dataVersion,
}: {
  profile: UserProfile;
  mode: CgmMode;
  dataVersion: number;
}) {
  const { t } = useTranslation();
  const unit = profile.glucose_unit ?? "mgdl";
  const band = useMemo(
    () => targetBandFor(profile),
    [profile.target_fasting_min, profile.target_postmeal_max, profile.hypo_threshold_mgdl]
  );
  const [hours, setHours] = useCgmHours(profile.id);
  const win = useCgmWindow({ profileId: profile.id, enabled: true, hours, band, dataVersion });

  const model = useMemo(
    () => buildCurveModel({ rows: win.rows, startMs: win.startMs, endMs: win.endMs }),
    [win.rows, win.startMs, win.endMs]
  );
  const state = cgmHomeState({
    loaded: win.loaded,
    latestAtMs: win.latest?.atMs ?? null,
    windowPoints: model.cgm.length + model.manual.length,
  });
  const trend = useMemo(
    () => (win.latest ? cgmTrend(win.trendReadings, win.nowMs) : null),
    [win.latest, win.trendReadings, win.nowMs]
  );

  const todayAvg = win.today.avgMgdl;
  const status = todayAvg != null ? classifyGlucose(todayAvg, "manual", profile) : null;
  const color = status ? RICH_BY_STATUS[status] : THEME.textMuted;
  const share = todayRangeShare(win.today.count, win.today.inRange);

  const unitLabel = glucoseUnitLabel(unit);
  const summary =
    model.cgm.length > 0 && model.minMgdl != null && model.maxMgdl != null && model.last
      ? t("cgmCurve.summary", {
          count: model.cgm.length,
          min: formatGlucose(model.minMgdl, unit),
          max: formatGlucose(model.maxMgdl, unit),
          last: formatGlucose(model.last.mgdl, unit),
          unit: unitLabel,
          time: formatTime(new Date(model.last.t).toISOString()),
        })
      : t("cgmCurve.noWindowData");

  // Holds the card's height while the first read lands, so the list below does
  // not jump.
  if (state === "loading") return <Card style={{ marginBottom: SPACE.md, minHeight: 320 }} />;

  return (
    <Card glow={color} style={{ marginBottom: SPACE.md }}>
      <View className="flex-row items-center justify-between px-1 mb-1">
        <Txt
          kind="micro"
          tone="muted"
          numberOfLines={1}
          style={{ letterSpacing: 1.3, fontWeight: "700", flexShrink: 1 }}
        >
          {upper(t("dashboard.todayAvgLabel"))}
        </Txt>
        {status ? (
          <GlucoseChip status={status} label={t(statusLabelKey(status))} />
        ) : null}
      </View>
      <View className="items-center">
        <GlucoseRing
          value={todayAvg ?? undefined}
          display={todayAvg != null ? formatGlucose(todayAvg, unit) : "-"}
          caption={
            todayAvg != null
              ? t("dashboard.todayReadingCount", { count: win.today.count })
              : t("dashboard.todayNoReading")
          }
          color={color}
          gradientTo={todayAvg != null ? undefined : THEME.textMuted}
          fraction={share != null ? share / 100 : 0}
          size={152}
        />
      </View>
      {share != null ? (
        <Txt
          kind="caption"
          tone="muted"
          style={{ textAlign: "center", marginTop: SPACE.md, paddingHorizontal: SPACE.sm }}
        >
          {t("dashboard.ringShareLine", { share: isolateLtr(pct(share)) })}
        </Txt>
      ) : null}

      {state === "waiting" ? (
        <View style={{ marginTop: SPACE.lg }}>
          <Txt kind="body" style={{ fontWeight: "700", textAlign: "center" }}>
            {t("cgmHome.waiting")}
          </Txt>
          <Txt
            kind="caption"
            tone="muted"
            style={{ textAlign: "center", marginTop: SPACE.xs }}
          >
            {t("cgmHome.waitingBody")}
          </Txt>
        </View>
      ) : (
        <View style={{ marginTop: SPACE.lg }}>
          <Segmented<string>
            options={CURVE_HOURS.map((h) => ({
              value: String(h),
              label: t("cgmCurve.hours", { n: h }),
            }))}
            value={String(hours)}
            onChange={(v) => setHours(Number(v) as CurveHours)}
          />
          <View style={{ marginTop: SPACE.sm }}>
            {state === "data" ? (
              <CgmCurve model={model} unit={unit} band={band} summary={summary} />
            ) : (
              <Txt
                kind="caption"
                tone="muted"
                style={{ textAlign: "center", paddingVertical: SPACE.xl }}
              >
                {t("cgmCurve.noWindowData")}
              </Txt>
            )}
          </View>
          {model.manual.length > 0 ? (
            <Txt kind="micro" tone="muted" style={{ marginTop: SPACE.xs }}>
              {t("cgmCurve.manualLegend")}
            </Txt>
          ) : null}
        </View>
      )}

      {win.latest ? (
        <View style={{ marginTop: SPACE.md }}>
          <View
            className="flex-row items-center"
            style={{ gap: SPACE.sm, flexWrap: "wrap" }}
          >
            <Txt kind="caption" tone="muted" style={{ flexShrink: 1 }}>
              {t("dashboard.lastReadingLine", {
                summary: isolateLtr(
                  `${formatGlucose(win.latest.mgdl, unit)} ${unitLabel}`
                ),
              })}
              {" · "}
              <CgmAge atMs={win.latest.atMs} />
            </Txt>
            {trend ? <TrendArrow trend={trend} label={t(`cgmCurve.trend.${trend}`)} /> : null}
            <SourceBadge
              source={mode === "nightscout" ? "nightscout" : "health"}
              isCgm
              withStore
            />
          </View>
        </View>
      ) : null}

      <Txt kind="micro" tone="muted" style={{ marginTop: SPACE.sm }}>
        {t("cgmSource.delayNote")}
      </Txt>
    </Card>
  );
}
