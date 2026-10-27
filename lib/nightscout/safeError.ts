/**
 * An error that is safe to hand to logCrash. The original message is dropped on
 * purpose: network and storage errors routinely quote the address they were
 * working on, and the address and token must never reach a log. Only the stage
 * and the error's class name survive.
 */
export function safeNightscoutError(stage: string, err: unknown): Error {
  const name =
    err != null && typeof err === "object" && typeof (err as { name?: unknown }).name === "string"
      ? String((err as { name: string }).name).replace(/[^A-Za-z0-9_.]/g, "").slice(0, 40)
      : typeof err;
  const safe = new Error(`nightscout ${stage} failed (${name || "unknown"})`);
  safe.name = "NightscoutError";
  return safe;
}
