import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CURVE_BUCKET_MS,
  DEFAULT_CURVE_HOURS,
  HOUR_MS,
  parseCurveHours,
  rowFromLog,
  type CurveHours,
  type CurveRow,
} from "./cgm/curve";
import { subscribeCgmChanges } from "./cgm/importEvents";
import { getCgmMode, type CgmMode } from "./cgm/state";
import {
  getCgmDaySummaries,
  getCgmLatest,
  getCgmRangeStats,
  getCgmWindowRows,
  type CgmDaySummary,
  type CgmRangeStats,
} from "./db/cgmCurveSql";
import type { TargetBand } from "./agpChart";

/** Per-profile AsyncStorage base (`<base>.<profileId>`, lib/profileScopedKeys.ts). */
export const CGM_CURVE_HOURS_KEY = "zerospike.cgmCurveHours";

/** The sensor items refresh on their own this often while the screen is up. */
const REFRESH_MS = 2 * 60 * 1000;

const EMPTY_STATS: CgmRangeStats = { count: 0, avgMgdl: null, inRange: 0 };

/** The profile's data mode, kept current when the user changes it elsewhere. */
export function useCgmMode(profileId: string | undefined): { mode: CgmMode; ready: boolean } {
  const [state, setState] = useState<{ mode: CgmMode; ready: boolean; id?: string }>({
    mode: "manual",
    ready: false,
  });
  useEffect(() => {
    if (!profileId) {
      setState({ mode: "manual", ready: true });
      return;
    }
    let alive = true;
    const read = () =>
      void getCgmMode(profileId).then((mode) => {
        if (alive) setState({ mode, ready: true, id: profileId });
      });
    read();
    const off = subscribeCgmChanges((change) => {
      if (change.profileId === profileId && (change.kind === "mode" || change.kind === "clear")) {
        read();
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [profileId]);
  // A different profile must not inherit the previous one's mode while its own
  // read is in flight.
  if (profileId && state.id !== profileId) return { mode: "manual", ready: false };
  return { mode: state.mode, ready: state.ready };
}

/** The window length last chosen on this profile's curve (default 6 hours). */
export function useCgmHours(profileId: string | undefined): [CurveHours, (h: CurveHours) => void] {
  const [hours, setHours] = useState<CurveHours>(DEFAULT_CURVE_HOURS);
  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    AsyncStorage.getItem(`${CGM_CURVE_HOURS_KEY}.${profileId}`)
      .then((raw) => {
        if (alive) setHours(parseCurveHours(raw));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [profileId]);
  const choose = useCallback(
    (next: CurveHours) => {
      setHours(next);
      if (profileId) {
        AsyncStorage.setItem(`${CGM_CURVE_HOURS_KEY}.${profileId}`, String(next)).catch(() => {});
      }
    },
    [profileId]
  );
  return [hours, choose];
}

export interface CgmWindow {
  loaded: boolean;
  nowMs: number;
  startMs: number;
  endMs: number;
  rows: CurveRow[];
  /** Newest sensor reading, whatever its age. */
  latest: { atMs: number; mgdl: number } | null;
  /** The few newest sensor readings, for the direction arrow. */
  trendReadings: { at: number; mgdl: number }[];
  today: CgmRangeStats;
  week: CgmRangeStats;
}

const NOT_LOADED: CgmWindow = {
  loaded: false,
  nowMs: 0,
  startMs: 0,
  endMs: 0,
  rows: [],
  latest: null,
  trendReadings: [],
  today: EMPTY_STATS,
  week: EMPTY_STATS,
};

/**
 * The sensor data behind the home curve and ring: the window's rows, the newest
 * readings, today's and the week's totals. Four small indexed reads, issued
 * together and refreshed on an import, a mode change, a data change and a slow
 * timer. Free accounts only ever ask for 3, 6 or 12 hours, all inside the free
 * 24 hours, so no Pro check is needed here.
 */
export function useCgmWindow(input: {
  profileId: string | undefined;
  enabled: boolean;
  hours: CurveHours;
  band: TargetBand;
  dataVersion: number;
}): CgmWindow {
  const { profileId, enabled, hours, band, dataVersion } = input;
  const [data, setData] = useState<CgmWindow>(NOT_LOADED);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!profileId || !enabled) return;
    const off = subscribeCgmChanges((change) => {
      if (change.profileId === profileId) setTick((n) => n + 1);
    });
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [profileId, enabled]);

  useEffect(() => {
    if (!profileId || !enabled) {
      setData(NOT_LOADED);
      return;
    }
    const mine = ++seq.current;
    const nowMs = Date.now();
    const endMs = nowMs;
    // Aligned to the bucket grid so the first bucket is never a sliver.
    const startMs = Math.ceil((nowMs - hours * HOUR_MS) / CURVE_BUCKET_MS) * CURVE_BUCKET_MS;
    const dayStart = new Date(nowMs);
    dayStart.setHours(0, 0, 0, 0);
    void Promise.all([
      getCgmWindowRows(profileId, startMs, endMs),
      getCgmLatest(profileId),
      getCgmRangeStats(profileId, band, dayStart.getTime(), nowMs + 60_000),
      getCgmRangeStats(profileId, band, nowMs - 7 * 24 * HOUR_MS, nowMs + 60_000),
    ])
      .then(([windowRows, latestRows, today, week]) => {
        if (mine !== seq.current) return;
        const rows = windowRows
          .map(rowFromLog)
          .filter((r): r is CurveRow => r != null);
        const newest = latestRows[0];
        const latestAt = newest ? Date.parse(newest.logged_at) : NaN;
        setData({
          loaded: true,
          nowMs,
          startMs,
          endMs,
          rows,
          latest: newest && Number.isFinite(latestAt)
            ? { atMs: latestAt, mgdl: newest.glucose_level_mgdl }
            : null,
          trendReadings: latestRows
            .map((r) => ({ at: Date.parse(r.logged_at), mgdl: r.glucose_level_mgdl }))
            .filter((r) => Number.isFinite(r.at)),
          today,
          week,
        });
      })
      .catch(() => {
        if (mine === seq.current) setData((prev) => ({ ...prev, loaded: true }));
      });
  }, [profileId, enabled, hours, band.low, band.high, dataVersion, tick]);

  return data;
}

/** Per-day summary rows for the journal lists, newest first. */
export function useCgmDaySummaries(input: {
  profileId: string | undefined;
  enabled: boolean;
  band: TargetBand;
  dayCount: number;
  dataVersion: number;
}): CgmDaySummary[] {
  const { profileId, enabled, band, dayCount, dataVersion } = input;
  const [days, setDays] = useState<CgmDaySummary[]>([]);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!profileId || !enabled) return;
    return subscribeCgmChanges((change) => {
      if (change.profileId === profileId) setTick((n) => n + 1);
    });
  }, [profileId, enabled]);

  useEffect(() => {
    if (!profileId || !enabled) {
      setDays([]);
      return;
    }
    const mine = ++seq.current;
    getCgmDaySummaries(profileId, band, Date.now(), dayCount)
      .then((rows) => {
        if (mine === seq.current) setDays(rows);
      })
      .catch(() => {
        if (mine === seq.current) setDays([]);
      });
  }, [profileId, enabled, band.low, band.high, dayCount, dataVersion, tick]);

  return days;
}
