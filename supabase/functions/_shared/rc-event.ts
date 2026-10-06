// Maps a RevenueCat webhook (v1) body to a public.subscription_events row. Pure,
// so the mapping can be checked without a server or a database.

import { isRecord } from "./http.ts";

export interface SubscriptionRow {
  rc_event_id: string;
  type: string | null;
  app_user_id: string | null;
  original_app_user_id: string | null;
  device_id: string | null;
  product_id: string | null;
  period_type: string | null;
  store: string | null;
  environment: string | null;
  /** Omitted when RevenueCat sends no event_timestamp_ms; the column defaults to now(). */
  event_at?: string;
  purchased_at: string | null;
  expiration_at: string | null;
  cancel_reason: string | null;
  expiration_reason: string | null;
  price: number | null;
  currency: string | null;
  country: string | null;
  raw: Record<string, unknown>;
}

// RevenueCat's reserved ($-prefixed) subscriber attributes can carry personal
// identifiers ($email, $phoneNumber, $ip, $idfa, $gpsAdId, push tokens...). Raw
// keeps the app's own attributes (no $, e.g. device_id) and ad attribution only.
const KEPT_RESERVED_ATTRIBUTES = new Set(["$mediaSource", "$campaign", "$adGroup", "$ad", "$keyword", "$creative"]);

function keepAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !key.startsWith("$") || KEPT_RESERVED_ATTRIBUTES.has(key)),
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value.slice(0, 255) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Epoch milliseconds to ISO, null when absent or outside the Date range. */
function msToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? new Date(value).toISOString()
    : null;
}

/** Returns null when the body has no event or no event id (nothing to key on). */
export function toSubscriptionRow(body: unknown): SubscriptionRow | null {
  if (!isRecord(body) || !isRecord(body.event)) return null;
  const event = body.event;
  const id = text(event.id);
  if (!id) return null;

  const attributes = isRecord(event.subscriber_attributes) ? event.subscriber_attributes : null;
  const deviceAttr = attributes?.device_id;
  const deviceId = isRecord(deviceAttr) ? text(deviceAttr.value)?.trim().toLowerCase() || null : null;
  const eventAt = msToIso(event.event_timestamp_ms);

  return {
    rc_event_id: id,
    type: text(event.type),
    app_user_id: text(event.app_user_id),
    original_app_user_id: text(event.original_app_user_id),
    device_id: deviceId,
    product_id: text(event.product_id),
    period_type: text(event.period_type),
    store: text(event.store),
    environment: text(event.environment),
    ...(eventAt ? { event_at: eventAt } : {}),
    purchased_at: msToIso(event.purchased_at_ms),
    expiration_at: msToIso(event.expiration_at_ms),
    cancel_reason: text(event.cancel_reason),
    expiration_reason: text(event.expiration_reason),
    // event.price is USD; the amount in `currency` is price_in_purchased_currency.
    // Store the pair that belongs together; the USD figure stays in raw.
    price: num(event.price_in_purchased_currency),
    currency: text(event.currency),
    country: text(event.country_code),
    raw: attributes ? { ...body, event: { ...event, subscriber_attributes: keepAttributes(attributes) } } : body,
  };
}
