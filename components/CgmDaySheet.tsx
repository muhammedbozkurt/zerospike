import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { targetBandFor } from "../lib/agpChart";
import {
  DAY_BUCKET_MS,
  buildCurveModel,
  cgmWindowNeedsPro,
  freeRowsStartMs,
  localDayRange,
  rowFromLog,
  type CurveRow,
} from "../lib/cgm/curve";
import { getCgmWindowRows } from "../lib/db/cgmCurveSql";
import { formatGlucose, glucoseUnitLabel, inTargetBand } from "../lib/glucose";
import { formatDate, isolateLtr, pct } from "../lib/format";
import { SPACE } from "../lib/theme/tokens";
import { CgmCurve } from "./charts/CgmCurve";
import { SheetShell } from "./SheetShell";
import { Button, Txt } from "./ui";

/**
 * One day of sensor readings as a 24 hour curve (10 minute buckets). The last
 * 24 hours are free (a day that straddles the limit is cut to them); an older
 * day is a Pro view and shows the upgrade prompt in place of the curve.
 */
export function CgmDaySheet({
  dayKey,
  onClose,
}: {
  /** Local day (YYYY-MM-DD) to show; null keeps the sheet closed. */
  dayKey: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile, isProUser } = useApp();
  const [rows, setRows] = useState<CurveRow[]>([]);
  const range = useMemo(() => (dayKey ? localDayRange(dayKey) : null), [dayKey]);
  const locked = range != null && !isProUser && cgmWindowNeedsPro(range.hiMs, Date.now());
  const profileId = activeProfile?.id;

  useEffect(() => {
    if (!range || !profileId || locked) {
      setRows([]);
      return;
    }
    let alive = true;
    setRows([]);
    getCgmWindowRows(profileId, freeRowsStartMs(range.loMs, Date.now(), isProUser), range.hiMs - 1)
      .then((list) => {
        if (alive) setRows(list.map(rowFromLog).filter((r): r is CurveRow => r != null));
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [range, profileId, locked, isProUser]);

  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const band = useMemo(
    () => targetBandFor(activeProfile ?? {}),
    [activeProfile?.target_fasting_min, activeProfile?.target_postmeal_max, activeProfile?.hypo_threshold_mgdl]
  );
  const model = useMemo(
    () =>
      range
        ? buildCurveModel({
            rows,
            startMs: range.loMs,
            endMs: range.hiMs,
            bucketMs: DAY_BUCKET_MS,
          })
        : null,
    [rows, range]
  );

  const sensorRows = rows.filter((r) => r.isCgm);
  const count = sensorRows.length;
  const avg =
    count > 0 ? Math.round(sensorRows.reduce((s, r) => s + r.mgdl, 0) / count) : null;
  const inRange = sensorRows.filter((r) => inTargetBand(r.mgdl, band)).length;
  const title = range ? formatDate(new Date(range.loMs).toISOString()) : "";

  const summary =
    model && model.cgm.length > 0 && model.minMgdl != null && model.maxMgdl != null
      ? t("cgmCurve.daySummary", {
          count,
          min: formatGlucose(model.minMgdl, unit),
          max: formatGlucose(model.maxMgdl, unit),
          unit: glucoseUnitLabel(unit),
        })
      : t("cgmCurve.noWindowData");

  return (
    <SheetShell
      visible={dayKey != null}
      onClose={onClose}
      title={title}
      closeLabel={t("common.close")}
      scrollHintId="cgm-day"
    >
      {locked ? (
        <View>
          <Txt kind="caption" tone="muted" style={{ marginBottom: SPACE.md }}>
            {t("cgmCurve.proLock")}
          </Txt>
          <Button
            label={t("proCta.upgrade")}
            onPress={() => {
              onClose();
              router.push({ pathname: "/paywall", params: { reason: "cgmHistory" } });
            }}
          />
        </View>
      ) : (
        <View>
          <Txt kind="body" style={{ fontWeight: "700" }}>
            {t("cgmCurve.dayRow", { count })}
          </Txt>
          {avg != null ? (
            <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
              {t("cgmCurve.dayRowSub", {
                avg: isolateLtr(`${formatGlucose(avg, unit)} ${glucoseUnitLabel(unit)}`),
                share: isolateLtr(pct(Math.round((inRange / count) * 100))),
              })}
            </Txt>
          ) : null}
          {model && model.cgm.length > 0 ? (
            <View style={{ marginTop: SPACE.md }}>
              <CgmCurve model={model} unit={unit} band={band} height={190} summary={summary} />
            </View>
          ) : (
            <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.md }}>
              {t("cgmCurve.noWindowData")}
            </Txt>
          )}
          {model && model.manual.length > 0 ? (
            <Txt kind="micro" tone="muted" style={{ marginTop: SPACE.xs }}>
              {t("cgmCurve.manualLegend")}
            </Txt>
          ) : null}
        </View>
      )}
    </SheetShell>
  );
}
