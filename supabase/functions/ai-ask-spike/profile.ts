export const DEFAULT_PROFILE_PREFIX = "eu.";
/** Only "eu." keeps inference in the EU: the "global." profile can be served from outside it. */
export const ALLOWED_PROFILE_PREFIXES: readonly string[] = [DEFAULT_PROFILE_PREFIX];

let fallbackLogged = false;

/** Anything but an allowed prefix falls back to "eu." instead of failing, so the EU data
 *  region claim holds whatever the secret says. The value itself is never logged. */
export function spikePrefix(): string {
  const raw = Deno.env.get("SPIKE_MODEL_PREFIX")?.trim() || undefined;
  if (raw === undefined) return DEFAULT_PROFILE_PREFIX;
  if (ALLOWED_PROFILE_PREFIXES.includes(raw)) return raw;
  if (!fallbackLogged) {
    fallbackLogged = true;
    console.warn(`spike config: SPIKE_MODEL_PREFIX is not "${DEFAULT_PROFILE_PREFIX}", using "${DEFAULT_PROFILE_PREFIX}"`);
  }
  return DEFAULT_PROFILE_PREFIX;
}
