import type { Injection, MealLog } from "./types";

/**
 * Seam between the log tables and the health-store mirror. lib/db must not
 * import the health services (they import the db), so lib/healthRecords.ts
 * registers the real handlers at app start. Every emit swallows handler errors:
 * a mirror problem never fails a local save or delete.
 */
export interface RemovedHealthRecord {
  id: string;
  uuid: string | null;
}

export interface HealthRecordHooks {
  mealSaved(meal: MealLog, previous: MealLog | null): void;
  injectionSaved(injection: Injection, previous: Injection | null): void;
  removed(kind: "carbs" | "insulin", records: RemovedHealthRecord[]): void;
}

let hooks: Partial<HealthRecordHooks> = {};

export function setHealthRecordHooks(next: Partial<HealthRecordHooks>): void {
  hooks = next;
}

export function emitMealSaved(meal: MealLog, previous: MealLog | null): void {
  try {
    hooks.mealSaved?.(meal, previous);
  } catch {
    // the local save already succeeded
  }
}

export function emitInjectionSaved(injection: Injection, previous: Injection | null): void {
  try {
    hooks.injectionSaved?.(injection, previous);
  } catch {
    // the local save already succeeded
  }
}

export function emitRemoved(kind: "carbs" | "insulin", records: RemovedHealthRecord[]): void {
  if (records.length === 0) return;
  try {
    hooks.removed?.(kind, records);
  } catch {
    // the local delete already succeeded
  }
}
