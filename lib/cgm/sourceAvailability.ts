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
