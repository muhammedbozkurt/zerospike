/**
 * An injection record needs a real amount: an empty or zero stepper is not one.
 * `original` is the dose a record already had when it is being EDITED (null or 0
 * for an old dose-less record): such a record may stay dose-less so its site,
 * time and note can still be corrected. Omit it for a new record.
 */
export function injectionDoseOk(dose: number, original?: number | null): boolean {
  if (!Number.isFinite(dose) || dose < 0) return false;
  if (dose > 0) return true;
  return original !== undefined && !(original != null && original > 0);
}
