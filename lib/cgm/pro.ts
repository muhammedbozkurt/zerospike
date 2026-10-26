/** The free tier sees the last 24 hours of the CGM curve; longer windows are Pro. */
export const CGM_FREE_CURVE_HOURS = 24;

export function cgmCurveWindowAllowed(isPro: boolean, hours: number): boolean {
  if (!Number.isFinite(hours) || hours <= 0) return false;
  return isPro || hours <= CGM_FREE_CURVE_HOURS;
}

export function nightscoutAllowed(isPro: boolean): boolean {
  return isPro;
}
