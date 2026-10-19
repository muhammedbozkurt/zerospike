// Contract constants for the ai-ask-spike "carb_estimate" mode, shared by the
// function and any Deno-side tooling. The app keeps its own copy of the limits in
// lib/ai (free 1 / pro 50 a day); keep the numbers in sync.

export const CARB_MODE = "carb_estimate";
export const CARB_TEXT_MAX = 300;
export const CARB_MAX_ITEMS = 12;
export const CARB_NAME_MAX = 60;
export const CARB_UNIT_MAX = 20;
export const CARB_QUANTITY_MAX = 10000;
export const CARB_GRAMS_MAX = 500;

export const CARB_FREE_DAILY_CAP = 1;
export const CARB_PRO_DAILY_CAP = 50;
/** Prefix of the spike_usage.device_id key that holds the separate carb counter. */
export const CARB_KEY_PREFIX = "ce:";

/** Device ids are UUIDs in the app; ':' is excluded so a chat device cannot collide with another device's `ce:` counter row. */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

export interface CarbItem {
  name: string;
  quantity: number;
  unit: string;
  grams_carb: number;
}

export interface CarbEstimateBody {
  items: CarbItem[];
  total_grams_carb: number;
  filtered: boolean;
  /** true: a model call was made and the device slot is spent; false: refused before any model call, slot untouched. */
  charged: boolean;
  usage: { model: string; input_tokens: number; output_tokens: number };
}

export type CarbErrorCode = "bad_request" | "daily_limit_carb" | "rate_limit" | "capacity" | "unavailable" | "estimate_failed" | "upstream";
