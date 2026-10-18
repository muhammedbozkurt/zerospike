import { Platform } from "react-native";

import type { HealthWriteMeta } from "../healthMeta";
import { autoPeriodTagFor } from "../periodTag";
import { isScreenshotMode } from "../screenshotMode";
import type { GlucoseSample, HealthProvider, HealthSummary, InsulinKind } from "./healthTypes";

/**
 * Dev-only mock provider: simulates a health store end to end (no device or
 * CGM required) so DEBUG_MOCK_HEALTH builds can exercise the whole sync UI on
 * either platform. Mirrors the RevenueCat mock pattern.
 */

export function readMockGlucose(): GlucoseSample[] {
  // Store captures run on a seeded DB; fresh random rows every launch would leak into the dashboard.
  if (isScreenshotMode()) return [];
  const now = Date.now();
  const samples: GlucoseSample[] = [];
  let baseline = 95 + Math.round(Math.random() * 20);
  // ~8 readings/day over the window, timestamps snapped to the half hour so
  // repeat syncs dedupe cleanly (matching real-store behaviour).
  const count = 24;
  for (let i = count - 1; i >= 0; i--) {
    const raw = now - i * 3 * 60 * 60 * 1000;
    const ts = new Date(Math.round(raw / (30 * 60 * 1000)) * 30 * 60 * 1000);
    baseline += Math.round((Math.random() - 0.45) * 18);
    baseline = Math.max(70, Math.min(220, baseline));
    samples.push({
      value: baseline,
      date: ts.toISOString(),
      period_tag: autoPeriodTagFor("health_import", {}),
    });
  }
  return samples;
}

export function mockHealthSummary(windowDays: number): HealthSummary {
  // Insulin delivery + exercise minutes are an iOS/HealthKit-only feature
  // (Health Connect has no insulin record type), so Android returns nothing
  // here too, matching the real Android provider.
  if (Platform.OS !== "ios") return { activeMinutes: null, insulin: null };
  const scale = windowDays / 7;
  return {
    activeMinutes: Math.round(150 * scale),
    insulin: {
      basalUnits: Math.round(18 * 7 * scale),
      bolusUnits: Math.round(12 * 7 * scale),
      count: Math.round(28 * scale),
    },
  };
}

let mockWriteGranted = false;

export const healthMock: HealthProvider = {
  async isAvailable() {
    return true;
  },
  async requestReadPermissions() {
    return true;
  },
  async requestWritePermission() {
    mockWriteGranted = true;
    return true;
  },
  async requestReadWritePermissions() {
    mockWriteGranted = true;
    return { read: true, write: true };
  },
  async isWriteAuthorized() {
    return mockWriteGranted;
  },
  async readRecentGlucose() {
    return readMockGlucose();
  },
  async writeGlucose(mgdl: number, dateIso: string, _meta?: HealthWriteMeta) {
    return `mock-hk-${Date.parse(dateIso) || 0}-${Math.round(mgdl)}`;
  },
  async deleteGlucose() {
    // no-op: mock ids are never real health-store objects
  },
  async deleteGlucoseBatch() {
    // no-op: mock ids are never real health-store objects
  },
  async readSummary(windowDays: number) {
    return mockHealthSummary(windowDays);
  },
  async writeCarbs(grams: number, dateIso: string) {
    return `mock-hk-carbs-${Date.parse(dateIso) || 0}-${Math.round(grams)}`;
  },
  async writeInsulin(units: number, kind: InsulinKind, dateIso: string) {
    return `mock-hk-insulin-${kind}-${Date.parse(dateIso) || 0}-${Math.round(units * 100)}`;
  },
  async deleteCarbsBatch() {},
  async deleteInsulinBatch() {},
  async requestKindWritePermission() {
    return true;
  },
  async isKindWriteAuthorized() {
    return mockWriteGranted;
  },
  async isReadGranted() {
    return true;
  },
  async startBackgroundObserver() {
    return false;
  },
  async stopBackgroundObserver() {},
  async hasBackgroundReadPermission() {
    return true;
  },
  async requestBackgroundReadPermission() {
    return true;
  },
  async peekGlucoseChanges() {
    return { changed: true, commit: async () => {} };
  },
};
