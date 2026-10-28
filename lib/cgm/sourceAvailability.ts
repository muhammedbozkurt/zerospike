/**
 * Whether the Nightscout connector is part of this build. Onboarding must not
 * offer a source the app cannot connect; the hub flips this to true when
 * lib/nightscout lands. An explicit constant, not a probe for the module.
 */
export const NIGHTSCOUT_ENABLED = true;

/** `enabled` is injectable so the gating can be checked without a rebuild. */
export function nightscoutAvailable(enabled: boolean = NIGHTSCOUT_ENABLED): boolean {
  return enabled;
}

/**
 * Health Connect on Android is a separate app. Without it (or while it waits for
 * a Play update) the CGM option cannot work, so it is shown but disabled with a
 * way to fix it, instead of a permission request that never opens anything.
 * iOS has no such state; `status` is null until the check has answered.
 */
export type CgmChoiceGate = "ready" | "install" | "update";

export function cgmChoiceGate(input: {
  os: string;
  status: "available" | "unavailable" | "update_required" | null;
}): CgmChoiceGate {
  if (input.os !== "android") return "ready";
  if (input.status === "unavailable") return "install";
  if (input.status === "update_required") return "update";
  return "ready";
}

/**
 * The gate right now, asked of the platform instead of a cached screen state:
 * the person may have installed or updated Health Connect a moment ago and come
 * back, and a tap must not send them to Play again for something already done.
 */
export async function cgmChoiceGateNow(
  os: string,
  getStatus: () => Promise<"available" | "unavailable" | "update_required">
): Promise<CgmChoiceGate> {
  if (os !== "android") return "ready";
  return cgmChoiceGate({ os, status: await getStatus() });
}

/** Health Connect's own Play Store listing (the same deep link the data settings use). */
export const HEALTH_CONNECT_PLAY_URL =
  "market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding";
