/**
 * Post-meal reminder countdown formatting. Pure and i18n-free: it only decides
 * the display number and which unit to show, so the caller picks the localized
 * phrase. Minutes are rounded up (the label reads "1 min" through the final
 * minute); once under a minute remains it switches to a whole-second readout.
 */
export interface PostMealCountdown {
  /** true when under a minute remains (show seconds), else minutes. */
  seconds: boolean;
  /** whole minutes when `seconds` is false, whole seconds when true. */
  value: number;
}

export function formatPostMealRemaining(remainingMs: number): PostMealCountdown {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (totalSeconds <= 60) return { seconds: true, value: totalSeconds };
  return { seconds: false, value: Math.ceil(totalSeconds / 60) };
}
